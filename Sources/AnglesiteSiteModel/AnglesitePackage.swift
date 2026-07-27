import Foundation

/// A `.anglesite` package on disk: a Finder-opaque directory (UTI `io.dwk.anglesite.site`,
/// `LSTypeIsPackage`) that wraps a git-tracked `Source/` Astro project, an app-owned `Config/`
/// directory, and an `Info.plist` marker carrying a stable site UUID + a format version.
///
/// This is the single source of truth for the package's internal layout. Recents discovery,
/// scaffold/deploy working directories, and the per-site config store all resolve paths through
/// here so the layout lives in exactly one file (spec §1).
public struct AnglesitePackage: Sendable, Equatable {
    /// Filename extension and package UTI suffix.
    public static let packageExtension = "anglesite"

    /// Current on-disk format. Bump when the layout changes in a way older builds can't safely
    /// write; `Marker.formatVersion` is compared against this on open (see `compatibility(for:)`).
    public static let currentFormatVersion = 1

    /// The package directory (`…/Name.anglesite`).
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    // MARK: - Layout

    public var infoPlistURL: URL { url.appendingPathComponent("Info.plist", isDirectory: false) }
    public var sourceURL: URL { url.appendingPathComponent("Source", isDirectory: true) }
    public var configURL: URL { url.appendingPathComponent("Config", isDirectory: true) }

    /// App-owned sync state, inside `Config/` (never in the `Source/` git repo).
    public var syncDirectoryURL: URL { configURL.appendingPathComponent("sync", isDirectory: true) }

    /// The live git repository, out of the iCloud-synced `Source/` tree (#875/#877). iCloud Drive
    /// never uploads a path whose last component matches `*.nosync`, so this is where the real
    /// `.git` directory lives once a package is migrated to the split-repo layout — `Source/.git`
    /// becomes a relative gitfile (`RepoRelocator`) pointing here, which `cd`/git/VS Code/libgit2
    /// all follow transparently (the same mechanism git uses for submodules).
    public var liveRepositoryURL: URL { configURL.appendingPathComponent("repo.nosync", isDirectory: true) }

    /// Single-file `git bundle` mirror of the `Source/` repo's history.
    ///
    /// This is the iCloud-syncable artifact (#283, superseded by #875's split-repo design):
    /// iCloud Drive syncs a single opaque file atomically and reliably, where a live `.git`
    /// directory — thousands of loose objects and refs — desyncs, spawns `… 2` conflict copies,
    /// and corrupts under concurrent edits. The bundle travels in `Config/sync/` so it rides along
    /// with the package in iCloud while staying out of the `Source/` working tree. `SyncEngine`
    /// (#879) writes it from `Source/` and, on a peer Mac, fetches from it to fast-forward the
    /// local repo — the bundle acts as an iCloud-mediated remote.
    public var syncBundleURL: URL { syncDirectoryURL.appendingPathComponent("source.bundle", isDirectory: false) }

    /// Quarantine directory for files iCloud dropped as conflict-copies of `Source/`'s own
    /// working tree (design doc §3, "Working-tree conflict copies") — swept there by
    /// `SyncEngine.pull()` rather than left in place or silently deleted, and surfaced in the
    /// sync conflict resolution sheet (#881) alongside the git-level `SyncConflict`.
    public var conflictsDirectoryURL: URL { configURL.appendingPathComponent("conflicts", isDirectory: true) }

    /// Cached home-page thumbnail (nice-to-have, #621). Nothing writes this file yet — a future
    /// feature (e.g. captured on deploy) will populate it. The Quick Look preview and thumbnail
    /// extensions (`AnglesiteQuickLookPreview` / `AnglesiteQuickLookThumbnail`) read it if present
    /// and fall back to a generated placeholder otherwise.
    public var quickLookThumbnailURL: URL {
        configURL.appendingPathComponent("quicklook-thumbnail.png", isDirectory: false)
    }

