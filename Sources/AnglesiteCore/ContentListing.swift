import Foundation

/// Decoded form of the plugin's `list_content` MCP tool response, projected into
/// `SiteContentGraph` structs (A.8, #142).
///
/// The plugin payload is **site-agnostic** — it carries no `siteID` and no entity `id`. This
/// type stamps the caller-supplied `siteID` onto every entry and builds the site-scoped ids
/// (`{siteID}:page:{route}`, `:post:{slug}`, `:image:{relativePath}`) that the graph and the
/// App Intents entities key off. Keeping id construction here (not in the plugin) means the
/// plugin never has to know which on-disk site it's serving.
///
/// Timestamps are ISO-8601 strings; both plain (`…Z`) and fractional-second (`….500Z`) forms
/// are accepted. `lastModified` is required on every entry; `publishDate` (posts) is optional.
/// A missing top-level array (`pages`/`posts`/`images`) decodes to empty — an older or partial
/// plugin that only reports pages doesn't fail the whole parse.
public struct ContentListing: Sendable, Equatable {
    /// Routable pages, ids already site-scoped (`{siteID}:page:{route}`).
    public let pages: [SiteContentGraph.Page]
    /// Collection entries, ids already site-scoped (`{siteID}:post:{slug}`).
    public let posts: [SiteContentGraph.Post]
    /// Site images with their referencing pages, ids already site-scoped
    /// (`{siteID}:image:{relativePath}`).
    public let images: [SiteContentGraph.Image]

    /// Parse the `list_content` JSON text, stamping `siteID` and constructing site-scoped ids.
    /// Throws `DecodingError` on malformed JSON, a missing required field, or an unparseable date.
    public static func parse(jsonText: String, siteID: String) throws -> ContentListing {
        let data = Data(jsonText.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(decodeISO8601)
        let dto = try decoder.decode(Payload.self, from: data)
        return ContentListing(
            pages: dto.pages.map { $0.page(siteID: siteID) },
            posts: dto.posts.map { $0.post(siteID: siteID) },
            images: dto.images.map { $0.image(siteID: siteID) }
        )
    }

    // MARK: - Wire DTOs

    private struct Payload: Decodable {
        let pages: [PageDTO]
        let posts: [PostDTO]
        let images: [ImageDTO]

        enum CodingKeys: String, CodingKey { case pages, posts, images }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            pages = try c.decodeIfPresent([PageDTO].self, forKey: .pages) ?? []
            posts = try c.decodeIfPresent([PostDTO].self, forKey: .posts) ?? []
            images = try c.decodeIfPresent([ImageDTO].self, forKey: .images) ?? []
        }
    }

    private struct PageDTO: Decodable {
        let route: String
        let filePath: String
        let title: String?
        let lastModified: Date

        func page(siteID: String) -> SiteContentGraph.Page {
            SiteContentGraph.Page(
                id: "\(siteID):page:\(route)",
                siteID: siteID,
                route: route,
                filePath: filePath,
                title: title,
                lastModified: lastModified
            )
        }
    }

    private struct PostDTO: Decodable {
        let collection: String
        let slug: String
        let title: String
        let draft: Bool
        let publishDate: Date?
        let tags: [String]
        let filePath: String
        let lastModified: Date

        func post(siteID: String) -> SiteContentGraph.Post {
            SiteContentGraph.Post(
                id: "\(siteID):post:\(slug)",
                siteID: siteID,
                collection: collection,
                slug: slug,
                title: title,
                draft: draft,
                publishDate: publishDate,
                tags: tags,
                filePath: filePath,
                lastModified: lastModified
            )
        }
    }

    private struct ImageDTO: Decodable {
        let relativePath: String
        let fileName: String
        let byteSize: Int64?
        let usedOnPages: [String]
        let lastModified: Date

        func image(siteID: String) -> SiteContentGraph.Image {
            SiteContentGraph.Image(
                id: "\(siteID):image:\(relativePath)",
                siteID: siteID,
                relativePath: relativePath,
                fileName: fileName,
                byteSize: byteSize,
                usedOnPages: usedOnPages,
                lastModified: lastModified
            )
        }
    }

    // MARK: - Date parsing

    /// `ISO8601DateFormatter` instances are not cheap to build, so cache one per format
    /// variant. We configure each once at init and only ever call the read-only `date(from:)`
    /// thereafter. Apple doesn't *document* `ISO8601DateFormatter` as thread-safe, so the
    /// `nonisolated(unsafe)` here is a deliberate choice: it asserts the never-mutated-after-init
    /// invariant we enforce above, accepting responsibility for it rather than relying on a
    /// documented guarantee.
    private nonisolated(unsafe) static let plainFormatter = ISO8601DateFormatter()
    private nonisolated(unsafe) static let fractionalFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// `@Sendable` so this can back the `.custom` date-decoding strategy assigned in
    /// `parse(jsonText:siteID:)` above (`decoder.dateDecodingStrategy = .custom(decodeISO8601)`),
    /// whose parameter is `@Sendable (any Decoder) throws -> Date`.
    @Sendable private static func decodeISO8601(_ decoder: Decoder) throws -> Date {
        let raw = try decoder.singleValueContainer().decode(String.self)
        if let date = fractionalFormatter.date(from: raw) ?? plainFormatter.date(from: raw) {
            return date
        }
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Expected an ISO-8601 timestamp, got \"\(raw)\""
            )
        )
    }
}
