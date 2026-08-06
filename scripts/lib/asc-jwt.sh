#!/usr/bin/env bash
#
# Signs an App Store Connect API JWT (ES256), used by scripts/testflight-notes.sh.
# Source this file, then call:
#   mint_asc_jwt <key_id> <issuer_id> <key_path>
# It echoes the signed JWT to stdout. App Store Connect API auth is a JWT
# signed with the .p8 key's ES256 private key (RFC 7518 3.4) -- xcodebuild's
# own -authenticationKeyPath handles this internally, but direct REST calls
# need one minted by hand. openssl performs the actual EC signing (DER-encoded);
# the inline python3 (stdlib only, no pip installs) does the DER-to-raw
# r||s conversion JWT ES256 requires, plus the base64url encoding.

mint_asc_jwt() {
    local key_id="$1" issuer_id="$2" key_path="$3"
    python3 - "$key_id" "$issuer_id" "$key_path" <<'PY'
import base64
import json
import subprocess
import sys
import time

key_id, issuer_id, key_path = sys.argv[1], sys.argv[2], sys.argv[3]


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def der_to_raw_signature(der, size=32):
    """SEQUENCE { INTEGER r, INTEGER s } -> raw r||s (RFC 7518 3.4)."""
    if der[0] != 0x30:
        raise ValueError("not a DER SEQUENCE")
    pos = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)

    def read_integer(data, offset):
        if data[offset] != 0x02:
            raise ValueError("expected DER INTEGER")
        length = data[offset + 1]
        start = offset + 2
        value = data[start:start + length].lstrip(b"\x00")
        return value, start + length

    r, pos = read_integer(der, pos)
    s, pos = read_integer(der, pos)
    return r.rjust(size, b"\x00") + s.rjust(size, b"\x00")


now = int(time.time())
header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
payload = {"iss": issuer_id, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}
signing_input = (
    b64url(json.dumps(header, separators=(",", ":")).encode())
    + "."
    + b64url(json.dumps(payload, separators=(",", ":")).encode())
)

result = subprocess.run(
    ["openssl", "dgst", "-sha256", "-sign", key_path],
    input=signing_input.encode(),
    capture_output=True,
    check=True,
)
raw_signature = der_to_raw_signature(result.stdout)
print(f"{signing_input}.{b64url(raw_signature)}")
PY
}
