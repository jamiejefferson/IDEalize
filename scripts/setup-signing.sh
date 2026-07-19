#!/bin/bash
# One-time: create a STABLE self-signed code-signing certificate so macOS
# remembers IDEalize's permission grants (microphone, speech, notifications,
# automation…) across rebuilds — instead of re-prompting every launch.
#
# Run once:  bash scripts/setup-signing.sh
# Then rebuild the app, approve each permission one final time, and they stick.
set -euo pipefail

CERT_NAME="IDEalize Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
  echo "✅ Signing identity '$CERT_NAME' already exists — nothing to do."
  exit 0
fi

echo "==> Creating self-signed code-signing certificate '$CERT_NAME'…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/cert.conf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $CERT_NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

# The .p12 needs an export password for `security import`. It only protects a
# temp file that is deleted on exit — but never hardcode one into the script.
if [ -n "${IDEALIZE_P12_PASSWORD:-}" ]; then
  P12_PASS="$IDEALIZE_P12_PASSWORD"
else
  read -r -s -p "Choose a one-time password for the temporary .p12: " P12_PASS
  echo ""
fi
if [ -z "$P12_PASS" ]; then
  echo "error: empty .p12 password (set IDEALIZE_P12_PASSWORD or type one when prompted)" >&2
  exit 1
fi

# 3-year key lifetime (not 10): limits how long a leaked local dev key stays usable.
if ! openssl req -x509 -newkey rsa:2048 -sha256 -days 1095 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.conf" >/dev/null 2>&1; then
  echo "error: openssl failed to generate the self-signed certificate" >&2
  exit 1
fi
if ! openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/cert.p12" -passout "pass:$P12_PASS" -name "$CERT_NAME" >/dev/null 2>&1; then
  echo "error: openssl failed to export the .p12" >&2
  exit 1
fi

echo "==> Importing into your login keychain (allows codesign to use it)…"
if ! security import "$TMP/cert.p12" -k "$KEYCHAIN" -P "$P12_PASS" -T /usr/bin/codesign; then
  echo "error: failed to import the certificate into $KEYCHAIN" >&2
  exit 1
fi

# NOTE: deliberately NOT marking this cert as a code-signing trust root
# (`security add-trusted-cert -r trustRoot`). Permission persistence (TCC)
# only needs a STABLE signing identity, not a trusted one — and making a local
# dev cert a trust root would let anything signed with it bypass trust checks
# if the key ever leaked.

# Avoid the repeated "codesign wants to use key" prompt by setting the partition
# list. Needs your LOGIN PASSWORD (same one you log in to the Mac with), read
# silently. Note: `security set-key-partition-list` only accepts the password
# as an argument, so it is briefly visible in `ps` while this one command runs.
echo ""
read -r -s -p "Enter your macOS login password (so codesign won't prompt each build): " PW
echo ""
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN" \
  && echo "==> Key access configured." \
  || echo "    (Could not set partition list — codesign may ask 'Always Allow' once; that's fine.)"
unset PW

echo ""
echo "✅ Done. Now rebuild:  scripts/build-app.sh"
echo "   Approve each permission one final time — they'll persist from then on."
