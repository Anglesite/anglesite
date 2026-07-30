# Fix Website ▸ Audit and AuditSiteIntent (#958)

## Problem

`Website ▸ Audit` and `AuditSiteIntent` are shipped and reachable but cannot succeed for any
site, for two independent reasons:

1. `AuditCommand.resolveBuildCommand` is hardcoded to `.unavailable` — every audit fails before
   any runner executes, with the reason "audit build must run in the container runtime; host
   Node has been retired".
2. `A11yAuditRunner` shells out to `scripts/a11y-audit.ts` in the site directory, but that script
   doesn't exist anywhere in this repo's `Resources/Template/` — it was left behind when the
   Claude-plugin bundling was retired in #466. Even if (1) were fixed, the runner would throw and
   land in `runnersSkipped`.

A third, previously-undiagnosed issue surfaces once (1) and (2) are understood: `A11yAuditRunner`
spawns `npx tsx` directly on the **host** via `ProcessSupervisor`, which never respected the #70
host-Node retirement in the first place — unlike `AuditCommand`'s build step, which fails
explicitly. All three are fixed together here since they're the same root cause: `AuditCommand`
predates the container-executor pattern `DeployCommand` already uses for exactly this problem.

This is the app's only automated accessibility/WCAG check; the product goal is W3C conformance
(`docs/mac-assed-app-spec.md` §6). Decision recorded during scoping: **fix it**, not remove it —
the original script exists (recovered from the sibling `anglesite` repo's pre-#466 history) and
the container-executor pattern is proven (`DeployCommand`/`DeployExecutor`), so this is a port +
wiring job, not new design.

## Non-goals

- **Headless (Siri/Shortcuts) audit working end-to-end.** `AuditSiteIntent` routes through
  `SiteOperationsService`/`SiteOperations`, which has no access to a live container control the
  way the GUI's `PreviewModel` does — the same gap already exists for `SiteOperations.deploy`
  (it bypasses `DeployCommand`'s build step entirely via a worker-provisioning-only path). Closing
  that gap is a separate, larger architectural change affecting both Deploy and Audit; out of
  scope here. After this fix, `AuditSiteIntent` keeps failing with the same explicit "host Node
  retired" message it produces today — not a regression, just not improved.
- **Restoring `pa11y`/`axe-core`/`playwright` as installed dependencies.** The ported script keeps
  its original graceful-degradation branches for these (dynamically imported, no-op if absent),
  matching the source, but neither becomes a real dependency in this PR.
- **`contrast.ts`, `a14y-audit.ts`, `seo-audit.ts`, pa11y-ci config.** Not referenced by the Swift
  side; not restored.
- **`SecurityTxtAuditRunner` behavior.** Unaffected — it's pure Swift/git, no build or subprocess
  dependency. Only its `AuditRunner` conformance signature changes (mechanical).

## Template layer (`Resources/Template/`)

### New dependency

Add `html-validate` (`^11.6.0`) to `package.json` devDependencies. Small, pure-JS, no native
bindings or network calls at audit time. Explicit approval obtained (CONTRIBUTING.md ▸ new
dependencies).

### New scripts

- **`scripts/a11y-validate.ts`** — heuristic HTML checks: heading hierarchy (via html-validate's
  `heading-level` rule), link text quality (html-validate's `wcag/h30` for empty links + a
  regex heuristic for generic phrases like "click here"), image alt text (html-validate's
  `wcag/h37` for missing alt + a heuristic for placeholder text like "image"/"photo"). Ported
  verbatim from the recovered original; only the import of the shared config helper is adjusted
  to this repo's extensionless-import convention (`./config`, not `./config.js`) — this repo's
  `scripts/config.ts` already exports a compatible `readConfig`/`readConfigFromString`, so no
  changes needed there.
- **`scripts/a11y-audit.ts`** — orchestrator: runs the heuristic scan (always), then optionally
  pa11y and axe-core scans if those packages are importable (dynamic `import()`, caught and
  no-op'd otherwise). Aggregates into a per-page + totals report, formats as Markdown (written to
  `reports/a11y-report.md` by default) and/or JSON (`--json` flag — this is what
  `A11yAuditRunner` on the Swift side consumes). Exit code is severity-aware: 0 clean, 1 any
  error, 2 warnings-only, always-0 with `--warn-only` or `.site-config`'s `A11Y_WARN_ONLY=true`.
  Ported verbatim from the recovered original; only the local imports get the same extensionless
  treatment.

### New tests

- **`scripts/a11y-validate.test.ts`** and **`scripts/a11y-audit.test.ts`** — ported from the
  original vitest suite (`describe`/`it`/`expect`), rewritten to this repo's `node:test` +
  `node:assert/strict` convention (matching `scripts/config.test.ts`), co-located next to their
  scripts per this repo's layout (the original kept tests in a separate top-level `tests/`
  directory — that's a difference in repo layout, not convention to preserve). Coverage carried
  over: `suggestFix` catalogue/fallback matching, severity classifiers, `aggregateReport`,
  `exitCodeFor`, `formatReport`, and `walkHtml`/`runHeuristicScan` against fixture directories
  written to a temp dir.

### package.json script entry

Add `"a11y": "npx tsx scripts/a11y-audit.ts"` alongside the existing `check`/`embed` entries, for
manual/local invocation parity. Not required by the container executor (which invokes the script
directly), but matches existing convention for other audit-style scripts.

## Swift layer

### New: `AuditExecutor` (mirrors `DeployExecutor`)

```swift
public enum AuditStep: Sendable { case build, case a11y }

public struct AuditStepResult: Sendable, Equatable {
    public let exitCode: Int32?
    public let output: String   // captured stdout; full output also streamed live to LogCenter
}

public protocol AuditExecutor: Sendable {
    func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult
}
```

No `environment` parameter (unlike `DeployExecutor`) — the audit path has no secrets to forward
(no Cloudflare token or similar).

A dedicated type rather than reusing `DeployStepResult`: the two are structurally identical today,
but naming an Audit-path return type after Deploy would read oddly and risks future Deploy-only
fields leaking into an unrelated domain. Two fields, no real duplication cost.

### New: `HostAuditExecutor`

Move `AuditCommand`'s current inline build-step logic here unchanged: spawn via
`ProcessSupervisor.launch`, `withTaskCancellationHandler` wrapping `waitForExit` that SIGTERMs the
process on cancellation, snapshot the captured `LogCenter` output as the log tail. Preserves the
existing cancellation test's observable behavior exactly (it asserts a real SIGTERM reaches the
subprocess).

Both steps default to `.unavailable(reason: HostNodeRetirement.reason(...))` — matching
`HostDeployExecutor`'s convention of failing explicitly rather than silently falling back to a
host subprocess. This is also where the third latent bug (`A11yAuditRunner` unconditionally
spawning host `npx`) gets fixed: the `.a11y` step now goes through the same explicit-unavailable
default as `.build`, instead of always attempting a host spawn.

Injectable per-step resolver for tests, matching `HostDeployExecutor`'s
`resolveCommand: @Sendable (AuditStep) -> AuditCommand.CommandResolver` pattern — keeps
`AuditCommandTests`' existing fixture-based build tests working with a small mechanical update
(construct via `HostAuditExecutor(resolveCommand:)` instead of passing `resolveBuildCommand:`
directly to `AuditCommand`).

### New: `ContainerAuditExecutor`

Routes both steps through `LocalContainerControl.exec`, mirroring `ContainerDeployExecutor`:

- `.build` → `["npm", "run", "build"]`
- `.a11y` → `["npx", "tsx", "scripts/a11y-audit.ts", "--json"]`

Both at `/workspace/site`, output streamed live to `LogCenter` line-by-line via the same
detached-drain-task pattern `ContainerDeployExecutor.run` uses (so a cancelled/killed guest
process's output isn't dropped). No well-known-claim-manifest seam — that's Deploy-specific
(#744/#748), not applicable to audits.

### `AuditCommand` changes

`DeployCommand` for comparison holds no `supervisor`/`logCenter` at all — it delegates entirely
to whatever `executor` was constructed with. `AuditCommand` can't go quite that far: it directly
appends one log line itself (the per-runner skip reason, `"\(category) audit skipped — \(error)"`)
independent of any executor. So it keeps `logCenter`, but drops `supervisor` (no longer needed —
see below):

- `init(logCenter: LogCenter = .shared, executor: any AuditExecutor = HostAuditExecutor(), runners: [any AuditRunner] = AuditCommand.defaultRunners)`
  — `supervisor` param removed entirely (it only ever existed to hand to the build step and to
  runners; both now go through `executor`).
- `runBuild` calls `executor.run(step: .build, siteDirectory:, source:)` instead of spawning
  inline.
- The runner loop passes `executor` (not `supervisor`) to `runner.run(...)`.
- **Caller responsibility**: since `AuditCommand`'s own `logCenter` and the `executor`'s internal
  `logCenter` are independent parameters (both default to `.shared`, so this is a non-issue in
  production), any caller that constructs a non-default `executor` with a custom `LogCenter` must
  pass that *same* instance to `AuditCommand(logCenter:)`, or the skip-log line and the
  build/a11y-step output lines split across two different centers. `AuditModel`'s wiring below
  does this correctly; call it out explicitly in the implementation plan so it isn't missed.

### `AuditRunner` protocol changes

- `run(siteDirectory:supervisor:logCenter:source:)` → `run(siteDirectory:executor:logCenter:source:)`.
- `A11yAuditRunner.run` calls `executor.run(step: .a11y, siteDirectory:, source:)`, then applies
  the same `[0, 1, 2].contains(exitCode)` / JSON-scan-from-first-`{` logic it has today, just
  against `AuditStepResult` instead of `ProcessSupervisor.run`'s result type.
- `SecurityTxtAuditRunner.run` picks up the mechanical signature change; ignores the new
  parameter exactly as it ignored `supervisor` before.

### `AuditModel` / `SiteWindowModel` wiring

- `AuditModel.audit(siteID:siteDirectory:)` gains
  `containerControlProvider: @escaping ContainerControlProvider = { nil }`, with
  `typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?`
  (same shape as `DeployModel`'s, duplicated rather than shared — it's a one-line typealias, not
  worth extracting a shared file for).
- At run time: resolve `containerControlProvider()`; if non-nil, construct
  `AuditCommand(logCenter: logCenter, executor: ContainerAuditExecutor(control: cc.control, siteID: cc.siteID, logCenter: logCenter))`
  — passing the **same** `logCenter` to both, per the caller-responsibility note above; else use
  the injected default `command` (whose default executor is `HostAuditExecutor()`, i.e. explicit
  failure) — mirrors `DeployModel.runDeploy`'s `activeCommand` selection exactly.
- `SiteWindowModel.auditSite()` passes
  `containerControlProvider: { [preview] in await preview.activeContainerControl() }`, the same
  line `deploySite()` already has.

## Testing plan

- `scripts/a11y-validate.test.ts`, `scripts/a11y-audit.test.ts` — ported coverage (see above),
  run via `npm test` / `npx tsx --test scripts/*.test.ts`.
- `AuditCommandTests` — update the `makeCommand` test helper to construct via
  `HostAuditExecutor(resolveCommand:)`; existing cancellation/build-failure/logTail/runner-skip
  tests keep their assertions, just their construction path changes.
- New `AuditExecutorSelectionTests` (mirrors `DeployExecutorSelectionTests`) — asserts
  `ContainerAuditExecutor` routes both steps through `FakeLocalContainerControl.execCalls`, and
  that no container control means no `exec()` calls at all.
- New `ContainerAuditExecutorTests` (mirrors the relevant parts of `ContainerDeployExecutorTests`)
  — guest argv mapping for `.build`/`.a11y`, output streaming to `LogCenter`, cancellation →
  empty/nil result, `.bootFailed` → actionable message.
- `A11yAuditRunnerTests` — unaffected (only tests the static `parse` method); add one new test
  exercising `run()` against a fake `AuditExecutor` to confirm the exit-code/JSON-scan logic
  still works against the new result type.
- `swift test --package-path .` and `xcodebuild … build` per CONTRIBUTING.md before opening the
  PR; `npm run lint && npm run typecheck && npm test` from `Resources/Template/`.

## Files touched

- `Resources/Template/package.json` (new devDependency + npm script)
- `Resources/Template/scripts/a11y-validate.ts` (new)
- `Resources/Template/scripts/a11y-validate.test.ts` (new)
- `Resources/Template/scripts/a11y-audit.ts` (new)
- `Resources/Template/scripts/a11y-audit.test.ts` (new)
- `Sources/AnglesiteCore/AuditExecutor.swift` (new — protocol + `HostAuditExecutor` +
  `ContainerAuditExecutor`)
- `Sources/AnglesiteCore/AuditCommand.swift` (executor wiring)
- `Sources/AnglesiteCore/A11yAuditRunner.swift` (route through executor)
- `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift` (mechanical signature update)
- `Sources/AnglesiteApp/AuditModel.swift` (containerControlProvider wiring)
- `Sources/AnglesiteApp/SiteWindowModel.swift` (`auditSite()` passes the provider)
- `Tests/AnglesiteCoreTests/AuditCommandTests.swift` (construction update)
- `Tests/AnglesiteCoreTests/AuditExecutorSelectionTests.swift` (new)
- `Tests/AnglesiteCoreTests/ContainerAuditExecutorTests.swift` (new)
- `Tests/AnglesiteCoreTests/A11yAuditRunnerTests.swift` (one new test)
