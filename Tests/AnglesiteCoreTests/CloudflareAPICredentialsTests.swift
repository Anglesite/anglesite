import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

// Serialized out of caution: every test claims the process-wide `CLOUDFLARE_API_TOKEN` env var via
// `CloudflareAPITokenTestEnvironment` (#1211 review — it coordinates with this target's other
// suites that also touch the var, unlike a bare setenv/unsetenv save-restore), which is safe under
// concurrency by design, but keeping this suite's own tests serialized avoids relying on that for
// tests that don't otherwise need to run concurrently.
@Suite(.serialized)
struct CloudflareAPICredentialsTests {
    private let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!

    @Test("the CLOUDFLARE_API_TOKEN env var wins over a stored OAuth credential and legacy token")
    func envVarTakesPriority() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet(value: "env-tok")
        defer { cfToken.release() }
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "oauth-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
        try store.writeCloudflareToken("legacy-tok")
        #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "env-tok")
    }

    @Test("a stored non-expired OAuth credential wins over the legacy pasted token")
    func oauthCredentialTakesPriorityOverLegacyToken() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "oauth-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
        try store.writeCloudflareToken("legacy-tok")
        #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "oauth-tok")
    }

    @Test("falls back to the legacy pasted token when no OAuth credential is stored")
    func fallsBackToLegacyToken() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let store = InMemorySecretStore()
        try store.writeCloudflareToken("legacy-tok")
        #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "legacy-tok")
    }

    @Test("resolves nil when nothing is configured")
    func resolvesNilWhenNothingConfigured() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let resolved = try await CloudflareAPICredentials.resolve(secretStore: InMemorySecretStore())
        #expect(resolved == nil)
    }

    @Test("a genuine read error on the OAuth slot falls through to the legacy token instead of throwing")
    func oauthSlotReadErrorFallsThroughToLegacyToken() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let store = OAuthSlotThrowingSecretStore()
        try store.writeCloudflareToken("legacy-tok")
        #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "legacy-tok")
    }

    @Test("a genuine read error on the OAuth slot with no legacy token resolves nil, not a throw")
    func oauthSlotReadErrorWithNoLegacyTokenResolvesNil() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let resolved = try await CloudflareAPICredentials.resolve(secretStore: OAuthSlotThrowingSecretStore())
        #expect(resolved == nil)
    }

    @Test("surfaceOAuthReadErrors: true propagates a genuine OAuth-slot read error instead of falling through")
    func surfaceOAuthReadErrorsPropagatesInsteadOfFallingThrough() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let store = OAuthSlotThrowingSecretStore()
        try store.writeCloudflareToken("legacy-tok")
        await #expect(throws: (any Error).self) {
            _ = try await CloudflareAPICredentials.resolve(secretStore: store, surfaceOAuthReadErrors: true)
        }
    }

    @Test("surfaceOAuthReadErrors: false (the default) still falls through despite the same error")
    func surfaceOAuthReadErrorsDefaultsToFallingThrough() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let store = OAuthSlotThrowingSecretStore()
        try store.writeCloudflareToken("legacy-tok")
        let resolved = try await CloudflareAPICredentials.resolve(secretStore: store, surfaceOAuthReadErrors: false)
        #expect(resolved == "legacy-tok")
    }
}

/// A `SecretStore` that throws reading the OAuth access-token slot specifically (simulating a
/// genuine Keychain error, as opposed to "no credential stored," which reads as `nil` — not a
/// throw), while every other account behaves like ``InMemorySecretStore``. Pins the #1289 review
/// fix: an OAuth-slot read error must fall through to the legacy token, not propagate and skip it.
private final class OAuthSlotThrowingSecretStore: SecretStore, @unchecked Sendable {
    private struct ReadFailed: Error {}
    private let backing = InMemorySecretStore()

    func read(account: String) throws -> String? {
        if account == SecretAccounts.cloudflareOAuthAccessToken { throw ReadFailed() }
        return try backing.read(account: account)
    }
    func write(_ value: String, account: String) throws { try backing.write(value, account: account) }
    func delete(account: String) throws { try backing.delete(account: account) }
}
