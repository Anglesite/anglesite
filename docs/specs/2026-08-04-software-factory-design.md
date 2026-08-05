# Software factory — design proposal

**Date:** 2026-08-04
**Status:** Proposal (Phase 0 of epic #1256)
**Prompt:** "Can we build a software factory for Anglesite?" — referencing
[Cloudflare's Astro issue-triage post](https://blog.cloudflare.com/astro-issue-triage/)

**Short answer: yes — and about half of it already exists.** This repo already runs a
proto-factory: concurrent agent sessions in worktrees, `🛠️ In Progress` issue claiming,
design-doc-first discipline, deterministic CI gates, and agents that babysit their PRs to
green. What's missing is the front of the pipeline (automated intake triage), a formal
state machine, a dispatcher, and a systematic failure-feedback loop. This doc maps
Cloudflare's design onto Anglesite's real constraints and proposes a phased build-out.

## 1. What Cloudflare built

The Astro triage pipeline reduced open issues from 200+ to ~30. Its load-bearing ideas:

- **Label-driven state machine.** No persistent pipeline state; an issue's labels and
  comment history *are* the state. Any run can resume from what's on the issue.
- **Phase-isolated subagents:** reproduce → diagnose → verify → fix, each writing a
  `report.md` passed forward. Isolation stops an LLM from "forcing" a fix to justify its
  own earlier reasoning.
- **Preview releases before PRs.** A fix ships as an installable preview
  (pkg.pr.new); the *original reporter* confirms it works before a PR opens.
- **Failures are architecture signals.** When an agent fails, the diagnosis is an opaque
  abstraction, a missing comment/test/doc — and fixing *that* makes the whole factory
  better. This is the virtuous cycle that compounds.

## 2. What Anglesite already runs

| Factory component | Anglesite today |
|---|---|
| Concurrent agents, isolated workspaces | Worktrees under `.claude/worktrees/`, mandatory for agent work |
| Work claiming / mutual exclusion | `🛠️ In Progress` label protocol (CONTRIBUTING) |
| Deterministic quality gates | CI lanes (JS, Linux portable, macOS `swift test` + TSan, project-sync, AppIntents schema, localization catalog); pre-deploy gate philosophy — "a non-LLM gate can't be prompt-injected or talked out of running" is *already this repo's stated doctrine* |
| Design-first discipline | `docs/specs/` + `docs/superpowers/specs/` design docs before implementation |
| PR drive-to-green | Agent sessions subscribe to PR events, fix CI failures and review comments until merge |
| Failure → institutional memory | CONTRIBUTING/CLAUDE.md accrete hard-won lessons (the `.xcstrings` sync saga, the DerivedData glob incident) — cultural today, not enforced |

Missing: automated intake triage, explicit pipeline states beyond `🛠️ In Progress`, a
scheduled dispatcher that *starts* work unprompted, a repro-before-fix discipline for bug
reports, a preview-release analog, and a mandatory failure-capture loop.

## 3. Where Anglesite differs from Astro

These differences reshape the factory; ignoring them would produce a cargo-cult copy.

1. **Toolchain ceiling.** Astro is clone-and-`npm test` anywhere. Anglesite targets
   macOS 27 + Xcode 27; GitHub-hosted runners can run `swift test` (macos-26 lane) but
   **cannot launch the app for hosted tests** (LaunchServices blocks a macOS-27 `.app` on
   older runners — see CLAUDE.md ▸ Build). Verification is therefore *tiered* (§4.4),
   not uniform, and the factory must route each issue to the highest tier that can
   actually prove its fix.
2. **Issue population.** Astro's inbox is external bug reports with reproduction repos.
   Anglesite's open issues are mostly owner/agent-authored backlog items (features,
   epics, QA tasks). The reproduce stage applies to a minority; the bigger win here is
   **backlog throughput** (dispatcher + fix agents), not inbound triage volume.
3. **Reporter verification.** Cloudflare's human gate is "reporter confirms the preview
   fixes their project." Our reporter is (almost always) the owner, and the repo already
   models this as the `✅ Manual QA` label — the factory reuses it rather than inventing
   a new gate.
4. **Actions policy.** The org's GitHub Actions policy allows only GitHub-owned /
   Verified-Creator actions — `.github/workflows/ci.yml` already had to inline a
   path-filter action over this. Cloudflare's `triagebot-action` and pkg.pr.new
   wouldn't qualify. `anthropics/claude-code-action` is published by Anthropic (a
   verified creator) and *should* pass, but this must be verified against the org policy
   before Phase A commits to it; the fallback is running triage from a scheduled Claude
   Code remote session instead (§4.3).
