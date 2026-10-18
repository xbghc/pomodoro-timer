# Flutter + native drawer probe

An isolated technical prototype, not the replacement timer application yet. The user has selected Flutter for shared UI and native window control on Windows/macOS. This probe writes no activity records, reads no Electron data, and does not launch Electron or Node.

## What is implemented

- Flutter renders a small diagnostic panel and pointer-operated buttons.
- Windows uses C++/Win32; macOS uses Swift/AppKit and a nonactivating `NSPanel`.
- Hover at the right edge near the bottom of a display: 160 ms dwell before expansion, 400 ms outside before collapse, 180 ms native slide. Manual collapse requires leaving the trigger before rearming.
- The host window shrinks to a 4 logical-pixel strip. The Flutter surface stays full-size and is clipped by its native parent. Hidden content is not an invisible input-blocking rectangle and does not spill onto the next monitor.
- Hover does not call a foreground-activation or desktop-switch API. This prototype intentionally does not accept keyboard focus; a future main editor will use a separate normal window.
- macOS requests all Spaces/fullscreen auxiliary behavior, including `canJoinAllApplications` where available. Windows follows the current desktop using public `IVirtualDesktopManager` APIs, checks the result and fails closed rather than switching the user's desktop.

**Windows empty-desktop handling remains experimental.** The fallback creates a new transparent, nonactivating, one-pixel owned probe, obtains its desktop and then moves the drawer. API success is not a substitute for real Windows shell testing. Inability to confirm the current desktop hides the drawer; move out of the trigger and back to retry. No private COM interfaces, registry-based desktop IDs, or synthetic keyboard shortcuts are used.

The prototype defaults to the right edge. Other edges, a persistent tray/status-item entry, power-usage tuning, keyboard/accessibility behavior, and production error recovery are not complete. Ordinary app fullscreen is required; exclusive fullscreen games, lock/login screens and UAC secure desktop are not targets.

## Run

Install Flutter and the native toolchain on the target OS. CI uses Flutter revision `abaf9c523780a608bd46686fd5e53740a07077f8`, the stable head verified when this prototype was created.

From this directory:

```sh
dart tool/bootstrap.dart
flutter pub get
flutter run -d windows
# On macOS instead:
flutter run -d macos
```

Keep the launching terminal available; use Ctrl+C to stop the probe when the drawer is inaccessible. The panel also has an explicit quit button. There is no autostart, background installation, Release publishing or user-data migration.

`tool/bootstrap.dart` generates disposable platform runners and installs the native implementations under `native/`. It refuses to overwrite unowned platform directories. Edit `native/`, not generated `windows/` or `macos/`. Regeneration preserves existing owned runners but replaces the explicitly managed host files. Use a clean checkout for SDK changes. This avoids checking in thousands of SDK-template lines for a throwaway capability probe; production runners will be committed after the window design is settled.

## Automated checks

```sh
flutter analyze
flutter test
g++ -std=c++17 -Wall -Wextra -Werror native/test/hover_policy_test.cpp -o /tmp/hover-test
/tmp/hover-test
swiftc native/macos/HoverPolicy.swift native/test/hover_policy_test.swift -o /tmp/hover-swift
/tmp/hover-swift
```

C++ and Swift test the same monotonic hover-policy sequence. Flutter tests cover the platform-channel contract, malformed responses, error propagation and pointer interaction. CI compiles the actual Windows and macOS hosts and uploads diagnostic builds. **Compilation and widget tests do not prove cross-desktop, fullscreen or no-focus-stealing behavior.**

## Manual gate before integrating the timer

1. Leave a text editor focused. Hover to expand, move over/click the probe, and continue typing into the editor. Hover must not activate this app or move the user to another desktop.
2. Repeat on Windows desktops with ordinary windows, a completely empty desktop, and after closing the foreground window. Repeat after Explorer restarts. Any unavailable/hidden drawer is an unresolved failure, not a supported fallback experience.
3. Repeat on macOS Spaces, another app's fullscreen Space, Stage Manager and a fullscreen app on a secondary display.
4. Test monitors arranged horizontally/vertically, negative coordinates, different DPI scales, hot-plugging, Dock/taskbar positions and display resolution changes. Hidden content must not cover or intercept clicks on adjacent screens.
5. Repeat after actual sleep/wake. Evaluate edge conflicts, accidental activation and idle CPU use. The current implementation polls at 80 ms; animation timers exist only while moving.

These gates are not checked off. Once passed, port the confirmed activity rules to Dart, then integrate the calendar, record editing, notifications/rest UI, storage and lifecycle management. See `../docs/flutter-native-architecture.md`.
