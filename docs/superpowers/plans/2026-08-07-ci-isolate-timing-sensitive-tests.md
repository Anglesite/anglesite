# CI: Isolate Timing-Sensitive Test Suites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Swift Testing suites that flake under `build-test`'s full-parallel scheduler contention (real sockets, real subprocess spawns, wall-clock budget assertions) into their own low-concurrency CI job, so they stop fighting ~3,500 other tests for the same thread pool.

**Architecture:** Extract the filter regex identifying these suites into one sourced bash library (`scripts/lib/timing-sensitive-tests.sh`) so both the new isolated-lane script and `build-test`'s existing test step read the identical list — no drift between "what runs isolated" and "what's excluded from the big run". Add a new independent `timing-sensitive-tests` CI job (parallel with `build-test`, not sequential after it — these suites have no shared state with the rest of the run, so there's no correctness reason to serialize the jobs, only a scheduler-contention reason to give them their own process). `swift test`'s default is already non-parallel (`--parallel` is opt-in — confirmed via `swift test --help`), so the isolated lane needs no extra concurrency flag to get "less concurrent load" than `build-test`.

**Tech Stack:** GitHub Actions (`.github/workflows/ci.yml`), bash, SwiftPM (`swift test --filter`/`--skip`, both plain regex over `<test-target>.<test-case>/<test>`, no tag syntax available in this toolchain).

## Global Constraints

- Repo convention: commit subject ≤72 chars, PR body copies `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan), `Closes #1344` closing keyword. Source: CONTRIBUTING.md ▸ "Commits and pull requests".
- This is CI-only config + scripts — no MCP schema change, so no paired sidecar PR needed (CONTRIBUTING.md ▸ "Paired PRs").
- Keep the PR focused: only move suites with direct evidence in #1344 or a suite that self-diagnoses the identical cross-suite-contention problem in its own doc comments (CONTRIBUTING.md ▸ "Keep PRs focused").
- `swift test --filter`/`--skip` are unanchored regex substring matches against the full test identifier — established convention per `scripts/test-concurrency-tsan.sh`'s existing `--filter 'TurnRelay|TextStreamRelay|ProcessSupervisor|DomainConfigStore'`.

---

## Suites moving into the isolated lane (final scope)

All four live in `Tests/AnglesiteCoreTests/` and none depend on the sibling plugin/Node checkout, so the new job needs no plugin checkout, no `npm ci`, no Node setup — just Xcode selection + `swift test`. Verified no accidental regex-substring collisions against the rest of `Tests/` (checked via `grep -rl` for each keyword).

| Suite | Evidence |
|---|---|
| `VsockTCPProxyTests` | Named in #1344; real sockets; already `.serialized` + `.timeLimit(.minutes(1))`; doc comment cites #556, PR #558, PR #1264. |
| `E2EServerReadinessTests` | Named in #1344 ("5.0s budget check... 5.35s/6.47s"); real `/bin/sh` subprocesses via `ProcessSupervisor`; `timeoutIsDistinctFromCrash` asserts `Date().timeIntervalSince(start) < 5`. |
| `AuditCommandTests` | Named in #1344 ("10s wait for a subprocess-started marker timed out"); real subprocess spawns via a private `ProcessSupervisor`; own comment already diagnoses cross-suite contention but has no mitigating trait yet — highest-priority mover. |
| `MCPClientTests` | Not named in #1344, but its own doc comment (`.serialized`, #609/#610) diagnoses the identical problem class: "the one test that still spawns a real subprocess... doesn't contend for CPU with other subprocess-spawning suites under `swift test --parallel`." |

