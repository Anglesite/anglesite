import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A follower's display identity, fetched from their home instance's actor document.
///
/// Only the icon's *URL* is kept, never image bytes: `AsyncImage` fetches the image and
/// URLSession's HTTP cache handles reuse, which keeps the persisted cache small and stops the
/// app becoming an image store.
public struct ActorProfile: Codable, Equatable, Sendable {
    public let actor: URL
    public let preferredUsername: String?
    public let name: String?
    public let iconURL: URL?
    public let fetchedAt: Date

    public init(
        actor: URL,
        preferredUsername: String?,
        name: String?,
        iconURL: URL?,
        fetchedAt: Date
    ) {
        self.actor = actor
        self.preferredUsername = preferredUsername
        self.name = name
        self.iconURL = iconURL
        self.fetchedAt = fetchedAt
    }
}

public enum ActorProfileError: Error, Equatable, Sendable {
    /// The actor IRI, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    case responseTooLarge(Int)
    case requestFailed(status: Int)
    case decodingFailed(String)
}

/// Fetches one follower's actor document.
///
/// Everything this touches is attacker-supplied: any Fediverse user can follow the site and
/// thereby put an IRI and a display string in front of this code. Hence HTTPS-only (re-checked
/// after redirects), a hard byte cap enforced *during* transfer, and a short timeout. Callers
/// treat every failure as non-fatal — the row falls back to its derived handle.
public struct ActorProfileFetcher: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 256 KB. An actor document is a few KB; anything approaching this is pathological.
    public static let maximumResponseBytes = 256 * 1024
    public static let timeout: TimeInterval = 10

    private let transport: Transport

    public init(transport: @escaping Transport = ActorProfileFetcher.defaultTransport) {
        self.transport = transport
    }

    public func profile(for actor: URL, now: Date = Date()) async throws -> ActorProfile {
        try Self.requireHTTPS(actor)

        var request = URLRequest(url: actor)
        request.httpMethod = "GET"
        request.setValue(
            ActivityPubFollowersClient.acceptHeader, forHTTPHeaderField: "Accept")
        request.timeoutInterval = Self.timeout

        let (data, http) = try await transport(request)

        // URLSession follows redirects transparently, so this body may not have come from
        // `actor` at all. Re-check where it actually landed before trusting it.
        if let finalURL = http.url { try Self.requireHTTPS(finalURL) }

        guard (200..<300).contains(http.statusCode) else {
            throw ActorProfileError.requestFailed(status: http.statusCode)
        }
        // The default transport already aborts mid-stream past the cap; this re-check holds an
        // injected transport to the same limit.
        guard data.count <= Self.maximumResponseBytes else {
            throw ActorProfileError.responseTooLarge(data.count)
        }
        return try Self.decode(data, actor: actor, now: now)
    }

    /// The one place the HTTPS rule is expressed. `FollowersView` calls this before handing a
    /// follower-supplied IRI to `NSWorkspace.open`, so "Open Profile" is held to the same rule
    /// as a fetch.
    public static func isHTTPS(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
    }

    static func requireHTTPS(_ url: URL) throws {
        guard isHTTPS(url) else { throw ActorProfileError.insecureURL }
    }

    static func decode(_ data: Data, actor: URL, now: Date) throws -> ActorProfile {
        struct DTO: Decodable {
            let preferredUsername: String?
            let name: String?
            let icon: Icon?
        }
        do {
            let dto = try JSONDecoder().decode(DTO.self, from: data)
            // An avatar served over plaintext is dropped rather than failing the whole profile.
            let icon = dto.icon?.url
                .flatMap(URL.init(string:))
                .flatMap { isHTTPS($0) ? $0 : nil }
            // `name`/`preferredUsername` are picked outright by the remote server — more freely
            // attacker-controlled than the IRI path segment `ActorHandle` guards — and can smuggle
            // bidi-control scalars (e.g. U+202E) that make the rendered name visually impersonate
            // a different, trusted one. Route both through `DisplayString.safe` before storing.
            return ActorProfile(
                actor: actor,
                preferredUsername: dto.preferredUsername.map(DisplayString.safe),
                name: dto.name.map(DisplayString.safe),
                iconURL: icon,
                fetchedAt: now)
        } catch {
            throw ActorProfileError.decodingFailed("\(error)")
        }
    }

    /// AS2 permits `icon` as a bare URL string, an `Image` object carrying a `url`, or an array
    /// of either — deployed instances ship all three shapes, so decoding accepts all three
    /// rather than failing the whole profile over an avatar.
    struct Icon: Decodable {
        let url: String?

        init(from decoder: Decoder) throws {
            struct Object: Decodable { let url: String? }
            let container = try decoder.singleValueContainer()

            if let string = try? container.decode(String.self) {
                url = string
            } else if let object = try? container.decode(Object.self) {
                url = object.url
            } else if let objects = try? container.decode([Object].self) {
                url = objects.first?.url
            } else if let strings = try? container.decode([String].self) {
                url = strings.first
            } else {
                url = nil
            }
        }
    }

    /// Production transport. Streams the body so the size cap is enforced *during* transfer —
    /// `URLSession.data(for:)` buffers the whole response before returning, which would make a
    /// post-hoc `data.count` check purely decorative.
    public static let defaultTransport: Transport = { request in
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }

        let cap = ActorProfileFetcher.maximumResponseBytes
        if http.expectedContentLength > Int64(cap) {
            throw ActorProfileError.responseTooLarge(Int(http.expectedContentLength))
        }
        var data = Data()
        for try await byte in bytes {
            data.append(byte)
            if data.count > cap { throw ActorProfileError.responseTooLarge(data.count) }
        }
        return (data, http)
    }
}
