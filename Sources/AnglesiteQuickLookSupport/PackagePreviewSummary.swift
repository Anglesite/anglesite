import Foundation
import AnglesiteSiteModel

/// Cheap, synchronous summary of a `.anglesite` package's identity and content-layout facts,
/// built for the Quick Look preview/thumbnail extensions (#621). Reads only the `Info.plist`
/// marker and file-layout counts — never parses content, never touches a dev server or container.
public struct PackagePreviewSummary: Sendable, Equatable {
    /// The site's user-visible name, from the `Info.plist` marker.
    public let displayName: String
    /// When the package was created, from the `Info.plist` marker.
    public let createdDate: Date
    /// Number of non-hidden entries directly under `Source/src/pages/` — a layout fact, not a
    /// route count (nested routes and dynamic pages aren't resolved).
    public let pageCount: Int
    /// One entry per subdirectory of `Source/src/content/`, ordered by directory name.
    public let collectionCounts: [CollectionCount]
    /// Most recent file modification under `Source/` (excluding generated trees; capped scan —
    /// see `modificationScanEntryCap`). `nil` when the tree is unreadable or empty.
    public let sourceLastModified: Date?
    /// Set only when `Config/quicklook-thumbnail.png` actually exists — no writer for this cache
    /// exists yet; this is the read-if-present path for a future feature.
    public let cachedThumbnailURL: URL?

    /// A content collection's directory name and entry count, for the preview's collections list.
    public struct CollectionCount: Sendable, Equatable {
        /// The collection's directory name under `Source/src/content/`.
        public let name: String
        /// Number of non-hidden entries directly inside the collection directory.
        public let count: Int

        /// Memberwise initializer, public so the extensions' view code and tests can build
        /// fixture values.
        public init(name: String, count: Int) {
            self.name = name
            self.count = count
        }
    }

    /// Memberwise initializer, public for tests and previews; production code builds summaries
    /// via ``summarize(_:fileManager:)``.
    public init(
        displayName: String,
        createdDate: Date,
        pageCount: Int,
        collectionCounts: [CollectionCount],
        sourceLastModified: Date?,
        cachedThumbnailURL: URL?
    ) {
        self.displayName = displayName
        self.createdDate = createdDate
        self.pageCount = pageCount
        self.collectionCounts = collectionCounts
        self.sourceLastModified = sourceLastModified
        self.cachedThumbnailURL = cachedThumbnailURL
    }

    /// Top-level directories skipped when scanning `Source/` for the most recent modification
    /// time — generated/vendored trees whose churn doesn't reflect the author's own edits. `.git`
    /// isn't listed here: `.skipsHiddenFiles` already excludes every dot-prefixed entry.
    private static let modificationScanExclusions: Set<String> = ["node_modules", "dist"]

    /// Upper bound on files inspected during the last-modified scan. Quick Look extensions run
    /// under a short watchdog budget; an unbounded recursive walk of a site with a very large
    /// `public/`/asset tree could time out the extension and produce no preview at all — worse
    /// than the "not a readable site" fallback this module exists to avoid. Once the cap is hit,
    /// `mostRecentModificationDate` returns the most recent date seen so far rather than scanning
    /// further — an approximation, not a hard guarantee of the true most-recent file.
    private static let modificationScanEntryCap = 5000

    /// Builds a summary from `package`. Throws `AnglesitePackage.PackageError` if the marker is
    /// missing or unreadable — callers treat that as "not a readable Anglesite site".
    public static func summarize(
        _ package: AnglesitePackage,
        fileManager: FileManager = .default
    ) throws -> PackagePreviewSummary {
        let marker = try package.readMarker(fileManager: fileManager)

        let pagesURL = package.sourceURL
            .appendingPathComponent("src", isDirectory: true)
            .appendingPathComponent("pages", isDirectory: true)
        let pageCount = (try? fileManager.contentsOfDirectory(atPath: pagesURL.path))?
            .filter { !$0.hasPrefix(".") }
            .count ?? 0

        let contentURL = package.sourceURL
            .appendingPathComponent("src", isDirectory: true)
            .appendingPathComponent("content", isDirectory: true)
        let collections = collectionCounts(under: contentURL, fileManager: fileManager)

        let lastModified = mostRecentModificationDate(under: package.sourceURL, fileManager: fileManager)

        var thumbnailURL: URL?
        if fileManager.fileExists(atPath: package.quickLookThumbnailURL.path) {
            thumbnailURL = package.quickLookThumbnailURL
        }

        return PackagePreviewSummary(
            displayName: marker.displayName,
            createdDate: marker.createdDate,
            pageCount: pageCount,
            collectionCounts: collections,
            sourceLastModified: lastModified,
            cachedThumbnailURL: thumbnailURL
        )
    }

    private static func collectionCounts(under contentURL: URL, fileManager: FileManager) -> [CollectionCount] {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: contentURL,
            includingPropertiesForKeys: [.isDirectoryKey]
        ) else {
            return []
        }
        let directories = entries.filter { url in
            (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
        }
        return directories
            .map { url -> CollectionCount in
                let count = (try? fileManager.contentsOfDirectory(atPath: url.path))?
                    .filter { !$0.hasPrefix(".") }
                    .count ?? 0
                return CollectionCount(name: url.lastPathComponent, count: count)
            }
            .sorted { $0.name < $1.name }
    }

    private static func mostRecentModificationDate(under root: URL, fileManager: FileManager) -> Date? {
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        var mostRecent: Date?
        var entriesScanned = 0
        for case let url as URL in enumerator {
            // Only exclude *top-level* children of Source/ (enumerator.level == 1) — matching by
            // bare name at any depth would also skip a legitimately-named nested directory (e.g.
            // a content collection someone names "dist"), silently understating recency for it.
            if enumerator.level == 1, modificationScanExclusions.contains(url.lastPathComponent) {
                enumerator.skipDescendants()
                continue
            }
            entriesScanned += 1
            if entriesScanned > modificationScanEntryCap {
                break
            }
            guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey]),
                  values.isDirectory != true,
                  let modified = values.contentModificationDate
            else {
                continue
            }
            if mostRecent == nil || modified > mostRecent! {
                mostRecent = modified
            }
        }
        return mostRecent
    }
}
