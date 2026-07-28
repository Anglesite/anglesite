#!/usr/bin/env bash
#
# Creates a smoke-test Anglesite site at ~/Sites/anglesite-smoke/, populated
# from the in-repo template (Resources/Template/).
#
# Use this fixture to manually verify the sandboxed App Store app end-to-end.
# A real-signed build is produced so the run exercises the App Sandbox, hardened
# runtime signing, and local Apple Containerization capability gates.
#
# Idempotent: re-running mirrors any template changes. A local `npm install`
# still runs to keep the fixture usable outside the app, but the App Store smoke
# must validate the container-backed runtime path, not host Node.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

TEMPLATE_SRC="$REPO_ROOT/Resources/Template"
FIXTURE_DIR="$HOME/Sites/anglesite-smoke"

if [[ ! -d "$TEMPLATE_SRC" ]]; then
    echo "error: template not found at $TEMPLATE_SRC" >&2
    echo "       Resources/Template/ should be committed to the app repo." >&2
    exit 1
fi

mkdir -p "$HOME/Sites"

echo "==> mirroring $TEMPLATE_SRC → $FIXTURE_DIR"
# Skip node_modules and build outputs in the mirror so the existing install
# stays put and the npm install below is incremental rather than full.
rsync -a \
    --exclude='node_modules/' \
    --exclude='.astro/' \
    --exclude='dist/' \
    --exclude='.wrangler/' \
    "$TEMPLATE_SRC/" "$FIXTURE_DIR/"

# scaffold.sh normally stamps this at site-creation time; Import Site requires it
# (ProjectValidator flags a Source/ missing .site-config as an incomplete site).
if [[ ! -f "$FIXTURE_DIR/.site-config" ]]; then
    echo "==> stamping missing .site-config (mirrors scaffold.sh)"
    printf '%s\n' \
        "ANGLESITE_VERSION=1.0.0" \
        "# SITE_URL=https://example.com        — site domain (used in feeds, sitemap, security.txt)" \
        "# SECURITY_CONTACT=security@example.com — RFC 9116 security.txt contact (email or URI)" \
        "# SECURITY_TXT_MODE=generated          — generated|manual|disabled (default: inferred from SECURITY_CONTACT)" \
        "# MTA_STS_MODE=testing                 — disabled|testing|enforce (start with testing)" \
        "# MTA_STS_DOMAIN=example.com           — recipient domain (not necessarily the website host)" \
        "# MTA_STS_MX=mx1.example.com,mx2.example.com — allowed receiving MX hosts (RFC 8461)" \
        "# TLS_RPT_RUA=tls-reports@example.com  — optional RFC 8460 report mailbox" \
        "# HSTS_PRELOAD=true                    — opt-in HSTS preload submission (hard to reverse)" \
        "# SCRIPT_ALLOW=example.com             — additional CSP script-src domains (comma-separated)" \
        > "$FIXTURE_DIR/.site-config"
fi

cd "$FIXTURE_DIR"
echo "==> npm install --no-audit --no-fund --prefer-offline"
npm install --no-audit --no-fund --prefer-offline

# The app refuses to preview a repo-less site (git is the source of truth, #72), and
# File ▸ Import doesn't bootstrap a repo either (#720) — so without a commit here the
# runbook flow (create-smoke-fixture.sh → Import → preview) dead-ends. The template's
# .gitignore (#719) keeps node_modules/ and build outputs out of the commit. Fixture-local
# `-c` identity values keep this working on machines with no global git identity.
if [[ ! -d .git ]]; then
    echo "==> git init"
    git init -q
fi
git add -A
if ! git diff --cached --quiet; then
    if git rev-parse -q --verify HEAD >/dev/null; then
        COMMIT_MSG="Refresh fixture from template"
    else
        COMMIT_MSG="Initial fixture"
    fi
    echo "==> git commit: $COMMIT_MSG"
    git -c user.name="Anglesite Smoke Fixture" \
        -c user.email="smoke-fixture@anglesite.invalid" \
        -c commit.gpgsign=false \
        commit -q -m "$COMMIT_MSG"
fi

