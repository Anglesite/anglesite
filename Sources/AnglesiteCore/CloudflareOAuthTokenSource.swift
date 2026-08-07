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
    private let coordinator: CloudflareOAuthRefreshCoordinator

    /// - Parameters:
    ///   - secretStore: Where the OAuth credential is read from, and where a refreshed one is
    ///     persisted back to.
    ///   - refresh: Performs one refresh round trip. Injected so tests can stub it without
    ///     `CloudflareOAuthClient`'s network transport.
    ///   - now: The current time, used to check the stored credential's expiry. Injected for
    ///     deterministic expiry tests; defaults to `Date()`.
    ///   - coordinator: Serializes the refresh-and-persist step across every
    ///     `CloudflareOAuthTokenSource` instance that shares it. Defaults to a process-wide
    ///     singleton because `DeployCommand.keychainTokenSource` (and the sync jobs that resolve
    ///     through it) construct a fresh `CloudflareOAuthTokenSource` value on every call — an
    ///     instance-scoped guard would never see a second caller. Tests inject their own instance
    ///     to assert coalescing without cross-test interference.
    public init(
        secretStore: any SecretStore,
        refresh: @escaping Refresh,
        now: @escaping @Sendable () -> Date = { Date() },
        coordinator: CloudflareOAuthRefreshCoordinator = .shared
    ) {
        self.secretStore = secretStore
        self.refresh = refresh
        self.now = now
        self.coordinator = coordinator
    }

    /// Returns the access token to use, refreshing and persisting a new one first if the stored
    /// credential is expired or within `refreshLeeway` of expiring.
    public func resolve() async throws -> String? {
        guard let credential = try secretStore.readCloudflareOAuthCredential() else { return nil }
        let currentTime = now()
        guard let expiresAt = credential.expiresAt, expiresAt <= currentTime.addingTimeInterval(Self.refreshLeeway) else {
            return credential.accessToken
        }
        guard let refreshToken = credential.refreshToken else { return nil }
        return try await coordinator.refresh(
            refreshToken: refreshToken,
            tokenEndpoint: credential.tokenEndpoint,
            secretStore: secretStore,
            refresh: refresh,
            now: now)
    }
}

/// Single-flights `CloudflareOAuthTokenSource`'s refresh-and-persist step so concurrent callers
/// that both observe the same expired credential await one in-flight refresh instead of each
/// starting their own — see #1296. Without this, two racing refreshes reuse the same (possibly
/// single-use) stored refresh token and then race to write back their own result, with the loser
/// either failing outright or clobbering the winner's newer credential.
///
/// Scoped to a single Cloudflare account: this app stores exactly one OAuth credential under a
/// shared account key (``SecretStore/readCloudflareOAuthCredential()``), so one in-flight slot is
/// enough — there's no per-account keying to do.
public actor CloudflareOAuthRefreshCoordinator {
    public static let shared = CloudflareOAuthRefreshCoordinator()

    private var inFlight: Task<String?, Error>?

    public init() {}

    func refresh(
        refreshToken: String,
        tokenEndpoint: URL,
        secretStore: any SecretStore,
        refresh: @escaping CloudflareOAuthTokenSource.Refresh,
        now: @escaping @Sendable () -> Date
    ) async throws -> String? {
        if let inFlight { return try await inFlight.value }
        let task = Task<String?, Error> {
            guard let refreshed = try? await refresh(refreshToken, tokenEndpoint) else { return nil }
            let updated = CloudflareOAuthCredential(
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? refreshToken,
                expiresAt: refreshed.expiresIn.map { now().addingTimeInterval(TimeInterval($0)) },
                tokenEndpoint: tokenEndpoint)
            try secretStore.writeCloudflareOAuthCredential(updated)
            return updated.accessToken
        }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }
}
