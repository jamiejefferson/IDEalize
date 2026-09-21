#!/bin/bash
# Swap the freshly packaged app into /Applications and reopen it.
#
# The last step of a landing (`yarn package:dir` builds dist; JJ launches from
# the Dock, so nothing is live until the /Applications bundle is replaced).
# Safe to run from a terminal inside the app itself: the work re-launches in its
# own session first, so it survives the app quitting underneath it.
#
#   scripts/land-local.sh          # lists chats active in the last 5 min, stops if any
#   scripts/land-local.sh --yes    # swap regardless
#   DRY_RUN=1 scripts/land-local.sh --yes   # walk the steps without quitting or copying
#   DIST=/path/to/IDEalize\ V1.app scripts/land-local.sh   # swap in another bundle, such as a release download
set -euo pipefail

APP="/Applications/IDEalize V1.app"
DIST="${DIST:-$(cd "$(dirname "$0")/.." && pwd)/dsh-plugin-desktop/dist/mac-arm64/IDEalize V1.app}"
SESSIONS="$HOME/Library/Application Support/IDEalize V1/harness/sessions"
LOG="$HOME/Library/Logs/idealize-land-local.log"
PROC="IDEalize V1.app/Contents/MacOS/IDEalize V1"

[ -f "$DIST/Contents/Info.plist" ] || { echo "No packaged app at $DIST. Run yarn package:dir first."; exit 1; }

if [ "${1:-}" != "--detached" ]; then
  active=$(find "$SESSIONS" -type f -mmin -5 2>/dev/null | sed "s|$SESSIONS/||; s|/session-.*||" | sort -u)
  # Terminal chats write nothing under sessions/, so an agent working in one is found by its process.
  # ps, not pgrep: pgrep leaves out its own ancestors, and this script usually runs from a chat inside the app.
  app_pid=$(ps -axo pid=,ppid=,command= | awk -v p="$PROC" '$2 == 1 && index($0, p) && !seen { print $1; seen = 1 }')
  if [ -n "$app_pid" ]; then
    for shell in $(pgrep -P "$app_pid" || true); do
      for child in $(pgrep -P "$shell" || true); do
        name=$(ps -o comm= -p "$child" | xargs basename 2>/dev/null || true)
        case "$name" in claude|codex|pi|gemini) active="${active:+$active
}terminal chat running $name (pid $child, in $(lsof -a -p "$child" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'))" ;; esac
      done
    done
  fi
  if [ -n "$active" ] && [ "${1:-}" != "--yes" ]; then
    echo "These chats are active and will stop when the app quits:"
    echo "$active" | sed 's/^/  /'
    echo "Run again with --yes to swap anyway."
    exit 2
  fi
  echo "Swapping in the background. Progress: $LOG"
  # setsid puts the swap in its own session, so the app closing its terminals cannot take it down.
  nohup perl -MPOSIX -e 'setsid(); exec @ARGV' "$0" --detached >>"$LOG" 2>&1 &
  exit 0
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') landing $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DIST/Contents/Info.plist")"
run() { if [ -n "${DRY_RUN:-}" ]; then echo "dry-run: $*"; else "$@"; fi; }

run osascript -e "tell application \"$APP\" to quit"
if [ -z "${DRY_RUN:-}" ]; then
  for _ in $(seq 1 30); do pgrep -f "$PROC" >/dev/null || break; sleep 1; done
  if pgrep -f "$PROC" >/dev/null; then echo "App did not quit within 30s. Bundle untouched."; exit 1; fi
fi

# Copy beside the old bundle first, so a failed copy never leaves /Applications empty.
run rm -rf "$APP.new"
run ditto "$DIST" "$APP.new"
run rm -rf "$APP"
run mv "$APP.new" "$APP"
run open -n "$APP"
echo "done"
