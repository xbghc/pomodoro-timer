#!/usr/bin/env python3
"""Probe the actual built app using existing runner permissions only."""
import json
import pathlib
import subprocess
import sys
import time

app = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
inspector = pathlib.Path(__file__).with_name("inspect-macos-gui.swift")


def inspect(name):
    result = subprocess.run(["swift", "-swift-version", "6", str(inspector)],
                            capture_output=True, text=True, timeout=60)
    (output / f"{name}.json").write_text(result.stdout)
    (output / f"{name}.stderr.txt").write_text(result.stderr)
    result.check_returncode()
    report = json.loads(result.stdout)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return report


before = inspect("session-before-launch")
if not before["onConsole"] or not before["loginDone"] or not before["screens"]:
    sys.exit("No logged-in graphical session with an attached display; no permissions changed.")

try:
    subprocess.run(["open", "-n", str(app)], check=True, timeout=15)
    time.sleep(3)
    # The application's existing single-instance behavior opens its main window.
    subprocess.run(["open", "-n", str(app)], check=True, timeout=15)
    time.sleep(3)
    after = inspect("session-after-launch")
    windows = after["windows"]
    if not windows:
        sys.exit("The real app has no visible windows in this session.")
    main = max(windows, key=lambda w: w["bounds"].get("Width", 0) * w["bounds"].get("Height", 0))
    if main["bounds"].get("Width", 0) < 700:
        sys.exit("The real main window did not open; only a small panel was observed.")
    command = ["/usr/sbin/screencapture", "-x", "-o", "-l", str(main["id"]), str(output / "probe-main.png")]
    result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    (output / "capture-result.json").write_text(json.dumps({
        "window": main, "returnCode": result.returncode,
        "stdout": result.stdout, "stderr": result.stderr,
        "method": "screencapture of the live PomodoroTimer window",
    }, ensure_ascii=False, indent=2))
    print(f"Capture exit code: {result.returncode}; {result.stderr}", flush=True)
    result.check_returncode()
    image = output / "probe-main.png"
    if not image.is_file() or image.stat().st_size < 1000:
        sys.exit("Capture did not produce a PNG with usable content.")
    print(f"Actual window capture saved: {image.name}", flush=True)
finally:
    # Only terminate this test application's processes in the disposable CI runner.
    subprocess.run(["pkill", "-x", "PomodoroTimer"], check=False)
