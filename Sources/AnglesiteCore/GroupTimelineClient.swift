import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One post from a joined community's public timeline (V-5.1a, #368) — deliberately minimal:
/// enough to render a row and open the original. `id` is the wrapped object's `id` when present
/// (a real post), else the bare activity id (an item this parser couldn't unwrap further, still
/// worth a stub row so the timeline's count matches the collection's).
public struct GroupPost: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String?
    public let contentHTML: String?
    public let url: URL?
    public let publishedAt: Date?
    public let authorName: String?

    public init(
        id: String, title: String?, contentHTML: String?, url: URL?, publishedAt: Date?,
        authorName: String?
    ) {
        self.id = id
        self.title = title
        self.contentHTML = contentHTML
        self.url = url
        self.publishedAt = publishedAt
        self.authorName = authorName
    }
}

public struct GroupTimelinePage: Sendable, Equatable {
    public let items: [GroupPost]
    public let next: URL?

    public init(items: [GroupPost], next: URL?) {
        self.items = items
        self.next = next
    }
}

public enum GroupTimelineError: Error, Equatable, Sendable {
    /// The outbox URL, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Reads a Group actor's public outbox (V-5.1a, #368) — the per-group timeline. Same
/// unauthenticated, HTTPS-only, capped, AS2-collection-paging shape as `ActivityPubFollowersClient`
/// (the collection) and `ActorProfileFetcher` (the HTTPS/size guard — this outbox is exactly as
/// attacker-influenced as a follower's actor document, just a bigger one), but the collection
/// belongs to an arbitrary *remote* Group rather than this site's own followers, and each item is
/// a full (or partial) activity to render rather than a bare actor IRI. AS2 is loose about wire
/// shape here (a bare activity-id string, or a fully embedded activity), so this parses with
/// `JSONSerialization` — like `ActivityPubOutboxBackfill.activityID(from:)` — rather than fighting
/// `Decodable` over a heterogeneous array.
public struct GroupTimelineClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 1 MB. A single actor document (`ActorProfileFetcher`'s 256 KB cap) is a few KB, but an
    /// outbox page embeds several full activities at once — generous enough for a real page of
    /// posts while still rejecting a pathological response.
    public static let maximumResponseBytes = 1024 * 1024

    private let transport: Transport

    public init(transport: @escaping Transport = GroupTimelineClient.defaultTransport) {
        self.transport = transport
    }

    public func collection(at outboxURL: URL) async throws -> (totalItems: Int, firstPage: URL?) {
        let json = try await fetch(outboxURL)
        let totalItems = json["totalItems"] as? Int ?? 0
        let firstPage = (json["first"] as? String).flatMap(URL.init(string:))
        return (totalItems, firstPage)
    }

    public func page(at url: URL) async throws -> GroupTimelinePage {
        let json = try await fetch(url)
        let rawItems = (json["orderedItems"] as? [Any]) ?? []
        let items = rawItems.compactMap(Self.post(from:))
        let next = (json["next"] as? String).flatMap(URL.init(string:))
        return GroupTimelinePage(items: items, next: next)
    }

    private func fetch(_ url: URL) async throws -> [String: Any] {
        try Self.requireHTTPS(url)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(ActivityPubFollowersClient.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = ActorProfileFetcher.timeout

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw GroupTimelineError.requestFailed(status: 0, body: "\(error)")
        }
        // URLSession follows redirects transparently, so this body may not have come from `url`
        // at all — re-check where it actually landed, exactly like `ActorProfileFetcher`.
        if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
        guard (200..<300).contains(http.statusCode) else {
            throw GroupTimelineError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        // The default transport already aborts mid-stream past the cap; this re-check holds an
        // injected transport to the same limit.
        guard data.count <= Self.maximumResponseBytes else {
            throw GroupTimelineError.requestFailed(status: 0, body: "response too large (\(data.count) bytes)")
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GroupTimelineError.decodingFailed("not a JSON object")
        }
        return json
    }

    static func requireHTTPS(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https" else { throw GroupTimelineError.insecureURL }
    }

    /// Unwraps one `Create`/`Announce` level to reach the actual post object; a bare-string item
    /// (just an activity IRI, no embedded object) becomes an id-only stub rather than being
    /// dropped, so the rendered row count still matches `totalItems`.
    static func post(from item: Any) -> GroupPost? {
        if let bareID = item as? String {
            return GroupPost(
                id: bareID, title: nil, contentHTML: nil, url: nil, publishedAt: nil, authorName: nil)
        }
        guard let activity = item as? [String: Any] else { return nil }
        let object = (activity["object"] as? [String: Any]) ?? activity
        guard let id = object["id"] as? String ?? activity["id"] as? String else { return nil }

        let publishedAt = (object["published"] as? String).flatMap {
            ISO8601DateFormatter().date(from: $0)
        }
        return GroupPost(
            id: id,
            title: (object["name"] as? String).map(DisplayString.safe),
            contentHTML: object["content"] as? String,
            url: (object["url"] as? String).flatMap(URL.init(string:)),
            publishedAt: publishedAt,
            authorName: (object["attributedTo"] as? String).map(DisplayString.safe))
    }

    private static let session = CappedHTTPTransport.session(
        requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request, session: session, cap: GroupTimelineClient.maximumResponseBytes,
            tooLarge: { GroupTimelineError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
    }
}
