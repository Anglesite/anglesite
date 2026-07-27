# Green Web Check Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `.greenHostCheck` Bucket-3 integration that queries the Green Web Foundation's Greencheck API for the site's deploy host during the wizard flow, and — if green — scaffolds a static badge component; if not green, explains why with no badge.

**Architecture:** Follows the existing `IntegrationDescriptor` → `IntegrationPlanner` → `IntegrationScaffolder` framework used by every other Bucket-3 integration (`Sources/AnglesiteCore/IntegrationCatalog.swift`). The one new wrinkle is the async network call: `IntegrationPlanner.plan` stays pure/synchronous (unchanged, ~30 existing call sites depend on that), and the async Greencheck HTTP call happens one layer up, in `IntegrationOperations.plan(...)` (already `async`), which folds the check result into `answers` before delegating to the planner. The result renders through the *existing* `.review` step's `planError`/`plan.warnings` machinery — no `IntegrationWizardModel` or GUI changes are needed.

**Tech Stack:** Swift 6.4, Swift Testing, `URLSession` (with `FoundationNetworking` fallback for Linux), Astro/TypeScript template component.

## Global Constraints

- No third-party JavaScript (ADR-0008) — the badge is a static server-rendered `<a>` link, no embedded TGWF script/widget.
- New dependencies need explicit approval first — this plan adds none (plain `URLSession`, matching `GitHubAPITokenVerifier`'s existing precedent).
- `IntegrationPlanner.plan` must remain synchronous/pure — do not change its signature.
- Every integration operation must stay idempotent (re-running the wizard is the only "update" path — there is no dedicated update mode in this codebase).
- Swift subject lines ≤72 chars; PR body must use `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan) per `CONTRIBUTING.md`.
- Verified API contract (fetched live 2026-07-23 from `developers.thegreenwebfoundation.org`): `GET https://api.thegreenwebfoundation.org/api/v3/greencheck/{hostname}` → JSON body with a `"green": true|false` boolean field. The human-facing result page is deep-linkable: `https://www.thegreenwebfoundation.org/green-web-check/?url={hostname}` (confirmed live — this actually renders a per-domain result).

---

## File Structure

- **Create** `Sources/AnglesiteCore/GreenHostChecker.swift` — the Greencheck API client (mirrors `GitHubAPITokenVerifier.swift`'s injectable-transport pattern).
- **Modify** `Sources/AnglesiteCore/IntegrationDescriptor.swift` — add `.greenHostCheck` to `IntegrationID`.
- **Modify** `Sources/AnglesiteCore/IntegrationPlan.swift` — add two `IntegrationError` cases (`.deployRequired`, `.externalCheckFailed`).
- **Modify** `Sources/AnglesiteCore/IntegrationCatalog.swift` — register the `greenHostCheck` descriptor.
- **Modify** `Sources/AnglesiteCore/IntegrationOperationsService.swift` — inject a `GreenHostChecking` dependency into `IntegrationOperations`; special-case `.greenHostCheck` in `plan(...)`.
- **Modify** `Sources/AnglesiteCore/SetupIntegrationTool.swift` — handle the two new `IntegrationError` cases in `SetupIntegrationArguments.reply` (required for exhaustiveness — this switch has no `default:`).
- **Create** `Resources/Template/integrations/components/GreenHostBadge.astro` — the static badge component.
- **Create** `Tests/AnglesiteCoreTests/GreenHostCheckerTests.swift`.
- **Modify** `Tests/AnglesiteCoreTests/IntegrationCatalogTests.swift` — register `.greenHostCheck` + a structural test.
- **Modify** `Tests/AnglesiteCoreTests/IntegrationOperationsTests.swift` — end-to-end plan+apply coverage for green / not-green / network-failure / deploy-required paths.

---

## Task 1: `GreenHostChecker` API client

**Files:**
- Create: `Sources/AnglesiteCore/GreenHostChecker.swift`
- Test: `Tests/AnglesiteCoreTests/GreenHostCheckerTests.swift`

**Interfaces:**
- Produces: `public enum GreenHostCheckResult: Equatable, Sendable { case green, notGreen }`, `public enum GreenHostCheckError: Error, Equatable, Sendable { case network, unavailable(String) }`, `public protocol GreenHostChecking: Sendable { func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError> }`, `public struct GreenHostChecker: GreenHostChecking` with `public init(baseURL: URL = ..., transport: @escaping Transport = GreenHostChecker.defaultTransport)`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/GreenHostCheckerTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for the TGWF Greencheck API client used by the greenHostCheck integration (#684).
/// The HTTP step is injected, so classification is exercised without real network — mirrors
/// GitHubAPITokenVerifierTests.
struct GreenHostCheckerTests {
    private static func transport(status: Int, json: String) -> GreenHostChecker.Transport {
        { request in
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(json.utf8), http)
        }
    }

    @Test("a green host maps to .green")
    func greenHost() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: #"{"url":"example.com","green":true}"#))
        let result = await checker.check(hostname: "example.com")
        #expect(result == .success(.green))
    }

    @Test("a non-green host maps to .notGreen, not an error")
    func notGreenHost() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: #"{"url":"example.com","green":false}"#))
        let result = await checker.check(hostname: "example.com")
        #expect(result == .success(.notGreen))
    }

    @Test("a connection failure maps to .network, not .notGreen")
    func networkFailure() async {
        let checker = GreenHostChecker(transport: { _ in throw URLError(.notConnectedToInternet) })
        let result = await checker.check(hostname: "example.com")
        #expect(result == .failure(.network))
    }

    @Test("a transient server error (5xx/429) maps to .unavailable, not .notGreen")
    func transientServerError() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 503, json: #"{}"#))
        let result = await checker.check(hostname: "example.com")
        guard case .failure(.unavailable) = result else {
            Issue.record("expected .unavailable, got \(result)"); return
        }
    }

    @Test("an unparseable body maps to .unavailable")
    func unparseableBody() async {
        let checker = GreenHostChecker(transport: Self.transport(status: 200, json: "not json"))
        let result = await checker.check(hostname: "example.com")
        guard case .failure(.unavailable) = result else {
            Issue.record("expected .unavailable, got \(result)"); return
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter GreenHostCheckerTests`
Expected: FAIL — "cannot find type 'GreenHostChecker' in scope" (the type doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/GreenHostChecker.swift
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The result of a Green Web Foundation Greencheck lookup. Distinct from `GreenHostCheckError`
/// so a definitive "not green" (a successful, negative answer) is never conflated with a failed
/// check (network failure or an unreachable/broken API) — issue #684's explicit requirement.
public enum GreenHostCheckResult: Equatable, Sendable {
    case green
    case notGreen
}

public enum GreenHostCheckError: Error, Equatable, Sendable {
    case network
    case unavailable(String)
}

public protocol GreenHostChecking: Sendable {
    func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError>
}

/// Client for the Green Web Foundation's public Greencheck API (verified 2026-07-23 against
/// developers.thegreenwebfoundation.org): `GET .../api/v3/greencheck/{hostname}` → `{"green": bool, ...}`.
public struct GreenHostChecker: GreenHostChecking {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let baseURL: URL
    private let transport: Transport

    public init(
        baseURL: URL = URL(string: "https://api.thegreenwebfoundation.org/api/v3/greencheck")!,
        transport: @escaping Transport = GreenHostChecker.defaultTransport
    ) {
        self.baseURL = baseURL
        self.transport = transport
    }

    public func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError> {
        let request = URLRequest(url: baseURL.appendingPathComponent(hostname))
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            return .failure(.network)
        }
        if http.statusCode == 429 || http.statusCode >= 500 {
            return .failure(.unavailable("The Green Web Foundation is unavailable right now (HTTP \(http.statusCode)). Try again in a moment."))
        }
        guard (200..<300).contains(http.statusCode),
              let body = try? JSONDecoder().decode(GreenCheckResponse.self, from: data)
        else {
            return .failure(.unavailable("The Green Web Foundation returned an unexpected response while checking your host."))
        }
        return .success(body.green ? .green : .notGreen)
    }

    private struct GreenCheckResponse: Decodable { let green: Bool }

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter GreenHostCheckerTests`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/GreenHostChecker.swift Tests/AnglesiteCoreTests/GreenHostCheckerTests.swift
git commit -m "feat(#684): add GreenHostChecker Greencheck API client"
```

---

## Task 2: `IntegrationID` and `IntegrationError` additions

**Files:**
- Modify: `Sources/AnglesiteCore/IntegrationDescriptor.swift:1-7`
- Modify: `Sources/AnglesiteCore/IntegrationPlan.swift:45-60`
- Modify: `Sources/AnglesiteCore/SetupIntegrationTool.swift:15-43`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IntegrationID.greenHostCheck` case; `IntegrationError.deployRequired` and `IntegrationError.externalCheckFailed(String)` cases, consumed by Task 5.

- [ ] **Step 1: Add the `IntegrationID` case**

In `Sources/AnglesiteCore/IntegrationDescriptor.swift`, change:

```swift
public enum IntegrationID: String, Sendable, CaseIterable {
    case booking, contact, donations, giscus, newsletter, consent, pwa, redirects
    case tracking, share, podcast
    case indieweb, menu
    case buyButton, lemonSqueezy, paddle, snipcart, shopifyBuyButton
    case inbox, membership, carbonTxt
}
```

to:

```swift
public enum IntegrationID: String, Sendable, CaseIterable {
    case booking, contact, donations, giscus, newsletter, consent, pwa, redirects
    case tracking, share, podcast
    case indieweb, menu
    case buyButton, lemonSqueezy, paddle, snipcart, shopifyBuyButton
    case inbox, membership, carbonTxt, greenHostCheck
}
```

- [ ] **Step 2: Add the `IntegrationError` cases**

In `Sources/AnglesiteCore/IntegrationPlan.swift`, change:

```swift
public enum IntegrationError: Error, Equatable, Sendable {
    case missingRequiredField(key: String)
    case invalidValue(key: String, reason: String)
    case unknownProvider(String)
    case providerRequired
    case siteNotFound
    case templateUnavailable
    /// A staged asset the descriptor copies is absent from the template — a hard error, since
    /// proceeding would inject an `import` for a file that was never written.
    case missingTemplateAsset(path: String)
    /// An `.appendLine` operation's resolved line already exists verbatim in the target file —
    /// e.g. reopening the redirects wizard with the same answers twice. Unlike `.copyFile`
    /// (idempotent by construction — same content in, same content out), `.appendLine`
    /// accumulates, so without this check a repeat run would duplicate the line.
    case duplicateLine(file: String)
}
```

to:

```swift
public enum IntegrationError: Error, Equatable, Sendable {
    case missingRequiredField(key: String)
    case invalidValue(key: String, reason: String)
    case unknownProvider(String)
    case providerRequired
    case siteNotFound
    case templateUnavailable
    /// A staged asset the descriptor copies is absent from the template — a hard error, since
    /// proceeding would inject an `import` for a file that was never written.
    case missingTemplateAsset(path: String)
    /// An `.appendLine` operation's resolved line already exists verbatim in the target file —
    /// e.g. reopening the redirects wizard with the same answers twice. Unlike `.copyFile`
    /// (idempotent by construction — same content in, same content out), `.appendLine`
    /// accumulates, so without this check a repeat run would duplicate the line.
    case duplicateLine(file: String)
    /// The site has never been deployed and has no known deploy host yet (`DeployCoordinator
    /// .resolveSiteURL` returned nil) — greenHostCheck needs a live host to query.
    case deployRequired
    /// An external API call an integration depends on during planning (greenHostCheck's TGWF
    /// lookup) failed — network failure or a non-2xx/unparseable response. The message is
    /// already user-facing, classified by the caller (e.g. `GreenHostChecker`).
    case externalCheckFailed(String)
}
```

- [ ] **Step 3: Handle the new cases in `SetupIntegrationArguments.reply`**

In `Sources/AnglesiteCore/SetupIntegrationTool.swift`, this switch has no `default:` case, so it will fail to compile once the two new `IntegrationError` cases exist. Change:

```swift
        case .failure(.duplicateLine):
            return "That's already there — nothing to add."
        }
    }
