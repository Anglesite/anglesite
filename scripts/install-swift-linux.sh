#!/bin/bash
#
# Install a Swift 6.3+ toolchain on Linux via swiftly
# (https://www.swift.org/install/linux/), mirroring the manual instructions
# scripts/setup-dev-env.sh prints. Idempotent: no-ops fast when a new-enough
# toolchain is already on PATH (including one swiftly installed previously).
#
# Two consumers:
#
#   * The Claude Code cloud environment **setup script** (claude.ai/code →
#     environment settings): `bash scripts/install-swift-linux.sh`. The result
#     is cached with the environment, so sessions start with Swift already
#     installed. See README.md#developing-on-linux.
#   * `.claude/hooks/session-start.sh`, the per-session fallback for cloud
#     sessions whose environment has no cached toolchain. The hook also owns
#     persisting PATH/LD_LIBRARY_PATH for the session — this script only
#     installs.
#
# Needs network egress to www.swift.org and download.swift.org; a cloud
# environment with restricted network access must allowlist those hosts.
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "install-swift-linux.sh: Linux only — on macOS, install Xcode (see README.md#requirements)" >&2
  exit 1
fi

SWIFTLY_ENV="$HOME/.local/share/swiftly/env.sh"
# shellcheck source=/dev/null
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
# GNUPGHOME so this doesn't touch any real user keyring. Runs unattended,
# unlike the manual install instructions this mirrors, so skipping
# verification here would be a bigger risk than there. Best-effort: if gpg
# isn't available, warn and fall through rather than blocking bootstrap on an
# optional tool.
verify_swiftly_tarball() {
  local tarball="$1" sig="$2"
  if ! command -v gpg >/dev/null 2>&1; then
    echo "warning: gpg not found — skipping swiftly signature verification" >&2
    return 0
  fi
  local gpg_home
  gpg_home=$(mktemp -d)
  # Expand gpg_home now, not at trap time.
  # shellcheck disable=SC2064
  trap "rm -rf '$gpg_home'" RETURN
  curl -fsSL --compressed https://www.swift.org/keys/all-keys.asc \
    | gpg --homedir "$gpg_home" --quiet --import -
  gpg --homedir "$gpg_home" --quiet --verify "$sig" "$tarball"
}

if swift_version_ok; then
  echo "Swift already present ($(swift --version 2>/dev/null | head -1)) — nothing to install"
  exit 0
fi

if ! command -v swiftly >/dev/null 2>&1; then
  curl -fsSL -o /tmp/swiftly.tar.gz "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"
  curl -fsSL -o /tmp/swiftly.tar.gz.sig "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz.sig"
  verify_swiftly_tarball /tmp/swiftly.tar.gz /tmp/swiftly.tar.gz.sig
  tar zxf /tmp/swiftly.tar.gz -C /tmp
  /tmp/swiftly init -y --no-modify-profile --skip-install
  rm -f /tmp/swiftly.tar.gz /tmp/swiftly.tar.gz.sig /tmp/swiftly
  # shellcheck source=/dev/null
  . "$SWIFTLY_ENV"
fi

# `swiftly install` fetches swift.org's PGP keys itself (separate from
# verify_swiftly_tarball above, which only covers the swiftly binary) before
# verifying the toolchain download. That fetch has been observed to fail fast
# and deterministically within a single run — gpg importing a 0-byte temp
# file — without reproducing on a fresh container or under direct network
# pressure (curl and a standalone URLSession loop against the same URL both
# came back clean), so retrying the whole command is more effective than
# trying to fix a root cause that doesn't hold still.
attempt=1
max_attempts=3
delay=5
until swiftly install latest -y; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "install-swift-linux.sh: swiftly install latest -y failed after $max_attempts attempts" >&2
    exit 1
  fi
  echo "install-swift-linux.sh: swiftly install latest -y failed (attempt $attempt/$max_attempts) — retrying in ${delay}s" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay=$((delay * 2))
done
