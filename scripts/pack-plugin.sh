#!/usr/bin/env bash
# Build a distributable .zip of the Anglesite plugin.
# Usage: bash scripts/pack-plugin.sh          → outputs dist/anglesite-v0.13.0.zip
#        bash scripts/pack-plugin.sh --dir /tmp → outputs /tmp/anglesite-v0.13.0.zip
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$REPO_ROOT/.claude-plugin/plugin.json').version")"
OUTDIR="${REPO_ROOT}/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) OUTDIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

ZIPNAME="anglesite-v${VERSION}.zip"
mkdir -p "$OUTDIR"

# Build zip from repo root, including only plugin-relevant files.
cd "$REPO_ROOT"
zip -r "$OUTDIR/$ZIPNAME" \
  .claude-plugin/ \
  skills/ \
  hooks/ \
  scripts/scaffold.sh \
  scripts/pre-deploy-check.sh \
  settings.json \
  docs/ \
  template/ \
  bin/init.js \
  LICENSE \
  README.md \
  -x "docs/.DS_Store" "template/node_modules/*" "**/.DS_Store"

echo "Packed $OUTDIR/$ZIPNAME ($(du -h "$OUTDIR/$ZIPNAME" | cut -f1))"
