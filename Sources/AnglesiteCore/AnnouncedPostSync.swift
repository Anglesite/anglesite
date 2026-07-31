import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Orchestrates #908's "pull a hosted community's own announced-post outbox and snapshot it into
/// the site's git working copy" step: page the Group actor's public `outbox`
/// (`AnnouncedPostSync.OutboxClient`), resolve each member's frozen author snapshot
/// (`ActorProfileFetcher`/`ActorProfileCache`, same as `FollowersModel`'s enrichment), then
/// reconcile + commit (`AnnouncedPostCommitter`). Designed to be called once per site-open
/// (`PreviewModel.open(site:)`), alongside the other three per-site syncs.
///
/// Unlike `ReceivedInteractionSync`/`InboxSubmissionSync`, this needs **no Cloudflare API token**:
/// a member's `Create` is only ever wrapped in an `Announce` and written into the Group's own
/// `outbox` after the Worker has already validated membership (`davidwkeith/workers` PR #401 —
/// "does not announce a non-member's post"), and that `outbox` is the same public,
/// unauthenticated AS2 collection `GET <actor>/outbox` already serves. So this is a plain HTTPS
/// fetch — the same trust/paging shape `GroupTimelineClient` (#368) uses to read a *remote*
/// group's timeline, just pointed at this site's own actor instead.
public enum AnnouncedPostSync {
    /// Fetch transport for the outbox client — public so callers (`PreviewModel`, tests) can
    /// inject a fake without reaching into the internal `OutboxClient` type.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// Production transport — re-exposed at this (public) level since `OutboxClient` itself stays
    /// internal (it's purely this sync's own plumbing, unlike `GroupTimelineClient`, which is a
    /// public type in its own right for Stage 1a's participation UI).
    public static let defaultTransport: Transport = OutboxClient.defaultTransport

    /// One `Announce`d post, before author resolution. Kept separate from `AnnouncedPost` because
    /// mapping the wrapped object's `attributedTo` IRI into a frozen name/photo snapshot requires
    /// an async profile fetch — `OutboxClient.post(from:)` stays a pure, synchronous parse.
    struct RawAnnounce: Sendable, Equatable {
        let id: String
        let objectType: AnnouncedPost.ObjectType
        let sourceURL: URL
        let attributedTo: URL?
        let content: String?
        let published: Date?
        let announcedAt: Date?
    }

    /// Failures from fetching or parsing an outbox collection. `Equatable` so tests can assert
    /// on the exact failure; ``AnnouncedPostSync/pullAndCommit(outboxURL:siteDirectory:configDirectory:transport:now:)``
    /// itself swallows these (returning 0) since a transient network error just means "try again
    /// on the next site-open".
    public enum OutboxError: Error, Equatable, Sendable {
        /// The outbox URL, or the URL a redirect actually landed on, wasn't `https`.
        case insecureURL
        /// A non-2xx response, a transport error (status 0), or an over-cap response body.
        /// `body` carries a truncated excerpt for diagnostics, not for parsing.
        case requestFailed(status: Int, body: String)
        /// The response wasn't the JSON object shape an AS2 collection page must be.
        case decodingFailed(String)
    }

    /// Pages a Group actor's own public outbox. Same unauthenticated, HTTPS-only, capped,
    /// AS2-collection-paging shape as `GroupTimelineClient` (the collection belongs to this
    /// site's own actor here, rather than an arbitrary remote one).
    struct OutboxClient: Sendable {
        /// 1 MB — matches `GroupTimelineClient.maximumResponseBytes`: an outbox page embeds
        /// several full activities at once.
        static let maximumResponseBytes = 1024 * 1024

        let transport: Transport

        init(transport: @escaping Transport = OutboxClient.defaultTransport) {
            self.transport = transport
        }

        func collection(at outboxURL: URL) async throws -> URL? {
            let json = try await fetch(outboxURL)
            return (json["first"] as? String).flatMap(URL.init(string:))
        }