# ----- Real-signed sandbox validation -----
# A real Apple Development identity is required — the App Sandbox entitlements are NOT
# enforced under ad-hoc signing, so an ad-hoc run would pass for the wrong reasons.
# Bail early with guidance if no identity is present.
if ! security find-identity -v -p codesigning | grep -q "Apple Development"; then
    echo "error: no 'Apple Development' signing identity found." >&2
    echo "       Task 11 needs a real cert (Xcode → Settings → Accounts → add Apple ID)." >&2
    echo "       'security find-identity -v -p codesigning' must list ≥1 identity." >&2
    exit 1
fi

# Derive the 10-char Team ID from the first USABLE signing identity's certificate OU.
# The "(XXXXXXXXXX)" parenthetical in the identity's common name is NOT the Team ID for
# Apple Development certs — it's a certificate/machine ID (e.g. KH7H8Y25RT on a machine
# whose real Personal-Team OU is UX3L9R8RSL), and passing it as DEVELOPMENT_TEAM fails
# the build with 'No Account for Team'. `find-identity -v` picks the identity (it lists
# only certs that have a private key on this machine — unlike `find-certificate`, which
# also returns stale/foreign certs with no key); the OU of that identity's certificate
# is the Team ID. The cert is re-fetched by the SHA-1 fingerprint `find-identity`
# printed — never re-looked-up by name, which could match a stale/renewed cert with the
# identical common name. Override with DEVELOPMENT_TEAM=... for multi-team setups.
IDENTITY_CN=""
if [[ -z "${DEVELOPMENT_TEAM:-}" ]]; then
    IDENTITY_LINE=$(security find-identity -v -p codesigning \
        | grep "Apple Development" | head -1)
    IDENTITY_SHA1=$(echo "$IDENTITY_LINE" | awk '{print $2}')
    IDENTITY_CN=$(echo "$IDENTITY_LINE" | sed -E 's/^[^"]*"([^"]+)".*$/\1/')
    DEV_TEAM=$(security find-certificate -a -c "$IDENTITY_CN" -Z -p 2>/dev/null \
        | awk -v want="$IDENTITY_SHA1" '
            /^SHA-1 hash:/ { keep = ($3 == want) }
            /-----BEGIN CERTIFICATE-----/ { inpem = 1 }
            inpem && keep { print }
            /-----END CERTIFICATE-----/ { inpem = 0 }' \
        | openssl x509 -noout -subject -nameopt multiline 2>/dev/null \
        | awk '$1 == "organizationalUnitName" { print $3; exit }')
else
    DEV_TEAM="$DEVELOPMENT_TEAM"
fi
if [[ ! "$DEV_TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "error: couldn't derive a valid 10-char Team ID${IDENTITY_CN:+ from identity \"$IDENTITY_CN\"} (got '${DEV_TEAM:-}')." >&2
    echo "       Set DEVELOPMENT_TEAM=<team-id> and re-run. Find your Team ID with:" >&2
    echo "         security find-certificate -c \"Apple Development\" -p \\" >&2
    echo "           | openssl x509 -noout -subject      # the OU field is the Team ID" >&2
    echo "       or at https://developer.apple.com/account → Membership details." >&2
    exit 1
fi

# Refresh the (gitignored) Xcode project from project.yml — a stale Anglesite.xcodeproj
# missing recently-added Sources/ files fails to compile (and CI regenerates anyway).
# Let xcodegen's output show: a broken project.yml otherwise surfaces only as a confusing
# downstream compile error, and a stdout-only failure would be invisible under a redirect.
if command -v xcodegen >/dev/null 2>&1; then
    echo "==> xcodegen generate (refresh project from project.yml)"
    if ! (cd "$REPO_ROOT" && xcodegen generate); then
        echo "error: xcodegen generate failed — fix project.yml before re-running" >&2
        exit 1
    fi
else
    echo "warning: xcodegen not found; Anglesite.xcodeproj may be stale — run" >&2
    echo "         'brew install xcodegen' if the build fails to find recent Sources/ files" >&2
fi

DERIVED="$REPO_ROOT/build/smoke"
echo "==> building Anglesite (real-signed: Apple Development, team $DEV_TEAM) into $DERIVED"
# Automatic provisioning + -allowProvisioningUpdates so Xcode mints/downloads the team's
# "Mac Development" profile. This FAILS LOUDLY if the team's Apple ID isn't in Xcode →
# Settings → Accounts — which is correct: the alternative (CODE_SIGN_IDENTITY="-") signs
# AD-HOC, and the App Sandbox / hardened-runtime entitlements are NOT enforced ad-hoc, so
# the smoke would pass for the wrong reasons. The post-build guard below re-asserts this.
BUILD_LOG="$DERIVED/xcodebuild.log"
mkdir -p "$DERIVED"
# Stream output live AND capture it (a Debug MAS build runs minutes — a blank terminal
# reads as a hang). `tee` to the log so the failure branch can still grep it; under
# `set -o pipefail` the pipeline reports xcodebuild's exit, not tee's. (Don't append a
# `| grep` here: a matched "error:" would make grep exit 0 and mask the failure.)
if ! xcodebuild -project "$REPO_ROOT/Anglesite.xcodeproj" \
    -scheme Anglesite -configuration Debug \
    -derivedDataPath "$DERIVED" \
    CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
    DEVELOPMENT_TEAM="$DEV_TEAM" -allowProvisioningUpdates \
    build 2>&1 | tee "$BUILD_LOG"; then
    echo "error: Anglesite build/sign failed. Relevant lines:" >&2
    grep -iE "error:|No Account for Team|No signing certificate|provisioning" "$BUILD_LOG" | tail -10 >&2
    echo "       If you see 'No Account for Team \"$DEV_TEAM\"', add that Apple ID in" >&2
    echo "       Xcode → Settings → Accounts, then re-run. Full log: $BUILD_LOG" >&2
    exit 1
fi

APP="$DERIVED/Build/Products/Debug/Anglesite.app"

# Guard: a *successful* build can still be AD-HOC (TeamIdentifier=not set) if signing
# silently fell back. That does NOT satisfy Task 11 — fail rather than mislead.
if codesign -dv --verbose=4 "$APP" 2>&1 | grep -q "TeamIdentifier=not set"; then
    echo "error: Anglesite signed AD-HOC (TeamIdentifier not set) — the smoke needs a real" >&2
    echo "       Team signature. Add team $DEV_TEAM's Apple ID in Xcode → Settings → Accounts" >&2
    echo "       so automatic provisioning signs with the real cert, then re-run." >&2
    exit 1
fi

echo "==> verifying the app is real-signed with our team"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E "Authority=Apple Development|TeamIdentifier|flags=" || true

cat <<EOF

✓ Smoke fixture ready: $FIXTURE_DIR
✓ Real-signed App Store app built: $APP

  This is the load-bearing Phase 10.1 / #81 validation — it must run
  INTERACTIVELY under the real signature (the App Sandbox and virtualization
  entitlement path are not representative under unsigned/no-signing builds).

  Launch the built app from a normal location (signed sandboxed apps refuse to
  run from /private/tmp):
    cp -R "$APP" ~/Applications/ && open -n ~/Applications/Anglesite.app

  Then exercise the WRITE-HEAVY loop and watch for sandbox denials
  (log stream --predicate 'eventMessage CONTAINS "deny"' --style compact):
    1. File ▸ Import Site… → in the open panel choose anglesite-smoke, then in the
       save panel keep the suggested anglesite-smoke.anglesite name (default
       location ~/Sites). The app copies the folder into the new package's
       Source/, so the later write steps land there, not in ~/Sites/anglesite-smoke.
       The save-panel Powerbox grant is the per-site security-scoped grant on the
       package (do NOT pre-inject a bookmark — a foreign process's scoped bookmark
       won't resolve in the app; cf. spike 6.5). It persists for next launch.
    2. Preview should be served by LocalContainerSiteRuntime, not by a host
       subprocess. The debug log should include the runtime selection and must
       not show any host Node preview fallback.
    3. Deploy button → build/preflight/deploy must run against the granted
       package's Source/ using the active container runtime where applicable,
       then the pre-deploy scan runs. A real 'wrangler deploy' needs a Cloudflare
       token; if no token is configured, capture the prompt/error instead of
       treating it as a sandbox failure.
    4. Open the example photo page, then drag an image from Finder. Existing
       images highlight as drop targets; drop onto the example image and confirm
       the optimized bytes write to public/images/ through the container-backed
       edit path. Record any sandbox denial.
    5. Close the window → runtime children reaped. Quit → no orphan runtime process.
    6. Foundation Models chat should be present. Settings → no GitHub Connect
       row, and updates are handled by the App Store.

  Capture PASS/FAIL per step (especially #2 runtime selection, #3 deploy path,
  #4 image-drop writes, and any sandbox denials) in a notes file; this is the
  validation evidence required for #81 / Phase 10.1 closeout.
EOF
