#!/usr/bin/env bash
# Wrapper around xcodebuild that regenerates Anglesite.xcodeproj first.
#
# The gitignored .xcodeproj can go stale relative to project.yml or Sources/
# whenever a checkout advances by something other than `git checkout`/`merge`/
# `rebase` — those are the only triggers scripts/git-hooks/regenerate-xcodeproj.sh
# watches. A checkout synced by other means (e.g. fetch+reset) bypasses those
# hooks silently, and the next build fails with a confusing
# `error: cannot find 'X' in scope` instead of a stale-project error (#123).
#
# xcodegen generate is idempotent and takes ~1-2s, so running it unconditionally
# before every build removes that whole class of failure regardless of how the
# checkout got to its current state.
#
# Usage: scripts/build-app.sh <xcodebuild args...>
#   scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "error: xcodegen not found on PATH — install with: brew install xcodegen" >&2
  exit 1
fi

xcodegen generate --quiet
exec xcodebuild "$@"
