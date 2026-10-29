# Final source review

On 2026-10-21, changes after `3eec263` were reviewed along with all Swift source, tests, packaging scripts, Info.plist and the workflow. The executor was Linux. This was source review and runnable core verification, **not macOS SDK type-checking or application acceptance**.

On 2026-10-22, after full-screen breaks were removed as requested, the main-window/drawer actions, model callbacks and lifecycle references were reviewed again. The multi-display break windows, their display state, screen-change handling and exit/sleep cleanup were removed. Regular break reminders and the drawer's behavior in other apps' full-screen spaces were retained. See the [verification record](validation.md) for the rerun.

Branch push and remote CI were subsequently authorized. Actual Xcode 16.0 / 16.4 builds supplemented the Linux review and revealed the CoreGraphics import and lipo argument issues below. CI results and manual interaction acceptance remain separate records.

## Confirmed issues and fixes

| Area | Issue and result |
| --- | --- |
| Boundary reminders | History CRUD discarded reminder events from its internal tick, potentially marking a reminder as sent without displaying it. Successful transactions now return and deliver their events, covered by clock-driven regression tests. |
| Actions coinciding with reminders | Starting a break, stopping, pausing or switching templates at a work deadline could show an obsolete break reminder. Events are now filtered against the final activity state. |
| Break display | When a fixed end preceded the break deadline, the countdown still showed the full break remainder. It now uses the earlier deadline and includes takeover by the next fixed start; safety pauses freeze the display. |
| Half-hour daylight-saving transitions | A Lord Howe test reproduced Linux Foundation `.nextTime` moving a nonexistent 02:10 to the next day, dropping the planned block. The resolver now searches minute by minute for a valid time on the same day and selects the first repeated hour. Calendar height no longer rounds a 23.5-hour day down. |
| Checkpoint validation | Finite but extreme corrupt dates could reach Calendar, and expired activities/inconsistent reminder flags were not fully rejected. Validation now bounds the calendar range and checks deadlines and reminder flags against the observation. |
| Concurrency and callbacks | All targets use Swift 6 strict concurrency. Drawer delays use cancellable MainActor Tasks; system notifications use synchronous main-queue bridges so sleep checkpoints are not delayed by an async hop. Distributed show-window notifications explicitly hop to MainActor. |
| Focus and collapse | The drawer retains nonactivatingPanel and cannot become a key/main window. Repeated hover does not restart animation; Space/display changes can collapse it based on pointer position. Activation occurs only when the user opens the main window, with separate macOS 13 and 14+ API handling. |
| CI | Windows releases, Storybook/Pages deployment and Electron npm mirror settings were removed. Linux core tests and Intel minimum-toolchain / Apple Silicon native builds were added. Optional steps upload real screenshots. Authorized tag publishing uploads both verified ZIPs and publishes only after downloading and checking them. Build jobs are read-only; only the publishing job uses the built-in token's `contents: write`, with no signing secrets or saved remote-setting changes. |
| macOS geometry API | Foundation on Apple platforms did not expose the full Swift CGRect interface and Equatable conformance needed by the code, causing the first Mac build to fail. Geometry source and tests now explicitly import CoreGraphics under `canImport(CoreGraphics)`; Linux continues to use Foundation geometry. |
| Architecture verification | `lipo -verify_arch` treated the following filename as another architecture. The binary path now precedes the option; actual architecture, Mach-O `minos` and the Info.plist deployment target remain strictly checked. |

## Review coverage and evidence limits

- **SwiftUI types and APIs:** Reviewed View builder branches, `@State`/`@ObservedObject`, DatePicker, Form, color/shape styles, menus, sheets, calendar coordinates and integer/CGFloat conversions. [GroupedFormStyle](https://developer.apple.com/documentation/swiftui/groupedformstyle) is available from macOS 13; other used SwiftUI features do not raise the runtime requirement. Subsequent Mac CI performed actual native type-checking and linking; see the [verification record](validation.md).
- **AppKit APIs:** Checked [NSTrackingArea initializer arguments](https://developer.apple.com/documentation/appkit/nstrackingarea/init(rect:options:owner:userinfo:)), NSPanel/NSWindow properties and collection behaviors. Syntax parsing was not treated as evidence of SDK linking.
- **Actor isolation:** Checked MainActor declarations for `applicationDidFinishLaunching` and `menuWillOpen` in Apple's documentation; UI owners share that isolation. The local Swift 6.0.3 `_Concurrency.swiftinterface` declares `MainActor.assumeIsolated` available from macOS 10.15; it is used only in callbacks guaranteed by `queue: .main`. Linux core and remote Xcode 16.0 / 16.4 native targets passed Swift 6 builds with warnings-as-errors. Runtime system callbacks still require hardware acceptance.
- **Time and persistence:** Reviewed fixed-end priority, continuous records, idle after breaks, local day boundaries for template overrides, midnight clipping, 23/25/23.5-hour days, rollback write protection, normal sleep/exit, crash checkpoint recovery, atomic files and stable IDs. Added coverage confirms that a crash during a break cannot backfill time to the originally planned break end.
- **Window behavior:** The collapsed NSPanel is actually 12×92; placement chooses the physical outer screen edge and supports negative coordinates. Hover, reminders and Space changes never activate the app. Spaces, other apps' full-screen spaces, Dock, Stage Manager, mixed scaling and focus still require real-machine acceptance.

## Minimum versions and CI choices

- App deployment/runtime minimum: **macOS 13.0**, consistent across Package.swift, Info.plist and CI Mach-O checks. Execution on the minimum OS remains unverified.
- Compiler minimum: **Swift 6.0 / Xcode 16.0**; Package.swift selects `.v6`.
- Development Mac: Xcode 16.0 requires **macOS Sonoma 14.5+**. This is a tool requirement, not the app runtime minimum. See [Apple's Xcode system requirements](https://developer.apple.com/xcode/system-requirements/).
- CI uses standard `macos-15-intel` and `macos-15` runners with Xcode 16.0 and 16.4 respectively. [GitHub runner labels](https://github.com/actions/runner-images#available-images) and the [Xcode installation list](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md) were checked; no large/xlarge or self-hosted service is used. Xcode selection uses only the job-level `DEVELOPER_DIR` environment variable.

See the [verification record](validation.md) for actual test counts, commands and remaining gaps. The [macOS acceptance checklist](macos-acceptance.md) retains every outstanding native check.
