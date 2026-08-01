// Sources/AnglesiteCore/MicropubContentSync.swift
import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Orchestrates #912's "pull Micropub-created posts from D1 and turn each into a typed content
/// file" step. This file holds the pure URL-parsing and mf2-to-field mapping logic; `pullAndCommit`
/// / `pullAndCommitIfConfigured` (Task 7) extend this enum with the D1-query + commit glue.
/// See docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md.
public enum MicropubContentSync {
    /// One post resolved to its content type, ready for `MicropubContentCommitter`.
    public struct ResolvedPost: Sendable, Equatable {
        /// The post's canonical URL — the D1 row's identity, and the key the committer's
        /// persisted sync state maps to an on-disk path, so a re-sync updates the same file
        /// instead of re-deriving (and potentially re-suffixing) a slug.
        public let url: String
        /// The collection parsed out of the URL's first path segment (`collectionAndSlug`) —
        /// never re-derived from mf2 properties, so classification happens exactly once,
        /// Worker-side at create time.
        public let collection: String
        /// The registered content type the collection resolved to; drives frontmatter shape
        /// and the file's target directory.
        public let descriptor: ContentTypeDescriptor
        /// Every frontmatter field value, fully resolved (fallbacks applied) — ready to hand
        /// to ``TypedContentEditor`` verbatim.
        public let values: TypedContentEditor.Values
        /// The D1 row's `updated_at` (Unix seconds), echoed through from the source row. The
        /// `publishDate` fallback already consumed it during resolution; it's retained here so
        /// callers can still see the row's own timestamp after resolution.
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

    /// Extracts a plain-text string from one mf2 property value: a bare string, a rich-text
    /// object's `value` key, or (the standard Micropub JSON *create* shape, as opposed to mf2
    /// read back off a rendered page) a rich-text object's `html` key with no `value` key at all
    /// (mirrors `worker.ts`'s AP fan-out `extractMf2ContentString` — same mf2 shape, same
    /// fallback). Storing the raw HTML string as-is in the Markdown body is a deliberate
    /// simplification for this slice — no HTML-to-Markdown conversion (see the design doc's §3).
    /// `nil` for any other shape.
    static func plainText(from value: JSONValue?) -> String? {
        switch value {
        case .string(let s): return s
        case .object(let o):
            if case .string(let s)? = o["value"] { return s }
            if case .string(let s)? = o["html"] { return s }
            return nil
        default: return nil
        }
    }

    /// Extracts the `name` of a nested h-item/h-card mf2 object (`{type: [...], properties: {name:
    /// [...]}}`) — the conventional shape for h-review's `item` property. Narrowly scoped to
    /// `itemReviewed` resolution, not a general mf2-object-tree walker.
    static func nestedItemName(from value: JSONValue?) -> String? {
        guard case .object(let o)? = value, case .object(let properties)? = o["properties"] else { return nil }
        switch properties["name"] {
        case .string(let s): return s
        case .array(let values):
            if case .string(let s)? = values.first { return s }
            return nil
        default: return nil
        }
    }

    /// `title`/`name` — the two field names this registry uses purely as a post's own title (as
    /// opposed to `itemReviewed`, which is also "title-like" for `ContentScaffold`'s placeholder-
    /// fill purposes but names the *reviewed item*, not the post — a slug-derived fallback would
    /// be nonsensical there).
    private static let slugFallbackFieldNames = ContentTypeDescriptor.titleLikeFieldNames.subtracting(["itemReviewed"])

