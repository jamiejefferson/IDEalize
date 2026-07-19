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

echo "==> Installing to ${APP}…"

# Replacing the app means removing any existing copy and writing into
# /Applications. Both fail with "Permission denied" if an old copy is owned by
# another account (or this isn't an admin user) — and because `rm -rf` swallows
# that error, ditto would otherwise spew a wall of permission failures. Detect
# it up front and retry the privileged steps under sudo with a clear prompt.
SUDO=""
rm -rf "$APP" 2>/dev/null || true
if [ -e "$APP" ] || [ ! -w /Applications ]; then
  SUDO="sudo"
  echo "==> /Applications needs administrator access to update IDEalize"
  echo "    (an existing copy is owned by another account, or this isn't an"
  echo "    admin user). You'll be prompted for your Mac password."
  if ! sudo -v; then
    echo "!! Couldn't get administrator access." >&2
    echo "   Remove the old copy and re-run, e.g.:  sudo rm -rf \"$APP\"" >&2
    echo "   or run this installer from an administrator account." >&2
    exit 1
  fi
  sudo rm -rf "$APP"
fi

# ditto (not unzip) preserves the code signature the release was packaged with.
$SUDO ditto -x -k "$TMP/IDEalize.zip" /Applications

# Clear the download quarantine so the self-signed app opens without a prompt.
$SUDO xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# --- anonymous install ping ---------------------------------------------------
# Best-effort, never blocks or fails the install. Records only the version that
# was installed, macOS version, and a one-way SHA-256 hash of this Mac's hardware
# UUID (not reversible, not personally identifying) so repeat installs from the
# same machine can be de-duplicated. Same Supabase anon key the app already ships.
report_install() {
  local hwid mid os
  hwid=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null \
    | awk -F'"' '/IOPlatformUUID/{print $4; exit}')
  [ -n "${hwid:-}" ] || hwid="unknown"
  mid=$(printf 'idealize-install::%s' "$hwid" | shasum -a 256 | cut -c1-16)
  os=$(sw_vers -productVersion 2>/dev/null || echo "")
  curl -fsS --max-time 5 \
    "https://xlswtyprnmiymfjdbaez.supabase.co/rest/v1/idealize_installs" \
    -H "Content-Type: application/json" \
    -H "apikey: sb_publishable_ISmJRrzDN3Z6OEdEEZe2Cw_5YvSDGkt" \
    -H "Authorization: Bearer sb_publishable_ISmJRrzDN3Z6OEdEEZe2Cw_5YvSDGkt" \
    -H "Prefer: return=minimal" \
    -d "{\"app_version\":\"$VERSION\",\"os_version\":\"$os\",\"machine_id\":\"$mid\"}" \
    >/dev/null 2>&1
}
echo "==> Recording an anonymous install ping (version only, no personal data)…"
report_install || true
# -----------------------------------------------------------------------------

echo "==> Done — IDEalize $VERSION is installed. Launching…"
open "$APP"
