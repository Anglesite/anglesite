import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A remote actor resolved from a fediverse handle or a pasted URL — the join flow's first step
/// (V-5.1a, #368). Carries just enough to display a confirmation ("Join Birding (Lemmy)?"),
/// address a `Follow`, and read the group's timeline.
public struct ResolvedCommunityActor: Sendable, Equatable {
    /// The actor document's own `id` — the canonical IRI to address a `Follow`'s `object` at.
    /// May differ from the URL that was fetched (webfinger's `self` link, or a pasted URL that
    /// redirected).
    public let actorID: URL
    /// The actor's public outbox collection, for `GroupTimelineClient`. `nil` for an actor
    /// document that doesn't advertise one — the timeline pane degrades to "no timeline available".
    public let outboxURL: URL?
    public let type: String?
    public let preferredUsername: String?
    public let name: String?
    /// The `@name@host` (or `!name@host`) form the owner typed, sanitized for display.
    public let handle: String?

    public init(
        actorID: URL, outboxURL: URL?, type: String?, preferredUsername: String?, name: String?,
        handle: String?
    ) {
        self.actorID = actorID
        self.outboxURL = outboxURL
        self.type = type
        self.preferredUsername = preferredUsername
        self.name = name
        self.handle = handle
    }
}

public enum CommunityActorResolverError: Error, Equatable, Sendable {
    case invalidHandle
    case insecureURL
    case webfingerFailed(status: Int, body: String)
    /// The webfinger response had no `rel: "self"` AS2 link to follow.
    case noActorLink
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Resolves a fediverse handle (`!community@host`, `@user@host`, bare `name@host`) or a pasted
/// actor URL to its actor document. Mirrors `@dwk/webfinger`'s `lookup.ts` (`parseHandle`,
/// `webfingerQueryUrl`, `selectActorLink`, `resolveHandle`) client-side in Swift: this app makes
/// its own outbound request as the signed-in user, so — like `ActorProfileFetcher` — it needs
/// HTTPS-only and a byte cap, not the server-side SSRF guard `@dwk/activitypub`'s own resolver
/// applies (that guard exists because *that* resolution runs inside a shared Cloudflare Worker).
public struct CommunityActorResolver: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let transport: Transport

    public init(transport: @escaping Transport = CommunityActorResolver.defaultTransport) {
        self.transport = transport
    }

    public func resolve(_ input: String) async throws -> ResolvedCommunityActor {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let scheme = url.scheme, url.host != nil,
           ["http", "https"].contains(scheme.lowercased()) {
            try Self.requireHTTPS(url)
            return try await fetchActor(at: url, handle: nil)
        }
        guard let (name, host) = Self.parseHandle(trimmed) else {
            throw CommunityActorResolverError.invalidHandle
        }
        let actorURL = try await webfingerResolve(name: name, host: host)
        return try await fetchActor(at: actorURL, handle: DisplayString.safe("@\(name)@\(host)"))
    }

    /// Strips an optional leading `@`/`!` sigil, then splits on the *last* `@` so a name segment
    /// that itself contains `@` (unlikely, but not this code's job to reject) still yields the
    /// intended host. Returns `nil` for input with no `@` at all — the "not a handle" signal that
    /// sends the caller down the URL path (which will itself reject it as invalid).
    static func parseHandle(_ input: String) -> (name: String, host: String)? {
        var body = input
        if body.hasPrefix("@") || body.hasPrefix("!") { body.removeFirst() }
        guard let atIndex = body.lastIndex(of: "@") else { return nil }
        let name = String(body[body.startIndex..<atIndex])
        let host = String(body[body.index(after: atIndex)...])
        guard !name.isEmpty, !host.isEmpty else { return nil }
        return (name, host)
    }

    private func webfingerResolve(name: String, host: String) async throws -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = "/.well-known/webfinger"
        components.queryItems = [URLQueryItem(name: "resource", value: "acct:\(name)@\(host)")]
        guard let webfingerURL = components.url else { throw CommunityActorResolverError.invalidHandle }

        var request = URLRequest(url: webfingerURL)
        request.httpMethod = "GET"
        request.timeoutInterval = ActorProfileFetcher.timeout
        let (data, http) = try await send(request)
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityActorResolverError.webfingerFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        struct Link: Decodable { let rel: String?; let type: String?; let href: String? }
        struct DTO: Decodable { let links: [Link]? }
        let dto: DTO
        do {
            dto = try JSONDecoder().decode(DTO.self, from: data)
        } catch {
            throw CommunityActorResolverError.decodingFailed("\(error)")
        }
        guard let href = dto.links?.first(where: {
            $0.rel == "self" && ($0.type?.contains("activity+json") == true || $0.type?.contains("ld+json") == true)
        })?.href, let actorURL = URL(string: href) else {
            throw CommunityActorResolverError.noActorLink
        }
        try Self.requireHTTPS(actorURL)
        return actorURL
    }

    private func fetchActor(at url: URL, handle: String?) async throws -> ResolvedCommunityActor {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(ActivityPubFollowersClient.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = ActorProfileFetcher.timeout
        let (data, http) = try await send(request)
        if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
        guard (200..<300).contains(http.statusCode) else {
            throw CommunityActorResolverError.requestFailed(
                status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        struct DTO: Decodable {
            let id: String
            let type: String?
            let preferredUsername: String?
            let name: String?
            let outbox: String?
        }
        do {
            let dto = try JSONDecoder().decode(DTO.self, from: data)
            guard let actorID = URL(string: dto.id) else {
                throw CommunityActorResolverError.decodingFailed("actor id is not a URL: \(dto.id)")
            }
            return ResolvedCommunityActor(
                actorID: actorID,
                outboxURL: dto.outbox.flatMap(URL.init(string:)),
                type: dto.type,
                preferredUsername: dto.preferredUsername.map(DisplayString.safe),
                name: dto.name.map(DisplayString.safe),
                handle: handle)
        } catch let error as CommunityActorResolverError {
            throw error
        } catch {
            throw CommunityActorResolverError.decodingFailed("\(error)")
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(request)
        } catch {
            throw CommunityActorResolverError.requestFailed(status: 0, body: "\(error)")
        }
    }

    static func requireHTTPS(_ url: URL) throws {
        guard url.scheme?.lowercased() == "https" else { throw CommunityActorResolverError.insecureURL }
    }

    private static let session = CappedHTTPTransport.session(
        requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request, session: session, cap: ActorProfileFetcher.maximumResponseBytes,
            tooLarge: { CommunityActorResolverError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
    }
}
