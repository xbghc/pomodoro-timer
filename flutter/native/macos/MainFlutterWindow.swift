import Cocoa
import FlutterMacOS

private final class DrawerPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

// The generated storyboard window only owns the Flutter engine. The visible
// host is created as a nonactivating NSPanel from the outset, not restyled later.
class MainFlutterWindow: NSWindow {
  private var drawer: DrawerPanel?
  private var flutter: FlutterViewController?
  private var channel: FlutterMethodChannel?
  private let hover = HoverPolicy()
  private var polling: Timer?
  private var animation: Timer?
  private var observers: [(NotificationCenter, NSObjectProtocol)] = []
  private var anchor: NSScreen?
  private var fullFrame = NSRect(x: 0, y: 0, width: 360, height: 320)
  private var reveal: CGFloat = 4

  override func awakeFromNib() {
    super.awakeFromNib()
    orderOut(nil)
    NSApp.setActivationPolicy(.accessory)
    let controller = FlutterViewController()
    flutter = controller
    RegisterGeneratedPlugins(registry: controller)
    let panel = DrawerPanel(contentRect: fullFrame,
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    drawer = panel
    panel.isReleasedWhenClosed = false
    panel.hidesOnDeactivate = false
    panel.isFloatingPanel = true
    panel.becomesKeyOnlyIfNeeded = true
    panel.level = .floating
    panel.hasShadow = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    if #available(macOS 13.0, *) { panel.collectionBehavior.insert(.canJoinAllApplications) }
    let clip = NSView(frame: fullFrame)
    clip.wantsLayer = true
    clip.layer?.masksToBounds = true
    panel.contentView = clip
    controller.view.autoresizingMask = []
    clip.addSubview(controller.view)
    if let screen = NSScreen.main { setAnchor(screen) }
    place()

    let bridge = FlutterMethodChannel(name: "pomodoro/desktop_shell", binaryMessenger: controller.engine.binaryMessenger)
    channel = bridge
    bridge.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { result(FlutterError(code: "closed", message: "Window closed", details: nil)); return }
      switch call.method {
      case "status": result(self.snapshot())
      case "collapse": self.hover.close(); self.animate(expanded: false); result(self.snapshot())
      case "quit": result(nil); DispatchQueue.main.async { NSApp.terminate(nil) }
      default: result(FlutterMethodNotImplemented)
      }
    }
    // No activate(), makeKeyAndOrderFront(), or global keyboard/mouse hooks.
    panel.orderFrontRegardless()
    startPolling()
    observe(NSWorkspace.shared.notificationCenter, NSWorkspace.activeSpaceDidChangeNotification) { [weak self] in
      self?.hover.close(); self?.animate(expanded: false)
    }
    observe(NotificationCenter.default, NSApplication.didChangeScreenParametersNotification) { [weak self] in self?.reset() }
    observe(NSWorkspace.shared.notificationCenter, NSWorkspace.willSleepNotification) { [weak self] in
      self?.polling?.invalidate(); self?.animation?.invalidate(); self?.drawer?.orderOut(nil)
      self?.hover.close()
    }
    observe(NSWorkspace.shared.notificationCenter, NSWorkspace.didWakeNotification) { [weak self] in
      self?.reset(); self?.startPolling()
    }
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, action: @escaping () -> Void) {
    let token = center.addObserver(forName: name, object: nil, queue: .main) { _ in action() }
    observers.append((center, token))
  }
  private func startPolling() {
    polling?.invalidate()
    let timer = Timer(timeInterval: 0.08, repeats: true) { [weak self] _ in self?.poll() }
    timer.tolerance = 0.016
    RunLoop.main.add(timer, forMode: .common)
    polling = timer
  }
  private func setAnchor(_ screen: NSScreen) {
    anchor = screen
    let width = min(360, screen.frame.width)
    let height = max(1, min(320, screen.visibleFrame.height - 32))
    fullFrame = NSRect(x: screen.frame.maxX - width,
      y: screen.visibleFrame.minY + 16, width: width, height: height)
    reveal = hover.expanded ? width : 4
  }
  private func reset() {
    animation?.invalidate(); hover.close()
    let point = NSEvent.mouseLocation
    if let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) ?? NSScreen.main { setAnchor(screen) }
    place(); drawer?.orderFrontRegardless(); publish()
  }
  private func place() {
    guard let panel = drawer else { return }
    // Only the revealed slice is a native window. Flutter keeps a fixed canvas.
    panel.setFrame(NSRect(x: fullFrame.maxX - reveal, y: fullFrame.minY,
      width: reveal, height: fullFrame.height), display: true)
    flutter?.view.frame = NSRect(origin: .zero, size: fullFrame.size)
  }
  private func poll() {
    guard let panel = drawer else { return }
    let point = NSEvent.mouseLocation
    guard let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) else { return }
    let bottom = screen.visibleFrame.minY + 16
    let height = max(1, min(320, screen.visibleFrame.height - 32))
    let trigger = point.x >= screen.frame.maxX - 4 && point.y >= bottom && point.y < bottom + height
    if !hover.expanded && trigger && screen != anchor { setAnchor(screen); place() }
    let action = hover.update(now: ProcessInfo.processInfo.systemUptime * 1000,
      trigger: trigger, inside: panel.isVisible && panel.frame.contains(point))
    switch action {
    case .expand: panel.orderFrontRegardless(); animate(expanded: true)
    case .collapse: animate(expanded: false)
    case .none: break
    }
  }
  private func animate(expanded: Bool) {
    animation?.invalidate()
    let from = reveal, target: CGFloat = expanded ? fullFrame.width : 4
    let started = ProcessInfo.processInfo.systemUptime
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
      guard let self = self else { timer.invalidate(); return }
      let t = min(1, (ProcessInfo.processInfo.systemUptime - started) / 0.18)
      self.reveal = from + (target - from) * CGFloat(1 - pow(1 - t, 3))
      self.place()
      if t >= 1 { timer.invalidate() }
    }
    RunLoop.main.add(timer, forMode: .common)
    animation = timer
    publish()
  }
  private func snapshot() -> [String: Any] {
    ["platform": "macos", "expanded": hover.expanded, "desktop": "system-managed", "prototype": true]
  }
  private func publish() { channel?.invokeMethod("state", arguments: snapshot()) }
  deinit {
    polling?.invalidate(); animation?.invalidate()
    for (center, token) in observers { center.removeObserver(token) }
  }
}
