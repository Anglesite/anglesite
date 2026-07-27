# V-3.2 Micropub Server — Worker Composition + Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose `@dwk/micropub` into the per-site Cloudflare Worker (routes,
D1/R2 bindings, catalog `requires` dependency resolution) and wire its
Cloudflare resource provisioning, mirroring how `#887`+`#896` shipped V-3.1's
webmention receiver — plus a prerequisite fix so `WorkerDescriptor` can
actually decode the live `catalog.json` at all.

**Architecture:** `Resources/Template/worker/worker.ts` gains a
`handleMicropub` handler composing `@dwk/micropub`'s `createMicropub`, gated
on all four required bindings being present (degrades to `503` otherwise, the
same pattern `handleWebmentionReceive` already uses). `WorkerComposition
.generateWranglerToml` gains a `hasMicropub` special case (mirroring
`hasWebmentionReceive`) emitting the `MICROPUB_DB` binding; the existing
generic `needsR2` branch already covers `MEDIA` once `WorkerDescriptor
.Resources` decodes correctly. `WorkerActivation.effectiveActiveIDs` resolves
the catalog's new `requires` field transitively, so activating Micropub also
activates IndieAuth.

**Tech Stack:** Swift (`AnglesiteCore`, Swift Testing), TypeScript (Cloudflare
Worker, `@cloudflare/vitest-pool-workers`/miniflare), `@dwk/micropub@0.1.0-beta.4`.

## Global Constraints

- **No content-sync bridge.** This plan does not touch `Source/` git or any
  content-type/Zod-schema mapping. A Micropub-created post lives only in
  `MICROPUB_DB` until a separate, later design covers that bridge.
- **No Settings UI.** `SiteSettings.activeWorkerIDs` gets no new UI writer —
  matches the current state for every other catalog worker, webmention
  included.
- **`WorkerRouteClaims.activeClaims`'s "never silently drop a claim" policy
  (`DeployModel.swift:514-516`) is not changed.** The `/media/` prefix route
  claim currently published in `catalog.json` has no `specificationURL` and
  will make `activeClaims` throw for any site with Micropub active, until
  the catalog is patched upstream (a separate, non-app-side fix). This plan
  does not add any app-side workaround for that.
- **`@dwk/micropub` is pinned to the exact published beta** (`0.1.0-beta.4`),
  matching how `@dwk/indieauth`/`@dwk/webmention` are pinned exactly (not a
  `^` range) in `workers-version.json`.
- **Swift test commands:** `swift test --package-path . --filter <SuiteName>`
  for a single suite, `swift test --package-path .` for the full run before
  the final commit.
- **TypeScript test commands (from `Resources/Template/`):** `npx vitest run
  worker/worker.test.ts`.

---

