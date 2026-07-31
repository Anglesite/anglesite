import Foundation

/// Non-secret account coordinates plus the corresponding secret-store values for one POSSE run.
public struct POSSECredentials: Equatable, Sendable {
    /// Everything ``MastodonPOSSEClient`` needs for one post.
    public struct Mastodon: Equatable, Sendable {
        /// The instance origin (e.g. `https://mastodon.social`) the statuses endpoint is
        /// resolved against — per-account, since Mastodon is federated.
        public let baseURL: URL
        /// OAuth access token with `write:statuses` scope. A secret — held in memory for the
        /// duration of a run only; persistence belongs to the platform secret store.
        public let accessToken: String

        /// Memberwise initializer.
        public init(baseURL: URL, accessToken: String) {
            self.baseURL = baseURL
            self.accessToken = accessToken
        }
    }

    /// Everything ``BlueskyPOSSEClient`` needs for one post.
    public struct Bluesky: Equatable, Sendable {
        /// The PDS origin XRPC calls are resolved against; `https://bsky.social` for almost
        /// everyone, but configurable for self-hosted PDSes.
        public let pdsURL: URL
        /// Handle or DID used to create the session.
        public let identifier: String
        /// App password (not the account password) — Bluesky's revocable per-app credential.
        /// A secret; same in-memory-only handling as the Mastodon token.
        public let appPassword: String

        /// Memberwise initializer.
        public init(pdsURL: URL, identifier: String, appPassword: String) {
            self.pdsURL = pdsURL
            self.identifier = identifier
            self.appPassword = appPassword
        }
    }

    /// Mastodon account, or `nil` when unconfigured — the syndication pass then skips
    /// Mastodon targets with a logged explanation instead of failing the run.
    public let mastodon: Mastodon?
    /// Bluesky account, or `nil` when unconfigured (same skip-with-log behavior).
    public let bluesky: Bluesky?

    /// Memberwise initializer; each platform defaults to unconfigured.
    public init(mastodon: Mastodon? = nil, bluesky: Bluesky? = nil) {
        self.mastodon = mastodon
        self.bluesky = bluesky
    }
}

/// Resolves per-site POSSE credentials at syndication time. Resolution is deferred to a
/// closure (rather than resolved once at init) because settings and secrets can change
/// between deploys within one app session.
public enum POSSECredentialResolver {
    /// Late-bound credential lookup injected into ``POSSESyndicationCommand`` — a closure so
    /// tests can substitute fixed credentials without touching the secret store.
    public typealias Provider = @Sendable (_ siteID: String, _ configDirectory: URL) -> POSSECredentials

    /// Builds a provider backed by `Config/settings.plist` + the platform secret store. Environment
    /// variables are an automation/development fallback and never get persisted or logged.
    public static func provider(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Provider {
        { siteID, configDirectory in
            let settings = (try? SiteConfigStore.read(from: configDirectory)) ?? SiteSettings()

            let mastodonOrigin = nonBlank(settings.mastodonBaseURL)
                ?? nonBlank(environment["ANGLESITE_MASTODON_BASE_URL"])
            let mastodonToken = ((try? secretStore.read(
                account: SecretAccounts.mastodonAccessToken(siteID: siteID)
            )) ?? nil).flatMap(nonBlank)
                ?? nonBlank(environment["ANGLESITE_MASTODON_ACCESS_TOKEN"])
            let mastodon: POSSECredentials.Mastodon?
            if let mastodonOrigin, let baseURL = httpURL(mastodonOrigin), let mastodonToken {
                mastodon = .init(baseURL: baseURL, accessToken: mastodonToken)
            } else {
                mastodon = nil
            }

            let blueskyIdentifier = nonBlank(settings.blueskyIdentifier)
                ?? nonBlank(environment["ANGLESITE_BLUESKY_IDENTIFIER"])
            let blueskyPassword = ((try? secretStore.read(
                account: SecretAccounts.blueskyAppPassword(siteID: siteID)
            )) ?? nil).flatMap(nonBlank)
                ?? nonBlank(environment["ANGLESITE_BLUESKY_APP_PASSWORD"])
            let pdsString = nonBlank(settings.blueskyPDSURL)
                ?? nonBlank(environment["ANGLESITE_BLUESKY_PDS_URL"])
                ?? "https://bsky.social"
            let bluesky: POSSECredentials.Bluesky?
            if let blueskyIdentifier, let blueskyPassword, let pdsURL = httpURL(pdsString) {
                bluesky = .init(pdsURL: pdsURL, identifier: blueskyIdentifier, appPassword: blueskyPassword)
            } else {
                bluesky = nil
            }
            return POSSECredentials(mastodon: mastodon, bluesky: bluesky)
        }
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private static func httpURL(_ value: String) -> URL? {
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host != nil else { return nil }
        return url
    }
}
