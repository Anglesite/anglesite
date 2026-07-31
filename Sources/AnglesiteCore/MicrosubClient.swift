import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A JF2 (https://jf2.spec.indieweb.org/) timeline entry, as `@dwk/microsub` normalizes every
/// followed feed's entries into regardless of the source's wire format (JSON Feed, Atom, RSS,
/// h-feed). Mirrors `Jf2Entry` in the sidecar's `jf2.ts`.
public struct MicrosubTimelineEntry: Sendable, Equatable, Decodable, Identifiable {
    /// The entry's author card, flattened to the three JF2 author fields — every field is
    /// optional because feeds vary wildly in what they expose.
    public struct Author: Sendable, Equatable, Decodable {
        /// The author's display name.
        public let name: String?
        /// The author's profile URL.
        public let url: String?
        /// URL of the author's avatar image.
        public let photo: String?
    }

    /// The entry's body, in whichever representations the source feed carried — one of the two
    /// is usually present, but neither is guaranteed.
    public struct Content: Sendable, Equatable, Decodable {
        /// The HTML body, when the source had one.
        public let html: String?
        /// The plain-text body, when the source had one.
        public let text: String?
    }

    /// Stable per-entry identifier the store dedupes on across polls.
    public let id: String
    /// The entry's permalink on the source site.
    public let url: String?
    /// Publication timestamp as the source supplied it. Kept a string (not a `Date`) because
    /// JF2 passes feed timestamps through and formats vary by source — parsing/formatting is
    /// the display layer's problem.
    public let published: String?
    /// The entry's title (`name` in JF2/mf2 terms); `nil` for untitled notes, which is the
    /// common case for social-style posts.
    public let name: String?
    /// A short summary distinct from the body, when the feed provides one.
    public let summary: String?
    /// The entry's body; `nil` for entries that only carry a `name`/`summary`.
    public let content: Content?
    /// The author card, when the feed exposes one.
    public let author: Author?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case url, published, name, summary, content, author
    }
}

/// A Microsub channel: a named grouping of follows with an unread count. The `notifications`
/// channel always exists and can't be deleted/renamed (`store.ts`'s `NOTIFICATIONS_CHANNEL`).
public struct MicrosubChannel: Sendable, Equatable, Decodable, Identifiable {
    /// Server-assigned stable channel identifier — what every timeline/follow call keys on.
    public let uid: String
    /// The owner-facing channel name (renameable, unlike `uid`).
    public let name: String
    /// Unread-entry count; `nil` when the server omits it.
    public let unread: Int?
    /// `Identifiable` keyed on the stable `uid`, not the renameable `name`, so SwiftUI lists
    /// keep identity across a rename.
    public var id: String { uid }
}

/// One page of a channel's timeline, with opaque before/after cursors for further paging.
public struct MicrosubTimelinePage: Sendable, Equatable, Decodable {
    /// Opaque paging cursors. Pass one back verbatim to
    /// ``MicrosubClient/timeline(channel:before:after:)`` — the server defines their meaning,
    /// so the client never inspects or synthesizes them.
    public struct Paging: Sendable, Equatable, Decodable {
        /// Cursor for the page of entries newer than this one; `nil` at the newest edge.
        public let before: String?
        /// Cursor for the page of entries older than this one; `nil` at the oldest edge.
        public let after: String?
    }

    /// The page's entries, in the server's timeline order.
    public let items: [MicrosubTimelineEntry]
    /// Cursors for fetching the adjacent pages.
    public let paging: Paging
}

/// Failures surfaced by ``MicrosubClient`` calls.
public enum MicrosubError: Error, Equatable, Sendable {
    /// The endpoint returned a non-2xx status; `body` is the raw response for diagnostics.
    case requestFailed(status: Int, body: String)
    /// The response wasn't the JSON shape the action expects; the payload carries the
    /// underlying decoding error's description (stringly, so the enum stays `Equatable`).
    case decodingFailed(String)
    /// Signing the DPoP proof needs CryptoKit (Apple platforms only).
    case dpopUnavailable
}

/// A client for one site's deployed `@dwk/microsub` endpoint — follow/unfollow feeds, list
/// channels, and page the normalized JF2 timeline. Every call is a DPoP-bound, bearer-authorized
/// request (RFC 9449) built fresh per call from the injected `dpopKeyPair`/`accessToken`, mirroring
/// `InboxKVClient`'s injectable-`Transport` shape so this stays unit-testable without real
/// networking. `SiteIndieAuthClient` is how the caller obtains the token + key pair in the first
/// place; this type only *presents* them.
public struct MicrosubClient: Sendable {
    /// The injectable network seam: tests substitute a closure that captures the fully-built
    /// request (headers, DPoP proof and all) and returns a canned response, so request
    /// construction is exercised without real networking.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// The site's `/microsub` endpoint (absolute URL, no query).
    private let endpoint: URL
    private let accessToken: String
    private let dpopKeyPair: DPoPKeyPair
    private let transport: Transport

