import Foundation

/// What a ``SiteGraphNode`` represents in the Astro project. Case order is meaningful: it is the
/// display rank ``SiteGraphExplorer/build(projectRoot:siteID:pages:posts:images:fileManager:)``
/// sorts the snapshot's nodes by (via `allCases`), so pages lead and styles trail in the
/// explorer's list.
public enum SiteGraphNodeKind: String, Sendable, CaseIterable, Identifiable {
    /// A routable page under `src/pages/`.
    case page
    /// A layout under `src/layouts/` — reached via ``SiteGraphEdgeKind/usesLayout`` edges.
    case layout
    /// A reusable component under `src/components/`.
    case component
    /// A content collection (e.g. `src/content/posts`) — a grouping with no file of its own, so
    /// its node has a `nil` `filePath`.
    case collection
    /// One entry inside a content collection (a markdown post, note, etc.).
    case contentEntry
    /// An image or other static asset, whether under `src/` or `public/`.
    case asset
    /// A stylesheet under `src/styles/`.
    case style

    /// `Identifiable` via the raw value so SwiftUI lists and pickers can key on the kind directly.
    public var id: String { rawValue }
}

/// The relationship a ``SiteGraphEdge`` records, source → target. Distinguished so
/// `ImpactAnalysis` and the explorer UI can weigh a layout dependency differently from a plain
/// import or an asset reference.
public enum SiteGraphEdgeKind: String, Sendable, CaseIterable, Identifiable {
    /// Source imports the target (static `import`/`export … from` or dynamic `import()`).
    case imports
    /// Source renders through the target layout — via an import whose target is a
    /// ``SiteGraphNodeKind/layout``, or a markdown frontmatter `layout:` field (#309).
    case usesLayout
    /// Source references the target asset (`src=`/`href=` attribute, CSS `url()`, or an import
    /// resolving to an asset file).
    case referencesAsset
    /// A collection node contains the target content entry.
    case contains

    /// `Identifiable` via the raw value so SwiftUI lists and pickers can key on the kind directly.
    public var id: String { rawValue }
}

/// One file, content entry, or collection in the Site Graph Explorer's dependency graph. A plain
/// value: nodes are built once per snapshot by ``SiteGraphExplorer`` and never mutated, so the
/// UI, ``ImpactAnalysis``, and ``SiteGraphAugmentedAssistant`` can all share them freely.
public struct SiteGraphNode: Sendable, Equatable, Identifiable {
    /// Stable identity within one site's graph. Reuses `SiteContentGraph` IDs for pages/posts/
    /// images so selection survives a rebuild; synthesized (`<siteID>:file:<path>`,
    /// `<siteID>:collection:<name>`) for nodes only this explorer discovers.
    public let id: String
    /// What the node represents — drives its icon, its sort rank, and which edge kinds point at it.
    public let kind: SiteGraphNodeKind
    /// Human-readable name shown in the explorer: a page's title, a file's name, a collection's
    /// name. Never empty (falls back to the route or filename).
    public let title: String
    /// Secondary display line (a route, a relative path, a `collection/slug` pair) — purely
    /// informational, distinct from `filePath` which is machine-resolvable.
    public let detail: String?
    /// Project-relative POSIX path of the backing file, or `nil` for nodes with no single file
    /// (a ``SiteGraphNodeKind/collection``) — which is why citations and "open file" actions must
    /// treat it as optional.
    public let filePath: String?
    /// The public URL path this node renders at, when it is routable (pages and content entries);
    /// `nil` for everything that only exists at build time.
    public let route: String?
    /// Incoming-edge count, precomputed by ``SiteGraphExplorer`` so list rows can show "used by
    /// N" without each walking the full edge set.
    public let referencedByCount: Int

    /// Memberwise initializer. `referencedByCount` defaults to `0` because only
    /// ``SiteGraphExplorer``'s final pass knows the real count — intermediate construction (and
    /// most tests) build nodes before edges exist.
    public init(
        id: String,
        kind: SiteGraphNodeKind,
        title: String,
        detail: String?,
        filePath: String?,
        route: String?,
        referencedByCount: Int = 0
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.filePath = filePath
        self.route = route
        self.referencedByCount = referencedByCount
    }
}

