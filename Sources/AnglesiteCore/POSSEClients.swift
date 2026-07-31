import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Injectable HTTP seam for the POSSE clients: a closure instead of `URLSession` directly, so
/// tests can stub platform responses without any network. Returns `HTTPURLResponse` (not
/// `URLResponse`) so callers never re-downcast; `POSSESyndicationCommand.defaultTransport` is
/// the production implementation.
public typealias POSSEHTTPTransport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

/// Failures from the direct-post POSSE clients. Each case carries the platform name so the
/// syndication log line can say *which* social account failed — one pass posts to several.
public enum POSSEClientError: Error, Equatable, LocalizedError, Sendable {
    /// The configured base/PDS URL couldn't produce a valid API endpoint.
    case invalidEndpoint
    /// The platform returned a non-2xx status for the post.
    case rejected(platform: String, status: Int)
    /// The platform answered 2xx but the body didn't decode to the expected shape.
    case invalidResponse(platform: String)

    /// Owner-readable message; surfaced in the debug pane via the syndication error log.
    public var errorDescription: String? {
        switch self {
        case .invalidEndpoint: "The social account endpoint is invalid."
        case .rejected(let platform, let status): "\(platform) rejected the post (HTTP \(status))."
        case .invalidResponse(let platform): "\(platform) returned an invalid response."
        }
    }
}

/// Posts a status to a Mastodon (or Mastodon-API-compatible) server via `POST /api/v1/statuses`.
public enum MastodonPOSSEClient {
    private struct StatusResponse: Decodable { let url: URL }

    /// Publishes `post` (truncated to Mastodon's 500-character limit) and returns the status's
    /// public URL for the `syndication:` write-back.
    ///
    /// Duplicate protection relies on Mastodon's `Idempotency-Key` header: a retry after a
    /// crash re-sends the same key and the server returns the original status instead of
    /// creating a second one — see ``POSSEStableKey`` for how callers derive a stable key.
    ///
    /// - Throws: ``POSSEClientError`` for a bad endpoint, non-2xx status, or undecodable body.
    public static func post(
        _ post: POSSEPost,
        credentials: POSSECredentials.Mastodon,
        idempotencyKey: String,
        transport: POSSEHTTPTransport
    ) async throws -> URL {
        guard let endpoint = URL(string: "/api/v1/statuses", relativeTo: credentials.baseURL)?.absoluteURL else {
            throw POSSEClientError.invalidEndpoint
        }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "status", value: post.text(limit: 500))]
        guard let encoded = components.percentEncodedQuery?.data(using: .utf8) else {
            throw POSSEClientError.invalidResponse(platform: "Mastodon")
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = encoded
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        let (data, response) = try await transport(request)
        guard (200..<300).contains(response.statusCode) else {
            throw POSSEClientError.rejected(platform: "Mastodon", status: response.statusCode)
        }
        guard let result = try? JSONDecoder().decode(StatusResponse.self, from: data) else {
            throw POSSEClientError.invalidResponse(platform: "Mastodon")
        }
        return result.url
    }
}

/// Posts to Bluesky over the AT Protocol XRPC API: creates an app-password session, then a
/// `app.bsky.feed.post` record with a link facet and an external-card embed for the canonical URL.
public enum BlueskyPOSSEClient {
    private struct SessionRequest: Encodable { let identifier: String; let password: String }
    private struct SessionResponse: Decodable { let accessJwt: String; let did: String; let handle: String }
    private struct ByteSlice: Encodable { let byteStart: Int; let byteEnd: Int }
    private struct LinkFeature: Encodable {
        let type = "app.bsky.richtext.facet#link"
        let uri: URL
        enum CodingKeys: String, CodingKey { case type = "$type"; case uri }
    }
    private struct Facet: Encodable { let index: ByteSlice; let features: [LinkFeature] }
    private struct External: Encodable { let uri: URL; let title: String; let description: String }
    private struct Embed: Encodable {
        let type = "app.bsky.embed.external"
        let external: External
        enum CodingKeys: String, CodingKey { case type = "$type"; case external }
    }
    private struct PostRecord: Encodable {
        let type = "app.bsky.feed.post"
        let text: String
        let createdAt: String
        let facets: [Facet]
        let embed: Embed
        enum CodingKeys: String, CodingKey { case type = "$type"; case text, createdAt, facets, embed }
    }
    private struct CreateRecordRequest: Encodable {
        let repo: String
        let collection = "app.bsky.feed.post"
        let rkey: String
        let record: PostRecord
    }
    private struct CreateRecordResponse: Decodable { let uri: String }

