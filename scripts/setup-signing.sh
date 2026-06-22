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

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.conf" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/cert.p12" -passout pass:idealize -name "$CERT_NAME" >/dev/null 2>&1

echo "==> Importing into your login keychain (allows codesign to use it)…"
security import "$TMP/cert.p12" -k "$KEYCHAIN" -P idealize -T /usr/bin/codesign

# Mark the cert as trusted for code signing.
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem" 2>/dev/null || true

# Avoid the repeated "codesign wants to use key" prompt by setting the partition
# list. Needs your LOGIN PASSWORD (same one you log in to the Mac with).
echo ""
read -r -s -p "Enter your macOS login password (so codesign won't prompt each build): " PW
echo ""
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN" >/dev/null 2>&1 \
  && echo "==> Key access configured." \
  || echo "    (Could not set partition list — codesign may ask 'Always Allow' once; that's fine.)"

echo ""
echo "✅ Done. Now rebuild:  scripts/build-app.sh"
echo "   Approve each permission one final time — they'll persist from then on."
