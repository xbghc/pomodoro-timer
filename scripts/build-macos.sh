#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "PomodoroTimer 的 SwiftUI/AppKit 应用必须在 macOS 上构建。Linux 只能运行 swift test。" >&2
  exit 1
fi

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
configuration="${1:-release}"
if [[ "$configuration" != "release" && "$configuration" != "debug" ]]; then
  echo "Usage: scripts/build-macos.sh [release|debug]" >&2
  exit 1
fi

swift build --package-path "$project_dir" --configuration "$configuration" --product PomodoroTimer -Xswiftc -warnings-as-errors
binary_dir="$(swift build --package-path "$project_dir" --configuration "$configuration" --show-bin-path)"
app_dir="$project_dir/dist/PomodoroTimer.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$binary_dir/PomodoroTimer" "$app_dir/Contents/MacOS/PomodoroTimer"
cp "$project_dir/Resources/Info.plist" "$app_dir/Contents/Info.plist"
plutil -lint "$app_dir/Contents/Info.plist"
# Ad-hoc signing is local only. This script does not notarize, upload, or publish.
codesign --force --sign - "$app_dir"
codesign --verify --strict "$app_dir"
echo "已构建本地应用：$app_dir"
echo "运行：open \"$app_dir\""