/// A directed dependency between two ``SiteGraphNode``s: source depends on target.
public struct SiteGraphEdge: Sendable, Equatable, Identifiable {
    /// Derived as `"<sourceID>-><targetID>:<kind>"` — deterministic, so the same dependency
    /// discovered twice (e.g. an asset referenced from two attributes in one file) collapses to
    /// one edge when keyed by `id`, which is exactly how ``SiteGraphExplorer`` dedups.
    public let id: String
    /// The depending node's ``SiteGraphNode/id``.
    public let sourceID: String
    /// The depended-upon node's ``SiteGraphNode/id``.
    public let targetID: String
    /// The relationship this edge records — see ``SiteGraphEdgeKind``.
    public let kind: SiteGraphEdgeKind

    /// Builds the edge, deriving ``id`` from the three inputs — there is no way to supply an
    /// arbitrary id, keeping the dedup-by-id invariant above unbreakable.
    public init(sourceID: String, targetID: String, kind: SiteGraphEdgeKind) {
        self.sourceID = sourceID
        self.targetID = targetID
        self.kind = kind
        self.id = "\(sourceID)->\(targetID):\(kind.rawValue)"
    }
}

/// An immutable snapshot of one site's whole dependency graph. `Equatable` so observers (the
/// explorer UI, chat grounding) can cheaply skip work when a rebuild produced an identical graph.
public struct SiteGraphExplorerSnapshot: Sendable, Equatable {
    /// All nodes, in the builder's stable order (by kind rank, then localized title) — consumers
    /// can render directly without re-sorting.
    public let nodes: [SiteGraphNode]
    /// All edges, sorted by ``SiteGraphEdge/id`` for deterministic equality across rebuilds.
    public let edges: [SiteGraphEdge]

    /// Memberwise initializer; performs no validation, so callers (tests especially) can build
    /// arbitrary graphs, including edges whose endpoints aren't in `nodes`.
    public init(nodes: [SiteGraphNode], edges: [SiteGraphEdge]) {
        self.nodes = nodes
        self.edges = edges
    }
}

/// Builds the Site Graph Explorer's dependency graph for an Astro project by static analysis —
/// no dev server or Astro build involved, so it works on any checkout, at the cost of the
/// heuristics being lexical (regex/prefix-based import, `src=`/`href=`, and `url()` scanning)
/// rather than a real module resolution.
public enum SiteGraphExplorer {
    private static let sourceExtensions: Set<String> = [
        ".astro", ".md", ".mdx", ".markdown", ".js", ".jsx", ".ts", ".tsx", ".css"
    ]
    private static let assetExtensions: Set<String> = [
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"
    ]
    private static let dynamicImportRegex = try! NSRegularExpression(
        pattern: #"import\(\s*['"]([^'"]+)['"]\s*\)"#
    )
    private static let srcHrefRegex = try! NSRegularExpression(
        pattern: #"\b(?:src|href)\s*=\s*["']([^"']+\.(?:jpg|jpeg|png|webp|gif|svg|avif))(?:[?#][^"']*)?["']"#,
        options: [.caseInsensitive]
    )
    private static let urlAssetRegex = try! NSRegularExpression(
        pattern: #"url\(\s*['"]?([^'")]+\.(?:jpg|jpeg|png|webp|gif|svg|avif))(?:[?#][^'")]*)?['"]?\s*\)"#,
        options: [.caseInsensitive]
    )

