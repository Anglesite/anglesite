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

    /// Refresh this long before actual expiry, so a token handed out with only a few seconds
    /// left doesn't expire mid-use in a caller that can run for minutes (e.g. a deploy).
    private static let refreshLeeway: TimeInterval = 60

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
    /// credential is expired or within `refreshLeeway` of expiring.
    public func resolve() async throws -> String? {
        guard let credential = try secretStore.readCloudflareOAuthCredential() else { return nil }
        let currentTime = now()
        guard let expiresAt = credential.expiresAt, expiresAt <= currentTime.addingTimeInterval(Self.refreshLeeway) else {
            return credential.accessToken
        }
        guard let refreshToken = credential.refreshToken,
              let refreshed = try? await refresh(refreshToken, credential.tokenEndpoint)
        else { return nil }
        let updated = CloudflareOAuthCredential(
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? refreshToken,
            expiresAt: refreshed.expiresIn.map { currentTime.addingTimeInterval(TimeInterval($0)) },
            tokenEndpoint: credential.tokenEndpoint)
        try secretStore.writeCloudflareOAuthCredential(updated)
        return updated.accessToken
    }
}
