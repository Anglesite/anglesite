# TestFlight beta distribution setup

Date: 2026-08-06
Issue: [#766](https://github.com/Anglesite/Anglesite/issues/766)

## Problem

The v1.0.0-Beta milestone says the app "will be distributed through TestFlight,"
but no issue covered standing that up — [#617](https://github.com/Anglesite/Anglesite/issues/617)
only covers the final v1.0 App Store submission. TestFlight needs its own
one-time App Store Connect configuration, a way to attach "What to Test" notes
to an uploaded build, and an accurate export-compliance declaration so builds
don't stall on a manual compliance prompt.

## Scope and constraints

App Store Connect app-record creation and TestFlight tester-group membership
are portal actions gated behind Apple Developer account credentials that
aren't available in this environment. Those stay a documented manual
checklist. What's scriptable/documentable here:

1. An accurate export-compliance declaration in `Info.plist`.
2. A script to set a build's "What to Test" beta notes via the App Store
   Connect REST API (the only interface that exposes this — `xcodebuild` and
   `altool` don't).
3. Documentation tying the existing `scripts/release.sh` upload path,
   the new notes script, and the manual TestFlight-group steps into one
   beta-release flow.

`scripts/release.sh` already archives, signs, and uploads to App Store
Connect via `xcodebuild -exportArchive -destination upload`. That upload
*is* the TestFlight build-upload path — App Store Connect builds land in
TestFlight automatically once processed. No separate "upload for beta"
script is needed.

## 1. Export compliance

Add to `Resources/Info.plist`:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

Anglesite only uses standard HTTPS/TLS via system frameworks (`URLSession`
for GitHub/Cloudflare API calls, `WKWebView` for the local dev-server
preview, Keychain for token storage) — no custom cryptographic
implementation. `false` is accurate and lets App Store Connect skip the
per-build manual export-compliance question that otherwise blocks
processing.

## 2. `scripts/lib/resolve-asc-key.sh`

The `.p8` App Store Connect API key discovery logic already exists inline in
`scripts/release.sh` (search `~/.appstoreconnect/private_keys/`,
`~/.private_keys/`, `~/private_keys/`, `./private_keys/`, or an explicit
`ASC_API_KEY_PATH`). Extract it into a shared function,
`resolve_asc_key_path <key_id>`, sourced by both `release.sh` and the new
`testflight-notes.sh`. Behavior is unchanged; this is a pure extraction to
avoid duplicating the same ~20 lines in a second script.

## 3. `scripts/lib/asc-jwt.py`

App Store Connect API auth is a JWT signed with ES256 using the `.p8` key —
a token type `xcodebuild`'s own `-authenticationKeyPath` handles internally,
but that raw signing has to be done by hand for direct REST calls.

Stdlib-only Python (no pip installs), invoked as:

```sh
python3 scripts/lib/asc-jwt.py --key-id "$ASC_API_KEY_ID" --issuer-id "$ASC_API_ISSUER_ID" --key-path "$ASC_KEY_PATH"
```

Prints a signed JWT to stdout. Implementation:

1. Build the header (`{"alg":"ES256","kid":<key id>,"typ":"JWT"}`) and
   payload (`{"iss":<issuer id>,"iat":<now>,"exp":<now + 1200>,"aud":"appstoreconnect-v1"}`,
   20-minute expiry — the API's max) as compact JSON, base64url-encode each.
2. Sign `base64url(header) + "." + base64url(payload)` via
   `openssl dgst -sha256 -sign <key-path>`, which produces a DER-encoded
   ECDSA signature (`SEQUENCE { INTEGER r, INTEGER s }`).
3. Parse the DER by hand (simple fixed-structure ASN.1 — no library needed):
   walk the SEQUENCE/INTEGER tags, strip any leading `0x00` sign-padding
   byte from `r`/`s`, left-pad each to 32 bytes, concatenate to the raw
   64-byte `r‖s` format JWT ES256 requires.
4. base64url-encode the raw signature, append as the JWT's third segment.

This is a well-established recipe (openssl for the actual EC signing, hand
parsing for the DER→raw conversion) and keeps the dependency footprint to
tools already on any macOS dev machine.

## 4. `scripts/testflight-notes.sh`

Styled after `release.sh`: preflight checks, numbered steps, clear `bail`
messages.

**Usage:**

```sh
ASC_API_KEY_ID=XXXXXXXXXX ASC_API_ISSUER_ID=00000000-0000-0000-0000-000000000000 \
  scripts/testflight-notes.sh --notes "Try the new site importer and report crashes." [--build 42] [--dry-run]
```

**Flags:**
- `--notes "text"` / `--notes-file path` — required, mutually exclusive.
- `--build N` — optional, defaults to `CURRENT_PROJECT_VERSION` read from
  `project.yml`.
- `--dry-run` — generate the JWT and construct every API request (method,
  URL, body) but skip execution, printing them instead. This is the only
  way to exercise the script's logic without live App Store Connect access,
  and is what verification in this change relies on.

**Flow:**

1. Preflight: `ASC_API_KEY_ID`/`ASC_API_ISSUER_ID` set, `--notes`/`--notes-file`
   present and mutually exclusive, `openssl`/`python3`/`curl`/`jq` on `PATH`,
   resolve the `.p8` path via `resolve_asc_key_path`.
2. Read `MARKETING_VERSION` from `project.yml`; use `--build` or
   `CURRENT_PROJECT_VERSION` for the build number.
3. Mint a JWT via `asc-jwt.py`.
4. `GET /v1/apps?filter[bundleId]=io.dwk.anglesite` → app id.
5. `GET /v1/builds?filter[app]=<id>&filter[version]=<build>&filter[preReleaseVersion.version]=<marketing version>`
   → build id. If `processingState == PROCESSING`, poll every 30s up to
   ~15 minutes; `FAILED`/`INVALID` bails immediately with the reason; not
   found bails with "build not found — did you upload it with
   scripts/release.sh yet?"
6. `GET` existing `en-US` beta build localization for the build. If present,
   `PATCH` its `whatsToTest`; otherwise `POST` a new one with the build
   relationship, `locale: en-US`, and `whatsToTest`.
7. Print a confirmation and point to App Store Connect → TestFlight for the
   next manual step (adding the build to a tester group).

Only `en-US` is handled — matches `CFBundleDevelopmentRegion`. Additional
locales are out of scope until the app is actually localized.

## 5. `docs/release.md` — new "TestFlight Beta Distribution" section

Added after the existing "Per-Release Flow" section:

- **One-time setup** (manual, checklist form): confirm the TestFlight tab is
  live on the App Store Connect app record; Internal Testing group needs no
  review — add testers by account role; External Testing groups require
  Beta App Review (first build per version only, in the common case) —
  documented as a deliberate manual decision on *when* to open one, per the
  issue's own framing, not something this change automates.
  Export-compliance: note the `ITSAppUsesNonExemptEncryption` key added here
  and that it removes the per-build manual prompt.
- **Beta release flow:** run `scripts/release.sh` (unchanged — same upload
  path as a full release), wait for App Store Connect processing, then run
  `scripts/testflight-notes.sh --notes "..."` to set What-to-Test text,
  then add the build to a tester group in App Store Connect.
- Cross-reference to #617 for the full App Store submission track, noting
  the shared archive/export/upload pipeline.

## Testing

No live App Store Connect credentials are available in this environment, so:

- `asc-jwt.py`: generate a throwaway EC private key
  (`openssl ecparam -genkey -name prime256v1 -noout`) and its public half,
  run the script against the private key, then re-derive a DER signature
  from the JWT's raw `r‖s` third segment (reverse of the script's own
  raw-from-DER conversion) and confirm it validates against the signing
  input with `openssl dgst -sha256 -verify pubkey.pem -signature sig.der`.
  Confirms the signing and DER conversion logic is correct independent of
  real ASC credentials.
- `testflight-notes.sh --dry-run`: exercises argument parsing, `project.yml`
  parsing, and the constructed request list end-to-end without network
  calls.
- `swift test --package-path .` and `scripts/build-app.sh` — the `Info.plist`
  change touches a tracked app resource; confirm the app still builds and
  the plist is well-formed.
