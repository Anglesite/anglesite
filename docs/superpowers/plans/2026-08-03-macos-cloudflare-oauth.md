# macOS Cloudflare OAuth Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `CloudflareTokenPromptView`'s paste-a-token flow with "Sign in with Cloudflare"
OAuth, reusing the already-portable `CloudflareOAuthClient` (AnglesiteCore), so `DeployModel` can
obtain and silently refresh a Cloudflare API bearer token without the user hand-creating a custom
token.

**Architecture:** Extend `OAuthToken`/`CloudflareOAuthClient` with refresh-token support, add a new
Keychain-backed OAuth credential slot (access + refresh + expiry + token endpoint), and a small
`CloudflareOAuthTokenSource` that resolves/refreshes it — all in `AnglesiteCore`, fully unit-tested
with injected fakes. `AnglesiteAppCore` (`Sources/AnglesiteApp/`) gets a thin `ASWebAuthenticationSession`
presentation layer and a new sign-in view, wired into `DeployModel`'s existing verify → persist →
flash → proceed state machine (`TokenOnboarding`, unchanged) by treating the OAuth access token
exactly like a pasted one.

**Tech Stack:** Swift 6.4, Swift Testing (`AnglesiteCoreTests`) + XCTest (`KeychainStoreTests`),
`AuthenticationServices` (`ASWebAuthenticationSession`), Keychain (`SecItem`).

## Global Constraints

- Design doc: [`docs/superpowers/specs/2026-08-03-macos-cloudflare-oauth-design.md`](../specs/2026-08-03-macos-cloudflare-oauth-design.md) — every task below implements a specific section of it.
- `Sources/AnglesiteApp/*.swift` compiles into the **`AnglesiteAppCore`** SwiftPM target (`Package.swift`, gated `canImport(Darwin)`), not a separate `AnglesiteApp` module — new files there `import AppKit`/`AuthenticationServices` freely (no Linux target to guard against) and are tested via `@testable import AnglesiteAppCore` in `Tests/AnglesiteAppTests/`.
- `AnglesiteCore` changes are portable (no Darwin-only imports beyond the existing `#if canImport(CryptoKit)` guard already in `CloudflareOAuthClient.swift`).
- Run `swift test --package-path .` after every task; run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` after Tasks 9–10 (the app-target/UI/entitlements tasks). `xcodegen generate` isn't needed unless `project.yml` itself changes (it doesn't in this plan — the entitlements files already exist and are already referenced).
- Conventional commits, subject ≤72 chars, reference `#1204`.
- No placeholder code — every step below is the actual diff to make.

---

### Task 1: `OAuthToken` refresh field + `CloudflareOAuthClient.refresh(...)`

**Files:**
- Modify: `Sources/AnglesiteCore/CloudflareOAuthClient.swift`
- Test: `Tests/AnglesiteCoreTests/CloudflareOAuthClientTests.swift`

**Interfaces:**
- Produces: `OAuthToken.refreshToken: String?`; `CloudflareOAuthRequest.tokenEndpoint: URL` (now `public`, was internal); `CloudflareOAuthClient.refresh(refreshToken: String, tokenEndpoint: URL) async throws -> OAuthToken`.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/CloudflareOAuthClientTests.swift`, inside `CloudflareOAuthClientTests`, a new `// MARK: Refresh` section:

```swift
    // MARK: Refresh

    @Test("refresh posts grant_type=refresh_token and decodes the new token")
    func refreshPostsGrantType() async throws {
        var capturedBody: String?
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { req in
                capturedBody = req.httpBody.flatMap { String(data: $0, encoding: .utf8) }
                let body = #"{"access_token":"new-tok","token_type":"bearer","expires_in":3600,"refresh_token":"new-refresh"}"#
                return (Data(body.utf8), self.response(200))
            })
        let token = try await client.refresh(
            refreshToken: "old-refresh",
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!)

        #expect(token.accessToken == "new-tok")
        #expect(token.refreshToken == "new-refresh")
        #expect(capturedBody?.contains("grant_type=refresh_token") == true)
        #expect(capturedBody?.contains("refresh_token=old-refresh") == true)
    }

    @Test("a non-2xx refresh response throws .tokenExchangeFailed")
    func refreshHTTPFailure() async {
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { _ in (Data("bad".utf8), self.response(400)) })
        await #expect(throws: CloudflareOAuthError.self) {
            _ = try await client.refresh(
                refreshToken: "old", tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!)
        }
    }

    @Test("OAuthToken decodes an absent refresh_token as nil")
    func tokenWithoutRefreshTokenDecodesNil() throws {
        let data = Data(#"{"access_token":"tok","token_type":"bearer"}"#.utf8)
        let token = try JSONDecoder().decode(OAuthToken.self, from: data)
        #expect(token.refreshToken == nil)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareOAuthClientTests`
Expected: FAIL — `refresh` and `refreshToken` don't exist yet (compile error).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/CloudflareOAuthClient.swift`, change `OAuthToken`:

```swift
public struct OAuthToken: Decodable, Sendable, Equatable {
    /// The bearer token subsequent Cloudflare API calls present.
    public let accessToken: String
    /// The token type as the server reported it (expected `bearer`) — carried through verbatim
    /// rather than asserted, so an unexpected value surfaces to the caller instead of failing
    /// the decode.
    public let tokenType: String
    /// Lifetime in seconds, when the server reports one. Optional because `expires_in` is a
    /// recommended-not-required field of the token response.
    public let expiresIn: Int?
    /// Present when the server issues one — lets the caller renew the access token without a
    /// fresh interactive sign-in. Optional because not every grant is guaranteed to return one.
    public let refreshToken: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
    }
}
```

Change `CloudflareOAuthRequest.tokenEndpoint` from internal to public (needed by `AnglesiteAppCore`
in Task 7 to persist alongside the credential for later refresh):

```swift
public struct CloudflareOAuthRequest: Sendable {
    public let authorizeURL: URL
    let state: String
    let codeVerifier: String
    /// Resolved from the same discovery fetch that built `authorizeURL`. Public so a caller that
    /// completes a sign-in can persist it alongside the refresh token — refreshing later reuses
    /// this endpoint without re-running discovery.
    public let tokenEndpoint: URL
}
```

Add the refresh method (after `exchange(code:for:)`):

```swift
    /// Exchanges a stored refresh token for a new access token — no discovery, no PKCE, since
    /// those belong to the original interactive authorize/exchange already resolved once by
    /// ``makeAuthorizationRequest()``/``exchange(code:for:)``. Same error mapping as `exchange`.
    public func refresh(refreshToken: String, tokenEndpoint: URL) async throws -> OAuthToken {
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refreshToken),
            URLQueryItem(name: "client_id", value: clientID),
        ]
        var urlRequest = URLRequest(url: tokenEndpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = Data((form.percentEncodedQuery ?? "").utf8)

        let data: Data, http: HTTPURLResponse
        do {
            (data, http) = try await transport(urlRequest)
        } catch {
            throw CloudflareOAuthError.tokenExchangeFailed(error.localizedDescription)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw CloudflareOAuthError.tokenExchangeFailed("HTTP \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        do {
            return try JSONDecoder().decode(OAuthToken.self, from: data)
        } catch {
            throw CloudflareOAuthError.tokenExchangeFailed("bad response: \(error)")
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareOAuthClientTests`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareOAuthClient.swift Tests/AnglesiteCoreTests/CloudflareOAuthClientTests.swift
git commit -m "feat(#1204): add refresh-token support to CloudflareOAuthClient"
```

---

### Task 2: `AnglesiteTokenTemplate.oauthScope`

**Files:**
- Modify: `Sources/AnglesiteCore/AnglesiteTokenTemplate.swift`
- Test: `Tests/AnglesiteCoreTests/AnglesiteTokenTemplateTests.swift`

**Interfaces:**
- Produces: `AnglesiteTokenTemplate.oauthScope: String`.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/AnglesiteTokenTemplateTests.swift`:

