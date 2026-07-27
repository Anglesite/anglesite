import Foundation

/// Portable seam for storing small user secrets (API tokens) — seam 1 of the cross-platform
/// port design (docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md §5).
///
/// Implementations: `KeychainStore` (Darwin, SecItem generic passwords); a libsecret/Secret
/// Service store arrives with the Linux MVP; Windows gets Credential Manager. Platforms
/// without a native implementation yet use `UnavailableSecretStore`, which reads as "nothing
/// stored" and refuses writes — features degrade capability-flagged, never by silently
/// dropping a secret.
///
/// Semantics all implementations must uphold (mirrored from `KeychainStore`, the reference
/// implementation, and pinned by its test suite):
/// - `read` returns `nil` (not an error) when no entry exists.
/// - `write("")` deletes the entry, so an empty write round-trips as `read → nil`.
/// - `delete` of a missing entry is a no-op, not an error.
/// - Values are secrets: implementations and callers must never log them.
public protocol SecretStore: Sendable {
    /// Returns the stored secret for `account`, or `nil` if no entry exists.
    func read(account: String) throws -> String?
    /// Writes `value` for `account`, replacing any existing entry. An empty `value` deletes.
    func write(_ value: String, account: String) throws
    /// Removes the stored entry for `account`. No-op if no entry exists.
    func delete(account: String) throws
}

/// Well-known account keys, shared across platform stores so the Settings UI, deploy path,
/// and onboarding all address the same slot regardless of backend.
public enum SecretAccounts {
    /// The Cloudflare API token used by `wrangler deploy`.
    public static let cloudflareToken = "cloudflare-api-token"
    /// The GitHub personal access token used for in-process git pushes (#653) and the GitHub
    /// REST API (#654). The app owns this credential: the old `gh auth login` flow left the
    /// token with `gh`, which the sandboxed app can neither spawn nor read.
    public static let gitHubToken = "github-token"
    /// Bearer token for the user's deployed Sandbox Control Worker (#66/#71) — the credential
    /// `HTTPSandboxControlClient` sends on `start`/`status`/`stop`. Distinct from
    /// `cloudflareToken` (a Cloudflare *API* token): this one is minted for the Control Worker
    /// during remote-runtime onboarding and never reaches api.cloudflare.com.
    public static let sandboxControlToken = "sandbox-control-token"

    /// Site-scoped POSSE token slots. Account names include the stable site UUID so credentials
    /// never leak across two packages configured for different social accounts.
    public static func mastodonAccessToken(siteID: String) -> String {
        "posse:\(siteID):mastodon-access-token"
    }

    public static func blueskyAppPassword(siteID: String) -> String {
        "posse:\(siteID):bluesky-app-password"
    }

    /// The ActivityPub actor's signing keypair (PKCS#8 PEM, private half only — the public half
    /// is re-derived on demand). App-generated once per site by `ActivityPubKeyProvisioning`
    /// (#363) and never regenerated: a rotated key breaks federation trust with existing
    /// followers, unlike the opaque tokens above which can be rotated freely.
    public static func activityPubPrivateKeyPem(siteID: String) -> String {
        "activitypub:\(siteID):private-key-pem"
    }

    /// Bearer token gating `@dwk/activitypub`'s owner-only publish endpoint
    /// (`POST <actor>/outbox`), which this app's Micropub-to-ActivityPub fan-out calls
    /// internally. App-generated random bytes, distinct from `activityPubPrivateKeyPem` — unlike
    /// the signing key, rotating this has no federation-trust consequence, but it still must
    /// never be a hardcoded constant (this endpoint's fan-out caller and target both live in the
    /// open-source template shipped to every site).
    public static func activityPubPublishToken(siteID: String) -> String {
        "activitypub:\(siteID):publish-token"
    }

    /// The site's own IndieAuth-issued DPoP-bound access token (V-4.3, #365) — what
    /// `MicrosubClient` presents to the site's deployed `/microsub` endpoint. Deliberately
    /// separate from `cloudflareToken`: this credential is minted by the site itself during
    /// `SiteIndieAuthClient` sign-in and never reaches api.cloudflare.com.
    public static func indieAuthAccessToken(siteID: String) -> String {
        "indieauth:\(siteID):access-token"
    }

    /// The raw private-key bytes (`DPoPKeyPair.persistedRepresentation`) bound to
    /// `indieAuthAccessToken`'s `cnf.jkt` — every resource request must sign its DPoP proof with
    /// this same key pair, so it's persisted alongside the token rather than regenerated per call.
    public static func indieAuthDPoPKey(siteID: String) -> String {
        "indieauth:\(siteID):dpop-key"
    }

