# Registrar Search + Purchase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site owner search domain names, see real-time pricing, and buy one in-app via Cloudflare's Registrar API, replacing the current "Buy a domain" placeholder (a bare link-out).

**Architecture:** Three new layers mirroring the existing `DomainModel` → `DomainOperationsService` → `HTTPCloudflareClient` stack used for DNS management: `HTTPCloudflareClient` gains dedicated `CloudflareRegistrarReading`/`CloudflareRegistrarWriting` conformances (search/check/register), a new `RegistrarOperationsService`/`RegistrarOperations` pair in `AnglesiteCore` composes them with token lookup, and a new `BuyDomainModel`/`BuyDomainSheetView` in `AnglesiteApp` drives the search → confirm → purchase UI. A successful purchase reuses `ConnectDomainCommand.recordTransfer` verbatim — zero changes to `CustomDomainAttachCommand`. A "no Cloudflare token" search reuses the existing `CloudflareTokenPromptView` (narrowed off `DeployModel` to a closure-based init so `BuyDomainModel` can drive it too).

**Tech Stack:** Swift 6.4, SwiftUI, Swift Testing (`Testing` framework, `@Test`/`#expect`), SwiftPM (`AnglesiteCore`, `AnglesiteAppCore` targets — the latter's `path` is `Sources/AnglesiteApp`).

## Global Constraints

- Never collect, store, or proxy payment/card details, full stop (design spec, Problem/Goals).
- Every `registerDomain` call happens only from an explicit "Buy" button press; the button is disabled for the duration of the call — no double-submit, no automatic/optimistic charge (spec §3).
- Only an explicit `succeeded` outcome from `registerDomain` may write persisted state (`.site-config`/`anglesite.json`); `failed`/`action_required`/`blocked`/still-`in_progress` write nothing (spec §3, §4).
- Registrar operations are **account-scoped**, not zone-scoped; account id is resolved the same way `workerScriptNames`/`attachWorkersCustomDomain` already do it — `GET /accounts?per_page=1`, first result (spec, "The Cloudflare Registrar API").
- A `202` (async) registration is polled up to ~15s total (6 attempts × 2.5s); if still `in_progress` after that, resolve to `.stillProcessing` — no background task survives beyond the bounded loop (spec §3).
- `CustomDomainAttachCommand` gets **zero changes** — purchase success calls `ConnectDomainCommand.recordTransfer(hostname:siteDirectory:)` verbatim, the exact write "I already own a domain" already performs (spec §5).
- `CloudflareRegistrarReading`/`CloudflareRegistrarWriting` are **new, dedicated protocols** — never add methods to the existing `CloudflareReading`/`CloudflareWriting` protocols (would force five unrelated test fakes to grow stub methods) (spec §2).
- Search requests cap results at `limit=20` so a single batched `checkDomainAvailability` call covers them all (the API's own per-request cap) (spec §3).
- Endpoint paths/field names below were confirmed against `https://developers.cloudflare.com/registrar/registrar-api/` on 2026-08-01 (post training-data cutoff) — Task 2's Step 1 re-verifies live before locking in fixture JSON.

---

### Task 1: Share `CloudflareTokenPromptView` between `DeployModel` and the new `BuyDomainModel`

**Files:**
- Modify: `Sources/AnglesiteApp/CloudflareTokenPromptView.swift`
- Modify: `Sources/AnglesiteApp/DeployModel.swift:106-115` (the `TokenVerification` enum + `tokenVerification` property)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:587-591` (the `CloudflareTokenPromptView` sheet call site)

**Interfaces:**
- Consumes: nothing new — this is a pure refactor of existing code.
- Produces: `CloudflareTokenVerification` (top-level enum, was `DeployModel.TokenVerification`), and `CloudflareTokenPromptView.init(tokenVerification:onSubmit:onCancel:)` — the exact seam Task 5's `BuyDomainModel` will drive.

This is a mechanical refactor with full existing regression coverage (`DeployModel`'s behavior must not change), so there's no new test to write — the "red" step is running the existing suite *before* touching anything to confirm the baseline, then confirming it's still green after.

- [ ] **Step 1: Run the existing DeployModel tests to confirm the baseline passes**

Run: `swift test --package-path . --filter DeployModelTests`
Expected: all tests PASS (this is the regression net for this refactor).

- [ ] **Step 2: Move `TokenVerification` out of `DeployModel` to a shared top-level type**

In `Sources/AnglesiteApp/DeployModel.swift`, delete the nested enum (currently lines 109-114) and the property declaration on line 115. Replace with:

```swift
    private(set) var tokenVerification: CloudflareTokenVerification = .idle
```

(Delete the now-redundant doc comment on lines 106-108 too — it moves to the new type's declaration in Step 3.)

- [ ] **Step 3: Declare the shared type and narrow the view's `init`**

In `Sources/AnglesiteApp/CloudflareTokenPromptView.swift`, add above the `struct CloudflareTokenPromptView` declaration:

```swift
/// Progress of verifying a pasted Cloudflare token, consumed by `CloudflareTokenPromptView`'s
/// status line and button-enabled logic. A token is only persisted once verification reaches
/// `.connected`; a `.failed` state keeps the sheet open and leaves storage untouched. Shared
/// between every Cloudflare token-prompt flow (`DeployModel`, `BuyDomainModel`) rather than
/// nested in one model, since the view itself is shared.
enum CloudflareTokenVerification: Equatable {
    case idle
    case checking
    case connected(accountName: String?)
    case failed(message: String)
}
```

Then change the view's stored properties and `init` from a concrete `DeployModel` to closures. Replace:

```swift
struct CloudflareTokenPromptView: View {
    let model: DeployModel
    let onCancel: () -> Void
```

with:

```swift
struct CloudflareTokenPromptView: View {
    let tokenVerification: CloudflareTokenVerification
    let onSubmit: (String) async -> Void
    let onCancel: () -> Void
```

Update the body's uses of `model.tokenVerification` (the `isInputLocked` computed property and the `status` view) to read `tokenVerification` directly, and update `submit()`:

```swift
    private func submit() {
        guard canSubmit else { return }
        Task { await onSubmit(token) }
    }
```

Update the `#Preview` at the bottom of the file:

```swift
#Preview {
    CloudflareTokenPromptView(tokenVerification: .idle, onSubmit: { _ in }, onCancel: {})
}
```

- [ ] **Step 4: Update `SiteWindow.swift`'s call site**

In `Sources/AnglesiteApp/SiteWindow.swift`, replace lines 587-591:

```swift
        .sheet(isPresented: $bindableModel.deploy.tokenPromptPresented) {
            CloudflareTokenPromptView(model: model.deploy) {
                model.deploy.cancelTokenPrompt()
            }
        }
```

with:

```swift
        .sheet(isPresented: $bindableModel.deploy.tokenPromptPresented) {
            CloudflareTokenPromptView(
                tokenVerification: model.deploy.tokenVerification,
                onSubmit: { await model.deploy.verifyAndSaveToken($0) },
                onCancel: { model.deploy.cancelTokenPrompt() }
            )
        }
```

- [ ] **Step 5: Build and run the full DeployModel + app test suites**

Run: `swift test --package-path . --filter DeployModelTests`
Expected: all tests PASS, identical results to Step 1.

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED (confirms `SiteWindow.swift`'s call site and the `#Preview` both compile).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/CloudflareTokenPromptView.swift Sources/AnglesiteApp/DeployModel.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "refactor(#1195): share CloudflareTokenPromptView via closures

Narrows the view off a concrete DeployModel to
tokenVerification/onSubmit/onCancel so BuyDomainModel (#1195) can
drive the same prompt for its own no-token case."
```

---

### Task 2: Registrar search + check reads on `HTTPCloudflareClient`

**Files:**
- Create: `Sources/AnglesiteCore/CloudflareRegistrarClient.swift`
- Modify: `Sources/AnglesiteCore/HTTPCloudflareClient.swift`
- Test: `Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift`

**Interfaces:**
- Consumes: `HTTPCloudflareClient`'s existing private `get<T>(_:apiToken:as:)` helper and `CFAccount`/`CFEnvelope` types (same file, `private` is file-scoped across extensions of the same type — already relied on by the existing `CloudflareWriting` extension).
- Produces: `public protocol CloudflareRegistrarReading { func searchDomains(query: String, apiToken: String) async throws -> [String]; func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck] }`, `public struct RegistrarDomainCheck: Sendable, Equatable { let name: String; let registrable: Bool; let reason: String?; let registrationCost: String?; let currency: String? }` — both consumed by Task 4's `RegistrarOperations`.

- [ ] **Step 1: Re-verify the live API shape**

Fetch `https://developers.cloudflare.com/registrar/registrar-api/` and confirm: the `GET /accounts/{account_id}/registrar/domain-search?q={query}&limit={n}` path and its result shape (this plan assumes each result is `{"name": "..."}`); the `POST /accounts/{account_id}/registrar/domain-check` path, its `{"domains": [...]}` request body, and its per-domain result shape (`name`, `registrable`, `reason`, `pricing.currency`/`pricing.registration_cost`/`pricing.renewal_cost`). If any field name differs, adjust the private decode structs in Step 3 and the fixture JSON in Step 2 accordingly before proceeding — do not guess past this point.

- [ ] **Step 2: Write the failing tests**

Create `Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct HTTPCloudflareClientRegistrarTests {
    private let accountsJSON = #"{"success":true,"errors":[],"messages":[],"result":[{"id":"acct123"}]}"#

    @Test("searchDomains returns candidate names")
    func searchReturnsNames() async throws {
        let searchJSON = """
        {"success":true,"errors":[],"messages":[],"result":[{"name":"example.dev"},{"name":"example.app"}]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (200, searchJSON),
        ]))
        let names = try await client.searchDomains(query: "example", apiToken: "t")
        #expect(names == ["example.dev", "example.app"])
    }

    @Test("searchDomains surfaces a CloudflareError")
    func searchSurfacesError() async {
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-search": (403, "{\"success\":false}"),
        ]))
        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.searchDomains(query: "example", apiToken: "bad")
        }
    }

    @Test("checkDomainAvailability decodes pricing for a registrable domain")
    func checkRegistrable() async throws {
        let checkJSON = """
        {"success":true,"errors":[],"messages":[],"result":[
            {"name":"example.dev","registrable":true,"pricing":{"currency":"USD","registration_cost":"10.11","renewal_cost":"10.11"}}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-check": (200, checkJSON),
        ]))
        let results = try await client.checkDomainAvailability(domains: ["example.dev"], apiToken: "t")
        #expect(results == [
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil,
                                  registrationCost: "10.11", currency: "USD"),
        ])
    }

    @Test("checkDomainAvailability decodes the reason for an unregistrable domain")
    func checkUnregistrable() async throws {
        let checkJSON = """
        {"success":true,"errors":[],"messages":[],"result":[
            {"name":"taken.dev","registrable":false,"reason":"domain_unavailable"}
        ]}
        """
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/domain-check": (200, checkJSON),
        ]))
        let results = try await client.checkDomainAvailability(domains: ["taken.dev"], apiToken: "t")
        #expect(results == [
            RegistrarDomainCheck(name: "taken.dev", registrable: false, reason: "domain_unavailable",
                                  registrationCost: nil, currency: nil),
        ])
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `swift test --package-path . --filter HTTPCloudflareClientRegistrarTests`
Expected: FAIL — `searchDomains`/`checkDomainAvailability`/`RegistrarDomainCheck` don't exist yet (compile error).

- [ ] **Step 4: Create the protocol + public types**

Create `Sources/AnglesiteCore/CloudflareRegistrarClient.swift`:

```swift
import Foundation

/// One Check result — real-time availability + pricing, or the reason a candidate isn't
/// registrable. `registrationCost`/`currency` are `nil` exactly when `registrable` is `false`.
public struct RegistrarDomainCheck: Sendable, Equatable {
    public let name: String
    public let registrable: Bool
    /// Set when `registrable` is `false` — e.g. `domain_unavailable`,
    /// `extension_not_supported_via_api`, `extension_not_supported`,
    /// `extension_disallows_registration`.
    public let reason: String?
    public let registrationCost: String?
    public let currency: String?

    public init(name: String, registrable: Bool, reason: String?, registrationCost: String?, currency: String?) {
        self.name = name
        self.registrable = registrable
        self.reason = reason
        self.registrationCost = registrationCost
        self.currency = currency
    }
}

/// Read-only Cloudflare Registrar API seam (search + check), deliberately separate from
/// `CloudflareReading` — see this plan's Global Constraints for why. The concrete
/// `HTTPCloudflareClient` conforms via an extension; tests provide a fake.
public protocol CloudflareRegistrarReading: Sendable {
    /// Candidate domain names for a keyword/phrase (cached server-side by Cloudflare). Availability
    /// and pricing are NOT included — follow up with `checkDomainAvailability`.
    func searchDomains(query: String, apiToken: String) async throws -> [String]
    /// Real-time availability + pricing for up to 20 domain names in one call (the API's own cap).
    func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck]
}
```

- [ ] **Step 5: Implement the conformance on `HTTPCloudflareClient`**

In `Sources/AnglesiteCore/HTTPCloudflareClient.swift`, add near the other private decode structs (after `private struct CFAccount: Decodable, Sendable { let id: String }`):

```swift
private struct CFRegistrarSearchResult: Decodable, Sendable {
    let name: String
}
private struct CFRegistrarCheckResult: Decodable, Sendable {
    let name: String
    let registrable: Bool
    let reason: String?
    let pricing: Pricing?
    struct Pricing: Decodable, Sendable {
        let currency: String
        let registration_cost: String
        let renewal_cost: String
    }
}
private struct CFRegistrarCheckRequest: Encodable, Sendable {
    let domains: [String]
}
```

Then, at the end of the file (after the existing `extension HTTPCloudflareClient: CloudflareWriting { ... }` block), add a new extension:

```swift
// MARK: - CloudflareRegistrarReading conformance

extension HTTPCloudflareClient: CloudflareRegistrarReading {
    /// Resolves the token's first visible account id — every Registrar endpoint is
    /// account-scoped. Mirrors `workerScriptNames`'s resolution exactly.
    private func resolveAccountID(apiToken: String) async throws -> String {
        let accounts = try await get("/accounts?per_page=1", apiToken: apiToken, as: [CFAccount].self)
        guard let accountID = accounts.first?.id else {
            throw CloudflareError.api(message: "no Cloudflare account visible to this token")
        }
        return accountID
    }

    /// POST `path` with `body`, decode `CFEnvelope<T>`, return its `result` — like `get`, but for
    /// POST calls that need the decoded payload back (unlike `mutate`, which only checks success).
    private func post<Body: Encodable & Sendable, T: Decodable & Sendable>(
        _ path: String, body: Body, apiToken: String, as type: T.Type
    ) async throws -> T {
        guard let url = URL(string: Self.base + path) else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        let env: CFEnvelope<T>
        do {
            env = try JSONDecoder().decode(CFEnvelope<T>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard env.success else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "request failed")
        }
        guard let result = env.result else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing result")
        }
        return result
    }

    /// See ``CloudflareRegistrarReading/searchDomains(query:apiToken:)``.
    public func searchDomains(query: String, apiToken: String) async throws -> [String] {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        let escaped = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let results = try await get(
            "/accounts/\(accountID)/registrar/domain-search?q=\(escaped)&limit=20",
            apiToken: apiToken, as: [CFRegistrarSearchResult].self)
        return results.map(\.name)
    }

    /// See ``CloudflareRegistrarReading/checkDomainAvailability(domains:apiToken:)``.
    public func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck] {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        let results = try await post(
            "/accounts/\(accountID)/registrar/domain-check",
            body: CFRegistrarCheckRequest(domains: domains), apiToken: apiToken,
            as: [CFRegistrarCheckResult].self)
        return results.map {
            RegistrarDomainCheck(
                name: $0.name, registrable: $0.registrable, reason: $0.reason,
                registrationCost: $0.pricing?.registration_cost, currency: $0.pricing?.currency)
        }
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `swift test --package-path . --filter HTTPCloudflareClientRegistrarTests`
Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareRegistrarClient.swift Sources/AnglesiteCore/HTTPCloudflareClient.swift Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift
git commit -m "feat(#1195): Cloudflare Registrar search + check reads

Adds CloudflareRegistrarReading (search, check) as a dedicated
protocol, conformed by HTTPCloudflareClient, kept separate from
CloudflareReading so unrelated fakes don't need stub methods."
```

---

### Task 3: Registrar `register` write, with the 201/202-and-bounded-poll logic

**Files:**
- Modify: `Sources/AnglesiteCore/CloudflareRegistrarClient.swift`
- Modify: `Sources/AnglesiteCore/HTTPCloudflareClient.swift`
- Modify: `Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift`

**Interfaces:**
- Consumes: `resolveAccountID(apiToken:)` from Task 2 (same file, `private`, reachable across extensions of the same type).
- Produces: `public protocol CloudflareRegistrarWriting { func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome }`, `public enum RegistrarRegistrationOutcome: Sendable, Equatable { case succeeded; case failed(reason: String); case actionRequired; case blocked; case stillProcessing }` — both consumed by Task 4's `RegistrarOperations`.

- [ ] **Step 1: Re-verify the live API shape for `register`**

Confirm against `https://developers.cloudflare.com/registrar/registrar-api/`: `POST /accounts/{account_id}/registrar/registrations` request body (`{"domain_name": "..."}`), the `201`-vs-`202` distinction, the response body's `state` field and its possible values (`in_progress`/`succeeded`/`failed`/`action_required`/`blocked`), and the poll endpoint `GET /accounts/{account_id}/registrar/registrations/{domain}/registration-status`'s response shape (this plan assumes it shares the same `{"state": "..."}` shape as the register response body). Adjust Step 3 if anything differs.

- [ ] **Step 2: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift`, inside the `struct HTTPCloudflareClientRegistrarTests` body:

```swift
    @Test("registerDomain resolves succeeded on an immediate 201")
    func registerImmediateSuccess() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"succeeded"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .succeeded)
    }

    @Test("registerDomain maps action_required")
    func registerActionRequired() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"action_required"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .actionRequired)
    }

    @Test("registerDomain maps blocked")
    func registerBlocked() async throws {
        let registerJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"blocked"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (201, registerJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .blocked)
    }

    @Test("registerDomain maps a 202 that polls straight to succeeded")
    func registerAsyncThenSucceeds() async throws {
        let acceptedJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"in_progress"}}"#
        let statusJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"succeeded"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (202, acceptedJSON),
            "/registration-status": (200, statusJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .succeeded)
    }

    @Test("registerDomain resolves stillProcessing when polling never leaves in_progress")
    func registerAsyncNeverResolves() async throws {
        let acceptedJSON = #"{"success":true,"errors":[],"messages":[],"result":{"state":"in_progress"}}"#
        let client = HTTPCloudflareClient(transport: fakeTransport([
            "/accounts?per_page=1": (200, accountsJSON),
            "/registrar/registrations": (202, acceptedJSON),
            "/registration-status": (200, acceptedJSON),
        ]))
        let outcome = try await client.registerDomain(name: "example.dev", apiToken: "t")
        #expect(outcome == .stillProcessing)
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `swift test --package-path . --filter HTTPCloudflareClientRegistrarTests`
Expected: FAIL — `registerDomain`/`RegistrarRegistrationOutcome` don't exist yet (compile error). (This will run slowly once implemented, since `registerAsyncNeverResolves` genuinely waits out the poll loop — see Step 5's note.)

