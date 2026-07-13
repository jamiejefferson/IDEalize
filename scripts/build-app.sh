#!/bin/bash
# Build, sign, and package IDEalize as a verified macOS application archive.
#
#   scripts/build-app.sh [--debug] [--open] [--ad-hoc] [--disable-sandbox]
#
# The canonical output is one immutable, versioned ZIP in dist/. It is not
# published until clean extractions pass metadata, architecture, and strict
# signature checks. --open creates a clearly noncanonical local convenience
# copy.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd -P)"
HOME_CANONICAL="$(cd "$HOME" && pwd -P)"

APP_VERSION="0.1.1"
BUILD_VERSION="3"
BUNDLE_IDENTIFIER="com.idealize.terminal"
EXPECTED_ARCHITECTURE="arm64"

CONFIG="release"
OPEN_AFTER=0
ALLOW_AD_HOC=0
DISABLE_SWIFTPM_SANDBOX=0

for arg in "$@"; do
  case "$arg" in
    --debug)
      CONFIG="debug"
      ;;
    --open)
      OPEN_AFTER=1
      ;;
    --ad-hoc)
      ALLOW_AD_HOC=1
      ;;
    --disable-sandbox)
      DISABLE_SWIFTPM_SANDBOX=1
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

SIGNING_IDENTITY="IDEalize Local Signing"
if [ "$ALLOW_AD_HOC" = "1" ]; then
  IDENTITY="-"
  SIGNATURE_DESCRIPTION="ad hoc (-); local, non-notarized, no publisher identity"
  echo "==> Explicit ad-hoc signing mode enabled"
else
  AVAILABLE_IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  if [[ "$AVAILABLE_IDENTITIES" != *"$SIGNING_IDENTITY"* ]]; then
    echo "No valid '$SIGNING_IDENTITY' code-signing identity was found." >&2
    echo "For an explicitly local, non-notarized build, rerun with --ad-hoc." >&2
    exit 3
  fi
  IDENTITY="$SIGNING_IDENTITY"
  SIGNATURE_DESCRIPTION="$SIGNING_IDENTITY"
  echo "==> Configured signing identity selected: '$IDENTITY'"
fi

LOCKFILE="$ROOT/Package.resolved"
if [ ! -f "$LOCKFILE" ]; then
  echo "Required dependency lockfile is missing: $LOCKFILE" >&2
  exit 1
fi
LOCK_HASH_BEFORE="$(shasum -a 256 "$LOCKFILE" | awk '{print $1}')"

