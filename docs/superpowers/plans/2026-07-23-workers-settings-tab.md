# Site Settings: Workers Tab (#710) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Workers tab in the per-site Settings surface (`PlistEditorView`) — epic #700's last slice (700c) — plus the prerequisite catalog-decoder fix that currently leaves the app with an empty worker catalog in production.

**Architecture:** Two stacked PRs. PR 1 fixes `WorkerDescriptor.Resources` decoding to accept the *published* `catalog.json` shape (`resources` is an array of `{type, binding}` entries, not the `{needsD1,needsKV,needsR2}` object the app was written against — drift present since the catalog's first commit, davidwkeith/workers#258). PR 2 builds the tab: a `.workers` case in `PlistEditorView`'s existing segmented-tab mechanism; `PlistEditorModel` grows a Workers facet that loads `SiteSettings` from `SiteConfigStore`, fetches the catalog via `WorkerCatalogFetcher`, and resolves component-tied usage through `ImpactAnalysis` over the Site Graph snapshot; toggles persist `activeWorkerIDs` immediately and restart the local wrangler-dev session through the `SiteRuntimeContainerCapability` seam (#823); top-of-pane Logs/Analytics buttons deep-link into the Cloudflare dashboard, disabled until `lastDeployedWorkerIDs` is non-empty.

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27), Swift Testing, SwiftPM test targets (`AnglesiteCoreTests`, `AnglesiteAppTests` via `AnglesiteAppCore`), XcodeGen project, String Catalog (`xcstringstool sync`).

## Global Constraints

- Apple frameworks only; plain SwiftUI + actors (CLAUDE.md ▸ Stack).
- Every `SiteSettings` field stays Optional (forward-compat decode rule, `SiteConfigStore.swift:7-11`).
- Never `as? LocalContainerSiteRuntime` in app code — container-only members are reached via `SiteRuntimeContainerCapability` (#823).
- Catalog data is opaque: never hardcode worker names/groups in Swift (design doc §3).
- Commit subjects ≤72 chars, conventional commits, issue number in subject (CONTRIBUTING ▸ Commits).
- PR bodies use `.github/PULL_REQUEST_TEMPLATE.md` exact headings: **Summary**, **Paired PR check**, **Test plan**.
- New user-visible strings require the `xcstringstool sync` recipe from CONTRIBUTING (scoped to this worktree's DerivedData; always `--skip-marking-strings-stale`) and the `.xcstrings` diff committed with the UI change.
- Protocol changes: grep ALL conformers, including test fakes (`FakeContainerCapableSiteRuntime` in `Tests/AnglesiteAppTests/PreviewModelContainerCapabilityTests.swift`).
- Design spec: `docs/superpowers/specs/2026-07-13-workers-local-debugging-design.md` §4, §8, §10.

**Branch/PR mechanics:** work happens in this worktree (`.claude/worktrees/issue-700-ba3222`, currently on `claude/issue-700-ba3222` = `origin/main`). PR 1 lands on a new branch `claude/catalog-resources-shape` cut from `origin/main`; PR 2 continues on `claude/issue-700-ba3222` rebased onto PR 1's branch, opened with `--base claude/catalog-resources-shape`, retargeted to `main` after PR 1 merges (then rebase + force-push to trigger CI — stacked PRs get no CI until they target main).

---

### Task 1: File + claim the catalog-drift issue

**Files:** none (GitHub only).

- [ ] **Step 1: File the issue**

```bash
gh issue create --repo Anglesite/Anglesite-app \
  --title "WorkerCatalogReader can't decode the published catalog.json resources shape" \
  --label "🎯 Deployment" \
  --body "$(cat <<'EOF'
`WorkerDescriptor.Resources` decodes `{ "needsD1": …, "needsKV": …, "needsR2": … }`, but the
published catalog (`https://raw.githubusercontent.com/davidwkeith/workers/main/catalog.json`)
has shipped `resources` as an **array** of typed binding entries
(`[{ "type": "d1", "binding": "AUTH_DB" }, …]`) since its first commit
(davidwkeith/workers#258, spec/catalog.md § resources). Every live fetch therefore throws in
`WorkerCatalogReader.parse`, `WorkerCatalogFetcher` degrades to cache (never populated — the
cache only stores successfully parsed bytes) and returns an **empty catalog**. Shipped #708/#709
consumers (local wrangler-dev startup, deploy composition, route claims) all see zero workers in
production, with only a degradation log line.

Fix app-side per CONTRIBUTING's backward-compatible-decoding rule: accept both shapes —
`d1`/`kv`/`r2` entry types map to the needs flags; other types (`secret`, `queue`, `cron`) are
ignored by these flags for now. Blocks #710 (the Workers tab would render an empty catalog).
EOF
)"
```

Record the created issue number — referred to as `#NNN` below.

- [ ] **Step 2: Claim it**

```bash
gh issue edit NNN --repo Anglesite/Anglesite-app --add-label "🛠️ In Progress"
```

---

### Task 2 (PR 1): Decode the published `resources` array shape

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerCatalog.swift:84-94` (the `Resources` struct)
- Test: `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift`

**Interfaces:**
- Produces: `WorkerDescriptor.Resources` decodes BOTH `{"needsD1":…}` (object) and `[{"type":"d1","binding":…},…]` (published array). Public API (`init(needsD1:needsKV:needsR2:)`, the three `let` flags) unchanged — every existing caller (`WorkerComposition`, fixtures) compiles as-is.

- [ ] **Step 1: Branch**

```bash
git switch -c claude/catalog-resources-shape
```

- [ ] **Step 2: Write the failing test**

Append to the `WorkerCatalogTests` suite in `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift` (match its existing fixture style):

```swift
    @Test("parse accepts the published array resources shape (davidwkeith/workers spec/catalog.md)")
    func parseAcceptsPublishedResourcesArrayShape() throws {
        let json = Data("""
        {
          "workers": [
            {
              "id": "indieauth",
              "package": "@dwk/indieauth",
              "displayName": "IndieAuth",
              "description": "Sign in with your own domain",
              "group": "identity",
              "binding": { "kind": "settingsActivated" },
              "requires": [],
              "resources": [
                { "type": "d1", "binding": "AUTH_DB" },
                { "type": "secret", "binding": "TOKEN_SIGNING_KEY" }
              ]
            },
            {
              "id": "solid-pod",
              "displayName": "Solid Pod",
              "description": "Personal data store",
              "group": "storage",
              "binding": { "kind": "settingsActivated" },
              "resources": [
                { "type": "kv", "binding": "POD_KV" },
                { "type": "r2", "binding": "POD_BLOBS" }
              ]
            }
          ]
        }
        """.utf8)

        let workers = try WorkerCatalogReader.parse(json)

        let indieauth = try #require(workers.first { $0.id == "indieauth" })
        #expect(indieauth.resources == WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: false))
        let solidPod = try #require(workers.first { $0.id == "solid-pod" })
        #expect(solidPod.resources == WorkerDescriptor.Resources(needsD1: false, needsKV: true, needsR2: true))
    }

    @Test("Resources round-trips through its encoded object shape")
    func resourcesEncodedObjectShapeRoundTrips() throws {
        let original = WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: true)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WorkerDescriptor.Resources.self, from: data)
        #expect(decoded == original)
    }
```

- [ ] **Step 3: Run to verify it fails**

Run: `swift test --package-path . --filter WorkerCatalogTests 2>&1 | tail -20`
Expected: `parseAcceptsPublishedResourcesArrayShape` FAILS (DecodingError.typeMismatch — expected dictionary, found array). Round-trip test passes already.

- [ ] **Step 4: Implement the dual-shape decoder**

In `Sources/AnglesiteCore/WorkerCatalog.swift`, replace the `Resources` struct body (keep the doc comment, extend it):

```swift
    /// Manifest-driven equivalent of the `needsD1`/`needsKV`/`needsR2` flags the old
    /// `WorkerComposition.Feature` enum used to hand-maintain as switch statements (removed by
    /// #708's descriptor migration).
    ///
    /// Decodes both published shapes (#NNN): the original object form
    /// (`{"needsD1": true, …}`) used by this app's own fixtures and any pre-drift cache, and the
    /// array-of-typed-bindings form the catalog has actually published since its first commit
    /// (`[{"type": "d1", "binding": "AUTH_DB"}, …]` — davidwkeith/workers spec/catalog.md).
    /// `d1`/`kv`/`r2` entry types map to the flags; other types (`secret`, `queue`, `cron`) have
    /// no provisioning flag yet and are ignored here — adopting their fidelity is future work,
    /// not silently claimed. Encoding always emits the object form.
    public struct Resources: Sendable, Equatable, Codable {
        public let needsD1: Bool
        public let needsKV: Bool
        public let needsR2: Bool

        public init(needsD1: Bool, needsKV: Bool, needsR2: Bool) {
            self.needsD1 = needsD1
            self.needsKV = needsKV
            self.needsR2 = needsR2
        }

        private enum CodingKeys: String, CodingKey {
            case needsD1, needsKV, needsR2
        }

        /// One entry of the published array form. Only `type` matters to the flags; `binding`
        /// and any other keys are ignored.
        private struct BindingEntry: Decodable {
            let type: String
        }

        public init(from decoder: Decoder) throws {
            if var entries = try? decoder.unkeyedContainer() {
                var d1 = false, kv = false, r2 = false
                while !entries.isAtEnd {
                    switch try entries.decode(BindingEntry.self).type.lowercased() {
                    case "d1": d1 = true
                    case "kv": kv = true
                    case "r2": r2 = true
                    default: break
                    }
                }
                self.init(needsD1: d1, needsKV: kv, needsR2: r2)
                return
            }
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.init(
                needsD1: try container.decode(Bool.self, forKey: .needsD1),
                needsKV: try container.decode(Bool.self, forKey: .needsKV),
                needsR2: try container.decode(Bool.self, forKey: .needsR2))
        }
    }
```

(No custom `encode(to:)` — providing only `init(from:)` keeps the synthesized member-keyed encoder, which the round-trip test pins.)

- [ ] **Step 5: Run the catalog + composition + activation suites**

Run: `swift test --package-path . --filter "WorkerCatalogTests|WorkerCatalogFetcherTests|WorkerCompositionTests|WorkerActivationTests" 2>&1 | tail -10`
Expected: ALL PASS.

- [ ] **Step 6: Commit, push, open PR 1**

```bash
git add Sources/AnglesiteCore/WorkerCatalog.swift Tests/AnglesiteCoreTests/WorkerCatalogTests.swift
git commit -m "fix(catalog): decode published resources array shape (#NNN)"
git push -u origin claude/catalog-resources-shape
```

Then build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (**Summary**, **Paired PR check**, **Test plan**). Paired PR check: no MCP schema change, no sidecar PR; notes the `@dwk/workers` catalog coordination (app adapts to the published shape per CONTRIBUTING's backward-compatible-decoding rule; no catalog change needed). Open with `gh pr create --base main`, then:

```bash
gh issue edit NNN --repo Anglesite/Anglesite-app --remove-label "🛠️ In Progress"
```

---

### Task 3 (PR 2 begins): Component-ID resolution + real-graph activation

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerActivation.swift` (add `componentNodeIDs(for:in:)`; rewrite the component-tied branch of `effectiveActiveIDs`)
- Test: `Tests/AnglesiteCoreTests/WorkerActivationTests.swift`

**Interfaces:**
- Produces: `WorkerActivation.componentNodeIDs(for componentID: String, in snapshot: SiteGraphExplorerSnapshot) -> [String]` — graph node IDs matching one catalog componentID. Matching rule: exact node-id equality (keeps existing fixtures/tests valid), OR a `.component`-kind node whose `filePath` basename stem equals the componentID after normalization (lowercase, strip non-alphanumerics) — so catalog `"webmention-form"` matches a real node `"<siteID>:file:src/components/WebmentionForm.astro"`. Consumed by Task 5's `PlistEditorModel` and by `effectiveActiveIDs` itself.

**Why:** catalog `componentIDs` are logical, cross-site identifiers; real Site Graph node IDs are site-scoped file paths (`SiteGraphExplorer.swift:183`). Without resolution, component-tied workers can never activate against a real graph — the tab (first real-graph consumer) would always show "Inactive". The workers-repo spec says componentID values are "coordinated with the app, not invented here", so the app defines this convention.

- [ ] **Step 1: Branch setup**

```bash
git switch claude/issue-700-ba3222
git rebase claude/catalog-resources-shape
```

- [ ] **Step 2: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/WorkerActivationTests.swift` (reuse its existing `descriptor(id:binding:)` helper):

```swift
    @Test("componentNodeIDs resolves a catalog componentID to a real prefixed component node by filename stem")
    func componentNodeIDsResolvesRealGraphNode() {
        let snapshot = SiteGraphExplorerSnapshot(
            nodes: [
                SiteGraphNode(
                    id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                    title: "WebmentionForm.astro", detail: nil,
                    filePath: "src/components/WebmentionForm.astro", route: nil),
                SiteGraphNode(
                    id: "site1:file:src/components/Nav.astro", kind: .component,
                    title: "Nav.astro", detail: nil,
                    filePath: "src/components/Nav.astro", route: nil),
                SiteGraphNode(
                    id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                    filePath: "src/pages/index.astro", route: "/"),
            ],
            edges: [])

        #expect(WorkerActivation.componentNodeIDs(for: "webmention-form", in: snapshot)
            == ["site1:file:src/components/WebmentionForm.astro"])
        // Exact-id matching still works (unprefixed fixture graphs, existing tests).
        #expect(WorkerActivation.componentNodeIDs(for: "site1:page:index", in: snapshot)
            == ["site1:page:index"])
        #expect(WorkerActivation.componentNodeIDs(for: "no-such-component", in: snapshot).isEmpty)
    }

    @Test("componentTied activates through a stem-resolved node with an affected page")
    func componentTiedActivatesThroughResolvedNode() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let snapshot = SiteGraphExplorerSnapshot(
            nodes: [
                SiteGraphNode(
                    id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                    title: "WebmentionForm.astro", detail: nil,
                    filePath: "src/components/WebmentionForm.astro", route: nil),
                SiteGraphNode(
                    id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                    filePath: "src/pages/index.astro", route: "/"),
            ],
            edges: [
                SiteGraphEdge(
                    sourceID: "site1:page:index",
                    targetID: "site1:file:src/components/WebmentionForm.astro",
                    kind: .imports)
            ])

        let active = WorkerActivation.effectiveActiveIDs(
            settings: SiteSettings(), catalog: catalog, graph: snapshot)
        #expect(active == ["webmention"])
    }