- [ ] **Step 4: Add the protocol + outcome type**

In `Sources/AnglesiteCore/CloudflareRegistrarClient.swift`, append:

```swift
/// The resolved outcome of a `registerDomain` call — the 201-vs-202-and-poll distinction is
/// already resolved by the time callers see this; no polling primitive is exposed above the
/// HTTP client.
public enum RegistrarRegistrationOutcome: Sendable, Equatable {
    case succeeded
    case failed(reason: String)
    case actionRequired
    case blocked
    case stillProcessing
}

/// Write-side Cloudflare Registrar API seam (register), deliberately separate from
/// `CloudflareWriting` — see this plan's Global Constraints for why.
public protocol CloudflareRegistrarWriting: Sendable {
    /// Registers `name` against the token's account. Cloudflare completes most registrations
    /// synchronously within ~10s; slower ones are polled internally for up to ~15s before
    /// resolving to `.stillProcessing` — this call always returns a single resolved outcome.
    func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome
}
```

- [ ] **Step 5: Implement the conformance on `HTTPCloudflareClient`**

In `Sources/AnglesiteCore/HTTPCloudflareClient.swift`, add the decode struct near the other `CFRegistrar*` ones:

```swift
private struct CFRegistrarRegisterRequest: Encodable, Sendable {
    let domain_name: String
}
/// Shared by the immediate register response body and the poll (`registration-status`) response
/// body — both report the same `state` field.
private struct CFRegistrarRegistrationState: Decodable, Sendable {
    let state: String
}
```

