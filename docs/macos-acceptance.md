# macOS interaction acceptance checklist

Full manual acceptance is still pending. The app requires macOS 13.0 or later. Source builds require Xcode 16.0 / Swift 6.0 or later, using Swift 6 language mode; a development Mac running Xcode 16.0 requires macOS 14.5 or later. On a Mac meeting those toolchain requirements, run:

```bash
./scripts/verify.sh -Xswiftc -warnings-as-errors
./scripts/build-macos.sh debug
open dist/PomodoroTimer.app
```

The build script creates a local app only; it does not upload, notarize or publish it. The local executor is still Linux. On 2026-10-29, v2.1.1 passed native builds and real UI capture on both Mac architectures, producing 14 screenshots per architecture; see the [verification record](validation.md). These screenshots cover the recorded single-display operations. The Spaces, focus, system behavior and minimum-OS checks below still require full manual acceptance.

## Real UI screenshots and core operations

Manually run the workflow on the intended branch with `capture_ui` enabled. The script reads the session, displays and existing permissions, launches the release `.app` built in that run, and operates existing controls with Accessibility `AXPress` and real pointer movement. It launches the English app with process-only Chinese language preferences and the `zh_CN` locale, then checks that the interface stays in English. It does not alter system language or saved preferences. At each step it checks the observed accessibility tree for Chinese UI text. TCC, security permissions and the app's data model are not modified; unsupported environments stop with diagnostics.

```bash
gh workflow run build.yml --ref "$(git branch --show-current)" -f capture_ui=true
```

| Image | Operation and expected result |
| --- | --- |
| `01-main-work.png` | Open the 360×190 timer, click Start work, and observe red controls, a work countdown and elapsed work time. |
| `02-main-rest.png` | Click Take a 5 min break and observe green controls and the break countdown. |
| `03-main-waiting.png` | Click End activity to enter idle. This captures a manual end, not natural break expiration. |
| `04-desktop-drawer-collapsed.png` | Restart work manually and move away from the handle; the edge window collapses to 12×92. |
| `05-drawer-work.png`, `06-desktop-drawer-expanded.png` | Move the pointer onto the handle; the actual window expands to 360×190. Capture both the window and its desktop placement. |
| `07-drawer-rest.png` | Start a regular break and capture the drawer in the break state. |
| `08-settings.png` | Click the timer's settings icon to open the separate 480×520 window with default durations, today's template and the menu bar toggle. |
| `09-calendar.png` | Open Calendar & History from Settings and inspect the read-only plan and actual records created during the run. |
| `10-record-editor.png` | Open Add Record, inspect English labels, native date controls and buttons, then cancel without saving. |
| `11-current-session.png` | Open Now and check current-activity, schedule and statistics text. |
| `12-custom-duration.png` | Open Custom work duration, inspect the minute-entry sheet, then cancel without starting work. |
| `13-templates.png` | Open Schedule and inspect today's template selection and the JSON configuration entry point. |
| `14-menu-bar.png` | Click the real menu bar item and capture the 248 pt timer panel and actual menu bar digits. |

Artifact names include the runner and commit SHA and are retained for 14 days. `manifest.json` records the source commit, workflow run, architecture, application binary hash and PNG hashes. Every image comes from the system `screencapture` tool. If permissions or window discovery fail, diagnostics and any completed screenshots are still saved. The script runs only on disposable GitHub runners, refuses to interact with an existing app instance, and cleans up only the processes it launched.

Screenshots and one hover check do not prove acceptance across Spaces, other apps' full-screen spaces, keyboard focus, multiple displays or sleep integration. Deterministic tests for natural break completion, extended focus, fixed deadlines and history CRUD also do not replace the corresponding UI checks.

## Windows and focus

