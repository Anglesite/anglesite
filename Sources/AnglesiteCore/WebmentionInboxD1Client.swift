import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cloudflare D1 HTTP API client for `@dwk/webmention`'s inbox table (#362). The per-site Worker
/// (`Resources/Template/worker/worker.ts`) binds a shared per-site D1 database under
/// `WEBMENTION_INBOX`; `createD1Inbox` (in the sibling `davidwkeith/workers` monorepo) creates its
/// own `webmentions` table inside it on first use. This is the app-side reader — the counterpart
/// to `InboxKVClient` for #587's `INBOX_KV`, same injectable-transport DI pattern, no Keychain
/// coupling, token passed in at init.
///
/// The row shape is queried, not decoded from the npm package's TypeScript types, so this client
/// tolerates the enrichment columns (`interaction_type`, `author_*`, `content`, `published_at`)
/// being entirely `NULL` — the shape written by `@dwk/webmention` versions published before the
/// mf2-enrichment pass (issue #417 upstream) landed. Once a site redeploys against a version that
/// populates them, the same query returns richer rows with no app-side change needed.
public struct WebmentionInboxD1Client: Sendable {
    /// A verified mention row as read from the `webmentions` D1 table — field names mirror
    /// `@dwk/webmention`'s `VerifiedMention` (`packages/webmention/src/inbox.ts`), flattened
    /// (`author.name` -> `authorName`, etc.) since this is a SQL projection, not a JSON decode of
    /// that type. Dates are epoch milliseconds, matching the column types.
    public struct Mention: Sendable, Equatable {
        /// Stable row id (upstream's FNV-1a hash of source+target) — rows without one are
        /// skipped at decode, so this is non-optional here even though the column predates it.
        public let id: String
        /// URL of the page that mentioned us.
        public let source: String
        /// URL on this site that was mentioned.
        public let target: String
        /// When the Worker verified the mention, in epoch milliseconds (the column's native unit).
        public let verifiedAt: Int
        /// Microformats interaction class (`like`, `repost`, `reply`, …) — `nil` on rows written
        /// before the mf2-enrichment pass landed upstream.
        public let interactionType: String?
        /// Author display name from the source page's h-card, when enrichment ran.
        public let authorName: String?
        /// Author profile URL from the source page's h-card, when enrichment ran.
        public let authorURL: String?
        /// Author avatar URL from the source page's h-card, when enrichment ran.
        public let authorPhoto: String?
        /// Excerpted mention content (reply text), when enrichment ran.
        public let content: String?
        /// Source page's declared publication date in epoch milliseconds, when enrichment ran.
        public let publishedAt: Int?
    }

    private struct Row: Decodable {
        let id: String?
        let source: String
        let target: String
        let verified_at: Int
        let interaction_type: String?
        let author_name: String?
        let author_url: String?
        let author_photo: String?
        let content: String?
        let published_at: Int?
    }

    private struct QueryResult: Decodable {
        let results: [Row]?
        let success: Bool
    }

    private struct Envelope: Decodable {
        let success: Bool
        let result: [QueryResult]?
    }

    private struct QueryBody: Encodable {
        let sql: String
    }

    /// Selects every row, newest-verified first, mirroring `InboxStore.list()`'s own ordering
    /// (`packages/webmention/src/inbox.ts`) with no `target` filter — the snapshot step wants the
    /// whole inbox, not one post's mentions.
    private static let listVerifiedSQL = """
    SELECT id, source, target, verified_at, interaction_type, author_name, author_url, \
    author_photo, content, published_at FROM webmentions ORDER BY verified_at DESC
    """

    private let baseURL: String
    private let accountID: String
    private let databaseID: String
    private let apiToken: String
    private let transport: CloudflareTransport

    /// Creates a client for one site's inbox database. The token is passed in directly (no
    /// Keychain coupling — the caller owns credential resolution, matching `InboxKVClient`);
    /// `baseURL` and `transport` are injectable so tests can point at a stub instead of the
    /// live Cloudflare API.
    public init(
        accountID: String,
        databaseID: String,
        apiToken: String,
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) {
        self.accountID = accountID
        self.databaseID = databaseID
        self.apiToken = apiToken
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Lists every verified mention currently in the inbox. A row with no `id` (written before
    /// the `id` column existed, per the upstream package's migration notes) is skipped rather than
    /// re-deriving the id — that would require reimplementing `@dwk/mf2`'s FNV-1a hash in Swift
    /// for a case that can't occur on an inbox created by the current package version.
    public func listVerifiedMentions() async throws -> [Mention] {
        let url = URL(string: "\(baseURL)/accounts/\(accountID)/d1/database/\(databaseID)/query")
        guard let url else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(QueryBody(sql: Self.listVerifiedSQL))

        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data), envelope.success,
              let rows = envelope.result?.first?.results
        else { throw CloudflareError.malformedResponse }

        return rows.compactMap { row in
            guard let id = row.id else { return nil }
            return Mention(
                id: id, source: row.source, target: row.target, verifiedAt: row.verified_at,
                interactionType: row.interaction_type, authorName: row.author_name,
                authorURL: row.author_url, authorPhoto: row.author_photo, content: row.content,
                publishedAt: row.published_at)
        }
    }
}
