import Testing
import Foundation
import AnglesiteCore
import AnglesiteSiteModel
import AnglesiteTestSupport
@testable import AnglesiteAppCore

/// Automates QA §5 ("Non-iCloud site: zero activity") from
/// `docs/qa/2026-07-27-icloud-sync-manual-qa.md` (epic #876, feature #881).
///
/// That whole section needs no real hardware and no production seam: a package under the system
/// temp directory genuinely isn't ubiquitous, so `ICloudSyncEligibility.isEligible(package:)` is
/// honestly `false` here for the same reason it is on a tester's external volume. The remaining
/// sections (§1–§4) all require two Macs on one iCloud account and stay manual.
///
/// The QA doc's §5.2 observation channel is the Debug Pane's `sync:*` log lines. These tests
/// deliberately do **not** assert against `LogCenter`: it's a process-wide ring buffer shared by
/// every suite in this bundle, so a log-emptiness assertion would be flaky under parallel
/// execution. "Zero sync activity" is asserted in its durable form instead — the model never
/// leaves `.idle`, and nothing is ever written under `Config/sync/`. Nothing can emit a `sync:*`
/// line without going through the scheduler/engine that those two facts prove was never built.
@Suite("SyncModel — non-iCloud site (QA §5)")
@MainActor
struct SyncModelTests {
    /// A real `.anglesite` skeleton under the system temp directory — i.e. a package that is
    /// genuinely not in a ubiquity container, matching QA §5.1's "package **outside** iCloud
    /// Drive". Returns the temp root too so the caller can clean it up.
    private func makeLocalPackage() throws -> (package: AnglesitePackage, root: URL) {
        let root = try makeTempDir(prefix: "sync-model-local")
        let packageURL = root.appendingPathComponent("Local Only.anglesite", isDirectory: true)
        let (package, _) = try AnglesitePackage.createSkeleton(at: packageURL, displayName: "Local Only")
        return (package, root)
    }

    private func fileExists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    /// QA §5.1: "The sync status toolbar icon does not appear at all (not even as a
    /// disabled/idle state)."
    ///
    /// `SyncStatusView.body` is wrapped in `if model.isEligible`, so `isEligible == false` is
    /// exactly the condition that makes the toolbar item render nothing. `statusLabel` is asserted
    /// alongside it because the ineligible branch produces different copy ("Not synced with
    /// iCloud") from the eligible-but-not-yet-pushed one ("Not yet synced") — swapping those would
    /// leave a still-hidden icon whose accessibility value claims the feature is merely pending.
    @Test("start() on a non-iCloud package leaves the sync UI ineligible and idle")
    func localPackageIsIneligibleAndIdle() throws {
        let (package, root) = try makeLocalPackage()
        defer { try? FileManager.default.removeItem(at: root) }

        // Guard the premise rather than the model: if a future CI runner ever ran tests from
        // inside a ubiquity container, the rest of this suite would be silently vacuous.
        #expect(ICloudSyncEligibility.isEligible(package: package) == false)

        let model = SyncModel()
        model.start(package: package)

        #expect(model.isEligible == false)
        #expect(model.status == .idle)
        #expect(model.statusLabel == "Not synced with iCloud")
    }

    /// QA §5.3: "Confirm `Config/sync/` is never created for this package… No
    /// `Config/sync/source.bundle` file exists on disk for a site that was never in iCloud."
    ///
    /// Opening the site is the step that would create them if the eligibility gate leaked, since
    /// `start(package:)` is what stands up the `SyncEngine`/`SyncScheduler` pair that writes the
    /// bundle.
    @Test("start() on a non-iCloud package creates no Config/sync artifacts")
    func localPackageCreatesNoSyncFilesOnDisk() throws {
        let (package, root) = try makeLocalPackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = SyncModel()
        model.start(package: package)

        #expect(fileExists(package.syncDirectoryURL) == false)
        #expect(fileExists(package.syncBundleURL) == false)
    }

    /// QA §5.2: "Watch the Debug Pane while using this site normally (editing, backing up,
    /// deploying). No `sync:push`/`sync:pull`/`sync:bootstrap` log lines ever appear for this
    /// site."
    ///
    /// `backupCompleted()` and `deployCompleted()` are the two push triggers a normal editing
    /// session fires (wired in `SiteWindowModel.init` from `BackupCommand`/`DeployModel`
    /// completion), so they stand in for "using this site normally". Both must be inert for an
    /// ineligible package — see the suite doc for why this asserts state and disk rather than
    /// `LogCenter`.
    @Test("backup/deploy completion triggers are inert for a non-iCloud package")
    func pushTriggersAreInertForALocalPackage() throws {
        let (package, root) = try makeLocalPackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = SyncModel()
        model.start(package: package)

        model.backupCompleted()
        model.deployCompleted()

        #expect(model.status == .idle)
        #expect(model.isEligible == false)
        #expect(fileExists(package.syncDirectoryURL) == false)
        #expect(fileExists(package.syncBundleURL) == false)
    }

    /// QA §5.1 + §2.4: none of the conflict UX can surface for a site that never syncs.
    ///
    /// §2.4's banner ("This site was edited on two Macs — N files need attention") and §2.5's
    /// resolution sheet are reachable only from a `.needsAttention` status, which an ineligible
    /// model can never reach. This pins the negative: the banner is not presented, both file lists
    /// are empty, and `openResolutionSheet()` — the action behind the banner button and the toolbar
    /// icon — is a no-op rather than presenting an empty sheet.
    @Test("no conflict banner, sheet, or file lists exist for a non-iCloud package")
    func conflictUIStaysAbsentForALocalPackage() throws {
        let (package, root) = try makeLocalPackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = SyncModel()
        model.start(package: package)

        #expect(model.bannerPresented == false)
        #expect(model.conflictedFiles.isEmpty)
        #expect(model.quarantinedFiles.isEmpty)
        #expect(model.resolutionSheetPresented == false)

        model.openResolutionSheet()
        #expect(model.resolutionSheetPresented == false)
    }

    /// QA §5 (implied): the section never mentions teardown, which only holds if closing a
    /// local-only site window is uneventful. `SiteWindowModel.close()` calls `stop()`
    /// unconditionally, including on a window whose site was never eligible — and `start()` itself
    /// opens with a `stop()`, so this also covers the never-started model.
    @Test("stop() is safe on a never-started model and on an ineligible one")
    func stopIsSafeWithoutAnEligibleSite() throws {
        let neverStarted = SyncModel()
        neverStarted.stop()
        #expect(neverStarted.status == .idle)
        #expect(neverStarted.isEligible == false)

        let (package, root) = try makeLocalPackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = SyncModel()
        model.start(package: package)
        model.stop()

        #expect(model.status == .idle)
        #expect(model.isEligible == false)
        #expect(model.bannerPresented == false)
        #expect(model.resolutionSheetPresented == false)
        #expect(fileExists(package.syncDirectoryURL) == false)
    }
}
