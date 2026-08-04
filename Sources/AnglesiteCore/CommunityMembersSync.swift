import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Orchestrates #907's "pull a hosted community's own followers collection and snapshot current
/// membership into the site's git working copy" step: page the Group actor's public `followers`
/// collection (`FollowersCollectionClient`), resolve each member's profile
/// (`ActorProfileFetcher`/`ActorProfileCache`, same as `AnnouncedPostSync`/`FollowersModel`'s
/// enrichment), then reconcile + commit (`CommunityMemberCommitter`). Mirrors `AnnouncedPostSync`
/// (#908) exactly, but reads the actor's `followers` collection instead of its `outbox` — members
/// = followers (design doc §2 D3).
///
/// Like `AnnouncedPostSync`, this needs **no Cloudflare API token**: `GET <actor>/followers` is
/// the same public, unauthenticated AS2 collection every ActivityPub actor serves.
///
/// Wired into `PreviewModel.open(site:)` alongside the other per-site syncs; inert (no network
/// call) until a provisioning flow sets `SiteSettings.communityActorURL`, which is follow-up
/// work to this slice of #907 — see `pullAndCommitIfConfigured`.
public enum CommunityMembersSync {
    /// Fetch transport for the followers client — public so callers (tests) can inject a fake
    /// without reaching into the internal `FollowersCollectionClient` type.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// Production transport — re-exposed at this (public) level since `FollowersCollectionClient`
    /// itself stays internal, mirroring `AnnouncedPostSync.defaultTransport`.
    public static let defaultTransport: Transport = FollowersCollectionClient.defaultTransport

    /// Failures from fetching or parsing a followers collection. `Equatable` so tests can assert
    /// on the exact failure; ``CommunityMembersSync/pullAndCommit(actorURL:siteDirectory:configDirectory:transport:now:)``
    /// itself swallows these (returning 0) since a transient network error just means "try again
    /// on the next site-open".
    public enum FollowersError: Equatable, Error, Sendable {
        /// The followers URL, or the URL a redirect actually landed on, wasn't `https`.
        case insecureURL
        /// A non-2xx response, a transport error (status 0), or an over-cap response body.
        /// `body` carries a truncated excerpt for diagnostics, not for parsing.
        case requestFailed(status: Int, body: String)
        /// The response wasn't the JSON object shape an AS2 collection page must be.
        case decodingFailed(String)
    }

    /// Pages a Group actor's own public `followers` collection. Same unauthenticated, HTTPS-only,
    /// capped, AS2-collection-paging shape as `AnnouncedPostSync.OutboxClient` — a followers
    /// collection's `orderedItems` are bare actor IRI strings rather than embedded activities.
    ///
    /// **Host-pinned pagination.** `first`/`next` are extracted from the *remote* community
    /// server's own JSON response bodies, not constructed by this app — an unauthenticated fetch
    /// of a URL the site owner configures (`communityActorURL`). A malicious or compromised
    /// community server could otherwise steer the pagination chain at arbitrary other https
    /// hosts (bounded only by `pullAndCommit`'s 50-page cap, not by an origin check). `first`/
    /// `next` are treated as absent — not thrown — when they don't match `trustedHost`, so an
    /// off-host link simply ends the chain early rather than failing the whole sync. Member
    /// actor IRIs themselves (`orderedItems`) are deliberately *not* host-pinned: members
    /// legitimately live on any remote host (Mastodon, Lemmy, another Anglesite site, …) — only
    /// the pagination links that decide what this fetch trusts as "part of the collection" are.
    struct FollowersCollectionClient: Sendable {
        /// 1 MB — matches `AnnouncedPostSync.OutboxClient.maximumResponseBytes`.
        static let maximumResponseBytes = 1024 * 1024

        let transport: Transport
        /// Lowercased host of the actor whose followers collection this client was constructed
        /// for — every `first`/`next` link is required to stay on this host (see the type doc).
        let trustedHost: String

        init(actorURL: URL, transport: @escaping Transport = FollowersCollectionClient.defaultTransport) {
            self.transport = transport
            self.trustedHost = (actorURL.host ?? "").lowercased()
        }

        /// A pagination link (`first`/`next`) is used only when it parses as a URL *and* its host
        /// matches `trustedHost` — anything else (a different host, an unparseable string) is
        /// treated the same as "no more pages" rather than followed.
        private func trustedPaginationLink(_ value: Any?) -> URL? {
            guard let string = value as? String, let url = URL(string: string),
                  url.host?.lowercased() == trustedHost
            else { return nil }
            return url
        }

        func collection(at followersURL: URL) async throws -> URL? {
            let json = try await fetch(followersURL)
            return trustedPaginationLink(json["first"])
        }

        func page(at url: URL) async throws -> (actorURLs: [URL], next: URL?) {
            let json = try await fetch(url)
            let rawItems = (json["orderedItems"] as? [Any]) ?? []
            let actorURLs = rawItems.compactMap(Self.actorURL(from:))
            let next = trustedPaginationLink(json["next"])
            return (actorURLs, next)
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
                throw FollowersError.requestFailed(status: 0, body: "\(error)")
            }
            if let finalURL = http.url { try Self.requireHTTPS(finalURL) }
            guard (200..<300).contains(http.statusCode) else {
                throw FollowersError.requestFailed(
                    status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
            }
            guard data.count <= Self.maximumResponseBytes else {
                throw FollowersError.requestFailed(status: 0, body: "response too large (\(data.count) bytes)")
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw FollowersError.decodingFailed("not a JSON object")
            }
            return json
        }

