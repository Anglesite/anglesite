import Foundation

/// A "sticky note" pinned to a page element by the owner via the WKWebView edit overlay.
///
/// The plugin (`anglesite/server/annotations.mjs`) is the source of truth: annotations are
/// persisted to `<projectRoot>/annotations.json` and exposed via MCP tools `add_annotation`,
/// `list_annotations`, `resolve_annotation`. This struct mirrors that JSON shape so the chat
/// panel can render annotations as system-style messages rather than having a parallel UI.
///
/// Per the build plan's Phase 8 step 4 ("sticky notes from the existing toolbar arrive as
/// chat messages"): there is no standalone sticky-note UI in the app to remove; the chat panel
/// is the only surface that displays annotations.
public struct Annotation: Sendable, Equatable, Identifiable, Codable {
    /// Store-assigned identifier (an 8-character nanoid — see ``AnnotationStore``); the handle
    /// `resolve_annotation` takes, so it must survive round-trips unchanged.
    public let id: String
    /// The page route the note was pinned on, used to scope `list_annotations` to the page the
    /// owner is looking at.
    public let path: String
    /// CSS selector of the pinned element, so the overlay can re-highlight the note's target on
    /// a later visit.
    public let selector: String
    /// The component source file the overlay resolved for the element, when it could — lets a
    /// fix land in the owning component rather than being hunted down from the rendered page.
    /// `nil` when resolution failed; the note is still useful without it.
    public let sourceFile: String?
    /// The owner's note, verbatim.
    public let text: String
    /// Whether the note has been addressed. Resolved annotations stay in the file (for history)
    /// but are filtered out of every listing.
    public let resolved: Bool
    /// When the note was created.
    public let createdAt: Date
    /// When the note was resolved; `nil` while it's still open.
    public let resolvedAt: Date?

    /// Memberwise initializer mirroring the JSON shape. The defaults (`sourceFile`/`resolvedAt`
    /// as `nil`) match the fields the plugin omits rather than nulls, so fixtures read like the
    /// file does.
    public init(
        id: String,
        path: String,
        selector: String,
        sourceFile: String? = nil,
        text: String,
        resolved: Bool,
        createdAt: Date,
        resolvedAt: Date? = nil
    ) {
        self.id = id
        self.path = path
        self.selector = selector
        self.sourceFile = sourceFile
        self.text = text
        self.resolved = resolved
        self.createdAt = createdAt
        self.resolvedAt = resolvedAt
    }
}

/// Returns the current list of unresolved annotations from the plugin's MCP server. Designed
/// as a closure so the UI layer can inject either a real MCP-backed fetcher or a fixture in
/// tests. The default production builder (`AnnotationFeedFactory.viaMCP`) wraps an MCPClient.
public typealias AnnotationFeed = @Sendable () async throws -> [Annotation]

/// Builds a production `AnnotationFeed` and parses the plugin's JSON shape.
public enum AnnotationFeedFactory {
    /// Builds an `AnnotationFeed` backed by the native `AnnotationStore` (#275) — reads the
    /// unresolved annotations straight from `<sourceDirectory>/annotations.json` with no MCP hop.
    /// `directory` is the site's `Source/` root (where the store and the edit overlay agree the
    /// file lives). Never throws: a missing/empty file yields `[]`.
    public static func native(directory: URL) -> AnnotationFeed {
        return { AnnotationStore.list(in: directory) }
    }

    /// Builds an `AnnotationFeed` that calls the plugin's `list_annotations` MCP tool through
    /// the supplied weak getter, and parses the first text content block as a JSON array of
    /// annotations. Tolerant of `nil` clients (returns `[]`) so a freshly-opened site whose
    /// preview session is still spinning up just shows no annotations rather than throwing.
    public static func viaMCP(mcpClient: @escaping @Sendable () async -> MCPClient?) -> AnnotationFeed {
        return {
            guard let client = await mcpClient() else { return [] }
            let result = try await client.callTool(name: "list_annotations", arguments: .object([:]))
            guard !result.isError else {
                let detail = result.content.compactMap(\.text).joined(separator: "\n")
                throw NSError(domain: "AnnotationFeed", code: 1, userInfo: [NSLocalizedDescriptionKey: "list_annotations returned an error: \(detail)"])
            }
            guard let payload = result.content.first?.text, !payload.isEmpty else { return [] }
            return try Self.decode(jsonText: payload)
        }
    }

    /// Parses a JSON array string of plugin annotations. Public so tests can exercise the
    /// decoder without standing up a real MCP server.
    public static func decode(jsonText: String) throws -> [Annotation] {
        let trimmed = jsonText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([Annotation].self, from: data)
    }
}
