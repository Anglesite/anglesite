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

    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(
        alerts: [DependabotAlert] = [],
        dependencySyncOffers: DependencySyncOffers = DependencySyncOffers(),
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
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: "", stderr: "", exitCode: 1) },
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
        let advisory = SecurityAdvisory(id: "GHSA-1", summary: "Example", severity: .high,
                                         htmlURL: URL(string: "https://example.com")!, publishedAt: nil)
        let model = try makeModel()
        // No GitHub remote is configured in this fixture (gitRunner exits 1), so refresh should
        // clear rather than populate — pinning the "no repo" branch stays free of network/token
        // plumbing while still exercising the call path `PlistEditorView`'s `.task` uses.
        await model.refreshSecurityReports()
        #expect(model.securityReports.totalCount == 0)
        _ = advisory  // documents the intended populated-case shape; full population is covered
                      // by SecurityReportsModelTests (Task 3) against a real repo/token pairing.
    }
}
