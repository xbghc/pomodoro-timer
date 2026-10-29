#!/usr/bin/env python3
"""Capture the real app with visible controls and existing runner permissions."""
import datetime
import hashlib
import json
import os
import pathlib
import re
import signal
import struct
import subprocess
import sys
import time

if os.environ.get("GITHUB_ACTIONS") != "true":
    sys.exit("This smoke test is restricted to disposable GitHub Actions runners.")

app = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
inspector = pathlib.Path(__file__).with_name("inspect-macos-gui.swift")
driver = output.parent / "pomodoro-ui-inspector"
subprocess.run(["swiftc", "-swift-version", "6", "-warnings-as-errors", str(inspector), "-o", str(driver)],
               check=True, timeout=60)
manifest = {
    "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "workflowRun": os.environ.get("GITHUB_RUN_ID"),
    "architecture": subprocess.check_output(["uname", "-m"], text=True).strip(),
    "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "appBinarySHA256": hashlib.sha256((app / "Contents/MacOS/PomodoroTimer").read_bytes()).hexdigest(),
    "method": "screencapture of live windows; AXPress on existing controls and real pointer movement",
    "permissionsChanged": False,
    "launchLocale": "zh_CN",
    "requestedLanguages": ["zh-Hans"],
    "images": [],
}
launched = set()


def inspect(name, *action):
    result = subprocess.run([str(driver), *action], capture_output=True, text=True, timeout=20)
    (output / f"{name}.json").write_text(result.stdout)
    (output / f"{name}.stderr.txt").write_text(result.stderr)
    result.check_returncode()
    report = json.loads(result.stdout)
    assert_english_interface(report)
    print(f"Observed {name}: {len(report['windows'])} app windows", flush=True)
    return report


def assert_english_interface(report):
    def walk(node):
        for key in ("AXDescription", "AXTitle", "AXValue"):
            value = node.get(key, "")
            assert not re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", value), f"Non-English interface text: {value}"
        for child in node.get("children", []):
            walk(child)
    for application in report["accessibility"]:
        for target in application["windows"]:
            walk(target)


def window(report, title):
    return next(w for w in report["windows"] if w["title"] == title)


def labels(report, title="Pomodoro Timer"):
    def walk(node):
        for key in ("AXDescription", "AXTitle", "AXValue"):
            if key in node:
                yield node[key]
        for child in node.get("children", []):
            yield from walk(child)
    return [label for application in report["accessibility"] for w in application["windows"]
            if w.get("AXTitle") == title for label in walk(w)]


def press(label, name):
    return inspect(name, "--press", label)


def press_in_window(title, label, name):
    return inspect(name, "--press-in-window", title, label)


def assert_phase(report, phase):
    assert f"Work, Break, Idle; current: {phase}" in labels(report), f"{phase} state not observed"


def capture(name, report, title=None):
    target = window(report, title) if title else None
    destination = output / f"{name}.png"
    command = ["/usr/sbin/screencapture", "-x"]
    if target:
        command += ["-o", "-l", str(target["id"])]
    result = subprocess.run([*command, str(destination)], capture_output=True, text=True, timeout=15)
    (output / f"{name}.capture.json").write_text(json.dumps({
        "window": target, "returnCode": result.returncode, "stderr": result.stderr,
    }, ensure_ascii=False, indent=2))
    result.check_returncode()
    image = destination.read_bytes()
    if image[:8] != b"\x89PNG\r\n\x1a\n" or len(image) < 1000:
        raise RuntimeError(f"Invalid capture: {name}")
    width, height = struct.unpack(">II", image[16:24])
    manifest["images"].append({"file": destination.name, "width": width, "height": height,
                               "sha256": hashlib.sha256(image).hexdigest(), "window": target})
    print(f"Captured {destination.name}: {width} x {height}", flush=True)


before = inspect("session-before-launch")
manifest["session"] = before
if not before["sessionAvailable"] or not before["loginDone"] or not before["screens"]:
    sys.exit("No logged-in graphical session with an attached display; no permissions changed.")