Then add a new extension at the end of the file:

```swift
// MARK: - CloudflareRegistrarWriting conformance

extension HTTPCloudflareClient: CloudflareRegistrarWriting {
    /// `POST /accounts/{id}/registrar/registrations`. See
    /// ``CloudflareRegistrarWriting/registerDomain(name:apiToken:)``.
    public func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome {
        let accountID = try await resolveAccountID(apiToken: apiToken)
        guard let url = URL(string: Self.base + "/accounts/\(accountID)/registrar/registrations") else {
            throw CloudflareError.malformedResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CFRegistrarRegisterRequest(domain_name: name))

        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard http.statusCode == 201 || http.statusCode == 202 else {
            throw CloudflareError.http(status: http.statusCode)
        }
        if http.statusCode == 201 {
            return try Self.outcome(forState: try Self.decodeState(from: data))
        }
        return try await pollRegistrationStatus(domain: name, accountID: accountID, apiToken: apiToken)
    }

    private static func decodeState(from data: Data) throws -> String {
        let env: CFEnvelope<CFRegistrarRegistrationState>
        do {
            env = try JSONDecoder().decode(CFEnvelope<CFRegistrarRegistrationState>.self, from: data)
        } catch {
            throw CloudflareError.malformedResponse
        }
        guard env.success, let state = env.result?.state else {
            throw CloudflareError.api(message: env.errors?.first?.message ?? "missing registration state")
        }
        return state
    }

    private static func outcome(forState state: String) -> RegistrarRegistrationOutcome {
        switch state {
        case "succeeded": return .succeeded
        case "action_required": return .actionRequired
        case "blocked": return .blocked
        case "failed": return .failed(reason: "Cloudflare reported the registration failed.")
        default: return .stillProcessing
        }
    }

    /// Polls `registration-status` every 2.5s, up to 6 times (~15s total — matching the API's own
    /// "synchronous in most cases (10s timeout)" framing with one poll's margin past it). Resolves
    /// to `.stillProcessing` if `state` never leaves `in_progress` in that window. No task survives
    /// past this method returning — there is no background/long-lived polling.
    private func pollRegistrationStatus(
        domain: String, accountID: String, apiToken: String
    ) async throws -> RegistrarRegistrationOutcome {
        for _ in 0..<6 {
            try? await Task.sleep(for: .milliseconds(2500))
            let state = try await get(
                "/accounts/\(accountID)/registrar/registrations/\(domain)/registration-status",
                apiToken: apiToken, as: CFRegistrarRegistrationState.self)
            let outcome = Self.outcome(forState: state.state)
            if case .stillProcessing = outcome { continue }
            return outcome
        }
        return .stillProcessing
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `swift test --package-path . --filter HTTPCloudflareClientRegistrarTests`
Expected: all 9 tests PASS. `registerAsyncNeverResolves` takes ~15s (it genuinely waits out 6 polls) — that's expected, not a hang.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareRegistrarClient.swift Sources/AnglesiteCore/HTTPCloudflareClient.swift Tests/AnglesiteCoreTests/HTTPCloudflareClientRegistrarTests.swift
git commit -m "feat(#1195): Cloudflare Registrar register write with bounded poll

registerDomain resolves the 201-vs-202 distinction internally,
polling up to ~15s on a 202 before giving up with .stillProcessing.
No polling primitive is exposed above the HTTP client."
```

