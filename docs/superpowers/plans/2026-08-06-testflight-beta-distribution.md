# TestFlight Beta Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the scriptable/documentable parts of TestFlight beta distribution: an accurate export-compliance declaration, a script to set a build's "What to Test" beta notes via the App Store Connect API, and documentation tying the existing upload path, the new script, and the remaining manual App Store Connect steps into one beta-release flow.

**Architecture:** `scripts/release.sh` already archives, signs, and uploads to App Store Connect — that upload *is* the TestFlight build-upload path, unchanged. This plan adds one Info.plist key, two small sourced bash libraries under `scripts/lib/` (ASC API key resolution, extracted out of `release.sh`; JWT minting, new), a new standalone script `scripts/testflight-notes.sh` that uses both libraries to call the App Store Connect REST API, and a new section in `docs/release.md`.

**Tech Stack:** Bash (`set -euo pipefail`, matching `scripts/release.sh`'s style), `openssl` for ES256 signing, `python3` (stdlib only — no pip installs) for JWT encoding, `curl` + `jq` for the REST calls (both already used elsewhere in `scripts/`).

**Deviation from the approved spec:** [docs/superpowers/specs/2026-08-06-testflight-beta-distribution-design.md](../specs/2026-08-06-testflight-beta-distribution-design.md) specified a standalone `scripts/lib/asc-jwt.py` file. While mapping out files for this plan, three existing scripts (`check-xcodeproj-sync.sh`, `generate-swift-attributions.sh`, `check-localization-catalog.sh`) turned up an established repo convention: python3 is invoked inline via a `python3 - <<'PY' ... PY` heredoc inside a `.sh` file, not as a standalone `.py` file. This plan follows that convention: the JWT logic lives in `scripts/lib/asc-jwt.sh`, a sourced bash library exposing one function (`mint_asc_jwt`) that internally runs the python3 heredoc — mirroring `scripts/lib/resolve-asc-key.sh`'s function-per-file shape. Behavior, algorithm, and testability are unchanged from the spec; only the file split changes.

## Global Constraints

- Bundle id is `io.dwk.anglesite` (hardcoded, matches `scripts/release.sh` and `docs/release.md`).
- Only the `en-US` locale is handled — matches `CFBundleDevelopmentRegion` in `Resources/Info.plist`; no other locales are in scope.
- No new external or pip dependencies. Only `openssl`, `python3` (stdlib only), `curl`, and `jq` — all already available on any dev machine that runs `scripts/release.sh`, and `jq` already has precedent in `scripts/vendor-container-kernel.sh` and `scripts/lib/artifact-lock.sh`.
- Match `scripts/release.sh`'s style: `set -euo pipefail`, `bail()`/`step()` helpers, numbered `step "N/M ..."` headers, `-h|--help` served by `sed`-slicing the script's own header comment.
- Sourced libraries under `scripts/lib/` are non-executable (`chmod 644`), matching `scripts/lib/artifact-lock.sh` and `scripts/lib/container-cli.sh`. Standalone scripts directly under `scripts/` are executable (`chmod 755`), matching `scripts/release.sh` and `scripts/lib/stage-dev-image-context.sh`.
- App Store Connect app-record creation and TestFlight tester-group membership are **not** automated anywhere in this plan — they're documented as a manual checklist only.
- Conventional commits, subject line ≤72 characters, issue number referenced, per `CONTRIBUTING.md`.

---

### Task 1: Export compliance declaration

**Files:**
- Modify: `Resources/Info.plist`

**Interfaces:** None — standalone config change.

- [ ] **Step 1: Add the export compliance key**

Edit `Resources/Info.plist`. Insert a new key right after the existing `NSHumanReadableCopyright` entry (around line 30):

```xml
	<key>NSHumanReadableCopyright</key>
	<string>Copyright © 2026 David W. Keith. ISC License.</string>
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
```

- [ ] **Step 2: Validate plist syntax**

Run: `plutil -lint Resources/Info.plist`
Expected: `Resources/Info.plist: OK`

- [ ] **Step 3: Confirm the key round-trips correctly**

Run: `plutil -extract ITSAppUsesNonExemptEncryption raw Resources/Info.plist`
Expected: `false`

- [ ] **Step 4: Confirm the app still builds**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: build succeeds (`** BUILD SUCCEEDED **`).

- [ ] **Step 5: Commit**

```bash
git add Resources/Info.plist
git commit -m "$(cat <<'EOF'
feat(#766): declare export compliance for App Store Connect

Anglesite only uses standard HTTPS/TLS via system frameworks (no custom
cryptography), so ITSAppUsesNonExemptEncryption=false is accurate. This
lets App Store Connect skip the manual export-compliance prompt that
otherwise blocks every upload from processing, including TestFlight builds.
EOF
)"
```

---

### Task 2: Extract shared ASC API key resolution

**Files:**
- Create: `scripts/lib/resolve-asc-key.sh`
- Modify: `scripts/release.sh:58` (add `source` call), `scripts/release.sh:107-130` (replace inline block with a function call)

**Interfaces:**
- Produces: `resolve_asc_key_path <key_id>` — bash function. Echoes the absolute path to `AuthKey_<key_id>.p8` to stdout. Honors an `ASC_API_KEY_PATH` env var override; otherwise searches `~/.appstoreconnect/private_keys/`, `~/.private_keys/`, `~/private_keys/`, `./private_keys/` in that order. Calls `bail "<message>"` (must already be defined by the sourcing script) and does not return on failure.

- [ ] **Step 1: Capture baseline behavior before refactoring**

Run (from repo root, no env vars set): `scripts/release.sh 2>&1 | tail -3`
Expected: exits non-zero, last line is `error: TEAM_ID is unset. Export your 10-character Apple Developer Team ID and re-run.` — write this down, it must be identical after the refactor.

- [ ] **Step 2: Create the shared library**

Create `scripts/lib/resolve-asc-key.sh`:

```bash
#!/usr/bin/env bash
#
# Shared App Store Connect API key resolution, used by scripts/release.sh and
# scripts/testflight-notes.sh. Source this file, then call:
#   resolve_asc_key_path <key_id>
# It echoes the absolute path to AuthKey_<key_id>.p8, honoring an explicit
# ASC_API_KEY_PATH override or searching the standard private_keys
# directories. Requires the sourcing script to define bail().

resolve_asc_key_path() {
    local key_id="$1" key_path=""
    if [[ -n "${ASC_API_KEY_PATH:-}" ]]; then
        [[ -f "$ASC_API_KEY_PATH" ]] || bail "ASC_API_KEY_PATH is set but no file exists at $ASC_API_KEY_PATH."
        key_path="$ASC_API_KEY_PATH"
    else
        local dir
        for dir in "$HOME/.appstoreconnect/private_keys" "$HOME/.private_keys" "$HOME/private_keys" "./private_keys"; do
            if [[ -f "$dir/AuthKey_${key_id}.p8" ]]; then
                key_path="$dir/AuthKey_${key_id}.p8"
                break
            fi
        done
        [[ -n "$key_path" ]] \
            || bail "AuthKey_${key_id}.p8 not found in ~/.appstoreconnect/private_keys/ or ~/.private_keys/. Install the .p8 there or set ASC_API_KEY_PATH."
    fi
    # Callers (openssl, xcodebuild) need an absolute path; normalize.
    echo "$(cd "$(dirname "$key_path")" && pwd)/$(basename "$key_path")"
}
```

Do not `chmod +x` this file — sourced libraries in `scripts/lib/` stay non-executable (matches `scripts/lib/artifact-lock.sh`).

- [ ] **Step 3: Refactor `scripts/release.sh` to use the shared library**

In `scripts/release.sh`, right after the `REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"` line (line 59), add:

```bash
# shellcheck source=scripts/lib/resolve-asc-key.sh
source "$SCRIPT_DIR/lib/resolve-asc-key.sh"
```

Then replace the inline key-search block. Find this in `scripts/release.sh` (originally lines 113-130, inside the `if [[ "$VALIDATE_ONLY" -eq 0 ]]; then` block):

```bash
    # xcodebuild (unlike altool) needs the API key file path spelled out; search the
    # standard private_keys locations unless ASC_API_KEY_PATH points at it directly.
    if [[ -n "${ASC_API_KEY_PATH:-}" ]]; then
        [[ -f "$ASC_API_KEY_PATH" ]] || bail "ASC_API_KEY_PATH is set but no file exists at $ASC_API_KEY_PATH."
        ASC_KEY_PATH="$ASC_API_KEY_PATH"
    else
        for dir in "$HOME/.appstoreconnect/private_keys" "$HOME/.private_keys" "$HOME/private_keys" "./private_keys"; do
            if [[ -f "$dir/AuthKey_${ASC_API_KEY_ID}.p8" ]]; then
                ASC_KEY_PATH="$dir/AuthKey_${ASC_API_KEY_ID}.p8"
                break
            fi
        done
        [[ -n "$ASC_KEY_PATH" ]] \
            || bail "AuthKey_${ASC_API_KEY_ID}.p8 not found in ~/.appstoreconnect/private_keys/ or ~/.private_keys/. Install the .p8 there or set ASC_API_KEY_PATH."
    fi
    # xcodebuild requires -authenticationKeyPath to be absolute; normalize.
    ASC_KEY_PATH="$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)/$(basename "$ASC_KEY_PATH")"
```

Replace it with:

```bash
    # xcodebuild (unlike altool) needs the API key file path spelled out.
    ASC_KEY_PATH="$(resolve_asc_key_path "$ASC_API_KEY_ID")"
```

- [ ] **Step 4: Syntax-check both files**

Run: `bash -n scripts/release.sh scripts/lib/resolve-asc-key.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Lint both files**

Run: `shellcheck scripts/release.sh scripts/lib/resolve-asc-key.sh`
Expected: no new errors introduced by this change (pre-existing warnings on lines this task didn't touch are fine — this repo's CI doesn't currently gate on shellcheck).

- [ ] **Step 6: Re-run the baseline check to confirm no regression**

Run (from repo root, no env vars set): `scripts/release.sh 2>&1 | tail -3`
Expected: identical to Step 1's output — `error: TEAM_ID is unset. ...`. This confirms the refactor didn't change preflight behavior for the path exercised without real credentials (the `ASC_KEY_PATH` block itself only runs after `TEAM_ID`/`PROVISIONING_PROFILE` checks pass, so this doesn't yet exercise `resolve_asc_key_path` directly — Step 7 does that).

- [ ] **Step 7: Test `resolve_asc_key_path` directly**

Run:

```bash
bash -c '
source scripts/lib/resolve-asc-key.sh
bail() { echo "bail: $*" >&2; exit 1; }
tmpkey=$(mktemp /tmp/AuthKey_TESTKEY.XXXXXX.p8)
ASC_API_KEY_PATH="$tmpkey" resolve_asc_key_path TESTKEY
rm -f "$tmpkey"
'
```

Expected: prints the absolute path to the temp file (e.g. `/tmp/AuthKey_TESTKEY.abc123.p8`), exit 0.

Run:

```bash
bash -c '
source scripts/lib/resolve-asc-key.sh
bail() { echo "bail: $*" >&2; exit 1; }
ASC_API_KEY_PATH="/nonexistent/AuthKey_X.p8" resolve_asc_key_path X
'; echo "exit: $?"
```

Expected: prints `bail: ASC_API_KEY_PATH is set but no file exists at /nonexistent/AuthKey_X.p8` to stderr, then `exit: 1`.

- [ ] **Step 8: Commit**

```bash
git add scripts/release.sh scripts/lib/resolve-asc-key.sh
git commit -m "$(cat <<'EOF'
refactor(#766): extract ASC API key resolution into shared lib

scripts/testflight-notes.sh (next commit) needs the same .p8 key-search
logic scripts/release.sh already has. Pull it into scripts/lib/resolve-asc-key.sh
so both scripts share one implementation.
EOF
)"
```

---

### Task 3: JWT minting library

**Files:**
- Create: `scripts/lib/asc-jwt.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mint_asc_jwt <key_id> <issuer_id> <key_path>` — bash function. Echoes a signed ES256 App Store Connect API JWT (20-minute expiry) to stdout. `key_path` must be a PEM-format EC private key file (an ASC `.p8` AuthKey, or any `prime256v1` EC key for testing).

- [ ] **Step 1: Create the library**

Create `scripts/lib/asc-jwt.sh`:

```bash
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
```

Do not `chmod +x` — sourced library, non-executable, matching Task 2's `resolve-asc-key.sh`.

- [ ] **Step 2: Syntax-check**

Run: `bash -n scripts/lib/asc-jwt.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Generate a throwaway EC test key**

```bash
openssl ecparam -genkey -name prime256v1 -noout -out /tmp/asc-test-key.pem
openssl ec -in /tmp/asc-test-key.pem -pubout -out /tmp/asc-test-pub.pem
```

Expected: `openssl ec` prints `writing EC key` to stderr; both files exist.

- [ ] **Step 4: Mint a JWT with the test key and inspect its shape**

```bash
bash -c '
source scripts/lib/asc-jwt.sh
mint_asc_jwt "TESTKEY123" "00000000-0000-0000-0000-000000000000" "/tmp/asc-test-key.pem"
' | tee /tmp/asc-test.jwt
```

Expected: prints one line with three `.`-separated base64url segments (no `=` padding, no `+`/`/` characters).

- [ ] **Step 5: Decode header and payload, confirm contents**

```bash
python3 -c "
import base64, json
def b64url_decode(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
with open('/tmp/asc-test.jwt') as f:
    header_b64, payload_b64, _ = f.read().strip().split('.')
print(json.loads(b64url_decode(header_b64)))
print(json.loads(b64url_decode(payload_b64)))
"
```

Expected:
```
{'alg': 'ES256', 'kid': 'TESTKEY123', 'typ': 'JWT'}
{'iss': '00000000-0000-0000-0000-000000000000', 'iat': <unix timestamp>, 'exp': <iat + 1200>, 'aud': 'appstoreconnect-v1'}
```

- [ ] **Step 6: Verify the signature cryptographically**

Reconstruct a DER signature from the JWT's raw `r‖s` third segment, then verify it against the test public key with `openssl`:

```bash
JWT="$(cat /tmp/asc-test.jwt)"
SIGNING_INPUT="$(echo "$JWT" | cut -d. -f1).$(echo "$JWT" | cut -d. -f2)"
SIG_B64="$(echo "$JWT" | cut -d. -f3)"

python3 -c "
import base64, sys
sig_b64 = '$SIG_B64'
pad = '=' * (-len(sig_b64) % 4)
raw = base64.urlsafe_b64decode(sig_b64 + pad)
r, s = raw[:32], raw[32:]

def encode_int(b):
    b = b.lstrip(b'\x00')
    if not b or b[0] & 0x80:
        b = b'\x00' + b
    return b'\x02' + bytes([len(b)]) + b

body = encode_int(r) + encode_int(s)
der = b'\x30' + bytes([len(body)]) + body
sys.stdout.buffer.write(der)
" > /tmp/asc-test-sig.der

printf '%s' "$SIGNING_INPUT" | openssl dgst -sha256 -verify /tmp/asc-test-pub.pem -signature /tmp/asc-test-sig.der
```

Expected: `Verified OK`. This confirms `mint_asc_jwt`'s signing and DER-to-raw conversion are correct, independent of any real App Store Connect credentials.

- [ ] **Step 7: Clean up test artifacts**

```bash
rm -f /tmp/asc-test-key.pem /tmp/asc-test-pub.pem /tmp/asc-test.jwt /tmp/asc-test-sig.der
```

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/asc-jwt.sh
git commit -m "$(cat <<'EOF'
feat(#766): add ASC API JWT minting library

scripts/testflight-notes.sh (next commit) needs a signed App Store Connect
API token to call the REST API directly -- xcodebuild's built-in
-authenticationKeyPath auth doesn't cover that. mint_asc_jwt signs one
with openssl and converts the DER signature to the raw r||s format
JWT ES256 requires.
EOF
)"
```

---

### Task 4: `scripts/testflight-notes.sh`

**Files:**
- Create: `scripts/testflight-notes.sh`

**Interfaces:**
- Consumes: `resolve_asc_key_path(key_id) -> path` from `scripts/lib/resolve-asc-key.sh` (Task 2); `mint_asc_jwt(key_id, issuer_id, key_path) -> jwt` from `scripts/lib/asc-jwt.sh` (Task 3).
- Produces: nothing consumed by later tasks — this is the top-level entry point.

- [ ] **Step 1: Create the script**

Create `scripts/testflight-notes.sh`:

```bash
#!/usr/bin/env bash
#
# Sets the "What to Test" beta notes on an already-uploaded App Store Connect
# build, via the App Store Connect REST API (xcodebuild/altool have no CLI
# flag for this -- TestFlight beta build localizations are API-only).
#
# scripts/release.sh uploads the build; App Store Connect builds land in
# TestFlight automatically once processed, so there is no separate
# "TestFlight upload" step. Run this after that upload finishes processing.
#
# Prerequisites: same App Store Connect API key as scripts/release.sh. See
# docs/release.md "TestFlight Beta Distribution".
#
# Usage:
#   ASC_API_KEY_ID=XXXXXXXXXX ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
#     scripts/testflight-notes.sh --notes "Try the new site importer." [--build 42] [--dry-run]
#
#   --notes TEXT       "What to Test" text for the build (mutually exclusive
#                       with --notes-file).
#   --notes-file PATH  Read "What to Test" text from a file.
#   --build N          Build number to target (default: CURRENT_PROJECT_VERSION
#                       from project.yml).
#   --dry-run          Mint the JWT and print every API request that would be
#                       made, without sending any of them. No network access;
#                       safe to run without live App Store Connect credentials.
#
# Env:
#   ASC_API_KEY_ID        (required) App Store Connect API key id.
#   ASC_API_ISSUER_ID     (required) App Store Connect API issuer id.
#   ASC_API_KEY_PATH      (optional) Explicit path to AuthKey_<key id>.p8; see
#                         scripts/lib/resolve-asc-key.sh for the default search.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ID="io.dwk.anglesite"
LOCALE="en-US"
API_BASE="https://api.appstoreconnect.apple.com/v1"

bail() { printf 'error: %s\n' "$*" >&2; exit 1; }
step() { printf '\n=== %s ===\n' "$*"; }

# shellcheck source=scripts/lib/resolve-asc-key.sh
source "$SCRIPT_DIR/lib/resolve-asc-key.sh"
# shellcheck source=scripts/lib/asc-jwt.sh
source "$SCRIPT_DIR/lib/asc-jwt.sh"

NOTES=""
NOTES_FILE=""
BUILD_NUMBER=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --notes) NOTES="$2"; shift 2 ;;
        --notes-file) NOTES_FILE="$2"; shift 2 ;;
        --build) BUILD_NUMBER="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
        *) bail "unknown argument '$1'" ;;
    esac