    /// "my-trip-2026" → "My Trip 2026": the slug-derived title fallback for a required title-like
    /// field (`title`/`name`) a Micropub client didn't send (e.g. a nameless multi-photo post that
    /// Post Type Discovery still routes to `albums`, whose descriptor requires `title`).
    static func titleFromSlug(_ slug: String) -> String {
        slug.split(separator: "-").map { $0.capitalized }.joined(separator: " ")
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

    /// Builds one `ContentTypeField`'s value from a post's raw mf2 properties. Returns `nil` when
    /// no usable value exists at all — regardless of `field.required` — leaving the
    /// required-vs-optional decision (fail the whole post vs. fall back vs. omit the key) to the
    /// caller, `values(for:properties:updatedAt:slug:)`.
    static func fieldValue(
        for field: ContentTypeField,
        rawProperty: String,
        properties: [String: [JSONValue]]
    ) -> TypedContentEditor.FieldValue? {
        let values = properties[rawProperty] ?? []
        switch field.kind {
        case .string, .language, .text, .url, .image, .markdown:
            let raw = values.first
            // `itemReviewed` (h-review's `item`) is conventionally a nested h-item/h-card mf2
            // object, not a plain string — only that field tries the nested-object fallback.
            let text = plainText(from: raw) ?? (field.name == "itemReviewed" ? nestedItemName(from: raw) : nil)
            guard let text else { return nil }
            return .text(text)
        // No field in the built-in registry maps a raw mf2 property to `.bool` today (`draft` is
        // special-cased in `values(for:)` below, driven by `post-status` instead) — this arm
        // exists only for switch exhaustiveness / defense-in-depth against a future bool field.
        case .bool:
            return .flag(false)
        case .date, .datetime:
            guard let text = values.first.flatMap(plainText), let date = parseDate(text) else { return nil }
            return .date(date)
        case .number:
            // A client can send `rating` as a genuine JSON number (not a string) — check that
            // directly before falling back to the plainText-then-`Double(text)` string path.
            if case .int(let n)? = values.first { return .number(Double(n)) }
            if case .double(let n)? = values.first { return .number(n) }
            guard let text = values.first.flatMap(plainText), let number = Double(text) else { return nil }
            return .number(number)
        case .stringArray:
            return .list(values.compactMap(plainText))
        case .imageArray:
            let strings = values.compactMap(plainText)
            return strings.isEmpty ? nil : .list(strings)
        // No field in the built-in registry maps a raw mf2 property to `.objectArray` today (h-resume
        // lands in #964, and even then p-experience/p-education are nested h-event/h-card mf2
        // objects this bridge doesn't attempt to flatten back into records) — this arm exists only
        // for switch exhaustiveness, mirroring the `.bool` arm above.
        case .objectArray:
            return .records([])
        }
    }

    /// Builds every field value for `descriptor` from a post's raw mf2 properties. Returns `nil`
    /// (skip the whole post) when a required field can't be resolved even after the fallbacks
    /// below — a malformed/partial post shouldn't produce invalid frontmatter.
    ///
    /// - `updatedAt`: the D1 row's own `updated_at`, used as a `publishDate` fallback — `@dwk/
    ///   micropub` does NOT inject a `published` timestamp on create, so the micropub.rocks
    ///   conformance shape (no dates at all) would otherwise fail this always-required field.
    /// - `slug`: the post URL's slug, used as a `title`/`name` fallback for a post whose required
    ///   title-like field has no resolvable mf2 value (e.g. a nameless multi-photo post Post Type
    ///   Discovery still routes to `albums`).
    static func values(
        for descriptor: ContentTypeDescriptor,
        properties: [String: [JSONValue]],
        updatedAt: Int,
        slug: String
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

            let resolved = descriptor.projections.rawMf2Property(forField: field.name)
                .flatMap { fieldValue(for: field, rawProperty: $0, properties: properties) }
            if let resolved {
                out[field.name] = resolved
                continue
            }

            // Unresolved (no mf2 mapping at all, or a mapping with no usable value). Try the
            // field-specific fallbacks before giving up on the field/post.
            if field.name == "publishDate" {
                out[field.name] = .date(Date(timeIntervalSince1970: Double(updatedAt)))
                continue
            }
            if field.required, field.kind == .string || field.kind == .text,
               slugFallbackFieldNames.contains(field.name) {
                out[field.name] = .text(titleFromSlug(slug))
                continue
            }
            if field.required { return nil }

            // A non-required date/url/number-kind field that can't be resolved must be OMITTED,
            // not set to an empty placeholder: `TypedContentEditor.write` only touches keys
            // present in the `Values` it's given, so omitting the key leaves the file's existing
            // value (or leaves it simply absent for a new file) instead of emitting an invalid
            // blank scalar that a `z.coerce.date().optional()` / `z.string().url().optional()` /
            // `z.number().optional()` schema rejects (`TypedContentEditor.defaultValue(for:
            // .number)` is `.number(nil)`, which serializes to `.string("")` the same way the
            // date/url defaults do).
            if field.kind == .date || field.kind == .datetime || field.kind == .url
                || field.kind == .number { continue }

            out[field.name] = TypedContentEditor.defaultValue(for: field.kind)
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
        guard let (collection, slug) = collectionAndSlug(from: post.url),
              let descriptor = registry.descriptor(forCollection: collection),
              let values = values(
                for: descriptor, properties: post.properties, updatedAt: post.updatedAt, slug: slug)
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
    /// broke a required field) is removed from git the same way a truly-deleted post is. A live
    /// post that `resolve(post:)` can't map (unknown collection, or a required field with no
    /// resolvable value even after the fallbacks above) is logged to `LogCenter`, per the design
    /// doc's Error Handling section, rather than silently vanishing.
    public static func pullAndCommit(
        client: MicropubPostD1Client, siteDirectory: URL, configDirectory: URL
    ) async -> Int {
        guard let posts = try? await client.listAllPosts() else { return 0 }
        var resolved: [ResolvedPost] = []
        for post in posts where !post.deleted {
            if let resolvedPost = resolve(post: post) {
                resolved.append(resolvedPost)
            } else {
                await LogCenter.shared.append(
                    source: "MicropubContentSync", stream: .stderr,
                    text: "Skipping unresolvable Micropub post \(post.url): unknown collection "
                        + "or a required field with no resolvable mf2 value.")
            }
        }
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
