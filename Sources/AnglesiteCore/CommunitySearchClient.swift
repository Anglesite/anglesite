import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One community returned by a keyword search — the Discovery step's result row (V-5.4, #371).
/// `actorID` is ready to feed straight into `CommunityActorResolver.resolve(_:)` (as a pasted-URL
/// input, skipping webfinger) and from there into `CommunityMembershipClient.follow(target:)` —
/// the same join path #368 already ships, just fed from a search result instead of a typed handle.
public struct CommunitySearchResult: Sendable, Equatable, Identifiable {
    /// `Identifiable` conformance for the result list — the actor IRI string, which is the only
    /// value guaranteed unique across instances (two instances can both host a `birding`).
    public var id: String { actorID.absoluteString }
    /// The community's actor IRI, already guaranteed HTTPS — insecure results are dropped during
    /// decoding rather than surfaced as rows that fail on tap.
    public let actorID: URL
    /// The community's short machine name (`birding`), sanitized via ``DisplayString`` —
    /// remote-controlled text that ends up in UI.
    public let name: String
    /// The community's human-readable title, sanitized like ``name``; `nil` when the instance
    /// doesn't provide one.
    public let title: String?
    /// The host the community actually lives on — read from `actorID`, not the instance that was
    /// queried: Lemmy's federated search can surface communities from other instances than the
    /// one asked, and the join flow's confirmation should say where the community really is.
    public let instance: String
    /// Subscriber count for the result row's popularity hint; `nil` when the instance omits
    /// counts rather than showing a misleading zero.
    public let subscriberCount: Int?

    /// Memberwise initializer — public so tests and previews can build result rows directly;
    /// production values come from ``CommunitySearchClient/search(query:instance:)``, which is
    /// where the HTTPS filter and display sanitization happen.
    public init(actorID: URL, name: String, title: String?, instance: String, subscriberCount: Int?) {
        self.actorID = actorID
        self.name = name
        self.title = title
        self.instance = instance
        self.subscriberCount = subscriberCount
    }
}

/// Failures from ``CommunitySearchClient``. `Equatable` so tests can match the exact failure
/// rather than string-compare error dumps.
public enum CommunitySearchError: Error, Equatable, Sendable {
    /// The query was empty after trimming — caught client-side so the sheet can validate before
    /// any network round-trip.
    case emptyQuery
    /// The instance field couldn't be turned into a host — empty, or unparseable as a bare
    /// host, `host:port`, or http(s) URL.
    case invalidInstance
    /// The search URL (or the URL a redirect actually landed on) wasn't HTTPS.
    case insecureURL
    /// The search request failed — non-2xx, a transport error (status 0), or an injected
    /// transport exceeding the byte cap. `body` is capped at the first 400 bytes, enough to
    /// diagnose without echoing an arbitrary remote payload into logs/UI.
    case requestFailed(status: Int, body: String)
    /// The response wasn't the Lemmy search shape expected; carries the underlying decoding
    /// error's description (stringified so the case stays `Equatable`).
    case decodingFailed(String)
}

/// Searches a fediverse instance's own community directory by keyword (V-5.4, #371) — the
/// Discovery step feeding #368's join flow, per the plan's constraint to consume an existing open
/// network rather than host a new directory.
///
/// Queries Lemmy's own `GET /api/v3/search` (documented at
/// https://join-lemmy.org/docs/contributors/04-api.html /
/// https://mv-gh.github.io/lemmy_openapi_spec/; verified 2026-07-30 unauthenticated against
/// `lemmy.world`, which returns `actor_id`/`counts.subscribers` with no auth header at all) —
/// picked over lemmyverse.net's aggregate JSON dump (a static bulk export meant for offline
/// analysis, not a live query API — using it as a search source would mean the app downloading,
/// caching, and indexing a directory itself) and third-party fediverse search services (no stable
/// public spec comparable to Lemmy's own API; see issue #371's source-selection comment for the
/// full comparison). `instance` is caller-supplied and not defaulted here — the join sheet is
/// where the user picks/edits it, matching the issue's "source is configurable in the sheet"
/// requirement; this client only enforces that whatever instance it's given is queried securely.
///
/// This searches Lemmy communities specifically. It doesn't narrow what the join flow can join —
/// `CommunityActorResolver` already resolves a handle or URL for any FEP-1b12 software (Mastodon,
/// PieFed, Mbin, Friendica, Hubzilla, PeerTube); search is an additive discovery aid on top of
/// that, not a replacement for it.
public struct CommunitySearchClient: Sendable {
    /// Injection seam for tests — lets suites feed canned search responses without a network.
    /// Production uses ``defaultTransport``, which enforces the byte cap mid-stream.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// A search response is a short list of communities, not an outbox page of activities — reuses
    /// `ActorProfileFetcher`'s cap/timeouts rather than defining its own, same reuse `CommunityActorResolver`
    /// already does for the same reason.
    public static let maximumResponseBytes = ActorProfileFetcher.maximumResponseBytes
    /// Pre-filled instance for the join sheet's search field — the largest general-purpose Lemmy
    /// instance, whose federated search surfaces communities from across the network. A starting
    /// point only: the field stays editable (issue #371's "source is configurable" requirement),
    /// and this client never falls back to it on its own.
    public static let defaultInstance = "lemmy.world"

