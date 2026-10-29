# Native macOS implementation and time semantics

The native rewrite started from `0931ff38` on `codex/macos-swiftui-rewrite`. The product is a dynamic work schedule. Earlier Electron behavior, Flutter feasibility work and Activity v2 defaults are historical context rather than requirements for this implementation.

## Confirmed product rules

- The activity states are work, break and idle. Only actual work and break time count toward statistics.
- Defaults are 30 minutes of work and 5 minutes of break. Work reminders are stored separately from activity intervals. A reminder fires once and work continues; taking a break or stopping closes the work record.
- Starting at 10:00 and extending focus by 60 minutes at 10:20 gives an 11:20 reminder. Taking a break then produces one 80-minute record. A fixed schedule end takes priority.
- Early breaks and custom durations are supported. The next work activity starts with the full default duration. A completed break enters idle without automatically starting work.
- JSON defines daily templates, weekday mappings and default durations. The regular example uses 10:00–12:10, 13:30–18:10 and 19:30–22:30. In-app selection overrides today's template only. Weekday, weekend and special Friday arrangements were not confirmed; the initial mapping is an editable example rather than a claimed user preference.
- Fixed starts automatically begin work; fixed ends stop the current activity and prompt the user. Launching partway through a block records from the current time without backfilling earlier time.
- The calendar separates read-only plans from editable actual records. All completed records can be added, edited or deleted, including automatically generated records. Plan edits do not alter actual history.
- Data does not expire or clear automatically. Time spent asleep, exited or otherwise offline is excluded and can be added manually. The native app does not read, migrate or delete old Electron files.
- The edge drawer is the primary interaction. Hover and reminders do not request keyboard focus. Breaks are controlled through the drawer, timer window or menu bar; the timer shows remaining time. There are no journal/next-step forms or external integrations.

## Engineering defaults

These are explicit implementation choices; not all were confirmed word for word by the user:

1. Intervals use `[start, end)`. Adjacent intervals are valid; overlapping, future or zero-length actual records are rejected. Edits preserve the record ID and unchanged millisecond values. An active activity must end before editing.
2. A scheduled start takes over a break that extends into the block. Manual work crossing into a scheduled block stays in the same record and acquires that block's fixed end.
3. Changing today's template within a work block updates the fixed end without splitting the record or resetting the reminder. If the new template no longer covers the current time, recording stops at the switch. Moving from an empty period into a valid block starts from the current time. Switching templates or reloading JSON while already idle in the same block does not bypass manual resume.
4. Plans are calculated from the current JSON; immutable historical schedule snapshots are not stored. Today's override expires at the local day boundary. Actual history remains indefinitely.
5. Manual work outside scheduled hours can cross midnight without an automatic daily split. Statistics clip intervals to local day boundaries.
6. Normal exit or sleep closes the activity. Startup or wake begins a new activity from the current time if a work block is active; otherwise it remains idle. An activity from before sleep never spans the offline interval.
7. Observation checkpoints target a 5-second interval; user actions and boundary changes save immediately. Crash recovery settles only to the last successfully saved observation, without offline backfill. Recovery precision depends on successful checkpoint writes; scheduling delays or write failures can lose more than 5 seconds. Stable activity IDs and a single atomic file keep history and checkpoint state consistent. A process lock prevents concurrent writers.
8. When a timer tick is late, known schedule or break deadlines settle at their exact boundaries. Fully missed blocks create no activity. If a new block is still active, recording begins no earlier than the current observation. AppKit sleep notifications explicitly close the interval before sleep.
9. If the system clock precedes the last observation or the end of history, the activity closes at the last observation and enters a safe waiting state. Once the clock is corrected or catches up, the current fixed block can resume. Activity, history and configuration mutations are blocked while paused.
10. Invalid JSON preserves the last valid in-memory configuration and the original file. Invalid configuration at startup blocks recording explicitly. Corrupt history reports an error instead of silently becoming empty. A write failure blocks further changes and allows reloading after repairing the file or disk.
11. Scheduling uses the local system time zone. For nonexistent daylight-saving times, search minute by minute for the next valid time on the same day; for repeated times, choose the first occurrence. A block is omitted if it collapses to zero length or has no later valid time that day. Statistics and calendar height use Calendar day boundaries, including 23-, 25- and 23.5-hour days. A time-zone change settles the old activity before observing the new local time.
12. Gentle reminders briefly expand the drawer for 6 seconds, update the due state and update the menu bar. The app does not request notification, Accessibility or screen-recording permissions. Reminders do not repeat continuously or enforce breaks. Closing the timer window keeps the app running.
13. When a history edit coincides with a reminder boundary, a committed transaction still delivers the reminder event. Taking a break, stopping or choosing an empty template suppresses an obsolete work reminder. The break countdown uses the earliest of its own deadline, the fixed end or the next scheduled work start.
14. Persisted dates must lie within Foundation's `distantPast` through `distantFuture` calendar range. Checkpoints cannot retain expired activities or reminder flags inconsistent with the observation time. Corrupt data is rejected before calendar calculations.

