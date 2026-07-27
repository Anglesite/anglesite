import Foundation
import Observation
import AnglesiteCore

@MainActor
@Observable
final class PlistEditorModel {
    let file: FileRef
    let sourceDirectory: URL
    private let initialWebsiteTitle: String
    private let analyticsProvider: any CloudflareWebAnalyticsProviding
    private let customAnalyticsValidator: any CustomAnalyticsHTMLValidating
    private let keychain: KeychainStore
    var entries: [PlistDocumentIO.PlistEntry] = []
    private(set) var savedEntries: [PlistDocumentIO.PlistEntry] = []
    private var allEntries: [PlistDocumentIO.PlistEntry] = []
    private(set) var lastModified: Date?
    private(set) var loadError: String?
    private(set) var iconError: String?
    private(set) var analyticsError: String?
    private(set) var isLoading = false
    private(set) var isInstallingIcons = false
    private(set) var isSavingAnalytics = false
    private(set) var isConfiguringCloudflareAnalytics = false
    private(set) var hasWebsiteIcons = false
    var analyticsSettings = WebsiteAnalyticsAsset.Settings() {
        didSet {
            if oldValue.customHeadTag != analyticsSettings.customHeadTag {
                analyticsError = nil
            }
        }
    }
    private(set) var savedAnalyticsSettings = WebsiteAnalyticsAsset.Settings()
    var redirectEntries: [RedirectsStore.RedirectEntry] = []
    private(set) var savedRedirectEntries: [RedirectsStore.RedirectEntry] = []
    private(set) var redirectsError: String?
    private(set) var isSavingRedirects = false
    private(set) var redirectsLoadFailed = false
    var conflictDiskContents: String?
    var crawlerPolicySettings = CrawlerPolicyAsset.Settings()
    private(set) var savedCrawlerPolicySettings = CrawlerPolicyAsset.Settings()
    private(set) var crawlerPolicyError: String?
    private(set) var isSavingCrawlerPolicy = false
    var mtaStsSettings = MTAStsPolicyAsset.Settings()
    private(set) var savedMtaStsSettings = MTAStsPolicyAsset.Settings()
    private(set) var mtaStsError: String?
    private(set) var isSavingMtaSts = false
    private(set) var isPublishingMtaStsDNS = false
    private let domainOperations: any DomainOperationsService

    // MARK: - Workers tab (#710)

    /// One catalog `group` section of the Workers tab, sorted by group key.
    struct WorkerGroup: Identifiable {
        let id: String
        let name: String
        var rows: [WorkerRow]
    }

    /// One catalog worker row. Component-tied rows are read-only status (design doc §8 — their
    /// active state is always recomputed from the site graph, never toggled); settings-activated
    /// rows carry the toggle state mirrored from `SiteSettings.activeWorkerIDs`.
    struct WorkerRow: Identifiable {
        let descriptor: WorkerDescriptor
        var status: Status
        var id: String { descriptor.id }

        enum Status: Equatable {
            case componentTied(affectedPages: [SiteGraphNode])
            case settingsActivated(isOn: Bool)
        }
    }

    private(set) var workerGroups: [WorkerGroup] = []
    private(set) var workersError: String?
    private(set) var isLoadingWorkers = false
    private(set) var workerLastDeployedIDs: [String] = []
    /// The most recently loaded `SiteSettings`, the base for toggle read-modify-write saves.
    private var workerSettings = SiteSettings()
    private let configDirectory: URL?
    private let workerCatalogProvider: @Sendable () async -> [WorkerDescriptor]
    private let graphSnapshotProvider: @MainActor () -> SiteGraphExplorerSnapshot?
    private let onActiveWorkersChanged: (SiteSettings) async -> Void

    var isDirty: Bool { entries != savedEntries && loadError == nil && !isLoading }
    var isAnalyticsDirty: Bool { analyticsSettings != savedAnalyticsSettings && loadError == nil && !isLoading }
    var isRedirectsDirty: Bool { redirectEntries != savedRedirectEntries && loadError == nil && !isLoading }
    var isCrawlerPolicyDirty: Bool { crawlerPolicySettings != savedCrawlerPolicySettings && loadError == nil && !isLoading }
    var isMtaStsDirty: Bool { mtaStsSettings != savedMtaStsSettings && loadError == nil && !isLoading }
    var cloudflareAnalyticsEnabled: Bool { !analyticsSettings.cloudflareToken.isEmpty }
    var customAnalyticsValidationMessage: String? {
        WebsiteAnalyticsAsset.customHeadTagValidationMessage(analyticsSettings.customHeadTag)
    }