    /// The inverse of `sourceURL`: reconstructs a package's root `url` from its `Source/`
    /// directory. For callers (like `LocalContainerSiteRuntime`) that are only ever handed the
    /// `Source/` path, not the package root itself.
    public static func packageRoot(fromSourceURL sourceURL: URL) -> URL {
        sourceURL.deletingLastPathComponent()
    }

    // MARK: - Marker

    /// The `Info.plist` marker: stable identity + format version + provenance. Encoded with
    /// `PropertyListEncoder`, so `createdDate` is a native plist date and `siteID` a plist string.
    public struct Marker: Sendable, Codable, Equatable {
        // Identity + provenance are immutable: the point of the UUID redesign is that a package's
        // identity never changes after creation. Only `displayName` has a legitimate reason to
        // change (a rename), so it stays `var`.
        public let formatVersion: Int
        public let siteID: UUID
        public var displayName: String
        public let createdDate: Date

        public init(
            formatVersion: Int = AnglesitePackage.currentFormatVersion,
            siteID: UUID = UUID(),
            displayName: String,
            createdDate: Date = Date()
        ) {
            self.formatVersion = formatVersion
            self.siteID = siteID
            self.displayName = displayName
            // XML property-list <date> values have whole-second granularity, so we truncate to
            // a second boundary here. This keeps an in-memory Marker equal to the one decoded
            // back from Info.plist (the writeMarker→readMarker round-trip contract).
            self.createdDate = Date(timeIntervalSinceReferenceDate:
                floor(createdDate.timeIntervalSinceReferenceDate))
        }

        private enum CodingKeys: String, CodingKey {
            case formatVersion = "AnglesiteFormatVersion"
            case siteID = "AnglesiteSiteID"
            case displayName = "AnglesiteDisplayName"
            case createdDate = "AnglesiteCreatedDate"
        }
    }

    public enum PackageError: Error, Sendable {
        /// `Info.plist` is absent (or was deleted out from under us).
        case markerMissing(URL)
        /// `Info.plist` exists but couldn't be read or decoded. Carries the underlying cause so a
        /// permission error, a corrupt plist, and a decode mismatch are distinguishable downstream.
        case markerUnreadable(URL, underlying: Error)
        /// Refused to overwrite a marker written by a newer build (`.readOnlyTooNew`), per spec §9.
        case markerTooNew(URL)
        /// `createSkeleton` target already exists — overwriting would mint a new UUID and destroy
        /// the existing site's stable identity.
        case alreadyExists(URL)
    }

    /// Forward-compatibility verdict for an opened package's marker.
    public enum Compatibility: Sendable, Equatable {
        /// Same format the app writes — fully editable.
        case current
        /// Written by a newer build than this one. Open read-only and prompt to upgrade rather
        /// than silently rewriting a format we don't understand (spec §9).
        case readOnlyTooNew
    }

    public static func compatibility(for marker: Marker) -> Compatibility {
        marker.formatVersion > currentFormatVersion ? .readOnlyTooNew : .current
    }

    /// Reads and decodes the `Info.plist` marker.
    ///
    /// No separate existence check: that would be a TOCTOU race (the file could vanish between the
    /// check and the read). Instead we let `Data(contentsOf:)` throw and classify — a no-such-file
    /// `CocoaError` becomes `.markerMissing`, anything else `.markerUnreadable` carrying the cause.
    public func readMarker(fileManager: FileManager = .default) throws -> Marker {
        do {
            let data = try Data(contentsOf: infoPlistURL)
            return try PropertyListDecoder().decode(Marker.self, from: data)
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            throw PackageError.markerMissing(infoPlistURL)
        } catch {
            throw PackageError.markerUnreadable(infoPlistURL, underlying: error)
        }
    }

