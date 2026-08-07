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
    var langSettings = SiteLanguageAsset.Settings()
    private(set) var savedLangSettings = SiteLanguageAsset.Settings()
    private(set) var langError: String?
    private(set) var isSavingLang = false
    var redirectEntries: [RedirectsStore.RedirectEntry] = []
    private(set) var savedRedirectEntries: [RedirectsStore.RedirectEntry] = []
    private(set) var redirectsError: String?
    private(set) var isSavingRedirects = false
    private(set) var redirectsLoadFailed = false
    var conflictDiskContents: String?
    var licensingPolicy = LicensingPolicy() {
        didSet {
            // The clamp lives here rather than in each picker's binding so there is exactly one
            // place a permit-and-block contradiction can be introduced, and it cannot survive.
            // Unlike a plain stored property, `@Observable`'s macro-generated setter for
            // `licensingPolicy` routes *any* write to one of its fields — including this one to
            // `.usage` — back through the whole property's own setter, re-entering `didSet`.
            // `.clamped` is idempotent, so the guard here is what actually stops the recursion:
            // without it, the reentrant `didSet` reassigns unconditionally, re-enters itself
            // again, and blows the stack (confirmed with a real SIGSEGV/stack-overflow crash).
            let clamped = licensingPolicy.usage.clamped
            if clamped != licensingPolicy.usage {
                licensingPolicy.usage = clamped
            }
        }
    }
    private(set) var savedLicensingPolicy = LicensingPolicy()
    private(set) var licensingError: String?
    private(set) var isSavingLicensing = false
    private(set) var licensingLoadFailed = false
    var mtaStsSettings = MTAStsPolicyAsset.Settings()
    private(set) var savedMtaStsSettings = MTAStsPolicyAsset.Settings()
    private(set) var mtaStsError: String?
    private(set) var isSavingMtaSts = false
    private(set) var isPublishingMtaStsDNS = false
    private let domainOperations: any DomainOperationsService
    var securityReportingSettings = SecurityReportingAsset.Settings()
    private(set) var savedSecurityReportingSettings = SecurityReportingAsset.Settings()
    private(set) var securityReportingError: String?
    private(set) var isSavingSecurityReporting = false
    private(set) var isCheckingRepoSecurity = false
    private(set) var isAdoptingAdvisoryForm = false
    private(set) var securityReportingReadiness: SecurityReportingReadiness = .unknown
    private(set) var securityReportingRepo: RemoteRepo?
    /// Last known repo visibility. `.alreadyConfigured` doesn't distinguish public from private
    /// (deliberately — the setup is done either way), so the view needs this to warn an owner who
    /// published the advisory form and *then* made the repository private.
    private(set) var securityReportingRepoIsPrivate = false
    /// Last known private-vulnerability-reporting state. `.alreadyConfigured` doesn't distinguish
    /// PVR on from off either (same reason as `securityReportingRepoIsPrivate`), so the view needs
    /// this to warn an owner whose published contact routes to a form the repo can't receive —
    /// e.g. PVR was never turned on, or was switched off on github.com after the contact was set.
    private(set) var securityReportingPVREnabled = false
    /// True once `securityReportingRepoIsPrivate`/`securityReportingPVREnabled` have actually been
    /// populated by a successful check of the *current* repo. `recordCheckFailure(...)` can put
    /// readiness at `.alreadyConfigured` from the local contacts list alone, with no network call
    /// — so on a first-ever failed check (or after the remote changes), those two flags are still
    /// their unpopulated `false` defaults. The view must not render either sub-warning from that
    /// unpopulated data, which would assert PVR/visibility state nobody actually observed.
    private(set) var securityReportingStateIsKnown = false
    private let repoSecurity: any RepoSecurityReading & RepoSecurityWriting
    private let gitRunner: BackupCommand.GitRunner
    private let githubToken: @Sendable () throws -> String?

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

    /// The ActivityPub handle text field's current value (#1239) — pre-filled with
    /// `DeployCoordinator.resolveEffectiveActivityPubUsername` (the `.site-config` `AP_USERNAME`
    /// override, or the hostname-derived default) by `loadWorkers()`. Mutable (like
    /// `websiteTitle`) so the Workers tab can bind a `TextField` to it directly for live typing;
    /// `saveActivityPubUsername(_:)` is the explicit commit step, called on blur/submit.
    var activityPubUsername = ""
    /// The advisory lock (design doc §"Owner-chosen username"): once the actor has federated
    /// (`DeployCoordinator.isActivityPubHandleLocked`), the field goes read-only in the UI.
    /// `Source/` stays a plain, hand-editable git repo regardless (CLAUDE.md "Git is the source
    /// of truth") — deploy-time rename detection (`saveActivityPubUsername`'s sibling concern on
    /// the deploy path) is the real backstop, not this flag.
    private(set) var activityPubUsernameLocked = false
    private(set) var activityPubUsernameError: String?

    private let configDirectory: URL?
    private let workerCatalogProvider: @Sendable () async -> [WorkerDescriptor]
    private let graphSnapshotProvider: @MainActor () -> SiteGraphExplorerSnapshot?
    private let onActiveWorkersChanged: (SiteSettings) async -> Void

    var isDirty: Bool { entries != savedEntries && loadError == nil && !isLoading }
    var isAnalyticsDirty: Bool { analyticsSettings != savedAnalyticsSettings && loadError == nil && !isLoading }
    var isLangDirty: Bool { langSettings != savedLangSettings && loadError == nil && !isLoading }
    var isRedirectsDirty: Bool { redirectEntries != savedRedirectEntries && loadError == nil && !isLoading }
    var isLicensingDirty: Bool { licensingPolicy != savedLicensingPolicy && loadError == nil && !isLoading }
    var isMtaStsDirty: Bool { mtaStsSettings != savedMtaStsSettings && loadError == nil && !isLoading }
    var isSecurityReportingDirty: Bool {
        securityReportingSettings != savedSecurityReportingSettings && loadError == nil && !isLoading
    }
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
         customAnalyticsValidator: (any CustomAnalyticsHTMLValidating)? = nil,
         containerControlProvider: @escaping AstroHTMLValidator.ContainerControlProvider = { nil },
         keychain: KeychainStore = KeychainStore(),
         domainOperations: any DomainOperationsService = DomainOperations(),
         repoSecurity: any RepoSecurityReading & RepoSecurityWriting = HTTPGitHubClient(),
         gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner,
         githubToken: @escaping @Sendable () throws -> String? = { try KeychainStore().readGitHubToken() }) {
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
        // `customAnalyticsValidator` lets tests inject a fake directly; production leaves it nil
        // and instead wires `containerControlProvider` through to the real `AstroHTMLValidator`,
        // resolved lazily at validation time (#961).
        self.customAnalyticsValidator = customAnalyticsValidator
            ?? AstroHTMLValidator(containerControlProvider: containerControlProvider)
        self.keychain = keychain
        self.domainOperations = domainOperations
        self.repoSecurity = repoSecurity
        self.gitRunner = gitRunner
        self.githubToken = githubToken
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
            do {
                let policy = try LicensingStore(sourceDirectory: sourceDirectory).load()
                licensingPolicy = policy
                savedLicensingPolicy = policy
                licensingError = nil
                licensingLoadFailed = false
            } catch {
                licensingPolicy = LicensingPolicy()
                savedLicensingPolicy = LicensingPolicy()
                licensingError = "Couldn't load existing licensing.json — it may be corrupted or hand-edited. Fix it externally or your next save will discard it. (\(error.localizedDescription))"
                licensingLoadFailed = true
            }
            let lang = SiteLanguageAsset.parseSettings(from: config)
            langSettings = lang
            savedLangSettings = lang
            langError = nil
            let mtaSts = MTAStsPolicyAsset.parseSettings(from: config)
            mtaStsSettings = mtaSts
            savedMtaStsSettings = mtaSts
            mtaStsError = nil
            let securityReporting = SecurityReportingAsset.parseSettings(from: config)
            securityReportingSettings = securityReporting
            savedSecurityReportingSettings = securityReporting
            securityReportingError = nil
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
        if isLangDirty {
            guard await saveLang() else { return false }
        }
        if isRedirectsDirty {
            guard await saveRedirects() else { return false }
        }
        if isLicensingDirty {
            guard await saveLicensing() else { return false }
        }
        if isMtaStsDirty {
            guard await saveMtaSts() else { return false }
        }
        if isSecurityReportingDirty { return await saveSecurityReporting() }
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
    func saveLicensing() async -> Bool {
        guard isLicensingDirty else { return true }
        guard !isSavingLicensing else { return false }
        guard !licensingLoadFailed else {
            licensingError = "Refusing to save: the existing licensing.json failed to load and may contain rules this save would discard. Fix or back up the file, then reload this site's settings."
            return false
        }
        isSavingLicensing = true
        licensingError = nil
        defer { isSavingLicensing = false }
        let sourceDirectory = sourceDirectory
        // Canonicalize before persisting: an empty-URL default license (the transient "Custom…
        // selected, nothing typed yet" state `ContentLicensingTab` can otherwise leave behind) is
        // "no license", the same as nil (#991 review finding 1). Writing the canonical value back
        // into both `licensingPolicy` and `savedLicensingPolicy` keeps the in-memory model
        // matching what's actually on disk, the same way `saveMtaSts` writes back its normalized
        // settings above.
        let policy = LicensingStore.normalized(licensingPolicy)
        do {
            try await Task.detached(priority: .userInitiated) {
                try LicensingStore(sourceDirectory: sourceDirectory).save(policy)
            }.value
            licensingPolicy = policy
            savedLicensingPolicy = policy
            return true
        } catch LicensingStore.ValidationError.unsafeLicenseURL(let url) {
            licensingError = "\"\(url)\" isn't a usable license address. Use an https:// URL or a path on this site starting with /."
            return false
        } catch {
            licensingError = "Couldn't save content licensing: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    func saveLang() async -> Bool {
        guard isLangDirty else { return true }
        guard !isSavingLang else { return false }
        isSavingLang = true
        langError = nil
        defer { isSavingLang = false }
        let sourceDirectory = sourceDirectory
        let settings = SiteLanguageAsset.Settings(lang: langSettings.lang)
        do {
            try await Task.detached(priority: .userInitiated) {
                try SiteLanguageAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            langSettings = settings
            savedLangSettings = settings
            return true
        } catch {
            langError = "Couldn't save website language: \(error.localizedDescription)"
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

    @discardableResult
    func saveSecurityReporting() async -> Bool {
        guard isSecurityReportingDirty else { return true }
        guard !isSavingSecurityReporting else { return false }
        isSavingSecurityReporting = true
        securityReportingError = nil
        defer { isSavingSecurityReporting = false }
        let sourceDirectory = sourceDirectory
        let settings = securityReportingSettings
        do {
            try await Task.detached(priority: .userInitiated) {
                try SecurityReportingAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            let canonical = SecurityReportingAsset.Settings(
                contacts: SecurityReportingAsset.normalizedContacts(settings.contacts).joined(separator: "\n"),
                mode: settings.mode)
            securityReportingSettings = canonical
            savedSecurityReportingSettings = canonical
            return true
        } catch {
            securityReportingError = "Couldn't save security reporting settings: \(error.localizedDescription)"
            return false
        }
    }

    /// Re-reads the site's GitHub remote and the repo settings that decide whether its private
    /// advisory form is usable. Called when the tab loads and after a successful enable — never
    /// on a timer, and never as a side effect of saving.
    func refreshRepoSecurityState() async {
        guard !isCheckingRepoSecurity else { return }
        isCheckingRepoSecurity = true
        defer { isCheckingRepoSecurity = false }
        securityReportingError = nil

        let repo = await currentRemoteRepo()
        if repo != securityReportingRepo {
            securityReportingStateIsKnown = false
        }
        securityReportingRepo = repo
        guard let repo else {
            securityReportingReadiness = .notGitHub
            return
        }

        let token: String?
        do {
            token = try githubToken()
        } catch {
            securityReportingError = "Couldn't read the GitHub token from the Keychain: \(error.localizedDescription)"
            recordCheckFailure(for: repo)
            return
        }
        guard let token, !token.isEmpty else {
            securityReportingError = "Connect a GitHub account in Settings to check this repository's reporting setup."
            recordCheckFailure(for: repo)
            return
        }

        do {
            // A failure here must not fall through to `.notGitHub` — that would falsely claim the
            // site has no GitHub remote when the truth is "we couldn't check".
            let isPrivate = try await repoSecurity.isPrivate(owner: repo.owner, name: repo.name, token: token)
            let pvrEnabled = try await repoSecurity.privateVulnerabilityReporting(
                owner: repo.owner, name: repo.name, token: token)
            securityReportingRepoIsPrivate = isPrivate
            securityReportingPVREnabled = pvrEnabled
            securityReportingStateIsKnown = true
            securityReportingReadiness = .evaluate(
                repo: repo, isPrivate: isPrivate, pvrEnabled: pvrEnabled,
                contacts: securityReportingSettings.contacts)
        } catch {
            securityReportingError = repoSecurityMessage(for: error)
            recordCheckFailure(for: repo)
        }
    }

    /// Applies what a failed check can still determine without the network call that just
    /// failed: whether `contacts` already lists this repo's advisory form is a local string
    /// comparison, so a failure doesn't have to erase that fact. Otherwise this leaves
    /// `securityReportingReadiness` alone — the previous value if one was ever successfully
    /// determined, or the `.unknown` default if this is the first check and it never got there.
    /// Either way, it must never collapse to `.notGitHub`, which would falsely claim the site has
    /// no GitHub remote when the truth is "we couldn't check".
    private func recordCheckFailure(for repo: RemoteRepo) {
        if SecurityReportingAsset.usesAdvisoryForm(securityReportingSettings.contacts, repo: repo) {
            securityReportingReadiness = .alreadyConfigured
        }
    }

    /// Publishes the repo's advisory form as the most-preferred contact, enabling private
    /// vulnerability reporting first when it's off. The view confirms before calling this —
    /// enabling PVR changes a GitHub repository setting.
    func adoptAdvisoryForm() async {
        guard !isAdoptingAdvisoryForm else { return }
        guard let repo = securityReportingRepo else { return }
        // Manual mode: `planSecurityTxt` never generates security.txt for this site (the owner
        // hand-maintains it), so publishing a contact — and enabling PVR to back it — would claim
        // a routing that doesn't exist. The view already refuses to offer this action in manual
        // mode; this guard is defense in depth so the write can't happen even if it's called
        // directly.
        guard securityReportingSettings.mode != .manual else { return }
        isAdoptingAdvisoryForm = true
        defer { isAdoptingAdvisoryForm = false }
        securityReportingError = nil

        if securityReportingReadiness == .needsPVR {
            guard await enablePVR(owner: repo.owner, name: repo.name) else { return }
            // PVR is now genuinely enabled on GitHub even if the save below fails — leaving
            // readiness at `.needsPVR` here would lie to the view about the repo's real state.
            securityReportingReadiness = .ready
        }

        securityReportingSettings.contacts = SecurityReportingAsset.prependingAdvisoryForm(
            securityReportingSettings.contacts, repo: repo)
        if securityReportingSettings.mode == .disabled { securityReportingSettings.mode = .generated }
        guard await saveSecurityReporting() else { return }
        securityReportingReadiness = .alreadyConfigured
    }

    /// Enables private vulnerability reporting for a repo whose advisory form is *already*
    /// published as a contact (`.alreadyConfigured` with PVR off — e.g. it was never turned on,
    /// or was switched off on github.com after the contact was set). The contact list needs no
    /// change here, only the GitHub setting the tab is warning about. The view confirms before
    /// calling this, same as the `.needsPVR` enable step inside `adoptAdvisoryForm()`.
    @discardableResult
    func enablePrivateVulnerabilityReportingForConfiguredRepo() async -> Bool {
        guard !isAdoptingAdvisoryForm, let repo = securityReportingRepo else { return false }
        isAdoptingAdvisoryForm = true
        defer { isAdoptingAdvisoryForm = false }
        securityReportingError = nil
        return await enablePVR(owner: repo.owner, name: repo.name)
    }

    /// Shared PVR-enable request behind `adoptAdvisoryForm()`'s `.needsPVR` step and
    /// `enablePrivateVulnerabilityReportingForConfiguredRepo()`. Updates
    /// `securityReportingPVREnabled` on success so an `.alreadyConfigured` warning clears without
    /// a full `refreshRepoSecurityState()` round-trip.
    private func enablePVR(owner: String, name: String) async -> Bool {
        let token: String?
        do { token = try githubToken() } catch {
            securityReportingError = "Couldn't read the GitHub token from the Keychain: \(error.localizedDescription)"
            return false
        }
        guard let token, !token.isEmpty else {
            securityReportingError = "Connect a GitHub account in Settings to enable private vulnerability reporting."
            return false
        }
        do {
            try await repoSecurity.enablePrivateVulnerabilityReporting(owner: owner, name: name, token: token)
        } catch {
            securityReportingError = repoSecurityMessage(for: error)
            return false
        }
        securityReportingPVREnabled = true
        return true
    }

    private func currentRemoteRepo() async -> RemoteRepo? {
        guard let result = try? await gitRunner(sourceDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }

    private func repoSecurityMessage(for error: any Error) -> String {
        guard let apiError = error as? GitHubRepoAPIError else {
            return "Couldn't check this repository's reporting setup: \(error.localizedDescription)"
        }
        switch apiError {
        case .unauthorized:
            return "Your GitHub token doesn't have admin access to this repository. Enable private vulnerability reporting in the repository's Settings ▸ Advanced Security, or use a token with Administration: Read and write."
        case .network:
            return "Couldn't reach GitHub. Check your connection and try again."
        case .http(let status):
            return "GitHub returned an unexpected response (HTTP \(status))."
        case .api(let message):
            return "GitHub rejected the request: \(message)"
        case .malformedResponse, .nameAlreadyExists:
            return "GitHub returned an unexpected response."
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
                switch await domainOperations.addRecord(domain: domain, type: "TXT", name: record.name, content: record.content, ttl: 1, priority: nil, purpose: DomainRecordPurpose.Email.mtaSTS, sourceDirectory: sourceDirectory) {
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
    /// `load()` can reuse them for `MTAStsPolicyAsset.parseSettings`/`SecurityReportingAsset.parseSettings`
    /// instead of reading the file from disk a second time.
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
    ///
    /// Displays the *resolved* active set (`DeployCoordinator.resolveActiveWorkerIDs`), not
    /// `Config/`'s raw `activeWorkerIDs` (#1172 review follow-up): a hand-edited `anglesite.json`
    /// declaration the deploy path is about to trust would otherwise be invisible here, leaving
    /// the owner unable to see — or knowingly toggle off — a worker that's actually about to
    /// deploy.
    func loadWorkers() async {
        guard let configDirectory else {
            workerGroups = []
            workersError = String(
                localized: "Workers are unavailable for this site — its package configuration folder couldn't be found.")
            return
        }
        isLoadingWorkers = true
        defer { isLoadingWorkers = false }
        var settings = (try? await SiteConfigStore(configDirectory: configDirectory).load()) ?? SiteSettings()
        let (resolvedActiveWorkerIDs, _) = DeployCoordinator.resolveActiveWorkerIDs(
            settings: settings, sourceDirectory: sourceDirectory
        )
        settings.activeWorkerIDs = resolvedActiveWorkerIDs
        workerSettings = settings
        workerLastDeployedIDs = settings.lastDeployedWorkerIDs ?? []
        let catalog = await workerCatalogProvider()
        let snapshot = graphSnapshotProvider()
        workerGroups = Self.workerGroups(catalog: catalog, settings: settings, snapshot: snapshot)
        workersError = catalog.isEmpty
            ? String(localized: "The worker catalog couldn't be loaded. Check your network connection and reopen this tab.")
            : nil
        activityPubUsername = DeployCoordinator.resolveEffectiveActivityPubUsername(siteDirectory: sourceDirectory) ?? ""
        activityPubUsernameError = nil
        // `siteURL` is nilable here (an unresolvable/malformed site URL doesn't skip the check,
        // it just narrows it to the local outbox ledger) — see `isActivityPubHandleLocked`'s own
        // doc comment for why that matters.
        let siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: sourceDirectory).flatMap(URL.init(string:))
        activityPubUsernameLocked = await DeployCoordinator.isActivityPubHandleLocked(
            siteURL: siteURL, configDirectory: configDirectory
        )
    }

    /// Persists the ActivityPub handle override to `.site-config`'s `AP_USERNAME` key (#1239),
    /// validating at entry per the design doc (`DeployCoordinator.isValidActivityPubUsername` —
    /// the same grammar `worker.ts` re-checks at request time). Lowercased before comparing or
    /// writing — the grammar is case-insensitive, but WebFinger's local-part lookup is
    /// exact-match case-sensitive (RFC 7565), so a mixed-case value would only resolve at that
    /// exact casing (`worker.ts`'s `resolvePreferredUsername` does the same normalization); this
    /// also keeps the displayed field in sync with what `resolveEffectiveActivityPubUsername`
    /// resolves after a reload. A value equal to the hostname-derived default is deduped — the
    /// key is removed rather than written, so `.site-config` doesn't grow a redundant line every
    /// time an owner types the default back in. No-ops when the handle is locked; the UI disables
    /// the field in that state, so this would only be reached via a bypass.
    func saveActivityPubUsername(_ newValue: String) {
        guard !activityPubUsernameLocked else { return }
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty || DeployCoordinator.isValidActivityPubUsername(trimmed) else {
            activityPubUsernameError = String(localized: "Handles can only contain letters, numbers, underscores, periods, and hyphens.")
            return
        }
        activityPubUsernameError = nil
        let normalized = trimmed.lowercased()
        let defaultUsername = DeployCoordinator.defaultActivityPubUsername(siteDirectory: sourceDirectory)
        let configURL = sourceDirectory.appendingPathComponent(".site-config")
        let existing = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated: String
        if normalized.isEmpty || normalized == defaultUsername {
            updated = SiteConfigFile.remove(["AP_USERNAME"], from: existing)
            activityPubUsername = defaultUsername ?? ""
        } else {
            updated = SiteConfigFile.upsert([("AP_USERNAME", normalized)], into: existing)
            activityPubUsername = normalized
        }
        guard updated != existing else { return }
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Persists a settings-activated worker toggle immediately (design doc §8): read-modify-write
    /// of `Config/settings.plist` so concurrently written fields (e.g. a deploy updating
    /// `lastDeployedWorkerIDs`) aren't clobbered, then notifies the runtime so a live local
    /// wrangler-dev session restarts with the new active set (§7).
    ///
    /// Also write-throughs the new `activeWorkerIDs` into `Source/anglesite.json`'s `workers.active`
    /// declaration (#1172, `DeployCoordinator.syncWorkerActivationToAnglesiteJSON`) — best-effort,
    /// like every other `anglesite.json` write-through: a git-tracked-file write failure must never
    /// turn an already-succeeded `Config/` toggle into a reported failure.
    ///
    /// Toggles from `DeployCoordinator.toggledActiveWorkerIDs`'s resolved base, not `Config/`'s raw
    /// `activeWorkerIDs` (#1172 review follow-up) — see that function's doc comment for why a plain
    /// `Config/`-only toggle would silently drop a trusted hand edit to the declaration.
    func setWorkerActive(_ workerID: String, isOn: Bool) async {
        guard let configDirectory else { return }
        let store = SiteConfigStore(configDirectory: configDirectory)
        var settings = (try? await store.load()) ?? workerSettings
        settings.activeWorkerIDs = DeployCoordinator.toggledActiveWorkerIDs(
            workerID: workerID, isOn: isOn, settings: settings, sourceDirectory: sourceDirectory
        )
        do {
            try await store.save(settings)
        } catch {
            workersError = String(localized: "Couldn't save the worker change: \(error.localizedDescription)")
            return
        }
        settings = await DeployCoordinator.syncWorkerActivationToAnglesiteJSON(
            configStore: store, sourceDirectory: sourceDirectory, settings: settings
        )
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

    /// Whether ActivityPub is currently active — gates the handle field's visibility (#1239): it
    /// lives with the activation flow, not a buried always-visible setting the owner must
    /// discover before it means anything.
    var activityPubActive: Bool {
        workerGroups
            .flatMap(\.rows)
            .contains { row in
                row.id == WorkerComposition.activitypubWorkerID
                    && row.status == .settingsActivated(isOn: true)
            }
    }

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
            DirtyFacet(isDirty: isLangDirty, isSaving: isSavingLang) { await self.saveLang() },
            DirtyFacet(isDirty: isRedirectsDirty, isSaving: isSavingRedirects) { await self.saveRedirects() },
            DirtyFacet(isDirty: isLicensingDirty, isSaving: isSavingLicensing) { await self.saveLicensing() },
            DirtyFacet(isDirty: isMtaStsDirty, isSaving: isSavingMtaSts) { await self.saveMtaSts() },
            DirtyFacet(isDirty: isSecurityReportingDirty, isSaving: isSavingSecurityReporting) { await self.saveSecurityReporting() },
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
