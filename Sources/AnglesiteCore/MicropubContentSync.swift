// Sources/AnglesiteCore/MicropubContentSync.swift
import Foundation

/// Orchestrates #912's "pull Micropub-created posts from D1 and turn each into a typed content
/// file" step. This file holds the pure URL-parsing and mf2-to-field mapping logic; `pullAndCommit`
/// / `pullAndCommitIfConfigured` (Task 7) extend this enum with the D1-query + commit glue.
/// See docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md.
public enum MicropubContentSync {
    /// One post resolved to its content type, ready for `MicropubContentCommitter`.
    public struct ResolvedPost: Sendable, Equatable {
        public let url: String
        public let collection: String
        public let descriptor: ContentTypeDescriptor
        public let values: TypedContentEditor.Values
        public let updatedAt: Int
    }

    /// Parses `{baseUrl}/{collection}/{slug}` — the shape `post-type-discovery.ts`'s
    /// `generatePostUrl` assigns at create time for a recognized mf2 type — into its collection
    /// and slug. Returns `nil` for any other shape: the flat `{baseUrl}/{slug}` fallback URL a
    /// post gets when its mf2 type wasn't recognized at create time, or a malformed URL. This
    /// bridge only ever reads the collection out of the URL — it never re-derives it from mf2
    /// properties, so classification happens exactly once (Worker-side, at create time).
    static func collectionAndSlug(from urlString: String) -> (collection: String, slug: String)? {
        guard let url = URL(string: urlString) else { return nil }
        let segments = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard segments.count == 2 else { return nil }
        return (segments[0], segments[1])
    }

    /// Extracts a plain-text string from one mf2 property value: a bare string, or a rich-text
    /// object's `value` key (mirrors `worker.ts`'s AP fan-out `extractMf2ContentString` — same
    /// mf2 shape, same fallback). `nil` for any other shape.
    static func plainText(from value: JSONValue?) -> String? {
        switch value {
        case .string(let s): return s
        case .object(let o):
            if case .string(let s)? = o["value"] { return s }
            return nil
        default: return nil
        }
    }

