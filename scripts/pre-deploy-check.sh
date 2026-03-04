#!/usr/bin/env bash
# PreToolUse hook: block deploys that fail security scans.
# Reads tool input JSON from stdin. If the command contains
# "wrangler pages deploy", runs 4 mandatory checks against dist/.
# Exits non-zero to block; exits 0 to allow.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Pass through anything that isn't a wrangler deploy
if [[ "$COMMAND" != *"wrangler pages deploy"* ]]; then
  exit 0
fi

DIST="dist"
FAILED=0

# 1. PII scan — email addresses and phone numbers in built HTML
if grep -rqn '@' "$DIST/" --include='*.html' 2>/dev/null | grep -v 'charset' | grep -v 'viewport' | grep -v '@astro' | head -1 | grep -q .; then
  echo "BLOCKED: Possible email address found in built HTML." >&2
  FAILED=1
fi

if grep -rqnE '\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}' "$DIST/" --include='*.html' 2>/dev/null; then
  echo "BLOCKED: Possible phone number found in built HTML." >&2
  FAILED=1
fi

# 2. Token scan — API tokens in dist/, src/, or public/
if grep -rqnE '(pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})' "$DIST/" src/ public/ 2>/dev/null; then
  echo "BLOCKED: API token pattern found in source or build output." >&2
  FAILED=1
fi

# 3. Third-party scripts — unauthorized external JS
if grep -rn '<script[^>]*src=' "$DIST/" --include='*.html' 2>/dev/null | grep -v 'cloudflareinsights' | grep -v '_astro' | grep -q .; then
  echo "BLOCKED: Unauthorized third-party script tag found." >&2
  FAILED=1
fi

# 4. Keystatic admin routes — should never be in production
if find "$DIST/" -path '*keystatic*' -type f 2>/dev/null | grep -q .; then
  echo "BLOCKED: Keystatic admin routes found in build output." >&2
  FAILED=1
fi

if [[ $FAILED -ne 0 ]]; then
  echo "Deploy blocked by security scan. Fix the issues above before deploying." >&2
  exit 2
fi

exit 0