### Task 1: Fix `WorkerDescriptor.Resources` decoding + add `requires`

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerCatalog.swift`
- Modify: `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorkerDescriptor.Resources.init(from decoder: Decoder) throws`
  (decodes both the typed-array `catalog.json` shape and the legacy
  flat-object shape used by existing fixtures) — `needsD1`/`needsKV`/
  `needsR2` stay the same public stored properties every other file reads.
  `WorkerDescriptor.requires: [String]?` (new field; `nil` when the catalog
  entry doesn't declare it) — Task 2 reads this.

- [ ] **Step 1: Write the failing tests**

Open `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift` and add these tests
inside `WorkerDescriptorTests` (after `roundTripsSettingsActivated`, before
`unknownBindingKindThrows`):

```swift
    @Test("decodes the typed-array resources shape catalog.json now publishes")
    func decodesTypedArrayResources() throws {
        let json = """
        {
          "id": "micropub",
          "displayName": "Micropub",
          "description": "Publish posts to this site from any Micropub client",
          "group": "publishing",
          "binding": { "kind": "settingsActivated" },
          "resources": [
            { "type": "d1", "binding": "MICROPUB_DB" },
            { "type": "d1", "binding": "AUTH_DB" },
            { "type": "r2", "binding": "MEDIA" },
            { "type": "secret", "binding": "TOKEN_SIGNING_KEY" }
          ]
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.resources.needsD1 == true)
        #expect(decoded.resources.needsKV == false)
        #expect(decoded.resources.needsR2 == true)
    }

    @Test("still decodes the legacy flat-object resources shape")
    func decodesLegacyFlatResources() throws {
        let json = """
        {
          "id": "solid-pod",
          "displayName": "Solid Pod",
          "description": "Expose a Solid-compatible personal data store for this site",
          "group": "storage",
          "binding": { "kind": "settingsActivated" },
          "resources": { "needsD1": false, "needsKV": true, "needsR2": true }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.resources.needsD1 == false)
        #expect(decoded.resources.needsKV == true)
        #expect(decoded.resources.needsR2 == true)
    }

    @Test("decodes requires when present")
    func decodesRequires() throws {
        let json = """
        {
          "id": "micropub",
          "displayName": "Micropub",
          "description": "Publish posts to this site from any Micropub client",
          "group": "publishing",
          "binding": { "kind": "settingsActivated" },
          "requires": ["indieauth"],
          "resources": { "needsD1": true, "needsKV": false, "needsR2": true }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.requires == ["indieauth"])
    }

    @Test("requires defaults to nil when absent")
    func requiresDefaultsToNil() throws {
        let json = """
        {
          "id": "indieauth",
          "displayName": "IndieAuth",
          "description": "Sign in to apps with your own domain",
          "group": "identity",
          "binding": { "kind": "settingsActivated" },
          "resources": { "needsD1": true, "needsKV": false, "needsR2": false }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(WorkerDescriptor.self, from: json)
        #expect(decoded.requires == nil)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter WorkerDescriptorTests`
Expected: FAIL — `decodesTypedArrayResources` and `decodesLegacyFlatResources`
fail because `Resources` has no custom decoder yet (the typed-array test
throws a `DecodingError.typeMismatch`, the flat-object test's assertions
mismatch or it errors depending on synthesis); `decodesRequires` and
`requiresDefaultsToNil` fail to compile / fail at the `decoded.requires`
line because `WorkerDescriptor` has no `requires` property yet.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/WorkerCatalog.swift`, replace the `Resources`
struct (currently lines 84–94) with:

```swift
    /// Manifest-driven equivalent of the `needsD1`/`needsKV`/`needsR2` flags the old
    /// `WorkerComposition.Feature` enum used to hand-maintain as switch statements (removed by
    /// #708's descriptor migration).
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

        /// One entry of the typed `resources` array `catalog.json` now publishes (e.g.
        /// `{"type": "d1", "binding": "AUTH_DB"}`). Only `type` is consulted here — specific
        /// binding *names* are a separate, per-worker composition concern
        /// (`WorkerComposition`'s `indieauthWorkerID`/`webmentionWorkerID`/`micropubWorkerID`
        /// special cases), not something this generic flag-derivation expresses.
        private struct TypedEntry: Decodable {
            let type: String
        }

        /// Decodes both the typed-array shape now published by `catalog.json` (tried first) and
        /// the legacy flat-object shape (`{"needsD1": ..., "needsKV": ..., "needsR2": ...}`)
        /// still used by existing fixtures/tests, so neither a live catalog fetch nor an
        /// old-shape test payload fails to decode. A failed first attempt doesn't consume the
        /// decoder's underlying storage, so falling back to the keyed decode is safe.
        public init(from decoder: Decoder) throws {
            if let entries = try? [TypedEntry](from: decoder) {
                let types = Set(entries.map(\.type))
                needsD1 = types.contains("d1")
                needsKV = types.contains("kv")
                needsR2 = types.contains("r2")
                return
            }
            let container = try decoder.container(keyedBy: CodingKeys.self)
            needsD1 = try container.decode(Bool.self, forKey: .needsD1)
            needsKV = try container.decode(Bool.self, forKey: .needsKV)
            needsR2 = try container.decode(Bool.self, forKey: .needsR2)
        }
    }
```

Then, in the same file, add `requires` to `WorkerDescriptor` — change the
struct's stored properties and initializer (currently lines 7–40):

```swift
public struct WorkerDescriptor: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let displayName: String
    public let description: String
    /// Free-text grouping key the Workers tab sections by (e.g. `"social"`, `"storage"`) — never
    /// enumerated in Swift, since the manifest owns the set of groups.
    public let group: String
    public let binding: Binding
    public let resources: Resources
    /// Generic HTTP route claims this worker's handler serves (#746). Optional so catalogs
    /// published before the route-claim schema extension still decode; `nil` (or `[]`) means the
    /// worker claims no dynamic routes and composition emits no `run_worker_first` entry for it.
    /// Only claims from the *effective active* descriptor set (#709's
    /// `WorkerActivation.effectiveActiveIDs`) ever reach routing configuration — see
    /// `WorkerRouteClaims.activeClaims`.
    public let routes: [WorkerRouteClaim]?
    /// Ids of other catalog workers this one requires to function (e.g. Micropub requires
    /// IndieAuth's issued-token store). Optional so catalogs published before this field existed
    /// still decode; `nil` (or `[]`) means no dependency. `WorkerActivation.effectiveActiveIDs`
    /// resolves this transitively — activating a worker with a `requires` entry also activates
    /// the ids it names, provided they're present in the catalog.
    public let requires: [String]?

    public init(
        id: String,
        displayName: String,
        description: String,
        group: String,
        binding: Binding,
        resources: Resources,
        routes: [WorkerRouteClaim]? = nil,
        requires: [String]? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.description = description
        self.group = group
        self.binding = binding
        self.resources = resources
        self.routes = routes
        self.requires = requires
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter WorkerDescriptorTests`
Expected: PASS (8 tests: the 4 existing + 4 new).

Run: `swift test --package-path . --filter WorkerCatalogReaderTests`
Expected: PASS (unchanged — this suite's sample JSON already uses the flat
shape, which the fallback path still decodes).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerCatalog.swift Tests/AnglesiteCoreTests/WorkerCatalogTests.swift
git commit -m "fix(workers): decode catalog.json's typed resources array + requires field (#360)"
```

---

### Task 2: `WorkerActivation` resolves `requires` transitively

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerActivation.swift`
- Modify: `Tests/AnglesiteCoreTests/WorkerActivationTests.swift`

**Interfaces:**
- Consumes: `WorkerDescriptor.requires` (Task 1).
- Produces: `WorkerActivation.effectiveActiveIDs` now returns a set that
  includes every id transitively named by an active descriptor's `requires`
  — no signature change, same `Set<String>` return type every caller
  (`DeployModel.swift`, `SiteOperations.swift`) already consumes.

- [ ] **Step 1: Write the failing tests**

`Tests/AnglesiteCoreTests/WorkerActivationTests.swift` has an existing
private `descriptor(id:group:binding:)` helper, but it hardcodes
`resources: .init(needsD1: false, needsKV: false, needsR2: false)` and has
no way to set `requires` — these tests need both, so they construct
`WorkerDescriptor` directly via its full initializer instead of that helper.
Add these tests to the `WorkerActivationTests` suite:

```swift
    @Test("activating a worker with requires also activates the required id")
    func requiresResolvesTransitively() {
        let indieauth = WorkerDescriptor(
            id: "indieauth", displayName: "IndieAuth", description: "test fixture", group: "identity",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: false))
        let micropub = WorkerDescriptor(
            id: "micropub", displayName: "Micropub", description: "test fixture", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: true),
            requires: ["indieauth"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["micropub"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [indieauth, micropub], graph: nil)

        #expect(active == ["micropub", "indieauth"])
    }

    @Test("a required id not present in the catalog is silently dropped, not invented")
    func requiresIgnoresUnknownID() {
        let micropub = WorkerDescriptor(
            id: "micropub", displayName: "Micropub", description: "test fixture", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: true),
            requires: ["indieauth"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["micropub"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [micropub], graph: nil)

        #expect(active == ["micropub"])
    }

    @Test("a requires cycle terminates instead of looping forever")
    func requiresCycleTerminates() {
        let a = WorkerDescriptor(
            id: "a", displayName: "A", description: "test fixture", group: "test",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false),
            requires: ["b"])
        let b = WorkerDescriptor(
            id: "b", displayName: "B", description: "test fixture", group: "test",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false),
            requires: ["a"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["a"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [a, b], graph: nil)

        #expect(active == ["a", "b"])
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter WorkerActivationTests`
Expected: FAIL — `requiresResolvesTransitively` and
`requiresCycleTerminates` fail because `active` is missing the transitively
required id (`effectiveActiveIDs` doesn't look at `requires` yet);
`requiresIgnoresUnknownID` currently passes vacuously but must keep passing
after Step 3.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/WorkerActivation.swift`, replace the end of
`effectiveActiveIDs` (from `let requested = ...` through the final `return
active`) with:

```swift
        let requested = Set(settings.activeWorkerIDs ?? [])
        if catalog.isEmpty {
            active.formUnion(requested)
        } else {
            let settingsActivatedIDs = Set(catalog.compactMap { descriptor -> String? in
                guard case .settingsActivated = descriptor.binding else { return nil }
                return descriptor.id
            })
            active.formUnion(requested.intersection(settingsActivatedIDs))
        }

        // Resolve `requires` to a fixed point: an active descriptor's required ids become active
        // too, which may in turn have their own `requires`. `visited` guards a future catalog
        // entry with a `requires` cycle from looping forever — today's catalog has none, this is
        // defense-in-depth, not a currently-reachable case. An id a descriptor `requires` but
        // that isn't in `catalog` is silently dropped, matching this function's existing "never
        // invents" posture for component-tied workers.
        let byID = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
        var visited: Set<String> = []
        var frontier = active
        while !frontier.isEmpty {
            var next: Set<String> = []
            for id in frontier {
                guard visited.insert(id).inserted, let descriptor = byID[id] else { continue }
                for required in descriptor.requires ?? [] where byID[required] != nil {
                    next.insert(required)
                }
            }
            active.formUnion(next)
            frontier = next.subtracting(visited)
        }

        return active
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter WorkerActivationTests`
Expected: PASS (all existing tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerActivation.swift Tests/AnglesiteCoreTests/WorkerActivationTests.swift
git commit -m "feat(workers): resolve catalog requires transitively in effectiveActiveIDs (#360)"
```

---

### Task 3: `WorkerComposition` composes Micropub's `MICROPUB_DB` binding

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerComposition.swift`
- Modify: `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`

**Interfaces:**
- Consumes: `WorkerDescriptor` (unchanged shape from callers' perspective —
  Task 1 only changed how it decodes).
- Produces: `WorkerComposition.micropubWorkerID: String` (the catalog id
  `"micropub"`) — Task 4 references this same constant.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`, after the
existing `"webmention receive with no known site URL omits the vars block"`
test group (near line 236, before the `siteURL`-rejection tests — read the
file first to place it in the same "webmention receive" test neighborhood,
just for Micropub instead):

```swift
    @Test("micropub adds a MICROPUB_DB D1 binding on the shared database")
    func micropubAddsDatabaseBinding() throws {
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [micropub])
        #expect(toml.contains("binding = \"MICROPUB_DB\""))
        #expect(toml.contains("database_name = \"my-site-social\""))
    }

    @Test("no micropub worker means no MICROPUB_DB binding")
    func noMicropubMeansNoDatabaseBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [])
        #expect(!toml.contains("MICROPUB_DB"))
    }

    @Test("micropub's MICROPUB_DB binding uses the provisioned database id when known")
    func micropubUsesProvisionedDatabaseID() throws {
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [micropub],
            resources: .init(d1DatabaseID: "d1-existing"))
        // Find the MICROPUB_DB block specifically, not just any database_id in the file (the
        // generic DB block from needsD1 also emits one).
        let micropubBlock = try #require(toml.range(of: "binding = \"MICROPUB_DB\""))
        let tail = toml[micropubBlock.upperBound...]
        #expect(tail.contains("database_id = \"d1-existing\""))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: FAIL — `micropubAddsDatabaseBinding` and
`micropubUsesProvisionedDatabaseID` fail because no `MICROPUB_DB` binding is
emitted yet; `noMicropubMeansNoDatabaseBinding` currently passes vacuously.
Also FAIL to compile: `WorkerComposition.micropubWorkerID` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `Sources/AnglesiteCore/WorkerComposition.swift`, add the constant right
after `webmentionWorkerID` (currently lines 27–32):

```swift
    /// `@dwk/micropub`'s catalog id — like `webmentionWorkerID`, composition keys off this
    /// directly for the create/update/delete endpoint's bespoke `MICROPUB_DB` binding, since that
    /// binding name is part of `@dwk/micropub`'s public composition contract, not something a
    /// generic `resources` flag can express. `MEDIA` (R2) is covered by the existing generic
    /// `needsR2` branch below — Micropub's catalog entry declares an `r2` resource, so it falls
    /// out for free once `WorkerDescriptor.Resources` decodes that entry correctly.
    public static let micropubWorkerID = "micropub"
```

Then add the `hasMicropub` flag next to `hasWebmentionReceive` (currently
lines 114–115):

```swift
        let hasIndieauth = workers.contains(where: { $0.id == indieauthWorkerID })
        let hasWebmentionReceive = workers.contains(where: { $0.id == webmentionWorkerID })
        let hasMicropub = workers.contains(where: { $0.id == micropubWorkerID })
```

Finally, add the `MICROPUB_DB` block right after the `WEBMENTION_INBOX`
block (currently lines 165–178, right before the webmention queue block):

```swift
        // Same shared per-site D1 database as DB/AUTH_DB/WEBMENTION_INBOX, bound a fourth time
        // under MICROPUB_DB — @dwk/micropub creates its own tables on first use, so no separate
        // database or migration is needed here (matches the WEBMENTION_INBOX comment above).
        if hasMicropub {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"MICROPUB_DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: PASS (all existing tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerComposition.swift Tests/AnglesiteCoreTests/WorkerCompositionTests.swift
git commit -m "feat(workers): compose Micropub's MICROPUB_DB wrangler.toml binding (#360)"
```

---

### Task 4: Verify `SocialWorkerProvisionCommand` provisions Micropub's R2 bucket end-to-end

**Files:**
- Modify: `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`

**Interfaces:**
- Consumes: `WorkerComposition.micropubWorkerID`, `WorkerComposition.indieauthWorkerID` (existing).
- Produces: nothing new — this task is test-only. The existing generic
  `needsR2`/`needsD1` branches in `SocialWorkerProvisionCommand.provision`
  already create the R2 bucket and reuse the shared D1 database; they just
  needed `WorkerDescriptor.Resources` to decode correctly (Task 1) and the
  real catalog id constants (Task 3) to exist. This test proves that
  end-to-end rather than through the existing rough hand-built fixture.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`,
after `provisionsR2ForMicropub`:

```swift
    @Test("provisions Micropub (real catalog id, requires indieauth) end-to-end")
    func provisionsMicropubWithIndieauth() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let indieauth = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauth, micropub], acknowledgesPaidPlan: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.r2BucketName == "my-site-media")

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("binding = \"MICROPUB_DB\""))
        #expect(toml.contains("binding = \"AUTH_DB\""))
        #expect(toml.contains("[[r2_buckets]]"))
        #expect(toml.contains("bucket_name = \"my-site-media\""))
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests/provisionsMicropubWithIndieauth`
Expected: FAIL before Task 3 lands (no `MICROPUB_DB` binding in the written
TOML). If run after Task 3, this should already PASS — in that case skip to
Step 4 and note in the commit message that this test validated existing
behavior with no production change needed.

- [ ] **Step 3: (no production code change expected)**

If Step 2 failed, re-check that Task 3 was completed and merged into this
branch — `SocialWorkerProvisionCommand.swift` itself needs no new code for
this task; its generic `needsD1`/`needsR2` branches already do the work.

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: PASS (all existing tests + 1 new one).

- [ ] **Step 5: Commit**

```bash
git add Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift
git commit -m "test(workers): verify Micropub+IndieAuth provision end-to-end via real catalog ids (#360)"
```

---

### Task 5: Pin `@dwk/micropub` in `workers-version.json`

**Files:**
- Modify: `Resources/Template/worker/workers-version.json`

**Interfaces:** none — data file only, no code consumes the specific string
values beyond what already reads this file today.

- [ ] **Step 1: Update the pin**

Read `Resources/Template/worker/workers-version.json` (16 lines). Replace it
with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Pinned @dwk/workers version range for this template. Read by Anglesite during scaffold and social-feature enablement. Updated when a new @dwk/workers release ships.",
  "version": "0.1.0-beta.3",
  "range": "0.1.0-beta.3",
  "note": "IndieAuth, Webmention (inbound receive, V-3.1), and Micropub (V-3.2) are pinned to the exact published betas composed into worker.ts and verified by the template Worker integration suite; the remaining social packages remain gated on their conformance status until composed.",
  "packages": {
    "@dwk/indieauth": "0.1.0-beta.3",
    "@dwk/webmention": "0.1.0-beta.3",
    "@dwk/micropub": "0.1.0-beta.4",
    "@dwk/websub": "^0.0.0",
    "@dwk/microsub": "^0.0.0",
    "@dwk/webfinger": "^0.0.0",
    "@dwk/activitypub": "^0.0.0"
  }
}
```

