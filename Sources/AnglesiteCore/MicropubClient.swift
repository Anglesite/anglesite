import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The stable Micropub Post Status extension's two values (`@dwk/micropub`'s
/// `POST_STATUS_VALUES`). A post with no `post-status` property is `published` — the server
/// treats absence as published, so ``MicropubPost/status`` mirrors that default rather than
/// returning an optional the caller would have to re-default everywhere.
public enum MicropubPostStatus: String, Sendable, Equatable, CaseIterable {
    /// Stored but never rendered publicly; flipping to ``published`` is what "Publish" means
    /// in the CMS model (2026-07-17 spec §C.4-C.6).
    case draft
    /// Live: rendered into the site on the next Worker-triggered bake.
    case published
}

/// An mf2 post as the Micropub endpoint reads or writes it: the JSON
/// `{ "type": [...], "properties": {...} }` shape shared by create bodies, `q=source` single-post
/// responses, and `q=source` list items. Property values stay ``JSONValue`` (not typed fields)
/// because mf2 property maps are open-ended — the content-type registry's projection to/from
/// typed fields is its callers' concern, not this transport type's.
public struct MicropubPost: Sendable, Equatable {
    /// The mf2 root type list, e.g. `["h-entry"]`.
    public var type: [String]
    /// The mf2 property map — each property name maps to its ordered value list, matching
    /// `@dwk/micropub`'s `Record<string, unknown[]>` shape. On a create body this may also carry
    /// `mp-*` commands (``MicropubClient/deriveSlug(title:explicitSlug:)`` → `mp-slug`); the
    /// server strips those before storing, so they never round-trip back out of `q=source`.
    public var properties: [String: [JSONValue]]

    /// Memberwise creation, defaulting to `h-entry` — the root type of every post-family
    /// content type in the registry.
    public init(type: [String] = ["h-entry"], properties: [String: [JSONValue]]) {
        self.type = type
        self.properties = properties
    }

    /// The first string value of `name`, or `nil` — mf2 property access is list-valued and
    /// heterogeneous, so this helper covers the overwhelmingly common "single string" read.
    public func firstString(_ property: String) -> String? {
        guard case .string(let value)? = properties[property]?.first else { return nil }
        return value
    }

    /// The post's canonical URL when present. A `q=source` **list** item always carries one
    /// (the server injects `url` into each item's properties); a create body has none yet.
    public var url: URL? {
        firstString("url").flatMap(URL.init(string:))
    }

    /// The post's status, defaulting to ``MicropubPostStatus/published`` when the property is
    /// absent — the same default the server applies (see ``MicropubPostStatus``). An
    /// unrecognized value also reads as published: the server validates the enum on write, so
    /// that only happens for data this client didn't write.
    public var status: MicropubPostStatus {
        firstString("post-status").flatMap(MicropubPostStatus.init(rawValue:)) ?? .published
    }

    /// Builds an `h-entry` create body from the composer's primitive parts, deriving `mp-slug`
    /// via ``MicropubClient/deriveSlug(title:explicitSlug:)`` (so a Micropub-created post lands
    /// at the same slug `NativeContentOperations.createPost` would have chosen for the same
    /// title) and stamping `post-status`. When no slug is derivable — an untitled note with no
    /// explicit slug — `mp-slug` is omitted and the server generates its own collision-resistant
    /// slug, matching the file path's behavior of never inventing one from nothing.
    ///
    /// - Parameters:
    ///   - title: The post title (mf2 `name`); omit for title-less notes.
    ///   - content: The Markdown body (mf2 `content`).
    ///   - status: Stamped as `post-status`. Defaults to draft — drafts-by-default is the
    ///     parent spec's publish model (Part B), publish is an explicit later flip.
    ///   - slug: Explicit slug request, taking precedence over the title-derived one — the same
    ///     `slug ?? title` precedence `NativeContentOperations.createPost` applies.
    ///   - extraProperties: Additional mf2 properties (categories, photo URLs, …) merged in
    ///     verbatim. Keys here win over the generated ones, so a caller with pre-built
    ///     `name`/`content` values isn't silently overridden.
    /// - Returns: A create body ready for ``MicropubClient/create(_:)``.
    public static func entry(
        title: String? = nil,
        content: String,
        status: MicropubPostStatus = .draft,
        slug: String? = nil,
        extraProperties: [String: [JSONValue]] = [:]
    ) -> MicropubPost {
        var properties: [String: [JSONValue]] = [
            "content": [.string(content)],
            "post-status": [.string(status.rawValue)],
        ]
        let cleanTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cleanTitle, !cleanTitle.isEmpty {
            properties["name"] = [.string(cleanTitle)]
        }
        if let derived = MicropubClient.deriveSlug(title: title, explicitSlug: slug) {
            properties["mp-slug"] = [.string(derived)]
        }
        for (key, values) in extraProperties {
            properties[key] = values
        }
        return MicropubPost(properties: properties)
    }
}

