import AppKit
import SwiftUI
import Darwin
import PomodoroCore

@main
struct PomodoroApplication {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
        withExtendedLifetime(delegate) {}
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var model: AppModel?
    private var drawer: DrawerController?
    private var mainWindow: NSWindow?
    private var workspaceWindow: NSWindow?
    private var settingsWindow: NSWindow?
    private let navigation = WorkspaceNavigation()
    private let statusPopover = NSPopover()
    private var statusItem: NSStatusItem?
    private var observations: [(NotificationCenter, NSObjectProtocol)] = []
    private var lockDescriptor: Int32 = -1
    private let showWindowNotification = Notification.Name("com.ghm.pomodoro-timer.native.showWindow")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PomodoroTimerNative", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            lockDescriptor = Darwin.open(directory.appendingPathComponent(".instance.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
            guard lockDescriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            guard flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else {
                if errno == EWOULDBLOCK {
                    DistributedNotificationCenter.default().postNotificationName(showWindowNotification, object: nil, userInfo: nil, deliverImmediately: true)
                    NSApp.terminate(nil)
                    return
                }
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Unable to open the data folder"
            alert.informativeText = UserFacingError.message(error)
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        let model = AppModel(directory: directory)
        self.model = model
        drawer = DrawerController(model: model)
        model.openCalendar = { [weak self] in self?.showCalendar() }
        model.openActivity = { [weak self] in self?.showWorkspace(tab: .today) }
        model.openSettings = { [weak self] in self?.showSettings() }
        model.onReminder = { [weak self] text in self?.drawer?.announce(text) }
        model.onChange = { [weak self] in self?.update() }
        installMenu()
        observeSystem()
        update()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model, !model.prepareToQuit() else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Your latest changes could not be saved"
        alert.informativeText = "\(model.blockingError ?? model.errorMessage ?? "Save failed")\nIf you quit, only the last saved checkpoint can be restored."
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Quit Anyway")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        for (center, token) in observations { center.removeObserver(token) }
        observations.removeAll()
        DistributedNotificationCenter.default().removeObserver(self)
        statusPopover.close()
        drawer?.hide()
        if lockDescriptor >= 0 { flock(lockDescriptor, LOCK_UN); Darwin.close(lockDescriptor) }
    }

    @objc private func showMain() {
        guard let model else { return }
        if mainWindow == nil {
            mainWindow = compactWindow(title: "Pomodoro Timer", size: NSSize(width: 360, height: 190),
                                       miniaturizable: true, content: MainView(model: model))
        }
        present(mainWindow)
    }

    @objc private func showCalendar() { showWorkspace(tab: .history) }

