import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

/// Wiring tests for #975: `SiteWindowModel.recheckSecurityReports()` (resolves the GitHub
/// remote + token, then drives the shared `SecurityReportsModel`) and
/// `presentDependencyFixSheet(_:)` (routes a single matched Dependabot fix through the same
/// apply path `loadAndStart()`'s automatic offer sheet uses). `SecurityReportsModel`'s own
/// recheck logic is already fully covered in `SecurityReportsModelTests` — these tests only
/// prove the wiring around it: the right facts reach it, and the right sheet/apply call follows.
@Suite("SiteWindowModel security reports wiring (#975)")
@MainActor
struct SiteWindowModelSecurityReportsTests {
    actor FakeReader: RepoAdvisoryReading {
        private let advisories: [SecurityAdvisory]
        init(advisories: [SecurityAdvisory] = []) { self.advisories = advisories }
        func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] { advisories }
        func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] { [] }
    }

    private static let sampleAdvisory = SecurityAdvisory(
        id: "GHSA-1", summary: "Example", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-1")!, publishedAt: nil)

    private func makeModel(
        remote: String = "https://github.com/acme/site.git\n",
        remoteExitCode: Int32 = 0,
        token: String? = "tok"
    ) -> SiteWindowModel {
        SiteWindowModel(
            contentGraph: SiteContentGraph(),
            knowledgeIndex: SiteKnowledgeIndex(),
            semanticRanker: nil,
            conventionsEngine: ProjectConventionsEngine(),
            runtimeFactory: NeverStartedSiteRuntimeFactory(),
            contentIndexerStore: ContentIndexerStore(),
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: remote, stderr: "", exitCode: remoteExitCode) },
            githubToken: { token },
            runningAppVersion: { "1.0.0" }
        )
    }

    /// Reuses `SiteWindowModelTests`' fixture shape (a real temp `Foo.anglesite/Source`
    /// directory) — `SiteStore.Site.sourceDirectory` is computed from `packageURL`, not settable
    /// directly, so a real-enough directory on disk is required even for wiring-only tests.
    private func makeSite(in root: URL, packageJSON: String? = nil) throws -> SiteStore.Site {
        let sourceDirectory = root.appendingPathComponent("Test.anglesite/Source")
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        if let packageJSON {
            try packageJSON.write(to: sourceDirectory.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        }
        return SiteStore.Site(
            id: "site-a", name: "Test", packageURL: root.appendingPathComponent("Test.anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil)
    }

    // Note: declared `async` (the brief's version was synchronous) because several call sites
    // below need to `await model.recheckSecurityReports().value` inside the closure body — a
    // sync closure parameter can't accept an async one.
    private func withTempDirectory<T>(_ body: (URL) async throws -> T) async rethrows -> T {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("SiteWindowModelSecurityReportsTests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        return try await body(root)
    }

    // MARK: - recheckSecurityReports

    @Test("resolves the GitHub remote via gitRunner and populates securityReports on success")
    func recheckPopulatesFromResolvedRemote() async throws {
        try await withTempDirectory { root in
            let model = makeModel()
            model.site = try makeSite(in: root)
            model.securityReports = SecurityReportsModel(reader: FakeReader(advisories: [Self.sampleAdvisory]))
            await model.recheckSecurityReports().value
            #expect(model.securityReports.openAdvisories == [Self.sampleAdvisory])
        }
    }

    @Test("a non-zero git exit code (no remote) clears securityReports rather than erroring")
    func recheckNoRemoteClears() async throws {
        try await withTempDirectory { root in
            let model = makeModel(remoteExitCode: 1)
            model.site = try makeSite(in: root)
            model.securityReports = SecurityReportsModel(reader: FakeReader(advisories: [Self.sampleAdvisory]))
            await model.recheckSecurityReports().value
            #expect(model.securityReports.totalCount == 0)
            #expect(model.securityReports.lastError == nil)
        }
    }

    @Test("a nil token from the injected githubToken clears securityReports rather than erroring")
    func recheckNoTokenClears() async throws {
        try await withTempDirectory { root in
            let model = makeModel(token: nil)
            model.site = try makeSite(in: root)
            model.securityReports = SecurityReportsModel(reader: FakeReader(advisories: [Self.sampleAdvisory]))
            await model.recheckSecurityReports().value
            #expect(model.securityReports.totalCount == 0)
        }
    }

    @Test("recheckSecurityReports without an open site clears rather than crashing")
    func recheckNoSiteIsNoOp() async {
        let model = makeModel()
        model.securityReports = SecurityReportsModel(reader: FakeReader(advisories: [Self.sampleAdvisory]))
        await model.recheckSecurityReports().value
        #expect(model.securityReports.totalCount == 0)
    }

    // MARK: - presentDependencyFixSheet

    @Test("presents the dependency-update sheet scoped to exactly the one matched offer")
    func presentDependencyFixSheetScopesToOneOffer() async throws {
        try await withTempDirectory { root in
            let model = makeModel()
            model.site = try makeSite(in: root, packageJSON: #"{"dependencies":{"left-pad":"^1.0.0"}}"#)
            let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")

            model.presentDependencyFixSheet(offer)

            #expect(model.dependencyUpdateModel?.offers == DependencySyncOffers(updates: [offer]))
        }
    }

    @Test("accepting the fix sheet rewrites package.json via the shared apply path")
    func presentDependencyFixSheetAcceptRewritesPackageJSON() async throws {
        try await withTempDirectory { root in
            let model = makeModel()
            let site = try makeSite(in: root, packageJSON: #"{"dependencies":{"left-pad":"^1.0.0"}}"#)
            model.site = site
            let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")

            model.presentDependencyFixSheet(offer)
            model.dependencyUpdateModel?.update()

            let rewritten = try String(contentsOf: site.sourceDirectory.appendingPathComponent("package.json"), encoding: .utf8)
            #expect(rewritten.contains("1.3.0"))
            #expect(model.preview.isUpdatingDependencies)
            #expect(model.dependencyUpdateModel == nil)
        }
    }

    @Test("skipping the fix sheet leaves package.json untouched and clears the sheet")
    func presentDependencyFixSheetSkipLeavesFileUntouched() async throws {
        try await withTempDirectory { root in
            let model = makeModel()
            let originalJSON = #"{"dependencies":{"left-pad":"^1.0.0"}}"#
            let site = try makeSite(in: root, packageJSON: originalJSON)
            model.site = site
            let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")

            model.presentDependencyFixSheet(offer)
            model.dependencyUpdateModel?.skip()

            let unchanged = try String(contentsOf: site.sourceDirectory.appendingPathComponent("package.json"), encoding: .utf8)
            #expect(unchanged == originalJSON)
            #expect(model.dependencyUpdateModel == nil)
        }
    }

    @Test("presentDependencyFixSheet without an open site does nothing")
    func presentDependencyFixSheetNoSiteIsNoOp() {
        let model = makeModel()
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        model.presentDependencyFixSheet(offer)
        #expect(model.dependencyUpdateModel == nil)
    }
}