```

to:

```swift
        case .failure(.duplicateLine):
            return "That's already there — nothing to add."
        case .failure(.deployRequired):
            return "This site hasn't been deployed yet, so there's no host to check. Deploy it first, then try again."
        case .failure(.externalCheckFailed(let message)):
            return message
        }
    }
```

- [ ] **Step 4: Build to confirm it compiles**

Run: `swift build --package-path .`
Expected: builds cleanly (no behavior change yet — `.greenHostCheck` isn't registered in the catalog until Task 4, so nothing constructs these new cases yet).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/IntegrationDescriptor.swift Sources/AnglesiteCore/IntegrationPlan.swift Sources/AnglesiteCore/SetupIntegrationTool.swift
git commit -m "feat(#684): add greenHostCheck ID and integration error cases"
```

---

## Task 3: `GreenHostBadge.astro` template component

**Files:**
- Create: `Resources/Template/integrations/components/GreenHostBadge.astro`

**Interfaces:**
- Produces: an Astro component with `Props { hostname: string; checkedAt?: string }`, no CSP domains needed (plain outbound `<a>`, no embedded script/image — matches the ADR-0008 constraint and `carbon.txt`'s "no third-party JS" precedent).

- [ ] **Step 1: Write the component**

```astro
---
// Static, build-time-only badge — no client-side fetch or third-party script (ADR-0008).
// GREEN_HOST_VERIFIED/GREEN_HOST_NAME/GREEN_HOST_CHECKED_AT are written by the greenHostCheck
// integration wizard at setup time; the caller only renders this when GREEN_HOST_VERIFIED === "true".
interface Props {
  hostname: string;
  checkedAt?: string;
}
const { hostname, checkedAt } = Astro.props;
const checkURL = `https://www.thegreenwebfoundation.org/green-web-check/?url=${hostname}`;
---
<a
  href={checkURL}
  class="green-host-badge"
  target="_blank"
  rel="noopener noreferrer"
  title={checkedAt ? `Verified green hosting as of ${checkedAt}` : "Verified green hosting"}
>
  🌱 Green Hosting Verified
</a>
<style>
  .green-host-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.35em 0.75em;
    border-radius: 999px;
    background: #e6f4ea;
    color: #1e4620;
    font-size: 0.85rem;
    text-decoration: none;
    border: 1px solid #b7dfc0;
  }
  .green-host-badge:hover {
    background: #d5ecd9;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add Resources/Template/integrations/components/GreenHostBadge.astro
git commit -m "feat(#684): add GreenHostBadge.astro template component"
```

---

## Task 4: Register the `greenHostCheck` descriptor in `IntegrationCatalog`

**Files:**
- Modify: `Sources/AnglesiteCore/IntegrationCatalog.swift:49-56` (registration) and end of file (new descriptor)
- Modify: `Tests/AnglesiteCoreTests/IntegrationCatalogTests.swift:6-13`

**Interfaces:**
- Consumes: `IntegrationID.greenHostCheck` (Task 2), `TemplateRef("integrations/components/GreenHostBadge.astro")` (Task 3).
- Produces: `IntegrationCatalog.descriptor(for: .greenHostCheck)`, consumed by Task 5's tests.

- [ ] **Step 1: Write the failing catalog test**

In `Tests/AnglesiteCoreTests/IntegrationCatalogTests.swift`, change `hasAllIntegrations()`:

```swift
    @Test func hasAllIntegrations() {
        #expect(Set(IntegrationCatalog.all.map(\.id)) == Set([
            .booking, .contact, .donations, .giscus, .newsletter, .consent, .pwa, .redirects,
            .tracking, .share, .podcast,
            .indieweb, .menu,
            .buyButton, .lemonSqueezy, .paddle, .snipcart, .shopifyBuyButton,
            .inbox, .membership, .carbonTxt,
        ]))
    }
