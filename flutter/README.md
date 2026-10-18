# Flutter + native drawer prototype

This is a window-behavior feasibility prototype, not a completed replacement timer. It has no Electron dependency, no activity database, no schedule, and no migration or compatibility layer. Existing Electron code is frozen as a behavior reference on `feat/activity-schedule-v2`.

## Run

Install **Flutter 3.47.7** and the native desktop build toolchain. From this directory:

```sh
python tool/prepare.py
flutter pub get
flutter test
flutter run -d windows
# On macOS, instead use: flutter run -d macos
```

`prepare.py` generates disposable standard Flutter hosts, asserts the expected template shape, and installs the native source from `native/`. It never replaces Dart sources or modifies Electron files. Generated `windows/` and `macos/` directories are ignored. To regenerate them, delete only those two generated directories. Native edits belong in `native/`, not generated hosts.

The app starts hidden with a native tray/menu-bar entry. Hover for 180 ms over the **right edge of the monitor work area, 24–96 logical pixels above its bottom**. The panel expands without automatic keyboard activation. Moving away for 450 ms retracts it; mouse drags do not trigger it. A pin keeps it open, Escape/close retracts it, and the text input explicitly requests focus only when clicked. The tray/menu provides a recovery entry and an explicit Quit action.

This first spike uses an invisible edge hot zone, not a persistent visible tab. Animation expands the native window's clipped bounds inside the work area instead of moving a full hidden window into the neighboring display. The collapsed window is fully hidden and should not intercept input. A visible tab, positioning preferences and finished visual design are later work.

## Ownership

- **Dart/Flutter:** prototype contents, platform-channel client, monotonic hover policy, dwell/leave cancellation and tests. A serialized 50 ms sampler obtains pointer/button/monitor information through the native channel; it installs no keyboard or mouse hooks. Idle power/App Nap behavior must be measured before production.
- **Windows C++/Win32:** borderless HWND, physical-pixel/DPI conversion, non-activating topmost display, clipped reveal/retract animation, tray, display/power callbacks and virtual-desktop handoff.
- **macOS Swift/AppKit:** retained Flutter view controller in a non-activating NSPanel, all-Spaces/full-screen collection behavior, native animation, menu-bar recovery, display/Space/power callbacks.

Channel `pomodoro/edge_drawer`: `bootstrap`, `sample`, `reveal`, `conceal`, `requestFocus`, `quit`. `sample` reports actual native visibility/focus, native reset epoch and errors. `reveal` returns true only when the native host has accepted a show; this is not proof of full-screen coverage.

### Windows virtual desktops: explicit experiment

Only documented `IVirtualDesktopManager` methods are used. First query a foreground/current-desktop window. When there is no usable window (including an empty desktop), a short-lived, transparent, non-activating, application-owned probe is tested to obtain the active desktop ID. The panel is moved and its membership is checked again. Probe assignment by the shell is an **unverified feasibility assumption**, not an API guarantee. Failures are reported; the code does not switch desktops, pin windows using private COM interfaces, or silently claim success. Empty-desktop tests are a release blocker.

### Platform boundaries

Normal app full-screen mode is in scope. Windows exclusive full-screen rendering, UAC secure desktop, lock/login screens and protected content are not promised. A successful build or unit test is not a substitute for multi-desktop/full-screen hardware validation.

## Validation gates

CI runs hover-policy tests and compiles Windows and macOS hosts. Hardware validation remains unchecked:

- [ ] Repeated Windows virtual-desktop switches, **including empty desktops**, reveal on the current desktop without switching it. Capture native errors on failure.
- [ ] macOS Spaces, another app's native full-screen Space, and Stage Manager.
- [ ] Hover does not steal keyboard input from the foreground app; clicking the input does enable typing. Buttons work on the first click. Escape and native Quit remain reachable.
- [ ] Monitor combinations, left/negative coordinates, 100/150/200% DPI, right/bottom taskbars or Dock, display removal while expanded and sleep/wake.
- [ ] Hidden and partially animated areas do not intercept another app's clicks or spill onto a neighbor monitor; reduced-motion settings are respected.
- [ ] Power consumption and wake-ups with the window hidden; hot restart and normal quit release native resources.

After these gates: port the activity/schedule/store rules to pure Dart with the existing behavior tests as acceptance cases, then implement the real drawer and editable calendar. No old data migration will be added.