done

# --- Preflight ---------------------------------------------------------------
step "0/5 preflight"

[[ -n "$NOTES" && -n "$NOTES_FILE" ]] && bail "--notes and --notes-file are mutually exclusive."
[[ -z "$NOTES" && -z "$NOTES_FILE" ]] && bail "one of --notes or --notes-file is required."
if [[ -n "$NOTES_FILE" ]]; then
    [[ -f "$NOTES_FILE" ]] || bail "--notes-file '$NOTES_FILE' does not exist."
    NOTES="$(cat "$NOTES_FILE")"
fi
[[ -n "$NOTES" ]] || bail "notes text is empty."

[[ -n "${ASC_API_KEY_ID:-}" ]] || bail "ASC_API_KEY_ID is unset."
[[ -n "${ASC_API_ISSUER_ID:-}" ]] || bail "ASC_API_ISSUER_ID is unset."

for cmd in openssl python3 curl jq; do
    command -v "$cmd" >/dev/null || bail "$cmd not on PATH."
done

ASC_KEY_PATH="$(resolve_asc_key_path "$ASC_API_KEY_ID")"

if [[ -z "$BUILD_NUMBER" ]]; then
    BUILD_NUMBER="$(awk -F': *' '/CURRENT_PROJECT_VERSION:/{print $2; exit}' "$REPO_ROOT/project.yml" | tr -d '"')"
    [[ -n "$BUILD_NUMBER" ]] || bail "could not read CURRENT_PROJECT_VERSION from project.yml; pass --build explicitly."