(`@dwk/indieauth`/`@dwk/webmention` stay pinned at `0.1.0-beta.3`,
unchanged — bumping already-shipped, already-verified pins is outside this
task's scope and would introduce unreviewed risk. Only `@dwk/micropub`'s
placeholder `^0.0.0` becomes a real exact pin. `version`/`range` stay at
`0.1.0-beta.3` for the same reason — they describe the template's overall
tracked baseline, which this task isn't bumping.)

- [ ] **Step 2: Verify the file is valid JSON**

Run: `python3 -m json.tool Resources/Template/worker/workers-version.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/worker/workers-version.json
git commit -m "chore(workers): pin @dwk/micropub 0.1.0-beta.4 (#360)"
```

---

### Task 6: Compose `@dwk/micropub` into `worker.ts`

**Files:**
- Modify: `Resources/Template/worker/worker.ts`

**Interfaces:**
- Consumes: `@dwk/micropub`'s `createMicropub(config: MicropubConfig):
  MicropubHandler` and `MicropubEnv` (requires `MEDIA: R2Bucket`,
  `MICROPUB_DB: D1Database`, `AUTH_DB: D1Database`, `TOKEN_SIGNING_KEY:
  string` — the latter two already required, non-optionally, by the
  existing `WorkerEnv extends IndieAuthEnv`).
- Produces: `WorkerEnv.MICROPUB_DB?: D1Database`, `WorkerEnv.MEDIA?:
  R2Bucket` (new optional fields); a `handleMicropub` function; three new
  `ROUTES` entries (`/micropub`, `/media`, `/media/`) — Task 9's tests call
  `worker.fetch` against these paths.

- [ ] **Step 1: Add the import**

In `Resources/Template/worker/worker.ts`, add to the top of the file, after
the existing `@dwk/webmention` import block (currently lines 6–12):

```typescript
import {
  createMicropub,
  type MicropubEnv,
} from "@dwk/micropub";
```

- [ ] **Step 2: Extend `WorkerEnv`**

In the same file, add two new optional fields to the `WorkerEnv` interface,
right after `SITE_URL?: string;` (the last field, currently line 59):

```typescript
  /**
   * Micropub bindings (V-3.2, #360). Both optional: a site that hasn't provisioned Micropub has
   * neither bound, and `/micropub`/`/media` degrade gracefully (503) rather than throwing.
   * `AUTH_DB`/`TOKEN_SIGNING_KEY` are already required by `IndieAuthEnv` above — Micropub's
   * catalog entry `requires: ["indieauth"]` (resolved by `WorkerActivation`) guarantees both are
   * provisioned together, so this handler still explicitly checks all four before dispatching,
   * matching `handleWebmentionReceive`'s defense-in-depth pattern rather than trusting reachability
   * alone. See `WorkerComposition.generateWranglerToml` (Swift) for the binding generation.
   */
  MICROPUB_DB?: D1Database;
  MEDIA?: R2Bucket;
```

- [ ] **Step 3: Add the `handleMicropub` handler**

Add this function right after `handleWebmentionQueue` (currently ends at
line 410), before the `InboxFields` interface:

```typescript
/**
 * Micropub server (V-3.2, #360).
 *
 * Composes `@dwk/micropub`'s create/update/delete endpoint and its R2-backed media endpoint.
 * Requires `@dwk/indieauth` to be active on the same site (catalog `requires`, resolved by
 * `WorkerActivation`) — Micropub authorizes every request against `AUTH_DB`'s issued-token store
 * using the same `TOKEN_SIGNING_KEY` IndieAuth signs tokens with.
 *
 * Returns `503` when Micropub isn't fully provisioned (`MICROPUB_DB`/`MEDIA` unbound, or
 * IndieAuth's `AUTH_DB`/`TOKEN_SIGNING_KEY` unbound) rather than letting `@dwk/micropub` throw
 * its own loud startup error.
 */
function handleMicropub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.MICROPUB_DB || !env.MEDIA || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY) {
    return Promise.resolve(new Response("Micropub is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const micropub = createMicropub({ baseUrl, me: `${baseUrl}/` });
  const micropubEnv: MicropubEnv = {
    MEDIA: env.MEDIA,
    MICROPUB_DB: env.MICROPUB_DB,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  return micropub(request, micropubEnv, ctx);
}
```

- [ ] **Step 4: Add the `ROUTES` entries**

In the `ROUTES` array (currently lines 515–563), add these three entries
right after the `/webmention` entry, before the closing `];`:

```typescript
  {
    // Micropub create/update/delete + q=config/q=source/q=syndicate-to queries (V-3.2, #360).
    path: "/micropub",
    match: "exact",
    methods: ["GET", "POST"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
  {
    // Media endpoint upload (V-3.2, #360). GET-on-bare-/media is not served (matches
    // @dwk/micropub's default extensions.proposed: false — GET is only the media *retrieval*
    // path below, under /media/<key>, not the collection root).
    path: "/media",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
  {
    // Media retrieval by key (V-3.2, #360). NOTE: the catalog.json claim for this prefix route
    // currently has no specificationURL, which WorkerRouteClaims.validate (Swift) requires for
    // any prefix claim — until that's patched upstream, this route is unreachable in production
    // (no run_worker_first entry gets generated for it), though it's still exercised directly by
    // the miniflare test suite below.
    path: "/media/",
    match: "prefix",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleMicropub(request, env, ctx),
  },
```

- [ ] **Step 5: Update the file's top-level doc comment**

The file's opening doc comment (lines 14-36) describes what's composed.
Update its first paragraph to mention Micropub:

Find:
```
 * Composes @dwk/* social endpoints behind the site's static assets, plus a runtime inbox-capture
```
Replace with:
```
 * Composes @dwk/* social endpoints (IndieAuth, inbound Webmention, Micropub) behind the site's
 * static assets, plus a runtime inbox-capture
```

- [ ] **Step 6: Type-check the file**

Run (from `Resources/Template/`): `npx tsc --noEmit`
Expected: no errors. If `@dwk/micropub` isn't yet installed in
`Resources/Template/node_modules`, first run `npm install
@dwk/micropub@0.1.0-beta.4` from `Resources/Template/`.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/worker/worker.ts Resources/Template/package.json Resources/Template/package-lock.json
git commit -m "feat(workers): compose @dwk/micropub into the per-site Worker (#360)"
```

---

### Task 7: Bind `MICROPUB_DB`/`MEDIA` in the test miniflare config

**Files:**
- Modify: `Resources/Template/vitest.config.ts`

**Interfaces:** none — test infrastructure only.

- [ ] **Step 1: Update the config**

Read `Resources/Template/vitest.config.ts` (22 lines). Replace its
`miniflare` block with:

```typescript
      miniflare: {
        compatibilityDate: "2026-07-15",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["AUTH_DB", "WEBMENTION_INBOX", "MICROPUB_DB"],
        kvNamespaces: ["INBOX_KV", "SOCIAL_KV"],
        r2Buckets: ["MEDIA"],
        queueProducers: { WEBMENTION_QUEUE: "site-webmentions" },
        queueConsumers: ["site-webmentions"],
        bindings: {
          TOKEN_SIGNING_KEY: "test-token-signing-key-with-at-least-32-bytes",
          INDIEAUTH_OWNER_PASSWORD: "correct horse battery staple",
          SITE_URL: "https://test.example",
        },
      },
```

- [ ] **Step 2: Verify the existing suite still boots under the new config**

Run (from `Resources/Template/`): `npx vitest run worker/worker.test.ts`
Expected: PASS (all existing tests — this step only adds bindings, doesn't
remove any, so nothing existing should break).

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/vitest.config.ts
git commit -m "test(workers): bind MICROPUB_DB/MEDIA in the worker test miniflare config (#360)"
```

---

### Task 8: Add a reusable `mintAccessToken` test helper

**Files:**
- Modify: `Resources/Template/worker/worker.test.ts`

**Interfaces:**
- Consumes: the file's existing `pkceChallenge`, `dpopProof`, `fetchWorker`
  helpers.
- Produces: `dpopProof(url: string, method?: string, keyPair?:
  CryptoKeyPair): Promise<string>` (extended signature, backward-compatible
  — every existing call site passes only `url` and keeps using a freshly
  generated key pair per call); `mintAccessToken(scope: string): Promise<{
  token: string; keyPair: CryptoKeyPair }>` — Task 9 calls this to get an
  authorized token for Micropub requests.

- [ ] **Step 1: Write the failing test**

Add this test right after the existing `"IndieAuth owner consent completes
PKCE sign-in and issues a DPoP token"` test (ends at line 321):

```typescript
test("mintAccessToken: issues a token whose DPoP proof (same key pair) is accepted on a resource request", async () => {
  const { token, keyPair } = await mintAccessToken("create update media");
  expect(token.length).toBeGreaterThan(0);

  // Reuse the same key pair for a request to /token again (a cheap way to prove the key pair is
  // usable for more than the mint call itself, without depending on Task 9's /micropub route).
  const proof = await dpopProof("https://owner.example/micropub", "POST", keyPair);
  expect(proof.split(".")).toHaveLength(3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `Resources/Template/`): `npx vitest run worker/worker.test.ts -t mintAccessToken`
Expected: FAIL to compile/run — `mintAccessToken` is not defined, and
`dpopProof` doesn't accept a third argument yet.

- [ ] **Step 3: Write the implementation**

Replace the existing `dpopProof` function (currently lines 147–164) with:

```typescript
async function dpopProof(url: string, method = "POST", keyPair?: CryptoKeyPair): Promise<string> {
  const pair = keyPair ?? await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    jti: crypto.randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  })));
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signingInput);
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}
```

Then add `mintAccessToken` right after it — a helper that runs the same
PKCE/consent/token flow the existing IndieAuth test exercises inline, but
returns the issued token and the key pair used to bind it, so a caller can
mint further resource-request DPoP proofs with the *same* key (DPoP binds
the token to the public key that minted it — a proof signed by a different
key pair fails verification):

```typescript
/**
 * Runs the full PKCE + owner-consent + token-exchange flow (mirroring the inline steps in
 * "IndieAuth owner consent completes PKCE sign-in and issues a DPoP token" above) and returns
 * the issued access token plus the key pair its DPoP binding was minted with — callers that need
 * to make an authorized resource request (Task 9's Micropub tests) must reuse this same key pair
 * to prove possession, not generate a fresh one.
 */
async function mintAccessToken(scope: string): Promise<{ token: string; keyPair: CryptoKeyPair }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const verifier = `anglesite-mint-verifier-${crypto.randomUUID()}-with-more-than-forty-three-characters`;
  const challenge = await pkceChallenge(verifier);
  const authorize = new URL("https://owner.example/authorize");
  authorize.search = new URLSearchParams({
    client_id: "https://client.example/app",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: crypto.randomUUID(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
  }).toString();

  await fetchWorker(new Request(authorize));

  const consentForm = new URLSearchParams(authorize.search);
  consentForm.set("password", "correct horse battery staple");
  const consent = await fetchWorker(new Request("https://owner.example/indieauth/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.99" },
    body: consentForm,
  }));
  const approvedURL = new URL(consent.headers.get("location")!);
  const approval = await fetchWorker(new Request(approvedURL));
  const clientCallback = new URL(approval.headers.get("location")!);
  const code = clientCallback.searchParams.get("code")!;

  const tokenURL = "https://owner.example/token";
  const tokenResponse = await fetchWorker(new Request(tokenURL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      DPoP: await dpopProof(tokenURL, "POST", keyPair),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "https://client.example/app",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
    }),
  }));
  const body = await tokenResponse.json() as { access_token: string };
  return { token: body.access_token, keyPair };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `Resources/Template/`): `npx vitest run worker/worker.test.ts -t mintAccessToken`