    private static let isoWithFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func parseDate(_ raw: String) -> Date? {
        if let d = isoWithFractionalSeconds.date(from: raw) { return d }
        if let d = ISO8601DateFormatter().date(from: raw) { return d }
        let df = DateFormatter()
        df.calendar = Calendar(identifier: .iso8601)
        df.timeZone = TimeZone(identifier: "UTC")
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: raw)
    }

    /// Builds one `ContentTypeField`'s value from a post's raw mf2 properties. Returns `nil` only
    /// when `field.required` and no usable value exists — the caller (`values(for:properties:)`)
    /// treats that as "skip the whole post."
    static func fieldValue(
        for field: ContentTypeField,
        rawProperty: String,
        properties: [String: [JSONValue]]
    ) -> TypedContentEditor.FieldValue? {
        let values = properties[rawProperty] ?? []
        switch field.kind {
        case .string, .text, .url, .image, .markdown:
            guard let text = values.first.flatMap(plainText) else {
                return field.required ? nil : .text("")
            }
            return .text(text)
        // No field in the built-in registry maps a raw mf2 property to `.bool` today (`draft` is
        // special-cased in `values(for:)` below, driven by `post-status` instead) — this arm
        // exists only for switch exhaustiveness / defense-in-depth against a future bool field.
        case .bool:
            return .flag(false)
        case .date, .datetime:
            guard let text = values.first.flatMap(plainText), let date = parseDate(text) else {
                return field.required ? nil : .date(nil)
            }
            return .date(date)
        case .number:
            guard let text = values.first.flatMap(plainText), let number = Double(text) else {
                return field.required ? nil : .number(nil)
            }
            return .number(number)
        case .stringArray:
            return .list(values.compactMap(plainText))
        case .imageArray:
            let strings = values.compactMap(plainText)
            return (field.required && strings.isEmpty) ? nil : .list(strings)
        }
    }

    /// Builds every field value for `descriptor` from a post's raw mf2 properties. Returns `nil`
    /// (skip the whole post) when a required field can't be resolved — a malformed/partial post
    /// shouldn't produce invalid frontmatter.
    static func values(
        for descriptor: ContentTypeDescriptor,
        properties: [String: [JSONValue]]
    ) -> TypedContentEditor.Values? {
        var out = TypedContentEditor.Values()
        for field in descriptor.fields {
            // `draft` has no mf2 property of its own — it's derived from the Post Status
            // extension's `post-status` property (`@dwk/micropub` validates this is either
            // "draft" or "published"/absent before storing it).
            if field.name == "draft" {
                let status = properties["post-status"]?.first.flatMap(plainText)
                out["draft"] = .flag(status == "draft")
                continue
            }
            guard let rawProperty = descriptor.projections.rawMf2Property(forField: field.name) else {
                if field.required { return nil }
                out[field.name] = TypedContentEditor.defaultValue(for: field.kind)
                continue
            }
            guard let value = fieldValue(for: field, rawProperty: rawProperty, properties: properties) else {
                return nil
            }
            out[field.name] = value
        }
        return out
    }

    /// Resolves one D1 row to a `ResolvedPost`, or `nil` (skip — the caller logs this) when its
    /// URL's collection isn't one this bridge maps to a registered content type, or a required
    /// field can't be resolved from its mf2 properties.
    static func resolve(
        post: MicropubPostD1Client.Post,
        registry: ContentTypeRegistry = .default
    ) -> ResolvedPost? {
        guard let (collection, _) = collectionAndSlug(from: post.url),
              let descriptor = registry.descriptor(forCollection: collection),
              let values = values(for: descriptor, properties: post.properties)
        else { return nil }
        return ResolvedPost(
            url: post.url, collection: collection, descriptor: descriptor,
            values: values, updatedAt: post.updatedAt)
    }

    /// Queries `client` for every current post (live and soft-deleted), resolves each to its
    /// content type, and reconciles the result into `siteDirectory` via
    /// `MicropubContentCommitter`. Returns 0 (never throws) if the D1 query failed. Soft-deleted
    /// and unresolvable posts are simply absent from the resolved set passed to the committer — a
    /// previously-synced post whose row later became unresolvable (soft-deleted, or an edit that
    /// broke a required field) is removed from git the same way a truly-deleted post is.
    public static func pullAndCommit(
        client: MicropubPostD1Client, siteDirectory: URL, configDirectory: URL
    ) async -> Int {
        guard let posts = try? await client.listAllPosts() else { return 0 }
        let resolved = posts.filter { !$0.deleted }.compactMap { resolve(post: $0) }
        return await MicropubContentCommitter.commit(
            posts: resolved, into: siteDirectory, configDirectory: configDirectory)
    }

    /// Reads the site's `SiteSettings` and the Cloudflare API token from `secretStore`; no-ops
    /// (returns 0, no network call) unless a D1 database has been provisioned — same gate
    /// `ReceivedInteractionSync` uses, since Micropub shares the same D1 database.
    /// `configDirectory` is the package's `Config/` directory (`AnglesitePackage.configURL`), a
    /// sibling of `siteDirectory` (`AnglesitePackage.sourceURL`).
    public static func pullAndCommitIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        secretStore: any SecretStore = PlatformSecretStore.make(),
        baseURL: String = "https://api.cloudflare.com/client/v4",
        transport: @escaping CloudflareTransport = HTTPCloudflareClient.defaultTransport
    ) async -> Int {
        guard let settings = try? SiteConfigStore.read(from: configDirectory),
              let databaseID = settings.provisionedWorkerResources?.d1DatabaseID, !databaseID.isEmpty,
              let token = try? secretStore.readCloudflareToken(), !token.isEmpty
        else { return 0 }
        guard let accountID = await Self.resolveAccountID(apiToken: token, baseURL: baseURL, transport: transport)
        else { return 0 }

        let client = MicropubPostD1Client(
            accountID: accountID, databaseID: databaseID, apiToken: token, baseURL: baseURL, transport: transport)
        return await pullAndCommit(client: client, siteDirectory: siteDirectory, configDirectory: configDirectory)
    }

    private struct CFAccount: Decodable, Sendable { let id: String }
    private struct CFEnvelope: Decodable, Sendable { let success: Bool; let result: [CFAccount]? }

    /// Resolves the token's first visible Cloudflare account id — same resolution
    /// `ReceivedInteractionSync` uses, since a personal Anglesite deployment has exactly one
    /// Cloudflare account per token.
    private static func resolveAccountID(apiToken: String, baseURL: String, transport: CloudflareTransport) async -> String? {
        guard let url = URL(string: "\(baseURL)/accounts?per_page=1") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        guard let (data, http) = try? await transport(request), (200..<300).contains(http.statusCode),
              let envelope = try? JSONDecoder().decode(CFEnvelope.self, from: data), envelope.success
        else { return nil }
        return envelope.result?.first?.id
    }
}
