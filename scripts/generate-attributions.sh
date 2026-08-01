#!/usr/bin/env bash
# Regenerates the checked-in OSS attribution manifests under Resources/Attributions/ from the
# app's three dependency sources. See
# docs/superpowers/specs/2026-07-31-oss-attributions-design.md.
#
# Usage:
#   scripts/generate-attributions.sh          # regenerate and overwrite Resources/Attributions/*.json
#   scripts/generate-attributions.sh --check  # regenerate into a temp dir and diff against the
#                                              # committed files; exits non-zero on any drift (CI mode).
#
# Requires: `swift package resolve` already run (app-binary), `npm ci` in Resources/Template
# (website-template), and — only for the container-image bucket — a sidecar checkout with
# `npm ci` already run at $ANGLESITE_SIDECAR_SRC (falls back to ../anglesite, same convention as
# scripts/lib/stage-dev-image-context.sh). Missing sidecar is a warning, not a failure: this
# script must still succeed for contributors who don't have the sidecar checked out.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERRIDES="$ROOT/scripts/attributions-overrides.json"
OUT_DIR="$ROOT/Resources/Attributions"

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
    CHECK=1
elif [[ $# -gt 0 ]]; then
    echo "unknown argument: $1" >&2
    exit 2
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> app-binary (Package.resolved)"
"$ROOT/scripts/generate-swift-attributions.sh" "$ROOT" "$WORK_DIR/app-binary.json" "$OVERRIDES"

echo "==> website-template (Resources/Template/node_modules)"
if [[ ! -d "$ROOT/Resources/Template/node_modules" ]]; then
    echo "error: Resources/Template/node_modules not found — run 'npm ci' in Resources/Template first." >&2
    exit 1
fi
node "$ROOT/scripts/generate-npm-attributions.mjs" "$ROOT/Resources/Template/node_modules" "$WORK_DIR/website-template.json" "$OVERRIDES"

SIDECAR_SRC="${ANGLESITE_SIDECAR_SRC:-${ANGLESITE_PLUGIN_SRC:-$(cd "$ROOT/.." && pwd)/anglesite}}"
if [[ -d "$SIDECAR_SRC/node_modules" ]]; then
    echo "==> container-image ($SIDECAR_SRC/node_modules)"
    node "$ROOT/scripts/generate-npm-attributions.mjs" "$SIDECAR_SRC/node_modules" "$WORK_DIR/container-image.json" "$OVERRIDES"
else
    echo "warning: $SIDECAR_SRC/node_modules not found — skipping container-image attributions." >&2
    echo "         Set ANGLESITE_SIDECAR_SRC and run 'npm ci' there to include it." >&2
fi

if [[ $CHECK -eq 1 ]]; then
    STATUS=0
    shopt -s nullglob
    for f in "$WORK_DIR"/*.json; do
        name="$(basename "$f")"
        if [[ ! -f "$OUT_DIR/$name" ]]; then
            echo "missing committed manifest: Resources/Attributions/$name" >&2
            STATUS=1
        elif ! diff -u "$OUT_DIR/$name" "$f"; then
            echo "stale committed manifest: Resources/Attributions/$name (run scripts/generate-attributions.sh to refresh)" >&2
            STATUS=1
        fi
    done
    exit $STATUS
else
    mkdir -p "$OUT_DIR"
    cp "$WORK_DIR"/*.json "$OUT_DIR/"
    echo "Wrote manifests to $OUT_DIR"
fi
