import Foundation
import AnglesiteSiteModel

/// Curated, group-oriented view of a site's filesystem-backed parts for the Site Navigator.
/// Pages/Posts are sourced from `SiteContentGraph`, not here — this scanner covers only the
/// Components, Styles, and Metadata groups.
///
/// Roots are resolved adaptively: an `.anglesite` package (#242) exposes `Source/` and `Config/`;
/// a plain directory (the current pre-package layout) is treated as the project root directly.
public enum FileGroup: String, Sendable, CaseIterable {
    case pages, posts, collections, components, styles, metadata
}

public struct FileRef: Sendable, Equatable, Identifiable {
    public var id: String { url.path(percentEncoded: false) }
    public let url: URL
    public let group: FileGroup
    public let name: String

    public init(url: URL, group: FileGroup, name: String) {
        self.url = url
        self.group = group
        self.name = name
    }
}

public enum SiteFileTree {
    public struct Layout: Sendable, Equatable {
        public let sourceDir: URL
        public let configDir: URL?
        public let infoPlist: URL?
    }

    /// Directory names never descended into or listed.
    private static let excludedDirNames: Set<String> = ["node_modules", "dist", ".astro", ".git"]
    private static let excludedFileNames: Set<String> = [".DS_Store"]

    public static func layout(for siteRoot: URL, fileManager: FileManager = .default) -> Layout {
        if AnglesitePackage.isPackage(at: siteRoot, fileManager: fileManager) {
            let pkg = AnglesitePackage(url: siteRoot)
            return Layout(sourceDir: pkg.sourceURL, configDir: pkg.configURL, infoPlist: pkg.infoPlistURL)
        }
        return Layout(sourceDir: siteRoot, configDir: nil, infoPlist: nil)
    }

    public static func scan(siteRoot: URL, fileManager: FileManager = .default) -> [FileGroup: [FileRef]] {
        let layout = layout(for: siteRoot, fileManager: fileManager)
        var result: [FileGroup: [FileRef]] = [:]

        // Components: layouts + components dirs under src/.
        let componentDirs = ["src/layouts", "src/components"].map { layout.sourceDir.appendingPathComponent($0) }
        let components = componentDirs.flatMap { files(in: $0, group: .components, fileManager: fileManager) }
        if !components.isEmpty { result[.components] = components.sorted { $0.name < $1.name } }

        // Styles: src/styles.
        let styles = files(in: layout.sourceDir.appendingPathComponent("src/styles"),
                           group: .styles, fileManager: fileManager)
        if !styles.isEmpty { result[.styles] = styles.sorted { $0.name < $1.name } }

        // Metadata: everything in Config/ plus the package Info.plist marker.
        var metadata: [FileRef] = []
        if let configDir = layout.configDir {
            metadata += files(in: configDir, group: .metadata, fileManager: fileManager)
        }
        if let infoPlist = layout.infoPlist, fileManager.fileExists(atPath: infoPlist.path(percentEncoded: false)) {
            metadata.append(FileRef(url: infoPlist, group: .metadata, name: infoPlist.lastPathComponent))
        }
        if !metadata.isEmpty { result[.metadata] = metadata.sorted { $0.name < $1.name } }

        return result
    }

    /// Collections that ship a per-collection RSS route. The template materializes
    /// `src/pages/<collection>/rss.xml.ts` for every feed-bearing collection (its
    /// `FEED_COLLECTIONS` map in src/lib/feeds.ts), so a shallow one-level probe is the cheapest
    /// reliable "this directory has a feed" signal (#714). The root-level site-wide feed is not a
    /// collection and is ignored.
    public static func feedCollections(siteRoot: URL, fileManager: FileManager = .default) -> Set<String> {
        let pagesDir = layout(for: siteRoot, fileManager: fileManager)
            .sourceDir.appendingPathComponent("src/pages")
        guard let children = try? fileManager.contentsOfDirectory(
            at: pagesDir, includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]) else { return [] }
        var result: Set<String> = []
        for dir in children where (try? dir.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
            let rss = dir.appendingPathComponent("rss.xml.ts")
            if fileManager.fileExists(atPath: rss.path(percentEncoded: false)) {
                result.insert(dir.lastPathComponent)
            }
        }
        return result
    }

    /// One feed route a collection ships — `/notes/rss.xml` etc. `Kind.rawValue` is the route's
    /// filename so probe path and preview route can't drift apart.
    public struct DetectedFeed: Sendable, Equatable, Identifiable {
        public enum Kind: String, Sendable, CaseIterable {
            case rss = "rss.xml"
            case atom = "atom.xml"
            case json = "feed.json"
        }
        public let kind: Kind
        public let collection: String
        public var route: String { "/\(collection)/\(kind.rawValue)" }
        public var id: String { route }

        public init(kind: Kind, collection: String) {
            self.kind = kind
            self.collection = collection
        }
    }

    /// All feed routes one collection ships, probed the way `feedCollections` probes RSS: the
    /// template materializes `src/pages/<collection>/{rss.xml,atom.xml,feed.json}.ts` per
    /// feed-bearing collection, so existence of the `.ts` route module is the signal (#714 §6).
    public static func detectedFeeds(
        siteRoot: URL, collection: String, fileManager: FileManager = .default
    ) -> [DetectedFeed] {
        let dir = layout(for: siteRoot, fileManager: fileManager)
            .sourceDir.appendingPathComponent("src/pages").appendingPathComponent(collection)
        return DetectedFeed.Kind.allCases.compactMap { kind in
            let module = dir.appendingPathComponent("\(kind.rawValue).ts")
            return fileManager.fileExists(atPath: module.path(percentEncoded: false))
                ? DetectedFeed(kind: kind, collection: collection)
                : nil
        }
    }

    /// Recursively lists files under `dir`, skipping excluded dirs/files. Returns [] if `dir` is absent.
    private static func files(in dir: URL, group: FileGroup, fileManager: FileManager) -> [FileRef] {
        guard let enumerator = fileManager.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var refs: [FileRef] = []
        for case let url as URL in enumerator {
            let name = url.lastPathComponent
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            // Skip symlinks entirely: the exclusion set only matches real directory names, so a
            // symlinked tree (e.g. pnpm's symlinked node_modules) would slip past it, and a symlink
            // cycle would loop forever. `skipDescendants()` only works on real directories.
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                if excludedDirNames.contains(name) { enumerator.skipDescendants() }
                continue
            }
            if excludedFileNames.contains(name) { continue }
            refs.append(FileRef(url: url, group: group, name: name))
        }
        return refs
    }
}