fi
MARKETING_VERSION="$(awk -F': *' '/MARKETING_VERSION:/{print $2; exit}' "$REPO_ROOT/project.yml" | tr -d '"')"
[[ -n "$MARKETING_VERSION" ]] || bail "could not read MARKETING_VERSION from project.yml."

echo "  build:   $BUILD_NUMBER (marketing version $MARKETING_VERSION)"
echo "  locale:  $LOCALE"
echo "  mode:    $([[ "$DRY_RUN" -eq 1 ]] && echo 'dry-run (no network calls)' || echo 'live')"

# --- Mint JWT ------------------------------------------------------------------
step "1/5 mint App Store Connect API JWT"
JWT="$(mint_asc_jwt "$ASC_API_KEY_ID" "$ASC_API_ISSUER_ID" "$ASC_KEY_PATH")"
[[ -n "$JWT" ]] || bail "failed to mint JWT."
echo "  minted."

api_call() {
    # api_call METHOD PATH [JSON_BODY]
    local method="$1" path="$2" body="${3:-}"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "  [dry-run] $method $API_BASE$path" >&2
        [[ -n "$body" ]] && echo "  [dry-run] body: $body" >&2
        echo "{}"
        return 0
    fi
    if [[ -n "$body" ]]; then
        curl -sS -X "$method" "$API_BASE$path" \
            -H "Authorization: Bearer $JWT" \
            -H "Content-Type: application/json" \
            -d "$body"
    else
        curl -sS -X "$method" "$API_BASE$path" \
            -H "Authorization: Bearer $JWT"
    fi
}

