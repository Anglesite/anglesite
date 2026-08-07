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
            now: { self.epoch },
            // A dedicated coordinator keeps this test isolated from other tests that also
            // trigger a refresh through the `.shared` default (#1296 follow-up: parallel
            // Swift Testing execution let tests cross-contaminate via the shared singleton).
            coordinator: CloudflareOAuthRefreshCoordinator())

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
            now: { self.epoch },
            coordinator: CloudflareOAuthRefreshCoordinator())

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
            now: { self.epoch },
            coordinator: CloudflareOAuthRefreshCoordinator())
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
            now: { self.epoch },
            coordinator: CloudflareOAuthRefreshCoordinator())
        #expect(try await source.resolve() == nil)
        #expect(try store.readCloudflareOAuthCredential() == original)
    }

    /// Records calls and blocks each one on a continuation until released, so a test can force
    /// two concurrent `resolve()` calls to overlap a single in-flight refresh (#1296).
    private actor RefreshGate {
        private(set) var callCount = 0
        private var continuation: CheckedContinuation<Void, Never>?

        func recordCallAndWaitForRelease() async {
            callCount += 1
            await withCheckedContinuation { continuation = $0 }
        }

        func release() {
            continuation?.resume()
            continuation = nil
        }
    }

    @Test("two concurrent resolve() calls on the same expired credential share one in-flight refresh")
    func concurrentResolvesCoalesceIntoOneRefresh() async throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "old-tok", refreshToken: "old-refresh", expiresAt: epoch.addingTimeInterval(-1),
            tokenEndpoint: endpoint))
        // A dedicated coordinator (rather than `.shared`) keeps this test isolated from others
        // that also exercise `CloudflareOAuthTokenSource`.
        let coordinator = CloudflareOAuthRefreshCoordinator()
        let gate = RefreshGate()
        let source = CloudflareOAuthTokenSource(
            secretStore: store,
            refresh: { _, _ in
                await gate.recordCallAndWaitForRelease()
                return OAuthToken(accessToken: "new-tok", tokenType: "bearer", expiresIn: 3600, refreshToken: "new-refresh")
            },
            now: { self.epoch },
            coordinator: coordinator)

        async let first = source.resolve()
        // Wait for the first call's refresh to actually start (and block on the gate) before
        // starting the second — otherwise the second might race ahead and see no in-flight task.
        while await gate.callCount == 0 { await Task.yield() }
        async let second = source.resolve()
        await Task.yield()
        await gate.release()

        #expect(try await first == "new-tok")
        #expect(try await second == "new-tok")
        #expect(await gate.callCount == 1)
        #expect(try store.readCloudflareOAuthCredential()?.refreshToken == "new-refresh")
    }
}