        func page(at url: URL) async throws -> (items: [RawAnnounce], next: URL?) {
            let json = try await fetch(url)
            let rawItems = (json["orderedItems"] as? [Any]) ?? []
            let items = rawItems.compactMap(Self.announce(from:))
            let next = (json["next"] as? String).flatMap(URL.init(string:))
            return (items, next)
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
                throw OutboxError.requestFailed(status: 0, body: "\(error)")
            }
            if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
            guard (200..<300).contains(http.statusCode) else {
                throw OutboxError.requestFailed(
                    status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
            }
            guard data.count <= Self.maximumResponseBytes else {
                throw OutboxError.requestFailed(status: 0, body: "response too large (\(data.count) bytes)")
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw OutboxError.decodingFailed("not a JSON object")
            }
            return json
        }

        static func requireHTTPS(_ url: URL) throws {
            guard url.scheme?.lowercased() == "https" else { throw OutboxError.insecureURL }
        }

        /// Unwraps an `Announce` activity to the member's wrapped post. Only `Announce` items are
        /// mapped — a hosted Group's outbox holds nothing else per #401 (a `Create` from a member
        /// is *replaced* by the Announce, never stored alongside it), so anything else (a bare
        /// activity-id string, a differently-typed activity) is skipped rather than guessed at.
        static func announce(from item: Any) -> RawAnnounce? {
            guard let activity = item as? [String: Any], (activity["type"] as? String) == "Announce" else { return nil }
            guard let object = activity["object"] as? [String: Any], let id = object["id"] as? String else { return nil }
            guard let sourceURL = URL(string: id), let scheme = sourceURL.scheme?.lowercased(),
                  scheme == "http" || scheme == "https"
            else { return nil }

            let objectType = (object["type"] as? String).flatMap { rawType -> AnnouncedPost.ObjectType? in
                AnnouncedPost.ObjectType(rawValue: rawType.lowercased())
            } ?? .note
            let attributedTo = (object["attributedTo"] as? String).flatMap(URL.init(string:))
            let published = (object["published"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
            let announcedAt = (activity["published"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
            return RawAnnounce(
                id: id, objectType: objectType, sourceURL: sourceURL, attributedTo: attributedTo,
                content: (object["content"] as? String), published: published, announcedAt: announcedAt)
        }

        private static let session = CappedHTTPTransport.session(
            requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

        static let defaultTransport: Transport = { request in
            try await CappedHTTPTransport.fetch(
                request, session: session, cap: OutboxClient.maximumResponseBytes,
                tooLarge: { OutboxError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
        }
    }

    /// A member's post `id` doubles as `AnnouncedPost.id` and must satisfy its path-traversal
    /// guard (`[A-Za-z0-9_-]+`) — an AS2 IRI never does, so this derives a stable, safe id from
    /// it the same way other Worker-facing ids in this codebase are namespaced (`wm-`/`ap-`
    /// prefixes elsewhere): a `community-` prefix over a hash of the wrapped object's IRI, so the
    /// same post always maps to the same filename across syncs.
    ///
    /// Hand-rolled FNV-1a rather than `CryptoKit`'s `SHA256`: this is a stable dedup/filename key,
    /// not a security boundary, and `CryptoKit` isn't available on the Linux `AnglesiteCore`
    /// build (`AnglesiteSiteModel`/`AnglesiteCore` are portable SwiftPM targets — see
    /// `CONTRIBUTING.md` ▸ "Linux contributors welcome") — every other `CryptoKit` use in this
    /// file's neighbors (`DPoPKeyPair`, `SessionToken`, …) is gated `#if canImport(CryptoKit)`
    /// with a degraded fallback, which isn't an option here since this id needs to be identical
    /// on every platform.
    static func fileID(for objectIRI: URL) -> String {
        var hash: UInt64 = 0xcbf29ce484222325 // FNV-1a 64-bit offset basis
        for byte in objectIRI.absoluteString.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3 // FNV-1a 64-bit prime
        }
        let hex = String(hash, radix: 16)
        return "community-" + String(repeating: "0", count: 16 - hex.count) + hex
    }

    /// Maps one raw announce to `AnnouncedPost`, resolving its author via `cache` (fresh lookup
    /// first) and falling back to `fetcher` on a cache miss/expiry — mirrors
    /// `FollowersModel`'s enrichment pattern. Returns `nil` only when `raw.published`/
    /// `announcedAt` are both absent (an AS2 peer that omits `published` on both the activity and
    /// its object leaves nothing to snapshot a timestamp from).
    static func makePost(
        from raw: RawAnnounce, cache: inout ActorProfileCache, fetcher: ActorProfileFetcher, now: Date
    ) async -> AnnouncedPost? {
        guard let published = raw.published ?? raw.announcedAt else { return nil }
        let announcedAt = raw.announcedAt ?? published

        var author: AnnouncedPost.Author?
        if let actorURL = raw.attributedTo {
            let profile: ActorProfile?
            if let cached = cache.profile(for: actorURL, now: now) {
                profile = cached
            } else if let fetched = try? await fetcher.profile(for: actorURL, now: now) {
                cache.store(fetched)
                profile = fetched
            } else {
                profile = nil
            }
            author = profile.map { .init(name: $0.name ?? $0.preferredUsername, url: actorURL, photo: $0.iconURL) }
                ?? .init(name: nil, url: actorURL, photo: nil)
        }

        return try? AnnouncedPost(
            id: Self.fileID(for: raw.sourceURL),
            objectType: raw.objectType,
            sourceURL: raw.sourceURL,
            author: author,
            content: raw.content,
            published: published,
            announcedAt: announcedAt)
    }

    /// Pages every post currently in `outboxURL`'s Group actor outbox, resolves authors (loading/
    /// saving the cache in `configDirectory`), and reconciles the result into `siteDirectory`.
    /// Returns 0 (never throws) on a failed first-page fetch, so callers simply re-attempt on the
    /// next site-open rather than surfacing a transient network error.
    public static func pullAndCommit(
        outboxURL: URL,
        siteDirectory: URL,
        configDirectory: URL,
        transport: @escaping Transport = AnnouncedPostSync.defaultTransport,
        now: Date = Date()
    ) async -> Int {
        let client = OutboxClient(transport: transport)
        guard let firstPage = try? await client.collection(at: outboxURL) else { return 0 }

        var raws: [RawAnnounce] = []
        var next: URL? = firstPage
        var pagesFetched = 0
        // A generous, fixed cap rather than trusting a peer-controlled `next` chain to terminate.
        while let pageURL = next, pagesFetched < 50 {
            guard let page = try? await client.page(at: pageURL) else { break }
            raws.append(contentsOf: page.items)
            next = page.next
            pagesFetched += 1
        }

        var cache = ActorProfileCache.load(from: configDirectory) ?? ActorProfileCache()
        // Same injected transport as the outbox client — a test double for `community.example`
        // must also answer `member.example` profile lookups, and production gets the real
        // network either way.
        let fetcher = ActorProfileFetcher(transport: transport)
        var posts: [AnnouncedPost] = []
        for raw in raws {
            if let post = await Self.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now) {
                posts.append(post)
            }
        }
        try? cache.save(to: configDirectory, now: now)

        return await AnnouncedPostCommitter.commit(posts: posts, into: siteDirectory).count
    }

    /// Reads the site's `SiteSettings`; no-ops (returns 0, no network call) unless
    /// `communityOutboxURL` is set — i.e. this isn't a hosted community site (#907 hasn't
    /// provisioned one yet, or this is an ordinary site). `configDirectory` is the package's
    /// `Config/` directory (`AnglesitePackage.configURL`), a sibling of `siteDirectory`
    /// (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        transport: @escaping Transport = AnnouncedPostSync.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let outboxURL = settings.communityOutboxURL
        else { return 0 }
        return await pullAndCommit(
            outboxURL: outboxURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: transport)
    }
}