```

to:

```swift
    @Test func hasAllIntegrations() {
        #expect(Set(IntegrationCatalog.all.map(\.id)) == Set([
            .booking, .contact, .donations, .giscus, .newsletter, .consent, .pwa, .redirects,
            .tracking, .share, .podcast,
            .indieweb, .menu,
            .buyButton, .lemonSqueezy, .paddle, .snipcart, .shopifyBuyButton,
            .inbox, .membership, .carbonTxt, .greenHostCheck,
        ]))
    }
```

and add a structural test for the new descriptor (append inside `IntegrationCatalogTests`, mirroring `carbonTxtScaffoldsAStaticPublicFileWithoutCSP`):

```swift
    @Test func greenHostCheckHasNoProvidersNoFieldsNoCSP() {
        let d = IntegrationCatalog.descriptor(for: .greenHostCheck)
        #expect(d.providers.isEmpty)
        #expect(d.fields.isEmpty)
        #expect(!d.operations.contains { if case .addCSPDomains = $0 { return true }; return false })
        #expect(d.operations.contains {
            if case .copyFile(let from, let to, let when) = $0 {
                return from.path == "integrations/components/GreenHostBadge.astro"
                    && to.raw == "src/components/GreenHostBadge.astro" && when == .always
            }
            return false
        })
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter IntegrationCatalogTests`
Expected: FAIL — `hasAllIntegrations` (set mismatch) and `greenHostCheckHasNoProvidersNoFieldsNoCSP` (`fatalError: Unregistered integration: greenHostCheck`, or a build error since `.greenHostCheck` case doesn't exist as a descriptor reference yet — either way, red).

- [ ] **Step 3: Register the descriptor**

In `Sources/AnglesiteCore/IntegrationCatalog.swift`, change:

```swift
public enum IntegrationCatalog {
    public static let all: [IntegrationDescriptor] = [
        booking, contact, donations, giscus, newsletter, consent, pwa, redirects,
        tracking, share, podcast,
        indieweb, menu,
        buyButton, lemonSqueezy, paddle, snipcart, shopifyBuyButton,
        inbox, membership, carbonTxt,
    ]
```

to:

```swift
public enum IntegrationCatalog {
    public static let all: [IntegrationDescriptor] = [
        booking, contact, donations, giscus, newsletter, consent, pwa, redirects,
        tracking, share, podcast,
        indieweb, menu,
        buyButton, lemonSqueezy, paddle, snipcart, shopifyBuyButton,
        inbox, membership, carbonTxt, greenHostCheck,
    ]
```

Then append the descriptor definition at the end of the file (after the existing `carbonTxt` descriptor):

```swift
    // MARK: greenHostCheck
    // No user-facing fields: the check result (`green`/`hostname`/`checkedAt`) is resolved by an
    // async Greencheck API call in IntegrationOperations.plan (Task 5) and folded into `answers`
    // before this descriptor's operations run — so `.wizard` visits `.fields` with zero fields
    // and falls straight through to `.review` (IntegrationWizardModel.canContinue is vacuously
    // true for an empty `visibleFields` list).
    //
    // The badge component and its render snippet are always applied (`when: .always`), mirroring
    // PWA's InstallPrompt/booking's floating-widget precedent: the runtime `readConfig(...)
    // === "true"` conditional inside the injected snippet does the gating, not the Operation
    // itself — this avoids needing "green" declared as a Field (which validate() would otherwise
    // require, and which would render as an editable GUI control, wrong for an app-computed value).
    static let greenHostCheck = IntegrationDescriptor(
        id: .greenHostCheck,
        displayName: "Green Web Check",
        summary: "Verify your deploy host is on the Green Web Foundation's green hosting directory, and show a badge if it is.",
        providers: [],
        fields: [],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/GreenHostBadge.astro"),
                      to: "src/components/GreenHostBadge.astro", when: .always),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import GreenHostBadge from \"../components/GreenHostBadge.astro\";\nimport { readConfig } from \"../../scripts/config\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "{readConfig(\"GREEN_HOST_VERIFIED\") === \"true\" && (<GreenHostBadge hostname={readConfig(\"GREEN_HOST_NAME\")} checkedAt={readConfig(\"GREEN_HOST_CHECKED_AT\")} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "GREEN_HOST_VERIFIED", value: "{{green}}"),
                ConfigEntry(key: "GREEN_HOST_NAME", value: "{{hostname}}"),
                ConfigEntry(key: "GREEN_HOST_CHECKED_AT", value: "{{checkedAt}}"),
            ], when: .always),
        ])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter IntegrationCatalogTests`
Expected: PASS — including the pre-existing `eachDescriptorIsStructurallyValid` parameterized test, which now also runs against `greenHostCheck` and confirms `validate()` finds no dangling `Condition` references (there are none — every operation uses `when: .always`).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/IntegrationCatalog.swift Tests/AnglesiteCoreTests/IntegrationCatalogTests.swift
git commit -m "feat(#684): register greenHostCheck descriptor in IntegrationCatalog"
```

