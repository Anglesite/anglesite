#!/usr/bin/env zsh
#
# Build the chassis with each theme pack overlaid, so a pack that breaks
# `astro build` (or the pre/post-build checks) cannot land. Run from anywhere;
# requires the template's node_modules to be installed (npm ci/install first).
#
# Spec: docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §7.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${(%):-%x}")" && pwd)
TEMPLATE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PACKS_DIR="$TEMPLATE_ROOT/packs"

if [[ ! -d "$PACKS_DIR" ]] || [[ -z "$(ls -A "$PACKS_DIR" 2>/dev/null)" ]]; then
    echo "build-packs: no packs to build."
    exit 0
fi

if [[ ! -d "$TEMPLATE_ROOT/node_modules" ]]; then
    echo "build-packs: run npm install in $TEMPLATE_ROOT first." >&2
    exit 1
fi

for pack_dir in "$PACKS_DIR"/*(/); do
    pack=$(basename "$pack_dir")
    target=$(mktemp -d)
    echo "==> Building chassis with pack: $pack"
    "$SCRIPT_DIR/scaffold.sh" --yes "$target"
    rsync -a "$pack_dir/src/" "$target/src/"
    [[ -f "$pack_dir/LICENSE" ]] && cp "$pack_dir/LICENSE" "$target/THEME-LICENSE"
    ln -s "$TEMPLATE_ROOT/node_modules" "$target/node_modules"
    (cd "$target" && npm run build)
    rm -rf "$target"
done

echo "==> All packs built."