- [ ] First launch shows the menu bar item and edge handle without switching away from the app receiving keyboard input.
- [ ] Run the built app on macOS 13.0 to verify minimum-OS support, then repeat on a newer release. A CI runner's OS cannot substitute for macOS 13 execution.
- [ ] Keep typing in an editor while moving the pointer onto the right-edge handle. The drawer expands, focus stays in the editor and typing continues uninterrupted.
- [ ] Move away to collapse the drawer. The formerly expanded area immediately passes clicks to the app underneath, while the edge handle remains responsive.
- [ ] Repeated rapid crossings do not flicker; buttons work on the first click. Reduce Motion disables window animation.
- [ ] Switch between Spaces. The drawer remains reachable without returning the user to the original Space.
- [ ] In Safari, an editor and a video app's ordinary native full-screen space, hover still opens the drawer without leaving full screen or stealing focus.
- [ ] Test with Displays have separate Spaces both enabled and disabled: multiple full-screen displays, negative coordinates, vertical layouts, mixed scaling and display hot-plugging.
- [ ] Check reachability with a right-side or bottom Dock, Dock auto-hide and Stage Manager. Record OS version and layout for any conflicting system edge behavior.
- [ ] A due reminder expands the drawer once. Collapsing it preserves the due state and ongoing work; later ticks do not expand it again.
- [ ] Timer and Settings retain working native close controls. The timer can be minimized and dragged; closing it keeps recording. `⌘0`, `⌘1` and `⌘,` open their respective windows.
- [ ] Work, break, idle, overtime and error states have no overlapping text. A custom 480-minute duration scales long digits to fit while keeping controls clickable.
- [ ] Icon buttons support Tab/Space and show focus. VoiceOver reads the remaining time, state and action. The drawer does not take keyboard focus; keyboard operations use the timer window or menu panel.
- [ ] Clicking the menu bar item opens the panel; an outside click or Escape closes it. Controls work while another app is active.
- [ ] The menu bar countdown toggle applies immediately and survives restart; the icon remains usable with digits hidden. The timer keeps the design's readable light palette in system dark appearance.
- [ ] Calendar & History supports entering and pasting dates/minutes. Custom-duration and record-editing sheets are not constrained by the 360×190 timer window.

## Activities and calendar

- [ ] Defaults are 30/5; the regular template ends at 12:10, 18:10 and 22:30.
- [ ] Start at 10:00, extend focus for one hour at 10:20, and receive the reminder at 11:20. Taking a break produces one 80-minute work record.
- [ ] If a planned end precedes an extended reminder, recording stops at the fixed end.
- [ ] Test early breaks, custom minutes, idle after a break and manual resume with a full 30 minutes. Idle time never enters statistics.
- [ ] Work, break and idle states have no full-screen break entry in the main window, drawer or menu bar. Starting a regular break changes only the timer state and never overlays other apps or displays.
- [ ] Now shows remaining break time. Natural break completion reminds once and enters idle. Records and totals stop growing until Start work is clicked; the next fixed start still follows the schedule.
- [ ] The calendar clearly separates the read-only plan from actual activity. Adding, editing and deleting automatic or manual records updates totals immediately.
- [ ] Future, overlapping or active-activity-conflicting records are rejected with English explanations. Unedited seconds and milliseconds remain unchanged.
- [ ] Records crossing midnight are clipped separately for each day. Display and statistics follow the actual day length across daylight-saving transitions, including half-hour shifts.

## Configuration, storage and lifecycle

- [ ] Changing today's template affects only today; the next day uses its weekday mapping. Editing JSON does not rewrite actual history.
- [ ] Valid JSON edits take effect on reload. Invalid JSON preserves the last valid in-memory configuration and does not overwrite the edited file.
- [ ] Startup with invalid JSON reports a clear error and allows opening the file for repair and retry.
- [ ] Sleep/wake and normal exit/restart exclude offline time. Launching partway through a block records only from the current time.
- [ ] After force termination, recovery ends at the last successful checkpoint, targeting a 5-second save interval, without duplicate IDs or records.
- [ ] Clock rollback, time-zone changes and disk write failures safely stop or reconcile recording without invalid statistics. Repaired storage can be reloaded.
- [ ] Launching twice leaves only one data writer; the second instance opens the existing main window.
- [ ] Old Electron files remain untouched; the native app uses only its separate Application Support directory.

## CI verification path

The [workflow](../.github/workflows/build.yml) runs tests, compilation and linking on standard `macos-15-intel` / Xcode 16.0 and `macos-15` / Xcode 16.4 runners. It runs `build-macos.sh release` and checks the local ad-hoc signature, Mach-O architecture and `minos 13.0`. Linux uses Swift 6.0.3. The former Windows release and Storybook/Pages deployment have been removed.

Ordinary verification jobs have repository read access. Optional UI capture uploads screenshots and diagnostics. With merge/release authorization, a tag run uploads both architecture ZIPs and checksums; a separate job publishes the GitHub Release after all checks pass. No notarization, signing secrets, paid services or saved platform changes are required. Extracted ZIP signatures, executable permissions and architectures are verified as well. Passing CI does not complete the remaining window and system-behavior checks above.
