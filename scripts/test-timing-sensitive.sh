#!/usr/bin/env bash
#
# Run the timing-sensitive suites (real sockets, real subprocess spawns, wall-clock
# budget assertions) in their own low-concurrency swift test invocation, isolated from
# build-test's ~3,500-test `swift test --parallel` run.
#
# Why: build-test's shared GCD/dispatch thread pool gets oversubscribed under full
# parallel load badly enough that these suites miss their own real-I/O deadlines — not a
# code defect, a scheduling one. PR #1289 saw build-test fail 7/7 times on an unmodified
# commit, rotating through VsockTCPProxyTests, E2EServerReadinessTests, and
# AuditCommandTests with no code changes between retries. See #1344 for the full
# writeup and scripts/lib/timing-sensitive-tests.sh for the suite list and inclusion
# criteria.
#
# Deliberately does NOT pass --parallel: `swift test`'s default is already
# --no-parallel (confirmed via `swift test --help`), which is exactly the "less
# concurrent load" the suites below need — no extra flag required.
#
# Prerequisites:
#   - Xcode 27+ toolchain selected (CI selects the newest installed Xcode before
#     invoking this script; locally, point DEVELOPER_DIR at one).
#
# Usage:
#   scripts/test-timing-sensitive.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/lib/timing-sensitive-tests.sh

echo "Running timing-sensitive suites in isolation: $TIMING_SENSITIVE_TEST_FILTER"
exec swift test -c debug --filter "$TIMING_SENSITIVE_TEST_FILTER"