```swift
    @Test("oauthScope space-joins every permission group key, one scope per group, no duplicates")
    func oauthScopeMatchesPermissionGroups() {
        let scopeKeys = AnglesiteTokenTemplate.oauthScope.split(separator: " ").map(String.init)
        #expect(Set(scopeKeys) == Set(AnglesiteTokenTemplate.permissionGroups.map(\.key)))
        #expect(scopeKeys.count == AnglesiteTokenTemplate.permissionGroups.count)
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter AnglesiteTokenTemplateTests`
Expected: FAIL — `oauthScope` doesn't exist (compile error).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/AnglesiteTokenTemplate.swift`, add after `permissionGroups`:

```swift
    /// The OAuth `scope` string covering every permission group above. Cloudflare's self-managed
    /// OAuth scope names equal API-token permission-group names, so this is the same list,
    /// space-joined per OAuth's multi-scope convention — not a separately maintained vocabulary.
    public static var oauthScope: String {
        permissionGroups.map(\.key).joined(separator: " ")
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter AnglesiteTokenTemplateTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AnglesiteTokenTemplate.swift Tests/AnglesiteCoreTests/AnglesiteTokenTemplateTests.swift
git commit -m "feat(#1204): derive an OAuth scope string from AnglesiteTokenTemplate"
```

---

### Task 3: `CloudflareOAuthCredential` storage on `SecretStore`

**Files:**
- Modify: `Sources/AnglesiteCore/Platform/SecretStore.swift`
- Create: `Tests/AnglesiteTestSupport/InMemorySecretStore.swift`
- Test: Create `Tests/AnglesiteCoreTests/CloudflareOAuthCredentialTests.swift`

**Interfaces:**
- Produces: `CloudflareOAuthCredential` (struct: `accessToken: String`, `refreshToken: String?`, `expiresAt: Date?`, `tokenEndpoint: URL`); `SecretStore.readCloudflareOAuthCredential() throws -> CloudflareOAuthCredential?`; `.writeCloudflareOAuthCredential(_:) throws`; `.clearCloudflareOAuthCredential() throws`; `InMemorySecretStore` (public test double in the shared `AnglesiteTestSupport` target — a `.target`, not a `.testTarget`, imported by both `AnglesiteCoreTests` and `AnglesiteAppTests` per `Package.swift`, so Task 8's `DeployModelTests` can reuse it too. It must live there rather than inline in a test file: `AnglesiteCoreTests` and `AnglesiteAppTests` are separate SwiftPM test-target modules and can't import each other's internal types).

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteTestSupport/InMemorySecretStore.swift`:

```swift
import Foundation
import AnglesiteCore

/// An in-memory `SecretStore` for tests needing a real write-then-read round trip without the
/// Keychain — used by `CloudflareOAuthCredentialTests`, `CloudflareOAuthTokenSourceTests`, and
/// `DeployModelTests` (three different test targets; kept here, in the shared support target,
/// rather than duplicated). `FakeSecretStore` defined inline in some `AnglesiteCoreTests` files is
/// read-only, which doesn't fit a persist-then-read-back test like these.
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]

    public init() {}

    public func read(account: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[account]
    }
    public func write(_ value: String, account: String) throws {
        lock.lock(); defer { lock.unlock() }
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }
    public func delete(account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: account)
    }
}
```

Create `Tests/AnglesiteCoreTests/CloudflareOAuthCredentialTests.swift`:

```swift
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

struct CloudflareOAuthCredentialTests {
    private let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!

    @Test("no stored credential reads as nil")
    func readsNilWhenAbsent() throws {
        #expect(try InMemorySecretStore().readCloudflareOAuthCredential() == nil)
    }

    @Test("a written credential round-trips through read, including optional fields")
    func writeThenReadRoundTrips() throws {
        let store = InMemorySecretStore()
        let credential = CloudflareOAuthCredential(
            accessToken: "access-1", refreshToken: "refresh-1",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000), tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        #expect(try store.readCloudflareOAuthCredential() == credential)
    }

    @Test("a credential with no refresh token or expiry round-trips with both nil")
    func writeThenReadWithoutOptionalFields() throws {
        let store = InMemorySecretStore()
        let credential = CloudflareOAuthCredential(
            accessToken: "access-2", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        #expect(try store.readCloudflareOAuthCredential() == credential)
    }

    @Test("clear removes all four slots")
    func clearRemovesEverything() throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "access-3", refreshToken: "refresh-3", expiresAt: Date(), tokenEndpoint: endpoint))
        try store.clearCloudflareOAuthCredential()
        #expect(try store.readCloudflareOAuthCredential() == nil)
    }

    @Test("a second write replaces the first")
    func secondWriteReplaces() throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "first", refreshToken: "r1", expiresAt: nil, tokenEndpoint: endpoint))
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "second", refreshToken: "r2", expiresAt: nil, tokenEndpoint: endpoint))
        #expect(try store.readCloudflareOAuthCredential()?.accessToken == "second")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareOAuthCredentialTests`
Expected: FAIL — `InMemorySecretStore` compiles fine on its own, but `CloudflareOAuthCredential`
and the new `SecretStore` methods it calls don't exist yet (compile error).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/Platform/SecretStore.swift`, add four new keys inside the `SecretAccounts`
enum (after `sandboxControlToken`):

```swift
    /// Cloudflare OAuth credential slots (#1204) — four keys stored/cleared as one unit via
    /// ``SecretStore/readCloudflareOAuthCredential()``/``writeCloudflareOAuthCredential(_:)``/
    /// ``clearCloudflareOAuthCredential()``. Distinct from `cloudflareToken` (the legacy pasted
    /// custom token, kept read-only for existing users — see the design doc's Migration section).
    public static let cloudflareOAuthAccessToken = "cloudflare-oauth-access-token"
    public static let cloudflareOAuthRefreshToken = "cloudflare-oauth-refresh-token"
    public static let cloudflareOAuthExpiresAt = "cloudflare-oauth-expires-at"
    public static let cloudflareOAuthTokenEndpoint = "cloudflare-oauth-token-endpoint"
```

Add the credential type and convenience methods after the `SecretAccounts` enum, before
`public extension SecretStore`:

```swift
/// A stored Cloudflare OAuth credential: the access token used as a Cloudflare API bearer token,
/// its optional refresh token, expiry (when the server reported one), and the token endpoint URL
/// needed to refresh later without re-running OIDC discovery.
public struct CloudflareOAuthCredential: Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresAt: Date?
    public let tokenEndpoint: URL

    public init(accessToken: String, refreshToken: String?, expiresAt: Date?, tokenEndpoint: URL) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.tokenEndpoint = tokenEndpoint
    }
}
```

