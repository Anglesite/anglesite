# Attaching a transferred custom domain during deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a site was created via the New Site wizard's "Transfer an existing domain" option, deploy actually attaches that domain as a Cloudflare Workers Custom Domain instead of silently leaving the site on its `*.workers.dev` fallback with no indication anything is missing.

**Architecture:** A new `CustomDomainAttachCommand` (AnglesiteCore) reads `.site-config` itself, calls a new `HTTPCloudflareClient.attachWorkersCustomDomain` API method, and persists success. `DeployCommand.deploy()` invokes it, best-effort, right after a successful `wrangler` step, and reports the outcome through a new `onDomainAttach` observer (mirroring the existing `onPreflight` pattern) without changing `DeployCommand.Result`. `DeployModel` captures that outcome, swaps the displayed deploy URL to the custom domain once attached, and surfaces the two non-happy-path outcomes (not yet connected / claimed by another Worker) in the UI.

**Tech Stack:** Swift 6.4, Swift Testing (`@Test`/`#expect`), SwiftUI, Cloudflare API v4.

## Global Constraints

- Every Cloudflare API call goes through the existing `CloudflareTransport`-injected `HTTPCloudflareClient` — no new networking library, no direct `URLSession` calls outside that type.
- Never turn an already-successful deploy into a failed one because of anything domain-attach-related (best-effort, matching `DeployCommand.persistWorkerDeployed`/`uploadSourceBundleIfConfigured`'s existing contract).
- Never silently repoint a Custom Domain that's already attached to a *different* Worker script.
- Only the "Transfer an existing domain" path (`DOMAIN_CHOICE=transfer`) is in scope. "Buy a domain" and "Set this up later" are unaffected.
- Commit subject lines ≤72 characters, conventional-commit format, referencing #1077 per this repo's `CONTRIBUTING.md`.
- Run `swift test --package-path .` and `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` before considering the plan done (see Task 6).

---

### Task 1: `attachWorkersCustomDomain` on the Cloudflare API client

**Files:**
- Modify: `Sources/AnglesiteCore/CloudflareWriting.swift`
- Modify: `Sources/AnglesiteCore/HTTPCloudflareClient.swift`
- Modify: `Tests/AnglesiteCoreTests/HardenExecutorTests.swift` (the `MockCloudflareWriter` conforms to `CloudflareWriting` — a new protocol requirement breaks its build until it's updated)
- Test: `Tests/AnglesiteCoreTests/CloudflareClientTests.swift`

**Interfaces:**
- Produces: `public enum CustomDomainAttachResult: Sendable, Equatable { case attached, alreadyAttached, zoneNotFound, conflict(ownedBy: String) }` (in `CloudflareWriting.swift`)
- Produces: `CloudflareWriting.attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult`
- Consumes: existing `HTTPCloudflareClient.resolveZoneID(domain:apiToken:)`, existing private `get`/`mutate` helpers.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/CloudflareClientTests.swift` (append at the end of the file):

```swift
@Test("attachWorkersCustomDomain returns .zoneNotFound when the domain has no zone on this account")
func attachCustomDomainZoneNotFound() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[]}"#),
    ]
    let client = HTTPCloudflareClient(transport: fakeTransport(routes))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .zoneNotFound)
}

@Test("attachWorkersCustomDomain creates a fresh attachment when none exists yet")
func attachCustomDomainCreatesFresh() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .attached)
    let putRequest = spy.requests.first { $0.httpMethod == "PUT" }
    #expect(putRequest != nil)
    #expect(putRequest?.url?.absoluteString.contains("/accounts/acct1/workers/domains") == true)
}

@Test("attachWorkersCustomDomain returns .alreadyAttached without writing when this site's own Worker already owns it")
func attachCustomDomainAlreadyAttached() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"dom1","service":"my-site"}]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .alreadyAttached)
    #expect(spy.requests.contains { $0.httpMethod == "PUT" } == false)
}

