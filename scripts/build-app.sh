#!/bin/bash
# Build IDEalize and package it into a proper macOS .app bundle.
#
#   scripts/build-app.sh [--debug] [--open]
#
# Produces ./dist/IDEalize.app containing both the GUI app and the `idealize`
# CLI (so spawned shells find it on PATH). Ad-hoc signs the bundle so native
# notifications work.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

CONFIG="release"
OPEN_AFTER=0
for arg in "$@"; do
  case "$arg" in
    --debug) CONFIG="debug" ;;
    --open)  OPEN_AFTER=1 ;;
  esac
done

echo "==> Building ($CONFIG)…"
swift build -c "$CONFIG"

BIN_DIR="$ROOT/.build/$CONFIG"
FINAL_APP="$ROOT/dist/IDEalize.app"
# Assemble + sign in a NON-synced staging dir. dist/ lives in an iCloud-synced
# Obsidian vault whose File Provider re-stamps com.apple.FinderInfo on the bundle
# dirs mid-sign, which makes codesign fall back to ad-hoc (losing the stable
# identity → macOS forgets permission grants). Signing off the synced volume,
# then copying the finished bundle in, avoids the race.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/idealize-build.XXXXXX")"
APP="$STAGE/IDEalize.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
HELPERS="$CONTENTS/Helpers"

echo "==> Assembling bundle at $APP"
rm -rf "$APP"
mkdir -p "$MACOS" "$RES" "$HELPERS"

cp "$BIN_DIR/IDEalize" "$MACOS/IDEalize"
# The CLI ships as Helpers/idealize-cli; the app installs an `idealize` shim on
# PATH at runtime. (It cannot live in MacOS/ as `idealize` — case-insensitive
# filesystems would collide it with the IDEalize app binary.)
cp "$BIN_DIR/idealize-cli" "$HELPERS/idealize-cli"

# SwiftTerm ships a Metal shader resource bundle that must travel with the app.
# Copy without extended attributes (-X) and make it writable, so the read-only
# SwiftPM-cache detritus doesn't make codesign refuse to seal the bundle.
if [ -d "$BIN_DIR/SwiftTerm_SwiftTerm.bundle" ]; then
  cp -RX "$BIN_DIR/SwiftTerm_SwiftTerm.bundle" "$RES/"
  chmod -R u+w "$RES/SwiftTerm_SwiftTerm.bundle" 2>/dev/null || true
fi

# App icon. Regenerate the .icns from the vector source if it's missing.
if [ ! -f "$ROOT/Resources/AppIcon.icns" ]; then
  echo "==> Generating app icon…"
  swift "$ROOT/scripts/make-icon.swift" /tmp/idealize-icon-master.png
  ICONSET=/tmp/AppIcon.iconset; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s /tmp/idealize-icon-master.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s*2)); sips -z $d $d /tmp/idealize-icon-master.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  mkdir -p "$ROOT/Resources"
  iconutil -c icns "$ICONSET" -o "$ROOT/Resources/AppIcon.icns"
fi
cp "$ROOT/Resources/AppIcon.icns" "$RES/AppIcon.icns"
# Bundle the wordmark logo for the in-app watermark.
[ -f "$ROOT/Resources/IDEalizeLogo.png" ] && cp "$ROOT/Resources/IDEalizeLogo.png" "$RES/IDEalizeLogo.png"
# Bundle the Flow companion skill + commands. FlowSkillInstaller copies these
# into the user's ~/.claude on launch so any project can review/run Flows.
[ -d "$ROOT/Resources/FlowSkills" ] && cp -R "$ROOT/Resources/FlowSkills" "$RES/FlowSkills"
# Bundle the "working" critter icons shown while Claude is busy.
[ -d "$ROOT/Resources/Critters" ] && cp -R "$ROOT/Resources/Critters" "$RES/Critters"

# Info.plist
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>IDEalize</string>
  <key>CFBundleDisplayName</key>     <string>IDEalize</string>
  <key>CFBundleExecutable</key>      <string>IDEalize</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>CFBundleIdentifier</key>      <string>com.idealize.terminal</string>
  <key>CFBundleVersion</key>         <string>3</string>
  <key>CFBundleShortVersionString</key> <string>0.2.0</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>LSMinimumSystemVersion</key>  <string>14.0</string>
  <key>NSHighResolutionCapable</key> <true/>
  <key>NSPrincipalClass</key>        <string>NSApplication</string>
  <key>LSApplicationCategoryType</key> <string>public.app-category.developer-tools</string>
  <key>NSMicrophoneUsageDescription</key> <string>IDEalize uses the microphone to dictate chat messages (press and hold the mic).</string>
  <key>NSSpeechRecognitionUsageDescription</key> <string>IDEalize transcribes your speech on-device to type chat messages.</string>
</dict>
</plist>
PLIST

chmod +x "$MACOS/IDEalize" "$HELPERS/idealize-cli"

# Prefer a STABLE self-signed identity so macOS remembers permission grants
# across rebuilds (run scripts/setup-signing.sh once). Fall back to ad-hoc.
SIGN_ID="IDEalize Local Signing"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  echo "==> Code signing with '$SIGN_ID' (permissions persist across rebuilds)…"
  IDENTITY="$SIGN_ID"
else
  echo "==> Ad-hoc code signing (run scripts/setup-signing.sh to stop re-prompts)…"
  IDENTITY="-"
fi
# Clean code-signing detritus. Two sources: (1) read-only SwiftPM-cache files
# whose xattrs block codesign; (2) iCloud/File-Provider stamping com.apple.
# FinderInfo on bundle *directories* (dist/ lives in a synced Obsidian vault),
# which codesign rejects as "resource fork … detritus".
chmod -R u+w "$APP" 2>/dev/null || true
xattr -cr "$APP" 2>/dev/null || true
# Sign the helper first (the app's outer sign seals the SwiftTerm resource bundle).
codesign --force --sign "$IDENTITY" "$HELPERS/idealize-cli" >/dev/null 2>&1 || true
# The FinderInfo strip MUST be the last thing before the outer sign — signing the
# helper (and the synced volume) re-stamps it, and codesign then rejects it.
strip_and_sign() {
  find "$APP" -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
  xattr -cr "$APP" 2>/dev/null || true
  codesign --force --sign "$IDENTITY" "$APP" >/dev/null 2>&1
}
if strip_and_sign || strip_and_sign; then
  echo "    Signed with: $(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
else
  echo "    (codesign failed — notifications may be limited)"
fi

# Move the finished (signed) bundle into the real dist/ location. The embedded
# signature survives the copy; iCloud may stamp the dir afterwards but that does
# not invalidate the seal.
echo "==> Installing to $FINAL_APP"
mkdir -p "$(dirname "$FINAL_APP")"
rm -rf "$FINAL_APP"
ditto "$APP" "$FINAL_APP"
rm -rf "$STAGE"
APP="$FINAL_APP"
HELPERS="$APP/Contents/Helpers"

echo "==> Done: $APP"
echo "    Signature: $(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1) ($(codesign -dv "$APP" 2>&1 | sed -n 's/.*flags=//p' | head -1))"
echo "    Optionally expose the CLI globally:"
echo "      ln -sf \"$HELPERS/idealize-cli\" /usr/local/bin/idealize"

if [ "$OPEN_AFTER" = "1" ]; then
  open "$APP"
fi