Add to the existing `public extension SecretStore { ... }` block (after the Cloudflare-token
convenience methods):

```swift
    /// Read the stored Cloudflare OAuth credential, or `nil` if none is stored (or the stored
    /// token endpoint doesn't parse as a URL — a credential without one can never be refreshed).
    func readCloudflareOAuthCredential() throws -> CloudflareOAuthCredential? {
        guard let accessToken = try read(account: SecretAccounts.cloudflareOAuthAccessToken), !accessToken.isEmpty,
              let tokenEndpointString = try read(account: SecretAccounts.cloudflareOAuthTokenEndpoint),
              let tokenEndpoint = URL(string: tokenEndpointString)
        else { return nil }
        let refreshToken = try read(account: SecretAccounts.cloudflareOAuthRefreshToken)
        let expiresAt = try read(account: SecretAccounts.cloudflareOAuthExpiresAt)
            .flatMap(Double.init)
            .map(Date.init(timeIntervalSince1970:))
        return CloudflareOAuthCredential(
            accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt,
            tokenEndpoint: tokenEndpoint)
    }

    /// Store a Cloudflare OAuth credential, replacing any existing one.
    func writeCloudflareOAuthCredential(_ credential: CloudflareOAuthCredential) throws {
        try write(credential.accessToken, account: SecretAccounts.cloudflareOAuthAccessToken)
        try write(credential.refreshToken ?? "", account: SecretAccounts.cloudflareOAuthRefreshToken)
        try write(
            credential.expiresAt.map { String($0.timeIntervalSince1970) } ?? "",
            account: SecretAccounts.cloudflareOAuthExpiresAt)
        try write(credential.tokenEndpoint.absoluteString, account: SecretAccounts.cloudflareOAuthTokenEndpoint)
    }

    /// Clear the stored Cloudflare OAuth credential's four slots together — a partial credential
    /// (e.g. an access token with no matching endpoint) can never be resolved, so they're always
    /// cleared as one unit, mirroring ``clearIndieAuthSession(siteID:)``.
    func clearCloudflareOAuthCredential() throws {
        try delete(account: SecretAccounts.cloudflareOAuthAccessToken)
        try delete(account: SecretAccounts.cloudflareOAuthRefreshToken)
        try delete(account: SecretAccounts.cloudflareOAuthExpiresAt)
        try delete(account: SecretAccounts.cloudflareOAuthTokenEndpoint)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareOAuthCredentialTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/Platform/SecretStore.swift Tests/AnglesiteTestSupport/InMemorySecretStore.swift Tests/AnglesiteCoreTests/CloudflareOAuthCredentialTests.swift
git commit -m "feat(#1204): add Cloudflare OAuth credential storage to SecretStore"
```

---

### Task 4: `CloudflareOAuthTokenSource`

**Files:**
- Create: `Sources/AnglesiteCore/CloudflareOAuthTokenSource.swift`
- Test: Create `Tests/AnglesiteCoreTests/CloudflareOAuthTokenSourceTests.swift`

