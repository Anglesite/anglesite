import Foundation
import AnglesiteSiteModel

/// Recents registry for `.anglesite` packages opened in this app.
///
/// Each entry is keyed by the package's stable marker UUID (independent of filesystem path).
/// When a package is opened or created, the caller calls `record(_:)`, which reads the
/// `Info.plist` marker, upserts by UUID, and persists a most-recently-used–sorted list to
/// `recents.json`. `touch(id:)` bumps `lastSeen` without re-reading the marker (fast path
/// after a create/open that already called `record`).
///
/// The persisted list is the canonical source between launches: validity and last-seen
/// timestamps are cached so the UI renders immediately. `load()` restores the list on startup,
/// dropping entries whose package directories no longer exist.
public actor SiteStore {
    /// Process-wide shared instance.
    public static let shared = SiteStore()

    /// One recents-registry entry: a known `.anglesite` package plus the cached state the
    /// launcher, Open Recent, and Spotlight need to render it without touching disk. Identity
    /// is the package's marker UUID, not its path — the entry survives the package being moved
    /// or renamed (#242).
    public struct Site: Sendable, Codable, Equatable, Identifiable {
        /// The package's stable marker UUID (string). Path-independent — survives moves (#242).
        public let id: String
        /// Resolved display name: the `Config/settings.plist` `displayName` override if set,
        /// else the package marker's displayName (#266). Mutable — `SiteStore.setDisplayName`
        /// updates it in place when an owner renames the site.
        public var name: String
        /// The `.anglesite` package directory.
        public let packageURL: URL
        /// Whether `Source/` passed the project sentinels on the last check. Cached (not live):
        /// refreshed by `load()` and `record(_:)`, so it can go stale between launches if files
        /// change outside the app.
        public var isValid: Bool
        /// The sentinel paths missing from `Source/` when `isValid` is `false` — lets the
        /// launcher say *what's* broken instead of just flagging the site. Empty when
        /// `needsReauthorization` is set, because the check couldn't actually run (#776).
        public var missingSentinels: [String]
        /// When this site was last opened or recorded — the most-recently-used sort key for the
        /// launcher, Open Recent, and the Dock menu.
        public var lastSeen: Date
        /// Security-scoped bookmark for `packageURL`. One grant covers the whole package, so
        /// Source/ and Config/ are both reachable under it.
        public var bookmarkData: Data?
        /// True when a persisted bookmark exists but could not be resolved or started during the
        /// last `refreshFilesystemState()` pass (#776 — e.g. a reboot invalidated the sandbox
        /// extension). This is distinct from a confirmed-invalid package (missing sentinels):
        /// access simply couldn't be verified, so `missingSentinels` is not trustworthy either.
        /// Lets the UI offer a re-grant affordance ("Locate…") instead of misreporting the
        /// package as missing files, and instead of silently going dead with no explanation.
        public var needsReauthorization: Bool

        /// The Astro project tree — every subprocess (scaffold, dev server, build, deploy,
        /// pre-deploy check) runs with this as its working directory.
        public var sourceDirectory: URL { AnglesitePackage(url: packageURL).sourceURL }
        /// App-owned per-site config dir (settings, chat history, cache).
        public var configDirectory: URL { AnglesitePackage(url: packageURL).configURL }

        /// Memberwise initializer. Prefer ``make(package:fileManager:)`` for entries built from
        /// a real package on disk — it derives identity, name, and validity from the marker
        /// instead of trusting caller-supplied values.
        public init(
            id: String,
            name: String,
            packageURL: URL,
            isValid: Bool,
            missingSentinels: [String],
            lastSeen: Date = Date(),
            bookmarkData: Data? = nil,
            needsReauthorization: Bool = false
        ) {
            self.id = id
            self.name = name
            self.packageURL = packageURL
            self.isValid = isValid
            self.missingSentinels = missingSentinels
            self.lastSeen = lastSeen
            self.bookmarkData = bookmarkData
            self.needsReauthorization = needsReauthorization
        }

        private enum CodingKeys: String, CodingKey {
            case id, name, packageURL, isValid, missingSentinels, lastSeen, bookmarkData, needsReauthorization
        }

        /// Custom decoding so `recents.json` written before #776 (no `needsReauthorization` key)
        /// still loads — a missing key defaults to `false` rather than failing `load()` entirely
        /// (which would blank the launcher for every existing user on upgrade).
        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            name = try container.decode(String.self, forKey: .name)
            packageURL = try container.decode(URL.self, forKey: .packageURL)
            isValid = try container.decode(Bool.self, forKey: .isValid)
            missingSentinels = try container.decode([String].self, forKey: .missingSentinels)
            lastSeen = try container.decode(Date.self, forKey: .lastSeen)
            bookmarkData = try container.decodeIfPresent(Data.self, forKey: .bookmarkData)
            needsReauthorization = try container.decodeIfPresent(Bool.self, forKey: .needsReauthorization) ?? false
        }

        /// Build a `Site` from a package on disk: id = marker UUID, name = resolved display name
        /// (settings override ?? marker displayName), validity = whether `Source/` passes the
        /// project sentinels.
        public static func make(package: AnglesitePackage, fileManager: FileManager = .default) throws -> Site {
            let marker = try package.readMarker(fileManager: fileManager)
            // Refuse a package written by a newer build rather than opening it and risking a
            // silent downgrade on the next write (spec §9). Surfaced legibly via PackageError's
            // LocalizedError at the open/import call sites.
            guard AnglesitePackage.compatibility(for: marker) == .current else {
                throw AnglesitePackage.PackageError.markerTooNew(package.infoPlistURL)
            }
            let validation = package.sourceValidation(fileManager: fileManager)
            return Site(
                id: marker.siteID.uuidString,
                name: resolvedName(marker: marker, configURL: package.configURL, fileManager: fileManager),
                packageURL: canonicalizePackageURL(package.url),
                isValid: validation.isValid,
                missingSentinels: validation.missing
            )
        }

        /// The owner-facing display name: a non-blank `settings.plist` override wins, otherwise the
        /// marker's displayName. A settings read error never blocks opening a site — it falls back
        /// to the marker name (settings are non-critical; #266).
        static func resolvedName(
            marker: AnglesitePackage.Marker,
            configURL: URL,
            fileManager: FileManager = .default
        ) -> String {
            let settings = (try? SiteConfigStore.read(from: configURL, fileManager: fileManager)) ?? SiteSettings()
            if let override = settings.displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !override.isEmpty {
                return override
            }
            return marker.displayName
        }
    }

    /// Why a URL can't join the registry as a site. Part of the store's public error vocabulary
    /// for callers that vet a candidate location before recording it.
    public enum StoreError: Error, Sendable {
        /// The URL doesn't point at a directory at all.
        case notADirectory(URL)
        /// The directory exists but its `Source/` tree fails the project sentinels; the payload
        /// lists which sentinel paths are missing, mirroring `Site.missingSentinels`.
        case invalidProject(URL, missing: [String])
    }

    /// Async callback invoked with the new site list after every mutation that changes the
    /// visible registry (load/record/remove/touch). Bookmark-only updates are not emitted —
    /// they don't affect what consumers like `SpotlightIndexer` care about. Single-subscriber
    /// by design; the indexer is the only known consumer today.
    public typealias ChangeHandler = @Sendable ([Site]) async -> Void

    private let fileManager: FileManager
    private let persistenceURL: URL
    /// The in-memory registry, most-recently-used first. Empty until `load()` runs; read-only
    /// from outside — every mutation goes through the actor's methods so persistence and change
    /// broadcasts can't be skipped.
    private(set) public var sites: [Site] = []
    private var changeHandler: ChangeHandler?

    /// Continuations for the UI-observer broadcast, keyed by a per-subscription `UUID`.
    private var changeStreamContinuations: [UUID: AsyncStream<[Site]>.Continuation] = [:]

    /// Creates a store bound to a `recents.json` location. Does not load it — call `load()`
    /// once the caller is ready to render.
    ///
    /// - Parameters:
    ///   - persistenceURL: where to read/write `recents.json`. Defaults to
    ///     `~/Library/Application Support/Anglesite/recents.json`. Tests should pass a temp URL.
    ///   - fileManager: injection seam for tests.
    public init(
        persistenceURL: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        self.persistenceURL = persistenceURL ?? Self.defaultPersistenceURL(fileManager: fileManager)
    }

    /// Install (or replace, or clear with `nil`) the post-mutation change handler.
    public func setChangeHandler(_ handler: ChangeHandler?) {
        changeHandler = handler
    }

    /// Loads the persisted site list from disk into memory. Safe to call before `record()`
    /// when the UI wants to render quickly. Skips the change emit on a fresh-install no-file
    /// path — there's nothing to propagate.
    ///
    /// Filesystem-derived state is **recomputed live** here rather than trusted from disk. Entries
    /// whose package directories were deleted outside the app are removed; existing packages have
    /// `isValid` / `missingSentinels` refreshed because files can change between launches. When the
    /// loaded list changes, it is persisted back so the launcher, Open Recent, Dock menu, and
    /// Spotlight all start from the same healed registry.
    public func load() async throws {
        guard fileManager.fileExists(atPath: persistenceURL.path) else {
            sites = []
            return
        }
        let data = try Data(contentsOf: persistenceURL)
        var loaded = try Self.decoder.decode([Site].self, from: data)
        let changed = Self.refreshFilesystemState(&loaded, fileManager: fileManager)
        sites = loaded
        if changed { try? persist() }
        await emitChange()
    }

    /// Drop entries whose package directory no longer exists, then recompute each survivor's
    /// `isValid` / `missingSentinels`. On MAS the package lives behind a security-scoped grant, so
    /// resolve and start the per-site bookmark for the duration of the checks. A bookmark can
    /// follow a package that moved, so existence is checked at its resolved URL while validation
    /// continues to use the registry URL until the package is explicitly reopened and recorded.
    /// If a resolved bookmark cannot start access, retain the entry: an unavailable grant does not
    /// prove that the user's files were deleted. Returns `true` when the registry changed.
    private static func refreshFilesystemState(_ sites: inout [Site], fileManager: FileManager) -> Bool {
        var changed = false
        let bookmarker = PlatformSecurityScopedBookmark.make()
        var refreshed: [Site] = []
        refreshed.reserveCapacity(sites.count)

        for var site in sites {
            var scoped: URL?
            var existenceURL = site.packageURL
            var canDetermineExistence = true
            // True only when a bookmark exists but resolving it or starting access on it failed —
            // i.e. we hold a grant that stopped working, not "there was never a grant" (#776).
            var needsReauthorization = false
            if let bookmark = site.bookmarkData {
                if let resolved = try? bookmarker.resolve(bookmark) {
                    existenceURL = resolved.url
                    if bookmarker.startAccessing(resolved.url) {
                        scoped = resolved.url
                    } else {
                        canDetermineExistence = false
                        needsReauthorization = true
                    }
                } else {
                    canDetermineExistence = false
                    needsReauthorization = true
                }
            }

            var isDirectory: ObjCBool = false
            let packageExists = fileManager.fileExists(atPath: existenceURL.path, isDirectory: &isDirectory)
                && isDirectory.boolValue
            guard !canDetermineExistence || packageExists else {
                if let scoped { bookmarker.stopAccessing(scoped) }
                changed = true
                continue
            }

            // When access can't be verified, don't trust a validation run against the unscoped
            // path — under sandboxing it will read as "every sentinel missing" even though the
            // package is untouched, which is exactly the misleading state #776 reported.
            let validation = AnglesitePackage(url: site.packageURL).sourceValidation(fileManager: fileManager)
            if let scoped { bookmarker.stopAccessing(scoped) }
            let isValid = needsReauthorization ? false : validation.isValid
            let missing = needsReauthorization ? [] : validation.missing
            if site.isValid != isValid
                || site.missingSentinels != missing
                || site.needsReauthorization != needsReauthorization {
                site.isValid = isValid
                site.missingSentinels = missing
                site.needsReauthorization = needsReauthorization
                changed = true
            }
            refreshed.append(site)
        }
        sites = refreshed
        return changed
    }

    /// Add or update a recents entry for `package`. Reads its marker for identity + name and
    /// validates `Source/`. Upsert is by `id` (the marker UUID): re-opening a moved package
    /// updates its `packageURL` in place and carries any existing bookmark forward. Persists
    /// and emits a change.
    @discardableResult
    public func record(_ package: AnglesitePackage) async throws -> Site {
        var site = try Site.make(package: package, fileManager: fileManager)
        if let existing = sites.first(where: { $0.id == site.id }) {
            // Carry the bookmark forward ONLY when the package is still at the same path. If it
            // moved, the old bookmark embeds the old location and would grant the wrong path on
            // MAS — drop it so the next open (which just proved access via a picker/Finder/drag)
            // mints a fresh one at the new location instead of keeping a stale grant around.
            if existing.packageURL == site.packageURL {
                site.bookmarkData = existing.bookmarkData ?? site.bookmarkData
            }
        }
        site.lastSeen = Date()
        sites.removeAll { $0.id == site.id }
        sites.append(site)
        sites.sort { $0.lastSeen > $1.lastSeen }
        try persist()
        await emitChange()
        return site
    }

    /// Bump `lastSeen` for the entry with `id` (most-recently-used ordering). No-op if unknown or
    /// already most-recent (so an open right after `record` doesn't re-persist — see #259 review).
    public func touch(id: String) async throws {
        guard let index = sites.firstIndex(where: { $0.id == id }) else { return }
        guard index != 0 else { return }
        sites[index].lastSeen = Date()
        sites.sort { $0.lastSeen > $1.lastSeen }
        try persist()
        // A reorder changes no entity data, so skip the Spotlight `changeHandler` (like
        // `setBookmark`); still push the new ordering to UI observers (Open Recent / launcher).
        for continuation in changeStreamContinuations.values { continuation.yield(sites) }
    }

    /// Removes a site from the list. Does not delete files on disk.
    public func remove(id: String) async throws {
        sites.removeAll { $0.id == id }
        try persist()
        await emitChange()
    }

    /// Look up a site by id.
    public func find(id: String) -> Site? {
        sites.first { $0.id == id }
    }

    /// The persisted security-scoped bookmark for a site, if any.
    public func bookmarkData(for id: String) -> Data? {
        sites.first { $0.id == id }?.bookmarkData
    }

    /// Stamp `bookmarkData` onto the site with the given id, then persist. No-op if unknown.
    public func setBookmark(_ data: Data, for id: String) throws {
        guard let index = sites.firstIndex(where: { $0.id == id }) else { return }
        sites[index].bookmarkData = data
        try persist()
    }

    /// Set (or clear, with a nil/blank `name`) the owner-facing display-name override for the site
    /// with `id`. Writes `Config/settings.plist`, then re-resolves the in-memory + persisted name
    /// via `Site.make` (so a clear falls back to the marker name) and broadcasts the change so an
    /// open window's title and the launcher list refresh live (#266). Returns the updated site, or
    /// `nil` if `id` is unknown.
    @discardableResult
    public func setDisplayName(_ name: String?, for id: String) async throws -> Site? {
        guard let index = sites.firstIndex(where: { $0.id == id }) else { return nil }
        let existing = sites[index]
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let override = (trimmed?.isEmpty == false) ? trimmed : nil

        let package = AnglesitePackage(url: existing.packageURL)

        // Best-effort, and run before the no-op guard below so a retry always re-attempts it —
        // propagateIfUntitled is itself cheap and idempotent (#1182).
        if let override {
            UntitledSitePropagation.propagateIfUntitled(
                newDisplayName: override,
                siteDirectory: package.sourceURL,
                fileManager: fileManager
            )
        }

        let config = SiteConfigStore(configDirectory: package.configURL, fileManager: fileManager)
        var settings = try await config.load()
        // Renaming to the current value (or clearing an already-empty override) changes nothing —
        // skip the disk write, the re-make, and the change broadcast.
        guard settings.displayName != override else { return existing }
        settings.displayName = override
        try await config.save(settings)

        var updated = try Site.make(package: package, fileManager: fileManager)
        updated.lastSeen = existing.lastSeen
        updated.bookmarkData = existing.bookmarkData
        sites[index] = updated
        try persist()
        await emitChange()
        return updated
    }

    // MARK: - Change notification

    /// A per-subscriber stream of registry snapshots for UI observers (launcher, Open Recent).
    /// Unlike the single-subscriber ``ChangeHandler``, any number of these can be live at once.
    /// Yields the current list immediately on subscription (so a late-arriving view isn't blank
    /// until the next mutation) and buffers only the newest snapshot — a slow consumer sees the
    /// latest state, never a backlog of stale intermediates. `nonisolated` so SwiftUI `.task`
    /// modifiers can subscribe without first hopping onto the actor.
    public nonisolated func changeStream() -> AsyncStream<[Site]> {
        let id = UUID()
        return AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            Task { await self.register(continuation, id: id) }
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeContinuation(id) }
            }
        }
    }

    private func register(_ continuation: AsyncStream<[Site]>.Continuation, id: UUID) {
        changeStreamContinuations[id] = continuation
        continuation.yield(sites)
    }

    private func removeContinuation(_ id: UUID) {
        changeStreamContinuations[id] = nil
    }

    private func emitChange() async {
        if let handler = changeHandler {
            await handler(sites)
        }
        for continuation in changeStreamContinuations.values {
            continuation.yield(sites)
        }
    }

    // MARK: - Persistence

    private func persist() throws {
        let dir = persistenceURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try Self.encoder.encode(sites)
        try data.write(to: persistenceURL, options: [.atomic])
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }

    private static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    private static func defaultPersistenceURL(fileManager: FileManager) -> URL {
        let support = (try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? fileManager.portableHomeDirectory
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        return support
            .appendingPathComponent("Anglesite", isDirectory: true)
            .appendingPathComponent("recents.json")
    }
}

/// Canonical (standardized, symlink-resolved) form of a package URL, so the same package
/// reached via a symlinked path collapses to one recents entry.
func canonicalizePackageURL(_ url: URL) -> URL {
    url.standardizedFileURL.resolvingSymlinksInPath()
}
