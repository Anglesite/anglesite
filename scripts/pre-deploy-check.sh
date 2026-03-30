#!/usr/bin/env bash
# PreToolUse hook: block deploys that fail security scans.
# Reads tool input JSON from stdin. If the command pushes to main
# (production deploy), runs 5 mandatory checks against dist/.
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

# Read PII_EMAIL_ALLOW from .site-config (comma-separated list of allowed emails)
PII_ALLOW=""
if [[ -f ".site-config" ]]; then
  PII_ALLOW=$(grep '^PII_EMAIL_ALLOW=' .site-config 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)
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

if grep -rE '\(?\d{3}\)?[-.[[:space:]]]?\d{3}[-.[[:space:]]]?\d{4}' "$DIST/" --include='*.html' 2>/dev/null | grep -q .; then
  REASONS+=("Possible phone number found in built HTML")
fi

# 2. Token scan — API tokens in dist/, src/, or public/
if grep -rE '(pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})' "$DIST/" src/ public/ 2>/dev/null | grep -q .; then
  REASONS+=("API token pattern found in source or build output")
fi

# 3. Third-party scripts — unauthorized external JS (allowlist driven by .site-config)
check_third_party_scripts() {
  local result
  result=$(grep -r '<script[^>]*src=' "$DIST/" --include='*.html' 2>/dev/null || true)

  # Always exclude Cloudflare analytics and Astro bundles
  result=$(echo "$result" | grep -v 'cloudflareinsights' | grep -v '_astro' || true)

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

# 4. Keystatic admin routes — should never be in production
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
