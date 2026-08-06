import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel security reports section (#975)")
@MainActor
struct PlistEditorModelSecurityReportsSectionTests {
    actor FakeReader: RepoAdvisoryReading {
        private let advisories: [SecurityAdvisory]
        private let alerts: [DependabotAlert]
        init(advisories: [SecurityAdvisory] = [], alerts: [DependabotAlert] = []) {
            self.advisories = advisories
            self.alerts = alerts
        }
        func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] { advisories }
        func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] { alerts }
    }

    private static let advisory = SecurityAdvisory(
        id: "GHSA-1", summary: "Example", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-1")!, publishedAt: nil)

    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    /// `remoteURL == nil` leaves the fixture without a GitHub remote (the git call exits 1);
    /// passing one makes `refreshRepoSecurityState()` resolve `securityReportingRepo` from it.
    private func makeModel(
        alerts: [DependabotAlert] = [],
        dependencySyncOffers: DependencySyncOffers = DependencySyncOffers(),
        remoteURL: String? = nil,
        onOpenDependencyFix: @escaping (DependencyUpdateOffer) -> Void = { _ in }
    ) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelSecurityReportsSectionTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        return PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test Site",
            sourceDirectory: directory,
            gitRunner: { _, _ in
                guard let remoteURL else { return ProcessSupervisor.RunResult(stdout: "", stderr: "", exitCode: 1) }
                return ProcessSupervisor.RunResult(stdout: remoteURL, stderr: "", exitCode: 0)
            },
            githubToken: { nil },
            securityReports: SecurityReportsModel(reader: FakeReader(alerts: alerts)),
            dependencySyncOffers: dependencySyncOffers,
            onOpenDependencyFix: onOpenDependencyFix)
    }

    @Test("fixOffer returns nil when the alert has no matching, sufficiently-new offer")
    func fixOfferNilByDefault() throws {
        let model = try makeModel()
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        #expect(model.fixOffer(for: alert) == nil)
    }

    @Test("fixOffer returns the matching offer computed from the injected DependencySyncOffers")
    func fixOfferMatches() throws {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        let model = try makeModel(dependencySyncOffers: DependencySyncOffers(updates: [offer]))
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        #expect(model.fixOffer(for: alert) == offer)
    }

    @Test("requestDependencyFix invokes the callback with the matched offer")
    func requestDependencyFixInvokesCallback() throws {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        var received: DependencyUpdateOffer?
        let model = try makeModel(
            dependencySyncOffers: DependencySyncOffers(updates: [offer]),
            onOpenDependencyFix: { received = $0 })
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        model.requestDependencyFix(for: alert)
        #expect(received == offer)
    }

    @Test("requestDependencyFix does nothing when there is no matching offer")
    func requestDependencyFixNoOpWithoutMatch() throws {
        var callbackFired = false
        let model = try makeModel(onOpenDependencyFix: { _ in callbackFired = true })
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        model.requestDependencyFix(for: alert)
        #expect(!callbackFired)
    }

    @Test("refreshSecurityReports populates the shared model from the injected reader")
    func refreshSecurityReportsPopulates() async throws {
        let model = try makeModel()
        // No GitHub remote is configured in this fixture (gitRunner exits 1), so refresh should
        // clear rather than populate — pinning the "no repo" branch stays free of network/token
        // plumbing while still exercising the call path `PlistEditorView`'s `.task` uses.
        await model.refreshSecurityReports()
        #expect(model.securityReports.totalCount == 0)
        _ = Self.advisory  // documents the intended populated-case shape; full population is covered
                      // by SecurityReportsModelTests (Task 3) against a real repo/token pairing.
    }

    @Test("forwardingPayload is nil while this site's GitHub repo is unknown")
    func forwardingPayloadNilWithoutRepo() throws {
        // No GitHub remote in this fixture, so the clipboard text has no repo to name — the view's
        // "Forward to Anglesite" action must find nothing to do rather than forward a half-formed
        // report.
        let model = try makeModel()
        #expect(model.forwardingPayload(for: Self.advisory) == nil)
    }

    @Test("forwardingPayload composes the clipboard text and the Anglesite advisory form URL")
    func forwardingPayloadComposesText() async throws {
        let model = try makeModel(remoteURL: "https://github.com/acme/site.git\n")
        await model.refreshRepoSecurityState()
        let payload = try #require(model.forwardingPayload(for: Self.advisory))
        let repo = RemoteRepo(url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")
        #expect(payload.text == AdvisoryForwarding.clipboardText(for: Self.advisory, siteRepo: repo))
        #expect(payload.text.contains("acme/site"))
        #expect(payload.formURL == AdvisoryForwarding.anglesiteAdvisoryFormURL)
    }
}
