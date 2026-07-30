# Server debug panel — design

**Issue:** [#699](https://github.com/Anglesite/Anglesite-app/issues/699)
**Date:** 2026-07-30
**Status:** Approved

## 1. Problem — and what already shipped out from under the issue

#699 was filed 2026-07-13 as scoping-only, listing three capabilities. Since then the #700
epic closed and delivered most of them:

| #699 scope bullet | Status today |
|---|---|
| Run the composed Worker locally | **Shipped** (#708, PR #850): `wrangler dev --local` as a crash-restart-supervised guest process, `workersDevURL` on `SiteRuntimeState.ready`, live restart on Workers-tab toggle (#710). |
| Debug Pane as home for production-behavior toggles | **Shipped** (ESI spec §4a): `DebugPaneView`'s "Server" section with the ESI Live/Unprocessed picker. |
| Worker log output with its own source tag | **Not shipped.** wrangler-dev output lands in the shared `container:<siteID>` source, distinguished only by `[workers-dev]`/`[bridge-workers-dev]`/`[proxy:workers-dev]` line prefixes — the Debug Pane's Source picker can't isolate it. |
| Worker process status | **Not shipped** — explicitly deferred by #708's design §2 ("a UI status indicator for wrangler-dev's running/restarting/failed state") to exactly this issue. `GuestProcessSupervisor.observe()` publishes state that nothing consumes, and `PreviewModel.workersDevURL` is unread outside tests: the user cannot see whether their local worker is up or what its URL is. |
| Analytics log viewing | **Partially addressed differently**: #710 shipped Cloudflare-dashboard deep-links (Production Logs / Analytics) in the Workers tab via `WorkerDashboardLinks`. In-app analytics *data* viewing never existed and is out of scope here (§6). |

So this design covers the two real gaps: a dedicated `worker:<siteID>` log source, and
surfacing local-worker status + URL in the Debug Pane's Server section.

## 2. Scope

**In:**
- Worker-session output moves to a dedicated `worker:<siteID>` `LogCenter` source.
- A `WorkersDevStatusCenter` (AnglesiteCore) that per-site runtimes publish local-worker
  status into, and a "Local Workers" block in `DebugPaneView`'s Server section that renders
  it: status, site name, clickable/copyable local URL, failure reason.

**Out (explicit, with rationale):**
- **In-app analytics data viewing.** Needs a Cloudflare GraphQL (RUM) client, token-gated
  fetch, and a charting UI — a feature of its own, not a debug-pane row. Filed as a
  follow-up issue referencing this spec; `CloudflareWebAnalyticsClient` (today only a
  host→siteTag resolver) would be its starting point. The dashboard deep-links that shipped
  in #710 remain the analytics answer until then.
- **Duplicating the Workers tab's dashboard links in the Debug Pane.** They need the
  deployed worker name + deploy state the pane doesn't have; one canonical home (the
  Workers tab) beats two half-synced ones.
- **Anything ESI-specific** (the linked spec's job) and **wrangler-dev on the Linux/podman
  runtime** (#571's port; `PodmanContainerControl.startWorkersDev` keeps throwing its
  clear unsupported error).
- **Retrofitting astro/mcp onto `GuestProcessSupervisor`** — still the separate follow-up
  #708's design named.

## 3. Dedicated `worker:<siteID>` log source

`LocalContainerSiteRuntime.startWorkersDevIfActive` currently builds its `onOutput` sink
with `source = "container:\(siteID)"`. It changes to `worker:\(siteID)` — one line, moving
*everything* that flows through the workers-dev path (ephemeral-toml setup, supervisor
lines, vsock bridge, proxy events, and the runtime's own start-failure line) into the new
source. Line-level `[workers-dev]`-style prefixes stay as-is; they're what distinguishes
the sub-processes *within* the source.

**Verified consumer impact:** the only code that filters on the `container:<siteID>` source
is `StartupProgressModel.subscribeToLogs`, which feeds boot-log lines to the startup-time
estimator. Worker lines were never estimation signal — they start mid-boot and keep
streaming for the whole session — so removing them from that source is a small accuracy
improvement, not a regression. `DebugPaneView`'s Source picker is populated dynamically
from observed lines and picks the new source up with zero changes.

## 4. Status plumbing: `WorkersDevStatusCenter`

The Debug Pane is an app-global window with no path to any per-site `PreviewModel`, so
status flows through a shared actor, mirroring `LogCenter`'s exact pattern (publish +
snapshot + subscribe-with-replay), in AnglesiteCore (Linux lane builds this target — no
Darwin-only API):

```swift
public enum WorkersDevStatus: Sendable, Equatable {
    case starting
    case running(url: URL?)          // url nil only in the brief pre-proxy window
    case restarting(attempt: Int)
    case failed(reason: String)
}

public struct WorkersDevSession: Sendable, Equatable, Identifiable {
    public var id: String { siteID }
    public let siteID: String
    public let displayName: String   // package marker's AnglesiteDisplayName; falls back to siteID
    public let status: WorkersDevStatus
}

public actor WorkersDevStatusCenter {
    public static let shared = WorkersDevStatusCenter()
    public func update(siteID: String, displayName: String, status: WorkersDevStatus)
    public func remove(siteID: String)          // session over → row disappears
    public func snapshot() -> [WorkersDevSession]
    public func subscribe() -> Subscription     // streams the full [WorkersDevSession] on every change
}
```

The subscription streams full snapshots (not deltas): the population is "open site windows
with active workers" — single digits — and full snapshots keep the SwiftUI side a dumb
`ForEach`. Latest-state-per-site; `remove` on intentional stop, while `.failed` rows
persist until the session ends (a crash-give-up must stay visible, not vanish).

**Getting supervisor state out of the container layer:** `LocalContainerControl` gains a
second `startWorkersDev` requirement carrying an `onState:` callback, with a protocol-
extension default that forwards to the existing three-parameter requirement and ignores
`onState`. The protocol has **15 conformers** (2 production + 13 test fakes across 6 test
files); a changed required signature would churn all of them mechanically, and this
protocol already established the default-in-extension pattern for exactly that situation
with `resetNetworking`. Only `ContainerizationControl` (real states) and
`FakeLocalContainerControl` (capture for tests) implement the new requirement:

```swift
func startWorkersDev(
    siteID: String,
    workers: [WorkerDescriptor],
    onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
    onState: @escaping @Sendable (WorkersDevProcessState) -> Void
) async throws -> URL
```

with a Core-level `WorkersDevProcessState` enum (`running` / `restarting(attempt:)` /
`stopped` / `failed(reason:)`) mirroring `GuestProcessSupervisor.State`, which stays
`internal` to AnglesiteContainer. `ContainerizationControl.startWorkersDev` spawns one
consumer task over `supervisor.observe()` that maps and forwards; the task ends when the
supervisor's terminal states (`.stopped`/`.failed`) end its stream loop, and
`LiveContainers.storeWorkersDev` keeps it alongside the supervisor it watches (cancelled as
a backstop in `teardownWorkersDev`). `PodmanContainerControl`, the remaining test fakes, and
the `AnglesiteContainerProbe` call site are untouched — they keep the three-parameter entry
point, which `ContainerizationControl` retains as a forwarder.

**Composition in the runtime:** `LocalContainerSiteRuntime.startWorkersDevIfActive` is the
sole publisher — it's the one place that knows the siteID, the package (for the marker's
`displayName`, read best-effort once), the proxied URL, and the failure path. It publishes
`.starting` before calling `startWorkersDev`, `.running(url:)` on successful return,
`.failed(reason:)` in its existing catch, and re-publishes supervisor-driven transitions
from `onState` (attaching the known URL to a post-restart `.running`). `updateActiveWorkers`'
empty-set stop and the runtime's teardown path call `remove(siteID:)`. The status center is
an injectable init parameter defaulting to `.shared`, exactly like the runtime's existing
`logCenter`.

## 5. Debug Pane UI

The Server section (`DebugPaneView.serverSection`) gains a "Local Workers" block under the
ESI row, hidden entirely when the snapshot is empty (today's pane stays visually unchanged
for static-only sites). Per session row:

- **Status:** colored dot + text — green "Running", orange "Restarting (attempt N)", red
  "Failed", secondary "Starting…" — with the dot `accessibilityHidden` and the text
  carrying the meaning (VoiceOver per the macOS spec).
- **Site:** the package display name.
- **URL:** a `Link` opening the local endpoint in the default browser, plus a Copy button
  (`NSPasteboard`), shown only for `.running` with a URL.
- **Failure:** the reason string, truncated with `.help()` carrying the full text.

The pane subscribes in its existing `.task`, same replay-then-stream shape as its
`LogCenter` subscription. New user-visible strings follow CONTRIBUTING.md's String Catalog
CLI-sync step.

## 6. Follow-ups filed with this work

- **In-app analytics data viewing** (§2) — new issue, superseding #699's third bullet.
- **Manual GUI smoke** for the new Debug Pane rows — this repo's standard owed-QA pattern
  (e.g. #918), one new checklist issue.

## 7. Testing

- **`WorkersDevStatusCenterTests`** (Core, Swift Testing): update/snapshot round-trip,
  latest-state-per-site wins, `remove` drops the row, subscription replays current state
  then streams changes — mirroring `LogCenterTests`' shape.
- **`LocalContainerSiteRuntimeTests`** via `FakeLocalContainerControl` (which gains
  `onState` capture, mirroring its `onOutput` recording): wrangler output lands under
  `worker:<siteID>`; successful start publishes `.starting` → `.running(url:)`; a thrown
  start publishes `.failed`; empty-set `updateActiveWorkers` and teardown call `remove`;
  a fake-driven `onState` restart transition re-publishes with the known URL.
- **`StartupProgressModel`** — existing tests keep passing untouched (nothing subscribed
  to worker lines there; asserting the absence of a subscription is not a real behavior).
- **App target builds** via `scripts/build-app.sh` (a `swift test` pass alone doesn't prove
  the app links — repo rule), plus the String Catalog sync for the new strings.
- **Container e2e** — the existing opt-in `ContainerizationControlTests` workers-dev case
  gains an `onState` assertion (first event `.running`); the human-run
  `scripts/run-container-probe.sh workers-dev` subcommand keeps working unchanged on the
  retained three-parameter entry point. No new e2e scope (the toggle-restart e2e gap is
  already tracked as #919).
