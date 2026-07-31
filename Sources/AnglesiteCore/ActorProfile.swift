import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A follower's display identity, fetched from their home instance's actor document.
///
/// Only the icon's *URL* is kept, never image bytes: `AvatarLoader` fetches the image per visible
/// row, which keeps the persisted cache small and stops the app becoming an image store.
public struct ActorProfile: Codable, Equatable, Sendable {
    /// The actor's IRI — the profile's identity, and (in string form) the key
    /// ``ActorProfileCache`` stores it under.
    public let actor: URL
    /// The instance-supplied username, already routed through ``DisplayString/safe(_:)``: both
    /// name fields are freely attacker-controlled and can carry bidi-control scalars that make a
    /// rendered name impersonate a trusted one.
    public let preferredUsername: String?
    /// The instance-supplied display name, sanitized the same way as ``preferredUsername``.
    public let name: String?
    /// The avatar's URL — never its bytes (see the type-level note), and only when served over
    /// HTTPS; a plaintext avatar is dropped rather than failing the whole profile.
    public let iconURL: URL?
    /// When the profile was fetched, driving ``ActorProfileCache``'s time-to-live expiry.
    public let fetchedAt: Date

    /// Memberwise initializer — public because the synthesized one would be internal, and tests
    /// plus cache fixtures need to build profiles without going through a fetch.
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

/// Why a profile fetch was rejected. Every case is non-fatal to callers — the follower row
/// simply falls back to its derived handle — but the cases stay distinct so tests can pin
/// *which* defense fired.
public enum ActorProfileError: Error, Equatable, Sendable {
    /// The actor IRI, or the URL a redirect actually landed on, wasn't `https`.
    case insecureURL
    /// The body exceeded ``ActorProfileFetcher/maximumResponseBytes``. Carries the byte count
    /// observed when the transfer was cut off.
    case responseTooLarge(Int)
    /// The server answered outside 2xx. Carries the HTTP status.
    case requestFailed(status: Int)
    /// The body wasn't a decodable actor document. Carries the underlying error's description
    /// as a `String` because `Error` itself isn't `Equatable`.
    case decodingFailed(String)
}

/// Fetches one follower's actor document.
///
/// Everything this touches is attacker-supplied: any Fediverse user can follow the site and
/// thereby put an IRI and a display string in front of this code. Hence HTTPS-only (re-checked
/// after redirects), a hard byte cap enforced *during* transfer, and a short timeout. Callers
/// treat every failure as non-fatal — the row falls back to its derived handle.
public struct ActorProfileFetcher: Sendable {
    /// Injection seam for the HTTP layer, so tests exercise the defenses without a network.
    /// Returns the `HTTPURLResponse` (not just data) because ``profile(for:now:)`` must re-check
    /// the URL a redirect actually landed on.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// 256 KB. An actor document is a few KB; anything approaching this is pathological.
    public static let maximumResponseBytes = 256 * 1024
    /// Idle timeout: the longest the transfer may go without progress.
    public static let timeout: TimeInterval = 10
    /// Wall-clock deadline for the *whole* transfer, however slowly it progresses. Without this
    /// only the idle timeout applies, and a server that dribbles one byte every nine seconds
    /// keeps its fetch alive indefinitely — cheap for the attacker, and expensive here because
    /// `FollowersModel` gates enrichment on a small shared pool, so a few such followers stall
    /// every other row for the life of the window. See `CappedHTTPTransport`.
    public static let resourceTimeout: TimeInterval = 20

    private let transport: Transport

    /// Creates a fetcher. The default transport is the capped, streaming production one — inject
    /// a ``Transport`` only to fake the network in tests.
    public init(transport: @escaping Transport = ActorProfileFetcher.defaultTransport) {
        self.transport = transport
    }

    /// Fetches and decodes the actor document at `actor`, applying every defense described on
    /// the type. `now` is injectable so tests can pin the resulting `fetchedAt`.
    ///
    /// - Throws: ``ActorProfileError`` — callers treat any case as "no enrichment for this row",
    ///   never as fatal.
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

    /// Its own session rather than `URLSession.shared`: `timeoutIntervalForResource` — the only
    /// bound a slow-drip server can't sidestep — is settable on a configuration and nowhere else.
    static let session = CappedHTTPTransport.session(
        requestTimeout: timeout, resourceTimeout: resourceTimeout)

    /// Production transport. Streams the body so the size cap is enforced *during* transfer.
    public static let defaultTransport: Transport = { request in
        try await CappedHTTPTransport.fetch(
            request,
            session: ActorProfileFetcher.session,
            cap: ActorProfileFetcher.maximumResponseBytes,
            tooLarge: ActorProfileError.responseTooLarge)
    }
}
