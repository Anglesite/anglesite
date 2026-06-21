#!/usr/bin/env bash
# PreToolUse hook: block deploys that fail security scans.
# Reads tool input JSON from stdin. If the command pushes to main
# (production deploy), runs 6 mandatory checks against dist/ and source.
# Returns JSON with permissionDecision "deny" to block, or exits 0 to allow.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Pass through anything that isn't a push to main
# Match "git push ... main" but not branches that merely contain "main" (e.g. "fix-main-bug")
if ! echo "$COMMAND" | grep -qE 'git push\b.*\bmain\b'; then
  exit 0
fi

DIST="dist"
REASONS=()

# Only run checks if dist/ exists (build has been run)
if [[ ! -d "$DIST" ]]; then
  exit 0
fi

# Read PII allowlists from .site-config (comma-separated)
PII_ALLOW=""
PHONE_ALLOW=""
if [[ -f ".site-config" ]]; then
  PII_ALLOW=$(grep '^PII_EMAIL_ALLOW=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
  PHONE_ALLOW=$(grep '^PII_PHONE_ALLOW=' .site-config 2>/dev/null | cut -d= -f2- || true)
fi

# 1. PII scan — email addresses and phone numbers in built HTML
EMAIL_HITS=$(grep -rE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$DIST/" --include='*.html' 2>/dev/null \
  | grep -v 'charset' | grep -v 'viewport' | grep -v '@astro' \
  | grep -v '@import' | grep -v '@keyframes' | grep -v '@media' | grep -v '@font-face' \
  | grep -v 'mailto:' || true)

# Filter out allowlisted emails
if [[ -n "$EMAIL_HITS" && -n "$PII_ALLOW" ]]; then
  IFS=',' read -ra ALLOWED <<< "$PII_ALLOW"
  for addr in "${ALLOWED[@]}"; do
    EMAIL_HITS=$(echo "$EMAIL_HITS" | grep -vF "$addr" || true)
  done
fi

if [[ -n "$EMAIL_HITS" ]]; then
  REASONS+=("Possible email address found in built HTML")
fi

# Boundary guards keep the 3-3-4 shape from matching digit runs embedded in
# longer tokens — DOIs in citation URLs, Wayback timestamps, decimal
# coordinates (issues #362, #365). Leading: not preceded by a digit, '/', or
# '.' (a preceding '-' is allowed so a '1-800-…' country code still matches).
# Trailing: not followed by a digit or '/' (a trailing '.' is allowed so a
# number that ends a sentence still matches). POSIX ERE has no lookaround, so
# the boundaries are matched as literal context chars.
PHONE_HITS=$(grep -rE '(^|[^0-9/.])\(?[0-9]{3}\)?[-.[:space:]]?[0-9]{3}[-.[:space:]]?[0-9]{4}([^0-9/]|$)' "$DIST/" --include='*.html' 2>/dev/null || true)

# Filter out allowlisted phone numbers (normalize to digits-only for comparison)
if [[ -n "$PHONE_HITS" && -n "$PHONE_ALLOW" ]]; then
  IFS=',' read -ra ALLOWED_PHONES <<< "$PHONE_ALLOW"
  for phone in "${ALLOWED_PHONES[@]}"; do
    digits=$(echo "$phone" | tr -cd '0-9')
    if [[ -n "$digits" ]]; then
      PHONE_HITS=$(echo "$PHONE_HITS" | grep -v "$digits" || true)
    fi
  done
fi

if [[ -n "$PHONE_HITS" ]]; then
  REASONS+=("Possible phone number found in built HTML")
fi

# 2. Token scan — API tokens in dist/, src/, public/, worker/, and the
# wrangler configs (worker/ and the configs are where the IndieWeb secret
# bindings would land if committed instead of stored via `wrangler secret put`)
TOKEN_SCAN_PATHS=("$DIST/")
[[ -d src ]] && TOKEN_SCAN_PATHS+=(src/)
[[ -d public ]] && TOKEN_SCAN_PATHS+=(public/)
[[ -d worker ]] && TOKEN_SCAN_PATHS+=(worker/)
[[ -f wrangler.jsonc ]] && TOKEN_SCAN_PATHS+=(wrangler.jsonc)
[[ -f wrangler.toml ]] && TOKEN_SCAN_PATHS+=(wrangler.toml)

# Airtable PATs, OpenAI sk- keys, GitHub classic (gh?_) and fine-grained PATs
if grep -rE 'pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{32,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}' "${TOKEN_SCAN_PATHS[@]}" 2>/dev/null | grep -q .; then
  REASONS+=("API token pattern found in source or build output")
fi

# 2b. IndieWeb secret bindings (INDIEAUTH_SIGNING_KEY, INDIEAUTH_SESSION_KEY,
# INDIEWEB_REG_TOKEN, GITHUB_TOKEN) committed as literals. Name-only references
# never match — env.GITHUB_TOKEN, ${{ secrets.GITHUB_TOKEN }}, and
# `wrangler secret put INDIEAUTH_SIGNING_KEY` all lack a credential-shaped value
# after = or :
if grep -rE '(INDIEAUTH_SIGNING_KEY|INDIEAUTH_SESSION_KEY|INDIEWEB_REG_TOKEN|GITHUB_TOKEN)["'\'']?[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9+/_-]{16,}' "${TOKEN_SCAN_PATHS[@]}" 2>/dev/null | grep -q .; then
  REASONS+=("An IndieWeb secret (INDIEAUTH_SIGNING_KEY / INDIEAUTH_SESSION_KEY / INDIEWEB_REG_TOKEN / GITHUB_TOKEN) is committed in source — rotate it and store it with 'wrangler secret put'")
fi

# 3. Third-party scripts — unauthorized external JS (allowlist driven by .site-config)
check_third_party_scripts() {
  local result
  # Extract individual <script …src=…> tags (the -o keeps minified one-line
  # HTML from collapsing the whole document into a single match that later
  # grep -v exclusions could be defeated by), then keep only EXTERNAL srcs:
  # scheme-qualified (https://) or protocol-relative (//). Root-relative (/…)
  # and relative srcs are first-party by definition (issues #362, #365).
  result=$(grep -rohE '<script[^>]*src=[^>]*>' "$DIST/" --include='*.html' 2>/dev/null \
    | grep -E "src=[\"']?(https?:)?//" || true)

  # Always exclude Cloudflare analytics (external, but first-party-approved)
  result=$(echo "$result" | grep -v 'cloudflareinsights' || true)

  # Add provider-specific exclusions based on .site-config
  if [[ -f ".site-config" ]]; then
    local ecommerce booking turnstile
    ecommerce=$(grep '^ECOMMERCE_PROVIDER=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
    booking=$(grep '^BOOKING_PROVIDER=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
    turnstile=$(grep '^TURNSTILE_SITE_KEY=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)

    if [[ -n "$turnstile" ]]; then
      result=$(echo "$result" | grep -v 'challenges.cloudflare.com' || true)
    fi
    case "$ecommerce" in
      polar)    result=$(echo "$result" | grep -v 'cdn.polar.sh' || true) ;;
      snipcart) result=$(echo "$result" | grep -v 'cdn.snipcart.com' || true) ;;
      shopify)  result=$(echo "$result" | grep -v 'cdn.shopify.com' | grep -v 'sdks.shopifycdn.com' || true) ;;
      paddle)   result=$(echo "$result" | grep -v 'cdn.paddle.com' | grep -v 'sandbox-cdn.paddle.com' || true) ;;
    esac
    case "$booking" in
      cal)      result=$(echo "$result" | grep -v 'app.cal.com' || true) ;;
      calendly) result=$(echo "$result" | grep -v 'assets.calendly.com' || true) ;;
    esac
  fi

  if [[ -n "$result" ]]; then
    REASONS+=("Unauthorized third-party script tag found")
  fi
}
check_third_party_scripts

# 4. Keystatic admin routes — should never be in production.
# Note: the IndieWeb endpoints (/auth, /micropub, /media, /webmention) set up
# by /anglesite:indieweb are Worker-served and intentionally public — they
# never appear in dist/ and must not be added to this scan.
if find "$DIST/" -path '*keystatic*' -type f 2>/dev/null | grep -q .; then
  REASONS+=("Keystatic admin routes found in build output")
fi

# 5. OG image warning — non-blocking, stderr only
if ! grep -rq 'og:image' "$DIST/" --include='*.html' 2>/dev/null; then
  echo "Warning: No og:image meta tag found in built HTML. Social media shares won't show a preview image. Run 'npm run ai-images' to generate one." >&2
fi

if [[ ${#REASONS[@]} -gt 0 ]]; then
  REASON=$(printf '%s; ' "${REASONS[@]}")
  jq -n --arg reason "Deploy blocked: ${REASON%. }" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

exit 0