5. **Two-repo coordination.** MCP-schema changes need paired PRs with
   `Anglesite/anglesite-skills` and a tagged sidecar release first. The factory must
   detect schema-touching work and hand it to a human rather than half-land it (§4.6).
6. **No `npm publish` artifact.** The preview-release analog for app changes is a
   TestFlight build — which requires the Xcode Cloud lane (`docs/xcode-cloud.md`, specced
   but not stood up) and is explicitly a later phase, not a prerequisite.

## 4. Design

### 4.1 State machine (labels)

Following the repo's emoji-label convention, one new `🏭` family. As in Cloudflare's
design, labels + issue comments are the *only* pipeline state — any agent can resume any
issue cold by reading them.

| Label | Meaning |
|---|---|
| `🏭 Needs repro` | Bug report without a failing test; reproduce stage owns it |
| `🏭 Ready` | Scoped, unblocked, and safe for an autonomous fix agent |
| `🏭 Blocked: human` | Needs an owner decision, paired sidecar PR, or Mac-hardware verification |
| *(reused)* `🛠️ In Progress` | Claimed by an agent/person — existing protocol, unchanged |
| *(reused)* `✅ Manual QA` | Human verification required before/at merge |

Flow: *new issue* → intake (area `🎯` label + classify) → `🏭 Needs repro` (bugs) or
`🏭 Ready` (scoped work) or `🏭 Blocked: human` → claim (`🛠️ In Progress`) → PR →
CI gates (+ `✅ Manual QA` where routed) → human merge. Closing keywords in PR bodies
already handle state cleanup on merge — no new teardown machinery.

### 4.2 Pipeline stages

- **Stage 0 — Intake** (on issue open): dedupe against existing issues, apply `🎯` area
  label, classify (bug / feature / epic / question), request missing info, assign a
  `🏭` state. Comment-only + labels; no code execution.
- **Stage 1 — Reproduce** (bugs): turn the report into a *failing test* in the
  appropriate suite for its tier (§4.4), posted as a report comment with the test diff.
  No fixing.
- **Stage 2 — Diagnose:** root-cause with instrumentation; posts a diagnosis report
  comment. Kept separate from Stage 1 and 3 per Cloudflare's bias guard: the fixer
  starts from reports, not from its own repro rabbit hole.
- **Stage 3 — Fix:** a fresh agent takes the reports → worktree → test-first PR under
  full CONTRIBUTING compliance (conventional commit, PR template with Paired PR check,
  closing keyword). The existing PR drive-to-green loop takes over.
- **Stage 4 — Verify:** deterministic gates only (§4.5). UX-affecting changes carry
  `✅ Manual QA`; the owner confirms in-app behavior. **Agents never merge.**
- **Stage 5 — Feedback (mandatory):** any run that fails or exhausts its attempt budget
  must end by filing a gap issue — the missing doc, test seam, or opaque abstraction
  that beat the agent. This converts Cloudflare's key cultural insight into an enforced
  pipeline step; it's the part that compounds.

### 4.3 Execution substrate

Hybrid, playing to what already works:

- **Intake (Stage 0):** GitHub Actions on `issues: opened` with
  `claude-code-action` — event-driven, stateless, cheap, and needs only
  read/label/comment scope. Contingent on the Actions-policy check (§3.4); fallback is
  an hourly scheduled Claude Code remote session sweeping recently opened issues. Needs
  an `ANTHROPIC_API_KEY` secret either way (owner setup).
- **Reproduce/diagnose/fix (Stages 1–3):** Claude Code remote sessions — the substrate
  already doing this work here, with worktrees, Tier-1/2 test execution, and PR
  babysitting. The **dispatcher** is a scheduled session that picks the oldest
  `🏭 Ready` issue not labeled `🛠️ In Progress`, claims it, and launches a fix session —
  with a hard concurrency cap (start: 3) and a per-issue attempt cap (2 attempts, then
  `🏭 Blocked: human` + a Stage-5 gap issue).

### 4.4 Verification tiers

The honest core of this design: what can the factory *prove*, per change class?

| Tier | Substrate | Covers | Factory can close the loop? |
|---|---|---|---|
| 1 | Linux (Actions `ubuntu` / remote session) | Portable SwiftPM targets, JS edit overlay (lint/typecheck/vitest), template checks, docs | **Yes — fully autonomous** |
| 2 | GitHub `macos-26` runner | `swift test` all packages incl. TSan lanes | Yes (CI-gated) |
| 3 | Xcode Cloud (real Xcode 27 toolchain) | App-target Debug build + `swift test` | Yes once the `docs/xcode-cloud.md` lane is stood up — the only *automated* real-toolchain signal |
| 4 | Owner's Mac | Hosted-app/UI behavior, container e2e, MAS smoke, TestFlight | **No — `✅ Manual QA` gate** |

