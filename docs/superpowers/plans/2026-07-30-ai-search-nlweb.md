# AI Search / NLWeb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site owner provision a Cloudflare AI Search instance for their site directly from the app, with a crawler-policy preflight check, an at-cost/model disclosure, an automatic WAF skip rule when Bot Fight Mode is on, and a handoff to the Cloudflare dashboard for the still-preview, still-manual NLWeb enablement step.

**Architecture:** A self-contained feature — not a new `IntegrationCatalog` descriptor (that model is pure local file/config templating with no live-API primitive; see "Global Constraints"). `AnglesiteCore` gets a small new provisioning protocol plus an `AISearchExecutor` orchestration type. `AnglesiteAppCore` (target name for `Sources/AnglesiteApp/`) gets a `@MainActor @Observable AISearchModel` + `AISearchSheetView`, wired into `SiteWindowModel`/`SiteWindow`/`WebsiteCommands` the same way `HardenModel`/`HardenSheetView` already are.

**Tech Stack:** Swift 6.4, SwiftUI, Swift Testing (`@Test`/`#expect`, not XCTest), the existing `CloudflareReading`/`CloudflareWriting` protocols and `HTTPCloudflareClient`.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-04-cloudflare-free-services-integration-design.md` §12 ("Slice 8"). Tracked as GitHub issue #691 (already labeled `🛠️ In Progress`).
- **Not a catalog descriptor.** `IntegrationDescriptor`/`Operation` (`Sources/AnglesiteCore/IntegrationDescriptor.swift`) has six operation cases, all local file/config writes — no live-network-call primitive, no precedent for a blocking pre-check or multi-step provisioning. Do not add an `aiSearch` case to `IntegrationID` or a descriptor to `IntegrationCatalog.swift`.
- **Do not modify `HardenPlanner.plan(from:domain:)`'s signature.** It takes only `state`/`domain` today with no per-feature extension point. The WAF skip rule this feature needs is a direct, self-contained `CloudflareWriting.createWAFCustomRule` call in `AISearchExecutor`, independent of the Harden plan/execute pipeline.
- **Do not add capability-gating/persistence machinery.** `CloudflareCapabilityProber`/`TokenCapabilities` have zero consumers anywhere in the codebase today — no slice has built the "missing capability → upgrade prompt" UI this would need. Follow the existing app-wide pattern instead: attempt the call, surface a friendly message on a 401/403 `CloudflareError`.
- **`AIUsage.aiInput`/`.aiTrain`/`.search` are `"yes" | "no" | "unset"`** (`UsagePermission` in `Sources/AnglesiteCore/LicensingStore.swift`), never "allow"/"deny". `LicensingStore.load()` returns an empty/default `LicensingPolicy()` (not a throw) when `Source/src/data/licensing.json` doesn't exist yet — a missing file is not an error case to special-case.
- **No crawler-policy write-back.** `AIUsage` has no per-crawler allow-list, only blanket `search`/`aiInput`/`aiTrain` + a `blockAICrawlers` bool. `Cloudflare-AI-Search` was never in the `aiCrawlers` blocklist (`Resources/Template/scripts/edge-artifacts.ts`), so passing the preflight check requires no policy write at all.
- **No App Intent for v1** — matches Harden, which has none either (confirmed: no file in `Sources/AnglesiteIntents/` references "harden").
- **Preview-API risk:** the AI Search instance-creation request/response schema (Task 2) is Cloudflare's public-preview API as of 2026-07-30 (verified against `https://developers.cloudflare.com/api/resources/ai_search/subresources/namespaces/subresources/instances/methods/create/`). Re-verify field names against that page before merging Task 2 — preview APIs move. **Correction (2026-07-30, caught by Task 2's task review):** the request body must include a top-level `source` field (a sibling of `type`/`source_params`) set to the site's URL — Cloudflare's docs list `source: optional string` with no description, but context (paired with `type: "web-crawler"`) strongly implies it's the crawl target; the first draft of this task's code omitted it entirely, which would have created an instance with nothing to crawl. Fixed to `source: "https://\(domain)"` in Task 2's `CreateBody`.
- Run `swift test --package-path .` after each task. Run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` after Task 6 (the only task touching `Sources/AnglesiteApp/SiteWindow.swift`/`WebsiteCommands.swift`, which are Xcode-target-only files excluded from the SwiftPM `AnglesiteAppCore` target).
- Commit after each task, using `feat(#691): <summary>` (≤72 chars) per `CONTRIBUTING.md`.

---

## Task 1: `WAFRulePayload` gains `action_parameters`

**Files:**
- Modify: `Sources/AnglesiteCore/CloudflareWriting.swift:49-59` (`WAFRulePayload`)
- Test: `Tests/AnglesiteCoreTests/CloudflareWritingTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WAFRulePayload.init(description:expression:action:actionParameters:)` — `actionParameters` defaults to `nil`, so every existing 3-argument call site (`HardenExecutor.swift`, `HardenPlanner.swift`'s curated rules) keeps compiling unchanged. `WAFRulePayload.ActionParameters(products: [String])` encodes as JSON `{"products": [...]}`.

A Cloudflare "skip" WAF rule needs `action_parameters.products` to say which product(s) it skips (e.g. `["botFight"]`) — a bare `action: "skip"` skips nothing on its own. `WAFRulePayload` today has no way to express that.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/CloudflareWritingTests.swift` (inside `struct CloudflareWritingTests`, near the existing `createWAFCustomRule` test):

```swift
@Test("createWAFCustomRule encodes action_parameters.products when provided")
func createWAFCustomRuleWithActionParameters() async throws {
    let spy = TransportSpy()
    let rulesetJSON = """
    {"success":true,"errors":[],"messages":[],"result":[{"id":"rs1","phase":"http_request_firewall_custom"}]}
    """
    let client = HTTPCloudflareClient(transport: spyTransport(["/rulesets": (200, rulesetJSON)], spy: spy))
    let rule = WAFRulePayload(
        description: "Allow AI Search crawler", expression: "(x)", action: "skip",
        actionParameters: .init(products: ["botFight"]))
    try await client.createWAFCustomRule(zoneID: zoneID, rule: rule, apiToken: token)
    let postReqs = spy.requests.filter { $0.httpMethod == "POST" }
    let body = try #require(postReqs.last?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
    let rules = try #require(body["rules"] as? [[String: Any]])
    let actionParams = try #require(rules.first?["action_parameters"] as? [String: Any])
    #expect(actionParams["products"] as? [String] == ["botFight"])
}

@Test("WAFRulePayload omits action_parameters from encoded JSON when nil")
func wafRulePayloadOmitsNilActionParameters() throws {
    let rule = WAFRulePayload(description: "Block dotfiles", expression: "(x)", action: "block")
    let data = try JSONEncoder().encode(rule)
    let obj = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(obj["action_parameters"] == nil)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareWritingTests`
Expected: FAIL — `WAFRulePayload` has no `actionParameters` parameter, compile error.

- [ ] **Step 3: Implement**

Replace the `WAFRulePayload` struct in `Sources/AnglesiteCore/CloudflareWriting.swift:49-59`:

```swift
/// Payload for creating a custom WAF rule via the Cloudflare API.
public struct WAFRulePayload: Sendable, Equatable, Encodable {
    public let description: String
    public let expression: String
    public let action: String
    public let actionParameters: ActionParameters?

    /// Says which product(s) an `action: "skip"` rule skips — Cloudflare requires this for a skip
    /// rule to do anything; a bare `action: "skip"` with no parameters skips nothing.
    public struct ActionParameters: Sendable, Equatable, Encodable {
        public let products: [String]

        public init(products: [String]) {
            self.products = products
        }
    }

    private enum CodingKeys: String, CodingKey {
        case description, expression, action
        case actionParameters = "action_parameters"
    }

    public init(description: String, expression: String, action: String, actionParameters: ActionParameters? = nil) {
        self.description = description
        self.expression = expression
        self.action = action
        self.actionParameters = actionParameters
    }
}
```

Check `Sources/AnglesiteCore/HTTPCloudflareClient.swift`'s `createWAFCustomRule` — confirm it encodes `rule` as-is inside the `rules` array (it does, via `mutate`/a request body wrapping `[rule]`); no change needed there since `Encodable` conformance handles the new field automatically. If the existing implementation encodes fields manually instead of encoding `rule` directly, extend that manual encoding to include `action_parameters` when non-nil.

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareWritingTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareWriting.swift Tests/AnglesiteCoreTests/CloudflareWritingTests.swift
git commit -m "feat(#691): add action_parameters to WAFRulePayload"
```

---

## Task 2: `AISearchProvisioning` protocol + `HTTPCloudflareClient` conformance

**Files:**
- Create: `Sources/AnglesiteCore/AISearchProvisioning.swift`
- Modify: `Sources/AnglesiteCore/HTTPCloudflareClient.swift` (add `postEnvelope` helper + `AISearchProvisioning` conformance)
- Test: `Tests/AnglesiteCoreTests/HTTPCloudflareClientAISearchTests.swift`

**Interfaces:**
- Consumes: `CloudflareTransport`, `CloudflareError` (both already in `HTTPCloudflareClient.swift`/`CloudflareReading.swift`).
- Produces: `AISearchInstance { let id: String; let name: String }`, `protocol AISearchProvisioning: Sendable { func createAISearchInstance(domain: String, instanceID: String, apiToken: String) async throws -> AISearchInstance }`. `HTTPCloudflareClient` conforms to it. Task 3 consumes both.

This is a **new, separate protocol**, not an addition to `CloudflareWriting` — `CloudflareWriting` has 5 conformers across the test suite (`Tests/AnglesiteAppTests/OnionRoutingModelTests.swift`, `Tests/AnglesiteAppTests/DeployModelTests.swift`, `Tests/AnglesiteCoreTests/DomainOperationsServiceTests.swift`, `Tests/AnglesiteCoreTests/HardenExecutorTests.swift`, `Tests/AnglesiteCoreTests/CustomDomainAttachCommandTests.swift`); adding a required method there breaks all five. A narrow, purpose-specific protocol avoids that blast radius entirely.

The existing `mutate<Body>` helper in `HTTPCloudflareClient.swift` discards the response body (decodes into `CFEmpty`) — every current write call is fire-and-forget. This is the first call that needs the created resource back, so it needs a new helper.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/HTTPCloudflareClientAISearchTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct HTTPCloudflareClientAISearchTests {
    @Test("createAISearchInstance resolves the account then POSTs to the namespace instances endpoint")
    func createsInstance() async throws {
        let spy = TransportSpy()
        let accountsJSON = #"{"success":true,"errors":[],"result":[{"id":"acct1"}]}"#
        let createJSON = #"{"success":true,"errors":[],"result":{"id":"inst1","name":"example-com"}}"#
        let client = HTTPCloudflareClient(transport: spyTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/ai-search/namespaces/example-com/instances": (200, createJSON),
        ], spy: spy))

        let instance = try await client.createAISearchInstance(
            domain: "example.com", instanceID: "example-com", apiToken: "test-token")

        #expect(instance.id == "inst1")
        #expect(instance.name == "example-com")
        let postReq = try #require(spy.requests.first { $0.httpMethod == "POST" })
        #expect(postReq.url?.path.contains("/accounts/acct1/ai-search/namespaces/example-com/instances") == true)
        let body = try #require(postReq.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body["id"] as? String == "example-com")
        #expect(body["type"] as? String == "web-crawler")
        #expect(body["source"] as? String == "https://example.com")
    }

    @Test("createAISearchInstance surfaces .unauthorized on a 403")
    func createInstanceUnauthorized() async throws {
        let accountsJSON = #"{"success":true,"errors":[],"result":[{"id":"acct1"}]}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/ai-search/namespaces": (403, #"{"success":false,"errors":[{"message":"missing scope"}]}"#),
        ]))
        await #expect(throws: CloudflareError.unauthorized) {
            try await client.createAISearchInstance(domain: "example.com", instanceID: "example-com", apiToken: "t")
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter HTTPCloudflareClientAISearchTests`
Expected: FAIL — `createAISearchInstance` doesn't exist yet, compile error.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/AISearchProvisioning.swift`:

