#!/usr/bin/env bash
# One-command install / update for IDEalize V1 on macOS.
#
# Fetches the latest GitHub release, replaces any existing copy in
# /Applications, retires the original IDEalize (V0) app if it is still
# installed, clears the macOS quarantine flag (the app is self-signed, not
# notarised), and launches it. Safe to re-run any time to update. Nothing under
# ~/Library or in your home folder is touched: V0's data, V1's data, projects
# and keys all stay where they are.
#
#   curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
#
set -euo pipefail

REPO="jamiejefferson/IDEalize"
APP_NAME="IDEalize V1"
APP="/Applications/${APP_NAME}.app"
DMG_URL="https://github.com/${REPO}/releases/latest/download/IDEalize-V1-mac.dmg"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "!! IDEalize V1 runs on macOS; this installer cannot help on $(uname -s)." >&2
  exit 1
fi

TMP="$(mktemp -d)"
MOUNT=""
cleanup() {
  if [ -n "${MOUNT:-}" ]; then hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> Downloading the latest IDEalize V1…"
if ! curl -fL --progress-bar "$DMG_URL" -o "$TMP/IDEalize.dmg"; then
  echo "!! Couldn't download the release. See https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

echo "==> Opening the disk image…"
MOUNT="$TMP/mount"
mkdir -p "$MOUNT"
if ! hdiutil attach "$TMP/IDEalize.dmg" -nobrowse -readonly -mountpoint "$MOUNT" -quiet; then
  MOUNT=""
  echo "!! The disk image could not be opened." >&2
  exit 1
fi
if [ ! -d "$MOUNT/${APP_NAME}.app" ]; then
  echo "!! The disk image did not carry ${APP_NAME}.app." >&2
  exit 1
fi

# The original IDEalize (V0, /Applications/IDEalize.app) is retired by V1:
# quit it if it is running and remove the app bundle only. Its data folder
# (~/Library/Application Support/IDEalize) is left in place.
V0_APP="/Applications/IDEalize.app"
if [ -d "$V0_APP" ]; then
  if pgrep -f "${V0_APP}/Contents/MacOS/" >/dev/null 2>&1; then
    echo "==> Quitting the original IDEalize…"
    osascript -e 'quit app "IDEalize"' 2>/dev/null || true
    sleep 2
    pgrep -f "${V0_APP}/Contents/MacOS/" >/dev/null 2>&1 && pkill -TERM -f "${V0_APP}/Contents/MacOS/" 2>/dev/null || true
    sleep 1
  fi
  echo "==> Removing the original IDEalize app (its data stays in ~/Library/Application Support/IDEalize)…"
  rm -rf "$V0_APP" 2>/dev/null || sudo rm -rf "$V0_APP"
fi

# Quit a running copy so it can be replaced cleanly.
if pgrep -f "${APP}/Contents/MacOS/" >/dev/null 2>&1; then
  echo "==> Quitting the running ${APP_NAME}…"
  osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
  sleep 2
fi

echo "==> Installing to ${APP}…"
# Replacing the app means removing any existing copy and writing into
# /Applications. Both fail with "Permission denied" if an old copy is owned by
# another account (or this isn't an admin user), so detect that up front and
# retry the privileged steps under sudo with a clear prompt.
SUDO=""
rm -rf "$APP" 2>/dev/null || true
if [ -e "$APP" ] || [ ! -w /Applications ]; then
  SUDO="sudo"
  echo "==> /Applications needs administrator access to update ${APP_NAME}."
  echo "    You'll be prompted for your Mac password."
  if ! sudo -v; then
    echo "!! Couldn't get administrator access. Remove the old copy and re-run:" >&2
    echo "   sudo rm -rf \"$APP\"" >&2
    exit 1
  fi
  sudo rm -rf "$APP"
fi

# ditto preserves the signature the release was packaged with.
$SUDO ditto "$MOUNT/${APP_NAME}.app" "$APP"

# Clear the download quarantine so the self-signed app opens without a prompt.
$SUDO xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
MOUNT=""

echo "==> Launching ${APP_NAME}…"
open "$APP"
echo "==> Done. ${APP_NAME} is in your Applications folder."