    /// Publishes `post` (truncated to Bluesky's 300-character limit) and returns the post's
    /// public `bsky.app` URL for the `syndication:` write-back.
    ///
    /// Duplicate protection uses a caller-supplied deterministic `rkey` instead of an
    /// idempotency header (AT Protocol has none): a 409 conflict means the record already
    /// exists from an earlier attempt, so the client reconstructs and returns its stable
    /// public URL rather than failing — a crash-retry can never double-post.
    ///
    /// - Parameters:
    ///   - post: The source-derived copy to publish.
    ///   - credentials: PDS origin, handle/identifier, and app password.
    ///   - recordKey: Deterministic record key (see ``POSSEStableKey``); the same input must
    ///     always yield the same key or the 409-dedupe guarantee breaks.
    ///   - now: The record's `createdAt`; injected for test determinism.
    ///   - transport: HTTP seam (see ``POSSEHTTPTransport``).
    /// - Throws: ``POSSEClientError`` for a bad endpoint, non-2xx status (other than the
    ///   handled 409), or undecodable body.
    public static func post(
        _ post: POSSEPost,
        credentials: POSSECredentials.Bluesky,
        recordKey: String,
        now: Date,
        transport: POSSEHTTPTransport
    ) async throws -> URL {
        let session: SessionResponse = try await jsonRequest(
            path: "/xrpc/com.atproto.server.createSession",
            baseURL: credentials.pdsURL,
            body: SessionRequest(identifier: credentials.identifier, password: credentials.appPassword),
            bearer: nil,
            transport: transport
        )
        let text = post.text(limit: 300)
        let link = post.canonicalURL.absoluteString
        guard let linkRange = text.range(of: link, options: .backwards) else {
            throw POSSEClientError.invalidResponse(platform: "Bluesky")
        }
        let byteStart = text.utf8.distance(from: text.utf8.startIndex, to: linkRange.lowerBound.samePosition(in: text.utf8) ?? text.utf8.startIndex)
        let byteEnd = byteStart + link.utf8.count
        let record = PostRecord(
            text: text,
            createdAt: ISO8601DateFormatter().string(from: now),
            facets: [Facet(index: ByteSlice(byteStart: byteStart, byteEnd: byteEnd), features: [LinkFeature(uri: post.canonicalURL)])],
            embed: Embed(external: External(uri: post.canonicalURL, title: post.title, description: post.summary))
        )
        let body = CreateRecordRequest(repo: session.did, rkey: recordKey, record: record)
        do {
            let response: CreateRecordResponse = try await jsonRequest(
                path: "/xrpc/com.atproto.repo.createRecord",
                baseURL: credentials.pdsURL,
                body: body,
                bearer: session.accessJwt,
                transport: transport
            )
            guard let returnedKey = response.uri.split(separator: "/").last else {
                throw POSSEClientError.invalidResponse(platform: "Bluesky")
            }
            return publicURL(handle: session.handle, recordKey: String(returnedKey))
        } catch POSSEClientError.rejected(_, 409) {
            // A deterministic rkey makes a retry after a crash idempotent. Conflict means the
            // record already exists, so reconstruct its stable public URL.
            return publicURL(handle: session.handle, recordKey: recordKey)
        }
    }

    private static func jsonRequest<Body: Encodable, Response: Decodable>(
        path: String,
        baseURL: URL,
        body: Body,
        bearer: String?,
        transport: POSSEHTTPTransport
    ) async throws -> Response {
        guard let endpoint = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw POSSEClientError.invalidEndpoint
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await transport(request)
        guard (200..<300).contains(response.statusCode) else {
            throw POSSEClientError.rejected(platform: "Bluesky", status: response.statusCode)
        }
        guard let decoded = try? JSONDecoder().decode(Response.self, from: data) else {
            throw POSSEClientError.invalidResponse(platform: "Bluesky")
        }
        return decoded
    }

    private static func publicURL(handle: String, recordKey: String) -> URL {
        if let url = URL(string: "https://bsky.app/profile/\(handle)/post/\(recordKey)") {
            return url
        }
        guard let fallback = URL(string: "https://bsky.app") else {
            fatalError("Static Bluesky URL is invalid")
        }
        return fallback
    }
}

/// Derives the deterministic identifiers both clients use for duplicate protection
/// (Mastodon's `Idempotency-Key`, Bluesky's `rkey`): the same site + canonical URL + platform
/// must always map to the same key so a crash-retry is recognized as the same post.
public enum POSSEStableKey {
    /// Portable FNV-1a hash used only for deterministic idempotency identifiers, not security.
    public static func make(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }
}
