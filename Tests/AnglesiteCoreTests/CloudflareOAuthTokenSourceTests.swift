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

    @Test("a credential expiring within the 60s leeway refreshes ahead of actual expiry")
    func refreshesCredentialWithinLeeway() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "soon-to-expire-tok", refreshToken: "old-refresh",
            expiresAt: epoch.addingTimeInterval(30), tokenEndpoint: endpoint))
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