# Keep release staging outside the checkout and its File Provider volume. The
# override must be an existing absolute directory when used.
TMP_BASE="${IDEALIZE_PACKAGE_TMPDIR:-/private/tmp}"
TMP_BASE="${TMP_BASE%/}"
if [[ "$TMP_BASE" != /* ]] || [ ! -d "$TMP_BASE" ]; then
  echo "IDEALIZE_PACKAGE_TMPDIR must name an existing absolute directory" >&2
  exit 1
fi
TMP_BASE="$(cd "$TMP_BASE" && pwd -P)"
case "$TMP_BASE" in
  /private/tmp | /private/tmp/*) ;;
  *)
    echo "IDEALIZE_PACKAGE_TMPDIR must resolve beneath neutral /private/tmp" >&2
    exit 1
    ;;
esac
STAGE=""
VERIFY_STAGE=""
PRIMARY_CANDIDATE=""

cleanup() {
  if [ -n "$PRIMARY_CANDIDATE" ] && [ -e "$PRIMARY_CANDIDATE" ]; then
    rm -f -- "$PRIMARY_CANDIDATE"
  fi
  if [ -n "$VERIFY_STAGE" ] && [ -d "$VERIFY_STAGE" ]; then
    rm -rf -- "$VERIFY_STAGE"
  fi
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
    rm -rf -- "$STAGE"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

STAGE="$(mktemp -d "$TMP_BASE/idealize-package.XXXXXX")"
VERIFY_STAGE="$(mktemp -d "$TMP_BASE/idealize-verify.XXXXXX")"
BUILD_ROOT="$STAGE/swiftpm"

# A fresh scratch directory keeps SwiftPM's generated resource fallback path
# off the source checkout. Release artifacts intentionally contain no DWARF.
# Debug packaging uses narrowly targeted prefix maps that never include the
# module cache. Runtime-string and load-command gates below catch regressions.
SWIFT_BUILD_ARGS=(
  -c "$CONFIG"
  --scratch-path "$BUILD_ROOT"
  --force-resolved-versions
)
if [ "$CONFIG" = "release" ]; then
  SWIFT_BUILD_ARGS+=(-debug-info-format none)
else
  SWIFT_BUILD_ARGS+=(
    -Xswiftc -debug-prefix-map
    -Xswiftc "$ROOT=/IDEalize/Source"
    -Xswiftc -debug-prefix-map
    -Xswiftc "$BUILD_ROOT/checkouts=/IDEalize/Dependencies"
  )
fi
if [ "$DISABLE_SWIFTPM_SANDBOX" = "1" ]; then
  SWIFT_BUILD_ARGS+=(--disable-sandbox)
fi

echo "==> Building ($CONFIG) in an isolated SwiftPM scratch directory…"
echo "    Package.resolved SHA-256: $LOCK_HASH_BEFORE"
swift build "${SWIFT_BUILD_ARGS[@]}"

LOCK_HASH_AFTER="$(shasum -a 256 "$LOCKFILE" | awk '{print $1}')"
if [ "$LOCK_HASH_AFTER" != "$LOCK_HASH_BEFORE" ]; then
  echo "Package.resolved changed during the build" >&2
  exit 1
fi

BIN_DIR="$BUILD_ROOT/$CONFIG"
for binary in "$BIN_DIR/IDEalize" "$BIN_DIR/idealize-cli"; do
  if [ ! -f "$binary" ]; then
    echo "Required build output is missing: $binary" >&2
    exit 1
  fi
done

check_for_embedded_checkout_paths() {
  local binary="$1"
  local marker
  local matches

  for marker in \
    "/Users/" \
    "/var/folders/" \
    "$ROOT" \
    "$HOME_CANONICAL" \
    ".build/checkouts" \
    "$BUILD_ROOT/checkouts"; do
    matches="$(LC_ALL=C strings "$binary" | grep -F "$marker" || true)"
    if [ -n "$matches" ]; then
      echo "Sensitive checkout path marker '$marker' remains in $binary:" >&2
      echo "$matches" >&2
      return 1
    fi
  done
}

check_for_embedded_checkout_paths "$BIN_DIR/IDEalize"
check_for_embedded_checkout_paths "$BIN_DIR/idealize-cli"

check_release_path_inventory() {
  local binary="$1"
  local expected_fallback="$2"
  local fallback_count=0
  local path
  local debug_info
  local load_commands
  local marker

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      "/.build/debug/idealize-cli" | \
      "/.build/release/idealize-cli" | \
      "/Contents/Helpers/idealize-cli" | \
      "/Library/Application Support/IDEalize" | \
      "/Library/Application Support/IDEalize/bin" | \
      "/Library/Application Support/IDEalize/shell-integration" | \
      "/Resources/AppIcon.icns" | \
      "/Resources/IDEalizeLogo.png" | \
      "/System/Library/CoreServices/SystemVersion.plist")
        ;;
      "$expected_fallback")
        fallback_count=$((fallback_count + 1))
        ;;
      *)
        echo "Unexpected absolute runtime path remains in $binary: $path" >&2
        return 1
        ;;
    esac
  done < <(LC_ALL=C strings -a "$binary" | LC_ALL=C awk 'substr($0, 1, 1) == "/"' | LC_ALL=C sort -u)

  if [ -n "$expected_fallback" ]; then
    if [ "$fallback_count" -ne 1 ]; then
      echo "$binary must contain exactly one expected SwiftTerm fallback; found $fallback_count" >&2
      return 1
    fi
  elif [ "$fallback_count" -ne 0 ]; then
    echo "$binary unexpectedly contains a SwiftTerm fallback" >&2
    return 1
  fi

  debug_info="$(cd "$(dirname "$binary")" && xcrun dwarfdump --debug-info "$(basename "$binary")")"
  load_commands="$(cd "$(dirname "$binary")" && otool -l "$(basename "$binary")")"
  for marker in \
    "/Users/" \
    "/private/tmp/" \
    "/var/folders/" \
    "$ROOT" \
    "$HOME_CANONICAL" \
    ".build/checkouts" \
    "$BUILD_ROOT/checkouts"; do
    if grep -Fq "$marker" <<< "$debug_info"; then
      echo "Sensitive path marker '$marker' remains in DWARF for $binary" >&2
      return 1
    fi
    if grep -Fq "$marker" <<< "$load_commands"; then
      echo "Sensitive path marker '$marker' remains in Mach-O load commands for $binary" >&2
      return 1
    fi
  done
}

if [ "$CONFIG" = "release" ]; then
  CANONICAL_BIN_DIR="$(cd "$BIN_DIR" && pwd -P)"
  EXPECTED_SWIFTTERM_FALLBACK="$CANONICAL_BIN_DIR/SwiftTerm_SwiftTerm.bundle"
  case "$EXPECTED_SWIFTTERM_FALLBACK" in
    /private/tmp/idealize-package.??????/swiftpm/*/release/SwiftTerm_SwiftTerm.bundle) ;;
    *)
      echo "SwiftTerm fallback is outside the one allowed neutral scratch pattern: $EXPECTED_SWIFTTERM_FALLBACK" >&2
      exit 1
      ;;
  esac
  check_release_path_inventory "$BIN_DIR/IDEalize" "$EXPECTED_SWIFTTERM_FALLBACK"
  check_release_path_inventory "$BIN_DIR/idealize-cli" ""