**Interfaces:**
- Consumes: `CloudflareOAuthCredential`, `SecretStore` (Task 3); `OAuthToken` (Task 1); `InMemorySecretStore` (Task 3's test file, same target).
- Produces: `CloudflareOAuthTokenSource.init(secretStore:refresh:now:)`; `.resolve() async throws -> String?`.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/CloudflareOAuthTokenSourceTests.swift`:

```swift
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

struct CloudflareOAuthTokenSourceTests {
    private let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!
    private let epoch = Date(timeIntervalSince1970: 1_800_000_000)

    private func unreachableRefresh(_ refreshToken: String, _ tokenEndpoint: URL) async throws -> OAuthToken {
        Issue.record("refresh should not be called")
        throw CloudflareOAuthError.tokenExchangeFailed("unexpected")
    }

    @Test("no stored credential resolves to nil")
    func resolvesNilWhenAbsent() async throws {
        let source = CloudflareOAuthTokenSource(secretStore: InMemorySecretStore(), refresh: unreachableRefresh)
        #expect(try await source.resolve() == nil)
    }

    @Test("a non-expired credential resolves without calling refresh")
    func resolvesStoredTokenWhenFresh() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "fresh-tok", refreshToken: "r1", expiresAt: epoch.addingTimeInterval(3600),
            tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(secretStore: store, refresh: unreachableRefresh, now: { self.epoch })
        #expect(try await source.resolve() == "fresh-tok")
    }

    @Test("a credential with no expiry resolves without calling refresh")
    func resolvesStoredTokenWhenNoExpiry() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "no-expiry-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(secretStore: store, refresh: unreachableRefresh)
        #expect(try await source.resolve() == "no-expiry-tok")
    }

    @Test("an expired credential refreshes, persists the new pair, and returns the new access token")
    func refreshesExpiredCredential() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "old-tok", refreshToken: "old-refresh", expiresAt: epoch.addingTimeInterval(-1),
            tokenEndpoint: endpoint))
        var capturedRefreshToken: String?
        let source = CloudflareOAuthTokenSource(
            secretStore: store,
            refresh: { refreshToken, tokenEndpoint in
                capturedRefreshToken = refreshToken
                #expect(tokenEndpoint == self.endpoint)
                return OAuthToken(accessToken: "new-tok", tokenType: "bearer", expiresIn: 3600, refreshToken: "new-refresh")
            },
            now: { self.epoch })

        #expect(try await source.resolve() == "new-tok")
        #expect(capturedRefreshToken == "old-refresh")
        let stored = try store.readCloudflareOAuthCredential()
        #expect(stored?.accessToken == "new-tok")
        #expect(stored?.refreshToken == "new-refresh")
        #expect(stored?.expiresAt == epoch.addingTimeInterval(3600))
    }

    @Test("a refresh response with no new refresh token keeps the old one")
    func refreshWithoutNewRefreshTokenKeepsOld() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "old-tok", refreshToken: "old-refresh", expiresAt: epoch.addingTimeInterval(-1),
            tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(
            secretStore: store,
            refresh: { _, _ in OAuthToken(accessToken: "new-tok", tokenType: "bearer", expiresIn: 3600, refreshToken: nil) },
            now: { self.epoch })
        _ = try await source.resolve()
        #expect(try store.readCloudflareOAuthCredential()?.refreshToken == "old-refresh")
    }

    @Test("an expired credential with no refresh token resolves to nil without calling refresh")
    func expiredWithoutRefreshTokenResolvesNil() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "old-tok", refreshToken: nil, expiresAt: epoch.addingTimeInterval(-1), tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(secretStore: store, refresh: unreachableRefresh, now: { self.epoch })
        #expect(try await source.resolve() == nil)
    }

    @Test("a failed refresh resolves to nil and leaves the stored credential untouched")
    func failedRefreshLeavesCredentialUntouched() async throws {
        let store = InMemorySecretStore()
        let original = CloudflareOAuthCredential(
            accessToken: "old-tok", refreshToken: "old-refresh", expiresAt: epoch.addingTimeInterval(-1),
            tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(original)
        let source = CloudflareOAuthTokenSource(
            secretStore: store,
            refresh: { _, _ in throw CloudflareOAuthError.tokenExchangeFailed("network blip") },
            now: { self.epoch })
        #expect(try await source.resolve() == nil)
        #expect(try store.readCloudflareOAuthCredential() == original)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareOAuthTokenSourceTests`
Expected: FAIL — `CloudflareOAuthTokenSource` doesn't exist (compile error).

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/CloudflareOAuthTokenSource.swift`:

```swift
import Foundation

/// Resolves a usable Cloudflare API bearer token from a stored OAuth credential, refreshing it
/// first when it's expired. Returns `nil` (never throws) when no OAuth credential is stored, or
/// when refreshing fails — callers (``DeployCommand/keychainTokenSource``) fall back to the legacy
/// pasted-token slot in that case, exactly as they do today when there's no OAuth credential at
/// all. A failed refresh leaves the stored credential untouched: a transient network hiccup during
/// refresh shouldn't discard an otherwise-good refresh token.
public struct CloudflareOAuthTokenSource: Sendable {
    /// One refresh round trip: `grant_type=refresh_token` against the stored token endpoint.
    /// Injected so tests can stub it without `CloudflareOAuthClient`'s network transport.
    public typealias Refresh = @Sendable (_ refreshToken: String, _ tokenEndpoint: URL) async throws -> OAuthToken

    private let secretStore: any SecretStore
    private let refresh: Refresh
    private let now: @Sendable () -> Date

    public init(
        secretStore: any SecretStore,
        refresh: @escaping Refresh,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.secretStore = secretStore
        self.refresh = refresh
        self.now = now
    }

    /// Returns the access token to use, refreshing and persisting a new one first if the stored
    /// credential is expired.
    public func resolve() async throws -> String? {
        guard let credential = try secretStore.readCloudflareOAuthCredential() else { return nil }
        guard let expiresAt = credential.expiresAt, expiresAt <= now() else {
            return credential.accessToken
        }
        guard let refreshToken = credential.refreshToken,
              let refreshed = try? await refresh(refreshToken, credential.tokenEndpoint)
        else { return nil }
        let updated = CloudflareOAuthCredential(
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? refreshToken,
            expiresAt: refreshed.expiresIn.map { now().addingTimeInterval(TimeInterval($0)) },
            tokenEndpoint: credential.tokenEndpoint)
        try secretStore.writeCloudflareOAuthCredential(updated)
        return updated.accessToken
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareOAuthTokenSourceTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareOAuthTokenSource.swift Tests/AnglesiteCoreTests/CloudflareOAuthTokenSourceTests.swift
git commit -m "feat(#1204): add CloudflareOAuthTokenSource for refresh-aware resolution"
```

---

### Task 5: Wire `DeployCommand.keychainTokenSource` to the OAuth credential

**Files:**
- Modify: `Sources/AnglesiteCore/DeployCommand.swift:681-686`
- Test: Modify `Tests/AnglesiteCoreTests/KeychainStoreTests.swift`

**Interfaces:**
- Consumes: `CloudflareOAuthTokenSource` (Task 4), `CloudflareOAuthClient.refresh` (Task 1), `AnglesiteTokenTemplate.oauthScope` (Task 2).

`keychainTokenSource` itself stays untested directly (it depends on `PlatformSecretStore.make()`,
which resolves to the real Keychain — matching the existing convention that neither
`envTokenSource` nor `keychainTokenSource` has a dedicated unit test today; `DeployCommandTests.swift`
always injects a custom `tokenSource:` closure). Instead, this task adds an integration-style test
against `KeychainStoreTests`' already-real (XCTSkip-guarded) `KeychainStore` instance, exercising
the exact composition `keychainTokenSource` uses internally.

This task is the one exception to strict red-green TDD in this plan: the new tests below exercise
`CloudflareOAuthCredential`/`CloudflareOAuthTokenSource` (already implemented in Tasks 3–4) against
a *real* `KeychainStore`, so they pass immediately — Step 3's actual change
(`keychainTokenSource`'s composition order) has no feasible unit test of its own, for the reason
above. Steps 1–2 add regression coverage for the real-Keychain path *before* touching production
code, in place of a true failing-test step; Step 4 then confirms nothing regressed.

- [ ] **Step 1: Write the tests**

Add to `Tests/AnglesiteCoreTests/KeychainStoreTests.swift`, inside `KeychainStoreTests`, a new
`// MARK: OAuth credential` section (after the Cloudflare convenience section):

```swift
    // MARK: OAuth credential

    func testOAuthCredentialConvenienceRoundTrips() throws {
        let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!
        defer { try? store.clearCloudflareOAuthCredential() }
        XCTAssertNil(try store.readCloudflareOAuthCredential())
        let credential = CloudflareOAuthCredential(
            accessToken: "tok", refreshToken: "refresh",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000), tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        XCTAssertEqual(try store.readCloudflareOAuthCredential(), credential)
        try store.clearCloudflareOAuthCredential()
        XCTAssertNil(try store.readCloudflareOAuthCredential())
    }

    func testOAuthTokenSourceResolvesAgainstRealKeychain() async throws {
        let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!
        defer { try? store.clearCloudflareOAuthCredential() }
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "real-keychain-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(secretStore: store, refresh: { _, _ in
            XCTFail("refresh should not be called for a non-expiring credential")
            throw CloudflareOAuthError.tokenExchangeFailed("unexpected")
        })
        let resolved = try await source.resolve()
        XCTAssertEqual(resolved, "real-keychain-tok")
    }
```

Also update `tearDown()` to clear the new slots:

```swift
    override func tearDown() async throws {
        // Best effort — if the keychain refused us in setUp, this won't matter.
        try? store.delete(account: "alpha")
        try? store.delete(account: "beta")
        try? store.delete(account: KeychainStore.cloudflareTokenAccount)
        try? store.clearCloudflareOAuthCredential()
    }
```

- [ ] **Step 2: Run the new tests to confirm they pass against Tasks 3–4's code**

Run: `swift test --package-path . --filter KeychainStoreTests`
Expected: PASS (these two new tests exercise only `CloudflareOAuthCredential`/
`CloudflareOAuthTokenSource`, already implemented — this step is a checkpoint before the
production wiring in Step 3, not a red-green TDD gate; see the note above).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/DeployCommand.swift`, replace the `keychainTokenSource` definition
(lines 681-686):

```swift
    /// Default `TokenSource` for production: env var first (so a developer's shell still wins),
    /// then a stored OAuth credential (refreshing it first if expired), then the legacy pasted
    /// token — read-only now that `CloudflareTokenPromptView` no longer writes it (#1204), kept so
    /// a token a user already pasted keeps working. A store error is surfaced to the caller — we'd
    /// rather show the user "couldn't read token" than silently fall through to `nil` and prompt
    /// for a re-sign-in when a token is actually stored fine.
    public static let keychainTokenSource: TokenSource = {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        let store = PlatformSecretStore.make()
        let oauthSource = CloudflareOAuthTokenSource(secretStore: store, refresh: { refreshToken, tokenEndpoint in
            try await CloudflareOAuthClient(scope: AnglesiteTokenTemplate.oauthScope)
                .refresh(refreshToken: refreshToken, tokenEndpoint: tokenEndpoint)
        })
        if let oauthToken = try await oauthSource.resolve() {
            return oauthToken
        }
        return try store.readCloudflareToken()
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter KeychainStoreTests`
Expected: PASS. Also run the full core suite once to confirm no regression:
Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DeployCommand.swift Tests/AnglesiteCoreTests/KeychainStoreTests.swift
git commit -m "feat(#1204): resolve deploy tokens via OAuth, then the legacy slot"
```

---

### Task 6: `CloudflareOAuthPresentationContext` (macOS presentation anchor)

**Files:**
- Create: `Sources/AnglesiteApp/CloudflareOAuthPresentationContext.swift`

**Interfaces:**
- Produces: `CloudflareOAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding`.

This type is thin enough (resolves one `NSWindow` anchor, no state or branching logic) that it's
verified by a manual smoke test during Task 9's UI wiring, not a unit test — flagged here explicitly
per the design doc's Testing section, not silently skipped.

- [ ] **Step 1: Implement**

Create `Sources/AnglesiteApp/CloudflareOAuthPresentationContext.swift`:

```swift
import AppKit
import AuthenticationServices

/// Anchors the OAuth browser sheet to the app's key window. No state beyond that — thin enough to
/// be verified by a manual smoke test (does "Sign in with Cloudflare" show a window-anchored
/// sheet?) rather than a unit test, per the design doc's Testing section.
final class CloudflareOAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `swift build --package-path . --target AnglesiteAppCore`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/CloudflareOAuthPresentationContext.swift
git commit -m "feat(#1204): add the macOS OAuth presentation-context anchor"
```

---

### Task 7: `CloudflareOAuthSignIn` coordinator

**Files:**
- Create: `Sources/AnglesiteApp/CloudflareOAuthSignIn.swift`
- Test: Create `Tests/AnglesiteAppTests/CloudflareOAuthSignInTests.swift`

**Interfaces:**
- Consumes: `CloudflareOAuthClient`, `OAuthToken`, `CloudflareOAuthError`, `AnglesiteTokenTemplate.oauthScope` (all `AnglesiteCore`); `CloudflareOAuthPresentationContext` (Task 6).
- Produces: `CloudflareOAuthSignIn.Result` (struct: `token: OAuthToken`, `tokenEndpoint: URL`); `CloudflareOAuthSignIn.init(client:present:)`; `.run() async throws -> Result`; `CloudflareOAuthSignIn.defaultPresenter: Presenter` (production, `@MainActor`).

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/CloudflareOAuthSignInTests.swift`:

```swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

struct CloudflareOAuthSignInTests {
    private let discoveryURL = URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!
    private let redirectURI = URL(string: "https://auth.anglesite.dwk.io/oauth-callback")!
    private let discoveryJSON = Data("""
    {"authorization_endpoint":"https://dash.cloudflare.com/oauth2/auth","token_endpoint":"https://dash.cloudflare.com/oauth2/token"}
    """.utf8)

    private func response(_ code: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: discoveryURL, statusCode: code, httpVersion: nil, headerFields: nil)!
    }

    @Test("run() authorizes, presents, and exchanges the callback for a token")
    func fullRoundTrip() async throws {
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "workers_scripts", discoveryURL: discoveryURL,
            transport: { req in
                if req.url == self.discoveryURL { return (self.discoveryJSON, self.response(200)) }
                let body = #"{"access_token":"tok","token_type":"bearer","expires_in":3600,"refresh_token":"refresh"}"#
                return (Data(body.utf8), self.response(200))
            })
        var presentedURL: URL?
        let signIn = CloudflareOAuthSignIn(client: client, present: { authorizeURL in
            presentedURL = authorizeURL
            let state = URLComponents(url: authorizeURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "state" }?.value ?? ""
            return URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=auth-code&state=\(state)")!
        })

        let result = try await signIn.run()

        #expect(result.token.accessToken == "tok")
        #expect(result.token.refreshToken == "refresh")
        #expect(result.tokenEndpoint == URL(string: "https://dash.cloudflare.com/oauth2/token")!)
        #expect(presentedURL?.host == "dash.cloudflare.com")
    }

    @Test("a presenter failure propagates without exchanging a token")
    func presenterFailurePropagates() async {
        struct Cancelled: Error {}
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "workers_scripts", discoveryURL: discoveryURL,
            transport: { _ in (self.discoveryJSON, self.response(200)) })
        let signIn = CloudflareOAuthSignIn(client: client, present: { _ in throw Cancelled() })
        await #expect(throws: Cancelled.self) {
            _ = try await signIn.run()
        }
    }

    @Test("a callback with a mismatched state throws before exchanging")
    func mismatchedStateNeverExchanges() async {
        var exchangeCalled = false
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "workers_scripts", discoveryURL: discoveryURL,
            transport: { req in
                if req.url == self.discoveryURL { return (self.discoveryJSON, self.response(200)) }
                exchangeCalled = true
                return (Data(), self.response(200))
            })
        let signIn = CloudflareOAuthSignIn(client: client, present: { _ in
            URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=xyz&state=WRONG")!
        })
        await #expect(throws: CloudflareOAuthError.stateMismatch) {
            _ = try await signIn.run()
        }
        #expect(!exchangeCalled)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareOAuthSignInTests`
Expected: FAIL — `CloudflareOAuthSignIn` doesn't exist (compile error).

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteApp/CloudflareOAuthSignIn.swift`:

```swift
import AuthenticationServices
import AnglesiteCore

/// Drives one Cloudflare OAuth sign-in attempt: authorize → present the browser sheet → exchange
/// the callback for a token. Presentation is injected so `DeployModel`'s tests can drive this
/// without `AuthenticationServices` or a real browser window — the same seam philosophy
/// `TokenVerifying`/`CloudflareOAuthClient.Transport` already use elsewhere in this codebase.
struct CloudflareOAuthSignIn: Sendable {
    /// One completed OAuth sign-in: the token plus the token endpoint used to obtain it — needed
    /// later to refresh, since `OAuthToken` itself doesn't carry it.
    struct Result: Sendable {
        let token: OAuthToken
        let tokenEndpoint: URL
    }

    /// Presents `authorizeURL` (e.g. via `ASWebAuthenticationSession`) and returns the callback URL
    /// the session completes with. Throws on cancel/failure.
    typealias Presenter = @Sendable (_ authorizeURL: URL) async throws -> URL

    private let client: CloudflareOAuthClient
    private let present: Presenter

    init(client: CloudflareOAuthClient, present: @escaping Presenter) {
        self.client = client
        self.present = present
    }

    func run() async throws -> Result {
        let request = try await client.makeAuthorizationRequest()
        let callbackURL = try await present(request.authorizeURL)
        let code = try CloudflareOAuthClient.authorizationCode(from: callbackURL, matching: request)
        let token = try await client.exchange(code: code, for: request)
        return Result(token: token, tokenEndpoint: request.tokenEndpoint)
    }
}

extension CloudflareOAuthSignIn {
    /// Production presenter: a real `ASWebAuthenticationSession` anchored via
    /// `CloudflareOAuthPresentationContext`, matched against the callback Worker's `/oauth-callback`
    /// route via Associated Domains. `.https(host:path:)` callback matching has been available
    /// since macOS 14.4 (well under this app's macOS 27 floor) but isn't yet exercised anywhere in
    /// this codebase — confirm this exact initializer overload against the macOS 27 SDK while
    /// wiring this into `DeployModel` (Task 8); it isn't unit-testable (real `AuthenticationServices`
    /// UI), so this is a manual/smoke-test item per the design doc's Testing section.
    @MainActor
    static let defaultPresenter: Presenter = { authorizeURL in
        let contextProvider = CloudflareOAuthPresentationContext()
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authorizeURL,
                callback: .https(
                    host: CloudflareOAuthConfiguration.redirectURI.host!,
                    path: CloudflareOAuthConfiguration.redirectURI.path)
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: CloudflareOAuthError.missingAuthorizationCode)
                }
            }
            session.presentationContextProvider = contextProvider
            session.start()
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareOAuthSignInTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/CloudflareOAuthSignIn.swift Tests/AnglesiteAppTests/CloudflareOAuthSignInTests.swift
git commit -m "feat(#1204): add CloudflareOAuthSignIn coordinator"
```

---

### Task 8: Wire `DeployModel` — `hasUsableToken()` + `signInWithCloudflare()`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift`
- Test: Modify `Tests/AnglesiteAppTests/DeployModelTests.swift`