Routing rule: intake tags each issue with its highest *reachable* tier from the affected
paths. A fix whose proof needs Tier 4 still gets a PR — it just carries `✅ Manual QA`
and never auto-advances past it.

### 4.5 Guardrails

- **Only deterministic gates advance state.** CI lanes and the failing-test-first proof
  (test fails on `main`, passes on the PR — mechanically checkable) decide progression;
  agent self-assessment never does. Same doctrine as the pre-deploy gate, which this
  design does not touch — the factory has no deploy powers at all.
- **Untrusted input containment.** Issue bodies are attacker-writable input to the
  intake agent, so Stage 0 gets no code execution and no secrets. Reproduction of
  external repro repos (rare here, per §3.2) runs only in a disposable, secretless
  sandbox.
- **Humans hold the merge.** No auto-merge, no agent merge rights. The two human gates
  (merge review, `✅ Manual QA`) mirror Cloudflare's reporter-verification point.
- **Cost containment.** Concurrency cap + attempt cap (§4.3); every capped-out issue
  produces a Stage-5 gap issue instead of a silent retry loop.
- **Existing claim protocol is the mutex.** `🛠️ In Progress` claiming already prevents
  agent collisions; the dispatcher honors it identically to humans.

### 4.6 Paired-repo routing

Intake and fix agents check whether the work touches the MCP message schema (the
sidecar-owned surface per CLAUDE.md ▸ Two-repo coordination). If so → `🏭 Blocked:
human`. Extending the factory across both repos (sidecar PR → tagged release → app PR)
is deliberately out of scope until the single-repo factory has proven itself.

## 5. Rollout

Each phase is a separate issue under epic #1256; each is independently useful and
reversible.

- **Phase A — labels + intake triage.** Smallest end-to-end slice. Metric: % of new
  issues correctly area-labeled and state-labeled without human correction. Also audits
  the existing backlog composition — how much is actually Tier-1 fixable — which sizes
  Phase C.
- **Phase B — reproduce/diagnose** for bug-class issues, with the report-comment format.
- **Phase C — dispatcher + fix agents** on `🏭 Ready`, starting from a conservative
  allowlist: docs, `Resources/Template/`, JS overlay, portable Swift targets (Tier 1).
  Widen per evidence from Phase A's audit.
- **Phase D — Tier 3.** Stand up the Xcode Cloud build+test lane (already specced,
  needs interactive App Store Connect setup — owner action). TestFlight preview builds
  as the pkg.pr.new analog come later, and only if Phase C demand justifies them.
- **Phase E — metrics + enforced feedback loop.** Issues closed/week by the factory,
  attempts per close, gap issues filed and fixed. Phase E is also where we decide
  whether the factory earns wider autonomy or stays allowlisted.

## 6. Risks and open questions

- **Actions policy fit** for `anthropics/claude-code-action` — verify before Phase A;
  fallback documented in §4.3. Secrets provisioning is owner-side either way.
- **API cost** of always-on triage + dispatched fix agents; the caps in §4.3 bound it,
  but Phase A should measure real per-issue cost before Phase C scales it.
- **Xcode Cloud unknowns:** capacity, and the `container` CLI's availability on its VMs
  is explicitly unconfirmed (`docs/xcode-cloud.md`) — Tier 3 covers build+test, not
  container e2e, until proven otherwise.
- **Label sprawl / state drift:** mitigated by keeping the state family to three labels
  and reusing the two existing ones; the stateless resume-from-labels design means a
  wedged issue is fixed by editing labels, not by touching pipeline state.
- **Quality risk of agent-authored fixes:** contained by the failing-test-first proof,
  the tier routing, human merge, and the Phase C allowlist.

## 7. References

- Cloudflare, [*How we built an AI-powered software factory to triage Astro issues*](https://blog.cloudflare.com/astro-issue-triage/)
- Epic #1256 (this proposal's tracking issue)
- `CLAUDE.md` ▸ Worktrees, Two-repo coordination, issue-in-flight signaling
- `CONTRIBUTING.md` ▸ claiming, commits/PRs, testing
- `docs/xcode-cloud.md` (Tier-3 substrate), `docs/build-plan.md` (Phase 10 context)
- `.github/workflows/ci.yml` (existing deterministic gates; Actions-policy precedent)