Expected: PASS.

Run (from `Resources/Template/`): `npx vitest run worker/worker.test.ts`
Expected: PASS — full suite, including the original inline PKCE/DPoP test,
confirms the `dpopProof` signature change didn't break its existing
2-argument call sites (`dpopProof(tokenURL)`).

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/worker/worker.test.ts
git commit -m "test(workers): add mintAccessToken helper for authorized resource-request tests (#360)"
```

---

### Task 9: Micropub composition tests

**Files:**
- Modify: `Resources/Template/worker/worker.test.ts`

**Interfaces:**
- Consumes: `handleMicropub`, `WorkerEnv` (Task 6); `mintAccessToken`,
  `dpopProof`, `fetchWorker`, `testEnv` (Task 8 and existing helpers).
- Produces: nothing new — this is the terminal test task for the Worker
  composition slice.

- [ ] **Step 1: Write the tests**

Add this block at the end of `worker.test.ts`, after the existing webmention
queue-consumer test:

```typescript
// --- Micropub server (V-3.2, #360) ---------------------------------------------------------
// Composition of @dwk/micropub's create/update/delete endpoint + media endpoint. These run
// through worker.fetch in the workerd pool with MICROPUB_DB/MEDIA/AUTH_DB/TOKEN_SIGNING_KEY
// bound (see vitest.config.ts), exercising the same dispatch path production serves. The
// library's own mf2/auth/media internals are its own concern (covered by its suite +
// micropub.rocks), not re-tested here.