@Test("attachWorkersCustomDomain returns .conflict without writing when a different Worker owns it")
func attachCustomDomainConflict() async throws {
    let routes: [String: (Int, String)] = [
        "/zones?": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"zone1","name":"example.com","status":"active"}]}"#),
        "/accounts?per_page=1": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct1"}]}"#),
        "/workers/domains?hostname=": (200, #"{"success":true,"errors":[],"messages":[],"result":[{"id":"dom1","service":"other-site"}]}"#),
    ]
    let spy = TransportSpy()
    let client = HTTPCloudflareClient(transport: spyTransport(routes, spy: spy))
    let result = try await client.attachWorkersCustomDomain(
        hostname: "example.com", workerScriptName: "my-site", apiToken: "t")
    #expect(result == .conflict(ownedBy: "other-site"))
    #expect(spy.requests.contains { $0.httpMethod == "PUT" } == false)
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter CloudflareClientTests 2>&1 | tail -40`
Expected: a compile error — `attachWorkersCustomDomain` and `CustomDomainAttachResult` don't exist yet.

- [ ] **Step 3: Add `CustomDomainAttachResult` and the protocol requirement**

In `Sources/AnglesiteCore/CloudflareWriting.swift`, add after the `enableOnionRouting` requirement (inside the `CloudflareWriting` protocol, before its closing `}`):

```swift
    /// Attaches `hostname` to `workerScriptName` as a Workers Custom Domain (#1077). Idempotent:
    /// an existing attachment to the same script is a no-op; an existing attachment to a
    /// *different* script is reported as `.conflict` rather than silently overwritten.
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult
```

Then, after the `WAFRulePayload` struct at the bottom of the same file, add:

```swift
/// Outcome of attempting to attach a Workers Custom Domain (#1077).
public enum CustomDomainAttachResult: Sendable, Equatable {
    /// No existing attachment for this hostname — created fresh.
    case attached
    /// Already attached to the given Worker script — no write performed.
    case alreadyAttached
    /// The domain isn't on this Cloudflare account yet (nameservers not delegated elsewhere).
    case zoneNotFound
    /// Already attached to a *different* Worker script — never silently repointed.
    case conflict(ownedBy: String)
}
```

- [ ] **Step 4: Implement `attachWorkersCustomDomain` on `HTTPCloudflareClient`**

In `Sources/AnglesiteCore/HTTPCloudflareClient.swift`, add a new private struct near the other private response structs (right after `private struct CFWorkerScript: Decodable, Sendable { let id: String }`, around line 60):

```swift
private struct CFWorkerDomain: Decodable, Sendable { let service: String }
```

Then, inside `extension HTTPCloudflareClient: CloudflareWriting { ... }`, add a new method after `enableOnionRouting` (the last method in that extension):

```swift
    public func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        // Zone lookup first (cheap, account-agnostic) so the common "not delegated to Cloudflare
        // yet" case short-circuits without an extra account-id round trip.
        guard let zoneID = try await resolveZoneID(domain: hostname, apiToken: apiToken) else {
            return .zoneNotFound
        }
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        let escapedHostname = hostname.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? hostname
        let existing = try await get(
            "/accounts/\(accountID)/workers/domains?hostname=\(escapedHostname)",
            apiToken: apiToken, as: [CFWorkerDomain].self
        )
        if let match = existing.first {
            return match.service == workerScriptName ? .alreadyAttached : .conflict(ownedBy: match.service)
        }
        struct AttachBody: Encodable, Sendable {
            let zone_id: String
            let hostname: String
            let service: String
            let environment: String
        }
        try await mutate(
            method: "PUT", "/accounts/\(accountID)/workers/domains",
            body: AttachBody(zone_id: zoneID, hostname: hostname, service: workerScriptName, environment: "production"),
            apiToken: apiToken
        )
        return .attached
    }
```

- [ ] **Step 5: Update `MockCloudflareWriter` so the test target still compiles**

In `Tests/AnglesiteCoreTests/HardenExecutorTests.swift`, add to `final class MockCloudflareWriter: CloudflareWriting, @unchecked Sendable` (after its `enableOnionRouting` method, before the class's closing `}`):

```swift
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        try record("attachWorkersCustomDomain:\(hostname)")
        return .attached
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareClientTests 2>&1 | tail -40`
Expected: all 4 new tests PASS, plus the pre-existing `CloudflareClientTests` cases still pass.

Run: `swift test --package-path . --filter HardenExecutorTests 2>&1 | tail -20`
Expected: PASS (confirms `MockCloudflareWriter` still conforms).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareWriting.swift Sources/AnglesiteCore/HTTPCloudflareClient.swift Tests/AnglesiteCoreTests/HardenExecutorTests.swift Tests/AnglesiteCoreTests/CloudflareClientTests.swift
git commit -m "feat(#1077): add attachWorkersCustomDomain to the Cloudflare client"
```

