import SwiftUI
import AppKit
import AnglesiteCore
import AnglesiteSiteModel

/// SwiftUI-facing wrapper around one site's `SyncScheduler`/`SyncEngine`/`SyncConflictResolver`
/// (#881). One per open site window, matching `SyncEngine`'s single-caller-per-package invariant
/// (`SiteWindowModel` owns exactly one `SyncModel`, same as `deploy`/`backup`).
///
/// **Thin by design.** Every debounce/coalescing/trigger decision lives in `SyncScheduler`
/// (AnglesiteCore, unit-tested in `SyncSchedulerTests`) — this type only renders its status and
/// forwards events the scheduler has no business knowing about: `NSMetadataQuery` bundle-change
/// observation, `NSApplication.didResignActiveNotification` for backgrounding, and the
/// backup/deploy completion hooks wired in `SiteWindowModel.init`.
///
/// **Eligibility gate.** `start(package:)` only stands up an engine/scheduler/query when
/// `ICloudSyncEligibility.isEligible(package:)` is true. A plain local package never gets any of
/// that — `status` stays `.idle` forever and nothing here ever touches the filesystem beyond that
/// one check, satisfying #881's "no sync activity for idle [local] sites".
@MainActor
@Observable
final class SyncModel {
    /// Mirrors `SyncScheduler.Status`. The scheduler is an actor SwiftUI can't observe directly,
    /// so this is kept in sync via the scheduler's `onStatusChange` callback.
    private(set) var status: SyncScheduler.Status = .idle
    /// `true` once this site's package was confirmed to live in iCloud Drive. `SiteWindow` uses
    /// this to hide the sync status affordance entirely for a local-only site, rather than
    /// showing a permanently-idle indicator that implies a feature which isn't active.
    private(set) var isEligible = false

    var resolutionSheetPresented = false
    private(set) var conflictedFiles: [SyncConflictResolver.ConflictedFile] = []
    /// Files iCloud dropped as `name 2.ext`-style conflict copies of plain `Source/` files
    /// (design doc §3, "Working-tree conflict copies"), quarantined by `SyncEngine.pull()` into
    /// `Config/conflicts/` — listed here so the resolution sheet can surface them too (#881 scope).
    private(set) var quarantinedFiles: [URL] = []
    var resolutionError: String?
    private(set) var isResolving = false

    private var package: AnglesitePackage?
    private var engine: SyncEngine?
    private var scheduler: SyncScheduler?
    private let resolver = SyncConflictResolver()
    private var metadataQuery: NSMetadataQuery?
    private var metadataObserver: (any NSObjectProtocol)?
    private var backgroundObserver: (any NSObjectProtocol)?

    /// Set by the banner's dismiss (✕) button — hides the banner without resolving anything;
    /// the sync status toolbar icon reopens the resolution sheet at any time. Reset automatically
    /// once the conflict is actually resolved, so a *future* conflict shows its own banner rather
    /// than staying silently suppressed by an old dismissal.
    private var bannerDismissed = false

    /// `true` while the non-blocking conflict banner should show — never gates editing (#881
    /// acceptance criteria: "conflict banner never blocks editing").
    var bannerPresented: Bool {
        guard case .needsAttention = status else { return false }
        return !bannerDismissed
    }

    func dismissBanner() {
        bannerDismissed = true
    }

    var conflict: SyncEngine.SyncConflict? {
        if case .needsAttention(let conflict) = status { return conflict }
        return nil
    }

    var statusLabel: String {
        switch status {
        case .idle: return isEligible ? "Not yet synced" : "Not synced with iCloud"
        case .syncing: return "Syncing…"
        case .synced: return "Synced"
        case .waitingForICloud: return "Waiting for iCloud…"
        case .needsAttention(let conflict):
            let count = conflict.conflictedPaths.count + quarantinedFiles.count
            return "\(count) file\(count == 1 ? "" : "s") need attention"
        case .failed(let reason): return "Sync problem: \(reason)"
        }
    }

    // MARK: - Lifecycle

    /// Called once per site open (`SiteWindowModel.loadAndStart`). Safe to call again on window
    /// replay — tears down any previous wiring first.
    func start(package: AnglesitePackage) {
        stop()
        self.package = package
        guard ICloudSyncEligibility.isEligible(package: package) else {
            isEligible = false
            status = .idle
            return
        }
        isEligible = true

        let engine = SyncEngine()
        self.engine = engine
        let scheduler = SyncScheduler(package: package, engine: engine) { [weak self] newStatus in
            Task { @MainActor in self?.apply(newStatus, for: package) }
        }
        self.scheduler = scheduler

        observeBundleChanges(package: package)
        observeAppBackground()
        refreshQuarantinedFiles()
        Task { await scheduler.siteOpened() }
    }

    /// Tears down this site's sync wiring — called from `SiteWindowModel.close()`. An in-flight
    /// push is left to finish (mirrors `close()`'s own treatment of Deploy/Backup/Audit): only the
    /// debounce timer and the observers are cancelled.
    func stop() {
        metadataQuery?.stop()
        metadataQuery = nil
        if let metadataObserver { NotificationCenter.default.removeObserver(metadataObserver) }
        metadataObserver = nil
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        backgroundObserver = nil
        if let scheduler {
            Task { await scheduler.stop() }
        }
        scheduler = nil
        engine = nil
        package = nil
        status = .idle
        isEligible = false
        resolutionSheetPresented = false
        conflictedFiles = []
        quarantinedFiles = []
        resolutionError = nil
        bannerDismissed = false
    }

    // MARK: - Push triggers (forwarded from BackupCommand/DeployModel completion + app background)