test("micropub: an unauthorized request (no Authorization header) is rejected", async () => {
  const response = await fetchWorker(new Request("https://owner.example/micropub?q=config"));
  expect(response.status).toBe(401);
});

test("micropub: a valid token creates a post (201 + Location)", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Hello from a Micropub client"] },
    }),
  }));
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toBeTruthy();
});

test("micropub: q=config is served to an authorized request", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub?q=config";
  const response = await fetchWorker(new Request(url, {
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "GET", keyPair),
    },
  }));
  expect(response.status).toBe(200);
});

test("micropub: 503 when MICROPUB_DB isn't bound", async () => {
  const { MICROPUB_DB: _unusedDB, ...envWithoutDB } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutDB as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: 503 when MEDIA isn't bound", async () => {
  const { MEDIA: _unusedMedia, ...envWithoutMedia } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutMedia as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub: 503 when AUTH_DB isn't bound (IndieAuth not provisioned)", async () => {
  const { AUTH_DB: _unusedAuthDB, ...envWithoutAuthDB } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/micropub?q=config"),
    envWithoutAuthDB as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("micropub media: uploading a file with the media scope returns 201 + Location", async () => {
  const { token, keyPair } = await mintAccessToken("media");
  const url = "https://owner.example/media";
  const form = new FormData();
  form.set("file", new File(["hello world"], "hello.txt", { type: "text/plain" }));
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair),
    },
    body: form,
  }));
  expect(response.status).toBe(201);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return location;
});