# --- Look up app id -------------------------------------------------------------
step "2/5 look up app id for $BUNDLE_ID"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] GET $API_BASE/apps?filter[bundleId]=$BUNDLE_ID"
    APP_ID="DRYRUN_APP_ID"
else
    APP_RESPONSE="$(api_call GET "/apps?filter[bundleId]=$BUNDLE_ID")"
    APP_ID="$(jq -r '.data[0].id // empty' <<<"$APP_RESPONSE")"
    [[ -n "$APP_ID" ]] || bail "no app found for bundle id $BUNDLE_ID. Has the App Store Connect app record been created?"
fi
echo "  app id: $APP_ID"

# --- Find and wait for the build -------------------------------------------------
step "3/5 find build $BUILD_NUMBER (version $MARKETING_VERSION)"
BUILD_PATH="/builds?filter[app]=$APP_ID&filter[version]=$BUILD_NUMBER&filter[preReleaseVersion.version]=$MARKETING_VERSION"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] GET $API_BASE$BUILD_PATH"
    BUILD_ID="DRYRUN_BUILD_ID"
else
    ATTEMPTS=30
    BUILD_ID=""
    for ((i = 1; i <= ATTEMPTS; i++)); do
        BUILD_RESPONSE="$(api_call GET "$BUILD_PATH")"
        BUILD_ID="$(jq -r '.data[0].id // empty' <<<"$BUILD_RESPONSE")"
        [[ -n "$BUILD_ID" ]] || bail "no build found for version $MARKETING_VERSION build $BUILD_NUMBER. Has scripts/release.sh uploaded it yet?"
        PROCESSING_STATE="$(jq -r '.data[0].attributes.processingState' <<<"$BUILD_RESPONSE")"
        case "$PROCESSING_STATE" in
            VALID) break ;;
            FAILED|INVALID) bail "build $BUILD_NUMBER processing state is $PROCESSING_STATE -- check App Store Connect for details." ;;
            *)
                [[ "$i" -eq "$ATTEMPTS" ]] && bail "build $BUILD_NUMBER still $PROCESSING_STATE after $((ATTEMPTS * 30 / 60)) minutes; re-run once App Store Connect finishes processing it."
                echo "  processing ($PROCESSING_STATE), waiting 30s... ($i/$ATTEMPTS)"
                sleep 30
                ;;
        esac
    done
