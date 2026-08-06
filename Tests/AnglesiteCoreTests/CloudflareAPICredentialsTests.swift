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
            #expect(try await CloudflareAPICredentials.resolve(secretStore: InMemorySecretStore()) == nil)
        }
    }
}
