import AppIntents
import AnglesiteCore
import Foundation

/// An Anglesite site, addressable by Siri/Shortcuts. Backed live by `SiteStore` — no
/// cache, so the entity never goes stale relative to the registry.
///
/// Conforms to the `.wordProcessor.document` AppSchema so Siri/Spotlight treat each site
/// as a document container. The schema macro synthesises `typeDisplayRepresentation`, so
/// the explicit override is omitted here (the metadata processor requires its removal).
@AppEntity(schema: .wordProcessor.document)
public struct SiteEntity: Sendable {
    /// The stable site UUID from `SiteStore.Site.id` — path-independent (#242), so a Shortcut
    /// that captured an entity keeps resolving after the package moves or is renamed.
    public let id: String
    /// The site's display name, exposed as a schema `@Property` so Siri can match it by voice.
    @Property(title: "Name")
    public var name: String
    /// When the site's `Source/` directory was created; `nil` when the filesystem won't say.
    @Property(title: "Creation Date")
    public var creationDate: Date?
    /// Last modification of the `Source/` directory itself — see the note in `init(_:)` about
    /// in-file edits not bumping this.
    @Property(title: "Modification Date")
    public var modificationDate: Date?

    /// The original display name used by `displayRepresentation` and `SiteEntityQuery`.
    public var displayName: String { name }
    /// The `.anglesite` **package root** (`SiteStore.Site.packageURL`) — NOT the `Source/` git
    /// repo, so scaffolding, file scans, and git ops must not use this URL directly: derive
    /// `AnglesitePackage(url:).sourceURL` from it (see `ApplyThemeIntent`), or resolve the site
    /// by `id` via `SiteStore`/`SiteAccess.withScopedAccess`, which hands back `sourceDirectory`.
    /// App-internal rather than a schema `@Property`; nil only if AppIntents ever builds the
    /// entity via the macro init.
    public var directory: URL?

    /// How Siri/Shortcuts render the entity: name as title, package path as subtitle — the path
    /// is the disambiguator when two sites share a name.
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(directory?.path(percentEncoded: false) ?? "")")
    }

    /// `AppEntity` requirement — the query the system uses whenever it must resolve a
    /// ``SiteEntity`` on its own (Shortcuts re-resolution, Siri disambiguation).
    public static let defaultQuery = SiteEntityQuery()

    /// Memberwise initializer. Prefer `init(_:)` from a `SiteStore.Site` — it fills the dates
    /// from the filesystem and sets `directory` correctly; this one exists for tests and for
    /// the field-by-field cases where no live `Site` is at hand.
    public init(id: String, name: String, creationDate: Date?, modificationDate: Date?, directory: URL? = nil) {
        self.id = id
        self.name = name
        self.creationDate = creationDate
        self.modificationDate = modificationDate
        self.directory = directory
    }

    /// Builds the entity from a live registry entry, reading creation/modification dates off the
    /// `Source/` directory. Directory mtime misses in-file edits (only add/remove/rename bumps
    /// it); revisit with git timestamps after #68.
    public init(_ site: SiteStore.Site) {
        let keys: Set<URLResourceKey> = [.creationDateKey, .contentModificationDateKey]
        let values = try? site.sourceDirectory.resourceValues(forKeys: keys)
        self.init(
            id: site.id,
            name: site.name,
            creationDate: values?.creationDate,
            modificationDate: values?.contentModificationDate,
            directory: site.packageURL
        )
    }
}

/// Resolves sites by id (Shortcuts re-resolution) and by name (Siri "my portfolio site").
/// `load()` is called first so a cold background intent process sees the persisted registry.
public struct SiteEntityQuery: EntityStringQuery {
    private let store: SiteStore

    /// The no-argument initializer AppIntents requires — binds to the shared `SiteStore`,
    /// which is what every production resolution goes through.
    public init() {
        self.store = .shared
    }

    /// Test seam: bind the query to an isolated store instead of the shared registry.
    public init(store: SiteStore) {
        self.store = store
    }

    private func allSites() async -> [SiteStore.Site] {
        try? await store.load()
        return await store.sites
    }

    /// Exact-id resolution — the path Shortcuts uses to re-resolve a previously captured
    /// entity. Unknown ids are silently dropped (deleted sites), not errors.
    public func entities(for identifiers: [String]) async throws -> [SiteEntity] {
        await allSites().filter { identifiers.contains($0.id) }.map(SiteEntity.init)
    }

    /// Case-insensitive substring match on the site name, for Siri utterances like
    /// "my portfolio site". Substring (not prefix/equality) because users rarely say the
    /// exact registered name.
    public func entities(matching string: String) async throws -> [SiteEntity] {
        let needle = string.lowercased()
        return await allSites().filter { $0.name.lowercased().contains(needle) }.map(SiteEntity.init)
    }

    /// Every registered site, unfiltered — site counts are small (this is a personal publishing
    /// app), so the disambiguation picker can afford the full list.
    public func suggestedEntities() async throws -> [SiteEntity] {
        await allSites().map(SiteEntity.init)
    }

    /// The single registered site when there is exactly one, so Siri can skip the "which site?"
    /// prompt entirely; `nil` (forcing disambiguation) in every other case.
    public func defaultResult() async -> SiteEntity? {
        let sites = await allSites()
        return sites.count == 1 ? sites.first.map(SiteEntity.init) : nil
    }
}
