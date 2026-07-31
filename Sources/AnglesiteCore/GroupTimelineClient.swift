import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One post from a joined community's public timeline (V-5.1a, #368) — deliberately minimal:
/// enough to render a row and open the original. `id` is the wrapped object's `id` when present
/// (a real post), else the bare activity id (an item this parser couldn't unwrap further, still
/// worth a stub row so the timeline's count matches the collection's).
public struct GroupPost: Sendable, Equatable, Identifiable {
    /// The post's ActivityPub IRI — the wrapped object's `id` for a real post, or the bare
    /// activity id for a stub row (see the type-level note).
    public let id: String
    /// The post's `name`, sanitized through ``DisplayString``; `nil` for untitled notes.
    public let title: String?
    /// The post's `content` HTML, sanitized through ``DisplayString`` — it can be rendered as
    /// the row's fallback text when there is no ``title``, so it gets the same bidi/control-
    /// scalar stripping.
    public let contentHTML: String?
    /// The post's own `url`, for opening the original in a browser; `nil` on stub rows.
    public let url: URL?
    /// The object's `published` timestamp, when it parsed as ISO 8601.
    public let publishedAt: Date?
    /// The `attributedTo` value (an actor IRI, not a resolved display name), sanitized through
    /// ``DisplayString``.
    public let authorName: String?

    /// Memberwise initializer, public so views and tests can build rows without parsing AS2.
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

/// One page of a Group outbox, plus the link to the next — the unit of incremental loading, so
/// the timeline can render page-by-page instead of fetching a whole (possibly huge) outbox.
public struct GroupTimelinePage: Sendable, Equatable {
    /// The page's posts, in the collection's own order.
    public let items: [GroupPost]
    /// The AS2 `next` page URL; `nil` on the last page.
    public let next: URL?

    /// Memberwise initializer, public so tests can fabricate pages without AS2 fixtures.
    public init(items: [GroupPost], next: URL?) {
        self.items = items
        self.next = next
    }
}

/// Why a Group timeline fetch failed. Each case keeps enough context (status, truncated body,
/// decode reason) to debug a remote server's behavior from a log line.
public enum GroupTimelineError: Error, Equatable, Sendable {
    /// The outbox URL, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    /// The request failed at the HTTP layer: a non-2xx status with a body excerpt capped at
    /// 400 bytes, or `status: 0` for transport-level failures (connection error, over-size
    /// response).
    case requestFailed(status: Int, body: String)
    /// The response wasn't the expected JSON object; carries a short reason.
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
    /// Performs one GET and returns its body + response; throws on connection failure.
    /// Injectable so the AS2 parsing and HTTPS/size guards are testable without network.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 1 MB. A single actor document (`ActorProfileFetcher`'s 256 KB cap) is a few KB, but an
    /// outbox page embeds several full activities at once — generous enough for a real page of
    /// posts while still rejecting a pathological response.
    public static let maximumResponseBytes = 1024 * 1024

    private let transport: Transport

    /// The transport parameter exists for tests; production uses ``defaultTransport``, which
    /// enforces the response-size cap mid-stream.
    public init(transport: @escaping Transport = GroupTimelineClient.defaultTransport) {
        self.transport = transport
    }

    /// Fetches the outbox's top-level collection document: its advertised `totalItems` (0 when
    /// absent) and the `first` page URL, `nil` when the collection is empty or inlined. Callers
    /// use `totalItems` to decide whether the stub-row parse actually covered the collection.
    public func collection(at outboxURL: URL) async throws -> (totalItems: Int, firstPage: URL?) {
        let json = try await fetch(outboxURL)
        let totalItems = json["totalItems"] as? Int ?? 0
        let firstPage = (json["first"] as? String).flatMap(URL.init(string:))
        return (totalItems, firstPage)
    }

    /// Fetches one outbox page and parses its `orderedItems` into ``GroupPost`` rows (bare-IRI
    /// items become id-only stubs; genuinely unparseable items are dropped), plus the `next`
    /// page URL for continued paging.
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
            // `CommunitiesView` falls back to rendering this verbatim when there's no `title`,
            // so it needs the same bidi/control-scalar stripping as `title`/`authorName`.
            contentHTML: (object["content"] as? String).map(DisplayString.safe),
            url: (object["url"] as? String).flatMap(URL.init(string:)),
            publishedAt: publishedAt,
            authorName: (object["attributedTo"] as? String).map(DisplayString.safe))
    }

    private static let session = CappedHTTPTransport.session(
        requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

    /// Production transport: a `CappedHTTPTransport` fetch that aborts mid-stream once
    /// ``maximumResponseBytes`` is exceeded, so a hostile outbox can't buffer unbounded data
    /// before the post-hoc size check runs.
    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request, session: session, cap: GroupTimelineClient.maximumResponseBytes,
            tooLarge: { GroupTimelineError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
    }
}