        static func requireHTTPS(_ url: URL) throws {
            guard url.scheme?.lowercased() == "https" else { throw FollowersError.insecureURL }
        }

        /// A followers collection's items are bare actor IRI strings (unlike the outbox's
        /// embedded activity objects) — some AS2 implementations instead embed a minimal
        /// `{"id": "…"}` object, so both shapes are accepted.
        static func actorURL(from item: Any) -> URL? {
            let idString: String?
            if let string = item as? String {
                idString = string
            } else if let object = item as? [String: Any] {
                idString = object["id"] as? String
            } else {
                idString = nil
            }
            guard let idString, let url = URL(string: idString),
                  let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https"
            else { return nil }
            return url
        }

        private static let session = CappedHTTPTransport.session(
            requestTimeout: ActorProfileFetcher.timeout, resourceTimeout: ActorProfileFetcher.resourceTimeout)

        static let defaultTransport: Transport = { request in
            try await CappedHTTPTransport.fetch(
                request, session: session, cap: FollowersCollectionClient.maximumResponseBytes,
                tooLarge: { FollowersError.requestFailed(status: 0, body: "response too large (\($0) bytes)") })
        }
    }

    /// A member's actor IRI never satisfies `CommunityMember`'s path-traversal guard
    /// (`[A-Za-z0-9_-]+`), so this derives a stable, safe id from it — same FNV-1a scheme as
    /// `AnnouncedPostSync.fileID(for:)`, with a `member-` prefix instead of `community-` so the
    /// two id spaces never collide if ever written into the same directory tree.
    static func fileID(for actorURL: URL) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325 // FNV-1a 64-bit offset basis
        for byte in actorURL.absoluteString.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0001_0000_01b3 // FNV-1a 64-bit prime
        }
        let hex = String(hash, radix: 16)
        return "member-" + String(repeating: "0", count: 16 - hex.count) + hex
    }

    /// Maps one raw actor IRI to `CommunityMember`, resolving its profile via `cache` (fresh
    /// lookup first) and falling back to `fetcher` on a cache miss/expiry — mirrors
    /// `AnnouncedPostSync.makePost`'s enrichment exactly. Never fails to produce a member: an
    /// unresolved profile just means `name`/`photo` stay `nil`.
    static func makeMember(
        for actorURL: URL, cache: inout ActorProfileCache, fetcher: ActorProfileFetcher, now: Date
    ) async -> CommunityMember? {
        let profile: ActorProfile?
        if let cached = cache.profile(for: actorURL, now: now) {
            profile = cached
        } else if let fetched = try? await fetcher.profile(for: actorURL, now: now) {
            cache.store(fetched)
            profile = fetched
        } else {
            profile = nil
        }
        return try? CommunityMember(
            id: Self.fileID(for: actorURL),
            actorURL: actorURL,
            name: profile?.name ?? profile?.preferredUsername,
            photo: profile?.iconURL)
    }

    /// Pages every member currently in `actorURL`'s Group actor followers collection, resolves
    /// profiles (loading/saving the cache in `configDirectory`), and reconciles the result into
    /// `siteDirectory`. Returns 0 (never throws) on a failed first-page fetch, so callers simply
    /// re-attempt on the next site-open rather than surfacing a transient network error.
    public static func pullAndCommit(
        actorURL: URL,
        siteDirectory: URL,
        configDirectory: URL,
        transport: @escaping Transport = CommunityMembersSync.defaultTransport,
        now: Date = Date()
    ) async -> Int {
        let followersURL = actorURL.appendingPathComponent("followers")
        let client = FollowersCollectionClient(actorURL: actorURL, transport: transport)
        guard let firstPage = try? await client.collection(at: followersURL) else { return 0 }

        var actorURLs: [URL] = []
        var next: URL? = firstPage
        var pagesFetched = 0
        // A generous, fixed cap rather than trusting a peer-controlled `next` chain to terminate.
        while let pageURL = next, pagesFetched < 50 {
            guard let page = try? await client.page(at: pageURL) else { break }
            actorURLs.append(contentsOf: page.actorURLs)
            next = page.next
            pagesFetched += 1
        }

        var cache = ActorProfileCache.load(from: configDirectory) ?? ActorProfileCache()
        // Same injected transport as the followers client — a test double for `community.example`
        // must also answer member profile lookups, and production gets the real network either way.
        let fetcher = ActorProfileFetcher(transport: transport)
        var members: [CommunityMember] = []
        for url in actorURLs {
            if let member = await Self.makeMember(for: url, cache: &cache, fetcher: fetcher, now: now) {
                members.append(member)
            }
        }
        try? cache.save(to: configDirectory, now: now)

        return await CommunityMemberCommitter.commit(members: members, into: siteDirectory).count
    }

    /// Reads the site's `SiteSettings`; no-ops (returns 0, no network call) unless
    /// `communityActorURL` is set — i.e. this isn't a hosted community site (#907's provisioning
    /// flow hasn't run yet, or this is an ordinary site). `configDirectory` is the package's
    /// `Config/` directory (`AnglesitePackage.configURL`), a sibling of `siteDirectory`
    /// (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        transport: @escaping Transport = CommunityMembersSync.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let actorURL = settings.communityActorURL
        else { return 0 }
        return await pullAndCommit(
            actorURL: actorURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: transport)
    }
}
