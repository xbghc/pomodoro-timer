#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
swift test "$@"
if [[ "$(uname -s)" == "Darwin" ]]; then
  swift build --product PomodoroTimer "$@"
  echo "核心测试与 macOS 应用编译完成；原生窗口行为仍需人工验收。"
else
  swiftc -frontend -parse -swift-version 6 -target arm64-apple-macosx13.0 Sources/PomodoroApp/*.swift
  echo "核心测试与原生源码语法解析完成。Linux 未编译或运行 SwiftUI/AppKit。"
fi
