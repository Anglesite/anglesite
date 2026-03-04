#!/usr/bin/env bash
# PreToolUse hook: block deploys that fail security scans.
# Reads tool input JSON from stdin. If the command contains
# "wrangler pages deploy", runs 4 mandatory checks against dist/.
# Returns JSON with permissionDecision "deny" to block, or exits 0 to allow.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Pass through anything that isn't a wrangler deploy
if [[ "$COMMAND" != *"wrangler pages deploy"* ]]; then
  exit 0
fi

DIST="dist"
REASONS=()

# 1. PII scan — email addresses and phone numbers in built HTML
if grep -r '@' "$DIST/" --include='*.html' 2>/dev/null | grep -v 'charset' | grep -v 'viewport' | grep -v '@astro' | grep -q .; then
  REASONS+=("Possible email address found in built HTML")
fi

if grep -rE '\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}' "$DIST/" --include='*.html' 2>/dev/null | grep -q .; then
  REASONS+=("Possible phone number found in built HTML")
fi

# 2. Token scan — API tokens in dist/, src/, or public/
if grep -rE '(pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})' "$DIST/" src/ public/ 2>/dev/null | grep -q .; then
  REASONS+=("API token pattern found in source or build output")
fi

# 3. Third-party scripts — unauthorized external JS
if grep -r '<script[^>]*src=' "$DIST/" --include='*.html' 2>/dev/null | grep -v 'cloudflareinsights' | grep -v '_astro' | grep -q .; then
  REASONS+=("Unauthorized third-party script tag found")
fi

# 4. Keystatic admin routes — should never be in production
if find "$DIST/" -path '*keystatic*' -type f 2>/dev/null | grep -q .; then
  REASONS+=("Keystatic admin routes found in build output")
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
