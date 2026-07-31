import Foundation

/// Native port of the plugin's `server/list-content.mjs` (Bucket 1, #275).
///
/// Scans a site's `Source/` directory — `src/pages/`, the article-like collections under
/// `src/content/`, and `public/images/` — into a `ContentListing`, replacing the `list_content`
/// MCP round-trip in a container-backed runtime. The scan is read-only; the
/// filesystem is the source of truth.
///
/// Unlike the Node tool (whose JSON payload is site-agnostic and stamped by `ContentListing.parse`),
/// this builds the site-scoped `SiteContentGraph` structs directly, stamping `siteID` inline.
/// Directory entries are visited in sorted order so the listing is deterministic.
public enum ContentScanner {

    /// Page source extensions that map to a navigable route.
    private static let pageExtensions: Set<String> = [".astro", ".md", ".mdx", ".markdown", ".html"]
    /// Content-collection entry extensions (Astro content layer glob: mdoc, mdx, md).
    private static let entryExtensions: Set<String> = [".md", ".mdx", ".mdoc", ".markdown"]
    /// Raster/vector image extensions surfaced from `public/images/`.
    private static let imageExtensions: Set<String> = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]
    /// Collections whose entries can fit today's `SiteContentGraph.Post` shape well enough for
    /// navigator/search. Typed editors can grow a richer graph later; for now registry-backed
    /// collection entries still deserve to appear after File > New > Collection creates them.
    private static let articleCollections = Array(Set(
        ["posts", "blog", "notes", "episodes", "experiments"]
        + ContentTypeRegistry.builtIns.compactMap(\.collection)
    )).sorted()

    /// Walks the site once and builds the full listing, also resolving each image's
    /// `usedOnPages` via `DeadAssetScanner.referencedPaths` in the same pass so orphaned images
    /// can be flagged without a second walk. Synchronous, blocking filesystem I/O — callers run
    /// it off the main actor (see ``SiteContentGraph/rescan(siteID:projectRoot:)``).
    public static func scan(projectRoot: URL, siteID: String) -> ContentListing {
        let referencedPaths = DeadAssetScanner.referencedPaths(projectRoot: projectRoot)
        return ContentListing(
            pages: scanPages(projectRoot, siteID: siteID),
            posts: scanPosts(projectRoot, siteID: siteID),
            images: scanImages(projectRoot, siteID: siteID, referencedPaths: referencedPaths)
        )
    }

    // MARK: - Pages

    private static func scanPages(_ projectRoot: URL, siteID: String) -> [SiteContentGraph.Page] {
        let pagesDir = projectRoot.appendingPathComponent("src/pages")
        var out: [SiteContentGraph.Page] = []
        for abs in walk(pagesDir) {
            let relPosix = relativePosix(abs, from: projectRoot)
            // Skip dynamic routes (`[slug]`, `[...rest]`) — templates, not concrete pages.
            if relPosix.contains("[") { continue }
            if !pageExtensions.contains(fileExtension(abs)) { continue }
            let route = routeFromPagePath(relPosix)
            out.append(SiteContentGraph.Page(
                id: "\(siteID):page:\(route)",
                siteID: siteID,
                route: route,
                filePath: relPosix,
                title: pageTitle(abs),
                lastModified: mtime(abs)
            ))
        }
        return out
    }

    /// `src/pages/index.astro` → `/`, `src/pages/blog/index.astro` → `/blog`, `…/about.astro` → `/about`.
    static func routeFromPagePath(_ relPosix: String) -> String {
        var r = relPosix
        if r.hasPrefix("src/pages/") { r.removeFirst("src/pages/".count) }
        if let dot = r.lastIndex(of: ".") { r = String(r[r.startIndex..<dot]) }  // strip final extension
        // Drop a trailing `index` segment (`(^|/)index$`), keeping the preceding slash.
        if r == "index" {
            r = ""
        } else if r.hasSuffix("/index") {
            r.removeLast("index".count)
        }
        if r.hasSuffix("/") { r.removeLast() }
        return "/" + r
    }

    /// Best-effort page title: frontmatter `title`, else the `title="…"`/`title='…'` prop, else nil.
    private static func pageTitle(_ abs: URL) -> String? {
        guard let text = try? String(contentsOf: abs, encoding: .utf8) else { return nil }
        if case let .string(t)? = Frontmatter.parse(text)[ "title" ], !t.isEmpty { return t }
        return firstTitleAttribute(in: text)
    }

    /// Port of `/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/` — the first `title="…"` or `title='…'`.
    private static let titleAttrRegex = try! NSRegularExpression(
        pattern: #"\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')"#
    )
    private static func firstTitleAttribute(in text: String) -> String? {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let m = titleAttrRegex.firstMatch(in: text, range: range) else { return nil }
        for group in [1, 2] {
            if let r = Range(m.range(at: group), in: text) {
                return decodeHTMLEntities(String(text[r]))
            }
        }
        return nil
    }

    /// Decode exactly the five HTML entities emitted by `PageTitleEditor.attrEscaped(_:delimiter:)`.
    /// `&amp;` is decoded last so that `&amp;lt;` becomes `&lt;` rather than `<`.
    private static func decodeHTMLEntities(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;",   with: "<")
         .replacingOccurrences(of: "&gt;",   with: ">")
         .replacingOccurrences(of: "&quot;", with: "\"")
         .replacingOccurrences(of: "&#39;",  with: "'")
         .replacingOccurrences(of: "&amp;",  with: "&")
    }

    // MARK: - Posts

    private static func scanPosts(_ projectRoot: URL, siteID: String) -> [SiteContentGraph.Post] {
        let contentDir = projectRoot.appendingPathComponent("src/content")
        var out: [SiteContentGraph.Post] = []
        for collection in articleCollections {
            let dir = contentDir.appendingPathComponent(collection)
            for abs in walk(dir) {
                if !entryExtensions.contains(fileExtension(abs)) { continue }
                let relPosix = relativePosix(abs, from: projectRoot)
                let fm = readFrontmatter(abs)
                let slug = stringField(fm, "slug") ?? basenameWithoutExtension(abs)
                let title = stringField(fm, "title")
                    ?? stringField(fm, "name")
                    ?? stringField(fm, "itemReviewed")
                    ?? slug
                let tags: [String]
                if case let .array(t)? = fm["tags"] { tags = t } else { tags = [] }
                out.append(SiteContentGraph.Post(
                    id: "\(siteID):post:\(slug)",
                    siteID: siteID,
                    collection: collection,
                    slug: slug,
                    title: title,
                    draft: fm["draft"] == .bool(true),
                    publishDate: parseDate(stringField(fm, "publishDate") ?? stringField(fm, "date")),
                    tags: tags,
                    filePath: relPosix,
                    lastModified: mtime(abs)
                ))
            }
        }
        return out
    }

    // MARK: - Images

    private static func scanImages(
        _ projectRoot: URL, siteID: String, referencedPaths: [String: Set<String>]
    ) -> [SiteContentGraph.Image] {
        let imagesDir = projectRoot.appendingPathComponent("public/images")
        var out: [SiteContentGraph.Image] = []
        for abs in walk(imagesDir) {
            if !imageExtensions.contains(fileExtension(abs)) { continue }
            let relPosix = relativePosix(abs, from: projectRoot)
            let usedOnPages = (referencedPaths[relPosix.lowercased()] ?? []).sorted()
            out.append(SiteContentGraph.Image(
                id: "\(siteID):image:\(relPosix)",
                siteID: siteID,
                relativePath: relPosix,
                fileName: abs.lastPathComponent,
                byteSize: fileSize(abs),
                usedOnPages: usedOnPages,
                lastModified: mtime(abs)
            ))
        }
        return out
    }

    // MARK: - Frontmatter helpers

    private static func readFrontmatter(_ abs: URL) -> [String: FrontmatterValue] {
        guard let text = try? String(contentsOf: abs, encoding: .utf8) else { return [:] }
        return Frontmatter.parse(text)
    }

    private static func stringField(_ fm: [String: FrontmatterValue], _ key: String) -> String? {
        if case let .string(s)? = fm[key], !s.isEmpty { return s }
        return nil
    }

    /// Parse a frontmatter date the way `new Date(value).toISOString()` would for the realistic
    /// inputs: a date-only `YYYY-MM-DD` (UTC midnight) or a full ISO-8601 timestamp. Anything else
    /// (or nil) → nil, matching `dateISO` returning null for unparseable values.
    static func parseDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        if let date = isoFractional.date(from: value) ?? isoPlain.date(from: value) { return date }
        return dateOnlyFormatter.date(from: value)
    }

    // MARK: - Filesystem helpers

    /// Recursively collect files under `dir` in sorted order. Missing dir → empty.
    private static func walk(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: []
        ) else { return [] }
        var files: [URL] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir == true {
                files.append(contentsOf: walk(entry))
            } else {
                files.append(entry)
            }
        }
        return files
    }

    /// POSIX path of `url` relative to `base` (forward slashes, no leading slash).
    private static func relativePosix(_ url: URL, from base: URL) -> String {
        let urlComponents = url.standardizedFileURL.pathComponents
        let baseComponents = base.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: baseComponents) else { return url.path }
        return urlComponents.dropFirst(baseComponents.count).joined(separator: "/")
    }

    /// Lowercased extension including the leading dot (e.g. `.astro`), or `""` if none.
    private static func fileExtension(_ url: URL) -> String {
        let ext = url.pathExtension
        return ext.isEmpty ? "" : "." + ext.lowercased()
    }

    private static func basenameWithoutExtension(_ url: URL) -> String {
        url.deletingPathExtension().lastPathComponent
    }

    private static func mtime(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
            ?? Date(timeIntervalSince1970: 0)
    }

    private static func fileSize(_ url: URL) -> Int64? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return nil }
        return Int64(size)
    }

    // MARK: - Date formatters

    private nonisolated(unsafe) static let isoPlain = ISO8601DateFormatter()
    private nonisolated(unsafe) static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let dateOnlyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