---

## Task 5: Wire the async Greencheck call into `IntegrationOperations.plan`

**Files:**
- Modify: `Sources/AnglesiteCore/IntegrationOperationsService.swift`
- Modify: `Tests/AnglesiteCoreTests/IntegrationOperationsTests.swift`

**Interfaces:**
- Consumes: `GreenHostChecking`/`GreenHostChecker`/`GreenHostCheckResult`/`GreenHostCheckError` (Task 1), `IntegrationError.deployRequired`/`.externalCheckFailed` (Task 2), `IntegrationCatalog.descriptor(for: .greenHostCheck)` (Task 4), `DeployCoordinator.resolveSiteURL(siteDirectory: URL) -> String?` (existing, `Sources/AnglesiteCore/DeployCoordinator.swift:106`).
- Produces: `IntegrationOperations.init(sourceDirectory:templateDirectory:fileManager:greenHostChecker:)` — the new `greenHostChecker` parameter defaults to `GreenHostChecker()`, so every existing call site (including `IntegrationOperations.live()`) keeps compiling unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/IntegrationOperationsTests.swift` (inside `@Suite struct IntegrationOperationsTests`, after the newsletter tests):

```swift
    struct FakeGreenHostChecker: GreenHostChecking {
        let result: Result<GreenHostCheckResult, GreenHostCheckError>
        func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError> { result }
    }

    func makeGreenHostCheckTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-green-\(UUID().uuidString)")
        let url = root.appendingPathComponent("integrations/components/GreenHostBadge.astro")
        try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try! "BADGE".write(to: url, atomically: true, encoding: .utf8)
        return root
    }

    /// A deployed site (`.site-config` carries `SITE_URL`) with a green host: the badge is
    /// scaffolded, GREEN_HOST_VERIFIED=true is written, and no "not green" warning is added.
    @Test func planThenApplySucceedsForGreenHostCheckWhenGreen() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let tmpl = makeGreenHostCheckTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.green)))
        guard case .success(let plan) = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        #expect(plan.warnings.isEmpty)
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "greenHostCheck"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/GreenHostBadge.astro").path))
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("GREEN_HOST_VERIFIED=true"))
        #expect(config.contains("GREEN_HOST_NAME=example.workers.dev"))
    }

    /// A not-green result still succeeds (it's a valid, informative outcome, not a plan failure)
    /// but writes GREEN_HOST_VERIFIED=false and surfaces an explanatory warning — issue #684 point 3.
    @Test func planSucceedsWithWarningForGreenHostCheckWhenNotGreen() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let tmpl = makeGreenHostCheckTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.notGreen)))
        guard case .success(let plan) = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        #expect(!plan.warnings.isEmpty)
        #expect(plan.warnings.first?.message.contains("example.workers.dev") == true)
        _ = await ops.apply(plan, siteID: "s1")
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("GREEN_HOST_VERIFIED=false"))
    }

    /// A network failure during the check must surface as a distinct, retryable plan error — not
    /// be silently treated as "not green" (issue #684's explicit requirement 5).
    @Test func planFailsDistinctlyOnGreenHostCheckNetworkFailure() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { self.makeGreenHostCheckTemplate() },
                                        greenHostChecker: FakeGreenHostChecker(result: .failure(.network)))
        let r = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1")
        guard case .failure(.externalCheckFailed) = r else {
            Issue.record("expected .externalCheckFailed, got \(r)"); return
        }
    }

    /// No deploy host known yet (no SITE_URL/DOMAIN in `.site-config`) is a distinct precondition
    /// failure, not a network failure — there's nothing to query yet.
    @Test func planFailsWhenNoDeployHostKnownForGreenHostCheck() async {
        let ops = IntegrationOperations(sourceDirectory: { _ in self.makeBookingSource() },
                                        templateDirectory: { self.makeGreenHostCheckTemplate() },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.green)))
        let r = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1")
        #expect(r == .failure(.deployRequired))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter IntegrationOperationsTests`