/// The subset of a `q=config` response this client's callers need: where media uploads go and
/// which queries the server serves. Fetched via ``MicropubClient/configuration()`` — standard
/// Micropub client discovery, so the media endpoint is never hardcoded to the `/media` layout
/// the current template Worker happens to deploy.
public struct MicropubConfiguration: Sendable, Equatable {
    /// The media endpoint uploads go to, when the server has one.
    public let mediaEndpoint: URL?
    /// The `q` query values the server advertises (e.g. `["source", "config", "syndicate-to"]`).
    public let supportedQueries: [String]

    /// Memberwise creation — public chiefly so tests can build fixtures.
    public init(mediaEndpoint: URL?, supportedQueries: [String]) {
        self.mediaEndpoint = mediaEndpoint
        self.supportedQueries = supportedQueries
    }
}

/// The `delete` half of a Micropub update operation, which is the one update verb with two wire
/// shapes: a string array removes whole properties, an object removes specific values from a
/// property's list.
public enum MicropubUpdateDelete: Sendable, Equatable {
    /// Remove each named property entirely.
    case properties([String])
    /// Remove only the given values from each named property, leaving other values in place.
    case values([String: [JSONValue]])
}

/// Failures surfaced by ``MicropubClient`` calls, categorized by what the caller should do next
/// (#867): ``requiresReauthorization`` routes to the IndieAuth re-auth flow, ``isRetryable``
/// routes to the caller's offline queue, and everything else is a terminal failure to surface.
public enum MicropubError: Error, Equatable, Sendable {
    /// The endpoint rejected the credential (401/403) → the caller should route to IndieAuth
    /// re-auth. The actual re-auth UI is the onboarding issue's concern, not this client's.
    case unauthorized
    /// The endpoint answered 5xx → transient server trouble; safe to queue and retry.
    case serverError(status: Int, body: String)
    /// The request never got an HTTP response (offline, DNS, TLS, …) → safe to queue and retry.
    case unreachable(String)
    /// Any other non-2xx (a 4xx that isn't an auth failure) — the request itself is wrong, so
    /// retrying the same payload can't succeed and it must not enter the offline queue.
    case requestFailed(status: Int, body: String)
    /// The response wasn't the shape the action expects; the payload carries a description
    /// (stringly, so the enum stays `Equatable`).
    case decodingFailed(String)
    /// ``MicropubClient/uploadMedia(_:filename:mimeType:)`` was called on a client constructed
    /// without a media endpoint — discover one via ``MicropubClient/configuration()`` first.
    case mediaEndpointNotConfigured
    /// Signing the DPoP proof needs CryptoKit (Apple platforms only).
    case dpopUnavailable

    /// True for the auth failures whose remedy is a fresh IndieAuth sign-in (#867's re-auth
    /// signal) — not for other 4xx, where a new token wouldn't change the outcome.
    public var requiresReauthorization: Bool {
        self == .unauthorized
    }

    /// True for failures a caller's offline queue should hold and retry (#867's
    /// retryable-failure signal): the server erred or never answered, and the same payload can
    /// succeed later without modification.
    public var isRetryable: Bool {
        switch self {
        case .serverError, .unreachable: return true
        case .unauthorized, .requestFailed, .decodingFailed, .mediaEndpointNotConfigured, .dpopUnavailable:
            return false
        }
    }
}