    private func showWorkspace(tab: WorkspaceTab) {
        guard let model else { return }
        navigation.tab = tab
        if workspaceWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 860, height: 720),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Pomodoro Timer · Calendar & History"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: WorkspaceView(model: model, navigation: navigation))
            window.appearance = NSAppearance(named: .aqua)
            window.backgroundColor = NSColor(PomodoroTheme.background)
            window.minSize = NSSize(width: 780, height: 700)
            window.center()
            workspaceWindow = window
        }
        present(workspaceWindow)
    }

    @objc private func showSettings() {
        guard let model else { return }
        if settingsWindow == nil {
            settingsWindow = compactWindow(title: "Pomodoro Timer · Settings", size: NSSize(width: 480, height: 520),
                                           miniaturizable: false, content: SettingsView(model: model))
        }
        present(settingsWindow)
    }

    private func compactWindow<Content: View>(title: String, size: NSSize,
                                              miniaturizable: Bool, content: Content) -> NSWindow {
        var mask: NSWindow.StyleMask = [.titled, .closable, .fullSizeContentView]
        if miniaturizable { mask.insert(.miniaturizable) }
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: mask, backing: .buffered, defer: false)
        window.title = title
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = NSColor(PomodoroTheme.background)
        let host = NSHostingView(rootView: content)
        host.sizingOptions = []
        host.autoresizingMask = [.width, .height]
        window.contentView = host
        // Reference dimensions include the title bar; keep native window controls.
        window.minSize = size
        window.maxSize = size
        window.setFrame(NSRect(origin: .zero, size: size), display: false)
        window.standardWindowButton(.zoomButton)?.isEnabled = false
        window.center()
        return window
    }

    private func present(_ window: NSWindow?) {
        statusPopover.close()
        // Activation is an explicit user action, never used by hover or reminders.
        if #available(macOS 14, *) { NSApp.activate() }
        else { NSApp.activate(ignoringOtherApps: true) }
        window?.makeKeyAndOrderFront(nil)
    }

    private func observeSystem() {
        let workspace = NSWorkspace.shared.notificationCenter
        observe(workspace, NSWorkspace.willSleepNotification) { $0.willSleep() }
        observe(workspace, NSWorkspace.didWakeNotification) { $0.didWake() }
        observe(workspace, NSWorkspace.activeSpaceDidChangeNotification) { $0.spaceChanged() }
        observe(.default, NSApplication.didChangeScreenParametersNotification) { $0.screensChanged() }
        observe(.default, NSNotification.Name.NSSystemTimeZoneDidChange) { $0.timeZoneChanged() }
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(showMainFromNotification(_:)), name: showWindowNotification, object: nil)
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name,
                         action: @escaping @MainActor @Sendable (AppDelegate) -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            // queue: .main guarantees this synchronous callback is on the main actor.
            // In particular, close the sleep checkpoint before returning to NSWorkspace.
            MainActor.assumeIsolated { if let self { action(self) } }
        }
        observations.append((center, token))
    }

    @objc nonisolated private func showMainFromNotification(_ notification: Notification) {
        Task { @MainActor [weak self] in self?.showMain() }
    }
    private func willSleep() { model?.suspend() }
    private func didWake() { model?.wake(); drawer?.reposition() }
    private func spaceChanged() { drawer?.reposition() }
    private func screensChanged() { drawer?.reposition() }
    private func timeZoneChanged() { model?.timeZoneChanged() }

    private func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        for (title, action, key) in [("Open Timer", #selector(showMain), "0"),
                                     ("Calendar & History…", #selector(showCalendar), "1"),
                                     ("Settings…", #selector(showSettings), ",")] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self
            appMenu.addItem(entry)
        }
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Pomodoro Timer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        main.addItem(editItem)
        NSApp.mainMenu = main

        guard let model else { return }
        let controller = NSHostingController(rootView: MenuBarView(model: model,
            showTimer: { [weak self] in self?.showMain() },
            showCalendar: { [weak self] in self?.showCalendar() },
            showSettings: { [weak self] in self?.showSettings() },
            quit: { NSApp.terminate(nil) }))
        controller.sizingOptions = [.preferredContentSize]
        statusPopover.contentViewController = controller
        statusPopover.contentSize = controller.view.fittingSize
        statusPopover.behavior = .transient
        statusPopover.appearance = NSAppearance(named: .aqua)

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.target = self
        item.button?.action = #selector(toggleStatusPopover)
        item.button?.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        item.button?.imagePosition = .imageLeading
        item.button?.setAccessibilityIdentifier("pomodoro.status")
        statusItem = item
    }

    @objc private func toggleStatusPopover() {
        guard let button = statusItem?.button else { return }
        if statusPopover.isShown { statusPopover.performClose(nil); return }
        // A menu-bar click is explicit intent; unlike hover, it may take keyboard focus.
        if #available(macOS 14, *) { NSApp.activate() }
        else { NSApp.activate(ignoringOtherApps: true) }
        statusPopover.animates = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        statusPopover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        statusPopover.contentViewController?.view.window?.makeKey()
    }

    private func update() {
        guard let model, let button = statusItem?.button else { return }
        button.title = model.showsMenuBarTimer ? " \(model.isBlocked ? "Paused" : model.readout.text)" : ""
        button.toolTip = "\(model.phaseTitle) · \(model.readout.text)\n\(model.detail)"
        button.setAccessibilityLabel("Pomodoro Timer, \(model.phaseTitle)")
        button.setAccessibilityValue(model.readout.text)
        let progress = model.readout.progress
        let color = NSColor(model.tint)
        let icon = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
            let ring = NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: 12, height: 12))
            ring.lineWidth = 1.8
            NSColor.secondaryLabelColor.withAlphaComponent(0.35).setStroke()
            ring.stroke()
            let arc = NSBezierPath()
            arc.lineWidth = 1.8
            arc.lineCapStyle = .round
            if progress > 0 {
                arc.appendArc(withCenter: NSPoint(x: 8, y: 8), radius: 6, startAngle: 90,
                              endAngle: 90 - CGFloat(progress) * 360, clockwise: true)
                color.setStroke()
                arc.stroke()
            }
            return true
        }
        icon.isTemplate = false
        button.image = icon
    }
}
