import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Read-only diagnostics. Never request or change TCC/Accessibility permissions.
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
    for name in [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXIdentifierAttribute] {
        if let value = attribute(element, name) as? String, !value.isEmpty { result[name] = value }
    }
    if depth < 12, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        result["children"] = children.prefix(60).map { describe($0, depth: depth + 1) }
    }
    return result
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