fi
echo "  build id: $BUILD_ID"

# --- Set What to Test -------------------------------------------------------------
step "4/5 set What to Test ($LOCALE)"
NOTES_JSON="$(jq -n --arg notes "$NOTES" '$notes')"
LOCALIZATION_PATH="/betaBuildLocalizations?filter[build]=$BUILD_ID&filter[locale]=$LOCALE"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] GET $API_BASE$LOCALIZATION_PATH"
    echo "  [dry-run] would PATCH the existing localization, or POST a new one, with whatsToTest=$NOTES_JSON"
else
    LOC_RESPONSE="$(api_call GET "$LOCALIZATION_PATH")"
    LOC_ID="$(jq -r '.data[0].id // empty' <<<"$LOC_RESPONSE")"
    if [[ -n "$LOC_ID" ]]; then
        BODY="$(jq -n --arg id "$LOC_ID" --argjson notes "$NOTES_JSON" \
            '{data: {type: "betaBuildLocalizations", id: $id, attributes: {whatsToTest: $notes}}}')"
        RESULT="$(api_call PATCH "/betaBuildLocalizations/$LOC_ID" "$BODY")"
    else
        BODY="$(jq -n --arg buildId "$BUILD_ID" --arg locale "$LOCALE" --argjson notes "$NOTES_JSON" \
            '{data: {type: "betaBuildLocalizations", attributes: {locale: $locale, whatsToTest: $notes}, relationships: {build: {data: {type: "builds", id: $buildId}}}}}')"
        RESULT="$(api_call POST "/betaBuildLocalizations" "$BODY")"
    fi
    jq -e '.data.id' <<<"$RESULT" >/dev/null || bail "failed to set What to Test: $(jq -c '.errors // .' <<<"$RESULT")"
