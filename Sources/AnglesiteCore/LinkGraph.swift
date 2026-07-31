import Foundation

/// Pure link-graph analysis over ``SiteKnowledgeIndex`` documents. No embeddings, no actors —
/// reads ``SiteKnowledgeIndex/Document/internalLinks`` to surface structural linking issues.
public enum LinkGraph {
    /// A missing reciprocal link: `sourcePath` is the page that should add a link,
    /// `targetPath` is the page it should link back to.
    public struct ReciprocalGap: Sendable, Equatable, Identifiable {
        /// Stable identity for SwiftUI lists: the `source→target` pair, unique per gap.
        public var id: String { "\(sourcePath)→\(targetPath)" }
        /// Document path of the page that should add the link.
        public let sourcePath: String
        /// Document path of the page it should link back to.
        public let targetPath: String
    }

    /// Summary of a site's internal link structure.
    public struct LinkAnalysis: Sendable {
        /// Pages/posts with no inbound internal links (excluding the index page).
        public let orphanPages: [SiteKnowledgeIndex.Document]
        /// Pairs where A links to B but B does not link back.
        public let reciprocalGaps: [ReciprocalGap]

        /// Inbound link count per document path.
        let inboundCounts: [String: Int]
        /// Outbound link count per document path.
        let outboundCounts: [String: Int]

        /// Pages whose outbound link count exceeds `threshold`.
        public func overLinkedPages(threshold: Int) -> [SiteKnowledgeIndex.Document] {
            overLinkedDocs.filter { (outboundCounts[$0.path] ?? 0) > threshold }
        }

        fileprivate let overLinkedDocs: [SiteKnowledgeIndex.Document]
    }

    /// Analyze the link structure of a set of documents.
    public static func analyze(documents: [SiteKnowledgeIndex.Document]) -> LinkAnalysis {
        let contentDocs = documents.filter { isLinkableKind($0.kind) }
        let routeToPath = buildRouteIndex(contentDocs)

        // Build adjacency: source path → set of target paths
        var outbound: [String: Set<String>] = [:]
        var inboundCounts: [String: Int] = [:]
        for doc in contentDocs {
            inboundCounts[doc.path] = 0
        }
        for doc in contentDocs {
            var targets = Set<String>()
            for link in doc.internalLinks {
                if let normalized = normalizeRoute(link),
                   let targetPath = routeToPath[normalized], targetPath != doc.path {
                    targets.insert(targetPath)
                }
            }
            outbound[doc.path] = targets
            for target in targets {
                inboundCounts[target, default: 0] += 1
            }
        }

        // Orphans: pages/posts with zero inbound links, excluding index
        let orphans = contentDocs.filter { doc in
            (inboundCounts[doc.path] ?? 0) == 0
                && !isIndexPage(doc.path)
        }

        // Reciprocal gaps: A→B exists but B→A does not
        var gaps: [ReciprocalGap] = []
        for doc in contentDocs {
            let myTargets = outbound[doc.path] ?? []
            for target in myTargets {
                let theirTargets = outbound[target] ?? []
                if !theirTargets.contains(doc.path) {
                    // target should link back to doc but doesn't
                    gaps.append(ReciprocalGap(sourcePath: target, targetPath: doc.path))
                }
            }
        }

        let outboundCounts = outbound.mapValues(\.count)

        return LinkAnalysis(
            orphanPages: orphans.sorted { $0.path < $1.path },
            reciprocalGaps: gaps.sorted { ($0.sourcePath, $0.targetPath) < ($1.sourcePath, $1.targetPath) },
            inboundCounts: inboundCounts,
            outboundCounts: outboundCounts,
            overLinkedDocs: contentDocs
        )
    }

    /// Resolves a document's `internalLinks` to the set of document paths it already links to.
    /// Used by `SuggestLinksTool` to filter out already-linked targets.
    public static func existingTargets(
        for document: SiteKnowledgeIndex.Document,
        in documents: [SiteKnowledgeIndex.Document],
        routeIndex: [String: String]? = nil
    ) -> Set<String> {
        let routeToPath = routeIndex ?? buildRouteIndex(documents)
        var targets = Set<String>()
        for link in document.internalLinks {
            if let normalized = normalizeRoute(link),
               let path = routeToPath[normalized] {
                targets.insert(path)
            }
        }
        return targets
    }

    // MARK: - Internal helpers

    private static func isLinkableKind(_ kind: SiteKnowledgeIndex.Document.Kind) -> Bool {
        kind == .page || kind == .post || kind == .content
    }

    private static func isIndexPage(_ path: String) -> Bool {
        path == "src/pages/index.astro" || path == "src/pages/index.md" || path == "src/pages/index.mdx"
    }