**Explicitly out of scope for this PR** (candidates for a future follow-up if they show up in flake logs — noted in the PR body, not filed as new issues): `MCPClientHTTPEndToEndTests` and `ComponentModelEndToEndTests` (same contention rationale in their own comments, but moving them needs the full plugin-sibling-checkout + Node setup duplicated into the new job — real added CI cost with no direct #1344 evidence); `AppliesEditEndToEndTests` (different test target, same plugin-setup cost issue); `SiteFileWatcherTests` and `HMRRelayTests` (real timing sensitivity, but a different mechanism — FSEvents hang-guard and in-process relay scheduling, not the documented cross-suite subprocess/socket contention this issue is about).

Filter regex (both scripts must use the exact same string): `VsockTCPProxyTests|E2EServerReadinessTests|AuditCommandTests|MCPClientTests`

---

### Task 1: Shared filter regex library

**Files:**
- Create: `scripts/lib/timing-sensitive-tests.sh`

**Interfaces:**
- Produces: `TIMING_SENSITIVE_TEST_FILTER` (shell variable, exported), consumed by Task 2's script and Task 3's `ci.yml` edit.

- [ ] **Step 1: Write the library file**

```bash
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
```

- [ ] **Step 2: Verify it's sourceable and sets the variable**

Run:
```bash
bash -c 'source scripts/lib/timing-sensitive-tests.sh && echo "$TIMING_SENSITIVE_TEST_FILTER"'
```
Expected: prints `VsockTCPProxyTests|E2EServerReadinessTests|AuditCommandTests|MCPClientTests`

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/timing-sensitive-tests.sh
git commit -m "ci(#1344): add shared timing-sensitive test filter"
```

---

### Task 2: Isolated-lane test runner script

**Files:**
- Create: `scripts/test-timing-sensitive.sh`
- Consumes: `scripts/lib/timing-sensitive-tests.sh`'s `TIMING_SENSITIVE_TEST_FILTER` (Task 1)

- [ ] **Step 1: Write the script**

```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/test-timing-sensitive.sh
```

- [ ] **Step 3: Run it locally and verify it only runs the four moved suites**

Run: `scripts/test-timing-sensitive.sh 2>&1 | tee /tmp/timing-sensitive-run.log`
Expected: PASS, and the suite names printed during the run are only `VsockTCPProxyTests`, `E2EServerReadinessTests`, `AuditCommandTests`, `MCPClientTests` (spot-check with `grep -oE '(VsockTCPProxyTests|E2EServerReadinessTests|AuditCommandTests|MCPClientTests|Suite ")' /tmp/timing-sensitive-run.log | sort -u`).

- [ ] **Step 4: Commit**

```bash
git add scripts/test-timing-sensitive.sh
git commit -m "ci(#1344): add isolated timing-sensitive test runner script"
```

---

### Task 3: Wire the new CI job into ci.yml and exclude the moved suites from build-test

**Files:**
- Modify: `.github/workflows/ci.yml`
  - `build-test` job's `Test` step (currently around what was line 376-382 before this edit)
  - `ci` required-checks job's `needs:` list (currently around what was line 758-769)
- Consumes: `scripts/test-timing-sensitive.sh` (Task 2), `scripts/lib/timing-sensitive-tests.sh` (Task 1)

- [ ] **Step 1: Add `--skip` to build-test's existing Test step**

Find the `build-test` job's `Test` step (the one running `swift test -c debug --parallel 2>&1 | tee ...`) and change its `run:` block to source the shared filter and skip those suites:

```yaml
      - name: Test
        id: swift-test
        env:
          ANGLESITE_PLUGIN_PATH: ${{ github.workspace }}/anglesite-plugin
        run: |
          set -o pipefail
          source scripts/lib/timing-sensitive-tests.sh
          swift test -c debug --parallel --skip "$TIMING_SENSITIVE_TEST_FILTER" 2>&1 | tee "$RUNNER_TEMP/swift-test.log"
```

- [ ] **Step 2: Add the new `timing-sensitive-tests` job**

Insert as a new top-level job (placement: directly after the `build-test` job, before `ios-build`, so related lanes stay adjacent in the file):

```yaml
  timing-sensitive-tests:
    name: Timing-sensitive suites (isolated lane)
    # Same macos-15 task-allocator rationale as build-test: this lane also runs Swift
    # concurrency/subprocess code against the host's libswift_Concurrency.
    needs: changes
    if: needs.changes.outputs.swift == 'true'
    runs-on: macos-26
    timeout-minutes: 15
    # Independent of (not sequential after) build-test: these suites share no state with
    # the rest of the test run, so there's no correctness reason to wait — only a
    # scheduler-contention reason to give them their own process. Running in parallel
    # keeps this from adding to build-test's wall-clock cost. See #1344.
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Select latest available Xcode
        id: xcode
        run: |
          set -euo pipefail
          ls -d /Applications/Xcode*.app 2>/dev/null | sort -V
          # Skip Xcode 26.3 on the current runner image: its toolchain builds test targets that
          # link /usr/lib/swift/libswift_DarwinFoundation3.dylib, which the image does not ship, so
          # `swift test` fails to load AnglesitePackageTests.xctest ("Library not loaded"). Prefer the
          # newest *working* Xcode — 26.3 is excluded, so 27 is still auto-selected once it lands.
          # Remove the grep once the 26.3 image is repaired (or Xcode 27 is available).
          LATEST=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | grep -vE '/Xcode_26\.3(\.app|\.[0-9]+\.app)$' | tail -1)
          echo "Selecting: $LATEST"
          sudo xcode-select -s "$LATEST"
          echo "version=$(basename "$LATEST")" >> "$GITHUB_OUTPUT"

      - name: Show toolchain versions
        run: swift --version

      # Distinct key namespace from build-test's `swiftpm-macos-...` cache: this job never sets
      # ANGLESITE_PLUGIN_PATH, so it resolves/builds a different (smaller) target set, and sharing
      # a cache key would just churn. See linux-build-test's cache step for the general key-scheme
      # rationale (including the `v1` bump-on-recurrence convention).
      - name: Cache SwiftPM build
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: .build
          key: swiftpm-timing-sensitive-macos-v1-${{ steps.xcode.outputs.version }}-${{ hashFiles('Package.resolved') }}-${{ github.sha }}
          restore-keys: |
            swiftpm-timing-sensitive-macos-v1-${{ steps.xcode.outputs.version }}-${{ hashFiles('Package.resolved') }}-
            swiftpm-timing-sensitive-macos-v1-${{ steps.xcode.outputs.version }}-

      # tee + pipefail + annotate step: same compile-error-burying fix as build-test's Test step
      # (#1335).
      - name: Run timing-sensitive suites in isolation
        id: timing-sensitive-test
        run: |
          set -o pipefail
          scripts/test-timing-sensitive.sh 2>&1 | tee "$RUNNER_TEMP/swift-timing-sensitive-test.log"

      - name: Surface Swift errors (annotations + job summary)
        if: failure() && steps.timing-sensitive-test.outcome == 'failure'
        run: scripts/annotate-swift-log.sh "$RUNNER_TEMP/swift-timing-sensitive-test.log" "Timing-sensitive suites (isolated lane) ▸ Run timing-sensitive suites in isolation"
