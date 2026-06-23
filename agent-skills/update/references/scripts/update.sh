#!/bin/zsh
# Anglesite — Compare template files against a scaffolded site
# Usage: zsh update.sh [site-directory]
# Outputs a categorized file list for the update skill to process.
#
# Output format (one line per file, relative to template root):
#   # from=<site-version>
#   # to=<plugin-version>
#   = path/to/file    — identical to template (up to date)
#   M path/to/file    — differs from template (user-customized or outdated)
#   A path/to/file    — exists in template but not in site (new)
#
# Environment:
#   ANGLESITE_PLUGIN_ROOT — override plugin root (default: derived from script path)

if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -euo pipefail

SITE_DIR="${1:-.}"
SITE_DIR="${SITE_DIR:A}"
PLUGIN_ROOT="${ANGLESITE_PLUGIN_ROOT:-${0:A:h:h}}"
TEMPLATE="${PLUGIN_ROOT}/template"

if [[ ! -d "$TEMPLATE" ]]; then
  echo "Error: template directory not found at $TEMPLATE" >&2
  exit 1
fi

if [[ ! -d "$SITE_DIR" ]]; then
  echo "Error: site directory not found at $SITE_DIR" >&2
  exit 1
fi

# Read versions
SITE_CONFIG="$SITE_DIR/.site-config"
SITE_VERSION="0.0.0"
if [[ -f "$SITE_CONFIG" ]]; then
  VER=$(grep -m1 '^ANGLESITE_VERSION=' "$SITE_CONFIG" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "${VER:-}" ]]; then
    SITE_VERSION="$VER"
  fi
fi

PLUGIN_VERSION=$(grep -o '"version": "[^"]*"' "$PLUGIN_ROOT/package.json" | head -1 | cut -d'"' -f4)

echo "# from=$SITE_VERSION"
echo "# to=$PLUGIN_VERSION"

# Excludes — same as scaffold.sh
EXCLUDES="node_modules|dist|\.astro|\.wrangler|\.certs|\.DS_Store|\.site-config"

# Walk template directory and compare (prune heavy dirs so find stays fast)
cd "$TEMPLATE"
find . \
  -name node_modules -prune -o \
  -name dist -prune -o \
  -name .astro -prune -o \
  -name .wrangler -prune -o \
  -name .certs -prune -o \
  -name .DS_Store -prune -o \
  -name .site-config -prune -o \
  -type f -print | while IFS= read -r file; do
  # Strip leading ./
  rel="${file#./}"

  # Secondary exclude check (catches patterns not handled by -prune)
  if echo "$rel" | grep -qE "(^|/)($EXCLUDES)(/|$)"; then
    continue
  fi

  SITE_FILE="$SITE_DIR/$rel"
  if [[ ! -f "$SITE_FILE" ]]; then
    echo "A $rel"
  elif diff -q "$TEMPLATE/$rel" "$SITE_FILE" >/dev/null 2>&1; then
    echo "= $rel"
  else
    echo "M $rel"
  fi
done
