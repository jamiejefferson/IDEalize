#!/usr/bin/env bash
# Cut a GitHub release of IDEalize — the app's distribution channel.
#
# Builds + signs the app, packages it (ditto, which preserves the code
# signature — a plain zip corrupts it), and publishes it as the "latest"
# GitHub release so users can download it from
#   https://github.com/jamiejefferson/IDEalize/releases/latest
#
# Usage:  scripts/release.sh [path/to/notes.md]
# Prereqs: `gh auth login`; bump the version in scripts/build-app.sh first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Version is read from the single source of truth in build-app.sh.
VERSION=$(grep -m1 CFBundleShortVersionString scripts/build-app.sh \
  | sed -E 's/.*<string>([^<]+)<.*/\1/')
TAG="v$VERSION"
NOTES="${1:-}"
echo "==> Releasing IDEalize $TAG"

# 1. Build + sign.
./scripts/build-app.sh

# 2. Package (ditto keeps the signature intact).
ZIP="$(mktemp -d)/IDEalize-$VERSION.zip"
ditto -c -k --keepParent dist/IDEalize.app "$ZIP"

# 3. Publish. If the release already exists, just replace the asset.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "==> $TAG exists — replacing its app asset"
  gh release upload "$TAG" "$ZIP" --clobber
else
  git tag -a "$TAG" -m "IDEalize $VERSION" 2>/dev/null || true
  git push origin "$TAG"
  NOTES_ARG=(--generate-notes)
  [ -n "$NOTES" ] && NOTES_ARG=(--notes-file "$NOTES")
  gh release create "$TAG" "$ZIP" --title "IDEalize $VERSION" --latest "${NOTES_ARG[@]}"
fi

echo "==> Done: $(gh release view "$TAG" --json url --jq .url)"
echo "    Note: the app is self-signed, not notarized — install instructions must"
echo "    tell users to run: xattr -dr com.apple.quarantine /Applications/IDEalize.app"