```

- [ ] **Step 3: Run to verify they fail**

Run: `swift test --package-path . --filter WorkerActivationTests 2>&1 | tail -10`
Expected: FAIL — `componentNodeIDs` doesn't exist (compile error). Comment out the first test's body if needed to see the second fail at runtime; simpler: expect a compile failure and move on.

- [ ] **Step 4: Implement**

In `Sources/AnglesiteCore/WorkerActivation.swift`, add below `effectiveActiveIDs`:

```swift
    /// Graph node IDs matching one catalog `componentID`. Catalog componentIDs are logical,
    /// cross-site identifiers ("webmention-form"); real Site Graph node IDs are site-scoped file
    /// paths ("<siteID>:file:src/components/WebmentionForm.astro"), so the two can never be
    /// compared directly. The coordinated convention (workers-repo spec/catalog.md: componentID
    /// values are "coordinated with the app, not invented here"): a componentID matches a
    /// `.component` node whose file basename stem equals it after normalization (lowercased,
    /// non-alphanumerics stripped) — plus exact node-id equality, which keeps unprefixed fixture
    /// graphs and any future catalog that publishes full node IDs working.
    public static func componentNodeIDs(
        for componentID: String, in snapshot: SiteGraphExplorerSnapshot
    ) -> [String] {
        let target = normalizedComponentKey(componentID)
        return snapshot.nodes.filter { node in
            if node.id == componentID { return true }
            guard node.kind == .component, let filePath = node.filePath,
                  let basename = filePath.split(separator: "/").last else { return false }
            let stem = basename.split(separator: ".").first.map(String.init) ?? String(basename)
            return normalizedComponentKey(stem) == target
        }.map(\.id)
    }

    /// "WebmentionForm" and "webmention-form" both normalize to "webmentionform".
    private static func normalizedComponentKey(_ raw: String) -> String {
        String(raw.lowercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0)
        })
    }
