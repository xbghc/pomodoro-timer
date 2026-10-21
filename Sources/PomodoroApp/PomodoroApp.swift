import AppKit
import SwiftUI
import Darwin

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
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var model: AppModel?
    private var drawer: DrawerController?
    private var rest: RestWindowController?
    private var mainWindow: NSWindow?
    private var statusItem: NSStatusItem?
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
            alert.messageText = "无法打开本地数据目录"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        let model = AppModel(directory: directory)
        self.model = model
        drawer = DrawerController(model: model)
        rest = RestWindowController(model: model)
        model.openCalendar = { [weak self] in self?.showMain() }
        model.enterFullScreenRest = { [weak self] in self?.rest?.show() }
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
        alert.messageText = "当前数据未能保存"
        alert.informativeText = "\(model.blockingError ?? model.errorMessage ?? "写入失败")\n退出后只恢复到最后成功保存的检查点。"
        alert.addButton(withTitle: "取消退出")
        alert.addButton(withTitle: "仍然退出")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        drawer?.hide()
        rest?.hide()
        if lockDescriptor >= 0 { flock(lockDescriptor, LOCK_UN); Darwin.close(lockDescriptor) }
    }

    @objc private func showMain() {
        guard let model else { return }
        if mainWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 860, height: 760),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "工作与休息"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: MainView(model: model))
            window.minSize = NSSize(width: 780, height: 700)
            window.center()
            mainWindow = window
        }
        NSApp.activate(ignoringOtherApps: true) // Explicit user action; never used by hover or reminders.
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    private func observeSystem() {
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(willSleep), name: NSWorkspace.willSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        workspace.addObserver(self, selector: #selector(spaceChanged), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(timeZoneChanged), name: NSNotification.Name.NSSystemTimeZoneDidChange, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(showMain), name: showWindowNotification, object: nil)
    }

    @objc private func willSleep() { model?.suspend(); rest?.hide() }
    @objc private func didWake() { model?.wake(); drawer?.reposition() }
    @objc private func spaceChanged() { drawer?.reposition() }
    @objc private func screensChanged() { drawer?.reposition(); rest?.screensChanged() }
    @objc private func timeZoneChanged() { model?.timeZoneChanged() }
    @objc private func startWork() { model?.startWork() }
    @objc private func startRest() { model?.startRest() }
    @objc private func deferReminder() { model?.deferReminder() }
    @objc private func stopActivity() { model?.stop() }

    private func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        let show = NSMenuItem(title: "打开工作与休息", action: #selector(showMain), keyEquivalent: "0")
        show.target = self
        appMenu.addItem(show)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出工作与休息", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        main.addItem(editItem)
        NSApp.mainMenu = main

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "circle.lefthalf.filled", accessibilityDescription: "工作与休息")
        let menu = NSMenu()
        menu.delegate = self
        for (title, action) in [("打开日历与模板", #selector(showMain)), ("开始工作", #selector(startWork)),
                                ("开始休息", #selector(startRest)), ("再专注 1 小时", #selector(deferReminder)),
                                ("结束当前活动", #selector(stopActivity))] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.target = self
            menu.addItem(entry)
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    func menuWillOpen(_ menu: NSMenu) {
        guard let model else { return }
        menu.autoenablesItems = false
        for item in menu.items {
            switch item.action {
            case #selector(startWork): item.isEnabled = !model.isBlocked && model.active?.kind != .work
            case #selector(startRest): item.isEnabled = !model.isBlocked && model.active?.kind != .rest
            case #selector(deferReminder): item.isEnabled = !model.isBlocked && model.active?.kind == .work
            case #selector(stopActivity): item.isEnabled = !model.isBlocked && model.active != nil
            default: item.isEnabled = true
            }
        }
    }

    private func update() {
        guard let model else { return }
        statusItem?.button?.title = " \(model.phaseTitle)"
        statusItem?.button?.toolTip = model.detail
        rest?.update()
    }
}