    /// Builds a lookup from route (e.g. `/about`) to document path (e.g. `src/pages/about.astro`).
    private static func buildRouteIndex(_ documents: [SiteKnowledgeIndex.Document]) -> [String: String] {
        var index: [String: String] = [:]
        for doc in documents where doc.path.hasPrefix("src/pages/") {
            let route = routeFromPagePath(doc.path)
            index[route] = doc.path
        }
        // Content collection entries: `src/content/posts/foo.md` → `/posts/foo` (Astro convention)
        for doc in documents where doc.path.hasPrefix("src/content/") {
            let route = routeFromContentPath(doc.path)
            index[route] = doc.path
        }
        return index
    }

    /// `src/pages/about.astro` → `/about`, `src/pages/blog/index.astro` → `/blog`.
    /// Mirrors `ContentScanner.routeFromPagePath`.
    static func routeFromPagePath(_ path: String) -> String {
        var r = path
        if r.hasPrefix("src/pages/") { r.removeFirst("src/pages/".count) }
        if let dot = r.lastIndex(of: ".") { r = String(r[r.startIndex..<dot]) }
        if r == "index" { r = "" }
        else if r.hasSuffix("/index") { r.removeLast("index".count) }
        if r.hasSuffix("/") { r.removeLast() }
        return "/" + r
    }

    /// `src/content/posts/hello.md` → `/posts/hello`.
    /// NOTE: This is a heuristic — Astro content-collection routes are determined by the
    /// `[...slug].astro` file path, not the `src/content/` tree. If the slug page lives at
    /// e.g. `src/pages/blog/[...slug].astro`, the served URL is `/blog/hello`, not `/posts/hello`.
    /// A future improvement should resolve routes via ContentGraph's actual served URLs.
    private static func routeFromContentPath(_ path: String) -> String {
        var r = path
        if r.hasPrefix("src/content/") { r.removeFirst("src/content/".count) }
        if let dot = r.lastIndex(of: ".") { r = String(r[r.startIndex..<dot]) }
        return "/" + r
    }

    /// A suggested internal link target with its semantic confidence score.
    public struct LinkSuggestion: Sendable, Equatable, Identifiable {
        /// Stable identity for SwiftUI lists — the target's document path.
        public var id: String { path }
        /// Document path of the suggested target (e.g. `src/pages/about.astro`).
        public let path: String
        /// The target's title, when the knowledge index has one for it.
        public let title: String?
        /// The served route to use as the inserted link's href (e.g. `/about`).
        public let route: String
        /// Normalized confidence in 0…1 (min-max over the candidate set).
        public let confidence: Float
    }

    /// Returns suggested link targets for a document, ranked by semantic similarity,
    /// excluding pages the document already links to and itself. Confidence is min-max
    /// normalized over the candidate set into 0…1.
    public static func suggestLinks(
        forDocumentAt path: String,
        in documents: [SiteKnowledgeIndex.Document],
        rankedRelated: [SemanticRanker.Ranked],
        limit: Int = 8
    ) -> [LinkSuggestion] {
        guard let source = documents.first(where: { $0.path == path }) else { return [] }
        let index = buildRouteIndex(documents)
        let alreadyLinked = existingTargets(for: source, in: documents, routeIndex: index)
        let docsByID = Dictionary(documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        let eligible = rankedRelated.compactMap { ranked -> (SiteKnowledgeIndex.Document, Float)? in
            guard let target = docsByID[ranked.docID],
                  target.path != path,
                  !alreadyLinked.contains(target.path),
                  isLinkableKind(target.kind),
                  ranked.score > 0.1
            else { return nil }
            return (target, ranked.score)
        }

        let top = Array(eligible.prefix(max(0, limit)))
        guard !top.isEmpty else { return [] }

        let scores = top.map(\.1)
        let lo = scores.min() ?? 0
        let hi = scores.max() ?? 1
        let range = hi - lo

        return top.map { target, score in
            let normalized = range > 0 ? (score - lo) / range : 1.0
            let route = target.path.hasPrefix("src/pages/")
                ? routeFromPagePath(target.path)
                : routeFromContentPath(target.path)
            return LinkSuggestion(path: target.path, title: target.title, route: route, confidence: normalized)
        }
    }

    /// Normalizes a link href for lookup: strips trailing slash, fragment, query.
    /// Returns `nil` for relative paths (`./`, `../`) that can't be resolved without
    /// the source file's directory context.
    static func normalizeRoute(_ href: String) -> String? {
        var r = href
        // Strip fragment and query
        if let hash = r.firstIndex(of: "#") { r = String(r[r.startIndex..<hash]) }
        if let q = r.firstIndex(of: "?") { r = String(r[r.startIndex..<q]) }
        // Normalize trailing slash
        if r.count > 1 && r.hasSuffix("/") { r.removeLast() }
        // Handle relative paths: only absolute routes are matched.
        // Relative `./` and `../` links are dropped (they'd need the source file's
        // directory context to resolve, which is a follow-up enhancement).
        if r.hasPrefix("./") || r.hasPrefix("../") { return nil }
        return r
    }
}
