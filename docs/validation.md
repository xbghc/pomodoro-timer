# Verification record

Entries describe the state at the time of each run. Historical statements such as "not yet pushed" or "CI not run" are not statements about the current repository. The historical narrative and console summaries below have been translated into English; dates, commit IDs, run links and outcomes are preserved.

## 2026-10-29: English across the repository

Translated README, design and review documents, the macOS acceptance checklist, verification history, earlier release notes and build-script messages. All 43 tracked files passed a scan for CJK text. Relative Markdown links resolve, the README JSON matches the shipped example, and historical source links and commit references remain intact.

Legacy template identifiers and multilingual test fixtures now use Unicode escapes. Decoding the production escapes and removing the explanatory comment reproduces the previous configuration source exactly. Existing compatibility tests still verify unchanged configuration bytes, template selection and user-defined names; the app's runtime behavior and version remain at v2.1.1.

The temporary Swift 6.0.3 toolchain ran `scripts/verify.sh` with `/tmp/pomodoro-ui-*` build/cache paths and `-Xswiftc -warnings-as-errors`: **70 tests passed, 0 failures**, followed by native source syntax parsing. All shell scripts passed `bash -n`, and `git diff --check` passed. The Linux build guard returned the expected exit code 1 with an English diagnostic. Temporary test log: `/tmp/pomodoro-english-project-verify.log`. These local checks do not constitute a new native UI capture; the versioned UI evidence is recorded below.

## 2026-10-29: v2.1.1 English UI and both architectures passed