---

### Task 4: `RegistrarOperationsService` (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/RegistrarOperationsService.swift`
- Test: `Tests/AnglesiteCoreTests/RegistrarOperationsServiceTests.swift`

**Interfaces:**
- Consumes: `CloudflareRegistrarReading`/`CloudflareRegistrarWriting`/`RegistrarDomainCheck`/`RegistrarRegistrationOutcome` (Tasks 2-3), `DomainOperations.defaultTokenProvider` (existing, `Sources/AnglesiteCore/DomainOperationsService.swift:98-103`).
- Produces: `public protocol RegistrarOperationsService: Sendable { func searchDomains(query: String) async -> Result<[String], RegistrarOperationError>; func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError>; func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> }`, `public struct RegistrarOperations: RegistrarOperationsService`, `public enum RegistrarOperationError: Error, Equatable, Sendable { case noToken; case cloudflare(CloudflareError) }` — all consumed by Task 5's `BuyDomainModel`.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/RegistrarOperationsServiceTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

struct RegistrarOperationsServiceTests {
    private func service(
        reader: FakeRegistrarReader = FakeRegistrarReader(),
        writer: FakeRegistrarWriter = FakeRegistrarWriter(),
        token: String? = "tok"
    ) -> RegistrarOperations {
        RegistrarOperations(reader: reader, writer: writer, tokenProvider: { token })
    }

    @Test("searchDomains resolves the reader's names")
    func searchSucceeds() async {
        let reader = FakeRegistrarReader(searchNames: ["example.dev"])
        let result = await service(reader: reader).searchDomains(query: "example")
        guard case .success(let names) = result else { Issue.record("expected success"); return }
        #expect(names == ["example.dev"])
        #expect(reader.searchedQuery == "example")
    }

    @Test("searchDomains fails with .noToken when no token is available")
    func searchNoToken() async {
        let result = await service(token: nil).searchDomains(query: "example")
        guard case .failure(.noToken) = result else { Issue.record("expected .noToken"); return }
    }

    @Test("searchDomains surfaces a CloudflareError as .cloudflare")
    func searchCloudflareError() async {
        let reader = FakeRegistrarReader(searchError: .unauthorized)
        let result = await service(reader: reader).searchDomains(query: "example")
        guard case .failure(.cloudflare(.unauthorized)) = result else { Issue.record("expected .cloudflare(.unauthorized)"); return }
    }

    @Test("checkDomainAvailability resolves the reader's results")
    func checkSucceeds() async {
        let reader = FakeRegistrarReader(checkResults: [
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ])
        let result = await service(reader: reader).checkDomainAvailability(domains: ["example.dev"])
        guard case .success(let checks) = result else { Issue.record("expected success"); return }
        #expect(checks.count == 1)
        #expect(reader.checkedDomains == ["example.dev"])
    }

    @Test("registerDomain resolves the writer's outcome")
    func registerSucceeds() async {
        let writer = FakeRegistrarWriter(registerOutcome: .succeeded)
        let result = await service(writer: writer).registerDomain(name: "example.dev")
        guard case .success(.succeeded) = result else { Issue.record("expected success(.succeeded)"); return }
        #expect(writer.registeredName == "example.dev")
    }

    @Test("registerDomain fails with .noToken when no token is available")
    func registerNoToken() async {
        let result = await service(token: nil).registerDomain(name: "example.dev")
        guard case .failure(.noToken) = result else { Issue.record("expected .noToken"); return }
    }
}

// MARK: - Fakes

final class FakeRegistrarReader: CloudflareRegistrarReading, @unchecked Sendable {
    private let searchNames: [String]
    private let searchError: CloudflareError?
    private let checkResults: [RegistrarDomainCheck]
    private(set) var searchedQuery: String?
    private(set) var checkedDomains: [String] = []

    init(searchNames: [String] = [], searchError: CloudflareError? = nil, checkResults: [RegistrarDomainCheck] = []) {
        self.searchNames = searchNames
        self.searchError = searchError
        self.checkResults = checkResults
    }

