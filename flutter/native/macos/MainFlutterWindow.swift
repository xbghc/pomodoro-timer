import Cocoa
import FlutterMacOS

private final class DrawerPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

// Keep the SDK's nib-compatible host alive but hidden. Move its retained Flutter
// controller into a real non-activating NSPanel; do not recreate a Dart engine
// on every hover or pretend an ordinary NSWindow is a panel.
class MainFlutterWindow: NSWindow {
  private var drawer: NativeDrawer?

  override func awakeFromNib() {
    let flutterController = FlutterViewController()
    contentViewController = flutterController
    RegisterGeneratedPlugins(registry: flutterController)
    super.awakeFromNib()
    orderOut(nil)
    drawer = NativeDrawer(host: self, controller: flutterController)
  }
}

private final class NativeDrawer: NSObject {
  private let panel: DrawerPanel
  private let channel: FlutterMethodChannel
  private let controller: FlutterViewController
  private var statusItem: NSStatusItem?
  private var observers: [(NotificationCenter, NSObjectProtocol)] = []
  private var shown = false
  private var suspended = false
  private var epoch = 0
  private var animationGeneration = 0
  private var target = NSRect.zero
  private var activity: NSObjectProtocol?

  init(host: NSWindow, controller: FlutterViewController) {
    self.controller = controller
    channel = FlutterMethodChannel(name: "pomodoro/edge_drawer", binaryMessenger: controller.engine.binaryMessenger)
    panel = DrawerPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 420),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    super.init()
    host.contentViewController = nil
    panel.contentViewController = controller
    panel.isReleasedWhenClosed = false
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.hasShadow = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    if #available(macOS 13.0, *) {
      panel.collectionBehavior.insert(.canJoinAllApplications)
    }
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { result(FlutterError(code: "disposed", message: "Native host is gone", details: nil)); return }
      switch call.method {
      case "bootstrap": result(["platform": "macOS / AppKit NSPanel"])
      case "sample": result(self.sample())
      case "reveal": result(self.reveal())
      case "conceal": self.conceal(immediate: false); result(nil)
      case "requestFocus":
        if self.shown {
          self.panel.makeKey()
          self.panel.makeFirstResponder(self.controller.view)
        }
        result(nil)
      case "quit":
        result(nil)
        DispatchQueue.main.async { NSApp.terminate(nil) }
      default: result(FlutterMethodNotImplemented)
      }
    }
    installStatusItem()
    observe(NotificationCenter.default, NSApplication.didChangeScreenParametersNotification) { [weak self] in self?.reset() }
    let workspace = NSWorkspace.shared.notificationCenter
    observe(workspace, NSWorkspace.activeSpaceDidChangeNotification) { [weak self] in self?.reset() }
    observe(workspace, NSWorkspace.willSleepNotification) { [weak self] in
      self?.suspended = true; self?.reset()
    }
    observe(workspace, NSWorkspace.didWakeNotification) { [weak self] in
      self?.suspended = false; self?.reset()
    }
    // The prototype's edge sampler must remain responsive while its host is
    // hidden. This permits system sleep but suppresses App Nap. Measure idle
    // energy before selecting the final event/polling strategy.
    activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep],
                                                     reason: "Validate native edge hover behavior")
  }

  deinit {
    channel.setMethodCallHandler(nil)
    for (center, token) in observers { center.removeObserver(token) }
    if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
    if let token = activity { ProcessInfo.processInfo.endActivity(token) }
    panel.orderOut(nil)
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, action: @escaping () -> Void) {
    let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in action() }
    observers.append((center, token))
  }

  private func installStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.title = "P"
    item.button?.toolTip = "Flutter native drawer prototype"
    let menu = NSMenu()
    let show = NSMenuItem(title: "Show drawer prototype", action: #selector(showFromMenu), keyEquivalent: "")
    let hide = NSMenuItem(title: "Hide drawer", action: #selector(hideFromMenu), keyEquivalent: "")
    let quit = NSMenuItem(title: "Quit prototype", action: #selector(quitFromMenu), keyEquivalent: "q")
    for entry in [show, hide] { entry.target = self; menu.addItem(entry) }
    menu.addItem(.separator())
    quit.target = self; menu.addItem(quit)
    item.menu = menu; statusItem = item
  }
  @objc private func showFromMenu() { _ = reveal() }
  @objc private func hideFromMenu() { conceal(immediate: true) }
  @objc private func quitFromMenu() { NSApp.terminate(nil) }

  private func currentScreen() -> NSScreen? {
    let point = NSEvent.mouseLocation
    return NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) }) ?? NSScreen.main
  }
  private func reset() {
    epoch += 1
    conceal(immediate: true)
  }
  private func sample() -> [String: Any] {
    guard let screen = currentScreen() else {
      return ["visible": false, "suspended": true, "epoch": epoch, "error": "No screen is available"]
    }
    let work = screen.visibleFrame
    let point = NSEvent.mouseLocation
    let trigger = NSRect(x: work.maxX - 4, y: work.minY + 24, width: 4, height: 72)
    let display = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    return ["display": display?.stringValue ?? "unknown", "epoch": epoch,
            "inTrigger": NSMouseInRect(point, trigger, false),
            "inPanel": shown && NSMouseInRect(point, panel.frame, false),
            "visible": shown && panel.isVisible, "focused": panel.isKeyWindow,
            "buttonsDown": NSEvent.pressedMouseButtons != 0,
            "suspended": suspended, "error": ""]
  }
  private func reveal() -> Bool {
    guard !suspended, let screen = currentScreen() else { return false }
    if shown { return true }
    let work = screen.visibleFrame
    let width = min(CGFloat(360), work.width)
    let height = min(CGFloat(420), work.height - 24)
    guard width > 0, height > 0 else { return false }
    target = NSRect(x: work.maxX - width, y: work.minY + 24, width: width, height: height)
    let start = NSRect(x: target.maxX - 1, y: target.minY, width: 1, height: height)
    panel.setFrame(start, display: true)
    panel.orderFrontRegardless() // Never makeKeyAndOrderFront or NSApp.activate on hover.
    shown = true
    animate(to: target, hideAfter: false)
    return true
  }
  private func conceal(immediate: Bool) {
    animationGeneration += 1
    if immediate || !shown {
      panel.orderOut(nil)
      shown = false
      return
    }
    let end = NSRect(x: target.maxX - 1, y: target.minY, width: 1, height: target.height)
    animate(to: end, hideAfter: true)
  }
  private func animate(to rect: NSRect, hideAfter: Bool) {
    animationGeneration += 1
    let generation = animationGeneration
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    NSAnimationContext.runAnimationGroup({ context in
      context.duration = reduced ? 0 : 0.16
      panel.animator().setFrame(rect, display: true)
    }, completionHandler: { [weak self] in
      guard let self = self, generation == self.animationGeneration else { return }
      if hideAfter { self.panel.orderOut(nil); self.shown = false }
    })
  }
}
