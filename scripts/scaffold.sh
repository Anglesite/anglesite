#!/bin/zsh
# Anglesite — Scaffold a new project from the plugin template
# Usage: zsh scaffold.sh [destination]
# Copies template/ to the destination directory (default: current directory).
# Safe to rerun — does not overwrite .site-config or docs/brand.md.

if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -euo pipefail

DEST="${1:-.}"
PLUGIN_ROOT="${0:A:h:h}"
TEMPLATE="${PLUGIN_ROOT}/template"

if [[ ! -d "$TEMPLATE" ]]; then
  echo "Error: template directory not found at $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$DEST"

# Copy template contents, excluding build artifacts and OS files
rsync -a \
  --exclude='node_modules' --exclude='node_modules.nosync' \
  --exclude='dist' --exclude='dist.nosync' \
  --exclude='.astro' --exclude='.astro.nosync' \
  --exclude='.wrangler' --exclude='.wrangler.nosync' \
  --exclude='.certs' --exclude='.certs.nosync' \
  --exclude='.DS_Store' \
  "$TEMPLATE/" "$DEST/"

echo "Scaffolded Anglesite project to $DEST"