    func searchDomains(query: String, apiToken: String) async throws -> [String] {
        searchedQuery = query
        if let searchError { throw searchError }
        return searchNames
    }
    func checkDomainAvailability(domains: [String], apiToken: String) async throws -> [RegistrarDomainCheck] {
        checkedDomains = domains
        return checkResults
    }
}

final class FakeRegistrarWriter: CloudflareRegistrarWriting, @unchecked Sendable {
    private let registerOutcome: RegistrarRegistrationOutcome
    private(set) var registeredName: String?

    init(registerOutcome: RegistrarRegistrationOutcome = .succeeded) {
        self.registerOutcome = registerOutcome
    }

    func registerDomain(name: String, apiToken: String) async throws -> RegistrarRegistrationOutcome {
        registeredName = name
        return registerOutcome
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter RegistrarOperationsServiceTests`
Expected: FAIL — `RegistrarOperationsService`/`RegistrarOperations`/`RegistrarOperationError` don't exist yet (compile error).

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/RegistrarOperationsService.swift`:

```swift
import Foundation

/// Errors surfaced by `RegistrarOperationsService`. Mirrors `DomainOperationError`'s shape
/// (minus `.zoneNotFound`, not meaningful for account-scoped Registrar calls).
public enum RegistrarOperationError: Error, Equatable, Sendable {
    /// No Cloudflare API token was available from the token provider — the operation never
    /// reached the network.
    case noToken
    /// Any Cloudflare API failure, wrapping the underlying ``CloudflareError``.
    case cloudflare(CloudflareError)
}

/// Domain search/check/register operations, centralizing token lookup so `BuyDomainModel`
/// doesn't do its own — mirrors `DomainOperationsService`'s role for DNS operations.
public protocol RegistrarOperationsService: Sendable {
    func searchDomains(query: String) async -> Result<[String], RegistrarOperationError>
    func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError>
    func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError>
}

/// The production ``RegistrarOperationsService``, backed by the Cloudflare HTTP client. Every
/// operation re-runs token lookup rather than caching it — mirrors `DomainOperations`'s reasoning.
public struct RegistrarOperations: RegistrarOperationsService {
    private let reader: any CloudflareRegistrarReading
    private let writer: any CloudflareRegistrarWriting
    private let tokenProvider: @Sendable () -> String?

    public init(
        reader: any CloudflareRegistrarReading = HTTPCloudflareClient(),
        writer: any CloudflareRegistrarWriting = HTTPCloudflareClient(),
        tokenProvider: @escaping @Sendable () -> String? = DomainOperations.defaultTokenProvider
    ) {
        self.reader = reader
        self.writer = writer
        self.tokenProvider = tokenProvider
    }

    public func searchDomains(query: String) async -> Result<[String], RegistrarOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await reader.searchDomains(query: query, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }

    public func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await reader.checkDomainAvailability(domains: domains, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }

    public func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> {
        guard let token = tokenProvider() else { return .failure(.noToken) }
        do {
            return .success(try await writer.registerDomain(name: name, apiToken: token))
        } catch let error as CloudflareError {
            return .failure(.cloudflare(error))
        } catch {
            return .failure(.cloudflare(.malformedResponse))
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter RegistrarOperationsServiceTests`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/RegistrarOperationsService.swift Tests/AnglesiteCoreTests/RegistrarOperationsServiceTests.swift
git commit -m "feat(#1195): RegistrarOperationsService

Composes CloudflareRegistrarReading/Writing with token lookup,
mirroring DomainOperationsService's shape and reusing
DomainOperations.defaultTokenProvider."
```

---

### Task 5: `BuyDomainModel` (AnglesiteApp)

**Files:**
- Create: `Sources/AnglesiteApp/BuyDomainModel.swift`
- Test: `Tests/AnglesiteAppTests/BuyDomainModelTests.swift`

**Interfaces:**
- Consumes: `RegistrarOperationsService`/`RegistrarDomainCheck`/`RegistrarRegistrationOutcome`/`RegistrarOperationError` (Task 4), `CloudflareTokenVerification` (Task 1), `TokenOnboarding`/`TokenVerifying`/`CloudflareAPITokenVerifier` (existing, `AnglesiteCore`), `KeychainStore` (existing), `ConnectDomainCommand.recordTransfer(hostname:siteDirectory:)` (existing, `Sources/AnglesiteCore/ConnectDomainCommand.swift:23-26`), `CurrentSite` (existing).
- Produces: `BuyDomainModel` (`@Observable @MainActor`) with `phase: Phase`, `sheetPresented: Bool`, `queryInput: String`, `tokenPromptPresented: Bool`, `tokenVerification: CloudflareTokenVerification`, `configure(site:)`, `openSheet()`, `dismissSheet()`, `submitSearch()`, `selectCandidate(_:)`, `cancelConfirm()`, `confirmPurchase()`, `verifyAndSaveToken(_:)`, `cancelTokenPrompt()`, `static let cloudflareDomainsURL` — all consumed by Task 6's `BuyDomainSheetView` and Task 7's wiring.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/BuyDomainModelTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct BuyDomainModelTests {
    private func makeSite() throws -> (site: CurrentSite, dir: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return (CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp), tmp)
    }

    @Test func happyPathSearchThenPurchaseRecordsTransferIntent() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ]))
        await ops.setRegisterResult(.success(.succeeded))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        guard case .results(_, let candidates) = model.phase else {
            Issue.record("expected .results, got \(model.phase)"); return
        }
        #expect(candidates.count == 1)
        #expect(candidates[0].registrable)
        #expect(candidates[0].priceDisplay == "$10.11/yr")

        model.selectCandidate(candidates[0])
        guard case .confirming(let candidate) = model.phase else {
            Issue.record("expected .confirming, got \(model.phase)"); return
        }

        model.confirmPurchase()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.phase == .purchased(hostname: "example.dev"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.dev"))
        _ = candidate
    }

    @Test func unregistrableCandidateCannotBeSelected() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["taken.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "taken.dev", registrable: false, reason: "domain_unavailable", registrationCost: nil, currency: nil),
        ]))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.queryInput = "taken"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        guard case .results(_, let candidates) = model.phase else {
            Issue.record("expected .results, got \(model.phase)"); return
        }
        model.selectCandidate(candidates[0])
        #expect(model.phase == .results(query: "taken", candidates: candidates))
    }

    @Test func registerOutcomeActionRequiredDoesNotPersist() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.success(["example.dev"]))
        await ops.setCheckResult(.success([
            RegistrarDomainCheck(name: "example.dev", registrable: true, reason: nil, registrationCost: "10.11", currency: "USD"),
        ]))
        await ops.setRegisterResult(.success(.actionRequired))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning
        guard case .results(_, let candidates) = model.phase else { Issue.record("expected .results"); return }
        model.selectCandidate(candidates[0])
        model.confirmPurchase()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.phase == .needsAccountSetup(hostname: "example.dev"))
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }

    @Test func noTokenPresentsTokenPromptAndRecordsPendingQuery() async throws {
        let ops = FakeRegistrarOps()
        await ops.setSearchResult(.failure(.noToken))

        let model = BuyDomainModel(ops: ops)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.queryInput = "example"
        model.submitSearch()
        repeat { await Task.yield() } while model.isRunning

        #expect(model.tokenPromptPresented)
    }
}

// MARK: - Fakes

private actor FakeRegistrarOps: RegistrarOperationsService {
    private var searchResult: Result<[String], RegistrarOperationError> = .success([])
    private var checkResult: Result<[RegistrarDomainCheck], RegistrarOperationError> = .success([])
    private var registerResult: Result<RegistrarRegistrationOutcome, RegistrarOperationError> = .success(.succeeded)

    func setSearchResult(_ r: Result<[String], RegistrarOperationError>) { searchResult = r }
    func setCheckResult(_ r: Result<[RegistrarDomainCheck], RegistrarOperationError>) { checkResult = r }
    func setRegisterResult(_ r: Result<RegistrarRegistrationOutcome, RegistrarOperationError>) { registerResult = r }

    func searchDomains(query: String) async -> Result<[String], RegistrarOperationError> { searchResult }
    func checkDomainAvailability(domains: [String]) async -> Result<[RegistrarDomainCheck], RegistrarOperationError> { checkResult }
    func registerDomain(name: String) async -> Result<RegistrarRegistrationOutcome, RegistrarOperationError> { registerResult }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter BuyDomainModelTests`
Expected: FAIL — `BuyDomainModel` doesn't exist yet (compile error).

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteApp/BuyDomainModel.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// Drives the "Buy a Domain" sheet (#1195): search → price → confirm → purchase, reached from
/// `ConnectDomainSheetView`'s "Buy a domain" button. A successful purchase records the exact same
/// `DOMAIN_CHOICE=transfer` intent "I already own a domain" does (`ConnectDomainCommand
/// .recordTransfer`) — a Cloudflare-registered domain needs identical Workers Custom Domain
/// attach logic to a nameserver-delegated one, so `CustomDomainAttachCommand` needs no changes.
@MainActor
@Observable
final class BuyDomainModel {
    struct DomainCandidate: Equatable, Identifiable {
        var id: String { name }
        let name: String
        let registrable: Bool
        let reason: String?
        let priceDisplay: String?
    }

    enum Phase: Equatable {
        case searching(query: String)
        case loadingResults(query: String)
        case results(query: String, candidates: [DomainCandidate])
        case confirming(candidate: DomainCandidate)
        case purchasing(candidate: DomainCandidate)
        case purchased(hostname: String)
        case needsAccountSetup(hostname: String)
        case stillProcessing(hostname: String)
        case failed(reason: String)
    }

    private(set) var phase: Phase = .searching(query: "")
    var sheetPresented: Bool = false
    var queryInput: String = ""

    /// Progress of the nested token-prompt sheet, shown when a search hits `.noToken`. Presented
    /// by `BuyDomainSheetView` itself (a sheet stacked on the already-open purchase sheet), not by
    /// `SiteWindow` — see that view's doc comment.
    var tokenPromptPresented: Bool = false
    private(set) var tokenVerification: CloudflareTokenVerification = .idle
    /// The query `submitSearch()` was trying to run when `.noToken` interrupted it — re-run once
    /// the prompt reports `.proceed`.
    private var pendingSearchQuery: String?

    static let cloudflareDomainsURL = ConnectDomainModel.cloudflareDomainsURL

    private let ops: any RegistrarOperationsService
    private let keychain: KeychainStore
    private let onboarding: TokenOnboarding
    private var currentSite: CurrentSite?
    private var inFlight: Task<Void, Never>?

    init(
        ops: any RegistrarOperationsService = RegistrarOperations(),
        keychain: KeychainStore = KeychainStore(),
        verifier: TokenVerifying = CloudflareAPITokenVerifier()
    ) {
        self.ops = ops
        self.keychain = keychain
        self.onboarding = TokenOnboarding(verifier: verifier)
    }

    func configure(site: CurrentSite) {
        currentSite = site
    }

    var isRunning: Bool {
        switch phase {
        case .loadingResults, .purchasing: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .searching(query: "")
        queryInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
    }

    func submitSearch() {
        let query = queryInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runSearch(query: query)
        }
    }

    func selectCandidate(_ candidate: DomainCandidate) {
        guard candidate.registrable, case .results = phase else { return }
        phase = .confirming(candidate: candidate)
    }

    func cancelConfirm() {
        guard case .confirming = phase else { return }
        phase = .searching(query: queryInput)
    }

    func confirmPurchase() {
        guard case .confirming(let candidate) = phase, !isRunning else { return }
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.runPurchase(candidate: candidate)
        }
    }

    /// Called by the token-prompt sheet's submit action, mirroring `DeployModel.verifyAndSaveToken`
    /// exactly (same `TokenOnboarding` ordering, same `isCancelled` shape) — the only difference is
    /// what "proceed" means: re-running the parked search instead of starting a deploy.
    func verifyAndSaveToken(_ token: String) async {
        guard let query = pendingSearchQuery else {
            tokenVerification = .failed(message: "No search is waiting — close this and search again.")
            return
        }
        tokenVerification = .checking
        let outcome = await onboarding.run(
            token: token,
            siteDirectory: currentSite?.sourceDirectory ?? FileManager.default.temporaryDirectory,
            persist: { try keychain.writeCloudflareToken($0) },
            onConnected: { tokenVerification = .connected(accountName: $0.name) },
            delay: { try? await Task.sleep(for: .milliseconds(700)) },
            isCancelled: { Task.isCancelled || !tokenPromptPresented }
        )
        switch outcome {
        case .proceed:
            pendingSearchQuery = nil
            tokenPromptPresented = false
            tokenVerification = .idle
            queryInput = query
            submitSearch()
        case .stay(let message):
            tokenVerification = .failed(message: message)
        case .abort:
            tokenVerification = .idle
        }
    }

    func cancelTokenPrompt() {
        pendingSearchQuery = nil
        tokenPromptPresented = false
        tokenVerification = .idle
    }

    // MARK: - Private

    private func runSearch(query: String) async {
        phase = .loadingResults(query: query)
        switch await ops.searchDomains(query: query) {
        case .failure(.noToken):
            pendingSearchQuery = query
            tokenVerification = .idle
            tokenPromptPresented = true
            phase = .searching(query: query)
        case .failure(let error):
            phase = .failed(reason: message(for: error))
        case .success(let names):
            guard !names.isEmpty else {
                phase = .results(query: query, candidates: [])
                return
            }
            switch await ops.checkDomainAvailability(domains: names) {
            case .failure(let error):
                phase = .failed(reason: message(for: error))
            case .success(let checks):
                let candidates = checks.map {
                    DomainCandidate(
                        name: $0.name, registrable: $0.registrable, reason: $0.reason,
                        priceDisplay: Self.priceDisplay(cost: $0.registrationCost, currency: $0.currency))
                }
                phase = .results(query: query, candidates: candidates)
            }
        }
    }

    private func runPurchase(candidate: DomainCandidate) async {
        phase = .purchasing(candidate: candidate)
        guard let site = currentSite else {
            phase = .failed(reason: "No site is open.")
            return
        }
        switch await ops.registerDomain(name: candidate.name) {
        case .failure(let error):
            phase = .failed(reason: message(for: error))
        case .success(.succeeded):
            ConnectDomainCommand.recordTransfer(hostname: candidate.name, siteDirectory: site.sourceDirectory)
            phase = .purchased(hostname: candidate.name)
        case .success(.failed(let reason)):
            phase = .failed(reason: reason)
        case .success(.actionRequired), .success(.blocked):
            phase = .needsAccountSetup(hostname: candidate.name)
        case .success(.stillProcessing):
            phase = .stillProcessing(hostname: candidate.name)
        }
    }

    private func message(for error: RegistrarOperationError) -> String {
        switch error {
        case .noToken:
            return "No Cloudflare API token found. Add one in Settings → Credentials."
        case .cloudflare(let cfError):
            switch cfError {
            case .unauthorized:
                return "API token is unauthorized. Check that it has Registrar permissions."
            case .http(let status):
                return "Cloudflare API returned HTTP \(status)."
            case .api(let msg):
                return "Cloudflare API error: \(msg)"
            case .malformedResponse:
                return "Unexpected response from Cloudflare API."
            }
        }
    }

    private static func priceDisplay(cost: String?, currency: String?) -> String? {
        guard let cost else { return nil }
        if currency == "USD" { return "$\(cost)/yr" }
        if let currency { return "\(currency) \(cost)/yr" }
        return "\(cost)/yr"
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter BuyDomainModelTests`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/BuyDomainModel.swift Tests/AnglesiteAppTests/BuyDomainModelTests.swift
git commit -m "feat(#1195): BuyDomainModel

Search -> confirm -> purchase phase machine. A successful purchase
reuses ConnectDomainCommand.recordTransfer verbatim (spec #1195 §5)
so CustomDomainAttachCommand needs no changes. A .noToken search
opens the shared CloudflareTokenPromptView and resumes the search
once a token is saved."
```

---

### Task 6: `BuyDomainSheetView` (AnglesiteApp)

**Files:**
- Create: `Sources/AnglesiteApp/BuyDomainSheetView.swift`

**Interfaces:**
- Consumes: `BuyDomainModel` (Task 5), `CloudflareTokenPromptView` (Task 1).
- Produces: `struct BuyDomainSheetView: View` — `init(model: BuyDomainModel)` — consumed by Task 7's `SiteWindow.swift` wiring.

No dedicated unit tests — matches this codebase's existing convention (`ConnectDomainSheetView`/`DomainSheetView` have no view-level tests; only their models do, covered by Task 5). Verification is build success (Step 2) plus Task 7's manual pass.

- [ ] **Step 1: Implement**

Create `Sources/AnglesiteApp/BuyDomainSheetView.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// The "Buy a Domain" sheet (#1195): search, price, confirm, purchase. Reached from
/// `ConnectDomainSheetView`'s "Buy a domain" button.
struct BuyDomainSheetView: View {
    @Bindable var model: BuyDomainModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            footer
        }
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
        // Stacked on top of this already-open sheet (not a sibling `.sheet` on `SiteWindow`,
        // which can't reliably present two sheets from the same presentation context at once).
        .sheet(isPresented: $model.tokenPromptPresented) {
            CloudflareTokenPromptView(
                tokenVerification: model.tokenVerification,
                onSubmit: { await model.verifyAndSaveToken($0) },
                onCancel: { model.cancelTokenPrompt() }
            )
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.title)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Buy a Domain").font(.title3).fontWeight(.semibold)
                Text("Search, price, and register a domain through Cloudflare.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .searching:
            VStack(alignment: .leading, spacing: 12) {
                searchField(buttonTitle: "Search")
                escapeHatch
            }

        case .loadingResults:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Searching…").foregroundStyle(.secondary)
            }

        case .results(_, let candidates):
            VStack(alignment: .leading, spacing: 12) {
                if candidates.isEmpty {
                    Text("No results. Try a different search.").foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(candidates) { candidateRow($0) }
                        }
                    }
                    .frame(maxHeight: 280)
                }
                searchField(buttonTitle: "Search Again")
                escapeHatch
            }

        case .confirming(let candidate):
            VStack(alignment: .leading, spacing: 12) {
                Text("Buy \(candidate.name) for \(candidate.priceDisplay ?? "an unknown price")?")
                    .font(.headline)
                Text("This charges the payment method on file for your connected Cloudflare account.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { model.cancelConfirm() }
                    Spacer()
                    Button("Buy \(candidate.name)") { model.confirmPurchase() }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                }
            }

        case .purchasing:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Purchasing…").foregroundStyle(.secondary)
            }

        case .purchased(let hostname):
            Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)

        case .needsAccountSetup(let hostname):
            VStack(alignment: .leading, spacing: 8) {
                Text("Finish setting up billing for \(hostname) in the Cloudflare dashboard, then come back and try again.")
                escapeHatch
            }

        case .stillProcessing(let hostname):
            Text("Still processing \(hostname). Once it finishes, come back and use “I already own a domain” with \(hostname) to connect it.")

        case .failed(let reason):
            VStack(alignment: .leading, spacing: 8) {
                Text(reason).foregroundStyle(.red)
                escapeHatch
            }
        }
    }

    private func searchField(buttonTitle: String) -> some View {
        HStack {
            TextField("example", text: $model.queryInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.submitSearch() }
            Button(buttonTitle) { model.submitSearch() }
                .disabled(model.queryInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var escapeHatch: some View {
        Link("Buy directly on the Cloudflare dashboard instead", destination: BuyDomainModel.cloudflareDomainsURL)
            .font(.caption)
    }

    @ViewBuilder
    private func candidateRow(_ candidate: BuyDomainModel.DomainCandidate) -> some View {
        Button {
            model.selectCandidate(candidate)
        } label: {
            HStack {
                Text(candidate.name)
                Spacer()
                if candidate.registrable {
                    Text(candidate.priceDisplay ?? "")
                        .foregroundStyle(.secondary)
                } else {
                    Text(candidate.reason ?? "unavailable")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!candidate.registrable)
    }

    private var footer: some View {
        HStack {
            Button("Close") { model.dismissSheet() }
            Spacer()
        }
        .padding(16)
    }
}

#Preview {
    BuyDomainSheetView(model: BuyDomainModel())
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/BuyDomainSheetView.swift
git commit -m "feat(#1195): BuyDomainSheetView

Search field, results list with price/reason, confirm step,
purchasing spinner, and terminal states for BuyDomainModel's phase
machine. Nests the shared CloudflareTokenPromptView as its own
stacked sheet for the .noToken case."
```

---

### Task 7: Wire it up — `SiteWindowModel`, `SiteWindow`, `ConnectDomainSheetView`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:153-157` (property declarations), `:1925-1927` (configure call sites)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:653-655` (the `ConnectDomainSheetView` sheet)
- Modify: `Sources/AnglesiteApp/ConnectDomainSheetView.swift`

**Interfaces:**
- Consumes: `BuyDomainModel`/`BuyDomainSheetView` (Tasks 5-6), `ConnectDomainModel`/`ConnectDomainSheetView` (existing, unchanged behavior).
- Produces: nothing new consumed elsewhere — this is the final integration task.

`ConnectDomainModel.chooseBuy()` keeps recording its existing `DOMAIN_CHOICE=buy` intent marker exactly as it does today (`ConnectDomainModelTests.chooseBuyRecordsIntentAndDismisses` needs zero changes) — the only change is that the button that calls it *also* opens the new search sheet, via a new view-layer callback, instead of opening a browser link directly. This keeps `ConnectDomainModel` and `BuyDomainModel` fully decoupled — neither model knows the other exists.

- [ ] **Step 1: Add `onBuyDomain` to `ConnectDomainSheetView`**

In `Sources/AnglesiteApp/ConnectDomainSheetView.swift`, add a property and use it in the "Buy a domain" button. Change:

```swift
struct ConnectDomainSheetView: View {
    @Bindable var model: ConnectDomainModel
```

to:

```swift
struct ConnectDomainSheetView: View {
    @Bindable var model: ConnectDomainModel
    /// Opens the in-app search/purchase sheet (#1195) — called from the view layer (not chained
    /// inside `ConnectDomainModel`) so this model and `BuyDomainModel` stay fully decoupled,
    /// matching how `DeployDrawerView`'s first-publish nudge opens `connectDomain.openSheet()`
    /// directly rather than teaching `DeployModel` about `ConnectDomainModel`.
    let onBuyDomain: () -> Void
```

Then change the "Buy a domain" button (in the `.choosing` case of `content`) from:

```swift
                Button {
                    NSWorkspace.shared.open(ConnectDomainModel.cloudflareDomainsURL)
                    model.chooseBuy()
                } label: {
                    Label("Buy a domain", systemImage: "cart")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
```

to:

```swift
                Button {
                    model.chooseBuy()
                    onBuyDomain()
                } label: {
                    Label("Buy a domain", systemImage: "cart")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
```

(The direct `NSWorkspace.shared.open` call is removed — `BuyDomainSheetView` has its own "Buy directly on the Cloudflare dashboard instead" escape-hatch link now, so the browser no longer opens automatically on every "Buy a domain" click. That call was the file's only use of AppKit, so also delete the now-unused `import AppKit` line at the top of `ConnectDomainSheetView.swift`, leaving just `import SwiftUI`.)

- [ ] **Step 2: Add `buyDomain` to `SiteWindowModel`**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, near line 157 (right after `var connectDomain = ConnectDomainModel()`), add:

```swift
    var buyDomain = BuyDomainModel()
```

Near line 1927 (right after `connectDomain.configure(site: currentSite)`), add:

```swift
        buyDomain.configure(site: currentSite)
```

- [ ] **Step 3: Register the sheet and update the `ConnectDomainSheetView` call site**

In `Sources/AnglesiteApp/SiteWindow.swift`, replace lines 653-655:

```swift
        .sheet(isPresented: $bindableModel.connectDomain.sheetPresented) {
            ConnectDomainSheetView(model: model.connectDomain)
        }
```

with:

```swift
        .sheet(isPresented: $bindableModel.connectDomain.sheetPresented) {
            ConnectDomainSheetView(model: model.connectDomain, onBuyDomain: { model.buyDomain.openSheet() })
        }
        .sheet(isPresented: $bindableModel.buyDomain.sheetPresented) {
            BuyDomainSheetView(model: model.buyDomain)
        }
```

- [ ] **Step 4: Run the full app test suite**

Run: `swift test --package-path . --filter ConnectDomainModelTests`
Expected: all tests PASS unchanged (confirms `chooseBuy()`'s own behavior wasn't touched).

Run: `swift test --package-path .`
Expected: full suite PASSES (this also exercises the earlier tasks' tests together for the first time).

- [ ] **Step 5: Build the app**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Manual verification**

Launch the built app (`open` the built `.app`, or run from Xcode), open or create a site, and:
1. Publish once (or use `Website ▸ Connect a Domain…` if already published) to reach the Connect a Domain sheet.
2. Click "Buy a domain" — confirm `BuyDomainSheetView` opens (not a browser tab).
3. With no Cloudflare token configured, search a keyword — confirm the token prompt sheet appears stacked on top, and that saving a valid token resumes the search automatically.
4. With a token configured, search a keyword — confirm results show a price for available names and a grayed-out reason for unavailable ones.
5. Select an available result — confirm the price-confirmation step, then either complete a purchase or cancel out.
6. Confirm the "Buy directly on the Cloudflare dashboard instead" link works from the search screen and from a failed/needs-setup state.
7. If a purchase completes, confirm `.site-config` has `DOMAIN_CHOICE=transfer` + `DOMAIN=<hostname>` and `Source/anglesite.json`'s `domain` section matches.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/ConnectDomainSheetView.swift Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1195): wire BuyDomainSheetView into Connect a Domain

\"Buy a domain\" now opens the in-app search/purchase sheet instead
of a bare Cloudflare Domains link-out. ConnectDomainModel and
BuyDomainModel stay decoupled — the view layer wires them together."
```

---

## Self-Review Notes

**Spec coverage:** §1 (entry point) → Task 7 Step 1/3. §2 (architecture) → Tasks 2-5. §3 (phase machine/data flow) → Task 5, rendered by Task 6. §4 (error handling) → Task 5's `message(for:)` + `.noToken` branch, Task 6's `escapeHatch`. §5 (reuse transfer write) → Task 5's `runPurchase`. §6 (no-token handling) → Task 1 + Task 5's `verifyAndSaveToken`/`tokenPromptPresented`. §7 (code shape) → matches Tasks 1-7's file lists exactly. §8 (testing) → each task's Test file, with one intentional narrowing noted below.

**Deliberate scope trim vs. spec §8:** the spec's testing section says `needsToken` phase "resumes the pending search on `TokenOnboarding.Outcome.proceed`" should be tested. Task 5 tests only the *trigger* (`.noToken` → `tokenPromptPresented`), not the full resume-after-verify path, because `verifyAndSaveToken` is a structural copy of `DeployModel.verifyAndSaveToken` (same `TokenOnboarding.run` call, same closures), and `TokenOnboarding`'s own ordering (verify → persist → flash → re-check-cancel → proceed) is already thoroughly covered by `Tests/AnglesiteCoreTests/TokenOnboardingTests.swift`. Re-testing that ordering here through a real `TokenVerifying` fake plus a scratch `KeychainStore` would duplicate existing coverage for marginal value. If a reviewer wants the full path covered explicitly, add it as a follow-up test using the same `KeychainStore(service:)` scratch-service pattern `Tests/AnglesiteCoreTests/KeychainStoreTests.swift` already establishes.

**Placeholder scan:** none — every step has complete code or an exact command.

**Type consistency:** `RegistrarDomainCheck`, `RegistrarRegistrationOutcome`, `RegistrarOperationError`, `RegistrarOperationsService`, `CloudflareRegistrarReading`/`Writing`, `CloudflareTokenVerification`, `BuyDomainModel.DomainCandidate`/`Phase` are each defined once (Tasks 2-5) and consumed with identical signatures in every later task — cross-checked while drafting.