if not all(before[key] for key in ("accessibilityTrusted", "screenCapturePreflight", "postEventPreflight")):
    sys.exit("Required existing GUI permissions are unavailable; no permission request was made.")
if before["applicationPIDs"]:
    sys.exit("An app instance already exists; refusing to alter its records.")

try:
    # Process-only preferences test the English UI under a Chinese locale.
    # Nothing is written to macOS language settings or persistent app preferences.
    launch = ["open", "-n", str(app), "--args", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
    subprocess.run(launch, check=True, timeout=15)
    time.sleep(3)
    # Existing single-instance behavior brings up the real main window.
    subprocess.run(launch, check=True, timeout=15)
    time.sleep(3)
    report = inspect("session-after-launch")
    launched.update(report["applicationPIDs"])
    if "End activity" in labels(report):
        report = press("End activity", "stop-initial-activity")
    report = press("Start work", "start-work")
    assert_phase(report, "Work")
    bounds = window(report, "Pomodoro Timer")["bounds"]
    assert (bounds["Width"], bounds["Height"]) == (360, 190), "Compact window size does not match reference"
    capture("01-main-work", report, "Pomodoro Timer")
    report = press("Take a 5 min break", "start-rest")
    assert_phase(report, "Break")
    capture("02-main-rest", report, "Pomodoro Timer")
    report = press("End activity", "stop-rest")
    assert_phase(report, "Idle")
    capture("03-main-waiting", report, "Pomodoro Timer")
    report = press("Start work", "resume-work")
    bounds = window(report, "Pomodoro Timer")["bounds"]
    report = inspect("pointer-away", "--move-pointer", str(bounds["X"] + 50), str(bounds["Y"] + 80))
    drawer = window(report, "Pomodoro Timer · Edge Drawer")
    assert drawer["bounds"]["Width"] == 12, "Drawer did not collapse"
    capture("04-desktop-drawer-collapsed", report)
    bounds = drawer["bounds"]
    report = inspect("pointer-on-handle", "--move-pointer", str(bounds["X"] + bounds["Width"] / 2),
                     str(bounds["Y"] + bounds["Height"] / 2))
    drawer = window(report, "Pomodoro Timer · Edge Drawer")
    assert (drawer["bounds"]["Width"], drawer["bounds"]["Height"]) == (360, 190), "Hover did not expand the compact drawer"
    capture("05-drawer-work", report, "Pomodoro Timer · Edge Drawer")
    capture("06-desktop-drawer-expanded", report)
    report = press("Take a 5 min break", "rest-with-drawer")
    capture("07-drawer-rest", report, "Pomodoro Timer · Edge Drawer")
    report = press("Settings", "open-settings")
    settings_title = "Pomodoro Timer · Settings"
    bounds = window(report, settings_title)["bounds"]
    assert (bounds["Width"], bounds["Height"]) == (480, 520), "Settings size does not match reference"
    capture("08-settings", report, settings_title)
    report = press_in_window(settings_title, "Calendar & History…", "open-calendar")
    workspace_title = "Pomodoro Timer · Calendar & History"
    capture("09-calendar", report, workspace_title)
    report = press_in_window(workspace_title, "Add Record", "open-record-editor")
    capture("10-record-editor", report)
    report = press_in_window(workspace_title, "Cancel", "close-record-editor")
    report = press_in_window(workspace_title, "Now", "open-current-session")
    capture("11-current-session", report, workspace_title)
    report = press("End activity", "stop-before-custom-duration")
    report = press_in_window(workspace_title, "Custom work duration…", "open-custom-duration")
    capture("12-custom-duration", report)
    report = press_in_window(workspace_title, "Cancel", "close-custom-duration")
    report = press_in_window(workspace_title, "Schedule", "open-templates")
    capture("13-templates", report, workspace_title)
    report = inspect("open-menu-bar", "--press-status")
    capture("14-menu-bar", report)
    manifest["result"] = "passed"
finally:
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for pid in launched:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
