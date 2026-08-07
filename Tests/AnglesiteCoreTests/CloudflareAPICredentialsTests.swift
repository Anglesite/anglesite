import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

// Serialized: every test manipulates the process-wide `CLOUDFLARE_API_TOKEN` env var (save/restore
// around each test body), so concurrent execution within this suite would race on it.
@Suite(.serialized)
struct CloudflareAPICredentialsTests {
    private let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!

    /// Save/restore idiom for `CLOUDFLARE_API_TOKEN`, mirroring `DeployModelTests`'
    /// `clearCloudflareAPITokenEnvForTest()` (see its doc comment for the cross-suite leak, #1282,
    /// this same idiom guards against).
    private func withCloudflareEnvToken(_ value: String?, _ body: () async throws -> Void) async rethrows {
        let previous = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
        if let value { setenv("CLOUDFLARE_API_TOKEN", value, 1) } else { unsetenv("CLOUDFLARE_API_TOKEN") }
        defer {
            if let previous { setenv("CLOUDFLARE_API_TOKEN", previous, 1) } else { unsetenv("CLOUDFLARE_API_TOKEN") }
        }
        try await body()
    }

    @Test("the CLOUDFLARE_API_TOKEN env var wins over a stored OAuth credential and legacy token")
    func envVarTakesPriority() async throws {
        try await withCloudflareEnvToken("env-tok") {
            let store = InMemorySecretStore()
            try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
                accessToken: "oauth-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
            try store.writeCloudflareToken("legacy-tok")
            #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "env-tok")
        }
    }

    @Test("a stored non-expired OAuth credential wins over the legacy pasted token")
    func oauthCredentialTakesPriorityOverLegacyToken() async throws {
        try await withCloudflareEnvToken(nil) {
            let store = InMemorySecretStore()
            try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
                accessToken: "oauth-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
            try store.writeCloudflareToken("legacy-tok")
            #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "oauth-tok")
        }
    }

    @Test("falls back to the legacy pasted token when no OAuth credential is stored")
    func fallsBackToLegacyToken() async throws {
        try await withCloudflareEnvToken(nil) {
            let store = InMemorySecretStore()
            try store.writeCloudflareToken("legacy-tok")
            #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "legacy-tok")
        }
    }

    @Test("resolves nil when nothing is configured")
    func resolvesNilWhenNothingConfigured() async throws {
        try await withCloudflareEnvToken(nil) {
            let resolved = try await CloudflareAPICredentials.resolve(secretStore: InMemorySecretStore())
            #expect(resolved == nil)
        }
    }

    @Test("a genuine read error on the OAuth slot falls through to the legacy token instead of throwing")
    func oauthSlotReadErrorFallsThroughToLegacyToken() async throws {
        try await withCloudflareEnvToken(nil) {
            let store = OAuthSlotThrowingSecretStore()
            try store.writeCloudflareToken("legacy-tok")
            #expect(try await CloudflareAPICredentials.resolve(secretStore: store) == "legacy-tok")
        }
    }

    @Test("a genuine read error on the OAuth slot with no legacy token resolves nil, not a throw")
    func oauthSlotReadErrorWithNoLegacyTokenResolvesNil() async throws {
        try await withCloudflareEnvToken(nil) {
            let resolved = try await CloudflareAPICredentials.resolve(secretStore: OAuthSlotThrowingSecretStore())
            #expect(resolved == nil)
        }
    }

    @Test("surfaceOAuthReadErrors: true propagates a genuine OAuth-slot read error instead of falling through")
    func surfaceOAuthReadErrorsPropagatesInsteadOfFallingThrough() async throws {
        try await withCloudflareEnvToken(nil) {
            let store = OAuthSlotThrowingSecretStore()
            try store.writeCloudflareToken("legacy-tok")
            await #expect(throws: (any Error).self) {
                _ = try await CloudflareAPICredentials.resolve(secretStore: store, surfaceOAuthReadErrors: true)
            }
        }
    }

    @Test("surfaceOAuthReadErrors: false (the default) still falls through despite the same error")
    func surfaceOAuthReadErrorsDefaultsToFallingThrough() async throws {
        try await withCloudflareEnvToken(nil) {
            let store = OAuthSlotThrowingSecretStore()
            try store.writeCloudflareToken("legacy-tok")
            let resolved = try await CloudflareAPICredentials.resolve(secretStore: store, surfaceOAuthReadErrors: false)
            #expect(resolved == "legacy-tok")
        }
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
