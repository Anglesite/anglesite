import Foundation

/// Resolves a project-relative file path to its content type, so the app can open typed files in
/// the form editor. Collection entries are matched by their `src/content/<collection>/` directory;
/// page-stored singletons by a fixed path map. Pure, no I/O.
public enum ContentTypeResolver {
    /// Canonical singleton paths for `.page`-stored types → their type id. Keyed by path (the lookup
    /// direction) and lowercased for case-insensitive matching on case-insensitive APFS volumes.
    /// `businessProfile` ships in the template at `src/pages/about.md` (the editor-relevant slice of
    /// #388). NOTE: this resolves the singleton by *path*, so renaming `about.md` drops typed-editor
    /// access — acceptable for a fixed singleton; revisit with a `type:` frontmatter marker if pages
    /// become user-renamable.
    static let pageTypesByPath: [String: String] = ["src/pages/about.md": "businessProfile"]

    /// The content type owning `path`, or `nil` when the file isn't typed content. `path` is
    /// project-relative; leading `./`/`/` and backslash separators are normalized, and matching is
    /// case-insensitive so a case-insensitive APFS volume's spelling still resolves. Collection
    /// membership wins over the page-singleton map (a collection entry can never also be a
    /// `src/pages` path, so the order is only about checking the cheap directory match first).
    public static func descriptor(
        forRelativePath path: String,
        registry: ContentTypeRegistry = ContentTypeRegistry()
    ) -> ContentTypeDescriptor? {
        let normalized = normalize(path)

        // 1. Collection entry by directory.
        let parts = normalized.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if parts.count >= 4, parts[0] == "src", parts[1] == "content" {
            let collection = parts[2]
            if let match = registry.all.first(where: { $0.collection == collection }) { return match }
        }

        // 2. Page singleton by exact (case-insensitive) path.
        if let id = pageTypesByPath[normalized] { return registry.descriptor(id: id) }
        return nil
    }

    private static func normalize(_ path: String) -> String {
        var p = path.replacingOccurrences(of: "\\", with: "/")
        while p.hasPrefix("./") { p.removeFirst(2) }
        while p.hasPrefix("/") { p.removeFirst() }
        // Lowercase so a case-insensitive APFS volume returning `src/pages/About.md` still resolves.
        // Collection names and the singleton paths are all lowercase by convention.
        return p.lowercased()
    }
}
