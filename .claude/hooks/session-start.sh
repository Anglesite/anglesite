#!/bin/bash
#
# SessionStart hook for Claude Code on the web.
#
# The Linux portable-target flow (see scripts/setup-dev-env.sh and
# README.md#developing-on-linux) needs a Swift 6.3+ toolchain, installed via
# swiftly, for `swift build`/`swift test` to work. Web session containers
# don't ship one, so install it here.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

SWIFTLY_ENV="$HOME/.local/share/swiftly/env.sh"
[ -f "$SWIFTLY_ENV" ] && . "$SWIFTLY_ENV"

swift_version_ok() {
  command -v swift >/dev/null 2>&1 || return 1
  local version minor
  version=$(swift --version 2>/dev/null | sed -n 's/^Swift version \([0-9.]*\).*/\1/p' | head -1)
  minor=$(printf '%s' "${version:-0}" | awk -F. '{ printf "%d%02d", $1, $2 }')
  [ "${minor:-0}" -ge 603 ]
}

if ! swift_version_ok; then
  if ! command -v swiftly >/dev/null 2>&1; then
    curl -fsSL -o /tmp/swiftly.tar.gz "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"
    tar zxf /tmp/swiftly.tar.gz -C /tmp
    /tmp/swiftly init -y --no-modify-profile --skip-install
    rm -f /tmp/swiftly.tar.gz /tmp/swiftly
    . "$SWIFTLY_ENV"
  fi
  swiftly install latest -y
fi

# Persist swiftly's PATH for the rest of this session (env.sh itself is a
# no-op re-source: it only prepends SWIFTLY_BIN_DIR if not already present).
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