fi

SWIFTTERM_RESOURCES="$BIN_DIR/SwiftTerm_SwiftTerm.bundle"
for required_path in \
  "$SWIFTTERM_RESOURCES" \
  "$ROOT/Resources/AppIcon.icns" \
  "$ROOT/Resources/IDEalizeLogo.png" \
  "$ROOT/THIRD_PARTY_NOTICES.md"; do
  if [ ! -e "$required_path" ]; then
    echo "Required packaging input is missing: $required_path" >&2
    exit 1
  fi
done

APP="$STAGE/IDEalize.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
HELPERS="$CONTENTS/Helpers"

echo "==> Assembling bundle at $APP"
mkdir -p "$MACOS" "$RESOURCES" "$HELPERS"

/usr/bin/install -m 0755 "$BIN_DIR/IDEalize" "$MACOS/IDEalize"
/usr/bin/install -m 0755 "$BIN_DIR/idealize-cli" "$HELPERS/idealize-cli"
ditto --noextattr --noqtn "$SWIFTTERM_RESOURCES" "$RESOURCES/SwiftTerm_SwiftTerm.bundle"
chmod -R u+w "$RESOURCES/SwiftTerm_SwiftTerm.bundle"
/usr/bin/install -m 0644 "$ROOT/Resources/AppIcon.icns" "$RESOURCES/AppIcon.icns"
/usr/bin/install -m 0644 "$ROOT/Resources/IDEalizeLogo.png" "$RESOURCES/IDEalizeLogo.png"
/usr/bin/install -m 0644 "$ROOT/THIRD_PARTY_NOTICES.md" "$RESOURCES/THIRD_PARTY_NOTICES.md"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>IDEalize</string>
  <key>CFBundleDisplayName</key>     <string>IDEalize</string>
  <key>CFBundleExecutable</key>      <string>IDEalize</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>CFBundleIdentifier</key>      <string>$BUNDLE_IDENTIFIER</string>
  <key>CFBundleVersion</key>         <string>$BUILD_VERSION</string>
  <key>CFBundleShortVersionString</key> <string>$APP_VERSION</string>
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

