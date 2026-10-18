# Decision: Flutter UI with native desktop window control

Status: selected by the user; platform capability prototype in progress.

## Requirements that remain binding

The edge drawer must be summonable across Windows virtual desktops, macOS Spaces and ordinary app fullscreen without switching the user's desktop or taking keyboard focus on hover. Changing frameworks is allowed. This does not extend to exclusive fullscreen games or secure/login desktops.

The product remains an activity-based timer: work, break and waiting; reminder deadlines separate from continuous records; fixed schedule boundaries take precedence; a manual focus extension starts its reminder from the click without splitting the record; break completion enters waiting. Only observed activity is recorded. Sleep, exit and offline gaps must not be backfilled. JSON remains the only editor of future plans; the app may select today's template. Actual history remains editable and long-lived. Reflection is a prompt, not an in-app journal.

No legacy compatibility, import, conversion or migration will be implemented.

## Ownership

| Layer | Owns | Does not own |
| --- | --- | --- |
| Dart domain (next stage) | activity state, continuous intervals, schedule reconciliation, reminder deadlines, validation | Flutter widgets, OS window handles |
| Dart application/storage (next stage) | persistence, lifecycle orchestration, history operations | native hover and window animation |
| Flutter UI | drawer content, future main calendar/settings, view state | virtual desktop selection or window z-order |
| Windows C++/Win32 | native host, edge detection, clipping, slide, activation policy, public desktop API adapter | timer business rules |
| macOS Swift/AppKit | NSPanel, Spaces/fullscreen collection behavior, edge detection, slide, clipping | timer business rules |

Use one Dart activity service as the source of truth when adding more windows. Moving, rebuilding, collapsing or recreating a window must not reset a timer or create a new activity. Platform callbacks are lifecycle/window signals, not alternative timer implementations. The current probe has no activity service and deliberately does not pretend otherwise.

The first prototype uses a small `MethodChannel` contract (`status`, `collapse`, `quit`, and native `state` events) with strict response decoding. Business UI and domain interfaces will remain independent of this channel. No Node sidecar, Electron dependency or C# runtime is required in the new executable. Native Windows integration uses Flutter's C++ host rather than adding a separate language/runtime boundary.

## Delivery order

1. **Current change:** isolated Flutter/native right-edge capability probe, automated hover-policy and channel tests, and native build CI. The existing Electron branch is preserved only as a source of confirmed behavior and test scenarios, not as part of the new runtime.
2. Establish the manual Windows/macOS window acceptance gate. Record actual OS/display configurations and failures; do not mark full support based solely on build success.
3. Port activity domain, schedule and storage rules to Dart, carrying over scenario coverage. Do not migrate user data.
4. Build the calendar/main window, real drawer controls, rest UI, notifications, tray/status item, autostart and lifecycle integration. Finish focus/accessibility handling for each window role.
5. Remove the superseded Electron implementation from the replacement branch, commit production runners, then validate native packaging and updates before merge/release.

PR #1 remains unmerged. A stacked draft branch isolates this architecture change. Neither a compile-green prototype nor an unsigned diagnostic build is a release-ready timer.

## Primary API references

- Flutter desktop and custom native channels: https://docs.flutter.dev/platform-integration/desktop and https://docs.flutter.dev/platform-integration/platform-channels
- Public Windows desktop manager: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager
- macOS fullscreen/Stage Manager joining: https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications
