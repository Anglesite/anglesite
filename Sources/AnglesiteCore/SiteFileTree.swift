import Foundation
import AnglesiteSiteModel

/// Curated, group-oriented view of a site's filesystem-backed parts for the Site Navigator.
/// Pages/Posts are sourced from `SiteContentGraph`, not here — this scanner covers only the
/// Components, Styles, and Metadata groups.
///
/// Roots are resolved adaptively: an `.anglesite` package (#242) exposes `Source/` and `Config/`;
/// a plain directory (the current pre-package layout) is treated as the project root directly.
public enum FileGroup: String, Sendable, CaseIterable {
    /// Content pages — populated from ``SiteContentGraph``, never by `SiteFileTree.scan`.
    case pages
    /// Collection posts — populated from ``SiteContentGraph``, never by `SiteFileTree.scan`.
    case posts
    /// Content collections — populated from ``SiteContentGraph``, never by `SiteFileTree.scan`.
    case collections
    /// Layouts and components under `src/layouts` and `src/components`.
    case components
    /// Stylesheets under `src/styles`.
    case styles
    /// App-owned per-site state: everything in the package's `Config/` plus its `Info.plist` marker.
    case metadata
}

/// One file the Site Navigator lists, tagged with the group it was found under.
public struct FileRef: Sendable, Equatable, Identifiable {
    /// Identity is the file's absolute POSIX path, so refs to the same file compare equal
    /// across rescans and SwiftUI list diffing stays stable.
    public var id: String { url.path(percentEncoded: false) }
    /// Absolute location of the file on disk.
    public let url: URL
    /// The navigator group this file was discovered under.
    public let group: FileGroup
    /// Display name — the file's last path component.
    public let name: String

    /// Memberwise initializer; `name` is passed rather than derived so callers (and tests) can
    /// label synthetic entries like the package `Info.plist` marker explicitly.
    public init(url: URL, group: FileGroup, name: String) {
        self.url = url
        self.group = group
        self.name = name
    }
}

/// The scanner behind the Site Navigator's file-backed groups (see ``FileGroup``'s per-case
/// notes for which groups it covers) and the feed-route prober the preview uses (#714).
public enum SiteFileTree {
    /// The resolved on-disk roots for a site, abstracting over whether it is an `.anglesite`
    /// package (#242) or a plain pre-package directory.
    public struct Layout: Sendable, Equatable {
        /// Where the Astro project lives — the package's `Source/`, or the site root itself for
        /// a plain directory.
        public let sourceDir: URL
        /// The package's app-owned `Config/` directory; `nil` for a plain directory, which has
        /// no app-owned state beside the project.
        public let configDir: URL?
        /// The package's `Info.plist` identity marker; `nil` for a plain directory.
        public let infoPlist: URL?
    }

    /// Directory names never descended into or listed.
    private static let excludedDirNames: Set<String> = ["node_modules", "dist", ".astro", ".git"]
    private static let excludedFileNames: Set<String> = [".DS_Store"]

    /// Resolves `siteRoot` adaptively: an `.anglesite` package exposes its `Source/`/`Config/`
    /// split; anything else is treated as a plain project root directly, so pre-package sites
    /// keep working without a migration.
    public static func layout(for siteRoot: URL, fileManager: FileManager = .default) -> Layout {
        if AnglesitePackage.isPackage(at: siteRoot, fileManager: fileManager) {
            let pkg = AnglesitePackage(url: siteRoot)
            return Layout(sourceDir: pkg.sourceURL, configDir: pkg.configURL, infoPlist: pkg.infoPlistURL)
        }
        return Layout(sourceDir: siteRoot, configDir: nil, infoPlist: nil)
    }

    /// Scans the Components, Styles, and Metadata groups (the only groups this scanner owns —
    /// see ``FileGroup``). A group with no files is omitted from the result rather than mapped
    /// to an empty array, so the navigator can hide empty sections with a plain key check.
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
        /// The feed formats the template can materialize. Each raw value is the route's exact
        /// filename, which is also what `detectedFeeds` probes for on disk (as `<rawValue>.ts`).
        public enum Kind: String, Sendable, CaseIterable {
            /// RSS 2.0 — `rss.xml`.
            case rss = "rss.xml"
            /// Atom — `atom.xml`.
            case atom = "atom.xml"
            /// JSON Feed — `feed.json`.
            case json = "feed.json"
        }
        /// Which feed format this route serves.
        public let kind: Kind
        /// The content collection the feed belongs to (e.g. `notes`).
        public let collection: String
        /// The site-relative feed route, derived from `collection` and `kind` so it can't drift
        /// from the on-disk probe path.
        public var route: String { "/\(collection)/\(kind.rawValue)" }
        /// Identity is the route — one feed per (collection, kind) pair.
        public var id: String { route }

        /// Memberwise initializer; `route` is always derived, never stored, so a feed can't be
        /// constructed with a route that disagrees with its parts.
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