validate_bundle() {
  local bundle="$1"
  local label="$2"
  local plist="$bundle/Contents/Info.plist"
  local actual
  local executable
  local architectures

  if [ ! -d "$bundle" ]; then
    echo "$label is missing: $bundle" >&2
    return 1
  fi

  if [ ! -d "$bundle/Contents/Resources/SwiftTerm_SwiftTerm.bundle" ]; then
    echo "$label is missing the SwiftTerm resource bundle" >&2
    return 1
  fi

  plutil -lint "$plist"

  actual="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
  if [ "$actual" != "$BUNDLE_IDENTIFIER" ]; then
    echo "$label has bundle identifier '$actual'; expected '$BUNDLE_IDENTIFIER'" >&2
    return 1
  fi

  actual="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
  if [ "$actual" != "$APP_VERSION" ]; then
    echo "$label has version '$actual'; expected '$APP_VERSION'" >&2
    return 1
  fi

  actual="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")"
  if [ "$actual" != "$BUILD_VERSION" ]; then
    echo "$label has build '$actual'; expected '$BUILD_VERSION'" >&2
    return 1
  fi

  for executable in \
    "$bundle/Contents/MacOS/IDEalize" \
    "$bundle/Contents/Helpers/idealize-cli"; do
    if [ ! -x "$executable" ]; then
      echo "$label is missing executable: $executable" >&2
      return 1
    fi
    architectures="$(lipo -archs "$executable")"
    if [ "$architectures" != "$EXPECTED_ARCHITECTURE" ]; then
      echo "$label executable $executable has architectures '$architectures'; expected exactly thin $EXPECTED_ARCHITECTURE" >&2
      return 1
    fi
  done

  codesign --verify --strict --verbose=2 "$bundle/Contents/Helpers/idealize-cli"
  codesign --verify --deep --strict --verbose=2 "$bundle"
}

validate_extracted_archive() {
  local archive="$1"
  local extraction_root="$2"
  local unexpected

  mkdir -p "$extraction_root"
  ditto -x -k "$archive" "$extraction_root"

  unexpected="$(find "$extraction_root" -mindepth 1 -maxdepth 1 ! -name 'IDEalize.app' -print -quit)"
  if [ -n "$unexpected" ] || [ ! -d "$extraction_root/IDEalize.app" ]; then
    echo "Archive must contain exactly one top-level IDEalize.app bundle" >&2
    return 1
  fi

  validate_bundle "$extraction_root/IDEalize.app" "Extracted archive"
}

plutil -lint "$CONTENTS/Info.plist"
xattr -cr "$APP"

# The helper must be signed first because the outer application signature seals
# it as nested code. Any signing or verification failure aborts the package.
echo "==> Signing with $SIGNATURE_DESCRIPTION"
codesign --force --sign "$IDENTITY" "$HELPERS/idealize-cli"
codesign --verify --strict --verbose=2 "$HELPERS/idealize-cli"
codesign --force --sign "$IDENTITY" "$APP"
validate_bundle "$APP" "Staged bundle"

if [ "$CONFIG" = "release" ]; then
  PRIMARY_ARCHIVE_NAME="IDEalize-$APP_VERSION-build$BUILD_VERSION-macOS.zip"
else
  PRIMARY_ARCHIVE_NAME="IDEalize-$APP_VERSION-build$BUILD_VERSION-macOS-debug.zip"
fi

ARCHIVE="$STAGE/$PRIMARY_ARCHIVE_NAME"
echo "==> Creating $PRIMARY_ARCHIVE_NAME"
ditto -c -k --norsrc --keepParent "$APP" "$ARCHIVE"

