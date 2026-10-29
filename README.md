# Pomodoro Timer · Native macOS app

A dynamic work schedule that tracks work, breaks and idle time separately. Built for macOS with SwiftUI, an AppKit edge drawer and a pure Swift domain layer. It has no Electron, Flutter or WebView dependency.

The app uses English for menus, reminders, errors and accessibility labels. Dates use English and times use a 24-hour clock, while scheduling follows your local time zone. Earlier built-in templates have English display names; existing configuration identifiers and history remain valid, and custom names stay as entered.

Move the pointer to the right edge of the desktop to slide out the timer. Reminders leave keyboard focus where it is, and you decide when to take a break. When a break ends, the app waits for you to resume; idle time does not count toward your totals.

## Run and build

Download a package from [GitHub Releases](https://github.com/xbghc/pomodoro-timer/releases): choose `macos-arm64.zip` for Apple Silicon or `macos-x86_64.zip` for Intel. Unzip it and move `PomodoroTimer.app` to Applications. Packages are ad-hoc signed and are not notarized by Apple. See the [v2.1.1 release notes](docs/releases/v2.1.1.md) for downloads, checksums and first-launch instructions.

The app requires **macOS 13.0 or later**. Building from source requires **Swift 6.0 / Xcode 16.0 or later**, using Swift 6 strict concurrency. Xcode 16.0 requires a development Mac running **macOS 14.5+**; this is separate from the app's runtime requirement. There are no third-party package dependencies.

```bash
swift test                       # Domain, persistence, deterministic clock and geometry tests
swift run PomodoroTimer           # Development run; use the menu bar or edge handle
./scripts/build-macos.sh          # Build a local release .app
open dist/PomodoroTimer.app
```

You can also open `Package.swift` in Xcode and run `PomodoroTimer`. For testing across Spaces and other apps' full-screen spaces, use the script-built `.app`, which includes the Info.plist settings for an accessory app.

`./scripts/verify.sh` runs tests and compiles the app on macOS. On Linux, it runs core tests and parses native source syntax only. Linux has no SwiftUI/AppKit SDK and cannot build or validate the native interface. See the [verification record](docs/validation.md) for actual results and the [macOS acceptance checklist](docs/macos-acceptance.md) for remaining manual checks.

## Use

- The default work reminder is 30 minutes, followed by a 5-minute break. You can take an early break or choose a custom duration. A work reminder keeps recording work until you end the activity or take a break.
- **Focus for 1 Hour** resets the next reminder from the moment you click, preserving elapsed time and the continuous record. Starting at 10:00, extending at 10:20 and taking a break at 11:20 produces one 80-minute work record.
- Scheduled blocks start and stop automatically. A fixed end time takes priority over an extended reminder. Opening the app during a block starts recording from launch time.
- After a break, recording resumes when you start work manually. The next scheduled work block can also take over.
- The timer window and edge drawer use a 360×190 layout with large countdown digits, a bottom progress line, coral red for work and green for breaks. After a work reminder, the timer shows `+` overtime and continues recording.
- The round primary button starts work while idle and ends the current record during an activity. The adjacent button starts a break during work or starts work during a break. Ending and restarting creates a new activity; hover over a control to read its action.
- Click the menu bar item to open the timer panel, timer window, Calendar & History or Settings. The timer's top-right icon opens Settings; its context menu includes the calendar, custom duration and focus-extension actions. `⌘0` opens the timer, `⌘1` opens the calendar and `⌘,` opens Settings.
- Settings lets you choose today's template, show or hide the menu bar countdown, and open or reload the JSON configuration. Closing a window keeps the app running; **Quit** in the menu bar ends it.
- The calendar separates the read-only plan from actual activity. Add, edit or delete any completed record, including automatically recorded work or breaks. Totals update immediately, and future or overlapping records produce clear errors.

## JSON schedule templates

Click **Open JSON** in Settings or on the **Schedule** tab in Calendar & History. Edit the file externally, then click **Reload**. Future schedules and default durations are configured through JSON. The in-app template selection affects **today only**; it does not change the JSON file or future dates.

The [example configuration](Resources/schedule.example.json) uses 10:00–12:10, 13:30–18:10 and 19:30–22:30. Weekday `0` is Sunday and `6` is Saturday; unspecified weekdays use `defaultTemplate`. The initial mapping is an editable example, not a prescribed weekday, weekend or Friday schedule.

```json
{
  "workMinutes": 30,
  "breakMinutes": 5,
  "defaultTemplate": "Regular day",
  "weekdays": { "0": "Regular day", "1": "Regular day", "2": "Regular day", "3": "Regular day", "4": "Regular day", "5": "Regular day", "6": "Regular day" },
  "templates": {
    "Regular day": [
      { "start": "10:00", "end": "12:10" },
      { "start": "13:30", "end": "18:10" },
      { "start": "19:30", "end": "22:30" }
    ],
    "No fixed hours": []
  }
}
```

Times must use same-day `HH:mm` values, sorted by start time with no overlaps. An empty template supports manual work without fixed hours. Work durations range from 1 to 480 minutes; breaks range from 1 to 240 minutes. Invalid configuration never overwrites your file. Reload keeps the last valid in-memory configuration; invalid configuration at startup pauses recording and offers a repair path.

## Local data

```text
~/Library/Application Support/PomodoroTimerNative/
  schedule.json     # Schedule templates
  activities.json   # All history, today's template override and runtime checkpoint
  .instance.lock    # Prevents concurrent writers
```

History does not expire. Checkpoints are saved every 5 seconds, with immediate saves for actions and activity boundaries. History and runtime state are stored atomically in one JSON file. Normal exit or sleep closes the activity; crash recovery ends at the last saved observation and does not fill in offline time. A failed save blocks further changes. See [design and engineering defaults](docs/design.md) for clock rollback, midnight, daylight-saving time and template-switching behavior.

The native app does not migrate, read or delete old Electron data. The old app's source has been removed from the current tree and remains available in Git history.

## Project structure

```text
Package.swift
Sources/PomodoroCore/       # Configuration, domain model, state machine, persistence and geometry
Sources/PomodoroApp/        # SwiftUI interface and AppKit windows/lifecycle
Tests/PomodoroCoreTests/    # Deterministic tests without real-time waits
Resources/                 # App Info.plist and editable JSON example
scripts/build-macos.sh     # Local .app packaging
scripts/verify.sh          # Platform-aware verification
docs/                      # Design, verification evidence and manual macOS acceptance
```

All maintained documentation, comments, developer-facing output and release notes use English. Unicode escapes are used only for legacy persisted identifiers and multilingual regression fixtures. They preserve old configuration compatibility and verify that non-English system messages do not leak into app-owned text. User-authored content retains its original value.

## Continuous verification

The [Swift workflow](.github/workflows/build.yml) replaces the old Windows/Electron build. The former Storybook/Pages deployment and Electron mirror configuration have also been removed. It runs:

- Linux with Swift 6.0.3: core tests and native source syntax parsing.
- Intel macOS with Xcode 16.0: tests and real SwiftUI/AppKit compilation and linking with the minimum toolchain.
- Apple Silicon macOS with Xcode 16.4: tests and native compilation and linking.
- Both Mac jobs: release `.app` builds with local ad-hoc signatures, signature and architecture checks, and verification of the macOS 13.0 deployment target.

Every Mac build creates a ZIP and verifies executable permissions and signatures after extraction. Ordinary builds keep application packages on the runner. A manually enabled `capture_ui` run uploads real screenshots and diagnostics for 14 days; see the [screenshot acceptance procedure](docs/macos-acceptance.md).

Releases follow the `v*` tag convention. The version must match `Resources/Info.plist`, the tagged commit must already be merged into `main`, and `docs/releases/<tag>.md` must exist. A tag triggers full tests and packaging on both architectures. After both builds succeed, a separate publishing job uses the built-in GitHub token's `contents: write` permission to create a draft, upload both ZIP files and `SHA256SUMS`, download and verify them, and then publish the release. An existing release or draft stops the process; assets are not overwritten. Build jobs retain `contents: read`. The workflow needs no signing credentials, notarization, Pages deployment, paid runners or saved platform-setting changes. CI builds and screenshots do not replace full window-interaction testing or execution on macOS 13.
