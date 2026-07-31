import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cloudflare D1 HTTP API client for `@dwk/micropub`'s `posts` table (#912). Mirrors
/// `WebmentionInboxD1Client` exactly — same injectable-transport DI, same D1 HTTP query shape —
/// reading the shared `{site}-social` D1 database's Micropub post store instead of the
/// webmention inbox. See docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §2.
public struct MicropubPostD1Client: Sendable {
    /// A stored Micropub post, as read from the `posts` table
    /// (`@dwk/micropub`'s `packages/micropub/src/store.ts`).
    public struct Post: Sendable, Equatable {
        /// The post's canonical URL — the `posts` table's identity, and the only place its
        /// collection/slug live (the sync bridge parses them back out of the URL rather than
        /// re-classifying from mf2).
        public let url: String
        /// The mf2 root type, e.g. `"h-entry"`.
        public let type: String
        /// The raw mf2 property map — each property name maps to its ordered value list,
        /// matching `@dwk/micropub`'s `Record<string, unknown[]>` storage shape.
        public let properties: [String: [JSONValue]]
        /// Soft-delete flag. Deleted rows are still returned by `listAllPosts` on purpose: the
        /// sync bridge needs them to remove their git snapshot on the next reconcile.
        public let deleted: Bool
        /// The row's `updated_at` column, Unix seconds.
        public let updatedAt: Int

        /// Memberwise initializer — public chiefly so tests can build fixture rows without
        /// round-tripping a fake D1 response.
        public init(url: String, type: String, properties: [String: [JSONValue]], deleted: Bool, updatedAt: Int) {
            self.url = url
            self.type = type
            self.properties = properties
            self.deleted = deleted
            self.updatedAt = updatedAt
        }
    }

    private struct Row: Decodable {
        let url: String
        let type: String
        let properties: String
        let deleted: Int
        let updated_at: Int
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

    /// Selects every post row — live and soft-deleted alike, newest-updated first. The sync
    /// bridge needs soft-deleted rows too, so it can remove their git snapshot on the next
    /// reconcile (mirrors `ReceivedInteractionSync`'s "pull the full current set" pattern).
    private static let listAllSQL =
        "SELECT url, type, properties, deleted, updated_at FROM posts ORDER BY updated_at DESC"

    private let baseURL: String
    private let accountID: String
    private let databaseID: String
    private let apiToken: String
    private let transport: CloudflareTransport

    /// Creates a client for one account's D1 database. `baseURL` and `transport` are injectable
    /// (same DI shape as ``WebmentionInboxD1Client``) so tests exercise real request
    /// construction and response decoding without networking.
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

    /// Lists every post currently in `MICROPUB_DB`, live and soft-deleted alike. A row whose
    /// `properties` column isn't valid JSON (or isn't a JSON object of arrays) is skipped rather
    /// than failing the whole pull — a single malformed row shouldn't block every other post.
    public func listAllPosts() async throws -> [Post] {
        let url = URL(string: "\(baseURL)/accounts/\(accountID)/d1/database/\(databaseID)/query")
        guard let url else { throw CloudflareError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(QueryBody(sql: Self.listAllSQL))

        let (data, http) = try await transport(request)
        if http.statusCode == 401 || http.statusCode == 403 { throw CloudflareError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw CloudflareError.http(status: http.statusCode) }
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data), envelope.success,
              let rows = envelope.result?.first?.results
        else { throw CloudflareError.malformedResponse }

        var posts: [Post] = []
        for row in rows {
            guard let propertiesData = row.properties.data(using: .utf8),
                  let raw = try? JSONSerialization.jsonObject(with: propertiesData) as? [String: [Any]]
            else {
                await LogCenter.shared.append(
                    source: "MicropubPostD1Client", stream: .stderr,
                    text: "Skipping Micropub post \(row.url): properties column is not valid JSON. "
                        + "It will be re-attempted on the next pull.")
                continue
            }
            var properties: [String: [JSONValue]] = [:]
            for (key, values) in raw {
                properties[key] = values.compactMap(JSONValue.from)
            }
            posts.append(Post(
                url: row.url, type: row.type, properties: properties,
                deleted: row.deleted != 0, updatedAt: row.updated_at))
        }
        return posts
    }
}