```

Then rewrite `effectiveActiveIDs`'s component-tied loop body (`WorkerActivation.swift:23-34`) to analyze the *resolved* node IDs:

```swift
        if let graph {
            for descriptor in catalog {
                guard case .componentTied(let componentIDs) = descriptor.binding else { continue }
                let isUsed = componentIDs.contains { componentID in
                    componentNodeIDs(for: componentID, in: graph).contains { nodeID in
                        guard let report = ImpactAnalysis.analyze(snapshot: graph, targetID: nodeID) else {
                            return false
                        }
                        return !report.affectedPages.isEmpty
                    }
                }
                if isUsed { active.insert(descriptor.id) }
            }
        }
```

- [ ] **Step 5: Run to verify everything passes**

Run: `swift test --package-path . --filter WorkerActivationTests 2>&1 | tail -6`
Expected: ALL PASS (existing exact-id tests included).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/WorkerActivation.swift Tests/AnglesiteCoreTests/WorkerActivationTests.swift
git commit -m "feat(#710): resolve catalog componentIDs against real graphs"
```

---

### Task 4: Cloudflare dashboard deep links

**Files:**
- Create: `Sources/AnglesiteCore/WorkerDashboardLinks.swift`
- Test: `Tests/AnglesiteCoreTests/WorkerDashboardLinksTests.swift`

**Interfaces:**
- Produces: `WorkerDashboardLinks.productionLogsURL(workerName: String) -> URL` and `WorkerDashboardLinks.analyticsURL(workerName: String) -> URL`. Consumed by Task 5's model. `workerName` is the deployed script name — `SiteSlug.derive(from: siteName)`, matching `SiteOperations.swift:185`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/WorkerDashboardLinksTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WorkerDashboardLinks (#710)")
struct WorkerDashboardLinksTests {
    @Test("production logs deep link targets the worker's observability logs")
    func productionLogsURL() {
        #expect(
            WorkerDashboardLinks.productionLogsURL(workerName: "my-site").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/my-site/production/observability/logs")
    }

    @Test("analytics deep link targets the worker's metrics")
    func analyticsURL() {
        #expect(
            WorkerDashboardLinks.analyticsURL(workerName: "my-site").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/my-site/production/metrics")
    }

    @Test("worker names are percent-encoded defensively")
    func percentEncoding() {
        #expect(
            WorkerDashboardLinks.analyticsURL(workerName: "a b").absoluteString
                == "https://dash.cloudflare.com/?to=/:account/workers/services/view/a%20b/production/metrics")
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `swift test --package-path . --filter WorkerDashboardLinksTests 2>&1 | tail -5`
Expected: compile FAILURE (`WorkerDashboardLinks` undefined).

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/WorkerDashboardLinks.swift`:

```swift
import Foundation

/// Cloudflare-dashboard deep links for one deployed site Worker (#710, design doc §8). Uses the
/// dashboard's `?to=` deep-link resolver with its `:account` placeholder — the same mechanism as
/// `WebsiteAnalyticsAsset.dashboardURL` — so the app never needs to know the account ID. The
/// worker-detail paths follow the dashboard's `workers/services/view/<name>/production` scheme
/// (verified against Cloudflare's dashboard 2026-07-23; a drifted subpath falls back to the
/// worker's overview page, so a stale path degrades to "one more click", never a dead end).
/// Centralized here so a Cloudflare path change is a one-file fix.
public enum WorkerDashboardLinks {
    /// The worker's production logs (Observability ▸ Logs).
    public static func productionLogsURL(workerName: String) -> URL {
        deepLink(to: "/workers/services/view/\(encoded(workerName))/production/observability/logs")
    }