**Interfaces:**
- Consumes: `CloudflareOAuthSignIn` (Task 7), `CloudflareOAuthCredential`/`SecretStore` (Task 3), `AnglesiteTokenTemplate.oauthScope` (Task 2).
- Produces: `DeployModel.signInWithCloudflare() async` (replaces `verifyAndSaveToken(_:)`, which is deleted — confirmed unused by any test or other call site beyond the deleted `CloudflareTokenPromptView`/`GitHubTokenPromptView`; `GitHubTokenPromptView` calls `PublishModel.verifyAndSaveToken`, a distinct method on a distinct type, untouched here).

- [ ] **Step 1: Write the failing tests**

Add `import AnglesiteTestSupport` to the top of `Tests/AnglesiteAppTests/DeployModelTests.swift`
(alongside the existing `import Foundation`, `import Testing`, `import AnglesiteCore`,
`@testable import AnglesiteAppCore`) — needed for `InMemorySecretStore` (Task 3).

Add to `Tests/AnglesiteAppTests/DeployModelTests.swift`, inside `DeployModelTests`:

```swift
    @Test("an OAuth credential in the keychain lets a deploy proceed without the sign-in sheet")
    func oauthCredentialSatisfiesHasUsableToken() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let keychain = InMemorySecretStore()
        try? keychain.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "already-signed-in", refreshToken: nil, expiresAt: nil,
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!))
        let model = DeployModel(command: command, logCenter: LogCenter(), keychain: keychain)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        #expect(!model.tokenPromptPresented)
    }

    @Test("signInWithCloudflare persists the credential and dispatches the parked deploy on success")
    func signInSuccessPersistsAndDispatches() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let keychain = InMemorySecretStore()
        let client = CloudflareOAuthClient(
            scope: "workers_scripts",
            discoveryURL: URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!,
            transport: { req in
                let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                if req.url?.path == "/.well-known/openid-configuration" {
                    let json = #"{"authorization_endpoint":"https://dash.cloudflare.com/oauth2/auth","token_endpoint":"https://dash.cloudflare.com/oauth2/token"}"#
                    return (Data(json.utf8), response)
                }
                let body = #"{"access_token":"new-oauth-tok","token_type":"bearer","expires_in":3600,"refresh_token":"new-refresh"}"#
                return (Data(body.utf8), response)
            })
        let oauthSignIn = CloudflareOAuthSignIn(client: client, present: { authorizeURL in
            let state = URLComponents(url: authorizeURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "state" }?.value ?? ""
            return URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=auth-code&state=\(state)")!
        })
        let model = DeployModel(
            command: command, logCenter: LogCenter(), keychain: keychain,
            verifier: StubTokenVerifying(result: .success(CloudflareAccount(name: "Acme Co.", email: nil))),
            oauthSignIn: oauthSignIn)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        #expect(model.tokenPromptPresented)

        await model.signInWithCloudflare()
        while model.isRunning { await Task.yield() }

        #expect(!model.tokenPromptPresented)
        #expect(try keychain.readCloudflareOAuthCredential()?.accessToken == "new-oauth-tok")
        guard case .succeeded = model.phase else {
            Issue.record("expected the parked deploy to run after sign-in, got \(model.phase)"); return
        }
    }

    @Test("signInWithCloudflare keeps the sheet open with a message on failure")
    func signInFailureStaysOnSheet() async {
        let command = DeployCommand(tokenSource: { "test-token" }, executor: GatedDeployExecutor())
        struct Boom: Error {}
        let client = CloudflareOAuthClient(
            scope: "workers_scripts",
            discoveryURL: URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!,
            transport: { _ in throw Boom() })
        let oauthSignIn = CloudflareOAuthSignIn(client: client, present: { _ in throw Boom() })
        let model = DeployModel(command: command, logCenter: LogCenter(), oauthSignIn: oauthSignIn)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        await model.signInWithCloudflare()

        #expect(model.tokenPromptPresented)
        guard case .failed = model.tokenVerification else {
            Issue.record("expected .failed, got \(model.tokenVerification)"); return
        }
    }
```