extension SiteContentGraph {
    /// Scans `projectRoot` off the main actor and loads the result for `siteID` — the shared
    /// "keep me in sync with disk" glue both `ContentCreationWorkflow`'s post-mutation rescan
    /// and `SiteWindowModel`'s site-open scan (#660) need, kept off the actor itself per its
    /// documented "no I/O surface" invariant.
    ///
    /// Returns `false` without touching `siteID`'s existing state if `projectRoot` can't even be
    /// listed — a stale/revoked security-scoped bookmark, a deleted or unmounted directory — so
    /// `isPopulated` never lies about "scanned and empty" when the scan never actually ran.
    ///
    /// Claims a scan generation (#666) before the filesystem walk starts, so a slower rescan
    /// racing against a faster, newer one from another call site (`ContentCreationWorkflow`'s
    /// post-mutation rescan) never clobbers the newer result.
    @discardableResult
    public func rescan(siteID: String, projectRoot: URL) async -> Bool {
        let generation = beginScan(siteID: siteID)
        let listing = await Task.detached(priority: .utility) { () async -> ContentListing? in
            guard (try? FileManager.default.contentsOfDirectory(atPath: projectRoot.path)) != nil else {
                await LogCenter.shared.append(
                    source: "content-graph:\(siteID)", stream: .stderr,
                    text: "Couldn't list \(projectRoot.path) — leaving the content graph unpopulated "
                        + "for this scan (stale bookmark, or the directory is missing/unmounted?)"
                )
                return nil
            }
            return ContentScanner.scan(projectRoot: projectRoot, siteID: siteID)
        }.value
        guard let listing else { return false }
        await load(
            siteID: siteID,
            pages: listing.pages,
            posts: listing.posts,
            images: listing.images,
            generation: generation
        )
        return true
    }
}