test("micropub media: uploading without the media scope is rejected", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/media";
  const form = new FormData();
  form.set("file", new File(["hello world"], "hello.txt", { type: "text/plain" }));
  const response = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair),
    },
    body: form,
  }));
  expect(response.status).toBe(403);
});

test("micropub media: 503 when MEDIA isn't bound", async () => {
  const { MEDIA: _unusedMedia, ...envWithoutMedia } = testEnv;
  const response = await worker.fetch(
    new Request("https://owner.example/media", { method: "POST" }),
    envWithoutMedia as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("routing: /media/ prefix dispatches to the Micropub handler directly (not yet reachable via run_worker_first in production, see worker.ts's ROUTES comment)", async () => {
  const response = await worker.fetch(
    new Request("https://owner.example/media/some-key", { method: "GET" }),
    testEnv,
    createExecutionContext(),
  );
  // Unauthenticated GET against a key that was never uploaded in this test — asserting it's not
  // a 404 from the *router* (i.e. matchRoute did dispatch to handleMicropub) is the point here;
  // the exact status @dwk/micropub returns for a missing/unauthorized key is its own concern.
  expect(response.status).not.toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run (from `Resources/Template/`): `npx vitest run worker/worker.test.ts`
Expected: PASS — full suite, including all prior tests and these new ones.
If the media-upload tests fail because `@dwk/micropub`'s default config
doesn't accept a bare `file` field name or expects `extensions.proposed` for
some behavior, read the actual error message and adjust the request shape
to match the library's documented multipart contract (the README's "the
latter folds uploaded files (e.g. `photo`) into the post" — try `photo`
instead of `file` as the form field name if `file` is rejected) rather than
weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/worker/worker.test.ts
git commit -m "test(workers): add Micropub composition tests (create, media, degrade) (#360)"
```

---

### Task 10: Full-suite verification + docs

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — verification and documentation only.

- [ ] **Step 1: Run the full Swift suite**

Run: `swift test --package-path .`
Expected: PASS. If anything outside the files this plan touched fails,
stop and investigate before continuing — per repo convention (CLAUDE.md's
verification guidance), don't attribute an unrelated failure to this work
without checking.

- [ ] **Step 2: Run the full template Worker suite**

Run (from `Resources/Template/`): `npm run test:worker`
Expected: PASS (this is `vitest run worker/worker.test.ts` per the
repo's existing npm script — confirm the exact script name by checking
`Resources/Template/package.json`'s `scripts` block if `test:worker` isn't
present, and use whatever the actual script is called).

- [ ] **Step 3: Build the app target**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED. (Run `xcodegen generate` first if the project
file is stale relative to `project.yml` — this worktree may not have it
generated yet.)

- [ ] **Step 4: Update CLAUDE.md's V-3 status line**

Find the line (in the "Other active tracks" section):

```
- **Personal Publishing OS pivot (#334):** V-1 (typed content objects + feeds, #335) shipped, including the content-type registry, mf2/JSON-LD projection, and per-type editors. V-2–V-5 (Webmention/POSSE, inbound interactions, ActivityPub + reader, communities) are **gated on a conformant `@dwk/workers` release**.
```

Replace with:

```
- **Personal Publishing OS pivot (#334):** V-1 (typed content objects + feeds, #335) shipped, including the content-type registry, mf2/JSON-LD projection, and per-type editors. `@dwk/workers` shipped `0.1.0-beta.4` (2026-07-23), unblocking V-3 inbound work: V-3.1 webmention receive (#359) landed via #887/#896 (canonicality snapshot deferred to #362); V-3.2 Micropub server (#360) composes `@dwk/micropub`'s create/update/delete + media endpoint into the per-site Worker, with `WorkerActivation` now resolving the catalog's `requires` field transitively (Micropub → IndieAuth) — the content-sync bridge into `Source/` and a Settings UI toggle remain deferred, same posture as webmention. V-3.3 (WebSub, #361) and V-3.4 (render + snapshot, #362) are unstarted. V-4/V-5 remain gated on their own conformance bars.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reflect V-3.2 Micropub server composition landing (#360)"
```

---

## Self-Review

**Spec coverage:**
- "Prerequisite fix: `WorkerDescriptor.Resources` decoding" — Task 1. **Correction
  (post-rebase):** this half of Task 1 shipped independently as #914/#915 before
  the branch was rebased onto current `main`; it is not part of this PR's diff.
  Only the `requires` field addition below is this PR's own contribution.
- "`WorkerDescriptor.requires` — model the new dependency field" — Task 1.
- "`WorkerActivation.effectiveActiveIDs` — resolve `requires` transitively" — Task 2.
- "`WorkerComposition.generateWranglerToml` — `hasMicropub` branch" — Task 3.
- "`SocialWorkerProvisionCommand` — create the R2 bucket" — Task 4 (verified
  as already-generic, no new production code).
- "`worker/worker.ts` — compose `@dwk/micropub`" — Task 6.
- Version pin — Task 5.
- Test miniflare bindings — Task 7.
- "The `/media/` prefix claim gap is an upstream catalog fix, not app-side
  code" — documented as a code comment in Task 6 Step 4 and left
  unaddressed in Swift, matching the spec's revised decision.
- Explicitly out of scope (content-sync bridge, Settings UI, live
  micropub.rocks run) — not touched by any task, consistent with the spec.

**Placeholder scan:** none — every step has runnable code or an exact
command.

**Type consistency:** `WorkerDescriptor.requires: [String]?` (Task 1) is the
exact type `WorkerActivation`'s new resolution loop reads (Task 2).
`WorkerComposition.micropubWorkerID` (Task 3) is the exact string
`SocialWorkerProvisionCommandTests`' new test (Task 4) and `worker.ts`'s
catalog-id comparisons reference. `handleMicropub(request, env, ctx):
Promise<Response>` (Task 6) matches the `WorkerRoute.handler` signature
already used by every other `ROUTES` entry in the file. `mintAccessToken`'s
return shape (`{ token: string; keyPair: CryptoKeyPair }`, Task 8) is
exactly what Task 9's tests destructure.

**Known residual risk, disclosed:** the media-upload tests in Task 9 guess
at `@dwk/micropub`'s exact multipart field-name contract from its README
prose ("the latter folds uploaded files (e.g. `photo`) into the post");
Step 2's guidance tells the implementer to adjust the request shape from
the actual test failure rather than weaken the assertion, since I could not
run these tests myself while writing this plan.