/// A client for one site's deployed `@dwk/micropub` endpoint — the single write path the Mac's
/// CMS-mode save and the iOS posting client share, so Mac and phone edits can't diverge (#867;
/// 2026-07-17 spec §C.2/C.6, 2026-07-21 iOS design §6). Create/update/delete, draft⇄publish via
/// `post-status`, single-post reads via `q=source`, browsing via the `q=source`-with-no-`url`
/// list extension (shipped in `@dwk/micropub@1.0.0-beta.1`, davidwkeith/workers#351 — the
/// version `workers-version.json` pins), and media uploads to the discovered media endpoint.
///
/// Every call is a DPoP-bound, bearer-authorized request (RFC 9449) built fresh per call from
/// the injected `dpopKeyPair`/`accessToken`, mirroring ``MicrosubClient``'s injectable-
/// `Transport` shape so this stays unit-testable without real networking. `SiteIndieAuthClient`
/// is how the caller obtains the token + key pair in the first place; this type only *presents*
/// them — on rejection it reports ``MicropubError/unauthorized`` and leaves re-auth to the
/// caller. The offline queue that holds retryable failures is likewise the caller's (the
/// composer issue's concern); this client only classifies (``MicropubError/isRetryable``).
public struct MicropubClient: Sendable {
    /// The injectable network seam: tests substitute a closure that captures the fully-built
    /// request (headers, DPoP proof and all) and returns a canned response, so request
    /// construction is exercised without real networking.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// The site's Micropub endpoint (absolute URL, no query).
    private let endpoint: URL
    /// Where ``uploadMedia(_:filename:mimeType:)`` posts, when the caller has discovered one
    /// (via ``configuration()`` or prior knowledge). Optional because the write/read calls
    /// don't need it.
    private let mediaEndpoint: URL?
    private let accessToken: String
    private let dpopKeyPair: DPoPKeyPair
    private let transport: Transport

    /// Creates a client for the site's `endpoint`, presenting `accessToken` DPoP-bound to
    /// `dpopKeyPair` on every call. The token and key pair must come from the same
    /// `SiteIndieAuthClient` grant — the server verifies the proof's key thumbprint against the
    /// token's binding, so mixing grants fails auth even though both values look valid alone.
    ///
    /// - Parameters:
    ///   - endpoint: The site's Micropub endpoint (absolute URL, no query).
    ///   - mediaEndpoint: The media endpoint uploads go to; omit when the caller hasn't
    ///     discovered it yet (``configuration()``) or doesn't upload media.
    ///   - accessToken: The IndieAuth access token to present.
    ///   - dpopKeyPair: The key pair the token is bound to; signs every request's proof.
    ///   - transport: Defaults to ``defaultTransport`` (plain `URLSession`); inject a fake to
    ///     unit-test the flow.
    public init(
        endpoint: URL,
        mediaEndpoint: URL? = nil,
        accessToken: String,
        dpopKeyPair: DPoPKeyPair,
        transport: @escaping Transport = MicropubClient.defaultTransport
    ) {
        self.endpoint = endpoint
        self.mediaEndpoint = mediaEndpoint
        self.accessToken = accessToken
        self.dpopKeyPair = dpopKeyPair
        self.transport = transport
    }

    /// Derives the `mp-slug` for a new post the same way `NativeContentOperations.createPost`
    /// derives file slugs — explicit slug wins over title, both through
    /// `ContentScaffold.slugify` — so a post created over Micropub lands at the same slug the
    /// file-based path would have chosen for the same inputs (#867's parity requirement).
    ///
    /// - Parameters:
    ///   - title: The post title; used when no explicit slug is given.
    ///   - explicitSlug: A caller-requested slug, taking precedence over the title.
    /// - Returns: The slug to send as `mp-slug`, or `nil` when neither input yields one (e.g.
    ///   an untitled note) — omit the command and let the server generate its own, rather than
    ///   inventing a slug the file path would never produce.
    public static func deriveSlug(title: String?, explicitSlug: String? = nil) -> String? {
        let cleanTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let source = explicitSlug.flatMap({ $0.isEmpty ? nil : $0 })
            ?? cleanTitle.flatMap({ $0.isEmpty ? nil : $0 })
        else { return nil }
        let slug = ContentScaffold.slugify(source)
        return slug.isEmpty ? nil : slug
    }

