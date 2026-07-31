import Foundation

/// One page/post of a site reduced to capped plain text for a single FM call (#465). `filePath`
/// is project-relative (e.g. `src/pages/about.astro`) so findings can be applied back to disk.
public struct ContentChunk: Sendable, Equatable, Identifiable {
    /// Identity is the file path — the chunker emits exactly one chunk per source file.
    public var id: String { filePath }
    /// The public route the file renders at (see `SiteContentChunker.route(forRelativePath:)`).
    public let route: String
    /// Frontmatter `title`, when the file declares one.
    public let title: String?
    /// Project-relative source path — the write-back target when a finding is applied to disk.
    public let filePath: String
    /// The extracted text, hard-capped so a single FM call fits the on-device window.
    public let text: String
    /// Whether ``text`` was cut at the cap — carried so downstream replies can disclose
    /// partial coverage instead of silently trimming.
    public let truncated: Bool

    /// Memberwise creation, used by the chunker and by test fixtures.
    public init(route: String, title: String?, filePath: String, text: String, truncated: Bool) {
        self.route = route
        self.title = title
        self.filePath = filePath
        self.text = text
        self.truncated = truncated
    }
}

/// Deterministic whole-site enumeration for the content-help capabilities: scans the `Source/`
/// tree directly (the same filesystem truth `SiteContentGraph` is populated from), extracts
/// plain text per file, and hard-caps each chunk so every FM call fits the ~4K on-device window
/// (the spec's chunk-first strategy). Pure string helpers are separated for CI unit tests.
public enum SiteContentChunker {
    /// Matches `FoundationModelAssistant.maxPageContentCharacters` — a char-based token proxy.
    public static let maxChunkCharacters = 2_000

    static let contentExtensions: Set<String> = ["md", "mdoc"]
    static let pageExtensions: Set<String> = ["astro", "md", "mdoc"]

    /// Enumerates `src/content` (markdown/mdoc) and `src/pages` (plus `.astro`) under
    /// `sourceDirectory`, yielding one capped ``ContentChunk`` per content file, sorted by
    /// route so prompt order — and therefore FM output — is deterministic across runs.
    /// Unreadable or empty files are skipped, not errors: a half-saved file mid-edit must not
    /// fail a whole-site audit.
    public static func chunks(sourceDirectory: URL, fileManager: FileManager = .default) -> [ContentChunk] {
        var chunks: [ContentChunk] = []
        for (subdir, extensions) in [("src/content", contentExtensions), ("src/pages", pageExtensions)] {
            let root = sourceDirectory.appendingPathComponent(subdir)
            guard let enumerator = fileManager.enumerator(
                at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { continue }
            for case let url as URL in enumerator {
                guard extensions.contains(url.pathExtension.lowercased()),
                      let contents = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let relative = subdir + "/" + relativePath(of: url, under: root)
                let fields = Frontmatter.parse(contents)
                var title: String?
                if case let .string(value)? = fields["title"] { title = value }
                // Markdown/mdoc chunks carry the raw frontmatter-stripped body, not sanitized
                // plain text: Apply matches a model excerpt verbatim against the file on disk
                // (`CopyRewriteApplier`/`CopyEditReportModel`), and `plainText(markdown:)` removes
                // interior syntax (link brackets, emphasis markers, …) that separates otherwise-
                // adjacent words — an excerpt straddling one of those would never be a substring
                // of the raw file. Raw markdown is also small enough to send as-is within the
                // window. `.astro` chunks stay sanitized: the full Astro source (imports, JS,
                // component props) would waste the on-device window on markup the model doesn't
                // need to read, and Apply for `.astro` findings fails safe to Copy Rewrite instead
                // (#465 review).
                let raw = url.pathExtension.lowercased() == "astro"
                    ? plainText(astro: contents)
                    : Frontmatter.body(contents).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !raw.isEmpty else { continue }
                let (text, truncated) = capped(raw)
                chunks.append(ContentChunk(
                    route: route(forRelativePath: relative),
                    title: title,
                    filePath: relative,
                    text: text,
                    truncated: truncated
                ))
            }
        }
        return chunks.sorted { $0.route < $1.route }
    }

    private static func relativePath(of url: URL, under root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        return path.hasPrefix(rootPath + "/") ? String(path.dropFirst(rootPath.count + 1)) : url.lastPathComponent
    }

    /// `src/pages/about.astro` → `/about`; `src/pages/index.astro` → `/`;
    /// `src/content/posts/my-trip.mdoc` → `/posts/my-trip`.
    public static func route(forRelativePath relative: String) -> String {
        var path = relative
        for prefix in ["src/pages/", "src/content/"] where path.hasPrefix(prefix) {
            path = String(path.dropFirst(prefix.count))
        }
        path = (path as NSString).deletingPathExtension
        if path == "index" || path.isEmpty { return "/" }
        if path.hasSuffix("/index") { path = String(path.dropLast("/index".count)) }
        return "/" + path
    }

    /// Frontmatter-stripped markdown → readable text: link labels kept (URLs dropped), heading
    /// markers / emphasis / list bullets / code fences removed. Not a markdown renderer. Used for
    /// repurposing prompts (`PostSource.load`'s post body); the copy-audit chunker (`chunks`
    /// above) keeps the raw markdown body instead so model excerpts stay verbatim substrings of
    /// the file on disk (#465 review).
    public static func plainText(markdown body: String) -> String {
        var text = body
        text = text.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^```.*$"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^#{1,6}\s*"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"(?m)^\s*[-*+]\s+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"[*_`]"#, with: "", options: .regularExpression)
        return collapsed(text)
    }

    /// `.astro` source → inline human text: frontmatter fence (via `Frontmatter.body`, the same
    /// fence detection `parse` uses), `<script>`/`<style>` blocks, tags, and `{…}` expressions
    /// removed. A tag-strip extractor, not an HTML parser — the spec's v1 answer to the
    /// "no HTML→text in Core" gap.
    public static func plainText(astro source: String) -> String {
        var text = Frontmatter.body(source)
        for block in ["script", "style"] {
            text = text.replacingOccurrences(
                of: "<\(block)[\\s\\S]*?</\(block)>", with: " ", options: [.regularExpression, .caseInsensitive])
        }
        text = text.replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\{[^}]*\}"#, with: " ", options: .regularExpression)
        return collapsed(text)
    }

    /// Truncates to ``maxChunkCharacters`` (appending an ellipsis) and reports whether it did —
    /// the flag is what lets replies disclose partial coverage rather than trim silently.
    public static func capped(_ text: String) -> (text: String, truncated: Bool) {
        guard text.count > maxChunkCharacters else { return (text, false) }
        return (String(text.prefix(maxChunkCharacters)) + "…", true)
    }

    private static func collapsed(_ text: String) -> String {
        text.replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