---

### Task 2: `CustomDomainAttachCommand`

**Files:**
- Create: `Sources/AnglesiteCore/CustomDomainAttachCommand.swift`
- Test: `Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift`

**Interfaces:**
- Consumes: `CloudflareWriting.attachWorkersCustomDomain` (Task 1), `SiteConfigFile.value(forKey:in:)`/`.upsert(_:into:)`, `WebsiteAnalyticsAsset.configRelativePath`, `NewSiteDomainChoice.transfer.rawValue`.
- Produces: `public actor CustomDomainAttachCommand { public enum Result: Sendable, Equatable { case skipped, confirmed(hostname: String), notConnected(hostname: String), conflict(hostname: String, ownedBy: String) }; public init(client: any CloudflareWriting = HTTPCloudflareClient()); public func attach(siteDirectory: URL, apiToken: String) async -> Result }` — this `Result` type and `init(client:)` are what Task 3 (`DeployCommand`) and Task 4 (`DeployModel` tests) construct directly.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

/// A `CloudflareWriting` fake whose `attachWorkersCustomDomain` result is controlled per test.
/// Not `private` — reused by `DeployCommandTests` (Task 3) in the same test target.
final class FakeCloudflareWriting: CloudflareWriting, @unchecked Sendable {
    var result: Swift.Result<CustomDomainAttachResult, Error> = .success(.attached)
    private(set) var calls: [(hostname: String, workerScriptName: String)] = []

    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        calls.append((hostname, workerScriptName))
        return try result.get()
    }

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {}
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
}

struct CustomDomainAttachCommandTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir(config: String) throws -> URL {
        let dir = tmpDir.appendingPathComponent("domain-attach-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try config.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return dir
    }

    @Test("skips when DOMAIN_CHOICE is not transfer")
    func skipsWhenNotTransfer() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=later\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips when DOMAIN is empty")
    func skipsWhenDomainEmpty() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips when already attached")
    func skipsWhenAlreadyPersisted() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\nCF_DOMAIN_ATTACHED=true\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips without calling out when CF_PROJECT_NAME is missing")
    func skipsWhenNoProjectName() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("confirms and persists CF_DOMAIN_ATTACHED on a fresh attach")
    func confirmsFreshAttach() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.attached)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .confirmed(hostname: "example.com"))
        #expect(writer.calls.first?.hostname == "example.com")
        #expect(writer.calls.first?.workerScriptName == "my-site")
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=true"))
    }

    @Test("confirms and persists when already attached to this site's own Worker")
    func confirmsAlreadyOwnAttachment() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.alreadyAttached)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .confirmed(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=true"))
    }

    @Test("reports not connected with no persistence when the zone isn't found yet")
    func notConnectedNoPersistence() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.zoneNotFound)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .notConnected(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(!config.contains("CF_DOMAIN_ATTACHED"))
    }

    @Test("reports conflict with no persistence when claimed by a different Worker")
    func conflictNoPersistence() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.conflict(ownedBy: "other-site"))
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .conflict(hostname: "example.com", ownedBy: "other-site"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(!config.contains("CF_DOMAIN_ATTACHED"))
    }

    @Test("a Cloudflare API failure degrades to notConnected rather than throwing")
    func apiFailureDegradesGracefully() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .failure(CloudflareError.malformedResponse)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .notConnected(hostname: "example.com"))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter CustomDomainAttachCommandTests 2>&1 | tail -40`
Expected: compile error — `CustomDomainAttachCommand` doesn't exist yet.

- [ ] **Step 3: Implement `CustomDomainAttachCommand`**

Create `Sources/AnglesiteCore/CustomDomainAttachCommand.swift`:

```swift
import Foundation