    /// The worker's production metrics/analytics.
    public static func analyticsURL(workerName: String) -> URL {
        deepLink(to: "/workers/services/view/\(encoded(workerName))/production/metrics")
    }

    private static func deepLink(to path: String) -> URL {
        URL(string: "https://dash.cloudflare.com/?to=/:account\(path)")!
    }

    private static func encoded(_ workerName: String) -> String {
        workerName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? workerName
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `swift test --package-path . --filter WorkerDashboardLinksTests 2>&1 | tail -5`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerDashboardLinks.swift Tests/AnglesiteCoreTests/WorkerDashboardLinksTests.swift
git commit -m "feat(#710): Cloudflare dashboard deep links for site workers"
```

---

### Task 5: Toggle → wrangler-dev restart plumbing (capability seam + PreviewModel)

**Files:**
- Modify: `Sources/AnglesiteCore/SiteRuntime.swift:46-56` (`SiteRuntimeContainerCapability`)
- Modify: `Sources/AnglesiteApp/PreviewModel.swift` (new method, place near `resetNetworking`/capability helpers)
- Modify: `Tests/AnglesiteAppTests/PreviewModelContainerCapabilityTests.swift` (fake conformance + new test)

**Interfaces:**
- Consumes: `LocalContainerSiteRuntime.updateActiveWorkers(_ settings: SiteSettings) async` (exists, `LocalContainerSiteRuntime.swift:178` — built for exactly this caller).
- Produces: `SiteRuntimeContainerCapability.updateActiveWorkers(_ settings: SiteSettings) async` requirement; `PreviewModel.activeWorkersChanged(_ settings: SiteSettings) async`. Consumed by Task 7's `SiteWindowModel` closure.

Conformers of `SiteRuntimeContainerCapability` (verified by grep, including test fakes): `LocalContainerSiteRuntime` (already implements the exact signature — witness is automatic) and `FakeContainerCapableSiteRuntime` (test fake — needs the stub added).

- [ ] **Step 1: Write the failing test**

In `Tests/AnglesiteAppTests/PreviewModelContainerCapabilityTests.swift`, add to `FakeContainerCapableSiteRuntime`:

```swift
    private(set) var updatedActiveWorkerSettings: [SiteSettings] = []

    func updateActiveWorkers(_ settings: SiteSettings) async {
        updatedActiveWorkerSettings.append(settings)
    }
```

And a new test in the suite (mirror the existing tests' construction of `PreviewModel(runtime:)` with the fake):

```swift
    @Test("activeWorkersChanged reaches the runtime through containerCapability")
    func activeWorkersChangedReachesCapability() async {
        let runtime = FakeContainerCapableSiteRuntime()
        let model = PreviewModel(runtime: runtime)

        var settings = SiteSettings()
        settings.activeWorkerIDs = ["solid-pod"]
        await model.activeWorkersChanged(settings)

        #expect(await runtime.updatedActiveWorkerSettings == [settings])
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `swift test --package-path . --filter PreviewModelContainerCapabilityTests 2>&1 | tail -5`
Expected: compile FAILURE (`activeWorkersChanged` undefined on `PreviewModel`).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SiteRuntime.swift`, add to `SiteRuntimeContainerCapability` (after `persistEdit`):

```swift
    /// Recomputes the effective active-worker set from `settings` and restarts (or stops) the
    /// local wrangler-dev session to match — the Workers tab (#710) calls this on toggle. See
    /// `LocalContainerSiteRuntime.updateActiveWorkers`.
    func updateActiveWorkers(_ settings: SiteSettings) async
```

In `Sources/AnglesiteApp/PreviewModel.swift`, next to the other capability-reaching members:

```swift
    /// Forwards a Workers-tab toggle (#710) to the running runtime so a live local wrangler-dev
    /// session restarts with the new active set. No-op for non-container runtimes — the local
    /// workers dev server is a local-container-only capability (#708).
    func activeWorkersChanged(_ settings: SiteSettings) async {
        await runtime.containerCapability?.updateActiveWorkers(settings)
    }
```

- [ ] **Step 4: Run to verify it passes (and nothing else broke)**

Run: `swift test --package-path . --filter "PreviewModelContainerCapabilityTests" 2>&1 | tail -5`
Expected: ALL PASS. Then a full-core spot check: `swift build --package-path . --target AnglesiteCore` — succeeds (LocalContainerSiteRuntime's existing method satisfies the new requirement).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteRuntime.swift Sources/AnglesiteApp/PreviewModel.swift Tests/AnglesiteAppTests/PreviewModelContainerCapabilityTests.swift
git commit -m "feat(#710): route worker toggles to wrangler-dev via capability"
```

---

### Task 6: `PlistEditorModel` Workers facet

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift`
- Test: create `Tests/AnglesiteAppTests/PlistEditorModelWorkersTests.swift`

**Interfaces:**
- Consumes: `SiteConfigStore` (`load()`/`save(_:)`), `WorkerCatalogFetcher(catalogURL:).catalog()`, `WorkerActivation.componentNodeIDs(for:in:)` (Task 3), `ImpactAnalysis.analyze(snapshot:targetID:)`, `WorkerDashboardLinks` (Task 4), `SiteSlug.derive(from:)`.
- Produces (consumed by Task 7's view + Task 8's wiring):
  - `init(file:websiteTitle:sourceDirectory:configDirectory:workerCatalogProvider:graphSnapshotProvider:onActiveWorkersChanged:analyticsProvider:customAnalyticsValidator:keychain:domainOperations:)` — the three new params default so every existing call site/test compiles unchanged.
  - `struct WorkerGroup: Identifiable { let id: String; let name: String; var rows: [WorkerRow] }`
  - `struct WorkerRow: Identifiable { let descriptor: WorkerDescriptor; var status: Status; var id: String }` with `enum Status: Equatable { case componentTied(affectedPages: [SiteGraphNode]); case settingsActivated(isOn: Bool) }`
  - `private(set) var workerGroups: [WorkerGroup]`, `private(set) var workersError: String?`, `private(set) var isLoadingWorkers: Bool`, `var workerDashboardEnabled: Bool`, `var workerDashboardLogsURL: URL`, `var workerDashboardAnalyticsURL: URL`
  - `func loadWorkers() async`, `func setWorkerActive(_ workerID: String, isOn: Bool) async`

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/PlistEditorModelWorkersTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel Workers tab (#710)")
@MainActor
struct PlistEditorModelWorkersTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private static let catalog: [WorkerDescriptor] = [
        WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "Receive webmentions",
            group: "social", binding: .componentTied(componentIDs: ["webmention-form"]),
            resources: WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: false)),
        WorkerDescriptor(
            id: "solid-pod", displayName: "Solid Pod", description: "Personal data store",
            group: "storage", binding: .settingsActivated,
            resources: WorkerDescriptor.Resources(needsD1: false, needsKV: true, needsR2: true)),
        WorkerDescriptor(
            id: "webdav", displayName: "WebDav", description: "OS-native file access",
            group: "storage", binding: .settingsActivated,
            resources: WorkerDescriptor.Resources(needsD1: false, needsKV: false, needsR2: true)),
    ]

    /// A snapshot in which the real-shaped WebmentionForm component is imported by one page.
    private static let usedSnapshot = SiteGraphExplorerSnapshot(
        nodes: [
            SiteGraphNode(
                id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                title: "WebmentionForm.astro", detail: nil,
                filePath: "src/components/WebmentionForm.astro", route: nil),
            SiteGraphNode(
                id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                filePath: "src/pages/index.astro", route: "/"),
        ],
        edges: [
            SiteGraphEdge(
                sourceID: "site1:page:index",
                targetID: "site1:file:src/components/WebmentionForm.astro",
                kind: .imports)
        ])

    private struct Fixture {
        let model: PlistEditorModel
        let configDirectory: URL
        let notified: NotifiedSettings
    }

    /// Thread-safe capture box for the `onActiveWorkersChanged` callback.
    final class NotifiedSettings: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [SiteSettings] = []
        func append(_ settings: SiteSettings) {
            lock.lock(); defer { lock.unlock() }
            values.append(settings)
        }
        var all: [SiteSettings] {
            lock.lock(); defer { lock.unlock() }
            return values
        }
    }

    private func makeFixture(
        settings: SiteSettings? = nil,
        catalog: [WorkerDescriptor] = PlistEditorModelWorkersTests.catalog,
        snapshot: SiteGraphExplorerSnapshot? = PlistEditorModelWorkersTests.usedSnapshot
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelWorkersTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let settings {
            try await SiteConfigStore(configDirectory: configDir).save(settings)
        }
        let notified = NotifiedSettings()
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            workerCatalogProvider: { catalog },
            graphSnapshotProvider: { snapshot },
            onActiveWorkersChanged: { notified.append($0) })
        return Fixture(model: model, configDirectory: configDir, notified: notified)
    }

    @Test("loadWorkers groups by catalog group and sorts groups and rows")
    func loadWorkersGroupsAndSorts() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        #expect(fixture.model.workerGroups.map(\.id) == ["social", "storage"])
        let storage = try #require(fixture.model.workerGroups.last)
        #expect(storage.rows.map(\.id) == ["solid-pod", "webdav"])
        #expect(fixture.model.workersError == nil)
    }

    @Test("a component-tied worker used on a page reports its affected pages")
    func componentTiedReportsAffectedPages() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        let social = try #require(fixture.model.workerGroups.first { $0.id == "social" })
        let webmention = try #require(social.rows.first { $0.id == "webmention" })
        guard case .componentTied(let pages) = webmention.status else {
            Issue.record("expected componentTied status"); return
        }
        #expect(pages.map(\.title) == ["Home"])
    }

    @Test("a component-tied worker with no usage reports no affected pages")
    func componentTiedUnused() async throws {
        let fixture = try await makeFixture(
            snapshot: SiteGraphExplorerSnapshot(nodes: [], edges: []))
        await fixture.model.loadWorkers()

        let social = try #require(fixture.model.workerGroups.first { $0.id == "social" })
        let webmention = try #require(social.rows.first { $0.id == "webmention" })
        #expect(webmention.status == .componentTied(affectedPages: []))
    }

    @Test("settings-activated rows reflect persisted activeWorkerIDs")
    func settingsActivatedReflectsPersistedState() async throws {
        let fixture = try await makeFixture(settings: SiteSettings(activeWorkerIDs: ["webdav"]))
        await fixture.model.loadWorkers()

        let storage = try #require(fixture.model.workerGroups.first { $0.id == "storage" })
        #expect(storage.rows.first { $0.id == "solid-pod" }?.status == .settingsActivated(isOn: false))
        #expect(storage.rows.first { $0.id == "webdav" }?.status == .settingsActivated(isOn: true))
    }

    @Test("toggling on persists the id, updates the row, and notifies the runtime")
    func toggleOnPersistsAndNotifies() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        await fixture.model.setWorkerActive("solid-pod", isOn: true)

        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.activeWorkerIDs == ["solid-pod"])
        let storage = try #require(fixture.model.workerGroups.first { $0.id == "storage" })
        #expect(storage.rows.first { $0.id == "solid-pod" }?.status == .settingsActivated(isOn: true))
        #expect(fixture.notified.all.map(\.activeWorkerIDs) == [["solid-pod"]])
    }

    @Test("toggling off removes the id and preserves unrelated settings fields")
    func toggleOffPreservesOtherFields() async throws {
        let fixture = try await makeFixture(
            settings: SiteSettings(displayName: "Kept", activeWorkerIDs: ["solid-pod", "webdav"]))
        await fixture.model.loadWorkers()

        await fixture.model.setWorkerActive("solid-pod", isOn: false)

        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.activeWorkerIDs == ["webdav"])
        #expect(saved.displayName == "Kept")
    }

    @Test("dashboard buttons stay disabled until lastDeployedWorkerIDs is non-empty")
    func dashboardEnablement() async throws {
        let disabled = try await makeFixture()
        await disabled.model.loadWorkers()
        #expect(disabled.model.workerDashboardEnabled == false)

        let enabled = try await makeFixture(
            settings: SiteSettings(lastDeployedWorkerIDs: ["webmention"]))
        await enabled.model.loadWorkers()
        #expect(enabled.model.workerDashboardEnabled == true)
    }

    @Test("dashboard links target the site's deployed worker name")
    func dashboardLinksUseSiteSlug() async throws {
        let fixture = try await makeFixture()
        #expect(fixture.model.workerDashboardLogsURL
            == WorkerDashboardLinks.productionLogsURL(workerName: "my-test-site"))
        #expect(fixture.model.workerDashboardAnalyticsURL
            == WorkerDashboardLinks.analyticsURL(workerName: "my-test-site"))
    }

    @Test("an empty catalog surfaces an error instead of an empty silent pane")
    func emptyCatalogSurfacesError() async throws {
        let fixture = try await makeFixture(catalog: [])
        await fixture.model.loadWorkers()

        #expect(fixture.model.workerGroups.isEmpty)
        #expect(fixture.model.workersError != nil)
    }

    @Test("without a configDirectory the tab reports unavailability and toggles no-op")
    func noConfigDirectory() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelWorkersTests-nocfg-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let plistURL = dir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test", sourceDirectory: dir,
            workerCatalogProvider: { Self.catalog })

        await model.loadWorkers()

        #expect(model.workerGroups.isEmpty)
        #expect(model.workersError != nil)
        await model.setWorkerActive("solid-pod", isOn: true)  // must not crash
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `swift test --package-path . --filter PlistEditorModelWorkersTests 2>&1 | tail -5`
Expected: compile FAILURE (new init params / members undefined).

- [ ] **Step 3: Implement the facet**

In `Sources/AnglesiteApp/PlistEditorModel.swift`:

**3a.** Extend the stored properties (place after the MTA-STS block, before `domainOperations`):

```swift
    // MARK: - Workers tab (#710)

    /// One catalog `group` section of the Workers tab, sorted by group key.
    struct WorkerGroup: Identifiable {
        let id: String
        let name: String
        var rows: [WorkerRow]
    }

    /// One catalog worker row. Component-tied rows are read-only status (design doc §8 — their
    /// active state is always recomputed from the site graph, never toggled); settings-activated
    /// rows carry the toggle state mirrored from `SiteSettings.activeWorkerIDs`.
    struct WorkerRow: Identifiable {
        let descriptor: WorkerDescriptor
        var status: Status
        var id: String { descriptor.id }

        enum Status: Equatable {
            case componentTied(affectedPages: [SiteGraphNode])
            case settingsActivated(isOn: Bool)
        }
    }

    private(set) var workerGroups: [WorkerGroup] = []
    private(set) var workersError: String?
    private(set) var isLoadingWorkers = false
    private(set) var workerLastDeployedIDs: [String] = []
    /// The most recently loaded `SiteSettings`, the base for toggle read-modify-write saves.
    private var workerSettings = SiteSettings()
    private let configDirectory: URL?
    private let workerCatalogProvider: () async -> [WorkerDescriptor]
    private let graphSnapshotProvider: @MainActor () -> SiteGraphExplorerSnapshot?
    private let onActiveWorkersChanged: (SiteSettings) async -> Void
```

**3b.** Extend `init` — new parameters between `sourceDirectory:` and `analyticsProvider:`, all defaulted:

```swift
    init(file: FileRef, websiteTitle: String, sourceDirectory: URL,
         configDirectory: URL? = nil,
         workerCatalogProvider: @escaping () async -> [WorkerDescriptor] = {
             await WorkerCatalogFetcher(catalogURL: WorkerCatalogFetcher.productionCatalogURL).catalog()
         },
         graphSnapshotProvider: @escaping @MainActor () -> SiteGraphExplorerSnapshot? = { nil },
         onActiveWorkersChanged: @escaping (SiteSettings) async -> Void = { _ in },
         analyticsProvider: any CloudflareWebAnalyticsProviding = CloudflareWebAnalyticsClient(),
         customAnalyticsValidator: any CustomAnalyticsHTMLValidating = AstroHTMLValidator(),
         keychain: KeychainStore = KeychainStore(),
         domainOperations: any DomainOperationsService = DomainOperations()) {
```

and assign the four new stored properties in the body.

**3c.** Add the facet methods (after `saveMtaSts`/before the DNS helpers, or grouped at the end near the Workers types — keep them together under the `// MARK: - Workers tab (#710)`):

```swift
    /// Loads everything the Workers tab shows: persisted `SiteSettings`, the worker catalog
    /// (network fetch with cache/empty degradation inside `WorkerCatalogFetcher`), and per-
    /// component-tied-worker affected pages via `ImpactAnalysis` over the Site Graph snapshot.
    /// Called from the tab's `.task`, so it re-runs (and re-fetches) on each tab open.
    func loadWorkers() async {
        guard let configDirectory else {
            workerGroups = []
            workersError = String(
                localized: "Workers are unavailable for this site — its package configuration folder couldn't be found.")
            return
        }
        isLoadingWorkers = true
        defer { isLoadingWorkers = false }
        let settings = (try? await SiteConfigStore(configDirectory: configDirectory).load()) ?? SiteSettings()
        workerSettings = settings
        workerLastDeployedIDs = settings.lastDeployedWorkerIDs ?? []
        let catalog = await workerCatalogProvider()
        let snapshot = graphSnapshotProvider()
        workerGroups = Self.workerGroups(catalog: catalog, settings: settings, snapshot: snapshot)
        workersError = catalog.isEmpty
            ? String(localized: "The worker catalog couldn't be loaded. Check your network connection and reopen this tab.")
            : nil
    }

    /// Persists a settings-activated worker toggle immediately (design doc §8): read-modify-write
    /// of `Config/settings.plist` so concurrently written fields (e.g. a deploy updating
    /// `lastDeployedWorkerIDs`) aren't clobbered, then notifies the runtime so a live local
    /// wrangler-dev session restarts with the new active set (§7).
    func setWorkerActive(_ workerID: String, isOn: Bool) async {
        guard let configDirectory else { return }
        let store = SiteConfigStore(configDirectory: configDirectory)
        var settings = (try? await store.load()) ?? workerSettings
        var ids = Set(settings.activeWorkerIDs ?? [])
        if isOn { ids.insert(workerID) } else { ids.remove(workerID) }
        settings.activeWorkerIDs = ids.sorted()
        do {
            try await store.save(settings)
        } catch {
            workersError = String(localized: "Couldn't save the worker change: \(error.localizedDescription)")
            return
        }
        workerSettings = settings
        workersError = nil
        for groupIndex in workerGroups.indices {
            for rowIndex in workerGroups[groupIndex].rows.indices
            where workerGroups[groupIndex].rows[rowIndex].id == workerID {
                workerGroups[groupIndex].rows[rowIndex].status = .settingsActivated(isOn: isOn)
            }
        }
        await onActiveWorkersChanged(settings)
    }

    /// Dashboard deep-links are enabled only after the first deploy that included a worker
    /// (design doc §8) — before that there is nothing on Cloudflare to look at.
    var workerDashboardEnabled: Bool { !workerLastDeployedIDs.isEmpty }

    /// The deployed worker script is named after the site slug — the same derivation the deploy
    /// path uses (`SiteOperations`/`DeployModel`: `SiteSlug.derive(from: site.name)`).
    var workerDashboardLogsURL: URL {
        WorkerDashboardLinks.productionLogsURL(workerName: SiteSlug.derive(from: initialWebsiteTitle))
    }

    var workerDashboardAnalyticsURL: URL {
        WorkerDashboardLinks.analyticsURL(workerName: SiteSlug.derive(from: initialWebsiteTitle))
    }

    private static func workerGroups(
        catalog: [WorkerDescriptor],
        settings: SiteSettings,
        snapshot: SiteGraphExplorerSnapshot?
    ) -> [WorkerGroup] {
        let activeIDs = Set(settings.activeWorkerIDs ?? [])
        let rows = catalog.map { descriptor -> (group: String, row: WorkerRow) in
            let status: WorkerRow.Status
            switch descriptor.binding {
            case .componentTied(let componentIDs):
                status = .componentTied(affectedPages: affectedPages(
                    componentIDs: componentIDs, snapshot: snapshot))
            case .settingsActivated:
                status = .settingsActivated(isOn: activeIDs.contains(descriptor.id))
            }
            return (descriptor.group, WorkerRow(descriptor: descriptor, status: status))
        }
        return Dictionary(grouping: rows, by: \.group)
            .map { key, members in
                WorkerGroup(
                    id: key, name: key,
                    rows: members.map(\.row).sorted {
                        let byName = $0.descriptor.displayName.localizedStandardCompare($1.descriptor.displayName)
                        if byName != .orderedSame { return byName == .orderedAscending }
                        return $0.id < $1.id
                    })
            }
            .sorted { $0.id < $1.id }
    }

    /// Union of `ImpactAnalysis.affectedPages` across every graph node a worker's componentIDs
    /// resolve to, deduplicated by node id and title-sorted (id tiebreak) for stable display.
    private static func affectedPages(
        componentIDs: [String], snapshot: SiteGraphExplorerSnapshot?
    ) -> [SiteGraphNode] {
        guard let snapshot else { return [] }
        var byID: [String: SiteGraphNode] = [:]
        for componentID in componentIDs {
            for nodeID in WorkerActivation.componentNodeIDs(for: componentID, in: snapshot) {
                guard let report = ImpactAnalysis.analyze(snapshot: snapshot, targetID: nodeID) else { continue }
                for page in report.affectedPages { byID[page.id] = page }
            }
        }
        return byID.values.sorted {
            let byTitle = $0.title.localizedStandardCompare($1.title)
            if byTitle != .orderedSame { return byTitle == .orderedAscending }
            return $0.id < $1.id
        }
    }
```

Note: the Workers facet deliberately does NOT register a `DirtyFacet` — toggles save at interaction time, so the facet is never dirty and never participates in save-on-leave/⌘S aggregation.

- [ ] **Step 4: Run to verify the new tests pass**

Run: `swift test --package-path . --filter PlistEditorModelWorkersTests 2>&1 | tail -8`
Expected: 10 PASS.

- [ ] **Step 5: Run the neighboring model suites (init change regression)**

Run: `swift test --package-path . --filter "PlistEditorModel|SiteWindowModelSettingsAggregation" 2>&1 | tail -6`
Expected: ALL PASS (new init params are defaulted).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Tests/AnglesiteAppTests/PlistEditorModelWorkersTests.swift
git commit -m "feat(#710): PlistEditorModel Workers facet"
```

---

### Task 7: Workers tab UI in `PlistEditorView`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (`SettingsTab` enum :9-16, tab `switch` :126-137, new `workersTab` + row subviews)

**Interfaces:**
- Consumes: everything Task 6 produced.
- Produces: `SettingsTab.workers` rendered via the existing segmented picker. No model API of its own.

No unit test — `PlistEditorView` tabs are covered by model tests + a manual GUI smoke pass (design doc §9, this repo's existing pattern for `PlistEditorView` tabs). The build in Task 9 is the compile gate.

- [ ] **Step 1: Add the tab case**

In `SettingsTab` (`PlistEditorView.swift:9-16`), append after `emailSecurity`:

```swift
        case workers = "Workers"
```

(Raw values feed `Text(tab.rawValue)` — matching how the other five tab titles are shown.)

- [ ] **Step 2: Route the case**

In the `switch selectedTab` (`:126-137`), add:

```swift
                    case .workers:
                        workersTab
```

Do NOT add a `.workers` branch to the save-on-leave `.onChange(of: selectedTab)` — worker toggles save immediately (Task 6), there is nothing to flush.

- [ ] **Step 3: Add the tab body + row views**

Add after `emailSecurityTab`:

```swift
    private var workersTab: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Button {
                    NSWorkspace.shared.open(model.workerDashboardLogsURL)
                } label: {
                    Label("Production Logs", systemImage: "text.alignleft")
                }
                .disabled(!model.workerDashboardEnabled)
                Button {
                    NSWorkspace.shared.open(model.workerDashboardAnalyticsURL)
                } label: {
                    Label("Analytics", systemImage: "chart.bar.xaxis")
                }
                .disabled(!model.workerDashboardEnabled)
                if model.isLoadingWorkers {
                    ProgressView().controlSize(.small)
                }
            }
            if !model.workerDashboardEnabled {
                Text("Logs and analytics become available after the first deploy that includes a worker.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let workersError = model.workersError {
                Label(workersError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            ForEach(model.workerGroups) { group in
                VStack(alignment: .leading, spacing: 8) {
                    // Group keys are manifest-owned free text (design doc §3) — display-cased,
                    // never localized or enumerated here.
                    Text(group.name.capitalized)
                        .font(.headline)
                    ForEach(group.rows) { row in
                        workerRow(row)
                    }
                }
            }
        }
        .task { await model.loadWorkers() }
    }

    private func workerRow(_ row: PlistEditorModel.WorkerRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(row.descriptor.displayName)
                .frame(minWidth: 160, alignment: .leading)
                .help(row.descriptor.description)
            switch row.status {
            case .componentTied(let affectedPages):
                if affectedPages.isEmpty {
                    Text("Inactive — not used")
                        .foregroundStyle(.secondary)
                } else {
                    WorkerAffectedPagesButton(pages: affectedPages)
                }
            case .settingsActivated(let isOn):
                Toggle(row.descriptor.displayName, isOn: Binding(
                    get: { isOn },
                    set: { newValue in
                        Task { await model.setWorkerActive(row.id, isOn: newValue) }
                    }))
                    .toggleStyle(.switch)
                    .labelsHidden()
                Text(isOn ? "On" : "Off")
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 28, alignment: .leading)
            }
        }
    }
```

And a small file-private subview at the bottom of the file (needs its own popover `@State`):

```swift
/// "Active — used on N pages" with the page list in a popover — the read-only status for a
/// component-tied worker (design doc §8; popover chosen over Navigator selection as the
/// implementation-time UI call the spec left open).
private struct WorkerAffectedPagesButton: View {
    let pages: [SiteGraphNode]
    @State private var showingPages = false

    var body: some View {
        Button {
            showingPages = true
        } label: {
            Text("Active — used on ^[\(pages.count) page](inflect: true)")
        }
        .buttonStyle(.link)
        .popover(isPresented: $showingPages, arrowEdge: .trailing) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Pages using this worker's components")
                    .font(.headline)
                ForEach(pages) { page in
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.secondary)
                        Text(page.title)
                        if let route = page.route {
                            Text(route)
                                .font(.callout.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding()
            .frame(minWidth: 220, alignment: .leading)
        }
    }
}
```

- [ ] **Step 4: Build the package to compile-check the view**

Run: `swift build --package-path . 2>&1 | tail -5`
Expected: Build complete (AnglesiteAppCore includes PlistEditorView).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorView.swift
git commit -m "feat(#710): Workers tab UI in site settings"
```

---

### Task 8: Wire the facet in `SiteWindowModel.openFile`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:814-818` (the `.plist` branch of `openFile`)

**Interfaces:**
- Consumes: Task 6's init params; `CurrentSite.configDirectory`; `SiteGraphExplorerModel.snapshot` (`@MainActor`); Task 5's `PreviewModel.activeWorkersChanged(_:)`.

- [ ] **Step 1: Pass the wiring**

Replace the `PlistEditorModel` construction:

```swift
            case .plist:
                activeEditor = .plist(PlistEditorModel(
                    file: file,
                    websiteTitle: site?.name ?? file.name,
                    sourceDirectory: site?.sourceDirectory ?? file.url.deletingLastPathComponent(),
                    configDirectory: site?.configDirectory,
                    graphSnapshotProvider: { [weak self] in self?.graphExplorer.snapshot },
                    onActiveWorkersChanged: { [weak self] settings in
                        await self?.preview.activeWorkersChanged(settings)
                    }
                ))
```

(`workerCatalogProvider` stays on its production default — `WorkerCatalogFetcher` with `productionCatalogURL`.)

- [ ] **Step 2: Run the app-layer suites**

Run: `swift test --package-path . --filter "AnglesiteAppTests" 2>&1 | tail -6`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift
git commit -m "feat(#710): wire Workers tab into the site window"
```

---

### Task 9: App build + String Catalog sync

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (generated sync — review the diff)

- [ ] **Step 1: Generate the project and build the app target**

```bash
xcodegen generate
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -5
```

Expected: `BUILD SUCCEEDED`. (Memory note: worktree needs `xcodegen generate` first; `ANGLESITE_SIDECAR_SRC` only matters for container-image scripts, not this build.)

- [ ] **Step 2: Sync the String Catalog (scoped to THIS worktree's DerivedData)**

Find this worktree's DerivedData dir by WorkspacePath match (never a blind `Anglesite-*` glob — memory `xcstrings-cli-sync`):

```bash
DD=$(for d in ~/Library/Developer/Xcode/DerivedData/Anglesite-*; do
  plutil -extract WorkspacePath raw "$d/info.plist" 2>/dev/null | grep -q "worktrees/issue-700-ba3222" && echo "$d"
done)
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$DD/Build/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

- [ ] **Step 3: Review the `.xcstrings` diff**

Run: `git diff --stat Sources/AnglesiteApp/Localizable.xcstrings && git diff Sources/AnglesiteApp/Localizable.xcstrings | head -80`
Expected: ONLY additions for the new Workers-tab strings ("Production Logs", "Analytics", "Inactive — not used", the inflected "Active — used on …" key, the popover title, the caption/error strings, "On"/"Off" already exist). If existing keys are deleted, STOP — do not commit; clean-build and re-sync per CONTRIBUTING.

- [ ] **Step 4: Localization backstop check**

Run: `scripts/check-localization-catalog.sh 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "feat(#710): extract Workers tab strings into the catalog"
```

---

### Task 10: Full verification + PR 2

- [ ] **Step 1: Full SwiftPM test suite**

Run: `swift test --package-path . 2>&1 | tee /tmp/swift-test-710.log | tail -15`
Expected: ALL PASS. Known non-regressions if hit (memories): FM "token overflow" flake in Generable tests; AstroDevServer port flake — re-run, don't debug. Capture the full log to the file (never just tail) if anything fails.

- [ ] **Step 2: JS overlay untouched check**

No `JS/edit-overlay/` or `Resources/Template/` changes in this plan — confirm with `git diff --stat origin/main...HEAD -- JS Resources/Template` (empty). If empty, skip the JS/template suites per CONTRIBUTING.

- [ ] **Step 3: Push and open PR 2 (stacked)**

```bash
git push -u origin claude/issue-700-ba3222
gh pr create --base claude/catalog-resources-shape --title "feat(#710): Site Settings Workers tab" --body "…"
```

PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings — **Summary**, **Paired PR check**, **Test plan** — plus appended Design notes covering: (a) the componentID→node resolution convention (normalized stem match) and why the spec's literal "node IDs" reading can't work; (b) dashboard deep-link paths centralized in `WorkerDashboardLinks` with graceful-degradation note; (c) owed follow-ups per design doc §9 — manual GUI smoke pass of the tab, and an opt-in container e2e case for toggle-restart (`AnglesiteContainerLocalTests`) which can't run in this environment. Paired PR check: no MCP schema change → no sidecar PR; `@dwk/workers` catalog consumed as published, no catalog change needed.

- [ ] **Step 4: Issue bookkeeping**

```bash
gh issue edit 710 --repo Anglesite/Anglesite-app --remove-label "🛠️ In Progress"
```

- [ ] **Step 5: After PR 1 merges** (when it happens): retarget PR 2 to `main`, then rebase onto `origin/main` and force-push (a bare retarget does not trigger CI — memory `stacked-pr-ci-gap`):

```bash
gh pr edit <PR2#> --base main
git fetch origin && git rebase origin/main && git push --force-with-lease
```