    func backupCompleted() {
        guard let scheduler else { return }
        Task { await scheduler.backupCompleted() }
    }

    func deployCompleted() {
        guard let scheduler else { return }
        Task { await scheduler.deployCompleted() }
    }

    // MARK: - Conflict resolution sheet

    /// Opens the resolution sheet: loads both sides' text for every conflicted path, and refreshes
    /// the quarantined-file listing so both surface together.
    func openResolutionSheet() {
        guard let package, let conflict else { return }
        resolutionError = nil
        refreshQuarantinedFiles()
        resolutionSheetPresented = true
        let resolver = resolver
        Task { @MainActor [weak self] in
            let files = await resolver.loadConflictedFiles(package: package, conflict: conflict)
            self?.conflictedFiles = files
        }
    }

    func dismissResolutionSheet() {
        resolutionSheetPresented = false
        resolutionError = nil
    }

    /// Commits `choices` (one `SyncConflictResolver.Choice` per conflicted path) as the merge
    /// resolution, acknowledges it with the engine so pushing resumes, and re-syncs. Leaves the
    /// sheet open with `resolutionError` set on failure so the user can adjust and retry.
    func resolve(choices: [String: SyncConflictResolver.Choice]) {
        guard let package, let conflict, let engine, let scheduler else { return }
        resolutionError = nil
        isResolving = true
        Task { @MainActor [weak self] in
            let outcome = await self?.resolver.resolve(package: package, conflict: conflict, choices: choices)
            self?.isResolving = false
            switch outcome {
            case .success:
                await engine.acknowledgeConflictResolved(package: package)
                self?.resolutionSheetPresented = false
                self?.conflictedFiles = []
                _ = await scheduler.conflictResolved()
            case .failure(let error):
                self?.resolutionError = error.description
            case .none:
                break
            }
        }
    }

    /// "Open both" (#881 scope): materializes both sides' content to a temp location and reveals
    /// them in Finder so the user can compare before choosing keep-mine/keep-theirs. Doesn't itself
    /// resolve anything — the user still picks a side afterward.
    func openBothVersions(for file: SyncConflictResolver.ConflictedFile) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AnglesiteSyncConflict-\(UUID().uuidString)", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)) != nil else { return }
        let stem = (file.path as NSString).lastPathComponent
        let mineURL = directory.appendingPathComponent("This Mac — \(stem)")
        let theirsURL = directory.appendingPathComponent("Other Mac — \(stem)")
        var revealed: [URL] = []
        if let oursText = file.oursText, (try? oursText.write(to: mineURL, atomically: true, encoding: .utf8)) != nil {
            revealed.append(mineURL)
        }
        if let theirsText = file.theirsText, (try? theirsText.write(to: theirsURL, atomically: true, encoding: .utf8)) != nil {
            revealed.append(theirsURL)
        }
        guard !revealed.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting(revealed)
    }

    // MARK: - Quarantined working-tree conflict copies

    private func refreshQuarantinedFiles() {
        guard let package else { quarantinedFiles = []; return }
        let directory = package.conflictsDirectoryURL
        let items = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        quarantinedFiles = items.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    func revealQuarantinedFile(_ url: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    /// Discards a quarantined conflict-copy permanently. Safe: the design doc's rationale for
    /// quarantining rather than deleting outright is that the real content already lives in git
    /// history by the time `SyncEngine.pull()` swept it here — this is cleanup of a redundant
    /// working-tree artifact, not the user's only copy of anything.
    func deleteQuarantinedFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
        refreshQuarantinedFiles()
    }

    // MARK: - Status bridging

    private func apply(_ newStatus: SyncScheduler.Status, for package: AnglesitePackage) {
        // Guard against a stale callback firing after `stop()`/`start()` moved on to a different
        // package (window replay) — `Task { @MainActor in ... }` in `start(package:)` can resume
        // after a subsequent `stop()`.
        guard self.package?.url == package.url else { return }
        status = newStatus
        if case .needsAttention = newStatus {
            refreshQuarantinedFiles()
        } else {
            bannerDismissed = false
        }
    }

    // MARK: - Observation wiring

    /// Watches `source.bundle` for changes via `NSMetadataQuery` while this site's window is open
    /// (design doc's "App wiring" paragraph). Scoped to this package's sync directory by path
    /// prefix in addition to filename — `NSMetadataItemPathKey` is only populated once iCloud has
    /// resolved the item's location, so an item this Mac has never seen download at all won't
    /// match until its first `NSMetadataQueryDidUpdate`; that's fine here because `siteOpened()`
    /// already ran an unconditional `pull()` when the window opened.
    private func observeBundleChanges(package: AnglesitePackage) {
        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDataScope]
        query.predicate = NSPredicate(
            format: "%K == %@ AND %K BEGINSWITH %@",
            NSMetadataItemFSNameKey, package.syncBundleURL.lastPathComponent,
            NSMetadataItemPathKey, package.syncDirectoryURL.path
        )
        metadataObserver = NotificationCenter.default.addObserver(
            forName: .NSMetadataQueryDidUpdate, object: query, queue: .main
        ) { [weak self] _ in
            guard let scheduler = self?.scheduler else { return }
            Task { await scheduler.bundleChanged() }
        }
        metadataQuery = query
        query.start()
    }

    /// #881: "debounced push()… on app background." `NSApplication.didResignActiveNotification`
    /// is the standard macOS "the app is no longer frontmost" signal — the closest equivalent to
    /// an iOS background transition for a Mac app that otherwise just keeps running.
    private func observeAppBackground() {
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let scheduler = self?.scheduler else { return }
            Task { await scheduler.appDidBackground() }
        }
    }
}
