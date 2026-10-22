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
    "onConsole": session["kCGSessionOnConsoleKey"] ?? false,
    "loginDone": session["kCGSessionLoginDoneKey"] ?? false,
    "screenCapturePreflight": CGPreflightScreenCaptureAccess(),
    "accessibilityTrusted": AXIsProcessTrusted(),
    "postEventPreflight": CGPreflightPostEventAccess(),
    "screens": NSScreen.screens.map { ["frame": NSStringFromRect($0.frame), "visibleFrame": NSStringFromRect($0.visibleFrame)] },
    "applicationPIDs": Array(pids).sorted(),
    "windows": windows
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
