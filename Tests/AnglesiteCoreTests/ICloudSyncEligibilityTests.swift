#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteSiteModel
import AnglesiteTestSupport
@testable import AnglesiteCore

/// `ICloudSyncEligibility` (#881, design doc §5) is the one gate that decides whether a package
/// gets sync machinery at all — the app layer builds a `SyncScheduler`/`SyncEngine` only when it
/// answers `true`, so a `false` here is what produces manual QA §5's "zero sync UI, zero sync log
/// lines, zero `Config/sync/` on disk" for a local-only site.
///
/// Real ubiquity can't be manufactured in CI, so the `true` direction is covered through the
/// injectable `FileManager` seam; the `false` direction is additionally pinned against the *real*
/// `FileManager.default`, since every temp-directory package in this repo's test suites depends on
/// genuinely answering `false` there.
///
/// No libgit2 here (package skeletons and `FileManager` only), so this suite is unserialized,
/// following `RepoRelocatorInteropTests`' precedent.
@Suite("ICloudSyncEligibility")
struct ICloudSyncEligibilityTests {

    /// Answers `isUbiquitousItem(at:)` with a scripted value and records what it was asked about,
    /// so the test can also pin *which* URL eligibility is derived from (the package root, not
    /// `Source/` or `Config/sync/`).
    private final class StubUbiquityFileManager: FileManager, @unchecked Sendable {
        let ubiquitous: Bool
        private(set) var queriedURLs: [URL] = []

        init(ubiquitous: Bool) {
            self.ubiquitous = ubiquitous
            super.init()
        }

        override func isUbiquitousItem(at url: URL) -> Bool {
            queriedURLs.append(url)
            return ubiquitous
        }
    }

    private func makePackage(name: String) throws -> AnglesitePackage {
        let root = try makeTempDir(prefix: "icloud-sync-eligibility")
        let pkgURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (pkg, _) = try AnglesitePackage.createSkeleton(at: pkgURL, displayName: name)
        return pkg
    }

    /// QA §5.1 (inverse): a package iCloud reports as a ubiquitous item is eligible — this is the
    /// precondition the whole checklist assumes ("a test `.anglesite` package created in the
    /// default iCloud Drive save location, so `isEligible` is `true` on both Macs").
    @Test("a package reported ubiquitous is eligible for sync")
    func ubiquitousPackageIsEligible() throws {
        let pkg = try makePackage(name: "InCloud")
        let fileManager = StubUbiquityFileManager(ubiquitous: true)

        #expect(ICloudSyncEligibility.isEligible(package: pkg, fileManager: fileManager))
        #expect(fileManager.queriedURLs == [pkg.url], "eligibility is derived from the package root itself")
    }

    /// QA §5.1: a package outside any ubiquity container is *not* eligible — the condition
    /// `SyncStatusView` keys on to render nothing at all, rather than a disabled/idle sync affordance.
    @Test("a package reported non-ubiquitous is not eligible for sync")
    func nonUbiquitousPackageIsNotEligible() throws {
        let pkg = try makePackage(name: "Local")
        let fileManager = StubUbiquityFileManager(ubiquitous: false)

        #expect(!ICloudSyncEligibility.isEligible(package: pkg, fileManager: fileManager))
        #expect(fileManager.queriedURLs == [pkg.url])
    }

    /// QA §5.1, against the real `FileManager`: a package in an ordinary temp directory is not in
    /// iCloud. Beyond automating the checklist step, this is the assertion that guarantees every
    /// other suite's temp-directory packages are genuinely non-iCloud — if this ever started
    /// answering `true`, the rest of the sync tests would be silently exercising real ubiquity.
    @Test("a plain temp-directory package is not eligible under the real FileManager")
    func tempDirectoryPackageIsNotEligibleForReal() throws {
        let pkg = try makePackage(name: "TempOnly")

        #expect(!ICloudSyncEligibility.isEligible(package: pkg))
    }
}
#endif
