# Desktop implementation decision: Flutter + native window hosts

Status: selected by the user on 2026-10-18; window feasibility prototype in progress.

The product must provide a hover-revealed edge drawer on Windows virtual desktops and macOS Spaces, including ordinary full-screen applications. Electron is no longer the target UI runtime. Use Flutter for shared UI and pure Dart for the eventual activity domain; use C++/Win32 on Windows and Swift/AppKit on macOS for window behavior. The Windows native layer is C++, not a second C# runtime.

Do not mistake a Flutter widget slide animation for an OS-window implementation. Focus, input regions, desktop membership, display topology, native recovery controls and failure reporting belong to the platform boundary. A native show API returning success does not establish user-visible full-screen coverage.

The existing Electron v2 work remains frozen on its own branch as a tested behavior reference, not a compatibility layer or an embedded runtime. Do not merge or release it as the selected architecture. The new prototype lives in `flutter/`, writes no activity data and has no timer UI pretending to be functional.

Sequence:
1. Native drawer feasibility and device validation, especially an empty Windows virtual desktop.
2. Port the activity state machine, JSON timetable, interval storage and tests to Dart. Reminders never split a continuous activity; fixed schedule boundaries win; waiting/offline time is not counted.
3. Real Flutter drawer, schedule selector, actual-record calendar CRUD, notifications and native lifecycle integration.
4. Packaging, login startup, updater, accessibility and system regression tests.

No backward compatibility or data migration, including from the temporary Electron v2 implementation. Do not import or erase its files. Prototype CI artifacts are not a production release.

Primary references consulted:
- https://docs.flutter.dev/platform-integration/platform-channels
- https://docs.flutter.dev/platform-integration/desktop
- https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager
- https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications
- https://api.flutter.dev/macos-embedder/interface_flutter_view_controller.html