/// Attaches a "Transfer an existing domain" site's configured domain as a Workers Custom Domain
/// once its zone is live on the connected Cloudflare account (#1077). Runs from `DeployCommand`
/// right after a successful `wrangler deploy` — best-effort, never turns a successful deploy into
/// a failed one.
public actor CustomDomainAttachCommand {
    public enum Result: Sendable, Equatable {
        /// No transfer domain configured, or it's already confirmed attached — nothing to do.
        case skipped
        /// Freshly attached, or already attached to this site's own Worker script.
        case confirmed(hostname: String)
        /// The domain isn't on this Cloudflare account yet (nameservers not delegated elsewhere).
        /// Retried automatically on the next deploy — nothing is persisted for this outcome.
        case notConnected(hostname: String)
        /// Already attached to a *different* Worker script. Never silently repointed.
        case conflict(hostname: String, ownedBy: String)
    }

    private let client: any CloudflareWriting

    public init(client: any CloudflareWriting = HTTPCloudflareClient()) {
        self.client = client
    }

    /// Reads `.site-config` itself (`DOMAIN_CHOICE`, `DOMAIN`, `CF_PROJECT_NAME`,
    /// `CF_DOMAIN_ATTACHED`) — callers only need to supply the site directory and a live token.
    public func attach(siteDirectory: URL, apiToken: String) async -> Result {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""

        guard SiteConfigFile.value(forKey: "DOMAIN_CHOICE", in: config) == NewSiteDomainChoice.transfer.rawValue,
              let hostname = SiteConfigFile.value(forKey: "DOMAIN", in: config)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !hostname.isEmpty
        else { return .skipped }

        guard SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) != "true" else { return .skipped }

        guard let workerScriptName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) else {
            return .skipped
        }

        let outcome: CustomDomainAttachResult
        do {
            outcome = try await client.attachWorkersCustomDomain(
                hostname: hostname, workerScriptName: workerScriptName, apiToken: apiToken)
        } catch {
            // Best-effort: a Cloudflare API failure here must never turn an already-successful
            // deploy into a failed one. Folded into the same "nothing to report loudly, retried
            // for free on the next deploy" bucket as a genuine not-yet-delegated zone.
            return .notConnected(hostname: hostname)
        }

        switch outcome {
        case .attached, .alreadyAttached:
            persistAttached(siteDirectory: siteDirectory)
            return .confirmed(hostname: hostname)
        case .zoneNotFound:
            return .notConnected(hostname: hostname)
        case .conflict(let ownedBy):
            return .conflict(hostname: hostname, ownedBy: ownedBy)
        }
    }

    private func persistAttached(siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) != "true" else { return }
        let updated = SiteConfigFile.upsert([("CF_DOMAIN_ATTACHED", "true")], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter CustomDomainAttachCommandTests 2>&1 | tail -60`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CustomDomainAttachCommand.swift Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift
git commit -m "feat(#1077): add CustomDomainAttachCommand"
```

---

### Task 3: Wire the attach command into `DeployCommand`

**Files:**
- Modify: `Sources/AnglesiteCore/DeployCommand.swift`
- Test: `Tests/AnglesiteCoreTests/DeployCommandTests.swift`

**Interfaces:**
- Consumes: `CustomDomainAttachCommand` and its `Result` type (Task 2), `FakeCloudflareWriting` (Task 2's test file, same target).
- Produces: `public nonisolated let customDomainAttachCommand: CustomDomainAttachCommand` on `DeployCommand`; `public typealias DomainAttachObserver = @Sendable (CustomDomainAttachCommand.Result) -> Void`; a new `onDomainAttach: DomainAttachObserver? = nil` parameter on `DeployCommand.deploy(...)`. Task 4 (`DeployModel`) consumes both the property (to forward into a container-path `DeployCommand`) and the parameter (to observe the outcome).

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/DeployCommandTests.swift` (append near the existing "Bundle-upload orchestration" section — search for `// MARK: Bundle-upload orchestration (#799)` and add a new `// MARK: Domain-attach orchestration (#1077)` section after it):

```swift
    // MARK: Domain-attach orchestration (#1077)

    @Test("a successful deploy reports .skipped via onDomainAttach when no transfer domain is configured")
    func successfulDeployReportsSkippedWithoutTransferDomain() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(observed == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("a successful deploy reports .confirmed via onDomainAttach and persists CF_DOMAIN_ATTACHED")
    func successfulDeployReportsConfirmedDomainAttach() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        writer.result = .success(.attached)
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(observed == .confirmed(hostname: "example.com"))
        let config = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=true"))
    }

    @Test("a domain-attach outcome of .notConnected doesn't block the deploy from succeeding")
    func domainNotConnectedDoesNotBlockDeploy() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        writer.result = .success(.zoneNotFound)
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded even when the domain isn't connected yet, got \(result)")
            return
        }
        #expect(observed == .notConnected(hostname: "example.com"))
    }
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter DeployCommandTests 2>&1 | tail -40`
Expected: compile error — `DeployCommand.init` has no `customDomainAttachCommand` parameter and `deploy(...)` has no `onDomainAttach` parameter yet.

- [ ] **Step 3: Wire `CustomDomainAttachCommand` into `DeployCommand`**

In `Sources/AnglesiteCore/DeployCommand.swift`:

1. Add a new typealias right after `PreflightObserver`'s declaration (near line 69, after the `PreflightObserver` doc comment and declaration, before `WorkerScriptNamesSource`):

```swift
    /// Fires once the domain-attach step resolves (#1077), for a "Transfer an existing domain"
    /// site — or immediately with `.skipped` for every other site. Runs only after a successful
    /// `wrangler` step; never fires on a failed/blocked deploy.
    public typealias DomainAttachObserver = @Sendable (CustomDomainAttachCommand.Result) -> Void
```

2. Add a new stored property right after `public nonisolated let workerScriptNamesSource: WorkerScriptNamesSource` (near line 82):

```swift
    /// Exposed like `tokenSource`/`workerScriptNamesSource` so `DeployModel.runDeploy` can forward
    /// the exact same seam into a container-path `DeployCommand` it constructs on the fly (#1077).
    public nonisolated let customDomainAttachCommand: CustomDomainAttachCommand
```

3. Update `init` (near line 85) to accept and store it:

```swift
    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        workerScriptNamesSource: @escaping WorkerScriptNamesSource = DeployCommand.defaultWorkerScriptNames,
        customDomainAttachCommand: CustomDomainAttachCommand = CustomDomainAttachCommand(),
        executor: any DeployExecutor = HostDeployExecutor()
    ) {
        self.tokenSource = tokenSource
        self.workerScriptNamesSource = workerScriptNamesSource
        self.customDomainAttachCommand = customDomainAttachCommand
        self.executor = executor
    }
```

4. Add the new `onDomainAttach` parameter to `deploy(...)`'s signature (near line 115), right after `onPreflight: PreflightObserver? = nil,`:

```swift
        onPreflight: PreflightObserver? = nil,
        onDomainAttach: DomainAttachObserver? = nil,
        onProgress: ProgressHandler? = nil
```

5. In the `if code == 0 { if let url = ... { ... } }` block (near line 314-328), call the command right after `Self.persistWorkerDeployed(siteDirectory: siteDirectory)` and before the `uploadSourceBundleIfConfigured` block:

```swift
                if let url = Self.extractDeployedURL(from: wranglerResult.output) {
                    if let configDirectory {
                        try? DeployedRoutesSnapshot.save(currentRoutes, to: configDirectory)
                    }
                    Self.persistSiteURL(url, siteDirectory: siteDirectory)
                    Self.persistWorkerDeployed(siteDirectory: siteDirectory)
                    let domainAttachOutcome = await customDomainAttachCommand.attach(
                        siteDirectory: siteDirectory, apiToken: token)
                    onDomainAttach?(domainAttachOutcome)
                    if let configDirectory {
                        await Self.uploadSourceBundleIfConfigured(
                            siteDirectory: siteDirectory, configDirectory: configDirectory,
                            environment: wranglerEnvironment, executor: executor, siteID: siteID
                        )
                    }
                    return .succeeded(url: url, duration: duration)
                }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter DeployCommandTests 2>&1 | tail -60`
Expected: all 3 new tests PASS, plus every pre-existing `DeployCommandTests`/`DeployCommandProgressTests` case still passes.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DeployCommand.swift Tests/AnglesiteCoreTests/DeployCommandTests.swift
git commit -m "feat(#1077): invoke CustomDomainAttachCommand after a successful deploy"
```

---

### Task 4: Wire the outcome into `DeployModel`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift`
- Test: `Tests/AnglesiteAppTests/DeployModelTests.swift`

**Interfaces:**
- Consumes: `DeployCommand.customDomainAttachCommand`, `DeployCommand.DomainAttachObserver`, `CustomDomainAttachCommand.Result` (Task 3), `DeployCoordinator.resolveSiteURL(siteDirectory:)` (already exists).
- Produces: `DeployModel.domainAttachStatus: CustomDomainAttachCommand.Result?`, `DeployModel.domainConflictPresented: Bool`, `DeployModel.dismissDomainConflict()`. Task 5 (UI) consumes all three.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteAppTests/DeployModelTests.swift`. First, add a test-local fake near the top of the file, right after the existing `GatedDeployExecutor` (`private actor GatedDeployExecutor: DeployExecutor { ... }`):

```swift
private final class FakeDomainAttachWriter: CloudflareWriting, @unchecked Sendable {
    let outcome: CustomDomainAttachResult
    init(outcome: CustomDomainAttachResult) { self.outcome = outcome }

    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult { outcome }

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {}
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
}
```

Then add these tests inside `struct DeployModelTests` (e.g. right after `renameToAlsoTakenNameLoopsBackToConflict`):

```swift
    @Test("A confirmed domain attach swaps the succeeded phase's URL to the custom domain")
    func confirmedDomainAttachSwapsDisplayedURL() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let writer = FakeDomainAttachWriter(outcome: .attached)
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.absoluteString == "https://example.com")
        #expect(model.domainAttachStatus == .confirmed(hostname: "example.com"))
        #expect(!model.domainConflictPresented)
    }

    @Test("A not-connected domain attach leaves the workers.dev URL in place")
    func notConnectedDomainAttachLeavesWorkersDevURL() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let writer = FakeDomainAttachWriter(outcome: .zoneNotFound)
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.host == "test.example.workers.dev")
        #expect(model.domainAttachStatus == .notConnected(hostname: "example.com"))
        #expect(!model.domainConflictPresented)
    }

    @Test("A domain-attach conflict presents the conflict sheet without blocking the succeeded deploy")
    func domainConflictPresentsSheet() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let writer = FakeDomainAttachWriter(outcome: .conflict(ownedBy: "other-site"))
        let command = DeployCommand(
            tokenSource: { "test-token" }, executor: executor,
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer)
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded even on a domain conflict, got \(model.phase)"); return
        }
        #expect(model.domainAttachStatus == .conflict(hostname: "example.com", ownedBy: "other-site"))
        #expect(model.domainConflictPresented)

        model.dismissDomainConflict()
        #expect(!model.domainConflictPresented)
    }

    @Test("No transfer domain configured reports .skipped and leaves the workers.dev URL")
    func noTransferDomainSkips() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.host == "test.example.workers.dev")
        #expect(model.domainAttachStatus == .skipped)
    }
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter DeployModelTests 2>&1 | tail -40`
Expected: compile error — `DeployModel` has no `domainAttachStatus`/`domainConflictPresented`/`dismissDomainConflict()` yet.

- [ ] **Step 3: Wire `domainAttachStatus` and the conflict sheet flag into `DeployModel`**

In `Sources/AnglesiteApp/DeployModel.swift`:

1. Add a new published property right after `sourceBundleStatus`'s declaration (near line 50):

```swift
    /// Outcome of attempting to attach this site's configured "Transfer an existing domain" host
    /// as a Workers Custom Domain (#1077), captured from the deploy's `onDomainAttach` observer.
    /// `nil` before any deploy has completed this session; only ever set on a `.succeeded` deploy.
    private(set) var domainAttachStatus: CustomDomainAttachCommand.Result?
