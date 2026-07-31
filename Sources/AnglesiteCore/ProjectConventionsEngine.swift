// Sources/AnglesiteCore/ProjectConventionsEngine.swift
import Foundation

/// Shared, app-lifetime, in-memory index of each open site's `ProjectConventions` — mirrors
/// `SiteKnowledgeIndex`'s shape and lifecycle exactly (same `rebuild`/`upsertFile`/`removeFile`
/// triggers, driven by the same `SiteFileWatcher`, see Task 6).
///
/// Deliberately in-memory only, like `SiteKnowledgeIndex`'s embedding cache today: per-site
/// `Config/` persistence is owned by `ProjectConventionsStore` (Task 6) and driven by the
/// UI-facing `ProjectConventionsModel` (Task 9), not by this actor. `seed(siteID:with:)` lets a
/// caller preload a persisted value (so overrides survive an app restart) before the first
/// `rebuild` runs its merge.
public actor ProjectConventionsEngine {
    /// Produces the tone-descriptor/brand-term fields the deterministic extractor can't compute
    /// from text stats alone. Non-gated (unlike `GeneratedProjectConventions`, which is behind
    /// `#if compiler(>=6.4)`) so this actor builds on the reduced CI toolchain too — the concrete
    /// `FoundationModels`-backed closure is only ever supplied by `ProjectConventionsEnricherFactory`.
    public typealias ConventionsEnricher = @Sendable (
        _ sampleText: String, _ context: AssistantContext
    ) async throws -> (toneDescriptors: [String], brandTerms: [String])

    private var conventionsBySite: [String: ProjectConventions] = [:]
    private var filesBySite: [String: [String: String]] = [:]
    private let enrich: ConventionsEnricher?
    private let enrichmentInterval: TimeInterval
    private let now: @Sendable () -> Date
    private var lastEnrichedAt: [String: Date] = [:]

    /// Creates an engine.
    ///
    /// - Parameters:
    ///   - enrich: Model-backed tone/brand-term producer, or `nil` to run extraction-only
    ///     (the reduced CI toolchain path — see ``ProjectConventionsEnricherFactory``).
    ///   - enrichmentInterval: Minimum seconds between enrichment passes per site. The default
    ///     (5 minutes) keeps the on-device model out of the hot file-watcher path.
    ///   - now: Clock seam so tests can drive the throttle without real waiting.
    public init(
        enrich: ConventionsEnricher? = nil,
        enrichmentInterval: TimeInterval = 300,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.enrich = enrich
        self.enrichmentInterval = enrichmentInterval
        self.now = now
    }

    /// Full rescan: walks `projectRoot`, re-extracts every convention, merges preserved user
    /// overrides back in, and (throttle permitting, or always with `forceEnrichment`) runs the
    /// tone/brand enrichment pass. Disk I/O happens off-actor at utility priority so a large
    /// site doesn't stall callers.
    public func rebuild(siteID: String, projectRoot: URL, forceEnrichment: Bool = false) async {
        let files = await Task.detached(priority: .utility) {
            Self.scan(projectRoot: projectRoot)
        }.value
        filesBySite[siteID] = Dictionary(uniqueKeysWithValues: files.map { ($0.path, $0.contents) })
        await recompute(siteID: siteID, projectRoot: projectRoot)
        await maybeEnrich(siteID: siteID, siteDirectory: projectRoot, force: forceEnrichment)
    }

    /// Incremental update for one changed file (the `SiteFileWatcher` path). Non-scanned
    /// paths/extensions are ignored; an unreadable file is treated as a removal so a
    /// delete-then-event race can't leave stale contents in the index. Never triggers
    /// enrichment — that stays on the `rebuild` cadence.
    public func upsertFile(siteID: String, projectRoot: URL, relativePath: String) async {
        guard shouldScan(relativePath) else { return }
        let url = projectRoot.appendingPathComponent(relativePath)
        let contents = await Task.detached(priority: .utility) {
            try? String(contentsOf: url, encoding: .utf8)
        }.value
        guard let contents else {
            await removeFile(siteID: siteID, relativePath: relativePath)
            return
        }
        filesBySite[siteID, default: [:]][relativePath] = contents
        await recompute(siteID: siteID, projectRoot: projectRoot)
    }

    /// Drops one file from the index and recomputes. No `projectRoot` here (mirrors
    /// `SiteKnowledgeIndex.removeFile`), so frontmatter collections keep their last-known
    /// reading until the next full `rebuild` re-reads them from disk.
    public func removeFile(siteID: String, relativePath: String) async {
        guard filesBySite[siteID]?.removeValue(forKey: relativePath) != nil else { return }
        // No projectRoot available here (mirrors SiteKnowledgeIndex.removeFile) — frontmatter
        // collections are re-read from disk on the next full `rebuild`, not on every removal.
        await recompute(siteID: siteID, projectRoot: nil)
    }

    /// Frees a closed site's in-memory state. Persistence is the caller's job (via
    /// ``ProjectConventionsStore``) *before* unloading — anything not saved is gone, including
    /// user overrides applied this session.
    public func unload(siteID: String) {
        conventionsBySite.removeValue(forKey: siteID)
        filesBySite.removeValue(forKey: siteID)
    }

    /// The current in-memory conventions for a site, or `nil` if it was never seeded, rebuilt,
    /// or overridden this session. Callers wanting a usable value regardless should fall back
    /// to ``ProjectConventions/empty``.
    public func conventions(siteID: String) -> ProjectConventions? {
        conventionsBySite[siteID]
    }

    /// Preloads a value (typically read from `Config/conventions.json` by the caller) before the
    /// first `rebuild` for this site, so a subsequent `rebuild`'s merge preserves its overrides.
    /// No-op if a value is already present (a real `rebuild` has already run this session).
    public func seed(siteID: String, with conventions: ProjectConventions) {
        guard conventionsBySite[siteID] == nil else { return }
        conventionsBySite[siteID] = conventions
    }

    /// Applies a user override, flipping the field's source to `.userOverride` so later
    /// rebuilds preserve it. Starts from ``ProjectConventions/empty`` when the site has no
    /// state yet — an override must never be dropped just because learning hasn't run.
    public func applyOverride(siteID: String, value: OverrideValue) {
        var conventions = conventionsBySite[siteID] ?? .empty
        conventions.apply(value)
        conventionsBySite[siteID] = conventions
    }

    /// Reverts one field to inferred; the current value stays in place until the next rebuild
    /// recomputes it (see ``ProjectConventions/clearOverride(_:)``). No-op for an unknown site —
    /// there's nothing to revert.
    public func clearOverride(siteID: String, field: OverridableField) {
        guard var conventions = conventionsBySite[siteID] else { return }
        conventions.clearOverride(field)
        conventionsBySite[siteID] = conventions
    }

    // MARK: - Recompute

    private func recompute(siteID: String, projectRoot: URL?) async {
        let files = (filesBySite[siteID] ?? [:]).map {
            ProjectConventionsExtractor.ScannedFile(path: $0.key, contents: $0.value)
        }
        var fresh = ProjectConventionsExtractor.extract(files: files)
        if let projectRoot {
            let collections = await Task.detached(priority: .utility) {
                FrontmatterSchemaReader.read(siteDirectory: projectRoot)
            }.value
            fresh.frontmatter = FrontmatterConventions(collections: collections)
        } else if let previous = conventionsBySite[siteID] {
            // No projectRoot on this call (a `removeFile` with no disk access) — keep the
            // last-known frontmatter reading rather than blanking it out.
            fresh.frontmatter = previous.frontmatter
        }
        if let previous = conventionsBySite[siteID] {
            fresh = fresh.merging(overriddenFrom: previous)
        }
        conventionsBySite[siteID] = fresh
    }

    // MARK: - Enrichment

    /// Runs the (expensive, on-device-model-backed) tone/brand-term enrichment pass for a site,
    /// throttled to at most once per `enrichmentInterval` unless `force` is set. No-op when no
    /// `enrich` closure was supplied (e.g. the reduced CI toolchain via
    /// `ProjectConventionsEnricherFactory.makeDefault()` returning `nil`).
    private func maybeEnrich(siteID: String, siteDirectory: URL, force: Bool) async {
        guard let enrich else { return }
        if !force, let last = lastEnrichedAt[siteID], now().timeIntervalSince(last) < enrichmentInterval {
            return
        }
        guard let sample = sampleText(siteID: siteID) else { return }
        lastEnrichedAt[siteID] = now()
        let context = AssistantContext(siteID: siteID, siteDirectory: siteDirectory)
        guard let result = try? await enrich(sample, context) else { return }
        guard var conventions = conventionsBySite[siteID] else { return }
        if !conventions.writing.toneDescriptors.isOverridden {
            conventions.writing.toneDescriptors = Learned(value: result.toneDescriptors, source: .inferred(confidence: 1))
        }
        if !conventions.writing.brandTerms.isOverridden {
            conventions.writing.brandTerms = Learned(value: result.brandTerms, source: .inferred(confidence: 1))
        }
        conventionsBySite[siteID] = conventions
    }

    /// A bounded sample of the site's scanned text, concatenated for a single guided-generation
    /// prompt. Capped at 4,000 characters to keep the on-device context window small.
    private func sampleText(siteID: String) -> String? {
        guard let files = filesBySite[siteID], !files.isEmpty else { return nil }
        return String(files.values.joined(separator: "\n\n").prefix(4_000))
    }

    // MARK: - Scanning

    private func shouldScan(_ relativePath: String) -> Bool {
        guard !SiteIndexPaths.isSkipped(relativePath: relativePath) else { return false }
        return Self.scannedExtensions.contains(URL(fileURLWithPath: relativePath).pathExtension.lowercased())
    }

    private static let scannedExtensions: Set<String> = ["astro", "md", "mdx", "html"]

    private static func scan(projectRoot: URL) -> [ProjectConventionsExtractor.ScannedFile] {
        walk(projectRoot).compactMap { url -> ProjectConventionsExtractor.ScannedFile? in
            guard let relativePath = SiteIndexPaths.relativePOSIXPath(of: url, under: projectRoot),
                  scannedExtensions.contains(url.pathExtension.lowercased()),
                  let contents = try? String(contentsOf: url, encoding: .utf8)
            else { return nil }
            return ProjectConventionsExtractor.ScannedFile(path: relativePath, contents: contents)
        }
    }

    private static func walk(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [URL] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            if SiteIndexPaths.skippedDirectoryNames.contains(entry.lastPathComponent) { continue }
            let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                files.append(contentsOf: walk(entry))
            } else {
                files.append(entry)
            }
        }
        return files
    }
}