    /// Builds a full graph snapshot from the already-parsed content model plus a fresh disk scan.
    ///
    /// Seeding from ``SiteContentGraph``'s pages/posts/images (rather than re-deriving them from
    /// disk) keeps node IDs identical to the rest of the app, so selection and navigation carry
    /// over; the walk then only adds what the content graph doesn't track — layouts, components,
    /// styles, and stray assets. Every node's `referencedByCount` is filled in from the final
    /// edge set in a last pass, which is why nodes are rebuilt at the end.
    ///
    /// Synchronous and file-system-bound: it reads every source file's text to extract imports
    /// and asset references, so call it off the main actor for non-trivial sites.
    ///
    /// - Parameters:
    ///   - projectRoot: The site's Astro project root (the package's `Source/` directory).
    ///   - siteID: Namespaces synthesized node IDs so snapshots from different sites can never
    ///     collide.
    ///   - pages: The content model's routable pages, adopted as ``SiteGraphNodeKind/page`` nodes.
    ///   - posts: The content model's collection entries; their collections become synthetic
    ///     ``SiteGraphNodeKind/collection`` nodes with ``SiteGraphEdgeKind/contains`` edges.
    ///   - images: The content model's known images, adopted as ``SiteGraphNodeKind/asset`` nodes.
    ///   - fileManager: Injectable for tests that stage fixture trees.
    /// - Returns: A deterministic snapshot — stable node and edge ordering — for cheap
    ///   equality-based change detection.
    public static func build(
        projectRoot: URL,
        siteID: String,
        pages: [SiteContentGraph.Page],
        posts: [SiteContentGraph.Post],
        images: [SiteContentGraph.Image],
        fileManager: FileManager = .default
    ) -> SiteGraphExplorerSnapshot {
        var nodesByID: [String: SiteGraphNode] = [:]
        var edgesByID: [String: SiteGraphEdge] = [:]
        var nodeIDByRelativePath: [String: String] = [:]
        var nodeIDByPublicPath: [String: String] = [:]

        func addNode(_ node: SiteGraphNode) {
            nodesByID[node.id] = node
            if let filePath = node.filePath {
                nodeIDByRelativePath[filePath] = node.id
                if filePath.hasPrefix("public/") {
                    nodeIDByPublicPath["/" + String(filePath.dropFirst("public".count + 1))] = node.id
                }
            }
        }

        for page in pages {
            addNode(SiteGraphNode(
                id: page.id,
                kind: .page,
                title: page.title ?? page.route,
                detail: page.route,
                filePath: page.filePath,
                route: page.route
            ))
        }

        let collections = Dictionary(grouping: posts, by: \.collection)
        for collection in collections.keys.sorted() {
            let collectionID = "\(siteID):collection:\(collection)"
            addNode(SiteGraphNode(
                id: collectionID,
                kind: .collection,
                title: collection,
                detail: "src/content/\(collection)",
                filePath: nil,
                route: nil
            ))
        }
        for post in posts {
            let edge = SiteGraphEdge(
                sourceID: "\(siteID):collection:\(post.collection)",
                targetID: post.id,
                kind: .contains
            )
            addNode(SiteGraphNode(
                id: post.id,
                kind: .contentEntry,
                title: post.title,
                detail: "\(post.collection)/\(post.slug)",
                filePath: post.filePath,
                route: postRoute(for: post)
            ))
            edgesByID[edge.id] = edge
        }

        for image in images {
            addNode(SiteGraphNode(
                id: image.id,
                kind: .asset,
                title: image.fileName,
                detail: image.relativePath,
                filePath: image.relativePath,
                route: nil
            ))
        }

        for file in walk(projectRoot, fileManager: fileManager) {
            let relativePath = relativePosix(file, from: projectRoot)
            guard nodesByID[nodeIDByRelativePath[relativePath] ?? ""] == nil else { continue }
            let ext = fileExtension(file)
            let nodeKind: SiteGraphNodeKind?
            if sourceExtensions.contains(ext) {
                nodeKind = kind(for: relativePath)
            } else if assetExtensions.contains(ext) {
                nodeKind = .asset
            } else {
                nodeKind = nil
            }
            guard let kind = nodeKind else { continue }
            addNode(SiteGraphNode(
                id: "\(siteID):file:\(relativePath)",
                kind: kind,
                title: file.lastPathComponent,
                detail: relativePath,
                filePath: relativePath,
                route: nil
            ))
        }

        let sourceNodes = nodesByID.values
            .filter { $0.filePath != nil && $0.kind != .asset && $0.kind != .collection }
        for node in sourceNodes {
            guard let filePath = node.filePath else { continue }
            let fileURL = projectRoot.appendingPathComponent(filePath)
            guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { continue }
            for specifier in importSpecifiers(in: text) {
                guard let targetID = resolveImport(
                    specifier,
                    from: filePath,
                    projectRoot: projectRoot,
                    nodeIDByRelativePath: nodeIDByRelativePath,
                    nodeIDByPublicPath: nodeIDByPublicPath,
                    fileManager: fileManager
                ) else { continue }
                let targetKind = nodesByID[targetID]?.kind
                let edgeKind: SiteGraphEdgeKind
                if targetKind == .layout {
                    edgeKind = .usesLayout
                } else if targetKind == .asset {
                    edgeKind = .referencesAsset
                } else {
                    edgeKind = .imports
                }
                let edge = SiteGraphEdge(sourceID: node.id, targetID: targetID, kind: edgeKind)
                edgesByID[edge.id] = edge
            }
            for assetPath in assetReferences(in: text) {
                guard let targetID = resolveAssetReference(
                    assetPath,
                    from: filePath,
                    nodeIDByRelativePath: nodeIDByRelativePath,
                    nodeIDByPublicPath: nodeIDByPublicPath
                ) else { continue }
                let edge = SiteGraphEdge(sourceID: node.id, targetID: targetID, kind: .referencesAsset)
                edgesByID[edge.id] = edge
            }
            // Markdown pages/entries reference their layout through the frontmatter `layout:`
            // field, not an import statement — without this, editing a layout under-reports its
            // impact on markdown content (#309). Markdown-ish files only: an `.astro` frontmatter
            // block is JS, not YAML, and must not go through the YAML parser.
            if isMarkdownPath(filePath) {
                let frontmatter = Frontmatter.parse(text)
                if case .string(let layoutRef)? = frontmatter["layout"],
                   let targetID = resolveImport(
                       layoutRef,
                       from: filePath,
                       projectRoot: projectRoot,
                       nodeIDByRelativePath: nodeIDByRelativePath,
                       nodeIDByPublicPath: nodeIDByPublicPath,
                       fileManager: fileManager
                   ) {
                    let kind: SiteGraphEdgeKind =
                        nodesByID[targetID]?.kind == .layout ? .usesLayout : .imports
                    let edge = SiteGraphEdge(sourceID: node.id, targetID: targetID, kind: kind)
                    edgesByID[edge.id] = edge
                }
            }
        }

        let incomingCounts = Dictionary(grouping: edgesByID.values, by: \.targetID)
            .mapValues(\.count)
        let nodes = nodesByID.values.map { node in
            SiteGraphNode(
                id: node.id,
                kind: node.kind,
                title: node.title,
                detail: node.detail,
                filePath: node.filePath,
                route: node.route,
                referencedByCount: incomingCounts[node.id, default: 0]
            )
        }
        return SiteGraphExplorerSnapshot(
            nodes: nodes.sorted { lhs, rhs in
                if lhs.kind == rhs.kind { return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending }
                return kindRank(lhs.kind) < kindRank(rhs.kind)
            },
            edges: edgesByID.values.sorted { $0.id < $1.id }
        )
    }

