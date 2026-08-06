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