```

- [ ] **Step 3: Add the new job to the `ci` required-checks job's `needs:` list**

In the `ci:` job, add `- timing-sensitive-tests` to the `needs:` list (alphabetical/logical grouping matches the existing list — insert after `build-test`):

```yaml
    needs:
      - changes
      - edit-overlay
      - help-book-links
      - linux-build-test
      - build-test
      - timing-sensitive-tests
      - ios-build
      - concurrency-tsan
      - docs-docc
      - xcodeproj-sync
      - localization-catalog
      - appintents-schema
```

- [ ] **Step 4: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 5: Verify build-test's own filter locally (confirms the moved suites are actually excluded)**

Run:
```bash
source scripts/lib/timing-sensitive-tests.sh
swift test -c debug --parallel --skip "$TIMING_SENSITIVE_TEST_FILTER" --filter 'AnglesiteCoreTests' 2>&1 | tee /tmp/build-test-filtered.log
```
Expected: PASS, and none of `VsockTCPProxyTests`, `E2EServerReadinessTests`, `AuditCommandTests`, `MCPClientTests` appear as run suites in the log (spot-check with the same `grep -oE` as Task 2 Step 3 — expect zero matches this time).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(#1344): isolate timing-sensitive suites into their own lane"
```

---

### Task 4: Update AGENTS.md/CLAUDE.md's Swift-lanes note if it references the single-lane structure

**Files:**
- Modify (only if applicable — check first): `AGENTS.md` (mirrored as `CLAUDE.md`)

- [ ] **Step 1: Check whether the "Swift lanes" note (referenced by VsockTCPProxyTests' own doc comment) enumerates CI jobs by name**

```bash
grep -n "Swift lanes" AGENTS.md
```

- [ ] **Step 2a: If it lists jobs by name, add `timing-sensitive-tests` to the list matching the existing style. If it doesn't enumerate jobs (e.g. it's just the macos-26 rationale note already quoted in CLAUDE.md's memory), skip this task — no edit needed.**

- [ ] **Step 3: If edited, commit**

```bash
git add AGENTS.md
git commit -m "docs(#1344): note new timing-sensitive-tests CI lane"
```

---

## Self-Review Notes

- **Spec coverage:** Issue's "Proposed direction" (own CI job, less concurrent load, root-cause not symptom) → Tasks 2-3. Issue's "identifying the full set of suites" tradeoff → scope table above with explicit inclusion/exclusion reasoning. Issue's "sequentially or parallel" tradeoff → resolved as parallel (Task 3 Step 2 comment explains why). Issue's "CI wall-clock cost" tradeoff → addressed by keeping the new job dependency-light (no plugin checkout) and running in parallel, not blocking.
- **No placeholders:** every step has literal file content, not descriptions.
- **Type/name consistency:** `TIMING_SENSITIVE_TEST_FILTER` is the same variable name used in Task 1 (definition), Task 2 (consumption in the runner script), and Task 3 (consumption in `ci.yml`'s `build-test` step). Filter string is character-identical in all three places.