# Verify a clean extraction in a temp directory distinct from bundle staging.
validate_extracted_archive "$ARCHIVE" "$VERIFY_STAGE/staged-archive"

DIST_DIR="$ROOT/dist"
FINAL_ARCHIVE="$DIST_DIR/$PRIMARY_ARCHIVE_NAME"
mkdir -p "$DIST_DIR"
PRIMARY_CANDIDATE="$(mktemp "$DIST_DIR/.$PRIMARY_ARCHIVE_NAME.candidate.XXXXXX")"
cp -X "$ARCHIVE" "$PRIMARY_CANDIDATE"
chmod 0644 "$PRIMARY_CANDIDATE"

if ! cmp -s "$ARCHIVE" "$PRIMARY_CANDIDATE"; then
  echo "Versioned archive bytes changed while copying the candidate to dist" >&2
  exit 1
fi

# The hidden candidate is clean-extracted and fully validated before the public
# path is touched.
validate_extracted_archive "$PRIMARY_CANDIDATE" "$VERIFY_STAGE/primary-candidate"
ARCHIVE_SHA256="$(shasum -a 256 "$PRIMARY_CANDIDATE" | awk '{print $1}')"

# link(2) publication is atomic and cannot replace an existing pathname. A
# byte-identical artifact is reusable; different bytes require a new build
# number so previously published rollback artifacts remain immutable.
if [ -e "$FINAL_ARCHIVE" ]; then
  if cmp -s "$PRIMARY_CANDIDATE" "$FINAL_ARCHIVE"; then
    PUBLICATION_STATUS="reused byte-identical existing artifact"
  else
    echo "Canonical artifact already exists with different bytes: $FINAL_ARCHIVE" >&2
    echo "Increment CFBundleVersion before publishing a different build." >&2
    exit 1
  fi
elif ln "$PRIMARY_CANDIDATE" "$FINAL_ARCHIVE"; then
  PUBLICATION_STATUS="atomically published without overwrite"
else
  # Another process may have won the no-overwrite race. Reuse only if its bytes
  # are exactly the candidate; otherwise leave it untouched and fail closed.
  if [ -f "$FINAL_ARCHIVE" ] && cmp -s "$PRIMARY_CANDIDATE" "$FINAL_ARCHIVE"; then
    PUBLICATION_STATUS="reused byte-identical concurrently published artifact"
  else
    echo "Could not publish immutable canonical artifact: $FINAL_ARCHIVE" >&2
    exit 1
  fi
fi

echo "==> Verified artifact: $FINAL_ARCHIVE"
echo "    Publication: $PUBLICATION_STATUS"
echo "    Version: $APP_VERSION ($BUILD_VERSION)"
echo "    Bundle ID: $BUNDLE_IDENTIFIER"
echo "    Architecture: $EXPECTED_ARCHITECTURE"
echo "    Signature: $SIGNATURE_DESCRIPTION"
echo "    Package.resolved: $LOCK_HASH_AFTER (unchanged)"
echo "    SHA-256: $ARCHIVE_SHA256"

if [ -d "$DIST_DIR/IDEalize.app" ]; then
  echo "    Note: existing dist/IDEalize.app is not produced or validated by this build; do not install it."
fi

if [ "$OPEN_AFTER" = "1" ]; then
  LOCAL_APP="$DIST_DIR/IDEalize-local.app"
  rm -rf -- "$LOCAL_APP"
  ditto --noextattr --noqtn "$VERIFY_STAGE/primary-candidate/IDEalize.app" "$LOCAL_APP"
  xattr -cr "$LOCAL_APP"
  validate_bundle "$LOCAL_APP" "Noncanonical local convenience copy"
  echo "    Opening noncanonical development copy: $LOCAL_APP"
  echo "    Install only from the verified ZIP above."
  open "$LOCAL_APP"
fi