    /// Writes the marker to `Info.plist` (XML plist, atomic), creating the package dir if needed.
    ///
    /// Refuses to overwrite a marker written by a newer build (`.readOnlyTooNew`) so we never
    /// silently downgrade a format we don't understand (spec §9). A fresh package has no marker
    /// yet — `readMarker` throws, the `try?` yields `nil`, and creation proceeds.
    public func writeMarker(_ marker: Marker, fileManager: FileManager = .default) throws {
        if let existing = try? readMarker(fileManager: fileManager),
           AnglesitePackage.compatibility(for: existing) == .readOnlyTooNew {
            throw PackageError.markerTooNew(infoPlistURL)
        }
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .xml
        let data = try encoder.encode(marker)
        try data.write(to: infoPlistURL, options: [.atomic])
    }

    // MARK: - Creation

    /// Creates an empty package skeleton: the package dir, `Source/`, `Config/`, and a freshly
    /// stamped `Info.plist`. Does **not** scaffold the Astro project — that runs later with cwd =
    /// `sourceURL` (P2). Returns the package and its new marker.
    @discardableResult
    public static func createSkeleton(
        at url: URL,
        displayName: String,
        fileManager: FileManager = .default
    ) throws -> (AnglesitePackage, Marker) {
        // Refuse to scaffold over an existing path: overwriting would mint a new UUID and silently
        // destroy the existing site's stable identity (spec §9).
        guard !fileManager.fileExists(atPath: url.path) else {
            throw PackageError.alreadyExists(url)
        }
        let pkg = AnglesitePackage(url: url)
        // Roll back a half-written package if any step fails (disk full, permissions), so a failed
        // create never leaves an orphaned partial package behind (spec §9).
        var succeeded = false
        defer { if !succeeded { try? fileManager.removeItem(at: url) } }
        try fileManager.createDirectory(at: pkg.sourceURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: pkg.configURL, withIntermediateDirectories: true)
        let marker = Marker(displayName: displayName)
        try pkg.writeMarker(marker, fileManager: fileManager)
        succeeded = true
        return (pkg, marker)
    }

    // MARK: - Detection & validation

    /// `true` when `url` is a `.anglesite` **directory** carrying a readable marker. A regular file
    /// with the `.anglesite` extension is not a package.
    public static func isPackage(at url: URL, fileManager: FileManager = .default) -> Bool {
        guard url.pathExtension == packageExtension else { return false }
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else { return false }
        return (try? AnglesitePackage(url: url).readMarker(fileManager: fileManager)) != nil
    }

    /// Validates the `Source/` tree against the Anglesite project sentinels.
    public func sourceValidation(fileManager: FileManager = .default) -> ProjectValidator.Result {
        ProjectValidator.validate(sourceURL, fileManager: fileManager)
    }

    /// Two packages are equal when they point at the same standardized location, so a path with a
    /// trailing slash or `..` segment compares equal to its canonical form. (Symlink-level identity
    /// is handled by `SiteStore`'s canonicalization at the recents layer.)
    public static func == (lhs: AnglesitePackage, rhs: AnglesitePackage) -> Bool {
        lhs.url.standardizedFileURL == rhs.url.standardizedFileURL
    }
}

extension AnglesitePackage.PackageError: LocalizedError {
    /// User-legible messages so open/import call sites surface a real explanation rather than a
    /// raw system error (#259 review).
    public var errorDescription: String? {
        switch self {
        case .markerMissing:
            return "This doesn't look like an Anglesite site package (no Info.plist marker)."
        case .markerUnreadable(_, let underlying):
            return "The site package's Info.plist couldn't be read: \(underlying.localizedDescription)"
        case .markerTooNew:
            return "This site package was created by a newer version of Anglesite. Update the app to open it."
        case .alreadyExists:
            return "A site package already exists at that location."
        }
    }
}

extension AnglesitePackage.PackageError: Equatable {
    /// Equality by case + URL; the `markerUnreadable` underlying error is excluded (`Error` isn't
    /// `Equatable`), so callers and tests can match on the case without constructing a cause.
    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case let (.markerMissing(a), .markerMissing(b)): return a == b
        case let (.markerUnreadable(a, _), .markerUnreadable(b, _)): return a == b
        case let (.markerTooNew(a), .markerTooNew(b)): return a == b
        case let (.alreadyExists(a), .alreadyExists(b)): return a == b
        default: return false
        }
    }
}