Add a small shared fake verifier at file scope (near `FakeDomainAttachWriter`), since
`DeployModelTests` doesn't currently have one:

```swift
private struct StubTokenVerifying: TokenVerifying {
    let result: Result<CloudflareAccount, TokenVerifyError>
    func verify(token: String, siteDirectory: URL) async -> Result<CloudflareAccount, TokenVerifyError> {
        result
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DeployModelTests`
Expected: FAIL to compile — `DeployModel.init` has no `oauthSignIn:` parameter yet, `keychain:` only
accepts a concrete `KeychainStore`, and `signInWithCloudflare()` doesn't exist.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteApp/DeployModel.swift`, add the import at the top (after `import AnglesiteCore`):

```swift
import AuthenticationServices
```

Change the stored property (near `private let keychain: KeychainStore`):

```swift
    private let keychain: any SecretStore
    private let oauthSignIn: CloudflareOAuthSignIn
```

Change the initializer signature and body:

```swift
    init(
        command: DeployCommand = DeployCommand(),
        webmentionCommand: WebmentionSendCommand = WebmentionSendCommand(),
        posseCommand: POSSESyndicationCommand = POSSESyndicationCommand(),
        websubPing: WebSubPublishPing = WebSubPublishPing(),
        activityPubOutboxBackfill: ActivityPubOutboxBackfill = ActivityPubOutboxBackfill(),
        logCenter: LogCenter = .shared,
        keychain: any SecretStore = KeychainStore(),
        verifier: TokenVerifying = CloudflareAPITokenVerifier(),
        oauthSignIn: CloudflareOAuthSignIn = CloudflareOAuthSignIn(
            client: CloudflareOAuthClient(scope: AnglesiteTokenTemplate.oauthScope),
            present: CloudflareOAuthSignIn.defaultPresenter),
        summarizer: any DeployFailureSummarizing = DeploySummarizerFactory.makeDefault(),
        suddenTerminationController: SuddenTerminationController = .shared,
        tokenAvailabilityOverride: (() -> Bool)? = nil,
        contentGraph: SiteContentGraph = SiteContentGraph(),
        workerCatalog: @escaping @Sendable () async -> [WorkerDescriptor] = { [] }
    ) {
        self.command = command
        self.webmentionCommand = webmentionCommand
        self.posseCommand = posseCommand
        self.websubPing = websubPing
        self.activityPubOutboxBackfill = activityPubOutboxBackfill
        self.logCenter = logCenter
        self.keychain = keychain
        self.onboarding = TokenOnboarding(verifier: verifier)
        self.oauthSignIn = oauthSignIn
        self.summarizer = summarizer
        self.suddenTerminationController = suddenTerminationController
        self.tokenAvailabilityOverride = tokenAvailabilityOverride
        self.contentGraph = contentGraph
        self.workerCatalog = workerCatalog
    }
```