    // MARK: - Write path

    /// Creates a post and returns its canonical URL (the `201 Created` response's `Location`).
    ///
    /// - Parameter post: The mf2 create body — see ``MicropubPost/entry(title:content:status:slug:extraProperties:)``
    ///   for the common composer shape.
    /// - Returns: The created post's canonical URL.
    /// - Throws: ``MicropubError`` — ``MicropubError/decodingFailed(_:)`` when a 2xx response
    ///   carries no `Location` header, since a create whose URL is unknown can't be edited,
    ///   published, or listed afterward.
    public func create(_ post: MicropubPost) async throws -> URL {
        let body: [String: Any] = [
            "type": post.type,
            "properties": post.properties.mapValues { $0.map(\.rawValue) },
        ]
        let (data, http) = try await postJSON(body)
        try Self.checkStatus(data, http)
        guard let location = Self.location(of: http, relativeTo: endpoint) else {
            throw MicropubError.decodingFailed("create response had no Location header")
        }
        return location
    }

    /// Updates the post at `url` with Micropub's three update verbs. At least one of
    /// `replace`/`add`/`delete` should be non-empty — an all-empty update is a no-op round-trip.
    ///
    /// - Parameters:
    ///   - url: The post's canonical URL (from ``create(_:)`` or a `q=source` read).
    ///   - replace: Properties to overwrite wholesale.
    ///   - add: Values to append to existing properties.
    ///   - delete: Whole properties or specific values to remove.
    /// - Returns: The post's new canonical URL when the server moved it (a `201` response's
    ///   `Location`); `nil` for the ordinary in-place `204`.
    @discardableResult
    public func update(
        url: URL,
        replace: [String: [JSONValue]] = [:],
        add: [String: [JSONValue]] = [:],
        delete: MicropubUpdateDelete? = nil
    ) async throws -> URL? {
        var body: [String: Any] = ["action": "update", "url": url.absoluteString]
        if !replace.isEmpty { body["replace"] = replace.mapValues { $0.map(\.rawValue) } }
        if !add.isEmpty { body["add"] = add.mapValues { $0.map(\.rawValue) } }
        switch delete {
        case .properties(let names): body["delete"] = names
        case .values(let values): body["delete"] = values.mapValues { $0.map(\.rawValue) }
        case nil: break
        }
        let (data, http) = try await postJSON(body)
        try Self.checkStatus(data, http)
        guard http.statusCode == 201 else { return nil }
        return Self.location(of: http, relativeTo: endpoint)
    }

    /// Flips the post's `post-status` — the draft⇄publish verb of the CMS model, as an update
    /// that replaces only that one property. Publishing is what triggers the Worker-side bake;
    /// showing "published — site rebuilding" until the bake lands is the caller's concern.
    ///
    /// - Parameters:
    ///   - url: The post's canonical URL.
    ///   - status: The new status.
    public func setStatus(url: URL, _ status: MicropubPostStatus) async throws {
        try await update(url: url, replace: ["post-status": [.string(status.rawValue)]])
    }

    /// Deletes the post at `url` (a soft delete server-side — `q=source` list reads stop
    /// returning it, and the D1 row is retained for the sync bridge's reconcile).
    ///
    /// - Parameter url: The post's canonical URL.
    public func delete(url: URL) async throws {
        let (data, http) = try await postJSON(["action": "delete", "url": url.absoluteString])
        try Self.checkStatus(data, http)
    }

    // MARK: - Read path

    /// Fetches the server's `q=config` document — standard Micropub client discovery, chiefly
    /// for the media endpoint an upload-capable client should be constructed with.
    ///
    /// - Returns: The decoded ``MicropubConfiguration``.
    public func configuration() async throws -> MicropubConfiguration {
        let object = try await getJSON(query: [URLQueryItem(name: "q", value: "config")])
        // Resolved against the micropub endpoint, same as `Location` handling: nothing in the
        // spec requires `media-endpoint` to be absolute, and an unresolved relative URL would
        // surface much later as an opaque network failure in `uploadMedia`.
        let mediaEndpoint = (object["media-endpoint"] as? String)
            .flatMap { URL(string: $0, relativeTo: endpoint)?.absoluteURL }
        let queries = (object["q"] as? [Any])?.compactMap { $0 as? String } ?? []
        return MicropubConfiguration(mediaEndpoint: mediaEndpoint, supportedQueries: queries)
    }

