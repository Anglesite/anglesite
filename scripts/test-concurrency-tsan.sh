#!/usr/bin/env bash
#
# Run the relay and process-supervision concurrency suites under ThreadSanitizer.
#
# TurnRelay/TextStreamRelay gate event delivery and enforce once-only terminal
# transitions across a producer/consumer race. The `concurrentDeliver*` tests
# exercise that race only *probabilistically* — under a normal Debug build the
# window is tiny, so a regression (dropping the NSLock, a torn read of `finished`,
# or yielding a non-terminal event after the terminal one) can slip through CI by
# luck. TSan deterministically flags data races regardless of timing.
#
# ProcessSupervisor/InProcessBackend joined this lane per #856: a `swift test
# --parallel` run crashed signal 6 inside `InProcessBackend.finalize`'s exit-waiter
# dictionary iteration (a tagged-pointer-string selector sent to a garbage
# pointer — the classic signature of a concurrently-mutated Dictionary). The
# crash didn't reproduce on rerun and a manual actor-isolation audit found no
# violated invariant, so this lane exists to catch it deterministically if it's a
# genuine race rather than environment noise, the same way #203 covers the relay
# suites.
#
# DomainConfigStore joined this lane per #1255: `DomainConfigStore.update(_:)`
# holds a per-file `NSLock` across its own load-mutate-save sequence so two
# concurrent producers can't both read the same stale snapshot before either
# writes. `DomainConfigStoreUpdateTests`' concurrent-producers test exercises
# that race only *probabilistically* under a plain `swift test --parallel` run
# (no artificial barrier forces the interleaving) — the same weak-coverage gap
# TSan exists to close for the relay suites above.
#
# Scoped to these suites (--filter
# 'TurnRelay|TextStreamRelay|ProcessSupervisor|DomainConfigStore') to keep the
# run fast and avoid sanitizing the model-gated FoundationModels tests. Keep
# this scoped to the original relay suites specifically — a bare 'Relay' also
# matches AnglesiteP2PTests/HMRRelayTests, whose concurrentDeliver*-style tests
# use 20ms timing windows that balloon 5-15x under the sanitizer. P2P suites
# are intentionally excluded from this lane.
#
# Prerequisites:
#   - Xcode 27+ toolchain. Locally, point DEVELOPER_DIR at it (the default
#     CommandLineTools swift is too old / broken for this package):
#       export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
#     CI selects the newest installed Xcode before invoking this script.
#
# Usage:
#   scripts/test-concurrency-tsan.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Running relay, process-supervision, and DomainConfigStore concurrency suites under ThreadSanitizer…"
exec xcrun swift test --sanitize thread --filter 'TurnRelay|TextStreamRelay|ProcessSupervisor|DomainConfigStore'