Replace `verifyAndSaveToken(_:)` with `signInWithCloudflare()`:

```swift
    /// Called by the sign-in sheet's "Sign in with Cloudflare" button. Runs the OAuth flow,
    /// verifies the resulting access token against Cloudflare exactly as a pasted token was
    /// verified — `TokenOnboarding` can't tell the two apart, since both are just Cloudflare API
    /// bearer tokens — then persists the full credential (access + refresh + expiry) and dispatches
    /// the parked deploy.
    func signInWithCloudflare() async {
        guard let pending = pendingDeploy else {
            tokenVerification = .failed(message: "No deploy is waiting — close this and click Deploy again.")
            return
        }

        tokenVerification = .checking
        let signInResult: CloudflareOAuthSignIn.Result
        do {
            signInResult = try await oauthSignIn.run()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The user dismissed the browser sheet — same "no error banner" treatment a dismissed
            // paste sheet got.
            tokenVerification = .idle
            return
        } catch CloudflareOAuthError.callbackDenied {
            // The user declined on Cloudflare's own consent screen — same treatment as cancelling
            // the sheet itself, not a connection failure.
            tokenVerification = .idle
            return
        } catch {
            // Includes `.stateMismatch` — a hard, generic failure, never silently accepted.
            tokenVerification = .failed(message: "Couldn't sign in to Cloudflare: \(error)")
            return
        }

        let outcome = await onboarding.run(
            token: signInResult.token.accessToken,
            siteDirectory: pending.siteDirectory,
            persist: { _ in
                try keychain.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
                    accessToken: signInResult.token.accessToken,
                    refreshToken: signInResult.token.refreshToken,
                    expiresAt: signInResult.token.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) },
                    tokenEndpoint: signInResult.tokenEndpoint))
            },
            onConnected: { tokenVerification = .connected(accountName: $0.name) },
            delay: { try? await Task.sleep(for: .milliseconds(700)) },
            isCancelled: { Task.isCancelled || !tokenPromptPresented }
        )

        switch outcome {
        case .proceed:
            pendingDeploy = nil
            tokenPromptPresented = false
            tokenVerification = .idle
            deploy(
                siteID: pending.siteID, siteDirectory: pending.siteDirectory,
                configDirectory: pending.configDirectory, currentRoutes: pending.currentRoutes,
                containerControlProvider: pending.containerControlProvider, siteName: pending.siteName)
        case .stay(let message):
            tokenVerification = .failed(message: message)
        case .abort:
            tokenVerification = .idle
        }
    }
```

Update `hasUsableToken()` to check the OAuth credential too:

```swift
    /// True if the env var, a stored OAuth credential, or the legacy pasted-token slot currently
    /// holds a non-empty Cloudflare credential. Keychain errors are treated as "no token" — the
    /// user can recover by signing in again. This is a presence check only (no refresh attempted
    /// here, since it's synchronous) — the actual refresh happens in
    /// `DeployCommand.keychainTokenSource` at the moment a deploy resolves its token.
    private func hasUsableToken() -> Bool {
        if let tokenAvailabilityOverride {
            return tokenAvailabilityOverride()
        }
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return true
        }
        if (try? keychain.readCloudflareOAuthCredential()) != nil {
            return true
        }
        if let stored = (try? keychain.readCloudflareToken()) ?? nil, !stored.isEmpty {
            return true
        }
        return false
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DeployModelTests`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift Tests/AnglesiteAppTests/DeployModelTests.swift
git commit -m "feat(#1204): drive DeployModel's Cloudflare sign-in through OAuth"
```

---

### Task 9: Replace `CloudflareTokenPromptView`, wire `SiteWindow`

**Files:**
- Delete: `Sources/AnglesiteApp/CloudflareTokenPromptView.swift`
- Create: `Sources/AnglesiteApp/CloudflareOAuthSignInView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:587-591`

**Interfaces:**
- Consumes: `DeployModel.signInWithCloudflare()`, `.tokenVerification`, `.cancelTokenPrompt()` (Task 8, all pre-existing state names unchanged).

No new unit tests — this is a SwiftUI view, verified by `swift build`/`scripts/build-app.sh`
compiling and a manual smoke test (Step 4), same as `CloudflareTokenPromptView` itself had no
dedicated test (confirmed in Task 8: zero references to it in `Tests/`).

- [ ] **Step 1: Delete the old view**

```bash
git rm Sources/AnglesiteApp/CloudflareTokenPromptView.swift
```

- [ ] **Step 2: Create the new view**

Create `Sources/AnglesiteApp/CloudflareOAuthSignInView.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// First-deploy modal: sign in to Cloudflare via OAuth, then let the parked deploy proceed.
/// Surfaced by `DeployModel` when neither the env var, an OAuth credential, nor a legacy pasted
/// token is usable at the moment the user clicks Deploy. Replaces `CloudflareTokenPromptView`
/// (#1204) — no dashboard link, no paste field; one button drives the whole flow.
struct CloudflareOAuthSignInView: View {
    let model: DeployModel
    let onCancel: () -> Void