    /// Reads one post's stored mf2 source (`q=source&url=`) — the edit flow's first step:
    /// fetch, edit, then ``update(url:replace:add:delete:)``. Also the compare-and-swap
    /// re-fetch on a concurrent-edit conflict (parent spec §6).
    ///
    /// - Parameter url: The post's canonical URL.
    /// - Returns: The stored post. A URL nothing lives at surfaces as
    ///   ``MicropubError/requestFailed(status:body:)`` with status 404.
    public func source(url: URL) async throws -> MicropubPost {
        let object = try await getJSON(query: [
            URLQueryItem(name: "q", value: "source"),
            URLQueryItem(name: "url", value: url.absoluteString),
        ])
        guard let post = Self.decodePost(object) else {
            throw MicropubError.decodingFailed("q=source response is not an mf2 post object")
        }
        return post
    }

    /// Lists recent posts — published and draft alike, since this queries D1 through the
    /// authenticated endpoint, not the built site — via the `q=source`-with-no-`url` list
    /// extension (the iOS design's browse mechanism, §6). Newest first; page with
    /// `limit`/`offset`. Each returned post carries its canonical URL
    /// (``MicropubPost/url``) — the server injects `url` into every list item's properties.
    ///
    /// - Parameters:
    ///   - limit: Page size; the server bounds it and applies its own default when omitted.
    ///   - offset: Items to skip, for paging.
    /// - Returns: The page's posts, in the server's newest-first order.
    public func listPosts(limit: Int? = nil, offset: Int? = nil) async throws -> [MicropubPost] {
        var query = [URLQueryItem(name: "q", value: "source")]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { query.append(URLQueryItem(name: "offset", value: String(offset))) }
        let object = try await getJSON(query: query)
        guard let items = object["items"] as? [Any] else {
            throw MicropubError.decodingFailed("q=source list response has no items array")
        }
        // A malformed item fails the whole page rather than being skipped: unlike
        // MicropubPostD1Client's bulk sync (where one bad row shouldn't block every other
        // post), a browse list silently missing a post would read as "that post is gone".
        return try items.map { item in
            guard let object = item as? [String: Any], let post = Self.decodePost(object) else {
                throw MicropubError.decodingFailed("q=source list item is not an mf2 post object")
            }
            return post
        }
    }

    // MARK: - Media

