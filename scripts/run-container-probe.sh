#!/usr/bin/env bash
#
# Task 4b — build, entitle, and run the `anglesite-container-probe` CLI.
#
# `swift test`'s own runner (swiftpm-testing-helper) cannot carry
# `com.apple.security.virtualization` — Apple's toolchain is not ours to re-sign — so a bare
# `swift test` fails before `dialVsock` is ever reached for AnglesiteContainerLocalTests's live
# cases. This script builds `anglesite-container-probe` (a standalone executable that links
# AnglesiteContainer directly), code-signs the *actual built binary* with
# Resources/container-probe.entitlements, and execs it — giving the live vsock/boot gate a
# process that really is entitled.
#
# Usage:
#   scripts/run-container-probe.sh echo          # THE Task 4b decision gate (vsock round-trip)
#   scripts/run-container-probe.sh boot          # Task 5's gate (full boot + preview HTTP poll)
#   scripts/run-container-probe.sh workers-dev   # #708's gate (boot + local wrangler-dev HTTP poll)
#   scripts/run-container-probe.sh worker-toggle # #919's gate (updateActiveWorkers toggle restart)
#   scripts/run-container-probe.sh pause-resume  # suspend-on-close decision gate (vsock survives pause/resume)
#
# The boot probe is also the #715 concurrent-vmnet regression gate. Before running it, use
# `container network create anglesite-715-regression` to hold a second vmnet shared-mode network;
# see docs/qa/app-store-container-smoke-test.md for the deterministic setup and cleanup steps.
#
# The default ad-hoc signing is sufficient: `com.apple.security.virtualization` is an
# unrestricted entitlement, honored under `codesign --sign -` with no provisioning profile
# (verified 2026-07-07: the echo gate passed ad-hoc). SIGN_IDENTITY remains as an override for
# signing-shape experiments, e.g.:
#   SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" scripts/run-container-probe.sh echo

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SUBCOMMAND="${1:-}"
case "${SUBCOMMAND}" in
    echo|boot|workers-dev|worker-toggle|pause-resume) ;;
    *)
        echo "usage: $(basename "$0") <echo|boot|workers-dev|worker-toggle|pause-resume>" >&2
        exit 2
        ;;
esac

ENTITLEMENTS="${ROOT_DIR}/Resources/container-probe.entitlements"
[[ -f "${ENTITLEMENTS}" ]] || { echo "run-container-probe: missing ${ENTITLEMENTS}" >&2; exit 1; }

export ANGLESITE_CONTAINER_TESTS="${ANGLESITE_CONTAINER_TESTS:-1}"

echo "==> run-container-probe: building anglesite-container-probe (Debug)"
swift build --package-path "${ROOT_DIR}" --product anglesite-container-probe

BIN_PATH="$(swift build --package-path "${ROOT_DIR}" --product anglesite-container-probe --show-bin-path)/anglesite-container-probe"
[[ -x "${BIN_PATH}" ]] || { echo "run-container-probe: built binary not found at ${BIN_PATH}" >&2; exit 1; }

# Ad-hoc works (the entitlement is unrestricted); SIGN_IDENTITY overrides for
# signing-shape experiments.
IDENTITY="${SIGN_IDENTITY:--}"

echo "==> run-container-probe: signing ${BIN_PATH} with identity '${IDENTITY}' + ${ENTITLEMENTS}"
codesign --force --sign "${IDENTITY}" --entitlements "${ENTITLEMENTS}" "${BIN_PATH}"

echo "==> run-container-probe: running '${SUBCOMMAND}'"
exec "${BIN_PATH}" "${SUBCOMMAND}"
