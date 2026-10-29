#!/usr/bin/env bash
set -euo pipefail

# Called only by the tag workflow after all Linux and macOS jobs have succeeded.
test "${GITHUB_ACTIONS:-}" = true
test "${GITHUB_EVENT_NAME:-}" = push
[[ "${GITHUB_REF:-}" == refs/tags/v* ]]
: "${GH_REPO:?}" "${GITHUB_SHA:?}" "${GITHUB_REF_NAME:?}" "${GITHUB_RUN_ID:?}"
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
version="$(python3 -c 'import plistlib; print(plistlib.load(open("Resources/Info.plist", "rb"))["CFBundleShortVersionString"])')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
tag="v$version"
test "$GITHUB_REF_NAME" = "$tag"
test "$(git rev-parse "refs/tags/$tag^{commit}")" = "$GITHUB_SHA"
git merge-base --is-ancestor "$GITHUB_SHA" origin/main
notes="$project_dir/docs/releases/$tag.md"
test -s "$notes"
asset_dir="$(cd "${1:?release asset directory required}" && pwd)"

verification_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/pomodoro-release.XXXXXX")"
trap 'rm -rf "$verification_dir"' EXIT
# Never overwrite an existing published release or another draft.
gh api --paginate "repos/$GH_REPO/releases" --jq '.[].tag_name' > "$verification_dir/existing-tags"
while IFS= read -r existing; do
  if [[ "$existing" == "$tag" ]]; then
    echo "Release $tag already exists; inspect it before attempting recovery." >&2
    exit 1
  fi
done < "$verification_dir/existing-tags"

archives=("PomodoroTimer-$version-macos-arm64.zip" "PomodoroTimer-$version-macos-x86_64.zip")
(
  cd "$asset_dir"
  for archive in "${archives[@]}"; do
    test -s "$archive"
    sha256sum -c "$archive.sha256"
  done
  sha256sum "${archives[@]}" > SHA256SUMS
)
cp "$notes" "$verification_dir/notes.md"
cat >> "$verification_dir/notes.md" <<EOF

Build commit: \`$GITHUB_SHA\`

Release build and verification: [GitHub Actions](https://github.com/$GH_REPO/actions/runs/$GITHUB_RUN_ID).
EOF

# A failed upload/download leaves a draft for inspection, never a partial public release.
gh release create "$tag" "$asset_dir/${archives[0]}" "$asset_dir/${archives[1]}" "$asset_dir/SHA256SUMS" \
  --repo "$GH_REPO" --draft --verify-tag --target "$GITHUB_SHA" \
  --title "$tag · Pomodoro Timer (macOS)" --notes-file "$verification_dir/notes.md"
gh release view "$tag" --repo "$GH_REPO" --json tagName,isDraft,assets > "$verification_dir/release.json"
python3 - "$verification_dir/release.json" "$tag" "${archives[@]}" <<'PY'
import json, sys
release = json.load(open(sys.argv[1]))
assert release['tagName'] == sys.argv[2] and release['isDraft']
assets = release['assets']
assert {a['name'] for a in assets} == {*sys.argv[3:], 'SHA256SUMS'}
assert len(assets) == 3 and all(a['size'] > 0 and a['state'] == 'uploaded' for a in assets)
PY
gh release download "$tag" --repo "$GH_REPO" --dir "$verification_dir/download"
cmp "$asset_dir/SHA256SUMS" "$verification_dir/download/SHA256SUMS"
(
  cd "$verification_dir/download"
  sha256sum -c SHA256SUMS
)
gh release edit "$tag" --repo "$GH_REPO" --draft=false --latest --verify-tag
gh release view "$tag" --repo "$GH_REPO" --json url,isDraft,isPrerelease,tagName