    /// Uploads one media file to the media endpoint and returns its URL (the response's
    /// `Location`) for referencing from a subsequent post body (e.g. a `photo` property). The
    /// pre-upload size/format guard the iOS design calls for (§7) belongs to the caller — this
    /// client transports whatever it's handed.
    ///
    /// - Parameters:
    ///   - data: The file bytes.
    ///   - filename: The upload's filename, carried in the multipart `file` part.
    ///   - mimeType: The file's MIME type (e.g. `image/jpeg`).
    /// - Returns: The stored media's URL.
    /// - Throws: ``MicropubError/mediaEndpointNotConfigured`` when the client was constructed
    ///   without a media endpoint — discover one via ``configuration()`` first.
    public func uploadMedia(_ data: Data, filename: String, mimeType: String) async throws -> URL {
        guard let mediaEndpoint else { throw MicropubError.mediaEndpointNotConfigured }
        let boundary = "anglesite-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        // Quotes/CRLF are stripped rather than escaped: multipart quoted-string escaping is
        // inconsistently implemented server-side, and no legitimate filename needs them.
        let safeName = filename.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: mediaEndpoint)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (responseData, http) = try await sendAuthorized(request, method: "POST", htu: mediaEndpoint)
        try Self.checkStatus(responseData, http)
        guard let location = Self.location(of: http, relativeTo: mediaEndpoint) else {
            throw MicropubError.decodingFailed("media upload response had no Location header")
        }
        return location
    }

    // MARK: - Request plumbing

    private func postJSON(_ body: [String: Any]) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            throw MicropubError.decodingFailed("couldn't encode request body: \(error)")
        }
        return try await sendAuthorized(request, method: "POST", htu: endpoint)
    }

    private func getJSON(query: [URLQueryItem]) async throws -> [String: Any] {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw MicropubError.decodingFailed("malformed endpoint URL")
        }
        components.queryItems = query
        guard let url = components.url else {
            throw MicropubError.decodingFailed("couldn't build request URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, http) = try await sendAuthorized(request, method: "GET", htu: endpoint)
        try Self.checkStatus(data, http)
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw MicropubError.decodingFailed("response is not a JSON object")
        }
        return object
    }

    /// Signs and sends `request` and — on an RFC 9449 §8 `use_dpop_nonce` challenge — retries
    /// exactly once with a fresh proof echoing the nonce. Every call funnels through here, so
    /// the retry applies uniformly; a challenge that repeats falls through to the ordinary
    /// status mapping (a persistent 401 is ``MicropubError/unauthorized``). `htu` is the bare
    /// endpoint URL, query included in the request but not the proof — matching the server's
    /// `expectedHtu`, whose `normalizeHtu` strips query strings regardless (same reasoning as
    /// ``MicrosubClient``).
    private func sendAuthorized(_ request: URLRequest, method: String, htu: URL) async throws -> (Data, HTTPURLResponse) {
        var (data, http) = try await authorizedSend(request, method: method, htu: htu, nonce: nil)
        if let nonce = DPoPNonceChallenge.nonce(in: data, response: http) {
            (data, http) = try await authorizedSend(request, method: method, htu: htu, nonce: nonce)
        }
        return (data, http)
    }

    private func authorizedSend(_ request: URLRequest, method: String, htu: URL, nonce: String?) async throws -> (Data, HTTPURLResponse) {
        var signedRequest = request
        signedRequest.setValue("DPoP \(accessToken)", forHTTPHeaderField: "Authorization")
        do {
            let proof = try dpopKeyPair.proof(htm: method, htu: htu.absoluteString, accessToken: accessToken, nonce: nonce)
            signedRequest.setValue(proof, forHTTPHeaderField: "DPoP")
        } catch is DPoPError {
            throw MicropubError.dpopUnavailable
        }
        do {
            return try await transport(signedRequest)
        } catch let error as MicropubError {
            throw error
        } catch {
            throw MicropubError.unreachable(error.localizedDescription)
        }
    }

    /// Maps a response status onto ``MicropubError``'s caller-action categories (#867):
    /// 401/403 → re-auth, 5xx → retryable, other non-2xx → terminal request failure.
    private static func checkStatus(_ data: Data, _ http: HTTPURLResponse) throws {
        switch http.statusCode {
        case 200..<300: return
        case 401, 403: throw MicropubError.unauthorized
        case 500...: throw MicropubError.serverError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        default: throw MicropubError.requestFailed(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
    }

    /// The response's `Location`, resolved against `base` — the Worker sends absolute URLs, but
    /// relative resolution costs nothing and keeps a spec-conforming relative `Location` working.
    private static func location(of http: HTTPURLResponse, relativeTo base: URL) -> URL? {
        guard let raw = http.value(forHTTPHeaderField: "Location"), !raw.isEmpty else { return nil }
        return URL(string: raw, relativeTo: base)?.absoluteURL
    }

    /// Decodes a `{ type, properties }` JSON object into a ``MicropubPost``. `nil` when the
    /// shape is wrong; property values that ``JSONValue/from(_:)`` can't represent are dropped
    /// individually (same tolerance as `MicropubPostD1Client`'s row parsing).
    private static func decodePost(_ object: [String: Any]) -> MicropubPost? {
        guard let rawType = object["type"] as? [Any],
              let rawProperties = object["properties"] as? [String: [Any]]
        else { return nil }
        let type = rawType.compactMap { $0 as? String }
        guard !type.isEmpty else { return nil }
        var properties: [String: [JSONValue]] = [:]
        for (key, values) in rawProperties {
            properties[key] = values.compactMap(JSONValue.from)
        }
        return MicropubPost(type: type, properties: properties)
    }

    /// Production transport: a plain `URLSession` request, no auth of its own (signing is
    /// `sendAuthorized`'s job).
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
