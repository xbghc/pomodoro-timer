import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Read-only by default; explicit smoke-test actions use existing permissions only.
// Never request or change TCC/Accessibility permissions.
let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
let applications = NSWorkspace.shared.runningApplications.filter {
    $0.bundleIdentifier == "com.ghm.pomodoro-timer.native"
}
let pids = Set(applications.map { Int($0.processIdentifier) })

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func describe(_ element: AXUIElement, depth: Int = 0) -> [String: Any] {
    var result: [String: Any] = [:]
    for name in [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXIdentifierAttribute, kAXValueAttribute] {
        if let value = attribute(element, name) as? String, !value.isEmpty { result[name] = value }
    }
    if depth < 12, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        result["children"] = children.prefix(60).map { describe($0, depth: depth + 1) }
    }
    return result
}

func find(_ label: String, in element: AXUIElement, identifier: Bool = false, depth: Int = 0) -> AXUIElement? {
    guard depth < 20 else { return nil }
    let role = attribute(element, kAXRoleAttribute) as? String ?? ""
    if identifier, attribute(element, kAXIdentifierAttribute) as? String == label { return element }
    if !identifier, [kAXButtonRole, kAXRadioButtonRole, kAXLinkRole].contains(role),
       [kAXTitleAttribute, kAXDescriptionAttribute].contains(where: { attribute(element, $0) as? String == label }) {
        return element
    }
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        if let result = find(label, in: child, identifier: identifier, depth: depth + 1) { return result }
    }
    return nil
}

let arguments = Array(CommandLine.arguments.dropFirst())
if (arguments.first == "--press" && arguments.count == 2) ||
    (arguments.first == "--press-in-window" && arguments.count == 3) ||
    (arguments.first == "--press-status" && arguments.count == 1) {
    guard AXIsProcessTrusted(), let app = applications.first else { fatalError("Existing Accessibility access and running app required") }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    let control: AXUIElement
    if arguments.first == "--press-status" {
        let searchRoot: AXUIElement
        if let extras = attribute(root, kAXExtrasMenuBarAttribute), CFGetTypeID(extras) == AXUIElementGetTypeID() {
            searchRoot = unsafeDowncast(extras, to: AXUIElement.self)
        } else { searchRoot = root }
        guard let status = find("pomodoro.status", in: searchRoot, identifier: true) else { fatalError("Status button not found") }
        control = status
    } else {
        let title = arguments.count == 3 ? arguments[1] : "工作与休息"
        let label = arguments.last!
        let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
        guard let target = windows.first(where: { attribute($0, kAXTitleAttribute) as? String == title }),
              let button = find(label, in: target) else { fatalError("Visible control not found: \(title) / \(label)") }
        control = button
    }
    let result = AXUIElementPerformAction(control, kAXPressAction as CFString)
    guard result == .success else { fatalError("AXPress failed: \(result.rawValue)") }
    Thread.sleep(forTimeInterval: 0.8)
} else if arguments.first == "--move-pointer", arguments.count == 3,
          let x = Double(arguments[1]), let y = Double(arguments[2]), x.isFinite, y.isFinite {
    guard CGPreflightPostEventAccess(),
          let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                              mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) else {
        fatalError("Existing event-posting access required")
    }
    event.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.8)
} else if !arguments.isEmpty {
    fatalError("Unsupported smoke-test action")
}

let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
               as? [[String: Any]] ?? []).filter {
    pids.contains(($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1)
}.map { info -> [String: Any] in
    ["id": info[kCGWindowNumber as String] ?? 0,
     "pid": info[kCGWindowOwnerPID as String] ?? 0,
     "title": info[kCGWindowName as String] ?? "",
     "bounds": info[kCGWindowBounds as String] ?? [:],
     "layer": info[kCGWindowLayer as String] ?? -1]
}
let report: [String: Any] = [
    "sessionAvailable": !session.isEmpty,
    "onConsole": session[kCGSessionOnConsoleKey] ?? NSNull(),
    "loginDone": session[kCGSessionLoginDoneKey] ?? NSNull(),
    "screenCapturePreflight": CGPreflightScreenCaptureAccess(),
    "accessibilityTrusted": AXIsProcessTrusted(),
    "postEventPreflight": CGPreflightPostEventAccess(),
    "screens": NSScreen.screens.map { ["frame": NSStringFromRect($0.frame), "visibleFrame": NSStringFromRect($0.visibleFrame)] },
    "applicationPIDs": Array(pids).sorted(),
    "windows": windows,
    "accessibility": AXIsProcessTrusted() ? applications.map { app -> [String: Any] in
        let root = AXUIElementCreateApplication(app.processIdentifier)
        let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
        return ["pid": app.processIdentifier, "windows": windows.map { describe($0) }]
    } : []
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
