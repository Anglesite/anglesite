# Inbox Capture Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Settings UI (Workers tab) that provisions #587's `/inbox` Worker route + `INBOX_KV` staging — closing the gap where `SiteSettings.inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` are unfillable, dead storage slots and `WorkerComposition.generateWranglerToml`'s inbox parameters are never passed by any caller.

**Architecture:** Extends the existing `SocialWorkerProvisionCommand` deploy-time provisioning pipeline with a new incremental resource block (parallel to its existing D1/KV/R2 blocks), folds the inbox KV namespace id + owning account id into `WorkerComposition.ProvisionedResources` (the one existing channel that already flows resource ids from a provisioning run back into `SiteSettings`), and adds a Settings-tab toggle that does a cheap instant local write + a Cloudflare token-capability pre-check, with the actual `wrangler kv namespace create` deferred to the next deploy.

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27+), Swift Testing (`@Test`/`#expect`), `swift test --package-path .`.

**Spec:** [`docs/superpowers/specs/2026-08-06-inbox-capture-provisioning-design.md`](../specs/2026-08-06-inbox-capture-provisioning-design.md) — read it in full before starting; this plan implements it task-by-task and doesn't repeat its rationale.

## Global Constraints

- Every `SiteSettings` field must stay `Optional` (plist forward-compat rule; see the type's doc comment in `Sources/AnglesiteCore/SiteConfigStore.swift`).
- No new third-party dependencies. Apple frameworks + this repo's existing seams only.
- Run `swift test --package-path .` after every task (it covers `AnglesiteCore`, `AnglesiteAppCore`, and their test targets — `PlistEditorModel.swift`/`PlistEditorView.swift` compile into `AnglesiteAppCore`, so this single command verifies the app-layer changes too, no `scripts/build-app.sh` needed mid-plan).
- Conventional commit subjects, ≤72 characters, referencing `#764`.
- Do not touch `IntegrationDescriptor`/`IntegrationPlanner`/`IntegrationScaffolder` — out of scope per the spec.

---

### Task 1: Fold inbox KV resource ids into `ProvisionedResources`; add the `inboxCaptureEnabled` toggle field

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerComposition.swift:102-147` (`ProvisionedResources`)
- Modify: `Sources/AnglesiteCore/SiteConfigStore.swift:12-126` (`SiteSettings`)
- Modify: `Sources/AnglesiteCore/ReceivedInteractionSync.swift:60` (stale doc-comment reference only)
- Test: `Tests/AnglesiteCoreTests/SiteConfigStoreTests.swift`
- Test: `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`

**Interfaces:**
- Produces: `WorkerComposition.ProvisionedResources.inboxKVNamespaceID: String?`, `.inboxAccountID: String?` (new fields, used by Task 2 and Task 5).
- Produces: `SiteSettings.inboxCaptureEnabled: Bool?` (new field, used by Task 5's `DeployModel` wiring and Task 7).
- Removes: `SiteSettings.inboxCaptureAccountID`, `SiteSettings.inboxCaptureKVNamespaceID` (dead fields no shipped UI ever populated — see spec's "Data model" section for why removing them is safe).

- [ ] **Step 1: Write the failing tests**

Find `Tests/AnglesiteCoreTests/SiteConfigStoreTests.swift` and add (inside its existing `struct`/`@Suite`, matching whatever test style is already there):

```swift
@Test("inboxCaptureEnabled and ProvisionedResources' inbox fields round-trip through plist encode/decode")
func inboxCaptureFieldsRoundTrip() throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("SiteConfigStoreTests-inbox-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = SiteConfigStore(configDirectory: dir)
    let settings = SiteSettings(
        provisionedWorkerResources: .init(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1"),
        inboxCaptureEnabled: true
    )
    try await store.save(settings)
    let loaded = try await store.load()
    #expect(loaded.inboxCaptureEnabled == true)
    #expect(loaded.provisionedWorkerResources?.inboxKVNamespaceID == "ns-1")
    #expect(loaded.provisionedWorkerResources?.inboxAccountID == "acct-1")
}

@Test("a settings.plist with no inboxCaptureEnabled key decodes it as nil")
func inboxCaptureEnabledDefaultsNilOnOldFile() throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("SiteConfigStoreTests-inbox-old-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    try await SiteConfigStore(configDirectory: dir).save(SiteSettings(displayName: "Old Site"))
    let loaded = try await SiteConfigStore(configDirectory: dir).load()
    #expect(loaded.inboxCaptureEnabled == nil)
    #expect(loaded.displayName == "Old Site")
}
```

Also add to `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift` (inside its existing suite — check its imports/style first, it already has `inboxCaptureEnabled`/`inboxKVNamespaceID` coverage for `generateWranglerToml` around line 110-127):

```swift
@Test("ProvisionedResources' inbox fields round-trip through Codable")
func provisionedResourcesInboxFieldsCodable() throws {
    let resources = WorkerComposition.ProvisionedResources(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1")
    let data = try PropertyListEncoder().encode(resources)
    let decoded = try PropertyListDecoder().decode(WorkerComposition.ProvisionedResources.self, from: data)
    #expect(decoded == resources)
}
```

(Add `import Foundation` at the top of that file if it isn't already imported — check first.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter SiteConfigStoreTests`
Expected: FAIL to compile — `SiteSettings` has no member `inboxCaptureEnabled`, `ProvisionedResources.init` has no `inboxKVNamespaceID`/`inboxAccountID` parameters.

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: same kind of compile failure for the new `WorkerCompositionTests` case.

- [ ] **Step 3: Implement the data model changes**

In `Sources/AnglesiteCore/WorkerComposition.swift`, inside `ProvisionedResources` (currently lines 102-147), add two fields after `podBlobsR2BucketName` and thread them through `init`:

```swift
        public var podBlobsR2BucketName: String?
        /// The provisioned `INBOX_KV` namespace id (#587, #764). `nil` until inbox capture's
        /// first successful provisioning run.
        public var inboxKVNamespaceID: String?
        /// The Cloudflare account id that owns `inboxKVNamespaceID` — `InboxSubmissionSync`
        /// needs this to address the namespace directly; every other client in this codebase
        /// re-resolves account id live from the token instead of persisting it, but inbox
        /// capture's sync path runs independently of any single deploy/provisioning call and
        /// needs a stable, already-resolved value.
        public var inboxAccountID: String?

        /// Memberwise creation; the all-`nil` default is the pre-provisioning state.
        public init(
            d1DatabaseID: String? = nil, kvNamespaceID: String? = nil, r2BucketName: String? = nil,
            queueName: String? = nil, websubQueueName: String? = nil, microsubQueueName: String? = nil,
            podBlobsR2BucketName: String? = nil, inboxKVNamespaceID: String? = nil, inboxAccountID: String? = nil
        ) {
            self.d1DatabaseID = d1DatabaseID
            self.kvNamespaceID = kvNamespaceID
            self.r2BucketName = r2BucketName
            self.queueName = queueName
            self.websubQueueName = websubQueueName
            self.microsubQueueName = microsubQueueName
            self.podBlobsR2BucketName = podBlobsR2BucketName
            self.inboxKVNamespaceID = inboxKVNamespaceID
            self.inboxAccountID = inboxAccountID
        }
    }
```

(Replace the existing field list, `init` signature, and `init` body accordingly — don't leave the old one in place.)

In `Sources/AnglesiteCore/SiteConfigStore.swift`:

1. Remove these two properties (lines 16-23):
```swift
    /// Cloudflare account id owning this site's `INBOX_KV` namespace (#587). `nil` until a
    /// provisioning flow sets it — `InboxSubmissionSync` no-ops without both this and
    /// `inboxCaptureKVNamespaceID`.
    public var inboxCaptureAccountID: String?

    /// The provisioned `INBOX_KV` namespace id for this site (#587). See
    /// `inboxCaptureAccountID`.
    public var inboxCaptureKVNamespaceID: String?
```

2. Add a new field after `moderators` (line 88):
```swift
    /// Whether inbox capture's `/inbox` route should be live in the composed Worker (#764).
    /// Kept separate from `provisionedWorkerResources` (resource existence) so "provisioned but
    /// paused" and "never provisioned" are distinguishable — mirrors how `activeWorkerIDs`
    /// (routing) is kept separate from `provisionedWorkerResources` for the `@dwk/workers`
    /// catalog. `nil`/`false` = off; `provisionedWorkerResources`'s inbox fields are left
    /// populated when paused so re-enabling reuses the same namespace instead of creating a new
    /// one.
    public var inboxCaptureEnabled: Bool?
```

3. Update `init` (lines 93-125): remove the `inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` parameters and their assignments, add `inboxCaptureEnabled: Bool? = nil` as the last parameter and `self.inboxCaptureEnabled = inboxCaptureEnabled` as the last assignment.

In `Sources/AnglesiteCore/ReceivedInteractionSync.swift`, fix a doc comment that names the old field (around line 60) — replace:
```
    /// `inboxCaptureAccountID`, since the D1 database itself is already identified by
```
with:
```
    /// `ProvisionedResources.inboxAccountID`, since the D1 database itself is already identified
    /// by
```
(Reflow the surrounding sentence as needed so the comment still reads correctly — this is prose only, no functional change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SiteConfigStoreTests`
Expected: PASS

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: PASS (including the pre-existing inbox-related cases, which are unaffected by this change)

Run: `swift test --package-path .`
Expected: everything else still compiles and passes except `InboxSubmissionSync.swift` and its tests, which reference the now-removed `SiteSettings.inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` — Task 2 fixes that. Confirm the *only* compile errors are in `InboxSubmissionSync.swift`/`InboxSubmissionSyncTests.swift` before proceeding.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerComposition.swift Sources/AnglesiteCore/SiteConfigStore.swift Sources/AnglesiteCore/ReceivedInteractionSync.swift Tests/AnglesiteCoreTests/SiteConfigStoreTests.swift Tests/AnglesiteCoreTests/WorkerCompositionTests.swift
git commit -m "feat(#764): fold inbox KV ids into ProvisionedResources"
```

---

### Task 2: Update `InboxSubmissionSync` to read from `provisionedWorkerResources`

**Files:**
- Modify: `Sources/AnglesiteCore/InboxSubmissionSync.swift:33-48`
- Test: `Tests/AnglesiteCoreTests/InboxSubmissionSyncTests.swift:58-104`

**Interfaces:**
- Consumes: `SiteSettings.provisionedWorkerResources: WorkerComposition.ProvisionedResources?` with its `.inboxAccountID`/`.inboxKVNamespaceID` fields (from Task 1).
- No change to `InboxSubmissionSync`'s own public signatures — `pullAndCommitIfConfigured`'s parameters and return type are unchanged; only its internal guard clause's data source changes.

- [ ] **Step 1: Update the three affected tests first (still expected to fail against old code)**

In `Tests/AnglesiteCoreTests/InboxSubmissionSyncTests.swift`, replace the three tests that construct `SiteSettings` with the old top-level fields:

Replace (around line 71-84):
```swift
    @Test("pullAndCommitIfConfigured no-ops when only the account id is set")
    func noOpsWithPartialConfigurationMissingNamespace() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(inboxCaptureAccountID: "acct1", inboxCaptureKVNamespaceID: nil))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"))
        #expect(count == 0)
    }
```
with:
```swift
    @Test("pullAndCommitIfConfigured no-ops when only the account id is set")
    func noOpsWithPartialConfigurationMissingNamespace() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(inboxAccountID: "acct1")))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"))
        #expect(count == 0)
    }
```

Replace (around line 86-104):
```swift
    @Test("pullAndCommitIfConfigured no-ops (with no network call) when both ids are set but no token is stored")
    func noOpsWithBothIDsSetButNoToken() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(inboxCaptureAccountID: "acct1", inboxCaptureKVNamespaceID: "ns1"))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: nil),
            transport: { _ in
                Issue.record("transport must not be called when no Cloudflare token is available")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }
```
with:
```swift
    @Test("pullAndCommitIfConfigured no-ops (with no network call) when both ids are set but no token is stored")
    func noOpsWithBothIDsSetButNoToken() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("inbox-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(inboxKVNamespaceID: "ns1", inboxAccountID: "acct1")))

        let count = await InboxSubmissionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: nil),
            transport: { _ in
                Issue.record("transport must not be called when no Cloudflare token is available")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }
```

(`noOpsWithoutConfiguration`, around line 58-69, needs no change — it never constructs `SiteSettings` with these fields.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter InboxSubmissionSyncTests`
Expected: FAIL to compile — `SiteSettings.init` no longer has `inboxCaptureAccountID`/`inboxCaptureKVNamespaceID` parameters (removed in Task 1), and `InboxSubmissionSync.swift` itself also still references the old fields, so this is a two-sided compile failure until Step 3.

- [ ] **Step 3: Update `InboxSubmissionSync`'s guard clause**

In `Sources/AnglesiteCore/InboxSubmissionSync.swift`, replace lines 27-43:

```swift
    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless both `inboxCaptureAccountID` and
    /// `inboxCaptureKVNamespaceID` are set and a token is available — i.e. inbox capture hasn't
    /// been provisioned for this site yet. `configDirectory` is the package's `Config/`
    /// directory (`AnglesitePackage.configURL`), a sibling of `siteDirectory`
    /// (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let accountID = settings.inboxCaptureAccountID, !accountID.isEmpty,
              let namespaceID = settings.inboxCaptureKVNamespaceID, !namespaceID.isEmpty,
              let token = try? secretStore.readCloudflareToken(), !token.isEmpty
        else { return 0 }
```

with:

```swift
    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless both `provisionedWorkerResources.inboxAccountID` and
    /// `.inboxKVNamespaceID` are set and a token is available — i.e. inbox capture hasn't been
    /// provisioned for this site yet (#764). `configDirectory` is the package's `Config/`
    /// directory (`AnglesitePackage.configURL`), a sibling of `siteDirectory`
    /// (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let resources = settings.provisionedWorkerResources,
              let accountID = resources.inboxAccountID, !accountID.isEmpty,
              let namespaceID = resources.inboxKVNamespaceID, !namespaceID.isEmpty,
              let token = try? secretStore.readCloudflareToken(), !token.isEmpty
        else { return 0 }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter InboxSubmissionSyncTests`
Expected: PASS (all 5 tests, including `pullsCommitsAndDeletes` and `noStagedSubmissionsIsNoOp`, which don't touch these fields and were unaffected)

Run: `swift test --package-path .`
Expected: full suite compiles and passes again (no more `SiteSettings`-shape errors anywhere).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/InboxSubmissionSync.swift Tests/AnglesiteCoreTests/InboxSubmissionSyncTests.swift
git commit -m "fix(#764): read inbox capture ids from provisionedWorkerResources"
```

---

### Task 3: Add `TokenCapability.kv` + `CloudflareCapabilityProber` probe path

**Files:**
- Modify: `Sources/AnglesiteCore/TokenCapabilities.swift`
- Modify: `Sources/AnglesiteCore/CloudflareCapabilityProber.swift`
- Test: `Tests/AnglesiteCoreTests/TokenCapabilitiesTests.swift`
- Test: `Tests/AnglesiteCoreTests/CloudflareCapabilityProberTests.swift`

**Interfaces:**
- Produces: `TokenCapability.kv` (new case), consumed by Task 7's `PlistEditorModel.setInboxCaptureEnabled`.
- No signature changes to `CloudflareCapabilityProber.probe(token:zoneID:)` — same signature, one more capability included in its returned `TokenCapabilities` set when present.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/TokenCapabilitiesTests.swift`, replace the whole file's `stableRawValues` test:

```swift
    @Test("every capability has a stable raw value")
    func stableRawValues() {
        #expect(TokenCapability.allCases.count == 10)
        #expect(TokenCapability.zoneSettings.rawValue == "zoneSettings")
        #expect(TokenCapability(rawValue: "registrar") == .registrar)
        #expect(TokenCapability.kv.rawValue == "kv")
    }
```

In `Tests/AnglesiteCoreTests/CloudflareCapabilityProberTests.swift`, update `classifiesStatuses` to add a `.kv` route and assertion — replace:

```swift
    @Test("2xx and non-auth errors mark a capability present; 403 marks it absent")
    func classifiesStatuses() async {
        let prober = CloudflareCapabilityProber(transport: fakeTransport([
            "/accounts?": accountsOK,
            "accounts/acc1/workers/scripts": (200, #"{"success":true,"result":[]}"#),
            "accounts/acc1/challenges/widgets": (403, #"{"success":false}"#),
            "accounts/acc1/registrar/domains": (200, #"{"success":true,"result":[]}"#),
            "zones/z1/settings/ssl": (200, #"{"success":true,"result":{"value":"strict"}}"#),
            "zones/z1/dns_records": (403, #"{"success":false}"#),
            "zones/z1/rulesets": (200, #"{"success":true,"result":[]}"#),
            "zones/z1/email/routing": (404, #"{"success":false}"#),
            "zones/z1/settings/zaraz/config": (403, #"{"success":false}"#),
            "zones/z1/page_shield": (200, #"{"success":true,"result":{"enabled":false}}"#),
        ]))
        let caps = await prober.probe(token: "t", zoneID: "z1")
        #expect(caps.contains(.workers))
        #expect(!caps.contains(.turnstile))
        #expect(caps.contains(.registrar))
        #expect(caps.contains(.zoneSettings))
        #expect(!caps.contains(.dns))
        #expect(caps.contains(.rulesets))
        #expect(caps.contains(.emailRouting))  // 404 = enabled-state miss, permission present
        #expect(!caps.contains(.zaraz))
        #expect(caps.contains(.pageShield))
    }
```

with:

```swift
    @Test("2xx and non-auth errors mark a capability present; 403 marks it absent")
    func classifiesStatuses() async {
        let prober = CloudflareCapabilityProber(transport: fakeTransport([
            "/accounts?": accountsOK,
            "accounts/acc1/workers/scripts": (200, #"{"success":true,"result":[]}"#),
            "accounts/acc1/challenges/widgets": (403, #"{"success":false}"#),
            "accounts/acc1/registrar/domains": (200, #"{"success":true,"result":[]}"#),
            "accounts/acc1/storage/kv/namespaces": (403, #"{"success":false}"#),
            "zones/z1/settings/ssl": (200, #"{"success":true,"result":{"value":"strict"}}"#),
            "zones/z1/dns_records": (403, #"{"success":false}"#),
            "zones/z1/rulesets": (200, #"{"success":true,"result":[]}"#),
            "zones/z1/email/routing": (404, #"{"success":false}"#),
            "zones/z1/settings/zaraz/config": (403, #"{"success":false}"#),
            "zones/z1/page_shield": (200, #"{"success":true,"result":{"enabled":false}}"#),
        ]))
        let caps = await prober.probe(token: "t", zoneID: "z1")
        #expect(caps.contains(.workers))
        #expect(!caps.contains(.turnstile))
        #expect(caps.contains(.registrar))
        #expect(!caps.contains(.kv))
        #expect(caps.contains(.zoneSettings))
        #expect(!caps.contains(.dns))
        #expect(caps.contains(.rulesets))
        #expect(caps.contains(.emailRouting))  // 404 = enabled-state miss, permission present
        #expect(!caps.contains(.zaraz))
        #expect(caps.contains(.pageShield))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter TokenCapabilitiesTests`
Expected: FAIL — `count == 10` fails against the current 9 cases; `TokenCapability.kv` doesn't exist (compile error).

Run: `swift test --package-path . --filter CloudflareCapabilityProberTests`
Expected: FAIL — `caps.contains(.kv)` doesn't compile (no such case), and even once it does, the prober doesn't probe `storage/kv/namespaces` yet so the fake transport route above would go unused (harmless, but the assertion `!caps.contains(.kv)` needs the case to exist first).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/TokenCapabilities.swift`, add a new case after `registrar`:

```swift
    /// Registrar domain search/registration.
    case registrar
    /// Workers KV namespace management (list/create) — used to gate inbox-capture provisioning
    /// (#764).
    case kv
}
```

In `Sources/AnglesiteCore/CloudflareCapabilityProber.swift`, add a probe entry to the account-scoped list inside `probe(token:zoneID:)`:

```swift
        if let accountID = await firstAccountID(token: token) {
            probes += [
                (.workers, "accounts/\(accountID)/workers/scripts"),
                (.turnstile, "accounts/\(accountID)/challenges/widgets"),
                (.registrar, "accounts/\(accountID)/registrar/domains"),
                (.kv, "accounts/\(accountID)/storage/kv/namespaces?per_page=1"),
            ]
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TokenCapabilitiesTests`
Expected: PASS

Run: `swift test --package-path . --filter CloudflareCapabilityProberTests`
Expected: PASS (all three existing tests plus the updated assertion)

Run: `swift test --package-path .`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/TokenCapabilities.swift Sources/AnglesiteCore/CloudflareCapabilityProber.swift Tests/AnglesiteCoreTests/TokenCapabilitiesTests.swift Tests/AnglesiteCoreTests/CloudflareCapabilityProberTests.swift
git commit -m "feat(#764): add TokenCapability.kv probe"
```

---

### Task 4: Add `HTTPCloudflareClient.accountID(apiToken:)`

**Files:**
- Modify: `Sources/AnglesiteCore/HTTPCloudflareClient.swift:605-613`
- Test: `Tests/AnglesiteCoreTests/CloudflareClientTests.swift`

**Interfaces:**
- Produces: `HTTPCloudflareClient.accountID(apiToken: String) async throws -> String`, consumed by Task 5's `SocialWorkerProvisionCommand.defaultAccountIDSource`.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/CloudflareClientTests.swift` (same file that already has `workerScriptNamesReturnsIds`/`workerScriptNamesPaginates` around line 113-126 — match that style):

```swift
@Test("accountID returns the token's first visible account id")
func accountIDReturnsFirstAccount() async throws {
    let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, accountsJSON),
    ]))
    let id = try await client.accountID(apiToken: "t")
    #expect(id == "acct123")
}

@Test("accountID throws when the token can see no account")
func accountIDThrowsWithNoAccount() async throws {
    let emptyJSON = #"{"success":true,"errors":[],"messages":[],"result":[]}"#
    let client = HTTPCloudflareClient(transport: fakeTransport([
        "/accounts?per_page=1": (200, emptyJSON),
    ]))
    await #expect(throws: CloudflareError.self) {
        _ = try await client.accountID(apiToken: "t")
    }
}
```

(Check `CloudflareError`'s exact case/import — it's already used elsewhere in this file per `resolveAccountID`'s implementation; match whatever the existing throw style expects for the `#expect(throws:)` type parameter.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `swift test --package-path . --filter CloudflareClientTests`
Expected: FAIL to compile — `HTTPCloudflareClient` has no member `accountID`.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/HTTPCloudflareClient.swift`, add a public wrapper right after the existing private `resolveAccountID` (currently lines 605-613):

```swift
    /// Resolves the token's first visible account id — every Registrar endpoint is
    /// account-scoped. Mirrors `workerScriptNames`'s resolution exactly.
    private func resolveAccountID(apiToken: String) async throws -> String {
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        return accountID
    }

    /// Public entry point for the token's first visible account id — for callers that need it
    /// directly rather than through one of this type's already-account-scoped operations (e.g.
    /// `SocialWorkerProvisionCommand`'s inbox-capture provisioning, #764).
    public func accountID(apiToken: String) async throws -> String {
        try await resolveAccountID(apiToken: apiToken)
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `swift test --package-path . --filter CloudflareClientTests`
Expected: PASS

Run: `swift test --package-path .`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/HTTPCloudflareClient.swift Tests/AnglesiteCoreTests/CloudflareClientTests.swift
git commit -m "feat(#764): expose HTTPCloudflareClient.accountID(apiToken:)"
```

---

### Task 5: `SocialWorkerProvisionCommand` — provision the inbox KV namespace on deploy

**Files:**
- Modify: `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`
- Test: `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`

**Interfaces:**
- Consumes: `WorkerComposition.ProvisionedResources.inboxKVNamespaceID`/`.inboxAccountID` (Task 1), `HTTPCloudflareClient.accountID(apiToken:)` (Task 4).
- Produces: `SocialWorkerProvisionCommand.provision(..., inboxCaptureEnabled: Bool = false, ...)` (new parameter, default `false` so every existing caller/test is unaffected), `SocialWorkerProvisionCommand.AccountIDSource` typealias + `defaultAccountIDSource`, both consumed by Task 6 (`DeployModel`).

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`, inside the `SocialWorkerProvisionCommandTests` struct (near the other resource-provisioning tests, e.g. after `provisionsR2ForMicropub` around line 173):

```swift
    @Test("inboxCaptureEnabled creates the INBOX_KV namespace, resolves the account id, and writes both into wrangler.toml")
    func provisionsInboxCapture() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["kv", "namespace", "create", "my-site-inbox", "--json"]: .init(stdout: #"{"result":{"id":"inbox-kv-id"}}"#, stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in "acct-1" }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            inboxCaptureEnabled: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == "inbox-kv-id")
        #expect(resources.inboxAccountID == "acct-1")
        #expect(await recorder.arguments == [
            ["kv", "namespace", "create", "my-site-inbox", "--json"],
        ])

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("main = \"worker/worker.ts\""))
        #expect(toml.contains("id = \"inbox-kv-id\""))
    }

    @Test("inboxCaptureEnabled false never invokes wrangler kv namespace create")
    func inboxCaptureDisabledNeverCreatesNamespace() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in
                Issue.record("accountIDSource must not be called when inbox capture is disabled")
                return nil
            }
        )

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == nil)
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("a namespace id already known from settings is reused, not recreated")
    func inboxCaptureReusesKnownNamespace() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in
                Issue.record("accountIDSource must not be called when the namespace id is already known")
                return nil
            }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            knownResources: .init(inboxKVNamespaceID: "existing-ns", inboxAccountID: "existing-acct"),
            inboxCaptureEnabled: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == "existing-ns")
        #expect(resources.inboxAccountID == "existing-acct")
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("a KV creation failure for inbox capture is reported without corrupting resources")
    func inboxCapturePartialFailure() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["kv", "namespace", "create", "my-site-inbox", "--json"]: .init(stdout: "KV failed", stderr: "", exitCode: 1),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in "acct-1" }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            inboxCaptureEnabled: true
        )

        guard case .failed(let reason, let exitCode, let resources) = result else {
            Issue.record("expected failure, got \(result)")
            return
        }
        #expect(reason == "KV failed")
        #expect(exitCode == 1)
        #expect(resources.inboxKVNamespaceID == nil)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: FAIL to compile — `SocialWorkerProvisionCommand.init` has no `accountIDSource` parameter, `provision` has no `inboxCaptureEnabled` parameter.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`:

**3a. Add the `AccountIDSource` typealias**, right after the existing `TokenSource` typealias (line 51):

```swift
    /// Re-exported from ``DeployCommand`` so both commands share one token-resolution seam
    /// (Keychain in production, injected values in tests).
    public typealias TokenSource = DeployCommand.TokenSource
    /// Resolves the Cloudflare account id that owns a token — used only by inbox-capture
    /// provisioning (#764) to persist the id `InboxSubmissionSync` needs later. `nil` on any
    /// resolution failure (mirrors `MicropubContentSync`'s/`ReceivedInteractionSync`'s existing
    /// private `resolveAccountID` helpers, which return an optional rather than throwing — a
    /// missing account id here fails the *step* via a nil-check, not this closure itself).
    public typealias AccountIDSource = @Sendable (_ apiToken: String) async -> String?
```

**3b. Add the stored property and init parameter**, mirroring `workerScriptNamesSource` (currently lines 109 and 125):

```swift
    private let workerScriptNamesSource: DeployCommand.WorkerScriptNamesSource
    private let accountIDSource: AccountIDSource
```

```swift
        workerScriptNamesSource: @escaping DeployCommand.WorkerScriptNamesSource = DeployCommand.defaultWorkerScriptNames,
        /// Same seam shape as `workerScriptNamesSource`; only used by the inbox-capture block
        /// (#764) to persist the owning account id.
        accountIDSource: @escaping AccountIDSource = SocialWorkerProvisionCommand.defaultAccountIDSource
    ) {
        self.tokenSource = tokenSource
        self.runner = runner
        self.keyPairSource = keyPairSource
        self.solidOidcSigningKeySource = solidOidcSigningKeySource
        self.webdavPepperSource = webdavPepperSource
        self.secretRunner = secretRunner
        self.deployer = deployer
        self.workerScriptNamesSource = workerScriptNamesSource
        self.accountIDSource = accountIDSource
    }
```

(This replaces the current `init`'s closing `workerScriptNamesSource: @escaping ... = DeployCommand.defaultWorkerScriptNames` parameter line and body — add the new parameter and assignment, don't duplicate the existing ones.)

**3c. Add the `inboxCaptureEnabled` parameter to `provision(...)`**, after `wellKnownDynamicClaims` (currently the last parameter, line 178):

```swift
        wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim] = [],
        /// Whether inbox capture's `/inbox` route should be provisioned this run
        /// (`SiteSettings.inboxCaptureEnabled`, #764). `false` (the default) matches every
        /// existing caller's behavior unchanged — the KV namespace is created (or, if
        /// `knownResources`/a prior `wrangler.toml` already has one, reused) only when `true`.
        inboxCaptureEnabled: Bool = false
    ) async -> Result {
```

**3d. Add the new provisioning block**, after the existing solid-pod/webdav R2 block and before the ActivityPub block (i.e., insert after the closing `}` of the block ending at what's currently line 318, before `let hasActivityPub = ...` at line 320):

```swift
        if inboxCaptureEnabled, resources.inboxKVNamespaceID == nil {
            let name = "\(siteName)-inbox"
            let result = await runWrangler(
                siteDirectory: siteDirectory,
                arguments: ["kv", "namespace", "create", name, "--json"],
                environment: environment,
                source: source,
                resources: resources
            )
            let output: String
            switch result {
            case .success(let value):
                output = value
            case .failure(let failure):
                return failure
            }
            guard let id = Self.extractResourceID(from: output) else {
                return .failed(reason: "wrangler created KV namespace \(name) but no namespace id was found", exitCode: 0, resources: resources)
            }
            resources.inboxKVNamespaceID = id
            resources.inboxAccountID = await accountIDSource(token)
            if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName, inboxCaptureEnabled: inboxCaptureEnabled) {
                return failure
            }
        }

```

**3e. Add `inboxCaptureEnabled: Bool` to every `persistConfig` call.** There are two repeated literal shapes in the current file — use a find-and-replace-all for each (do not touch `persistConfig`'s own declaration, handled in 3f):

Shape 1 (appears 6 times, including the one you just added in 3d — the other 5 are pre-existing): find
```
persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName)
```
and replace every occurrence with:
```
persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName, inboxCaptureEnabled: inboxCaptureEnabled)
```
(Your Step 3d block already used the new 8-argument form directly — so this replace-all only needs to touch the 5 pre-existing 7-argument call sites at the D1 block, the KV(social) block, the R2(micropub) block, the solid-pod/webdav R2 block, and the pre-ActivityPub-secrets persist, plus the final unconditional one after the queue blocks. If your editor's replace-all also matches the string inside the block you just wrote in 3d, that's fine — it's idempotent, just confirm the end result has `inboxCaptureEnabled: inboxCaptureEnabled` exactly once per call, not duplicated.)

Shape 2 (appears 3 times — the webmention/websub/microsub queue blocks): find
```
            if let failure = persistConfig(
                siteDirectory: siteDirectory, siteName: siteName, workers: workers,
                routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName
            ) {
```
and replace every occurrence with:
```
            if let failure = persistConfig(
                siteDirectory: siteDirectory, siteName: siteName, workers: workers,
                routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName,
                inboxCaptureEnabled: inboxCaptureEnabled
            ) {
```

**3f. Update `persistConfig`'s own signature and its call into `generateWranglerToml`** (currently lines 534-556):

```swift
    private func persistConfig(
        siteDirectory: URL,
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim],
        resources: WorkerComposition.ProvisionedResources,
        siteURL: String? = nil,
        displayName: String? = nil,
        inboxCaptureEnabled: Bool = false
    ) -> Result? {
        do {
            let toml = try WorkerComposition.generateWranglerToml(
                siteName: siteName,
                workers: workers,
                routeClaims: routeClaims,
                resources: resources,
                inboxCaptureEnabled: inboxCaptureEnabled,
                inboxKVNamespaceID: resources.inboxKVNamespaceID,
                siteURL: siteURL,
                displayName: displayName
            )
```

(This removes the stale code comment that used to sit here — "Called without `inboxCaptureEnabled`/`inboxKVNamespaceID`..." — since the gap it was flagging is now closed. Delete that whole comment block.)

**3g. Add the default `AccountIDSource`**, alongside the other `default*` static lets (near `defaultWorkerScriptNames`'s usage pattern — add after `defaultDeployer`, before the closing brace of the actor, currently around line 734):

```swift
    /// Default ``AccountIDSource`` for production: the token's first visible Cloudflare account,
    /// via `HTTPCloudflareClient`. `nil` on any resolution failure.
    public static let defaultAccountIDSource: AccountIDSource = { apiToken in
        try? await HTTPCloudflareClient().accountID(apiToken: apiToken)
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: PASS — the 4 new tests, plus every pre-existing test in this file (unaffected, since `inboxCaptureEnabled` defaults to `false` and every existing test omits it).

Run: `swift test --package-path .`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift
git commit -m "feat(#764): provision INBOX_KV during social worker deploy"
```

---

### Task 6: Wire `DeployModel` to pass `inboxCaptureEnabled`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift:719-728`

**Interfaces:**
- Consumes: `SocialWorkerProvisionCommand.provision(..., inboxCaptureEnabled:)` (Task 5), `SiteSettings.inboxCaptureEnabled` (Task 1).

This task has no new test — it's a one-argument passthrough at an existing call site, exercised indirectly by every existing `DeployModel`/`SocialWorkerProvisionCommand` test (they all pass `inboxCaptureEnabled: false` implicitly via `settings.inboxCaptureEnabled ?? false` when the field is unset, matching current behavior exactly). Verify by full-suite build/test instead.

- [ ] **Step 1: Locate the call site and make the change**

In `Sources/AnglesiteApp/DeployModel.swift`, find:

```swift
        let acknowledgesPaidPlan = settings.webmentionReceivePaidPlanAcknowledged ?? false
        let provisionResult = await socialCommand.provision(
            siteID: siteID,
            siteDirectory: siteDirectory,
            siteName: workerSiteName,
            workers: workers,
            routeClaims: routeClaims.map(\.claim),
            knownResources: settings.provisionedWorkerResources ?? .init(),
            siteURL: siteURL,
            displayName: settings.displayName,
            acknowledgesPaidPlan: acknowledgesPaidPlan
        )
```

Replace with:

```swift
        let acknowledgesPaidPlan = settings.webmentionReceivePaidPlanAcknowledged ?? false
        let provisionResult = await socialCommand.provision(
            siteID: siteID,
            siteDirectory: siteDirectory,
            siteName: workerSiteName,
            workers: workers,
            routeClaims: routeClaims.map(\.claim),
            knownResources: settings.provisionedWorkerResources ?? .init(),
            siteURL: siteURL,
            displayName: settings.displayName,
            acknowledgesPaidPlan: acknowledgesPaidPlan,
            inboxCaptureEnabled: settings.inboxCaptureEnabled ?? false
        )
```

- [ ] **Step 2: Build and run the full suite**

Run: `swift test --package-path .`
Expected: PASS — no `DeployModel`/`DeployModelTests` behavior changes for any test that leaves `SiteSettings.inboxCaptureEnabled` unset (the overwhelming majority), since `false` is passed either way.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift
git commit -m "feat(#764): thread inboxCaptureEnabled into deploy provisioning"
```

---

### Task 7: `PlistEditorModel.setInboxCaptureEnabled` — the Settings toggle action

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift`
- Test (new file): `Tests/AnglesiteAppTests/PlistEditorModelInboxCaptureTests.swift`

**Interfaces:**
- Consumes: `CloudflareCapabilityProber` (Task 3), `SiteConfigStore`/`SiteSettings.inboxCaptureEnabled` (Task 1), the model's existing private `cloudflareToken() async throws -> String?` helper.
- Produces: `PlistEditorModel.setInboxCaptureEnabled(_ enabled: Bool) async`, `PlistEditorModel.inboxCaptureEnabled: Bool`, `PlistEditorModel.inboxCaptureNamespaceID: String?`, `PlistEditorModel.inboxCaptureError: String?` — all consumed by Task 8's view.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/PlistEditorModelInboxCaptureTests.swift`, modeled directly on `Tests/AnglesiteAppTests/PlistEditorModelWorkersTests.swift`'s fixture pattern:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel Inbox Capture toggle (#764)")
@MainActor
struct PlistEditorModelInboxCaptureTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private struct Fixture {
        let model: PlistEditorModel
        let configDirectory: URL
        let keychainService: String
    }

    private func makeFixture(
        settings: SiteSettings? = nil,
        token: String? = "test-token",
        proberTransport: @escaping CloudflareTransport = { _ in
            (Data(#"{"success":true,"result":[]}"#.utf8), HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelInboxCaptureTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let settings {
            try await SiteConfigStore(configDirectory: configDir).save(settings)
        }
        let keychainService = "io.dwk.anglesite.test-\(UUID().uuidString)"
        let keychain = KeychainStore(service: keychainService)
        if let token {
            try keychain.writeCloudflareToken(token)
        }
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            keychain: keychain,
            capabilityProber: CloudflareCapabilityProber(transport: proberTransport)
        )
        return Fixture(model: model, configDirectory: configDir, keychainService: keychainService)
    }

    @Test("turning on with a KV-capable token persists inboxCaptureEnabled")
    func turnOnWithCapableToken() async throws {
        let fixture = try await makeFixture(proberTransport: { request in
            let url = request.url!.absoluteString
            let body = url.contains("storage/kv/namespaces")
                ? #"{"success":true,"result":[]}"#
                : #"{"success":true,"result":[{"id":"acc1"}]}"#
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == true)
        #expect(fixture.model.inboxCaptureError == nil)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == true)
    }

    @Test("turning on with a KV-incapable token surfaces a friendly error and does not persist")
    func turnOnWithIncapableToken() async throws {
        let fixture = try await makeFixture(proberTransport: { request in
            let url = request.url!.absoluteString
            let (status, body): (Int, String) = url.contains("storage/kv/namespaces")
                ? (403, #"{"success":false}"#)
                : (200, #"{"success":true,"result":[{"id":"acc1"}]}"#)
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == false)
        #expect(fixture.model.inboxCaptureError != nil)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == nil)
    }

    @Test("turning off persists false and leaves provisionedWorkerResources untouched")
    func turnOff() async throws {
        let fixture = try await makeFixture(
            settings: SiteSettings(
                provisionedWorkerResources: .init(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1"),
                inboxCaptureEnabled: true
            ))
        await fixture.model.loadWorkers()

        await fixture.model.setInboxCaptureEnabled(false)

        #expect(fixture.model.inboxCaptureEnabled == false)
        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.inboxCaptureEnabled == false)
        #expect(saved.provisionedWorkerResources?.inboxKVNamespaceID == "ns-1")
        #expect(saved.provisionedWorkerResources?.inboxAccountID == "acct-1")
    }

    @Test("without a token, leaves the toggle off with an error and makes no capability-probe call")
    func turnOnWithoutToken() async throws {
        let fixture = try await makeFixture(token: nil, proberTransport: { _ in
            Issue.record("capability prober must not be called without a token")
            struct Unexpected: Error {}
            throw Unexpected()
        })

        await fixture.model.setInboxCaptureEnabled(true)

        #expect(fixture.model.inboxCaptureEnabled == false)
        #expect(fixture.model.inboxCaptureError != nil)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter PlistEditorModelInboxCaptureTests`
Expected: FAIL to compile — `PlistEditorModel.init` has no `capabilityProber` parameter, and `setInboxCaptureEnabled`/`inboxCaptureEnabled`/`inboxCaptureError` don't exist.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteApp/PlistEditorModel.swift`:

**3a. Add stored properties**, in the "Workers tab" section, after `workersError`/`isLoadingWorkers` (currently lines 122-123):

```swift
    private(set) var workersError: String?
    private(set) var isLoadingWorkers = false
    private(set) var inboxCaptureEnabled = false
    private(set) var inboxCaptureNamespaceID: String?
    private(set) var inboxCaptureError: String?
```

**3b. Add the `capabilityProber` dependency**, alongside `keychain` (a new stored property + init param):

```swift
    private let keychain: KeychainStore
    private let capabilityProber: CloudflareCapabilityProber
```

In `init(...)`, add a new parameter after `keychain: KeychainStore = KeychainStore(),` (line 174):

```swift
         keychain: KeychainStore = KeychainStore(),
         capabilityProber: CloudflareCapabilityProber = CloudflareCapabilityProber(),
```

and assign it in the body after `self.keychain = keychain` (line 196):

```swift
        self.keychain = keychain
        self.capabilityProber = capabilityProber
```

**3c. Populate `inboxCaptureEnabled`/`inboxCaptureNamespaceID` in `loadWorkers()`**, right after `workerSettings = settings` (currently line 879):

```swift
        workerSettings = settings
        inboxCaptureEnabled = settings.inboxCaptureEnabled ?? false
        inboxCaptureNamespaceID = settings.provisionedWorkerResources?.inboxKVNamespaceID
```

**3d. Add `setInboxCaptureEnabled(_:)`**, right after `setWorkerActive(_:isOn:)` (currently ending at line 927):

```swift
    /// Turning on does an instant local write plus a Cloudflare token-capability pre-check — no
    /// `wrangler` call happens here. Actual `INBOX_KV` namespace creation is deferred to the next
    /// deploy (`SocialWorkerProvisionCommand`'s new inbox block, #764) so this mirrors
    /// `setWorkerActive`'s "toggle now, provision later" contract exactly. Turning off never
    /// touches `provisionedWorkerResources` — the namespace and any staged submissions survive.
    func setInboxCaptureEnabled(_ enabled: Bool) async {
        guard let configDirectory else { return }
        let store = SiteConfigStore(configDirectory: configDirectory)
        guard enabled else {
            var settings = (try? await store.load()) ?? workerSettings
            settings.inboxCaptureEnabled = false
            try? await store.save(settings)
            workerSettings = settings
            inboxCaptureEnabled = false
            inboxCaptureError = nil
            return
        }
        let token: String?
        do {
            token = try await cloudflareToken()
        } catch {
            inboxCaptureError = String(localized: "Couldn't read your Cloudflare API token: \(error.localizedDescription)")
            return
        }
        guard let token, !token.isEmpty else {
            inboxCaptureError = String(localized: "Connect a Cloudflare API token first, in Settings → Advanced → Credentials.")
            return
        }
        let capabilities = await capabilityProber.probe(token: token, zoneID: nil)
        guard capabilities.contains(.kv) else {
            inboxCaptureError = String(localized: "Your Cloudflare token can't manage KV namespaces — recreate it from Settings → Tokens.")
            return
        }
        var settings = (try? await store.load()) ?? workerSettings
        settings.inboxCaptureEnabled = true
        do {
            try await store.save(settings)
        } catch {
            inboxCaptureError = String(localized: "Couldn't save the inbox capture setting: \(error.localizedDescription)")
            return
        }
        workerSettings = settings
        inboxCaptureEnabled = true
        inboxCaptureError = nil
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter PlistEditorModelInboxCaptureTests`
Expected: PASS (all 4 new tests)

Run: `swift test --package-path .`
Expected: full suite passes, including `PlistEditorModelWorkersTests` (unaffected — `capabilityProber` defaults to a real `CloudflareCapabilityProber()`, which its tests never trigger since they never call `setInboxCaptureEnabled`).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Tests/AnglesiteAppTests/PlistEditorModelInboxCaptureTests.swift
git commit -m "feat(#764): add PlistEditorModel.setInboxCaptureEnabled"
```

---

### Task 8: Settings UI — "Inbox Capture" section in the Workers tab

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift:664-704`

**Interfaces:**
- Consumes: `PlistEditorModel.inboxCaptureEnabled`, `.inboxCaptureNamespaceID`, `.inboxCaptureError`, `.setInboxCaptureEnabled(_:)` (Task 7).

No new automated test for this task — SwiftUI view bodies aren't unit-tested elsewhere in this file either (`workersTab` itself has no dedicated view-level test; its behavior is covered through the model tests in Task 7). Verify manually per Step 2 below, per this repo's documented CI limitation for hosted-app UI.

- [ ] **Step 1: Add the section**

In `Sources/AnglesiteApp/PlistEditorView.swift`, inside `workersTab` (currently lines 664-704), add a new `SettingsBox` after the existing `ForEach(model.workerGroups)` block and before the closing `.task { await model.loadWorkers() }`:

```swift
            ForEach(model.workerGroups) { group in
                // Group keys are manifest-owned free text (design doc §3) — display-cased,
                // never localized or enumerated here.
                SettingsBox(verbatimTitle: group.name.capitalized) {
                    workersGroupTable(group.rows)
                }
            }

            SettingsBox(title: "Inbox Capture") {
                inboxCaptureSection
            }
        }
        .task { await model.loadWorkers() }
    }

    private var inboxCaptureSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle("Inbox Capture", isOn: Binding(
                    get: { model.inboxCaptureEnabled },
                    set: { newValue in
                        Task { await model.setInboxCaptureEnabled(newValue) }
                    }))
                    .toggleStyle(.switch)
                    .labelsHidden()
                Text(inboxCaptureStatusText)
                    .foregroundStyle(.secondary)
            }
            if let inboxCaptureError = model.inboxCaptureError {
                Label(inboxCaptureError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }
        }
    }

    private var inboxCaptureStatusText: String {
        switch (model.inboxCaptureEnabled, model.inboxCaptureNamespaceID) {
        case (false, .none):
            return String(localized: "Not enabled.")
        case (true, .none):
            return String(localized: "Will activate on next deploy.")
        case (true, .some(let id)):
            return String(localized: "Active — namespace \(id).")
        case (false, .some):
            return String(localized: "Paused — submissions namespace kept, not receiving new ones.")
        }
    }
```

`SettingsBox(title: LocalizedStringKey, ...)` (`Sources/AnglesiteApp/SettingsBox.swift:9`) is the initializer to use here — distinct from the `verbatimTitle:` one the worker-group boxes above use for their manifest-owned free text; "Inbox Capture" is app copy, so it goes through the localized `title:` parameter.

- [ ] **Step 2: Build and manually verify**

Run: `swift test --package-path .`
Expected: full suite compiles and passes (this file's changes are pure SwiftUI view code with no new logic, covered indirectly by Task 7's model tests).

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED. Regenerate the Xcode project first if needed: `xcodegen generate`.

Manually open the app (`open Anglesite.xcodeproj`, ⌘B, run), open any site's Settings → Workers tab, confirm:
- The "Inbox Capture" box renders below the worker groups.
- With no Cloudflare token configured, toggling on shows the "Connect a Cloudflare API token first" error and the toggle stays off.
- With a token configured, toggling on shows "Will activate on next deploy." (or the capability error, if the token lacks KV permission).
- Toggling off returns to "Not enabled." (or "Paused…" if a namespace id was already known from a prior deploy).

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorView.swift
git commit -m "feat(#764): add Inbox Capture toggle to Workers settings tab"
```

---

## Final verification (after all 8 tasks)

- [ ] Run `swift test --package-path .` — full suite green.
- [ ] Run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` — BUILD SUCCEEDED.
- [ ] Re-read [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) ▸ "Commits and pull requests" before opening the PR — use `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan), and include `Closes #764`.
- [ ] Confirm the `🛠️ In Progress` label is already on issue #764 (it was added when this work started) — leave it in place.