    private static func kindRank(_ kind: SiteGraphNodeKind) -> Int {
        SiteGraphNodeKind.allCases.firstIndex(of: kind) ?? Int.max
    }

    private static let markdownExtensions: Set<String> = [".md", ".mdx", ".mdoc", ".markdown"]

    private static func isMarkdownPath(_ relativePath: String) -> Bool {
        markdownExtensions.contains(fileExtension(relativePath))
    }

    private static func kind(for relativePath: String) -> SiteGraphNodeKind? {
        if relativePath.hasPrefix("src/layouts/") { return .layout }
        if relativePath.hasPrefix("src/components/") { return .component }
        if relativePath.hasPrefix("src/styles/") { return .style }
        return nil
    }

    private static func importSpecifiers(in text: String) -> [String] {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        let staticImports = text.split(separator: "\n").compactMap(staticImportSpecifier)
        let dynamicImports = dynamicImportRegex.matches(in: text, range: range).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }
        return staticImports + dynamicImports
    }

    private static func staticImportSpecifier(in line: Substring) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("import ") || trimmed.hasPrefix("export ") else { return nil }
        let searchStart: String.SubSequence
        if let fromRange = trimmed.range(of: " from ") {
            searchStart = trimmed[fromRange.upperBound...]
        } else {
            searchStart = trimmed[trimmed.startIndex...]
        }
        guard let quote = searchStart.first(where: { $0 == "\"" || $0 == "'" }) else { return nil }
        guard let open = searchStart.firstIndex(of: quote) else { return nil }
        let afterOpen = searchStart.index(after: open)
        guard let close = searchStart[afterOpen...].firstIndex(of: quote) else { return nil }
        return String(searchStart[afterOpen..<close])
    }

    private static func assetReferences(in text: String) -> [String] {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        let regexes = [srcHrefRegex, urlAssetRegex]
        return regexes.flatMap { regex in
            regex.matches(in: text, range: range).compactMap { match in
                guard let found = Range(match.range(at: 1), in: text) else { return nil }
                let value = String(text[found])
                return value
            }
        }
    }

    private static func resolveAssetReference(
        _ value: String,
        from relativePath: String,
        nodeIDByRelativePath: [String: String],
        nodeIDByPublicPath: [String: String]
    ) -> String? {
        if value.hasPrefix("//") {
            return nil
        }
        if value.hasPrefix("/") {
            return nodeIDByPublicPath[value]
        }
        if value.hasPrefix("public/") {
            return nodeIDByPublicPath["/" + String(value.dropFirst("public".count + 1))]
        }
        if !value.contains("://") && !value.hasPrefix("#") {
            let base = (relativePath as NSString).deletingLastPathComponent
            return nodeIDByRelativePath[normalizeRelativePath((base as NSString).appendingPathComponent(value))]
        }
        return nil
    }

    private static func resolveImport(
        _ specifier: String,
        from relativePath: String,
        projectRoot: URL,
        nodeIDByRelativePath: [String: String],
        nodeIDByPublicPath: [String: String],
        fileManager: FileManager
    ) -> String? {
        if specifier.hasPrefix("/") {
            return nodeIDByPublicPath[specifier]
        }
        var candidate: String
        if specifier.hasPrefix("@/") {
            candidate = "src/" + String(specifier.dropFirst(2))
        } else if specifier.hasPrefix("./") || specifier.hasPrefix("../") {
            let base = (relativePath as NSString).deletingLastPathComponent
            candidate = normalizeRelativePath((base as NSString).appendingPathComponent(specifier))
        } else {
            return nil
        }
        for path in candidatePaths(candidate, projectRoot: projectRoot, fileManager: fileManager) {
            if let id = nodeIDByRelativePath[path] { return id }
        }
        return nil
    }

    private static func normalizeRelativePath(_ path: String) -> String {
        var output: [String] = []
        for component in path.split(separator: "/", omittingEmptySubsequences: false) {
            switch component {
            case "", ".":
                continue
            case "..":
                if !output.isEmpty { output.removeLast() }
            default:
                output.append(String(component))
            }
        }
        return output.joined(separator: "/")
    }

    private static func candidatePaths(
        _ path: String,
        projectRoot: URL,
        fileManager: FileManager
    ) -> [String] {
        if !fileExtension(path).isEmpty { return [path] }
        let extensions = [".astro", ".md", ".mdx", ".js", ".jsx", ".ts", ".tsx", ".css"]
        var candidates = extensions.map { path + $0 }
        candidates += extensions.map { path + "/index" + $0 }
        return candidates.filter {
            fileManager.fileExists(atPath: projectRoot.appendingPathComponent($0).path(percentEncoded: false))
        }
    }

    private static func walk(_ dir: URL, fileManager: FileManager) -> [URL] {
        guard let enumerator = fileManager.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [URL] = []
        for case let url as URL in enumerator {
            let name = url.lastPathComponent
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                if ["node_modules", "dist", ".astro", ".git"].contains(name) {
                    enumerator.skipDescendants()
                }
                continue
            }
            files.append(url)
        }
        return files
    }

    private static func relativePosix(_ url: URL, from base: URL) -> String {
        let urlComponents = url.standardizedFileURL.pathComponents
        let baseComponents = base.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: baseComponents) else { return url.path }
        return urlComponents.dropFirst(baseComponents.count).joined(separator: "/")
    }

    private static func fileExtension(_ path: String) -> String {
        let ext = (path as NSString).pathExtension
        return ext.isEmpty ? "" : "." + ext.lowercased()
    }

    private static func fileExtension(_ url: URL) -> String {
        fileExtension(url.path)
    }
}