    /// Creates a client for the site's `endpoint`, presenting `accessToken` DPoP-bound to
    /// `dpopKeyPair` on every call. The token and key pair must come from the same
    /// `SiteIndieAuthClient` grant — the server verifies the proof's key thumbprint against the
    /// token's binding, so mixing grants fails auth even though both values look valid alone.
    public init(
        endpoint: URL,
        accessToken: String,
        dpopKeyPair: DPoPKeyPair,
        transport: @escaping Transport = MicrosubClient.defaultTransport
    ) {
        self.endpoint = endpoint
        self.accessToken = accessToken
        self.dpopKeyPair = dpopKeyPair
        self.transport = transport
    }

    /// Lists the site's channels with their unread counts.
    public func listChannels() async throws -> [MicrosubChannel] {
        struct Response: Decodable { let channels: [MicrosubChannel] }
        let response: Response = try await get(query: [URLQueryItem(name: "action", value: "channels")])
        return response.channels
    }

    /// Creates a new channel and returns it.
    public func createChannel(name: String) async throws -> MicrosubChannel {
        try await post(action: "channels", body: ["name": name])
    }

    /// Follows `url` (a feed or a page discovery finds a feed from) into `channel`. Populates the
    /// timeline immediately from the server's discovery fetch when possible; either way the poller
    /// picks the feed up on its next scheduled run.
    public func follow(url: String, channel: String) async throws {
        try await postDiscardingResponse(action: "follow", body: ["channel": channel, "url": url])
    }

    /// Unfollows `url` from `channel`.
    public func unfollow(url: String, channel: String) async throws {
        try await postDiscardingResponse(action: "unfollow", body: ["channel": channel, "url": url])
    }

    /// Pages `channel`'s timeline. Pass exactly one of `before`/`after` (the previous page's
    /// matching cursor) to page; pass neither for the first page.
    public func timeline(channel: String, before: String? = nil, after: String? = nil) async throws -> MicrosubTimelinePage {
        var query = [URLQueryItem(name: "action", value: "timeline"), URLQueryItem(name: "channel", value: channel)]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        if let after { query.append(URLQueryItem(name: "after", value: after)) }
        return try await get(query: query)
    }

    /// Marks `entries` (entry ids) as read in `channel`.
    public func markRead(channel: String, entries: [String]) async throws {
        try await postDiscardingResponse(
            action: "timeline",
            body: ["channel": channel, "method": "mark_read", "entry": entries]
        )
    }

    // MARK: - Request plumbing

    private func get<Response: Decodable>(query: [URLQueryItem]) async throws -> Response {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw MicrosubError.decodingFailed("malformed endpoint URL")
        }
        components.queryItems = query
        guard let url = components.url else {
            throw MicrosubError.decodingFailed("couldn't build request URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await sendAuthorized(request, method: "GET")
    }

    private func post<Response: Decodable>(action: String, body: [String: Any]) async throws -> Response {
        var payload = body
        payload["action"] = action
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        return try await sendAuthorized(request, method: "POST")
    }

    /// For actions whose response body carries nothing the caller needs (`{}` on success).
    private func postDiscardingResponse(action: String, body: [String: Any]) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await post(action: action, body: body)
    }

    /// Signs and sends `request` and — on an RFC 9449 §8 `use_dpop_nonce` challenge — retries
    /// exactly once with a fresh proof echoing the nonce, before applying the ordinary
    /// status/decode checks. Every microsub action (`get`/`post` above) funnels through here, so
    /// the retry applies uniformly to every action, GET and POST alike.
    private func sendAuthorized<Response: Decodable>(_ request: URLRequest, method: String) async throws -> Response {
        var (data, http) = try await authorizedSend(request, method: method, nonce: nil)
        if let nonce = DPoPNonceChallenge.nonce(in: data, response: http) {
            (data, http) = try await authorizedSend(request, method: method, nonce: nonce)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw MicrosubError.requestFailed(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw MicrosubError.decodingFailed("\(error)")
        }
    }

    private func authorizedSend(_ request: URLRequest, method: String, nonce: String?) async throws -> (Data, HTTPURLResponse) {
        var signedRequest = request
        try authorize(&signedRequest, method: method, nonce: nonce)
        do {
            return try await transport(signedRequest)
        } catch {
            throw MicrosubError.requestFailed(status: 0, body: error.localizedDescription)
        }
    }

    /// Attaches the `Authorization: DPoP <token>` and `DPoP: <proof>` headers RFC 9449 requires —
    /// every microsub action is authorized this way, GET and POST alike (`auth.ts`'s `authorize`
    /// always passes `accessToken` to `verifyDpopProof`, so `ath` is never optional here). The
    /// proof's `htu` is the bare endpoint URL (no query) — matching the server's
    /// `expectedHtu: config.microsubEndpoint`, which `verifyDpopProof`'s own `normalizeHtu` would
    /// strip a query string from regardless. `nonce` echoes a prior RFC 9449 §8 challenge on
    /// retry (`authorizedSend`'s job to supply it); omitted on the first attempt.
    private func authorize(_ request: inout URLRequest, method: String, nonce: String? = nil) throws {
        request.setValue("DPoP \(accessToken)", forHTTPHeaderField: "Authorization")
        do {
            let proof = try dpopKeyPair.proof(htm: method, htu: endpoint.absoluteString, accessToken: accessToken, nonce: nonce)
            request.setValue(proof, forHTTPHeaderField: "DPoP")
        } catch is DPoPError {
            throw MicrosubError.dpopUnavailable
        }
    }

    /// Production transport: a plain `URLSession` request, no auth of its own (that's `authorize`'s job).
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
