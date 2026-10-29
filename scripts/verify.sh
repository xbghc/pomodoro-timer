#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
swift test "$@"
if [[ "$(uname -s)" == "Darwin" ]]; then
  swift build --product PomodoroTimer "$@"
  echo "Core tests and macOS app compilation completed; native window behavior still requires manual acceptance testing."
else
  swiftc -frontend -parse -swift-version 6 -target arm64-apple-macosx13.0 Sources/PomodoroApp/*.swift
  echo "Core tests and native source parsing completed. Linux did not compile or run SwiftUI/AppKit."
fi
