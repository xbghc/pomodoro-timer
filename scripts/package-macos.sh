#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS is required to package and verify the native application." >&2
  exit 1
fi

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$project_dir/dist/PomodoroTimer.app"
version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app_dir/Contents/Info.plist")"
architecture="$(uname -m)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$architecture" == arm64 || "$architecture" == x86_64 ]]
if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
  test "${GITHUB_REF_NAME}" = "v$version"
fi

binary="$app_dir/Contents/MacOS/PomodoroTimer"
test -x "$binary"
lipo "$binary" -verify_arch "$architecture"
codesign --verify --strict "$app_dir"
signature="$(codesign -dv --verbose=4 "$app_dir" 2>&1)"
[[ "$signature" == *"Signature=adhoc"* ]]

package_dir="$project_dir/dist/packages"
mkdir -p "$package_dir"
archive="PomodoroTimer-$version-macos-$architecture.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$package_dir/$archive"

# Verify the distributable after unpacking, including executable mode/signature.
verification_dir="$(mktemp -d "${TMPDIR:-/tmp}/pomodoro-package.XXXXXX")"
trap 'rm -rf "$verification_dir"' EXIT
ditto -x -k "$package_dir/$archive" "$verification_dir"
unpacked="$verification_dir/PomodoroTimer.app"
test -x "$unpacked/Contents/MacOS/PomodoroTimer"
cmp "$binary" "$unpacked/Contents/MacOS/PomodoroTimer"
cmp "$app_dir/Contents/Info.plist" "$unpacked/Contents/Info.plist"
codesign --verify --strict "$unpacked"
lipo "$unpacked/Contents/MacOS/PomodoroTimer" -verify_arch "$architecture"
(
  cd "$package_dir"
  shasum -a 256 "$archive" > "$archive.sha256"
  shasum -a 256 -c "$archive.sha256"
)
echo "Verified distributable: $package_dir/$archive"
