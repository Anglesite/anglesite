#!/bin/bash
#
# SessionStart hook for Claude Code on the web.
#
# The Linux portable-target flow (see scripts/setup-dev-env.sh and
# README.md#developing-on-linux) needs a Swift 6.3+ toolchain for
# `swift build`/`swift test` to work, and web session containers don't ship
# one. The preferred install path is the cloud environment's **setup script**
# (fetched from GitHub via curl since the setup script runs before the
# session's repo clone exists, cached with the environment — see
# README.md#developing-on-linux); this hook is the per-session fallback for
# environments without that cache, and it owns the part a setup script can't
# do: persisting the toolchain's PATH/LD_LIBRARY_PATH into the session via
# $CLAUDE_ENV_FILE.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

: "${CLAUDE_ENV_FILE:?CLAUDE_ENV_FILE must be set}"

# Idempotent: no-ops fast when the environment cache (or an earlier session)
# already installed a Swift 6.3+ toolchain.
"${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/scripts/install-swift-linux.sh"

# Persist swiftly's PATH for the rest of this session (env.sh itself is a
# no-op re-source: it only prepends SWIFTLY_BIN_DIR if not already present).
SWIFTLY_ENV="$HOME/.local/share/swiftly/env.sh"
if [ -f "$SWIFTLY_ENV" ]; then
  echo ". \"$SWIFTLY_ENV\"" >> "$CLAUDE_ENV_FILE"
fi

# Distros shipping libxml2 >= 2.15 (e.g. Ubuntu 26.04) provide libxml2.so.16
# with no libxml2.so.2 compat symlink, but the swift.org toolchain's
# libFoundationXML links libxml2.so.2. Shim it with a user-level symlink (the
# API subset FoundationXML uses survived the soname bump) — mirrors
# scripts/setup-dev-env.sh's Linux path.
if ! ldconfig -p 2>/dev/null | grep -qF 'libxml2.so.2 '; then
  LIBXML2_NEW=$(ldconfig -p 2>/dev/null | awk '/libxml2\.so\.[0-9]+ /{ print $NF; exit }' || true)
  if [ -n "$LIBXML2_NEW" ]; then
    SHIM_DIR="$HOME/.local/lib/anglesite-shims"
    mkdir -p "$SHIM_DIR"
    ln -sf "$LIBXML2_NEW" "$SHIM_DIR/libxml2.so.2"
    case ":${LD_LIBRARY_PATH:-}:" in
      *":$SHIM_DIR:"*) ;;
      *) echo "export LD_LIBRARY_PATH=\"$SHIM_DIR\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\"" >> "$CLAUDE_ENV_FILE" ;;
    esac
  fi
fi