Expected: FAIL to build — `IntegrationOperations(sourceDirectory:templateDirectory:greenHostChecker:)` has no such initializer parameter yet.

- [ ] **Step 3: Wire the dependency and special-case `plan(...)`**

In `Sources/AnglesiteCore/IntegrationOperationsService.swift`, change:

```swift
public struct IntegrationOperations: IntegrationOperationsService {
    private let sourceDirectory: @Sendable (String) async -> URL?
    private let templateDirectory: @Sendable () -> URL?
    private let scaffolder: IntegrationScaffolder
    private let fm: SendableFileManager

    public init(sourceDirectory: @escaping @Sendable (String) async -> URL?,
                templateDirectory: @escaping @Sendable () -> URL?,
                fileManager: FileManager = .default) {
        self.sourceDirectory = sourceDirectory
        self.templateDirectory = templateDirectory
        self.fm = SendableFileManager(value: fileManager)
        // Wrap in SendableFileManager to cross the actor-init isolation boundary cleanly.
        let sfm = SendableFileManager(value: fileManager)
        self.scaffolder = IntegrationScaffolder(fileManager: sfm.value)
    }

    public func descriptors() -> [IntegrationDescriptor] { IntegrationCatalog.all }

    public func plan(integrationID: IntegrationID, answers: Answers, siteID: String) async -> Result<OperationPlan, IntegrationError> {
        guard let source = await sourceDirectory(siteID) else { return .failure(.siteNotFound) }
        guard let template = templateDirectory() else { return .failure(.templateUnavailable) }
        return IntegrationPlanner.plan(descriptor: IntegrationCatalog.descriptor(for: integrationID),
                                       answers: answers, sourceDirectory: source, templateDirectory: template,
                                       fileManager: fm.value)
    }
```