```swift
import Foundation

/// A provisioned Cloudflare AI Search instance.
public struct AISearchInstance: Sendable, Equatable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// Provisions Cloudflare AI Search instances. Kept separate from `CloudflareWriting` — that
/// protocol has five conformers across the test suite, and this is the only feature that needs
/// this call.
public protocol AISearchProvisioning: Sendable {
    /// Creates an AI Search instance backed by a website crawler for `domain`, resolving the
    /// caller's Cloudflare account internally (mirrors `attachWorkersCustomDomain`'s pattern).
    func createAISearchInstance(domain: String, instanceID: String, apiToken: String) async throws -> AISearchInstance
}
```

Add to `Sources/AnglesiteCore/HTTPCloudflareClient.swift`, a new private helper alongside `mutate` (around line 310, after `mutate`'s closing brace — `postEnvelope` must live in this file because it uses `Self.base` and `transport`, both `private`):

```swift
/// Like `mutate`, but decodes and returns the response body instead of discarding it —
/// `mutate`'s `CFEnvelope<CFEmpty>` can't express a caller that needs the created resource back.
private func postEnvelope<Body: Encodable & Sendable, T: Decodable & Sendable>(
    _ path: String, body: Body, apiToken: String, as type: T.Type
) async throws -> CFEnvelope<T> {
    guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    let (data, http) = try await transport(request)
    if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
    guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
    do {
        return try JSONDecoder().decode(CFEnvelope<T>.self, from: data)
    } catch {
        throw CloudflareError.malformedResponse
    }
}
```

Add a new extension at the end of `Sources/AnglesiteCore/HTTPCloudflareClient.swift`:

```swift
extension HTTPCloudflareClient: AISearchProvisioning {
    public func createAISearchInstance(
        domain: String, instanceID: String, apiToken: String
    ) async throws -> AISearchInstance {
        struct CFAccount: Decodable, Sendable { let id: String }
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }

        struct CreateBody: Encodable, Sendable {
            let id: String
            let type: String
            let source: String
            let source_params: SourceParams
            struct SourceParams: Encodable, Sendable {
                let web_crawler: WebCrawler
                struct WebCrawler: Encodable, Sendable {
                    let parse_type: String
                }
            }
        }
        struct CFAISearchInstance: Decodable, Sendable {
            let id: String
            let name: String?
        }
        let body = CreateBody(
            id: instanceID, type: "web-crawler", source: "https://\(domain)",
            source_params: .init(web_crawler: .init(parse_type: "sitemap")))
        let env = try await postEnvelope(
            "/accounts/\(accountID)/ai-search/namespaces/\(instanceID)/instances",
            body: body, apiToken: apiToken, as: CFAISearchInstance.self)
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "AI Search instance creation returned no result")
        }
        return AISearchInstance(id: result.id, name: result.name ?? instanceID)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter HTTPCloudflareClientAISearchTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AISearchProvisioning.swift Sources/AnglesiteCore/HTTPCloudflareClient.swift Tests/AnglesiteCoreTests/HTTPCloudflareClientAISearchTests.swift
git commit -m "feat(#691): add AI Search instance provisioning to HTTPCloudflareClient"
```

---

## Task 3: `AISearchExecutor` orchestration

**Files:**
- Create: `Sources/AnglesiteCore/AISearchExecutor.swift`
- Test: `Tests/AnglesiteCoreTests/AISearchExecutorTests.swift`

**Interfaces:**
- Consumes: `CloudflareReading.zoneState(zoneID:domain:apiToken:)`, `CloudflareWriting.createWAFCustomRule(zoneID:rule:apiToken:)` (both existing), `AISearchProvisioning.createAISearchInstance` (Task 2), `LicensingPolicy`/`AIUsage`/`UsagePermission` (existing, `Sources/AnglesiteCore/LicensingStore.swift`).
- Produces: `AISearchExecutor.init(reader:writer:provisioner:)`, `AISearchExecutor.policyBlockReason(for: LicensingPolicy) -> String?` (static, pure), `AISearchExecutor.provision(zoneID: String, domain: String, apiToken: String) async throws -> AISearchExecutor.ProvisionedResult`. Task 4 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/AISearchExecutorTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

private final class StubProvisioner: AISearchProvisioning, @unchecked Sendable {
    private(set) var lastDomain: String?
    private(set) var lastInstanceID: String?
    var errorToThrow: CloudflareError?

    func createAISearchInstance(domain: String, instanceID: String, apiToken: String) async throws -> AISearchInstance {
        if let errorToThrow { throw errorToThrow }
        lastDomain = domain
        lastInstanceID = instanceID
        return AISearchInstance(id: "inst1", name: instanceID)
    }
}

private final class StubReader: CloudflareReading, @unchecked Sendable {
    private let state: CloudflareZoneState
    init(state: CloudflareZoneState) { self.state = state }
    func resolveZoneID(domain: String, apiToken: String) async throws -> String? { "z1" }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState { state }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] { [] }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

private final class StubWriter: CloudflareWriting, @unchecked Sendable {
    private(set) var createdRules: [WAFRulePayload] = []
    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {}
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws { createdRules.append(rule) }
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult { .attached }
}

private func zoneState(botFightMode: Bool) -> CloudflareZoneState {
    CloudflareZoneState(
        dnssecActive: true, sslMode: "strict", alwaysUseHTTPS: true, hsts: nil,
        caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [], botFightMode: botFightMode)
}

struct AISearchExecutorTests {
    @Test("policyBlockReason is nil when aiInput is unset")
    func policyAllowsUnset() {
        #expect(AISearchExecutor.policyBlockReason(for: LicensingPolicy()) == nil)
    }

    @Test("policyBlockReason is nil when aiInput is yes")
    func policyAllowsYes() {
        var policy = LicensingPolicy()
        policy.usage.aiInput = .yes
        #expect(AISearchExecutor.policyBlockReason(for: policy) == nil)
    }

    @Test("policyBlockReason is non-nil when aiInput is no")
    func policyBlocksNo() {
        var policy = LicensingPolicy()
        policy.usage.aiInput = .no
        #expect(AISearchExecutor.policyBlockReason(for: policy) != nil)
    }

    @Test("provision adds a WAF skip rule when Bot Fight Mode is on")
    func provisionAddsWAFRuleWhenBotFightModeOn() async throws {
        let writer = StubWriter()
        let executor = AISearchExecutor(reader: StubReader(state: zoneState(botFightMode: true)), writer: writer, provisioner: StubProvisioner())
        let result = try await executor.provision(zoneID: "z1", domain: "Example.com", apiToken: "t")
        #expect(result.wafSkipRuleAdded == true)
        #expect(writer.createdRules.count == 1)
        #expect(writer.createdRules.first?.action == "skip")
        #expect(writer.createdRules.first?.actionParameters?.products == ["botFight"])
    }

    @Test("provision skips the WAF rule when Bot Fight Mode is off")
    func provisionSkipsWAFRuleWhenBotFightModeOff() async throws {
        let writer = StubWriter()
        let executor = AISearchExecutor(reader: StubReader(state: zoneState(botFightMode: false)), writer: writer, provisioner: StubProvisioner())
        let result = try await executor.provision(zoneID: "z1", domain: "example.com", apiToken: "t")
        #expect(result.wafSkipRuleAdded == false)
        #expect(writer.createdRules.isEmpty)
    }

    @Test("provision derives the instance namespace from the lowercased, dot-free domain")
    func provisionDerivesNamespace() async throws {
        let provisioner = StubProvisioner()
        let executor = AISearchExecutor(reader: StubReader(state: zoneState(botFightMode: false)), writer: StubWriter(), provisioner: provisioner)
        _ = try await executor.provision(zoneID: "z1", domain: "Example.com", apiToken: "t")
        #expect(provisioner.lastInstanceID == "example-com")
    }

    @Test("provision surfaces the provisioner's thrown error")
    func provisionPropagatesProvisionerError() async throws {
        let provisioner = StubProvisioner()
        provisioner.errorToThrow = .unauthorized
        let executor = AISearchExecutor(reader: StubReader(state: zoneState(botFightMode: false)), writer: StubWriter(), provisioner: provisioner)
        await #expect(throws: CloudflareError.unauthorized) {
            try await executor.provision(zoneID: "z1", domain: "example.com", apiToken: "t")
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter AISearchExecutorTests`
Expected: FAIL — `AISearchExecutor` doesn't exist yet, compile error.

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/AISearchExecutor.swift`:

```swift
import Foundation

/// Orchestrates provisioning a Cloudflare AI Search instance for a site: a policy preflight
/// (pure, callable before any network I/O), then provisioning plus a conditional WAF skip rule.
/// Deliberately standalone rather than routed through `HardenPlanner`/`HardenExecutor` — see
/// this plan's Global Constraints.
public struct AISearchExecutor: Sendable {
    public struct ProvisionedResult: Sendable, Equatable {
        public let instance: AISearchInstance
        public let wafSkipRuleAdded: Bool
        public let dashboardURL: URL
    }

    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let provisioner: any AISearchProvisioning

    public init(reader: any CloudflareReading, writer: any CloudflareWriting, provisioner: any AISearchProvisioning) {
        self.reader = reader
        self.writer = writer
        self.provisioner = provisioner
    }

    /// `nil` when the site's AI usage policy doesn't object; a user-facing explanation otherwise.
    public static func policyBlockReason(for policy: LicensingPolicy) -> String? {
        guard policy.usage.aiInput == .no else { return nil }
        return "This site's AI usage policy currently says no to AI input. Update it in Content Licensing settings before enabling AI Search."
    }

    public func provision(zoneID: String, domain: String, apiToken: String) async throws -> ProvisionedResult {
        let namespace = Self.namespaceID(for: domain)
        let instance = try await provisioner.createAISearchInstance(domain: domain, instanceID: namespace, apiToken: apiToken)

        let state = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: apiToken)
        var wafAdded = false
        if state.botFightMode {
            try await writer.createWAFCustomRule(
                zoneID: zoneID,
                rule: WAFRulePayload(
                    description: "Anglesite: allow Cloudflare AI Search crawler",
                    expression: #"(http.user_agent contains "Cloudflare-AI-Search")"#,
                    action: "skip",
                    actionParameters: .init(products: ["botFight"])),
                apiToken: apiToken)
            wafAdded = true
        }

        // Best-effort deep link — Cloudflare's dashboard URL scheme for an AI Search instance's
        // Settings page; re-verify at implementation time since this is a preview product.
        let dashboardURL = URL(string: "https://dash.cloudflare.com/?to=/:account/ai-search/\(namespace)/settings")!
        return ProvisionedResult(instance: instance, wafSkipRuleAdded: wafAdded, dashboardURL: dashboardURL)
    }

    static func namespaceID(for domain: String) -> String {
        domain.lowercased().replacingOccurrences(of: ".", with: "-")
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter AISearchExecutorTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AISearchExecutor.swift Tests/AnglesiteCoreTests/AISearchExecutorTests.swift
git commit -m "feat(#691): add AISearchExecutor orchestration"
```

---

## Task 4: `AISearchModel` (`AnglesiteAppCore`)

**Files:**
- Create: `Sources/AnglesiteApp/AISearchModel.swift`
- Test: `Tests/AnglesiteAppTests/AISearchModelTests.swift`

**Interfaces:**
- Consumes: `AISearchExecutor`, `AISearchExecutor.policyBlockReason(for:)`, `AISearchExecutor.ProvisionedResult` (Task 3); `LicensingStore`, `LicensingPolicy` (existing); `CloudflareReading`/`CloudflareWriting`/`AISearchProvisioning`/`CloudflareError`/`KeychainStore`/`HTTPCloudflareClient` (existing).
- Produces: `AISearchModel.Phase` (`.idle`, `.resolvingZone`, `.blockedByPolicy`, `.awaitingCostConfirmation`, `.provisioning`, `.succeeded`, `.failed`), `AISearchModel.init(reader:writer:provisioner:keychain:)`, `.phase`, `.sheetPresented`, `.domainInput`, `.isRunning`, `.openSheet()`, `.checkPolicyAndResolveZone(sourceDirectory: URL)`, `.confirmCost()`, `.dismissSheet()`. Task 5 (view) and Task 6 (wiring) consume all of these.

This mirrors `HardenModel` (`Sources/AnglesiteApp/HardenModel.swift`) exactly — same `@MainActor @Observable` shape, same `apiToken()`/`cloudflareErrorMessage(_:)` helpers, same `inFlight: Task<Void, Never>?` cancellation pattern.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/AISearchModelTests.swift`:

```swift
import Foundation
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

private final class StubReader: CloudflareReading, @unchecked Sendable {
    private let zoneID: String?
    private let state: CloudflareZoneState
    init(zoneID: String? = "z1", state: CloudflareZoneState = StubReader.defaultState) {
        self.zoneID = zoneID
        self.state = state
    }
    static let defaultState = CloudflareZoneState(
        dnssecActive: false, sslMode: "flexible", alwaysUseHTTPS: false, hsts: nil,
        caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [])
    func resolveZoneID(domain: String, apiToken: String) async throws -> String? { zoneID }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState { state }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] { [] }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

private final class StubWriter: CloudflareWriting, @unchecked Sendable {
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
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult { .attached }
}

private final class StubProvisioner: AISearchProvisioning, @unchecked Sendable {
    func createAISearchInstance(domain: String, instanceID: String, apiToken: String) async throws -> AISearchInstance {
        AISearchInstance(id: "inst1", name: instanceID)
    }
}

@Suite(.serialized)
struct AISearchModelTests {
    init() {
        setenv("CLOUDFLARE_API_TOKEN", "test-token", 1)
    }

    private func tempSourceDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @MainActor
    @Test("checkPolicyAndResolveZone ignores blank domain input")
    func ignoresBlankDomain() throws {
        let model = AISearchModel(reader: StubReader(), writer: StubWriter(), provisioner: StubProvisioner())
        model.domainInput = "   "
        model.checkPolicyAndResolveZone(sourceDirectory: try tempSourceDirectory())
        #expect(model.phase == .idle)
    }

    @MainActor
    @Test("checkPolicyAndResolveZone reaches awaitingCostConfirmation when no licensing.json exists")
    func noPolicyFilePassesThrough() async throws {
        let model = AISearchModel(reader: StubReader(zoneID: "z1"), writer: StubWriter(), provisioner: StubProvisioner())
        model.domainInput = "Example.com"
        model.checkPolicyAndResolveZone(sourceDirectory: try tempSourceDirectory())
        while model.isRunning { await Task.yield() }
        #expect(model.phase == .awaitingCostConfirmation(domain: "example.com", zoneID: "z1"))
    }

    @MainActor
    @Test("checkPolicyAndResolveZone blocks when licensing.json says aiInput = no")
    func policyBlocks() async throws {
        let dir = try tempSourceDirectory()
        var policy = LicensingPolicy()
        policy.usage.aiInput = .no
        try LicensingStore(sourceDirectory: dir).save(policy)

        let model = AISearchModel(reader: StubReader(), writer: StubWriter(), provisioner: StubProvisioner())
        model.domainInput = "example.com"
        model.checkPolicyAndResolveZone(sourceDirectory: dir)
        while model.isRunning { await Task.yield() }

        guard case .blockedByPolicy = model.phase else {
            Issue.record("expected .blockedByPolicy, got \(model.phase)")
            return
        }
    }

    @MainActor
    @Test("confirmCost provisions and reaches succeeded")
    func confirmCostProvisions() async throws {
        let model = AISearchModel(reader: StubReader(zoneID: "z1"), writer: StubWriter(), provisioner: StubProvisioner())
        model.domainInput = "example.com"
        model.checkPolicyAndResolveZone(sourceDirectory: try tempSourceDirectory())
        while model.isRunning { await Task.yield() }

        model.confirmCost()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let result) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)")
            return
        }
        #expect(result.instance.id == "inst1")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter AISearchModelTests`
Expected: FAIL — `AISearchModel` doesn't exist yet, compile error.

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteApp/AISearchModel.swift`:

```swift
import SwiftUI
import AnglesiteCore

@MainActor
@Observable
final class AISearchModel {
    enum Phase: Equatable {
        case idle
        case resolvingZone(domain: String)
        case blockedByPolicy(reason: String)
        case awaitingCostConfirmation(domain: String, zoneID: String)
        case provisioning(domain: String)
        case succeeded(AISearchExecutor.ProvisionedResult)
        case failed(reason: String)
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false
    var domainInput: String = ""

    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let provisioner: any AISearchProvisioning
    private let keychain: KeychainStore
    private var inFlight: Task<Void, Never>?

    init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        provisioner: any AISearchProvisioning = HTTPCloudflareClient(),
        keychain: KeychainStore = KeychainStore()
    ) {
        self.reader = reader
        self.writer = writer
        self.provisioner = provisioner
        self.keychain = keychain
    }

    var isRunning: Bool {
        switch phase {
        case .resolvingZone, .provisioning: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        domainInput = ""
        sheetPresented = true
    }

    func checkPolicyAndResolveZone(sourceDirectory: URL) {
        let domain = domainInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !domain.isEmpty, !isRunning else { return }

        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runCheckPolicyAndResolveZone(domain: domain, sourceDirectory: sourceDirectory)
        }
    }

    func confirmCost() {
        guard case .awaitingCostConfirmation(let domain, let zoneID) = phase else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runProvision(domain: domain, zoneID: zoneID)
        }
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
        phase = .idle
    }

    // MARK: - Private

    private func apiToken() -> String? {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        return try? keychain.readCloudflareToken()
    }

    private func runCheckPolicyAndResolveZone(domain: String, sourceDirectory: URL) async {
        guard let token = apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found. Add one in Settings → Credentials.")
            return
        }
        phase = .resolvingZone(domain: domain)

        let policy: LicensingPolicy
        do {
            policy = try LicensingStore(sourceDirectory: sourceDirectory).load()
        } catch {
            phase = .failed(reason: "Couldn't read this site's AI usage policy: \(error.localizedDescription)")
            return
        }
        if let reason = AISearchExecutor.policyBlockReason(for: policy) {
            phase = .blockedByPolicy(reason: reason)
            return
        }

        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                phase = .failed(reason: "Zone not found for \"\(domain)\". Check the domain and ensure your API token has Zone Read permission.")
                return
            }
            phase = .awaitingCostConfirmation(domain: domain, zoneID: zoneID)
        } catch let error as CloudflareError {
            phase = .failed(reason: cloudflareErrorMessage(error))
        } catch {
            phase = .failed(reason: "Failed to resolve zone: \(error.localizedDescription)")
        }
    }

    private func runProvision(domain: String, zoneID: String) async {
        guard let token = apiToken() else {
            phase = .failed(reason: "No Cloudflare API token found.")
            return
        }
        phase = .provisioning(domain: domain)

        let executor = AISearchExecutor(reader: reader, writer: writer, provisioner: provisioner)
        do {
            let result = try await executor.provision(zoneID: zoneID, domain: domain, apiToken: token)
            phase = .succeeded(result)
        } catch let error as CloudflareError {
            phase = .failed(reason: cloudflareErrorMessage(error))
        } catch {
            phase = .failed(reason: "Failed to provision AI Search: \(error.localizedDescription)")
        }
    }

    private func cloudflareErrorMessage(_ error: CloudflareError) -> String {
        switch error {
        case .unauthorized:
            return "API token is unauthorized. Check that it has AI Search Edit permission for this account."
        case .http(let status):
            return "Cloudflare API returned HTTP \(status)."
        case .api(let message):
            return "Cloudflare API error: \(message)"
        case .malformedResponse:
            return "Unexpected response from Cloudflare API."
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter AISearchModelTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/AISearchModel.swift Tests/AnglesiteAppTests/AISearchModelTests.swift
git commit -m "feat(#691): add AISearchModel state machine"
```

---

## Task 5: `AISearchSheetView`

**Files:**
- Create: `Sources/AnglesiteApp/AISearchSheetView.swift`

**Interfaces:**
- Consumes: `AISearchModel` (Task 4) — `.phase`, `.domainInput`, `.sheetPresented`, `.checkPolicyAndResolveZone(sourceDirectory:)`, `.confirmCost()`, `.dismissSheet()`.
- Produces: `AISearchSheetView(model: AISearchModel, sourceDirectory: URL)`. Task 6 consumes this.

No automated test — `HardenSheetView` (the direct precedent this mirrors) has none either; this is UI-only and gets exercised via `scripts/build-app.sh` plus a manual smoke pass in Task 6.

- [ ] **Step 1: Implement**

Create `Sources/AnglesiteApp/AISearchSheetView.swift`, following `HardenSheetView.swift`'s header/content/footer layout:

```swift
import SwiftUI
import AnglesiteCore

struct AISearchSheetView: View {
    @Bindable var model: AISearchModel
    let sourceDirectory: URL

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 540, idealWidth: 620, minHeight: 380, idealHeight: 520)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            statusIcon
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.headline)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .idle:
            Image(systemName: "text.magnifyingglass").font(.title3)
        case .resolvingZone, .provisioning:
            ProgressView().controlSize(.small)
        case .blockedByPolicy:
            Image(systemName: "hand.raised.fill").foregroundStyle(.orange).font(.title3)
        case .awaitingCostConfirmation:
            Image(systemName: "dollarsign.circle").foregroundStyle(.blue).font(.title3)
        case .succeeded:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.title3)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.title3)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .idle: return "Set Up AI Search"
        case .resolvingZone(let domain): return "Checking \(domain)…"
        case .blockedByPolicy: return "Blocked by AI usage policy"
        case .awaitingCostConfirmation(let domain, _): return "Enable AI Search for \(domain)?"
        case .provisioning(let domain): return "Provisioning AI Search for \(domain)…"
        case .succeeded: return "AI Search instance created"
        case .failed: return "AI Search setup failed"
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            Form {
                TextField("Domain", text: $model.domainInput, prompt: Text("example.com"))
                    .textContentType(.URL)
            }
            .padding()
        case .resolvingZone, .provisioning:
            ProgressView()
        case .blockedByPolicy(let reason):
            VStack(alignment: .leading, spacing: 8) {
                Text(reason)
                Text("Open Content Licensing settings to review this site's AI usage policy.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding()
        case .awaitingCostConfirmation:
            VStack(alignment: .leading, spacing: 8) {
                Text("AI Search billing scales with reader traffic, unlike other Cloudflare features in this app.")
                Text("Free during open beta: 100 instances, 20,000 queries/month, 500 crawled pages/day. Reader queries run on Cloudflare's AI models — beyond free limits, usage is billed by Cloudflare.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding()
        case .succeeded(let result):
            VStack(alignment: .leading, spacing: 8) {
                Text("Instance \"\(result.instance.name)\" is provisioned.")
                if result.wafSkipRuleAdded {
                    Text("A WAF rule was added so Bot Fight Mode doesn't block the AI Search crawler.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Text("NLWeb enablement is still manual — finish setup in the Cloudflare dashboard:")
                Link("Open AI Search instance settings", destination: result.dashboardURL)
                Text("In the dashboard: open this instance's Settings, locate \"NLWeb Worker\", and enable it.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .padding()
        case .failed(let reason):
            Text(reason).foregroundStyle(.secondary).padding()
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Spacer()
            switch model.phase {
            case .idle:
                Button("Cancel") { model.dismissSheet() }
                Button("Continue") { model.checkPolicyAndResolveZone(sourceDirectory: sourceDirectory) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.domainInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            case .awaitingCostConfirmation:
                Button("Cancel") { model.dismissSheet() }
                Button("Enable AI Search") { model.confirmCost() }
                    .keyboardShortcut(.defaultAction)
            case .succeeded, .blockedByPolicy, .failed:
                Button("Done") { model.dismissSheet() }
                    .keyboardShortcut(.defaultAction)
            case .resolvingZone, .provisioning:
                Button("Cancel") { model.dismissSheet() }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add Sources/AnglesiteApp/AISearchSheetView.swift
git commit -m "feat(#691): add AISearchSheetView"
```

---

## Task 6: Wire into `SiteWindowModel` / `SiteWindow` / `WebsiteCommands`

**Files:**
- Modify: `Sources/AnglesiteCore/SiteToolbarItemID.swift` (add `.aiSearch` case)
- Modify: `Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift` (extend the frozen array)
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (near `Sources/AnglesiteApp/SiteWindowModel.swift:153`, `var harden = HardenModel()`)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (near `Sources/AnglesiteApp/SiteWindow.swift:383-396` toolbar item, and `Sources/AnglesiteApp/SiteWindow.swift:593-595` sheet modifier)
- Modify: `Sources/AnglesiteApp/WebsiteCommands.swift` (near `Sources/AnglesiteApp/WebsiteCommands.swift:64-66`)

**Interfaces:**
- Consumes: `AISearchModel` (Task 4), `AISearchSheetView` (Task 5).
- Produces: `SiteWindowModel.aiSearch: AISearchModel`, `SiteWindowModel.canRunAISearch: Bool`. Nothing downstream consumes these — this is the final task.

`SiteToolbarItemID`/its frozen test are covered by `swift test` (Step 2 below). The rest of this task touches `SiteWindow.swift`/`WebsiteCommands.swift`, which are Xcode-target-only files (excluded from the `AnglesiteAppCore` SwiftPM target per `Package.swift:242-243`) — `swift test` can't cover those, so verify with a full app build and a manual smoke pass instead.

- [ ] **Step 1: Add the model property and gate**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, next to `var harden = HardenModel()` (line 153):

```swift
var aiSearch = AISearchModel()
```

Next to `canRunHarden` (search for it near line 617):

```swift
var canRunAISearch: Bool { site?.isValid == true && !aiSearch.isRunning }
```

- [ ] **Step 2: Add the toolbar item id, then the toolbar entry**

Toolbar item ids are frozen API (macOS persists each user's toolbar layout keyed by the raw string — see the doc comment on `Sources/AnglesiteCore/SiteToolbarItemID.swift:3-10`), so this is two coordinated edits:

In `Sources/AnglesiteCore/SiteToolbarItemID.swift`, add a case right after `case onionRouting` (line 18):

```swift
    case onionRouting
    case aiSearch
```

In `Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift`, add the matching entry at the same position in the frozen array (after `"onionRouting"`, line 17):

```swift
            "onionRouting",
            "aiSearch",
```

Run `swift test --package-path . --filter SiteToolbarItemIDTests` — expect PASS (this is deliberately extending the freeze, not breaking it, since both files changed together).

Then, in `Sources/AnglesiteApp/SiteWindow.swift`, next to the `harden` `ToolbarItem` (lines 383-396), add a sibling item:

```swift
ToolbarItem(id: SiteToolbarItemID.aiSearch.rawValue, placement: .primaryAction) {
    Button {
        model.aiSearch.openSheet()
    } label: {
        if model.aiSearch.isRunning {
            Label("Setting Up AI Search…", systemImage: "text.magnifyingglass")
        } else {
            Label("AI Search", systemImage: "text.magnifyingglass")
        }
    }
    .disabled(!model.canRunAISearch)
    .help(site.isValid
          ? "Provision Cloudflare AI Search for this site"
          : "Site is missing required files")
}
.defaultCustomization(.hidden)
```

- [ ] **Step 3: Add the sheet presentation**

In `Sources/AnglesiteApp/SiteWindow.swift`, next to the `harden` `.sheet` modifier (lines 593-595):

```swift
.sheet(isPresented: $bindableModel.aiSearch.sheetPresented) {
    AISearchSheetView(model: model.aiSearch, sourceDirectory: site.sourceDirectory)
}
```

- [ ] **Step 4: Add the menu entry**

In `Sources/AnglesiteApp/WebsiteCommands.swift`, next to the `Harden…` button (lines 64-66):

```swift
Button("AI Search…") { model?.aiSearch.openSheet() }
    .disabled(model?.canRunAISearch != true)
```

- [ ] **Step 5: Build and smoke-test**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: build succeeds.

Manual smoke (since this is UI-only and `swift test` can't reach it): launch the app, open a site, click the new "AI Search" toolbar button (and separately the Website ▸ "AI Search…" menu item), confirm the sheet opens on `.idle`, type a domain, click Continue, and confirm the sheet transitions through the phases without crashing (a live Cloudflare token isn't required to see it reach `.failed` with a clear message — that's still a valid smoke pass).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/SiteToolbarItemID.swift Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/SiteWindow.swift Sources/AnglesiteApp/WebsiteCommands.swift
git commit -m "feat(#691): wire AI Search into the site window"
```
