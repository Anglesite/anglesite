import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Orchestrates #362's "pull the Worker's verified webmention inbox and snapshot it into the
/// site's git working copy" step: query D1 (`WebmentionInboxD1Client`), reconcile + commit
/// (`ReceivedInteractionCommitter`). This is the counterpart to #587's `InboxSubmissionSync`, but
/// there is no staging store to drain — D1 remains the permanent operational store, so every call
/// reconciles against the *current full inbox*, not just what's new since last time. Designed to
/// be called once per site-open (`PreviewModel.open(site:)`), alongside `InboxSubmissionSync`.
public enum ReceivedInteractionSync {
    /// Maps one D1 row to the git-canonical schema. Returns `nil` (skip, don't fail the whole
    /// pull) when `source`/`target` aren't parseable URLs, or the id fails
    /// `ReceivedInteraction`'s path-traversal guard — a malformed row shouldn't block every other
    /// mention. An unrecognized/absent `interactionType` defaults to `.mention`, and an absent
    /// `publishedAt` falls back to `verifiedAt`, mirroring `InboxStore.list()`'s own defaults on
    /// the Worker side (`packages/webmention/src/inbox.ts`) — including rows written by
    /// `@dwk/webmention` versions published before the mf2-enrichment columns existed.
    static func makeInteraction(from mention: WebmentionInboxD1Client.Mention) -> ReceivedInteraction? {
        guard let source = URL(string: mention.source), let target = URL(string: mention.target) else { return nil }
        let interactionType = mention.interactionType.flatMap(ReceivedInteraction.InteractionType.init(rawValue:)) ?? .mention
        let author: ReceivedInteraction.Author? =
            (mention.authorName != nil || mention.authorURL != nil || mention.authorPhoto != nil)
            ? .init(
                name: mention.authorName,
                url: mention.authorURL.flatMap(URL.init(string:)),
                photo: mention.authorPhoto.flatMap(URL.init(string:)))
            : nil
        let verifiedAt = Double(mention.verifiedAt) / 1000
        let publishedAt = Double(mention.publishedAt ?? mention.verifiedAt) / 1000
        return try? ReceivedInteraction(
            id: mention.id, type: .webmention, source: source, target: target,
            interactionType: interactionType, author: author, content: mention.content,
            published: Date(timeIntervalSince1970: publishedAt),
            verified: Date(timeIntervalSince1970: verifiedAt), verificationStatus: .verified)
    }

    /// Queries `client` for the full current inbox, maps it to `ReceivedInteraction`, and
    /// reconciles it into `siteDirectory`. Returns 0 (never throws) if the D1 query failed, so
    /// callers simply re-attempt on the next site-open rather than surfacing a transient network
    /// error. An empty inbox still reconciles (proceeds to `commit`) rather than short-circuiting,
    /// so previously-snapshotted mentions that were later unverified/removed still get cleaned up.
    public static func pullAndCommit(client: WebmentionInboxD1Client, siteDirectory: URL) async -> Int {
        guard let mentions = try? await client.listVerifiedMentions() else { return 0 }
        let interactions = mentions.compactMap(Self.makeInteraction(from:))
        let committedIDs = await ReceivedInteractionCommitter.commit(interactions: interactions, into: siteDirectory)
        return committedIDs.count
    }

    private struct CFAccount: Decodable, Sendable { let id: String }
    private struct CFEnvelope: Decodable, Sendable { let success: Bool; let result: [CFAccount]? }

    /// Resolves the token's first visible Cloudflare account id — same "just take the first
    /// account" resolution `HTTPCloudflareClient.workerScriptNames`/`CloudflareCapabilityProber`
    /// use, since a personal Anglesite deployment has exactly one Cloudflare account per token, and
    /// there is no separate stored account id for webmention/D1 to key off (unlike #587's
    /// `inboxCaptureAccountID`, since the D1 database itself is already identified by
    /// `SiteSettings.provisionedWorkerResources.d1DatabaseID`).
    private static func resolveAccountID(apiToken: String, baseURL: String, transport: CloudflareTransport) async -> String? {
        guard let url = URL(string: "\(baseURL)/accounts?per_page=1") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        guard let (data, http) = try? await transport(request), (200..<300).contains(http.statusCode),
              let envelope = try? JSONDecoder().decode(CFEnvelope.self, from: data), envelope.success
        else { return nil }
        return envelope.result?.first?.id
    }

    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless a D1 database has been provisioned
    /// (`provisionedWorkerResources.d1DatabaseID`, set once the webmention receive Worker has been
    /// provisioned — see `SocialWorkerProvisionCommand`) and a token is available.
    /// `configDirectory` is the package's `Config/` directory (`AnglesitePackage.configURL`), a
    /// sibling of `siteDirectory` (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let databaseID = settings.provisionedWorkerResources?.d1DatabaseID, !databaseID.isEmpty,
              let token = try? secretStore.readCloudflareToken(), !token.isEmpty
        else { return 0 }
        guard let accountID = await Self.resolveAccountID(apiToken: token, baseURL: baseURL, transport: transport)
        else { return 0 }

        let client = WebmentionInboxD1Client(
            accountID: accountID, databaseID: databaseID, apiToken: token, baseURL: baseURL, transport: transport)
        return await pullAndCommit(client: client, siteDirectory: siteDirectory)
    }
}