    private let transport: Transport

    /// Creates a search client, defaulting to the capped HTTPS ``defaultTransport``; pass a
    /// custom ``Transport`` only in tests (the post-fetch guards re-apply the byte cap either way).
    public init(transport: @escaping Transport = CommunitySearchClient.defaultTransport) {
        self.transport = transport
    }

    /// Runs a keyword community search against `instance`'s `/api/v3/search`, returning up to 20
    /// results sorted by all-time popularity. Results whose own `actor_id` isn't a secure URL
    /// are silently dropped (they couldn't be joined through ``CommunityActorResolver`` anyway),
    /// and all display strings are sanitized — so every returned row is safe to show and safe to
    /// tap.
    ///
    /// - Throws: ``CommunitySearchError`` for an empty query, an unusable or insecure instance,
    ///   or a failed/oversized/undecodable response.
    public func search(query: String, instance: String) async throws -> [CommunitySearchResult] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { throw CommunitySearchError.emptyQuery }
        guard let url = Self.searchURL(instance: instance, query: trimmedQuery) else {
            throw CommunitySearchError.invalidInstance
        }
        try Self.requireHTTPS(url)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = ActorProfileFetcher.timeout
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw CommunitySearchError.requestFailed(status: 0, body: "\(error)")
        }
        // URLSession follows redirects transparently, so this body may not have come from the
        // instance that was asked — re-check where it actually landed, mirroring
        // `CommunityActorResolver`'s same guard on its own webfinger/actor fetches.
        if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
        guard (200..<300).contains(http.statusCode) else {
            throw CommunitySearchError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        // The default transport already aborts mid-stream past the cap; this re-check holds an
        // injected transport to the same limit, mirroring `CommunityActorResolver`.
        guard data.count <= Self.maximumResponseBytes else {
            throw CommunitySearchError.requestFailed(
                status: 0, body: "response too large (\(data.count) bytes)")
        }

        struct CommunityDTO: Decodable {
            let name: String
            let title: String?
            let actor_id: String
        }
        struct CountsDTO: Decodable { let subscribers: Int? }
        struct CommunityViewDTO: Decodable {
            let community: CommunityDTO
            let counts: CountsDTO?
        }
        struct SearchResponseDTO: Decodable { let communities: [CommunityViewDTO]? }

        let dto: SearchResponseDTO
        do {
            dto = try JSONDecoder().decode(SearchResponseDTO.self, from: data)
        } catch {
            throw CommunitySearchError.decodingFailed("\(error)")
        }
        return (dto.communities ?? []).compactMap { view in
            // A result whose own `actor_id` isn't a secure URL can't be joined through
            // `CommunityActorResolver` anyway (it enforces HTTPS on exactly this field) — drop it
            // here rather than surfacing a row that fails the moment it's tapped.
            guard let actorID = URL(string: view.community.actor_id),
                  actorID.scheme?.lowercased() == "https", let host = actorID.host
            else { return nil }
            return CommunitySearchResult(
                actorID: actorID,
                name: DisplayString.safe(view.community.name),
                title: view.community.title.map(DisplayString.safe),
                instance: host,
                subscriberCount: view.counts?.subscribers)
        }
    }

    /// Accepts a bare host (`lemmy.world`), a bare `host:port` (a self-hosted instance on a
    /// non-standard port), or a pasted `https://lemmy.world[:port]` URL — the join sheet's
    /// search-instance field is free text, and users copy instance addresses from anywhere (a
    /// link, an app's "about" page) that may or may not include the scheme or a port.
    private static func searchURL(instance: String, query: String) -> URL? {
        let trimmed = instance.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let host: String
        let port: Int?
        if let parsed = URL(string: trimmed), let parsedHost = parsed.host,
           ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") {
            host = parsedHost
            port = parsed.port
        } else if let colonIndex = trimmed.lastIndex(of: ":"),
                  let parsedPort = Int(trimmed[trimmed.index(after: colonIndex)...]) {
            // A bare `host:port` has no `//` authority marker, so `URL(string:)` parses the part
            // before the colon as a *scheme* (RFC 3986 allows dots in a scheme) rather than a
            // host — e.g. `URL(string: "lemmy.example:8080")` yields `scheme: "lemmy.example",
            // host: nil`. Needs its own split rather than relying on `URL`'s parse.
            host = String(trimmed[trimmed.startIndex..<colonIndex])
            port = parsedPort
        } else {
            host = trimmed
            port = nil
        }
        guard !host.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.port = port
        components.path = "/api/v3/search"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "type_", value: "Communities"),
            URLQueryItem(name: "listing_type", value: "All"),
            URLQueryItem(name: "sort", value: "TopAll"),
            URLQueryItem(name: "limit", value: "20"),
        ]
        return components.url
    }

    private static func requireHTTPS(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https" else { throw CommunitySearchError.insecureURL }
    }

    private static let session = CappedHTTPTransport.session(
        requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

    /// Production transport: a shared `CappedHTTPTransport` session that aborts mid-stream once
    /// ``maximumResponseBytes`` is exceeded — a hostile instance can't make the app buffer an
    /// unbounded body before the post-fetch size check runs.
    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request, session: session, cap: maximumResponseBytes,
            tooLarge: { CommunitySearchError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
    }
}
