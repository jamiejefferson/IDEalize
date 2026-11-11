#!/usr/bin/env bash
# One-command install / update for IDEalize V1 on macOS.
#
# Needs a Mac with Apple silicon.
#
# Fetches the latest GitHub release, checks it was signed by the IDEalize
# release certificate, replaces any existing copy in /Applications, retires the
# original IDEalize (V0) app if it is still installed, clears the macOS
# quarantine flag (the app is self-signed, so the certificate check above takes
# the place of Gatekeeper's), and launches it. Safe to re-run any time to update.
# Nothing under ~/Library or in your home folder is touched: V0's data, V1's
# data, projects and keys all stay where they are.
#
#   curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
#
set -euo pipefail

REPO="jamiejefferson/IDEalize"
APP_NAME="IDEalize V1"
# The three IDEALIZE_INSTALL_* settings exist so tests can run this script
# against a local image and a scratch folder; nothing sets them for a person.
APPS_DIR="${IDEALIZE_INSTALL_APPS_DIR:-/Applications}"
RELEASE_URL="${IDEALIZE_INSTALL_RELEASE_URL:-https://github.com/${REPO}/releases/latest/download}"
APP="${APPS_DIR}/${APP_NAME}.app"
DMG_NAME="IDEalize-V1-mac.dmg"
DMG_URL="${RELEASE_URL}/${DMG_NAME}"
SUMS_URL="${RELEASE_URL}/SHA256SUMS-mac.txt"
# The release certificate (dsh-plugin-desktop/src/update-verify.ts holds the
# same text). It reads `certificate root` because a self-signed leaf is its own
# root. It names the certificate by value, so a copy signed by anyone else fails.
REQUIREMENT='identifier "ai.projject.idealize.v1" and certificate root = H"39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3"'

if [ "$(uname -s)" != "Darwin" ]; then
  echo "!! IDEalize V1 runs on macOS; this installer cannot help on $(uname -s)." >&2
  exit 1
fi

# IDEalize ships for Apple silicon only. This check runs before anything is
# downloaded or removed, so an Intel Mac keeps whatever copy it has. A Terminal
# running under Rosetta reports x86_64 on an Apple silicon Mac, and
# sysctl.proc_translated tells the two apart.
if [ "$(uname -m)" = "x86_64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || /usr/sbin/sysctl -n sysctl.proc_translated 2>/dev/null || true)" != "1" ]; then
  echo "!! IDEalize needs a Mac with Apple silicon (an M1 chip or newer). This Mac has an" >&2
  echo "   Intel chip, so nothing was downloaded or installed. If IDEalize is already on" >&2
  echo "   this Mac, that copy has not changed." >&2
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

# The checksum catches a damaged or swapped download when the release publishes
# one. It comes from the same place as the image, so the certificate check below
# is the real proof of who made it.
if curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS-mac.txt" 2>/dev/null; then
  echo "==> Checking the download against the release's checksum…"
  EXPECTED="$(awk -v name="$DMG_NAME" '$2 == name { print $1; exit }' "$TMP/SHA256SUMS-mac.txt")"
  ACTUAL="$(shasum -a 256 "$TMP/IDEalize.dmg" | awk '{ print $1 }')"
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "!! The download does not match the release's checksum, so nothing was installed." >&2
    echo "   Your current copy has not changed. Run this command again, and if you see this" >&2
    echo "   message twice, download IDEalize from https://idealize.projject.ai instead." >&2
    exit 1
  fi
else
  echo "==> This release publishes no checksum, so the certificate check below stands alone."
fi

echo "==> Opening the disk image…"
MOUNT="$TMP/mount"
mkdir -p "$MOUNT"
if ! hdiutil attach "$TMP/IDEalize.dmg" -nobrowse -readonly -mountpoint "$MOUNT" -quiet; then
  MOUNT=""
  echo "!! The disk image could not be opened." >&2
  exit 1
fi
if [ -L "$MOUNT/${APP_NAME}.app" ] || [ ! -d "$MOUNT/${APP_NAME}.app" ]; then
  echo "!! The disk image did not carry ${APP_NAME}.app." >&2
  exit 1
fi

# Before anything on this Mac changes: the app must be intact and signed by the
# IDEalize release certificate.
echo "==> Checking the app was signed by IDEalize (this takes under a minute)…"
if ! codesign --verify --deep --strict "--test-requirement==${REQUIREMENT}" "$MOUNT/${APP_NAME}.app" 2>/dev/null; then
  echo "!! IDEalize could not confirm this download is genuine, so nothing was installed." >&2
  echo "   Your current copy has not changed. Download IDEalize from https://idealize.projject.ai" >&2
  echo "   and tell whoever sent you this command what happened." >&2
  exit 1
fi

# The original IDEalize (V0, /Applications/IDEalize.app) is retired by V1:
# quit it if it is running and remove the app bundle only. Its data folder
# (~/Library/Application Support/IDEalize) is left in place.
V0_APP="${APPS_DIR}/IDEalize.app"
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
if [ -e "$APP" ] || [ ! -w "$APPS_DIR" ]; then
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

if [ -n "${IDEALIZE_INSTALL_NO_LAUNCH:-}" ]; then
  echo "==> Done. ${APP_NAME} is in ${APPS_DIR}."
  exit 0
fi

echo "==> Launching ${APP_NAME}…"
open "$APP"
echo "==> Done. ${APP_NAME} is in your Applications folder."