[Run 40851510330](https://github.com/xbghc/pomodoro-timer/actions/runs/40851510330) succeeded for source commit `325a546e594ca8a8be5adb37622a0715546b1f68`. Linux / Swift 6.0.3, Intel / Xcode 16.0 and Apple Silicon / Xcode 16.4 each passed **70 tests with 0 failures**. Both Mac jobs completed SwiftUI/AppKit compilation, linking, release packaging, ad-hoc signing, ZIP extraction checks, architecture checks and `minos 13.0` verification.

Both Macs launched the app with process-only Chinese language preferences (`zh-Hans`, `zh_CN`), each producing **14 real screenshots** with a `passed` manifest. The capture script checked the observed accessibility trees for Chinese UI text. Both artifact digests and all 28 PNG SHA-256 hashes were verified after download. Every ARM screenshot was visually reviewed; Intel spot checks covered the main timer, Settings, record editor, custom-duration sheet and menu bar. No text truncation or overlapping controls were observed. Dates, native date-editing controls and sheets displayed English.

Five new tests cover English dates with the local time zone, legacy template identifiers and selections, display-name collisions, custom-name preservation, and English messages for system errors and JSON field errors. Loading old configuration does not rewrite the file, and existing records and custom content remain intact. The local run also passed all 70 tests, native source and helper-script syntax checks, and `git diff --check`.

System language, saved preferences and security permissions were not changed. Results cover only the recorded single-display operations. macOS 13 execution, Spaces, multiple displays and sleep integration still require the [acceptance checklist](macos-acceptance.md). Subsequent release preparation updated documentation only; product source matched the successful screenshot run.

The [v2.1.1 release run](https://github.com/xbghc/pomodoro-timer/actions/runs/40852799475) subsequently passed on commit `c2b3f8e44a56f5b86884320edcb193b10842cf56`. Both published packages were downloaded and checked for SHA-256, version 2.1.1/build 3, English-only bundle localization, architecture and executable permissions.

## 2026-10-29: v2.1.0 native builds and screenshots passed

After the user requested publication, verification-branch [run 40845616588](https://github.com/xbghc/pomodoro-timer/actions/runs/40845616588) succeeded on source commit `8b55c2fd30d517f2d007f56a9a2f5c228de1c209`. Linux, Intel / Xcode 16.0 and Apple Silicon / Xcode 16.4 each passed 65 tests. Both Macs completed SwiftUI/AppKit compilation, linking, release packaging, ad-hoc signing, architecture checks and verification of the macOS 13.0 deployment target.

Each architecture produced 11 real window/desktop screenshots with a `passed` manifest. Artifact digests and all 22 PNG SHA-256 hashes were verified after download. Every ARM image was reviewed; Intel spot checks covered the timer, work drawer, Settings and menu bar panel. No text truncation or overlapping controls were observed. Real operations confirmed work/break/idle switching, hover expansion from 12×92 to 360×190, opening the calendar and templates from the 480×520 Settings window, and opening the menu bar panel. Security permissions were unchanged. Natural break completion, Spaces, multiple displays and the minimum OS remained manual acceptance items.

The first two attempts identified a missing SwiftUI `AXLink` role in the capture helper and the SDK's lack of a `kAXLinkRole` constant. The final helper uses the observed role string. Real screenshots also led to a small right-alignment fix for the Settings toggle. Later publication preparation changed only verification and release documentation; application code matched the successful capture run.

## 2026-10-29: design adaptation, local verification

The four user-supplied HTML views informed a native 360×190 timer/drawer, 248 pt menu bar panel and 480×520 Settings window. Calendar and history editing moved to a separate window. Native fonts and AppKit controls were used, without the HTML bundler, font downloads or WebView. Work/break/idle and persistence rules stayed unchanged. The new presentation-only `TimerReadout` handles countdown, overtime and progress.

- Ran `scripts/verify.sh` with a temporary Swift 6.0.3 toolchain, `/tmp/pomodoro-ui-*` build/cache paths and `-Xswiftc -warnings-as-errors`. **All 65 XCTest tests passed, 0 failures.** Seven new tests cover idle, reminder extension, continued recording after a reminder, second rounding, fixed deadlines and takeover of a break by the next block. The original 58 tests remained passing.
- Native app source and the Swift capture helper each passed `swiftc -frontend -parse -swift-version 6 -target arm64-apple-macosx13.0`. The Python capture script passed AST parsing, and `git diff --check` passed.
- The Mac capture script was updated for real button names, three separate windows, the new drawer size, Settings and menu bar captures. **It was not run on a Mac in this local stage, and no native screenshots were produced.**
- The executor was Linux without a SwiftUI/AppKit SDK. Native type-checking, linking, window launch and visual acceptance were not performed in this stage. CI from 2026-10-22 applies only to its own commit and cannot validate these UI changes. Outstanding checks are in the [acceptance checklist](macos-acceptance.md).

At this point, changes remained in the working tree without a push, release or remote CI run. Temporary log: `/tmp/pomodoro-ui-verify.log`.

## 2026-10-22: complete real screenshots and release preparation

[Run 39727287792](https://github.com/xbghc/pomodoro-timer/actions/runs/39727287792), commit `3bdca592528b38d6e25e3ad6680d93df32fbd801`: Linux, Intel and ARM passed all 58 tests; both Macs passed native compilation, linking, release packaging and deployment-target checks. Each architecture produced nine actual window/desktop screenshots. All downloaded images were checked against SHA-256. Every ARM image was visually confirmed; Intel spot checks covered the main window and expanded drawer. Real pointer movement expanded the drawer from 12×92 to 348×304, without security-permission changes. The idle image came from ending a break manually, so it did not establish UI acceptance of natural break completion.

The user subsequently authorized the v2.0.0 release flow. PR and main Mac builds create ZIPs and verify their extracted contents. After all tests and both architectures pass, a tag run creates a draft Release, uploads both ZIPs and SHA256SUMS, downloads and verifies them, and finally publishes. Actual release outcomes are recorded by the corresponding tag's GitHub Actions and Release. The new publishing automation does not change application business logic. Historical "not yet pushed/merged/published" statements refer to their individual entry dates.

## 2026-10-22: real GUI detection and capture path

[Run 39725980405](https://github.com/xbghc/pomodoro-timer/actions/runs/39725980405), commit `4aaa724d52fbf3e111d5dd69988a520e5ab5aea0`: Linux, Intel and ARM all passed. Both Macs had actual logged-in graphical sessions and existing screenshot, Accessibility and event-posting permissions. The release `.app` was launched and its main window captured. The ARM image was downloaded and visually confirmed as this SwiftUI implementation, with an 860×688 window on a 1024×768 runner display. The Intel display was 1920×1080. Security permissions and platform settings were unchanged.

An earlier probe incorrectly treated the symbol name `kCGSessionOnConsoleKey` as the dictionary key and exited early. Using the SDK constant reported `onConsole` as true. That script bug was not evidence that the runners lacked a GUI.

The expanded optional `capture_ui` step uses existing buttons and real pointer movement to capture work, regular breaks, idle, collapsed/expanded drawer, calendar and templates. Each artifact's `manifest.json` records the image list, hashes and execution outcome. The [procedure and limits](macos-acceptance.md) distinguish real screenshots, single-display smoke operations and remaining manual acceptance. App source was not replaced with a mockup or injected with demonstration state for capture.

## 2026-10-22: authorized push and real macOS CI

After push authorization, the separate `codex/macos-swiftui-rewrite` branch was pushed with an ordinary fast-forward. The first remote SHA was verified as `181363ce4058f406bfeae18ed4a6f3f0e901ba85`; every later fix's remote SHA was also checked. There was no forced overwrite, merge to main, version publication or change to saved platform settings at this stage.

The verified code/workflow commit was [`4ccc2999343056543a0201be28fc5304c91ec6cf`](https://github.com/xbghc/pomodoro-timer/commit/4ccc2999343056543a0201be28fc5304c91ec6cf). [CI 39724598328](https://github.com/xbghc/pomodoro-timer/actions/runs/39724598328) completed with overall **success**:

| Environment | Actual result | Evidence |
| --- | --- | --- |
| Linux / Swift 6.0.3 | All 58 XCTest tests passed; native files were syntax-parsed only | [Linux job](https://github.com/xbghc/pomodoro-timer/actions/runs/39724598328/job/119645525877) |
| Intel Mac / Xcode 16.0 / Swift 6.0 | All 58 tests passed; SwiftUI/AppKit debug compilation/linking, release `.app` packaging, Info.plist and ad-hoc signature checks passed; Mach-O `x86_64`, `minos 13.0`, SDK 15.0 | [Intel job](https://github.com/xbghc/pomodoro-timer/actions/runs/39724598328/job/119645525994) |
| Apple Silicon Mac / Xcode 16.4 / Swift 6.1.2 | All 58 tests and the same native compilation/linking, release packaging, Info.plist and signature checks passed; Mach-O `arm64`, `minos 13.0`, SDK 15.5 | [ARM job](https://github.com/xbghc/pomodoro-timer/actions/runs/39724598328/job/119645526009) |

All Swift targets used Swift 6 language mode and warnings-as-errors. Native CI ran macOS 15.7.9. Passing a deployment-target check **does not mean** the app was launched on macOS 13. This run did not launch the GUI, test Spaces/focus/multiple displays or create screenshots. It did not upload the app, use signing secrets, notarize or publish.

CI found and led to two fixes:

1. [First run](https://github.com/xbghc/pomodoro-timer/actions/runs/39724119540): Linux passed; ARM compilation failed because the Swift geometry interface required CoreGraphics. Intel was superseded and canceled. Commit `b5cb8a9` added conditional CoreGraphics imports to geometry source and tests; all 58 local Linux tests passed again.
2. [Second run](https://github.com/xbghc/pomodoro-timer/actions/runs/39724379941): both Macs passed 58 tests, native compilation, linking, packaging and signing, but `lipo -verify_arch` parsed the trailing binary path as an architecture. Commit `4ccc299` reordered arguments and set an explicit Swift workflow run title. The third run passed completely.

The local executor remained Linux. CLI builds had the Mac evidence above, while native window behavior, sleep/wake and single-instance interaction, macOS 13 execution and UI screenshots were still pending at this stage; see the [manual checklist](macos-acceptance.md). The following entries retain local history from before push authorization.

## 2026-10-22: removal of full-screen breaks

Started on `codex/macos-swiftui-rewrite` at `1049da7` with a clean working tree. No additional AGENTS.md or repository skills were found. The executor was Debian GNU/Linux 13 x86_64 without a macOS SDK or `xcodebuild`. The previous temporary toolchain was absent in the new environment, so the same official Swift 6.0.3 toolchain was downloaded to `/tmp/pomodoro-swift-toolchain` without changing saved platform settings.

- Removed the multi-display break-window source, full-screen entries in the main window/drawer, dedicated model callbacks and parameters, and corresponding exit/sleep/display/state-refresh handling.
- Domain states and persistence formats stayed unchanged. Regular break-completion events and countdowns still serve the main window and drawer. Existing deterministic tests were strengthened to verify one reminder, no record/statistic growth while idle, and manual resume from the click with a full 30-minute duration.
- Used the `verify.sh` command below with `/tmp` caches, Swift 6 language mode and `-Xswiftc -warnings-as-errors`. Exit code **0**, 2026-10-22 04:25:39 UTC: **58 XCTest tests, 0 failures, no compiler warnings**. Suite counts remained 29 / 9 / 17 / 3. Temporary full log: `/tmp/pomodoro-remove-fullscreen-verification.log`.
- Native source passed `swiftc -frontend -parse`, **syntax only**. `bash -n scripts/verify.sh scripts/build-macos.sh` and `git diff --check` passed.
- Source search found no full-screen break entry, controller or dedicated callback references. The drawer retained `.fullScreenAuxiliary` to remain accessible in other apps' full-screen spaces, as designed.
- README, design, static review and macOS acceptance documentation were updated, including a manual check that regular breaks never overlay other apps or displays.

macOS SDK type-checking, linking, packaging and native UI acceptance **had not yet run**. Linux cannot run SwiftUI/AppKit. See the [macOS acceptance checklist](macos-acceptance.md). This was a platform limitation, not a permission denial. There was no push, merge, release or remote CI trigger in this stage, and the CI file and saved platform configuration were unchanged.

## 2026-10-21: native rewrite and static review

Date: 2026-10-21. Environment: Debian GNU/Linux 13, x86_64. Working directory: `/workspace/pomodoro-timer`.

### Baseline and scope

- Started on `work` at `0931ff38cb3d04f3e6b15db9fb43ae29defff216` with a clean working tree.
- No repository/parent AGENTS.md was found; `/workspace/.agents/skills` did not exist. No additional repository skill applied.
- Created `codex/macos-swiftui-rewrite` without pushing, merging, publishing or changing cloud settings or remote permissions.
- The old product's `node --test` baseline passed 38 tests. This was historical implementation evidence, not Swift acceptance.
- The initial native implementation at `3eec263` had 47 core tests. Subsequent review and fixes brought the total to 58; the final results follow.
- Swift was not on PATH. The official Swift 6.0.3 Ubuntu 24.04 x86_64 toolchain was extracted temporarily to `/tmp/pomodoro-swift-toolchain`. Its version was `Swift version 6.0.3 (swift-6.0.3-RELEASE)`. Toolchain, builds and caches stayed in `/tmp`, without repository additions, system installation or shared-environment changes.

### Checks performed and passed

Final verification used:

```bash
PATH=/tmp/pomodoro-swift-toolchain/usr/bin:$PATH \
CLANG_MODULE_CACHE_PATH=/tmp/pomodoro-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/pomodoro-module-cache \
./scripts/verify.sh \
  --scratch-path /tmp/pomodoro-swift-build \
  --cache-path /tmp/pomodoro-swift-cache \
  --config-path /tmp/pomodoro-swift-config \
  --security-path /tmp/pomodoro-swift-security \
  -Xswiftc -warnings-as-errors
```

Exit code **0**. All targets used Swift 6 language mode; the core built with warnings-as-errors and no warnings. The XCTest result at 2026-10-21 15:50:25 UTC was:

```text
Test Suite 'All tests' passed
Executed 58 tests, with 0 failures (0 unexpected)
```

The script's closing message, translated: core tests and native source parsing completed; Linux did not compile or run SwiftUI/AppKit.

| Suite | Count | Coverage |
| --- | ---: | --- |
| ActivityEngineTests | 29 | 30/5 defaults, one continuous 80-minute record, reminders once, fixed-end priority, early breaks, manual resume, template/local-day changes, sleep and crashes during work/breaks, rollback, seven days of mixed actions, obsolete reminder filtering, actual break deadlines and fixed-start takeover |
| ConfigurationTests | 9 | JSON/example consistency, invalid fields/templates/weekdays/times, overlaps/order, half-open intervals, missing and repeated daylight-saving hours |
| HistoryAndPersistenceTests | 17 | Automatic/manual history CRUD, statistics, future/overlap/active conflicts, millisecond round trips, corrupt files/extreme dates/inconsistent checkpoints, configuration fallback, checkpoints, write-failure pauses, exit recovery, reminders coinciding with history actions, rollback write protection and half-hour daylight-saving transitions |
| DrawerGeometryTests | 3 | Real collapsed hit area, outer-screen selection, negative coordinates, vertical displays and empty display lists |

Additional checks:

- `swiftc -frontend -parse -swift-version 6 -target arm64-apple-macosx13.0 Sources/PomodoroApp/*.swift`: passed, **syntax only**.
- `bash -n scripts/build-macos.sh scripts/verify.sh`: passed.
- Python `plistlib` parsed Info.plist and checked `LSUIElement` and the executable name; the JSON example parsed successfully.
- Running `scripts/build-macos.sh` on Linux returned **1** as expected and explained that macOS was required. No substitute `.app` was fabricated.
- `actionlint 1.7.12 .github/workflows/build.yml`: passed, covering workflow syntax, expressions and runner/action settings. The tool was downloaded to `/tmp/pomodoro-review-tools` and verified against official release checksums without changing system tools.
- `git diff --check`: passed. Old Windows and Storybook release paths and the Electron `.npmrc` were replaced/removed under subsequent authorization.

The first Swift test attempt failed because the default Clang module cache pointed to read-only `/home/agent/.cache`. Command-scoped environment variables and SwiftPM arguments redirected caches to `/tmp`, and all tests passed. No escalation, automatic approval rejection or uncertain write occurred.

The added Lord Howe half-hour daylight-saving test initially failed: Foundation `.nextTime` moved missing 02:10 to the next day. Searching minute by minute for a valid time on the same day resolved it; the final 58 tests, including that case, passed. See the [static review](static-review.md) for fix and API/concurrency details.

### Checks not performed at this stage

- SwiftUI/AppKit **type-checking, linking and application launch** with a macOS SDK.
- `.app` packaging through `plutil`, `codesign` and Finder launch.
- Real Spaces, other apps' full-screen spaces, focus, multiple displays, Dock, Stage Manager, keyboard/VoiceOver and window animation acceptance.
- Actual macOS sleep/wake, exit-notification and single-instance-lock integration. Domain semantics were tested, but did not replace system acceptance.

The executor lacked a macOS SDK and graphical system. These checks were **pending macOS verification**, not denied by permissions. No remote build or fabricated screenshot was attempted. The [acceptance procedure](macos-acceptance.md) listed each outstanding item.

At this stage, the repository CI provided an executable Mac path on standard `macos-15-intel` / Xcode 16.0 and `macos-15` / Xcode 16.4, covering tests, real SwiftUI/AppKit compilation/linking, release packaging, ad-hoc signature verification, architecture and Mach-O deployment targets. That workflow had no publishing, uploads, notarization or signing secrets. No push had occurred and **remote CI had not run**; actionlint success was not evidence of Mac job success. Saved platform settings and external permissions were unchanged.
