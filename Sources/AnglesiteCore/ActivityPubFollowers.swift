import Foundation

/// The site's single ActivityPub actor, as V-4.1 (#363) composed it into the template Worker.
///
/// One fixed actor per site — there is no per-site username setting, by design (see the V-4.1
/// design doc's scope section).
public enum ActivityPubActor {
    /// The fixed actor username. Must stay in step with `ACTIVITYPUB_USERNAME` in
    /// `Resources/Template/worker/worker.ts`, which owns the value; `ActivityPubActorTests`
    /// locks the pair together, since nothing else would catch a rename.
    public static let username = "site"

    /// `https://<site>/users/site` — the actor document, and the URL a Mastodon user pastes into
    /// search to find this site (until WebFinger ships, #366).
    public static func actorURL(siteURL: URL) -> URL {
        siteURL
            .appendingPathComponent("users")
            .appendingPathComponent(username)
    }

    /// `https://<site>/users/site/followers` — the public, unauthenticated AS2 collection.
    public static func followersURL(siteURL: URL) -> URL {
        actorURL(siteURL: siteURL).appendingPathComponent("followers")
    }
}

// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin platforms
// (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The `OrderedCollection` head of the followers collection.
public struct FollowersCollection: Sendable, Equatable {
    public let totalItems: Int
    /// `nil` when `totalItems == 0` — `@dwk/activitypub` omits `first` entirely for an empty
    /// collection, which is how the genuine empty state is detected without a second request.
    public let firstPage: URL?

    public init(totalItems: Int, firstPage: URL?) {
        self.totalItems = totalItems
        self.firstPage = firstPage
    }
}

/// One `OrderedCollectionPage` of follower actor IRIs, newest follower first.
public struct FollowersPage: Sendable, Equatable {
    public let items: [URL]
    /// `nil` on the last page. Paging follows this link rather than counting against
    /// `totalItems`, so the client never needs to know the server's page size.
    public let next: URL?

    public init(items: [URL], next: URL?) {
        self.items = items
        self.next = next
    }
}

public enum ActivityPubFollowersError: Error, Equatable, Sendable {
    /// Non-2xx, or a transport failure (`status: 0`). `503` means ActivityPub isn't provisioned
    /// for this site; `404` means the Worker isn't deployed. The pane distinguishes them.
    case requestFailed(status: Int, body: String)
    case decodingFailed(String)
}

/// Reads one site's public ActivityPub followers collection.
///
/// Mirrors `MicrosubClient`'s injectable-`Transport` shape so it unit-tests without real
/// networking — but deliberately carries no auth layer at all. Unlike Microsub, this collection
/// is served unauthenticated straight from the actor's Durable Object, so there is no bearer
/// token, no DPoP proof, and no nonce retry here.
public struct ActivityPubFollowersClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// The `Accept` AS2 requires; Fediverse servers content-negotiate on it and will serve HTML
    /// to a client that doesn't send it.
    static let acceptHeader =
        "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""

    private let followersURL: URL
    private let transport: Transport

    public init(
        siteURL: URL,
        transport: @escaping Transport = ActivityPubFollowersClient.defaultTransport
    ) {
        self.followersURL = ActivityPubActor.followersURL(siteURL: siteURL)
        self.transport = transport
    }

    /// The collection head: how many followers there are, and where page 1 lives.
    public func collection() async throws -> FollowersCollection {
        struct DTO: Decodable {
            let totalItems: Int
            let first: String?
        }
        let dto: DTO = try await fetch(followersURL)
        return FollowersCollection(
            totalItems: dto.totalItems, firstPage: dto.first.flatMap(URL.init(string:)))
    }

    /// One page. Pass `FollowersCollection.firstPage`, then each returned `next` in turn.
    public func page(at url: URL) async throws -> FollowersPage {
        struct DTO: Decodable {
            let orderedItems: [String]?
            let next: String?
        }
        let dto: DTO = try await fetch(url)
        return FollowersPage(
            items: (dto.orderedItems ?? []).compactMap(URL.init(string:)),
            next: dto.next.flatMap(URL.init(string:)))
    }

    private func fetch<Response: Decodable>(_ url: URL) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = 10

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw ActivityPubFollowersError.requestFailed(
                status: 0, body: error.localizedDescription)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ActivityPubFollowersError.requestFailed(
                status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw ActivityPubFollowersError.decodingFailed("\(error)")
        }
    }

    /// Production transport: a plain `URLSession` request. The collection needs no credentials.
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