fi

# --- Result -------------------------------------------------------------------
step "5/5 result"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo ""
    echo "Dry run complete -- no requests were sent."
else
    cat <<EOF

What to Test set for build $BUILD_NUMBER ($LOCALE).

Next step: add this build to a TestFlight tester group in App Store Connect.
See docs/release.md "TestFlight Beta Distribution".
EOF
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/testflight-notes.sh`

- [ ] **Step 3: Syntax-check**

Run: `bash -n scripts/testflight-notes.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Lint**

Run: `shellcheck scripts/testflight-notes.sh`
Expected: no errors that indicate a real bug (e.g. unquoted expansions that matter). Informational warnings are acceptable, matching this repo's existing scripts.

- [ ] **Step 5: Test `--help`**

Run: `scripts/testflight-notes.sh --help`
Expected: prints the full header comment block (Usage/flags/Env sections), exits 0.

- [ ] **Step 6: Test argument validation errors**

```bash
scripts/testflight-notes.sh 2>&1 | tail -1
```
Expected: `error: one of --notes or --notes-file is required.`

```bash
scripts/testflight-notes.sh --notes "a" --notes-file /tmp/whatever 2>&1 | tail -1
```
Expected: `error: --notes and --notes-file are mutually exclusive.`

```bash
scripts/testflight-notes.sh --notes "a" 2>&1 | tail -1
```
Expected: `error: ASC_API_KEY_ID is unset.`

