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

: "${CLAUDE_ENV_FILE:?CLAUDE_ENV_FILE must be set}"

SWIFTLY_ENV="$HOME/.local/share/swiftly/env.sh"
[ -f "$SWIFTLY_ENV" ] && . "$SWIFTLY_ENV"

swift_version_ok() {
  command -v swift >/dev/null 2>&1 || return 1
  local version minor
  version=$(swift --version 2>/dev/null | sed -n 's/^Swift version \([0-9.]*\).*/\1/p' | head -1)
  minor=$(printf '%s' "${version:-0}" | awk -F. '{ printf "%d%02d", $1, $2 }')
  [ "${minor:-0}" -ge 603 ]
}

# Verifies the downloaded swiftly tarball against swift.org's published PGP
# signature (https://www.swift.org/install/linux/swiftly/), in an isolated
# GNUPGHOME so this doesn't touch any real user keyring. Runs unattended on
# every qualifying web session, unlike the manual install instructions this
# mirrors, so skipping verification here would be a bigger risk than there.
# Best-effort: if gpg isn't available, warn and fall through rather than
# blocking session bootstrap on an optional tool.
verify_swiftly_tarball() {
  local tarball="$1" sig="$2"
  if ! command -v gpg >/dev/null 2>&1; then
    echo "warning: gpg not found — skipping swiftly signature verification" >&2
    return 0
  fi
  local gpg_home
  gpg_home=$(mktemp -d)
  # shellcheck disable=SC2064 (expand gpg_home now, not at trap time)
  trap "rm -rf '$gpg_home'" RETURN
  curl -fsSL --compressed https://www.swift.org/keys/all-keys.asc \
    | gpg --homedir "$gpg_home" --quiet --import -
  gpg --homedir "$gpg_home" --quiet --verify "$sig" "$tarball"
}

if ! swift_version_ok; then
  if ! command -v swiftly >/dev/null 2>&1; then
    curl -fsSL -o /tmp/swiftly.tar.gz "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"
    curl -fsSL -o /tmp/swiftly.tar.gz.sig "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz.sig"
    verify_swiftly_tarball /tmp/swiftly.tar.gz /tmp/swiftly.tar.gz.sig
    tar zxf /tmp/swiftly.tar.gz -C /tmp
    /tmp/swiftly init -y --no-modify-profile --skip-install
    rm -f /tmp/swiftly.tar.gz /tmp/swiftly.tar.gz.sig /tmp/swiftly
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