    var validationMessage: String? {
        for entry in entries {
            if case .unsupported(let description) = entry.value {
                return "\(entry.key) is a \(description.lowercased()) value, which this editor can't save yet."
            }
        }
        return nil
    }

    var websiteTitle: String {
        get {
            guard let entry = entries.first, case .string(let title) = entry.value else { return "" }
            return title
        }
        set {
            guard let index = entries.firstIndex(where: Self.isWebsiteTitleEntry) else { return }
            entries[index].value = .string(newValue)
        }
    }

    init(file: FileRef, websiteTitle: String, sourceDirectory: URL,
         configDirectory: URL? = nil,
         workerCatalogProvider: (@Sendable () async -> [WorkerDescriptor])? = nil,
         graphSnapshotProvider: @escaping @MainActor () -> SiteGraphExplorerSnapshot? = { nil },
         onActiveWorkersChanged: @escaping (SiteSettings) async -> Void = { _ in },
         analyticsProvider: any CloudflareWebAnalyticsProviding = CloudflareWebAnalyticsClient(),
         customAnalyticsValidator: any CustomAnalyticsHTMLValidating = AstroHTMLValidator(),
         keychain: KeychainStore = KeychainStore(),
         domainOperations: any DomainOperationsService = DomainOperations()) {
        self.file = file
        self.initialWebsiteTitle = websiteTitle
        self.sourceDirectory = sourceDirectory
        self.configDirectory = configDirectory
        // Resolved here rather than as a default argument: a closure creating and awaiting an
        // actor can't be a default value in this @MainActor initializer under strict concurrency.
        self.workerCatalogProvider = workerCatalogProvider ?? {
            await WorkerCatalogFetcher(catalogURL: WorkerCatalogFetcher.productionCatalogURL).catalog()
        }
        self.graphSnapshotProvider = graphSnapshotProvider
        self.onActiveWorkersChanged = onActiveWorkersChanged
        self.analyticsProvider = analyticsProvider
        self.customAnalyticsValidator = customAnalyticsValidator
        self.keychain = keychain
        self.domainOperations = domainOperations
        self.hasWebsiteIcons = WebsiteIconInstaller.hasInstalledIcons(in: sourceDirectory)
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        let url = file.url
        do {
            let loaded = try await Task.detached(priority: .userInitiated) {
                try PlistDocumentIO.load(url)
            }.value
            var visibleEntries = loaded.entries.filter(Self.isWebsiteTitleEntry)
            if let index = visibleEntries.firstIndex(where: Self.isWebsiteTitleEntry) {
                visibleEntries[index].value = .string(initialWebsiteTitle)
            }
            allEntries = loaded.entries
            entries = visibleEntries
            savedEntries = visibleEntries
            lastModified = loaded.modificationDate
            loadError = nil
            hasWebsiteIcons = WebsiteIconInstaller.hasInstalledIcons(in: sourceDirectory)
            let (analytics, config) = try Self.loadAnalyticsSettings(sourceDirectory: sourceDirectory)
            analyticsSettings = analytics
            savedAnalyticsSettings = analytics
            analyticsError = nil
            do {
                let redirects = try RedirectsStore(sourceDirectory: sourceDirectory).load()
                redirectEntries = redirects
                savedRedirectEntries = redirects
                redirectsError = nil
                redirectsLoadFailed = false
            } catch {
                redirectEntries = []
                savedRedirectEntries = []
                redirectsError = "Couldn't load existing redirects.json — it may be corrupted or hand-edited with invalid entries. Fix it externally or your next save will discard it. (\(error.localizedDescription))"
                redirectsLoadFailed = true
            }
            // Reuses the `.site-config` contents `loadAnalyticsSettings` already read — a load
            // failure there already aborts this whole `load()` via the outer `catch` below, so
            // there's no separate failure mode here to handle.
            let policy = CrawlerPolicyAsset.parseSettings(from: config)
            crawlerPolicySettings = policy
            savedCrawlerPolicySettings = policy
            crawlerPolicyError = nil
            let mtaSts = MTAStsPolicyAsset.parseSettings(from: config)
            mtaStsSettings = mtaSts
            savedMtaStsSettings = mtaSts
            mtaStsError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// True while `save()`'s off-main write is in flight — same contract as
    /// `FileEditorModel.isSaving` (analytics writes have their own `isSavingAnalytics`).
    private(set) var isSaving = false

    @discardableResult
    func save() async -> Bool {
        guard isDirty, !isSaving else { return true }
        guard validationMessage == nil else { return false }
        isSaving = true
        defer { isSaving = false }
        let url = file.url
        let entries = entriesForSaving()
        do {
            let mtime = try await Task.detached(priority: .userInitiated) {
                try PlistDocumentIO.save(entries, to: url)
            }.value
            lastModified = mtime
            allEntries = entries
            savedEntries = self.entries
            return true
        } catch {
            loadError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    func flushBeforeLeaving() async -> Bool {
        if isDirty {
            let url = file.url
            let known = lastModified
            let change = try? await Task.detached(priority: .userInitiated) {
                try PlistDocumentIO.externalChange(at: url, lastKnownModificationDate: known, bufferIsDirty: true)
            }.value
            if case .conflict(let disk)? = change {
                conflictDiskContents = disk
                return false
            }
            guard await save() else { return false }
        }
        if isAnalyticsDirty {
            guard await saveAnalytics() else { return false }
        }
        if isRedirectsDirty {
            guard await saveRedirects() else { return false }
        }
        if isCrawlerPolicyDirty {
            guard await saveCrawlerPolicy() else { return false }
        }
        if isMtaStsDirty { return await saveMtaSts() }
        return true
    }

    func checkExternalChange() async {
        guard loadError == nil else { return }
        let url = file.url
        let known = lastModified
        let dirty = isDirty
        let change = try? await Task.detached(priority: .userInitiated) {
            try PlistDocumentIO.externalChange(at: url, lastKnownModificationDate: known, bufferIsDirty: dirty)
        }.value
        guard let change else { return }
        switch change {
        case .none:
            break
        case .reloadable:
            await load()
        case .conflict(let disk):
            conflictDiskContents = disk
        }
    }

    func keepMyChanges() { conflictDiskContents = nil }

    func reloadFromDisk() async {
        conflictDiskContents = nil
        await load()
    }

    func installWebsiteIcons(from imageURL: URL) async {
        guard !isInstallingIcons else { return }
        isInstallingIcons = true
        iconError = nil
        defer { isInstallingIcons = false }

        let siteName = websiteTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? initialWebsiteTitle
            : websiteTitle
        let sourceDirectory = sourceDirectory
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try WebsiteIconInstaller.install(from: imageURL, siteName: siteName, siteDirectory: sourceDirectory)
            }.value
            hasWebsiteIcons = true
        } catch {
            iconError = error.localizedDescription
        }
    }

    @discardableResult
    func saveAnalytics() async -> Bool {
        guard isAnalyticsDirty else { return true }
        guard !isSavingAnalytics else { return false }
        let sourceDirectory = sourceDirectory
        let settings = analyticsSettings
        if let validationMessage = await customAnalyticsValidator.validationMessage(
            for: settings.customHeadTag,
            siteDirectory: sourceDirectory
        ) ?? customAnalyticsValidationMessage {
            analyticsError = validationMessage
            return false
        }
        isSavingAnalytics = true
        analyticsError = nil
        defer { isSavingAnalytics = false }

        do {
            try await Task.detached(priority: .userInitiated) {
                try WebsiteAnalyticsAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            savedAnalyticsSettings = settings
            return true
        } catch {
            analyticsError = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func saveRedirects() async -> Bool {
        guard isRedirectsDirty else { return true }
        guard !isSavingRedirects else { return false }
        guard !redirectsLoadFailed else {
            redirectsError = "Refusing to save: the existing redirects.json failed to load and may contain valid entries this save would discard. Fix or back up the file, then reload this site's settings."
            return false
        }
        isSavingRedirects = true
        redirectsError = nil
        defer { isSavingRedirects = false }
        let sourceDirectory = sourceDirectory
        let entries = redirectEntries
        do {
            try await Task.detached(priority: .userInitiated) {
                try RedirectsStore(sourceDirectory: sourceDirectory).save(entries)
            }.value
            savedRedirectEntries = entries
            return true
        } catch {
            redirectsError = "Couldn't save redirects: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    func saveCrawlerPolicy() async -> Bool {
        guard isCrawlerPolicyDirty else { return true }
        guard !isSavingCrawlerPolicy else { return false }
        isSavingCrawlerPolicy = true
        crawlerPolicyError = nil
        defer { isSavingCrawlerPolicy = false }
        let sourceDirectory = sourceDirectory
        let settings = crawlerPolicySettings
        do {
            try await Task.detached(priority: .userInitiated) {
                try CrawlerPolicyAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            savedCrawlerPolicySettings = settings
            return true
        } catch {
            crawlerPolicyError = "Couldn't save crawler policy: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    func saveMtaSts() async -> Bool {
        guard isMtaStsDirty else { return true }
        guard !isSavingMtaSts else { return false }
        isSavingMtaSts = true
        mtaStsError = nil
        defer { isSavingMtaSts = false }
        let sourceDirectory = sourceDirectory
        let settings = mtaStsSettings
        do {
            try await Task.detached(priority: .userInitiated) {
                try MTAStsPolicyAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            let canonical = MTAStsPolicyAsset.Settings(
                mode: settings.mode,
                domain: MTAStsPolicyAsset.normalizedDomain(settings.domain),
                mxHosts: MTAStsPolicyAsset.normalizedMXList(settings.mxHosts).joined(separator: "\n"),
                reportMailbox: MTAStsPolicyAsset.normalizedReportMailbox(settings.reportMailbox) ?? ""
            )
            mtaStsSettings = canonical
            savedMtaStsSettings = canonical
            return true
        } catch {
            mtaStsError = "Couldn't save MTA-STS policy: \(error.localizedDescription)"
            return false
        }
    }

    /// Reads the zone's existing MX records into the editable policy. This is intentionally an
    /// explicit action: MTA-STS is a promise about mail delivery, so automatically changing a
    /// saved policy just because DNS changed would be surprising and potentially disruptive.
    func detectMtaStsMXHosts() async {
        let domain = MTAStsPolicyAsset.normalizedDomain(mtaStsSettings.domain)
        guard !domain.isEmpty, !isPublishingMtaStsDNS else { return }
        isPublishingMtaStsDNS = true
        mtaStsError = nil
        defer { isPublishingMtaStsDNS = false }
        switch await domainOperations.listRecords(domain: domain) {
        case .success(let records):
            let hosts = records
                .filter { $0.type.caseInsensitiveCompare("MX") == .orderedSame }
                .map(\.content)
            let normalized = MTAStsPolicyAsset.normalizedMXList(hosts.joined(separator: "\n"))
            guard !normalized.isEmpty else {
                mtaStsError = "No usable MX records were found for \(domain). Enter the receiving mail hosts manually."
                return
            }
            mtaStsSettings.mxHosts = normalized.joined(separator: "\n")
        case .failure(let error):
            mtaStsError = mtaStsDNSMessage(for: error)
        }
    }

    /// Adds the MTA-STS and optional TLS-RPT TXT records through the existing Cloudflare DNS
    /// integration. It never overwrites an existing record with different content: multiple
    /// matching TXT records make MTA-STS invalid, and replacing a hand-managed record is not safe.
    func publishMtaStsDNSRecords() async {
        guard await saveMtaSts() else { return }
        let settings = mtaStsSettings
        let domain = MTAStsPolicyAsset.normalizedDomain(settings.domain)
        let desired = MTAStsPolicyAsset.dnsRecords(for: domain, settings: settings)
        guard !domain.isEmpty, !desired.isEmpty, !isPublishingMtaStsDNS else { return }
        isPublishingMtaStsDNS = true
        mtaStsError = nil
        defer { isPublishingMtaStsDNS = false }
        switch await domainOperations.listRecords(domain: domain) {
        case .failure(let error):
            mtaStsError = mtaStsDNSMessage(for: error)
        case .success(let existing):
            for record in desired {
                let matching = existing.filter {
                    $0.type.caseInsensitiveCompare("TXT") == .orderedSame
                        && $0.name.caseInsensitiveCompare(record.name) == .orderedSame
                }
                if matching.contains(where: { $0.content == record.content }) { continue }
                if !matching.isEmpty {
                    mtaStsError = "A TXT record already exists for \(record.name) with different content. Update it in Website → Manage Domain, then try again."
                    return
                }
                switch await domainOperations.addRecord(domain: domain, type: "TXT", name: record.name, content: record.content, ttl: 1, priority: nil) {
                case .success:
                    continue
                case .failure(let error):
                    mtaStsError = mtaStsDNSMessage(for: error)
                    return
                }
            }
        }
    }

    private func mtaStsDNSMessage(for error: DomainOperationError) -> String {
        switch error {
        case .noToken:
            return "No Cloudflare API token found. Add one in Settings → Credentials."
        case .zoneNotFound(let domain):
            return "Zone not found for \(domain). Check that the mail domain is managed in Cloudflare."
        case .cloudflare(let error):
            return "Couldn't update MTA-STS DNS records: \(error.localizedDescription)"
        }
    }

    func setCloudflareAnalyticsEnabled(_ enabled: Bool) async {
        if !enabled {
            analyticsSettings.cloudflareToken = ""
            _ = await saveAnalytics()
            return
        }
        guard !isConfiguringCloudflareAnalytics else { return }
        isConfiguringCloudflareAnalytics = true
        analyticsError = nil
        defer { isConfiguringCloudflareAnalytics = false }

        do {
            guard let token = try await cloudflareToken(), !token.isEmpty else {
                analyticsError = CloudflareWebAnalyticsError.missingToken.localizedDescription
                return
            }
            let config = try WebsiteAnalyticsAsset.loadConfig(siteDirectory: sourceDirectory)
            let fallbackHost = "\(SiteSlug.derive(from: initialWebsiteTitle)).workers.dev"
            let host = WebsiteAnalyticsAsset.bestHost(from: config, fallback: fallbackHost)
            let siteTag = try await analyticsProvider.siteTag(for: host, apiToken: token)
            analyticsSettings.cloudflareToken = siteTag
            _ = await saveAnalytics()
        } catch {
            analyticsError = error.localizedDescription
        }
    }

    /// Also returns the raw `.site-config` contents alongside the parsed analytics settings, so
    /// `load()` can reuse them for `CrawlerPolicyAsset.parseSettings` instead of reading the file
    /// from disk a second time.
    private static func loadAnalyticsSettings(
        sourceDirectory: URL
    ) throws -> (settings: WebsiteAnalyticsAsset.Settings, config: String) {
        let layoutURL = sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.layoutRelativePath)
        let config = try WebsiteAnalyticsAsset.loadConfig(siteDirectory: sourceDirectory)
        guard FileManager.default.fileExists(atPath: layoutURL.path) else {
            return (WebsiteAnalyticsAsset.parseMigratingLegacySettings(layoutSource: "", config: config), config)
        }
        let source = try String(contentsOf: layoutURL, encoding: .utf8)
        return (WebsiteAnalyticsAsset.parseMigratingLegacySettings(layoutSource: source, config: config), config)
    }

    private func cloudflareToken() async throws -> String? {
        do {
            if let token = try keychain.readCloudflareToken(), !token.isEmpty {
                return token
            }
        } catch {
            if cloudflareEnvironmentToken() == nil {
                throw error
            }
            await LogCenter.shared.append(
                source: "analytics",
                stream: .stderr,
                text: "Could not read Cloudflare API token from Keychain; falling back to CLOUDFLARE_API_TOKEN."
            )
        }
        if let env = cloudflareEnvironmentToken() {
            await LogCenter.shared.append(
                source: "analytics",
                stream: .stderr,
                text: "Using CLOUDFLARE_API_TOKEN environment fallback for Cloudflare Analytics."
            )
            return env
        }
        return nil
    }

    private func cloudflareEnvironmentToken() -> String? {
        let token = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let token, !token.isEmpty else { return nil }
        return token
    }

    private static func isWebsiteTitleEntry(_ entry: PlistDocumentIO.PlistEntry) -> Bool {
        entry.key == "AnglesiteDisplayName" || entry.key == "displayName"
    }

    func entriesForSaving() -> [PlistDocumentIO.PlistEntry] {
        var merged = allEntries.filter { !Self.isWebsiteTitleEntry($0) }
        merged.append(contentsOf: entries)
        return merged
    }

    // MARK: - Workers tab actions (#710)
    //
    // Deliberately NOT a `DirtyFacet` below: worker toggles save at interaction time
    // (`setWorkerActive`), so this facet is never dirty and never participates in the
    // save-on-leave/⌘S aggregation.

    /// Loads everything the Workers tab shows: persisted `SiteSettings`, the worker catalog
    /// (network fetch with cache/empty degradation inside `WorkerCatalogFetcher`), and per-
    /// component-tied-worker affected pages via `ImpactAnalysis` over the Site Graph snapshot.
    /// Called from the tab's `.task`, so it re-runs (and re-fetches) on each tab open.
    func loadWorkers() async {
        guard let configDirectory else {
            workerGroups = []
            workersError = String(
                localized: "Workers are unavailable for this site — its package configuration folder couldn't be found.")
            return
        }
        isLoadingWorkers = true
        defer { isLoadingWorkers = false }
        let settings = (try? await SiteConfigStore(configDirectory: configDirectory).load()) ?? SiteSettings()
        workerSettings = settings
        workerLastDeployedIDs = settings.lastDeployedWorkerIDs ?? []
        let catalog = await workerCatalogProvider()
        let snapshot = graphSnapshotProvider()
        workerGroups = Self.workerGroups(catalog: catalog, settings: settings, snapshot: snapshot)
        workersError = catalog.isEmpty
            ? String(localized: "The worker catalog couldn't be loaded. Check your network connection and reopen this tab.")
            : nil
    }

    /// Persists a settings-activated worker toggle immediately (design doc §8): read-modify-write
    /// of `Config/settings.plist` so concurrently written fields (e.g. a deploy updating
    /// `lastDeployedWorkerIDs`) aren't clobbered, then notifies the runtime so a live local
    /// wrangler-dev session restarts with the new active set (§7).
    func setWorkerActive(_ workerID: String, isOn: Bool) async {
        guard let configDirectory else { return }
        let store = SiteConfigStore(configDirectory: configDirectory)
        var settings = (try? await store.load()) ?? workerSettings
        var ids = Set(settings.activeWorkerIDs ?? [])
        if isOn { ids.insert(workerID) } else { ids.remove(workerID) }
        settings.activeWorkerIDs = ids.sorted()
        do {
            try await store.save(settings)
        } catch {
            workersError = String(localized: "Couldn't save the worker change: \(error.localizedDescription)")
            return
        }
        workerSettings = settings
        workersError = nil
        for groupIndex in workerGroups.indices {
            for rowIndex in workerGroups[groupIndex].rows.indices
            where workerGroups[groupIndex].rows[rowIndex].id == workerID {
                workerGroups[groupIndex].rows[rowIndex].status = .settingsActivated(isOn: isOn)
            }
        }
        await onActiveWorkersChanged(settings)
    }

    /// Dashboard deep-links are enabled only after the first deploy that included a worker
    /// (design doc §8) — before that there is nothing on Cloudflare to look at.
    var workerDashboardEnabled: Bool { !workerLastDeployedIDs.isEmpty }

    /// The deployed worker script is named after the site slug — the same derivation the deploy
    /// path uses (`SiteOperations`/`DeployModel`: `SiteSlug.derive(from: site.name)`).
    var workerDashboardLogsURL: URL {
        WorkerDashboardLinks.productionLogsURL(workerName: SiteSlug.derive(from: initialWebsiteTitle))
    }

    var workerDashboardAnalyticsURL: URL {
        WorkerDashboardLinks.analyticsURL(workerName: SiteSlug.derive(from: initialWebsiteTitle))
    }

    private static func workerGroups(
        catalog: [WorkerDescriptor],
        settings: SiteSettings,
        snapshot: SiteGraphExplorerSnapshot?
    ) -> [WorkerGroup] {
        let activeIDs = Set(settings.activeWorkerIDs ?? [])
        let rows = catalog.map { descriptor -> (group: String, row: WorkerRow) in
            let status: WorkerRow.Status
            switch descriptor.binding {
            case .componentTied(let componentIDs):
                status = .componentTied(affectedPages: affectedPages(
                    componentIDs: componentIDs, snapshot: snapshot))
            case .settingsActivated:
                status = .settingsActivated(isOn: activeIDs.contains(descriptor.id))
            }
            return (descriptor.group, WorkerRow(descriptor: descriptor, status: status))
        }
        return Dictionary(grouping: rows, by: \.group)
            .map { key, members in
                WorkerGroup(
                    id: key, name: key,
                    rows: members.map(\.row).sorted {
                        let byName = $0.descriptor.displayName.localizedStandardCompare($1.descriptor.displayName)
                        if byName != .orderedSame { return byName == .orderedAscending }
                        return $0.id < $1.id
                    })
            }
            .sorted { $0.id < $1.id }
    }

    /// Union of `ImpactAnalysis.affectedPages` across every graph node a worker's componentIDs
    /// resolve to, deduplicated by node id and title-sorted (id tiebreak) for stable display.
    private static func affectedPages(
        componentIDs: [String], snapshot: SiteGraphExplorerSnapshot?
    ) -> [SiteGraphNode] {
        guard let snapshot else { return [] }
        var byID: [String: SiteGraphNode] = [:]
        for componentID in componentIDs {
            for nodeID in WorkerActivation.componentNodeIDs(for: componentID, in: snapshot) {
                guard let report = ImpactAnalysis.analyze(snapshot: snapshot, targetID: nodeID) else { continue }
                for page in report.affectedPages { byID[page.id] = page }
            }
        }
        return byID.values.sorted {
            let byTitle = $0.title.localizedStandardCompare($1.title)
            if byTitle != .orderedSame { return byTitle == .orderedAscending }
            return $0.id < $1.id
        }
    }

    // MARK: - Aggregate dirty/save seam (#741)

    /// One independently dirty/saveable settings-pane facet hosted by this plist editor — one
    /// each for Website (`entries`), Analytics, and Redirects. `SiteWindowModel`'s aggregate
    /// dirty/save accounting (`hasUnsavedEdits`, `editCommandInFlight`, `saveAllEdits()`) folds
    /// over `dirtyFacets` instead of checking each pane by name, so a future settings pane (e.g. a
    /// `.well-known` tab) is registered here and needs no edits anywhere else — including
    /// `SiteWindowModel`'s save/close switch statements.
    private struct DirtyFacet {
        let isDirty: Bool
        let isSaving: Bool
        let save: () async -> Void
    }

    private var dirtyFacets: [DirtyFacet] {
        [
            DirtyFacet(isDirty: isDirty, isSaving: isSaving) { await self.save() },
            DirtyFacet(isDirty: isAnalyticsDirty, isSaving: isSavingAnalytics) { await self.saveAnalytics() },
            DirtyFacet(isDirty: isRedirectsDirty, isSaving: isSavingRedirects) { await self.saveRedirects() },
            DirtyFacet(isDirty: isCrawlerPolicyDirty, isSaving: isSavingCrawlerPolicy) { await self.saveCrawlerPolicy() },
            DirtyFacet(isDirty: isMtaStsDirty, isSaving: isSavingMtaSts) { await self.saveMtaSts() },
        ]
    }

    /// True if any settings-pane facet has unsaved edits.
    var hasAnyUnsavedEdits: Bool { dirtyFacets.contains { $0.isDirty } }

    /// True while any settings-pane facet's own save is in flight.
    var isAnySaving: Bool { dirtyFacets.contains { $0.isSaving } }

    /// Saves every currently-dirty settings-pane facet. Each facet's own `save()` keeps its
    /// existing validation and error reporting (e.g. a validation failure just leaves that facet
    /// dirty with its own error string set) — one facet failing to save does not block the others.
    func saveAllDirty() async {
        for facet in dirtyFacets where facet.isDirty {
            await facet.save()
        }
    }
}