    private var isBusy: Bool {
        switch model.tokenVerification {
        case .checking, .connected: return true
        case .idle, .failed: return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Connect to Cloudflare")
                    .font(.headline)
                Text("Deploying needs a one-time sign-in to your Cloudflare account.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            status
                .frame(minHeight: 16, alignment: .leading)

            HStack {
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)
                .disabled(isBusy)
                Button("Sign in with Cloudflare") {
                    Task { await model.signInWithCloudflare() }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(isBusy)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    @ViewBuilder
    private var status: some View {
        switch model.tokenVerification {
        case .idle:
            EmptyView()
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Signing in…").foregroundStyle(.secondary)
            }
            .font(.footnote)
        case .connected(let accountName):
            Label(
                accountName.map { "Connected to \($0)" } ?? "Signed in",
                systemImage: "checkmark.circle.fill"
            )
            .font(.footnote)
            .foregroundStyle(.green)
        case .failed(let message):
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#Preview {
    CloudflareOAuthSignInView(model: DeployModel(), onCancel: {})
}
```

- [ ] **Step 3: Wire `SiteWindow`**

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
            CloudflareOAuthSignInView(model: model.deploy) {
                model.deploy.cancelTokenPrompt()
            }
        }
```

- [ ] **Step 4: Build and manually smoke-test**

Run: `swift build --package-path . --target AnglesiteAppCore`
Expected: builds cleanly (confirms the view and `SiteWindow` compile).

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds cleanly.

Manual smoke test (can't be automated — real `AuthenticationServices` UI): launch the built app,
open a site with no Cloudflare credential configured, click Deploy, confirm the new "Connect to
Cloudflare" sheet appears with a single "Sign in with Cloudflare" button (no paste field). Clicking
it is expected to fail until the manual Cloudflare-dashboard/callback-Worker steps in the design
doc's "Manual / out-of-band follow-ups" are done — that failure surfacing as the `.failed` message
state (not a crash) is what to confirm here.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/CloudflareOAuthSignInView.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1204): replace CloudflareTokenPromptView with OAuth sign-in"
```

---

### Task 10: Associated Domains entitlement

**Files:**
- Modify: `Resources/Anglesite.entitlements`
- Modify: `Resources/Anglesite-Debug-iCloud.entitlements`
- Modify: `Resources/Anglesite-Debug.entitlements` (comment only, no capability added)

No test — entitlements aren't compiled Swift; correctness is verified by the app-target build in
Step 2 (code signing consumes these files) and, later, by the manual Associated-Domains handoff
test the design doc flags as needing a real signed build (out of scope for this plan's automated
steps).

**Important:** this repo has direct precedent (#1038) for iCloud needing a *real provisioning
profile* even under ad-hoc/manual signing — Xcode refuses to build at all once that kind of
capability is present without a Team. Associated Domains is the same class of App-ID capability, so
it goes in `Anglesite.entitlements` (Release) and the opt-in `Anglesite-Debug-iCloud.entitlements`
(Team-signed local dev), **not** in the default `Anglesite-Debug.entitlements` — that file must stay
buildable with no Apple Developer account (README.md/CONTRIBUTING.md's clone-and-build promise).

- [ ] **Step 1: Add the entitlement to the Release file**

In `Resources/Anglesite.entitlements`, add before the closing `</dict>`:

```xml
	<!-- Cloudflare OAuth sign-in (#1204): matches the callback Worker's `webcredentials` entry at
	     auth.anglesite.dwk.io, so the OS intercepts the OAuth redirect instead of opening Safari.
	     Requires a real provisioning profile — same class of App-ID capability as the iCloud
	     entitlement below (#1038), so it's absent from the default Debug entitlements file. -->
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>webcredentials:auth.anglesite.dwk.io</string>
	</array>
```

- [ ] **Step 2: Add the same entitlement to the opt-in Team-signed Debug file**

In `Resources/Anglesite-Debug-iCloud.entitlements`, add the same block (before the closing
`</dict>`, after the existing iCloud keys and before the `#775` mach-lookup workaround comment):

```xml
	<!-- Cloudflare OAuth sign-in (#1204): matches the callback Worker's `webcredentials` entry at
	     auth.anglesite.dwk.io. Requires a real provisioning profile — same reason this file (not
	     the default Debug entitlements) is where the iCloud entitlement above lives too. -->
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>webcredentials:auth.anglesite.dwk.io</string>
	</array>
```

- [ ] **Step 3: Note the omission in the default Debug file**

In `Resources/Anglesite-Debug.entitlements`, replace the existing comment block:

```xml
	<!-- NO iCloud entitlement here (#1038): unlike this file's other capabilities, iCloud
	     (com.apple.developer.icloud-container-identifiers / -services) requires Apple to issue
	     a real provisioning profile even under Manual/ad-hoc code signing — Xcode refuses to
	     build at all ("requires a provisioning profile") once it's present without a Team. This
	     is the default, CI-safe Debug entitlements file (README.md / CONTRIBUTING.md promise a
	     clone-and-build with no Apple Developer account), so it must stay without it.
	     AppSettings.sitesRoot already treats a Debug build with no iCloud entitlement/provisioning
	     the same as "iCloud unavailable" and falls back to `~/Sites/`. Contributors with a real
	     Team who want to exercise the iCloud Drive storage path (#865) locally can opt in via
	     Resources/Anglesite-Debug-iCloud.entitlements — see
	     xcconfig/Signing-Debug.local.xcconfig.example. -->
```

with:

```xml
	<!-- NO iCloud entitlement here (#1038), and NO Associated Domains entitlement here (#1204):
	     unlike this file's other capabilities, both require Apple to issue a real provisioning
	     profile even under Manual/ad-hoc code signing — Xcode refuses to build at all ("requires a
	     provisioning profile") once either is present without a Team. This is the default,
	     CI-safe Debug entitlements file (README.md / CONTRIBUTING.md promise a clone-and-build with
	     no Apple Developer account), so it must stay without them.
	     AppSettings.sitesRoot already treats a Debug build with no iCloud entitlement/provisioning
	     the same as "iCloud unavailable" and falls back to `~/Sites/`; a Debug build with no
	     Associated Domains entitlement simply can't intercept the OAuth redirect, so
	     `CloudflareOAuthSignIn`'s browser sheet falls through to the callback Worker's plain
	     fallback page (#891) instead of an in-app hand-off — the sign-in still completes, just via
	     one extra "you can close this tab" step. Contributors with a real Team who want to exercise
	     either capability locally can opt in via Resources/Anglesite-Debug-iCloud.entitlements —
	     see xcconfig/Signing-Debug.local.xcconfig.example. -->
```

- [ ] **Step 4: Verify the app target still builds**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds cleanly (default Debug config, no Associated Domains present — must stay
CI-safe/ad-hoc-buildable, per Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add Resources/Anglesite.entitlements Resources/Anglesite-Debug-iCloud.entitlements Resources/Anglesite-Debug.entitlements
git commit -m "feat(#1204): add Associated Domains entitlement for Cloudflare OAuth"
```

---

### Task 11: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full Swift package test suite**

Run: `swift test --package-path .`
Expected: PASS, including `AnglesiteCoreTests`, `AnglesiteAppTests`, `AnglesiteBridgeTests`, and
(on Swift 6.4+/Xcode 27) `AnglesiteIntentsTests`.

- [ ] **Step 2: Run the full Debug app build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: builds cleanly.

- [ ] **Step 3: Confirm no stray references to the deleted view or method remain**

Run: `grep -rn "CloudflareTokenPromptView\|verifyAndSaveToken" Sources/ Tests/ | grep -v PublishModel | grep -v GitHubTokenPromptView`
Expected: no output (the only remaining `verifyAndSaveToken` hits are `PublishModel`'s distinct
GitHub-token method and `GitHubTokenPromptView`'s call to it — both out of scope for #1204).

- [ ] **Step 4: Update the issue**

Confirm `#1204` is still labeled `🛠️ In Progress` (it was claimed at brainstorming time) and note
in the eventual PR body which manual/out-of-band follow-ups (Cloudflare OAuth client scope
widening; callback Worker Team ID addition, blocked on #891) remain before this is truly end-to-end
usable — the design doc's "Manual / out-of-band follow-ups" section is the authoritative list.

No commit for this task — it's a verification checkpoint before opening the PR.
