#!/usr/bin/env bash
# One-command install / update for IDEalize.
#
# Fetches the latest GitHub release, replaces any existing copy in
# /Applications, clears the macOS quarantine flag (the app is self-signed,
# not notarized), and launches it. Safe to re-run any time to update.
#
#   curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
#
set -euo pipefail

REPO="jamiejefferson/IDEalize"
APP="/Applications/IDEalize.app"

echo "==> Finding the latest IDEalize release…"
# Only the packaged app asset ends in .zip (source zipball/tarball URLs don't).
ZIP_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "https://[^\"]*\.zip" | head -1)
if [ -z "${ZIP_URL:-}" ]; then
  echo "!! Couldn't find a release download. See https://github.com/$REPO/releases/latest" >&2
  exit 1
fi
VERSION=$(basename "$ZIP_URL" | sed -E 's/^IDEalize-(.*)\.zip$/\1/')
echo "==> Latest is $VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading…"
curl -fsSL "$ZIP_URL" -o "$TMP/IDEalize.zip"

# Quit a running copy so we can replace it cleanly.
if pgrep -x IDEalize >/dev/null 2>&1; then
  echo "==> Quitting the running IDEalize…"
  osascript -e 'quit app "IDEalize"' 2>/dev/null || true
  sleep 1
fi

echo "==> Installing to $APP…"
rm -rf "$APP"
# ditto (not unzip) preserves the code signature the release was packaged with.
ditto -x -k "$TMP/IDEalize.zip" /Applications

# Clear the download quarantine so the self-signed app opens without a prompt.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "==> Done — IDEalize $VERSION is installed. Launching…"
open "$APP"