## Structure

| Layer | Files | Responsibilities |
| --- | --- | --- |
| Configuration and scheduling | `Configuration.swift` | Strict JSON validation, template selection, local day and schedule boundaries |
| Domain data | `Activity.swift` | Activities/checkpoints, history constraints and daily clipped statistics |
| State machine | `ActivityEngine.swift` | Explicit time inputs, reminders, schedule takeover, idle, sleep/recovery and rollback protection |
| Application services | `Persistence.swift` | Injected clocks and storage; save candidate state before committing it; transactions and 5-second checkpoints |
| Geometry | `DrawerGeometry.swift` | Outer-screen placement and two real window sizes, testable on Linux |
| Timer presentation | `TimerReadout.swift` | Countdown, fixed-end and break-takeover display without activity-state mutations |
| English presentation | `EnglishFormat.swift`, `UserFacingError.swift` | English date/time formats and application-owned error messages |
| SwiftUI | `TimerView.swift`, `MenuBarView.swift`, `SettingsView.swift`, `Theme.swift` | Shared compact timer, menu bar panel, separate settings and visual styles |
| Calendar and history | `MainView.swift`, `HistoryView.swift` | Current activity, custom duration, today's template, planned/actual calendar and record editing |
| macOS host | `PomodoroApp.swift`, `AppModel.swift` | Single instance, menu bar, windows, sleep/wake and time-zone notifications |
| Native windows | `DrawerController.swift` | Hover drawer, Spaces behavior and real hit area |

The domain library uses Foundation. Geometry explicitly imports CoreGraphics on Apple platforms and uses Foundation's geometry types on Linux. The app depends on SwiftUI/AppKit; all targets use Swift 6 language mode. Views, window controllers and the app model run on MainActor. System notifications are delivered explicitly to the main queue; sleep callbacks save synchronously, and delayed drawer collapse uses a cancellable MainActor Task. On non-macOS platforms, Package.swift declares only the domain library and tests.

## Windows and hardware verification limits

The drawer is an `NSPanel` with [nonactivatingPanel](https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.struct/nonactivatingpanel). It cannot become a key or main window and uses `NSTrackingArea.activeAlways` to detect hover while the app is inactive. The `LSUIElement`/accessory mode, [canJoinAllSpaces](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces) and [fullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary) settings support Spaces and other apps' ordinary full-screen spaces. A Space change repositions the drawer and calls `orderFrontRegardless` without activating the app.

The expanded window is 360×190; the collapsed window itself is 12×92, without a transparent full-size hit area. Display removal or resolution changes recalculate the outer right edge to avoid display seams where possible. Explicitly opening the main window may acquire focus.

## 2026-10-29 design adaptation

The user's HTML design supplies the compact layout: a 360×190 timer, a 248 pt menu bar panel and a 480×520 settings window. Colors are `#F0F0F2` for the background, `#1C1C1E` for primary text, `#6E6E73` for secondary text, `#DCDCE1` for dividers, `#E8513F` for work and `#16956B` for breaks. The native system font from the design's font stack is used, with thin 72/52 pt monospaced timer digits and slightly negative tracking. There are no external fonts or WebViews. The timer uses real AppKit window controls, while a separate Calendar & History window retains full record editing.

The design's pause/resume behavior, long break after four rounds, full-screen breaks, sound and launch-at-login options are outside this UI change. The model has work, break and idle states, reflected by the three status dots. During an activity, the primary button has an explicit stop icon; restarting after ending a record grants the full default duration. JSON still controls default durations and future schedules; Settings displays durations as read-only values. The menu bar countdown toggle persists in UserDefaults without modifying the activity file.

The work countdown uses the earlier of the reminder or fixed end. After the reminder, it shows `+MM:SS` overtime and keeps recording work. Breaks use the engine's actual deadline, including takeover by the next scheduled work start. Bottom progress measures the current continuous activity from its start to the current target. Extending a reminder recalculates that target without splitting the record. Idle shows the next default work duration. On a write failure or clock rollback, the display freezes at the last observation, and the error control opens full details. Icon controls provide accessible names, hover descriptions and keyboard focus feedback; additional actions are available in context menus and the calendar window.

These API settings and geometry tests do not constitute full macOS window acceptance. Other apps' full-screen spaces, Stage Manager, a right-side Dock, mixed display scaling, independent display Spaces and OS-version differences require the acceptance checklist on real hardware. Protected system and login screens are outside the supported scope.

## English language policy

The interface, dates, app-owned errors, documentation, source comments, script output and release notes use English. Presentation uses an explicit English locale with 24-hour time, preserving the scheduling calendar and local time zone. Old built-in template identifiers are matched through Unicode escapes and mapped to English display names without changing stored keys. Regression fixtures retain escaped multilingual values to test compatibility and prevent localized system errors from leaking into the interface. Custom template names and other user-authored data are preserved.