- [ ] **Step 7: Dry-run end to end with a throwaway key**

```bash
openssl ecparam -genkey -name prime256v1 -noout -out /tmp/asc-test-key.pem

ASC_API_KEY_ID=TESTKEY123 \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
ASC_API_KEY_PATH=/tmp/asc-test-key.pem \
  scripts/testflight-notes.sh --notes "Test notes for dry run." --build 7 --dry-run

rm -f /tmp/asc-test-key.pem
```

Expected output includes, in order:
- `build:   7 (marketing version 0.1.0)`
- `locale:  en-US`
- `mode:    dry-run (no network calls)`
- `=== 1/5 mint App Store Connect API JWT ===` followed by `  minted.`
- `=== 2/5 look up app id for io.dwk.anglesite ===` followed by a `[dry-run] GET .../apps?filter[bundleId]=io.dwk.anglesite` line
- `=== 3/5 find build 7 (version 0.1.0) ===` followed by a `[dry-run] GET .../builds?filter[app]=DRYRUN_APP_ID&filter[version]=7&filter[preReleaseVersion.version]=0.1.0` line
- `=== 4/5 set What to Test (en-US) ===` followed by dry-run lines mentioning `whatsToTest` and the notes text
- `Dry run complete -- no requests were sent.`

Exit code 0.

- [ ] **Step 8: Test `--notes-file`**

```bash
echo "Notes from a file." > /tmp/asc-test-notes.txt
ASC_API_KEY_ID=TESTKEY123 \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
ASC_API_KEY_PATH=/tmp/asc-test-key.pem \
  scripts/testflight-notes.sh --notes-file /tmp/asc-test-notes.txt --dry-run 2>&1 | grep -c "Notes from a file"
rm -f /tmp/asc-test-notes.txt
```

Note: this step needs `/tmp/asc-test-key.pem` again — regenerate it with the same `openssl ecparam` command from Step 7 if it was already cleaned up.

Expected: `1` (the notes text appears in the dry-run output).

- [ ] **Step 9: Commit**

```bash
git add scripts/testflight-notes.sh
git commit -m "$(cat <<'EOF'
feat(#766): add scripts/testflight-notes.sh

Sets a build's TestFlight "What to Test" beta notes via the App Store
Connect REST API -- the only interface that exposes this, since
xcodebuild/altool have no flag for it. scripts/release.sh's existing
upload is still the TestFlight build-upload path; this just attaches
notes to a build after it finishes processing.

--dry-run prints the JWT and every API request without sending them,
so the script is testable without live App Store Connect credentials.
EOF
)"
```

---

### Task 5: Document the TestFlight beta flow

**Files:**
- Modify: `docs/release.md`

