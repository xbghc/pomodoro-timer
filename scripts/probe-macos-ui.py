#!/usr/bin/env python3
"""Capture the real app with visible controls and existing runner permissions."""
import datetime
import hashlib
import json
import os
import pathlib
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
    "images": [],
}
launched = set()


def inspect(name, *action):
    result = subprocess.run([str(driver), *action], capture_output=True, text=True, timeout=20)
    (output / f"{name}.json").write_text(result.stdout)
    (output / f"{name}.stderr.txt").write_text(result.stderr)
    result.check_returncode()
    report = json.loads(result.stdout)
    print(f"Observed {name}: {len(report['windows'])} app windows", flush=True)
    return report


def window(report, title):
    return next(w for w in report["windows"] if w["title"] == title)


def labels(report, title="工作与休息"):
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
    assert f"工作、休息、等待；当前{phase}" in labels(report), f"{phase} state not observed"


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
    subprocess.run(["open", "-n", str(app)], check=True, timeout=15)
    time.sleep(3)
    # Existing single-instance behavior brings up the real main window.
    subprocess.run(["open", "-n", str(app)], check=True, timeout=15)
    time.sleep(3)
    report = inspect("session-after-launch")
    launched.update(report["applicationPIDs"])
    if "结束当前活动" in labels(report):
        report = press("结束当前活动", "stop-initial-activity")
    report = press("开始工作", "start-work")
    assert_phase(report, "工作")
    bounds = window(report, "工作与休息")["bounds"]
    assert (bounds["Width"], bounds["Height"]) == (360, 190), "Compact window size does not match reference"
    capture("01-main-work", report, "工作与休息")
    report = press("休息 5 分钟", "start-rest")
    assert_phase(report, "休息")
    capture("02-main-rest", report, "工作与休息")
    report = press("结束当前活动", "stop-rest")
    assert_phase(report, "等待")
    capture("03-main-waiting", report, "工作与休息")
    report = press("开始工作", "resume-work")
    bounds = window(report, "工作与休息")["bounds"]
    report = inspect("pointer-away", "--move-pointer", str(bounds["X"] + 50), str(bounds["Y"] + 80))
    drawer = window(report, "工作与休息 · 桌边抽屉")
    assert drawer["bounds"]["Width"] == 12, "Drawer did not collapse"
    capture("04-desktop-drawer-collapsed", report)
    bounds = drawer["bounds"]
    report = inspect("pointer-on-handle", "--move-pointer", str(bounds["X"] + bounds["Width"] / 2),
                     str(bounds["Y"] + bounds["Height"] / 2))
    drawer = window(report, "工作与休息 · 桌边抽屉")
    assert (drawer["bounds"]["Width"], drawer["bounds"]["Height"]) == (360, 190), "Hover did not expand the compact drawer"
    capture("05-drawer-work", report, "工作与休息 · 桌边抽屉")
    capture("06-desktop-drawer-expanded", report)
    report = press("休息 5 分钟", "rest-with-drawer")
    capture("07-drawer-rest", report, "工作与休息 · 桌边抽屉")
    report = press("设置", "open-settings")
    settings_title = "工作与休息 · 设置"
    bounds = window(report, settings_title)["bounds"]
    assert (bounds["Width"], bounds["Height"]) == (480, 520), "Settings size does not match reference"
    capture("08-settings", report, settings_title)
    report = press_in_window(settings_title, "日历与记录…", "open-calendar")
    workspace_title = "工作与休息 · 日历与记录"
    capture("09-calendar", report, workspace_title)
    report = press_in_window(workspace_title, "工作模板", "open-templates")
    capture("10-templates", report, workspace_title)
    report = inspect("open-menu-bar", "--press-status")
    capture("11-menu-bar", report)
    manifest["result"] = "passed"
finally:
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for pid in launched:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
