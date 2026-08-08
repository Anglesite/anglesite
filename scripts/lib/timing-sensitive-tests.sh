#!/usr/bin/env bash
# Single source of truth for the suite names moved into CI's isolated, low-concurrency
# test lane (#1344). `build-test`'s full `swift test --parallel` run --skips this same
# regex so these suites run exactly once, in scripts/test-timing-sensitive.sh's job
# instead. Keep this list to suites with direct #1344 evidence or an equivalent
# self-diagnosed cross-suite-contention doc comment — see the plan at
# docs/superpowers/plans/2026-08-07-ci-isolate-timing-sensitive-tests.md for the
# inclusion criteria and the suites considered and left out.
#
# Unanchored regex substring match against `<test-target>.<test-case>/<test>` (SwiftPM's
# `swift test --filter`/`--skip`, confirmed via `swift test --help`: no tag-based
# filtering exists in this toolchain). Each name below was checked for accidental
# substring collisions against every other suite in Tests/.
export TIMING_SENSITIVE_TEST_FILTER='VsockTCPProxyTests|E2EServerReadinessTests|AuditCommandTests|MCPClientTests'