**Interfaces:** None.

- [ ] **Step 1: Add the new section**

In `docs/release.md`, after the existing "Per-Release Flow" section (after line 63, the closing sentence about Transporter), add:

```markdown

## TestFlight Beta Distribution

TestFlight builds go through the exact same pipeline as a full release --
`scripts/release.sh` archives, signs, and uploads to App Store Connect, and
that upload *is* the TestFlight build-upload path. There is no separate
"upload for beta" step. What's specific to TestFlight is App Store
Connect configuration (mostly manual) and setting the build's "What to
Test" notes (scripted).

### One-time setup (manual, in App Store Connect)

1. **TestFlight tab.** Nothing to create separately -- it appears
   automatically on the app record from step 1 of "One-Time Setup" above,
   once the first build is uploaded and finishes processing.
2. **Export compliance.** `Resources/Info.plist` declares
   `ITSAppUsesNonExemptEncryption=false` (accurate -- Anglesite only uses
   standard HTTPS/TLS via system frameworks, no custom cryptography). This
   skips App Store Connect's manual export-compliance prompt, which
   otherwise blocks a build from being distributed to any tester group
   until answered.
3. **Internal Testing group.** App Store Connect -> TestFlight -> Internal
   Testing -> create a group, add testers by Apple ID (they must already
   have a role on the App Store Connect team), then add a processed build
   to the group. No Beta App Review required -- builds are available to
   internal testers immediately.
4. **External Testing group -- when to open one.** Left as a deliberate
   judgment call, not automated here: open an External Testing group once
   internal testers have validated a build and you want feedback from
   people outside the Apple Developer team. The first build submitted to
   an external group needs Beta App Review (typically faster and lighter
   than full App Store review); most builds after that, without
   significant changes, don't need re-review.
5. **Virtualization entitlement.** Already confirmed in "One-Time Setup"
   step 4 above -- the same `scripts/release.sh --validate-only` check
   covers TestFlight builds, since they go through the identical export
   pipeline.

### Beta release flow

```sh
# 1. Archive, sign, and upload -- same as a full release.
TEAM_ID=YOUR_TEAM_ID \
PROVISIONING_PROFILE="Anglesite App Store" \
ASC_API_KEY_ID=XXXXXXXXXX \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/release.sh

# 2. Wait for App Store Connect to finish processing the build (check
#    TestFlight -> Builds in the portal, or just run step 3 -- it polls).

# 3. Set the "What to Test" notes for testers.
ASC_API_KEY_ID=XXXXXXXXXX \
ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/testflight-notes.sh --notes "Try the new site importer and report crashes."
```

Then add the build to a tester group (Internal or External) in App Store
Connect -- see "One-time setup" above.

See [#617](https://github.com/Anglesite/Anglesite/issues/617) for the
separate v1.0 App Store submission track, which shares this same
archive/export/upload pipeline but goes through full App Review instead
of TestFlight's Beta App Review.
```

- [ ] **Step 2: Confirm the new section is present and well-formed**

Run: `grep -n "^## TestFlight Beta Distribution" docs/release.md`
Expected: one match.

Run: `grep -c '^```' docs/release.md`
Expected: an even number (every fenced code block opened is closed).

- [ ] **Step 3: Commit**

```bash
git add docs/release.md
git commit -m "$(cat <<'EOF'
docs(#766): document TestFlight beta distribution flow

Covers the App Store Connect setup that has to stay manual (app record,
tester groups, Beta App Review) plus the scripted parts: the export
compliance fix and scripts/testflight-notes.sh for What to Test notes.
EOF
)"
```

---

## Final verification

After all 5 tasks:

- [ ] Run the full test suite: `swift test --package-path .` -- expect all suites pass (the `Info.plist` change is inert at runtime but touches a tracked app resource).
- [ ] Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` -- expect `** BUILD SUCCEEDED **`.
- [ ] Run: `shellcheck scripts/release.sh scripts/testflight-notes.sh scripts/lib/resolve-asc-key.sh scripts/lib/asc-jwt.sh` -- review output.
- [ ] Confirm `git log --oneline -5` shows the 5 commits from this plan, each referencing #766, each subject line ≤72 characters.
- [ ] Open the PR per `CONTRIBUTING.md`: use `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan), include `Closes #766`. Note in the Paired PR check section that this is app-only -- no MCP schema or `anglesite-skills` changes.
