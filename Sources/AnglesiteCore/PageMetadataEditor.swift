
/// A page's editable metadata. Phase 1 covers title + description; the rendered `<title>` is
/// composed from a site-level tokenized template (main site settings, out of scope here) with this
/// per-page `title` substituted.
public struct PageMetadata: Equatable, Sendable {
    public var title: String
    public var description: String
    /// A BCP-47 language override for this page (#956). Empty means "inherit the site default" —
    /// see SiteLanguageAsset and the design doc's empty-string-means-unset rule; an empty string
    /// is written to frontmatter as `lang: ""`, not omitted (matching TypedContentEditor's
    /// existing behavior for every other field).
    public var lang: String

    public init(title: String, description: String, lang: String = "") {
        self.title = title
        self.description = description
        self.lang = lang
    }
}

/// Reads/writes `title` + `description` frontmatter for plain (non-typed) frontmatter pages.
/// Goes through `FrontmatterDocument`, so unknown keys and the body survive verbatim and only a
/// changed key is re-rendered. Pure, no I/O.
public enum PageMetadataEditor {
    public static func read(_ contents: String) -> PageMetadata {
        let doc = FrontmatterDocument.parse(contents)
        return PageMetadata(title: scalar(doc, "title"), description: scalar(doc, "description"), lang: scalar(doc, "lang"))
    }

    public static func write(_ metadata: PageMetadata, into contents: String) -> String {
        var doc = FrontmatterDocument.parse(contents)
        let current = read(contents)
        if metadata.title != current.title { doc.set(.string(metadata.title), for: "title") }
        if metadata.description != current.description {
            doc.set(.string(metadata.description), for: "description")
        }
        if metadata.lang != current.lang { doc.set(.string(metadata.lang), for: "lang") }
        return doc.serialized()
    }

    private static func scalar(_ doc: FrontmatterDocument, _ key: String) -> String {
        if case .string(let s)? = doc.value(for: key) { return s }
        return ""
    }
}