    /// Bearer token for a `.remote` ACP agent connection, keyed by the connection's `id` — there
    /// can be many connections, so this is a function, not a single constant like
    /// `cloudflareToken`/`gitHubToken`.
    public static func acpAgentToken(id: UUID) -> String {
        "acp-agent-token-\(id.uuidString)"
    }
}

public extension SecretStore {
    /// Read the Cloudflare API token under the shared account key.
    func readCloudflareToken() throws -> String? {
        try read(account: SecretAccounts.cloudflareToken)
    }

    /// Store the Cloudflare API token under the shared account key. Empty string clears.
    func writeCloudflareToken(_ token: String) throws {
        try write(token, account: SecretAccounts.cloudflareToken)
    }

    /// Clear the Cloudflare API token slot.
    func clearCloudflareToken() throws {
        try delete(account: SecretAccounts.cloudflareToken)
    }

    /// Read the GitHub personal access token under the shared account key.
    func readGitHubToken() throws -> String? {
        try read(account: SecretAccounts.gitHubToken)
    }

    /// Store the GitHub personal access token under the shared account key. Empty string clears.
    func writeGitHubToken(_ token: String) throws {
        try write(token, account: SecretAccounts.gitHubToken)
    }

    /// Clear the GitHub personal access token slot.
    func clearGitHubToken() throws {
        try delete(account: SecretAccounts.gitHubToken)
    }

    /// Read the bearer token for a `.remote` ACP agent connection.
    func readACPAgentToken(id: UUID) throws -> String? {
        try read(account: SecretAccounts.acpAgentToken(id: id))
    }

    /// Store the bearer token for a `.remote` ACP agent connection. Empty string clears.
    func writeACPAgentToken(_ token: String, id: UUID) throws {
        try write(token, account: SecretAccounts.acpAgentToken(id: id))
    }

    /// Clear the bearer token for a `.remote` ACP agent connection.
    func clearACPAgentToken(id: UUID) throws {
        try delete(account: SecretAccounts.acpAgentToken(id: id))
    }

    /// Read the site's IndieAuth access token (V-4.3, #365).
    func readIndieAuthAccessToken(siteID: String) throws -> String? {
        try read(account: SecretAccounts.indieAuthAccessToken(siteID: siteID))
    }

    /// Store the site's IndieAuth access token. Empty string clears.
    func writeIndieAuthAccessToken(_ token: String, siteID: String) throws {
        try write(token, account: SecretAccounts.indieAuthAccessToken(siteID: siteID))
    }

    /// Read the DPoP key pair bound to the site's IndieAuth session, if any. `nil` when unset or
    /// the stored bytes no longer decode as a P-256 private key.
    func readIndieAuthDPoPKeyPair(siteID: String) throws -> DPoPKeyPair? {
        guard let base64 = try read(account: SecretAccounts.indieAuthDPoPKey(siteID: siteID)),
              let data = Data(base64Encoded: base64) else { return nil }
        return DPoPKeyPair(persistedRepresentation: data)
    }

    /// Store the DPoP key pair bound to the site's IndieAuth session.
    func writeIndieAuthDPoPKeyPair(_ keyPair: DPoPKeyPair, siteID: String) throws {
        try write(
            keyPair.persistedRepresentation.base64EncodedString(),
            account: SecretAccounts.indieAuthDPoPKey(siteID: siteID)
        )
    }

    /// Clear the site's IndieAuth access token and its bound DPoP key pair together — a token
    /// without its key (or vice versa) can never produce a valid proof, so the two are always
    /// cleared as one unit rather than leaving either behind.
    func clearIndieAuthSession(siteID: String) throws {
        try delete(account: SecretAccounts.indieAuthAccessToken(siteID: siteID))
        try delete(account: SecretAccounts.indieAuthDPoPKey(siteID: siteID))
    }
}

/// Placeholder store for platforms without a native secret-store implementation yet
/// (Linux until the libsecret store lands). Reads report "nothing stored" so token
/// resolution falls through to environment variables; writes fail loudly rather than
/// pretending a secret was persisted.
public struct UnavailableSecretStore: SecretStore {
    public struct WriteUnsupported: Error {}

    public init() {}

    public func read(account: String) throws -> String? { nil }

    public func write(_ value: String, account: String) throws {
        // Uphold the protocol contract: an empty write means delete, and deleting from a
        // store that holds nothing is a successful no-op. Only persisting is unsupported.
        if value.isEmpty { return }
        throw WriteUnsupported()
    }

    public func delete(account: String) throws {}
}

/// Composition-root factory for the platform's default secret store. Call sites in the
/// portable core depend on `any SecretStore` and use this only as their production default;
/// tests and the app shell inject concrete stores directly.
public enum PlatformSecretStore {
    public static func make() -> any SecretStore {
        #if canImport(Security)
        KeychainStore()
        #else
        UnavailableSecretStore()
        #endif
    }
}