to:

```swift
public struct IntegrationOperations: IntegrationOperationsService {
    private let sourceDirectory: @Sendable (String) async -> URL?
    private let templateDirectory: @Sendable () -> URL?
    private let scaffolder: IntegrationScaffolder
    private let fm: SendableFileManager
    private let greenHostChecker: any GreenHostChecking

    public init(sourceDirectory: @escaping @Sendable (String) async -> URL?,
                templateDirectory: @escaping @Sendable () -> URL?,
                fileManager: FileManager = .default,
                greenHostChecker: any GreenHostChecking = GreenHostChecker()) {
        self.sourceDirectory = sourceDirectory
        self.templateDirectory = templateDirectory
        self.fm = SendableFileManager(value: fileManager)
        self.greenHostChecker = greenHostChecker
        // Wrap in SendableFileManager to cross the actor-init isolation boundary cleanly.
        let sfm = SendableFileManager(value: fileManager)
        self.scaffolder = IntegrationScaffolder(fileManager: sfm.value)
    }

    public func descriptors() -> [IntegrationDescriptor] { IntegrationCatalog.all }

    public func plan(integrationID: IntegrationID, answers: Answers, siteID: String) async -> Result<OperationPlan, IntegrationError> {
        guard let source = await sourceDirectory(siteID) else { return .failure(.siteNotFound) }
        guard let template = templateDirectory() else { return .failure(.templateUnavailable) }

        var resolvedAnswers = answers
        if integrationID == .greenHostCheck {
            guard let siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: source),
                  let hostname = URL(string: siteURL)?.host else {
                return .failure(.deployRequired)
            }
            switch await greenHostChecker.check(hostname: hostname) {
            case .success(let result):
                resolvedAnswers["green"] = result == .green ? "true" : "false"
                resolvedAnswers["hostname"] = hostname
                resolvedAnswers["checkedAt"] = ISO8601DateFormatter().string(from: Date())
            case .failure(.network):
                return .failure(.externalCheckFailed(
                    "Couldn't reach the Green Web Foundation to check your host. Check your connection and try again."))
            case .failure(.unavailable(let message)):
                return .failure(.externalCheckFailed(message))
            }
        }

        let result = IntegrationPlanner.plan(descriptor: IntegrationCatalog.descriptor(for: integrationID),
                                             answers: resolvedAnswers, sourceDirectory: source, templateDirectory: template,
                                             fileManager: fm.value)
        guard integrationID == .greenHostCheck, resolvedAnswers["green"] == "false",
              case .success(let plan) = result else {
            return result
        }
        // A "not green" result isn't a failure — the check succeeded, the badge just isn't
        // offered (issue #684 point 3). Surface the explanation as a plan warning, which the
        // existing review step already renders (same mechanism as brandColor/siteName fallbacks).
        return .success(OperationPlan(
            integrationID: plan.integrationID,
            steps: plan.steps,
            warnings: plan.warnings + [PlanWarning(
                "The Green Web Foundation didn't find \(resolvedAnswers["hostname"] ?? "your host") in its green hosting " +
                "directory, so no badge will show. If this is unexpected, check " +
                "https://www.thegreenwebfoundation.org/directory/ or your host's own sustainability page — your host " +
                "may need to register, or this may be a different domain than the one that's certified.")]))
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter IntegrationOperationsTests`
Expected: PASS (all existing `IntegrationOperationsTests` cases plus the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/IntegrationOperationsService.swift Tests/AnglesiteCoreTests/IntegrationOperationsTests.swift
git commit -m "feat(#684): wire Greencheck lookup into IntegrationOperations.plan"
```

---

## Task 6: Full verification and PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full Swift package test suite**

Run: `swift test --package-path .`
Expected: PASS — no regressions in `AnglesiteCoreTests` (or any other target).

- [ ] **Step 2: Build the app target**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED. (If `Anglesite.xcodeproj` is missing/stale in this worktree, run `xcodegen generate` first per this repo's worktree guidance.)

- [ ] **Step 3: Re-check against `CONTRIBUTING.md`**

Confirm: conventional commit subjects ≤72 chars (all of Tasks 1–5's commits qualify); no new third-party dependency; `Resources/Template/` changed → `swift test` was run (Step 1 covers this — `IntegrationCatalogTests`/`IntegrationOperationsTests`/`IntegrationScaffolderTests` all couple to template markup); no MCP schema change, so no paired sidecar-repo PR is needed.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin HEAD
```

Open the PR with `gh pr create`, using `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (**Summary**, **Paired PR check**, **Test plan**) per `CONTRIBUTING.md` — note in **Paired PR check** that this is app/template-only, no sidecar schema change. Reference `Closes #684`.

- [ ] **Step 5: Remove the in-progress label**

```bash
gh issue edit 684 --remove-label "🛠️ In Progress"
```

---

## Self-Review Notes

- **Spec coverage:** Issue #684's 4 numbered requirements map to: (1) Task 5's `DeployCoordinator.resolveSiteURL` + `GreenHostChecker.check` call inside `plan(...)`; (2) Task 4's `.copyFile`/`.injectAtAnchor`/`.writeConfig` operations + Task 3's badge; (3) Task 5's "not green" warning branch (no badge renders because the injected snippet's `readConfig(...) === "true"` guard is false, and the explanation surfaces via `plan.warnings`, which `IntegrationWizardModel`/`SetupIntegrationArguments.reply` already render); (4) no dedicated "update" mode exists anywhere in this codebase (confirmed: `IntegrationWizardModel.Step` has no `.update` case, and the design doc explicitly scopes this framework to "add + idempotent update only") — re-checking means re-running the same wizard, which is safe because every operation here is idempotent (`.writeConfig` upserts, `.copyFile`/`.injectAtAnchor` are content-stable). This is a deliberate, smaller scope than the issue's "easy re-check/re-trigger path" phrasing might imply; flag it in the PR description rather than building new wizard UI for it.
- **Placeholder scan:** none found — every step has complete, concrete code.
- **Type consistency:** `GreenHostChecking`/`GreenHostChecker`/`GreenHostCheckResult`/`GreenHostCheckError` (Task 1) match their usage in Task 5 exactly; `IntegrationError.deployRequired`/`.externalCheckFailed(String)` (Task 2) match Task 5's `return .failure(...)` call sites; `TemplateRef("integrations/components/GreenHostBadge.astro")` (Task 4) matches the file Task 3 creates and the `makeGreenHostCheckTemplate()` fixture in Task 5's tests.