```

2. Add a new presentation flag right after `webmentionPaidPlanConfirmationPresented`'s declaration (near line 75):

```swift
    /// Bound to a `.sheet` in `SiteWindow` for a `.conflict` domain-attach outcome (#1077) — the
    /// transfer domain is already attached to a *different* Worker. Dismiss-only; doesn't block
    /// the drawer or further deploys, since wrangler already succeeded by the time this runs.
    var domainConflictPresented: Bool = false
```

3. Add a dismiss method. Find `func cancelWorkerNameConflictPrompt()` (or the nearest existing dismiss-style method) and add right after it:

```swift
    /// Dismisses the domain-conflict sheet (#1077). The deploy already succeeded — this only
    /// clears the informational sheet, it doesn't retry or change anything.
    func dismissDomainConflict() {
        domainConflictPresented = false
    }
```

4. Reset the flag at the top of `runDeploy`, right after `blockedPresented = false` (near line 461):

```swift
        drawerPresented = presentation == .foreground
        blockedPresented = false
        domainConflictPresented = false
```

5. Forward `customDomainAttachCommand` when building the container-path `activeCommand` (near line 487-495):

```swift
        if let cc = containerControl {
            activeCommand = DeployCommand(
                tokenSource: command.tokenSource,
                workerScriptNamesSource: command.workerScriptNamesSource,
                customDomainAttachCommand: command.customDomainAttachCommand,
                executor: ContainerDeployExecutor(
                    control: cc.control,
                    siteID: cc.siteID,
                    logCenter: logCenter
                )
            )
```

6. Wire the `onDomainAttach` observer into the `deployer` closure's call to `activeCommand.deploy(...)` (near line 571-590), right after the existing `onPreflight` closure:

```swift
                onPreflight: { [weak self] outcome in
                    Task { @MainActor in self?.onScanComplete?(outcome) }
                },
                onDomainAttach: { [weak self] outcome in
                    Task { @MainActor in self?.domainAttachStatus = outcome }
                },
```

7. In the `.succeeded` case of the final result switch (near line 662-700), swap the displayed URL and present the conflict sheet, right before the existing `transition(siteID: siteID, to: .succeeded(url: url, duration: duration))` call:

```swift
            if let settings = try? await SiteConfigStore(configDirectory: configDirectory).load() {
                sourceBundleStatus = await SourceBundleStatus.check(siteDirectory: siteDirectory, settings: settings)
            }
            // #1077: once the custom domain is actually attached, the deployed workers.dev URL is
            // no longer the "real" address — swap what the drawer shows/shares/opens to the domain
            // instead. `resolveSiteURL` already prefers `.site-config`'s DOMAIN unconditionally
            // (it's written at scaffold time regardless of attach status), so this must stay gated
            // on `domainAttachStatus == .confirmed` — otherwise a not-yet-connected domain would be
            // presented as if it were already live.
            var displayURL = url
            if case .confirmed = domainAttachStatus,
               let customHost = DeployCoordinator.resolveSiteURL(siteDirectory: siteDirectory),
               let customURL = URL(string: customHost) {
                displayURL = customURL
            }
            if case .conflict = domainAttachStatus {
                domainConflictPresented = presentation == .foreground
            }
            transition(siteID: siteID, to: .succeeded(url: displayURL, duration: duration))
```

(Remove the old `transition(siteID: siteID, to: .succeeded(url: url, duration: duration))` line it replaces.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter DeployModelTests 2>&1 | tail -80`
Expected: all 4 new tests PASS, plus every pre-existing `DeployModelTests` case still passes (the worker-name-conflict and rename tests in particular, since `activeCommand`'s construction changed).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift Tests/AnglesiteAppTests/DeployModelTests.swift
git commit -m "feat(#1077): surface domain-attach outcome in DeployModel"
```

---

### Task 5: UI — not-connected caption and conflict sheet

**Files:**
- Modify: `Sources/AnglesiteApp/DeployDrawerView.swift`
- Create: `Sources/AnglesiteApp/DomainConflictSheetView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift`

**Interfaces:**
- Consumes: `DeployModel.domainAttachStatus`, `DeployModel.domainConflictPresented`, `DeployModel.dismissDomainConflict()` (Task 4).

No dedicated unit test for this task — this repo has no existing test coverage for its sibling sheet views (`WorkerNameConflictSheetView` has none either); Task 4's `DeployModelTests` already prove the state this UI reads is correct, and Task 6's manual QA checklist covers the visual result.

- [ ] **Step 1: Add the not-connected caption to `DeployDrawerView`**

In `Sources/AnglesiteApp/DeployDrawerView.swift`, find the existing `sourceBundleStatus` caption block inside `header`:

```swift
                if case .succeeded = model.phase, case .dirty = model.sourceBundleStatus {
                    Text("Code changes not yet deployed to the CMS bundle.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
```

Add a new block right after it, still inside the same `VStack(alignment: .leading, spacing: 1) { ... }`:

```swift
                if case .succeeded = model.phase, case .notConnected(let hostname) = model.domainAttachStatus {
                    Text("\(hostname) isn't connected yet — add it to Cloudflare and point its nameservers there, then redeploy.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
```

- [ ] **Step 2: Create `DomainConflictSheetView`**

Create `Sources/AnglesiteApp/DomainConflictSheetView.swift`:

```swift
import SwiftUI

/// Sheet shown when a "Transfer an existing domain" site's configured host is already attached
/// as a Workers Custom Domain to a *different* Worker script (#1077) — informs, doesn't
/// remediate in-app (resolving a cross-Worker domain conflict needs the Cloudflare dashboard).
/// Doesn't block the deploy drawer: wrangler already succeeded on its workers.dev address by the
/// time this check runs.
struct DomainConflictSheetView: View {
    let hostname: String
    let ownedBy: String
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Custom domain already in use")
                    .font(.headline)
                Text("“\(hostname)” is already connected to another site (\(ownedBy)). This deploy succeeded at its workers.dev address, but won't use \(hostname) until that's resolved in your Cloudflare dashboard.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("OK") { onDismiss() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

#Preview {
    DomainConflictSheetView(hostname: "example.com", ownedBy: "other-site", onDismiss: {})
}
```

- [ ] **Step 3: Wire the sheet in `SiteWindow`**

In `Sources/AnglesiteApp/SiteWindow.swift`, find the existing `workerNameConflictPresented` sheet:

```swift
        .sheet(isPresented: $bindableModel.deploy.workerNameConflictPresented) {
            if case .workerNameConflict(let name) = model.deploy.phase {
                WorkerNameConflictSheetView(model: model.deploy, takenName: name) {
                    model.deploy.cancelWorkerNameConflictPrompt()
                }
            }
        }
```

Add a new sheet right after it:

```swift
        .sheet(isPresented: $bindableModel.deploy.domainConflictPresented) {
            if case .conflict(let hostname, let ownedBy) = model.deploy.domainAttachStatus {
                DomainConflictSheetView(hostname: hostname, ownedBy: ownedBy) {
                    model.deploy.dismissDomainConflict()
                }
            }
        }
```

- [ ] **Step 4: Build to verify it compiles**

Run: `swift build --package-path . 2>&1 | tail -40`
Expected: BUILD SUCCESS (SwiftUI view code isn't covered by SwiftPM tests, but the whole package — including `AnglesiteAppCore`, which contains these files — must still compile clean).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DeployDrawerView.swift Sources/AnglesiteApp/DomainConflictSheetView.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1077): show not-connected caption and domain-conflict sheet"
```

---

### Task 6: Full verification and manual QA

**Files:** none (verification only).

- [ ] **Step 1: Run the full SwiftPM test suite**

Run: `swift test --package-path . 2>&1 | tail -80`
Expected: all suites PASS, including `AnglesiteCoreTests` and `AnglesiteAppTests` (which now include every test added in Tasks 1–4).

- [ ] **Step 2: Regenerate the Xcode project and build the app target**

Run:
```bash
xcodegen generate
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60
```
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Manual QA checklist (hosted-app-only per this repo's CI limitations for `DeployModel` — see `CONTRIBUTING.md`)**

Run the app (`open Anglesite.xcodeproj`, ⌘R) against a real Cloudflare account and confirm, for a site created via File ▸ New Site ▸ "Transfer an existing domain":

- [ ] A domain whose zone is already on the connected Cloudflare account: deploy attaches it — the drawer's header, Copy URL, and Open-in-browser all show the custom domain, not workers.dev.
- [ ] A domain not yet delegated to Cloudflare: deploy still succeeds on workers.dev, and the drawer shows the "isn't connected yet" caption. Delegate it, redeploy, and confirm it becomes `.confirmed` (previous bullet) with no other action needed.
- [ ] A hostname pre-attached (via the Cloudflare dashboard) to a throwaway Worker: deploy succeeds on workers.dev and the domain-conflict sheet appears; dismissing it doesn't affect anything else in the drawer.

- [ ] **Step 4: Update the issue**

Run:
```bash
gh issue edit 1077 --remove-label "🛠️ In Progress"
```
(Only after a PR referencing #1077 is open — the PR itself becomes the up-to-date signal per this repo's `CLAUDE.md`.)
