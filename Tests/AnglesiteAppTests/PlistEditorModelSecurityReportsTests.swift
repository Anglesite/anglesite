import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel security reports (#843)")
@MainActor
struct PlistEditorModelSecurityReportsTests {
    /// Records PVR writes and serves canned repo facts. Read and write failures are separate
    /// (a token can read a repo fine and still lack admin to change its settings) and mutable
    /// after construction, so a test can refresh into a good state and *then* break the network.
    actor FakeRepoSecurity: RepoSecurityReading, RepoSecurityWriting {
        private let privateRepo: Bool
        private var pvr: Bool
        private var readFailure: GitHubRepoAPIError?
        private let writeFailure: GitHubRepoAPIError?
        private(set) var enableCalls = 0

        init(
            privateRepo: Bool = false,
            pvr: Bool = true,
            readFailure: GitHubRepoAPIError? = nil,
            writeFailure: GitHubRepoAPIError? = nil
        ) {
            self.privateRepo = privateRepo
            self.pvr = pvr
            self.readFailure = readFailure
            self.writeFailure = writeFailure
        }

        func setReadFailure(_ error: GitHubRepoAPIError?) { readFailure = error }

        func isPrivate(owner: String, name: String, token: String) async throws -> Bool {
            if let readFailure { throw readFailure }
            return privateRepo
        }

        func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool {
            if let readFailure { throw readFailure }
            return pvr
        }

        func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws {
            if let writeFailure { throw writeFailure }
            enableCalls += 1
            pvr = true
        }
    }

    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(
        config: String? = nil,
        remote: String = "https://github.com/acme/site.git\n",
        repoSecurity: any RepoSecurityReading & RepoSecurityWriting = FakeRepoSecurity(),
        token: String? = "tok"
    ) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelSecurityReportsTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: directory.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        return PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test Site",
            sourceDirectory: directory,
            repoSecurity: repoSecurity,
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: remote, stderr: "", exitCode: 0) },
            githubToken: { token })
    }

    @Test("loads the contact list and mode from .site-config")
    func load() async throws {
        let model = try makeModel(config: "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=a@example.com,b@example.com\n")
        await model.load()
        #expect(model.securityReportingSettings == .init(contacts: "a@example.com\nb@example.com", mode: .generated))
        #expect(!model.isSecurityReportingDirty)
    }

    @Test("saves a dirty facet and normalizes what it saved")
    func save() async throws {
        let model = try makeModel()
        await model.load()
        model.securityReportingSettings = .init(contacts: " a@example.com \n\n a@example.com ", mode: .generated)
        #expect(model.isSecurityReportingDirty)
        #expect(await model.saveSecurityReporting())
        #expect(model.securityReportingSettings.contacts == "a@example.com")
        #expect(!model.isSecurityReportingDirty)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_CONTACT=a@example.com"))
    }

    @Test("a dirty facet participates in the aggregate unsaved-changes state")
    func participatesInDirtyFacets() async throws {
        let model = try makeModel()
        await model.load()
        #expect(!model.hasAnyUnsavedEdits)
        model.securityReportingSettings.contacts = "a@example.com"
        #expect(model.hasAnyUnsavedEdits)
    }

    @Test("a public repo with private reporting on is ready")
    func readinessReady() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n")
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .ready)
        #expect(model.securityReportingError == nil)
    }

    @Test("a public repo with private reporting off needs it enabled")
    func readinessNeedsPVR() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(pvr: false))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
    }

    @Test("a private repo offers nothing")
    func readinessPrivateRepo() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(privateRepo: true))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .repoPrivate)
    }

    @Test("a configured-then-privated repo stays configured but records the visibility")
    func readinessConfiguredButPrivate() async throws {
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: FakeRepoSecurity(privateRepo: true))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(model.securityReportingRepoIsPrivate)
    }

    @Test("a configured repo with PVR off exposes the warning state")
    func readinessConfiguredButPVROff() async throws {
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: FakeRepoSecurity(pvr: false))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(!model.securityReportingPVREnabled)
    }

    @Test("a configured repo with PVR on has no warning state")
    func readinessConfiguredWithPVROn() async throws {
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: FakeRepoSecurity(pvr: true))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(model.securityReportingPVREnabled)
    }

    @Test("enabling PVR for an already-configured repo flips the tracked state without touching contacts")
    func enablePVRForConfiguredRepo() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(!model.securityReportingPVREnabled)
        #expect(await model.enablePrivateVulnerabilityReportingForConfiguredRepo())
        #expect(await fake.enableCalls == 1)
        #expect(model.securityReportingPVREnabled)
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(model.securityReportingSettings.contacts == "https://github.com/acme/site/security/advisories/new")
    }

    @Test("adopting the form in manual mode performs no PVR write and doesn't claim configured")
    func adoptInManualModeIsNoOp() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(
            config: "SECURITY_TXT_MODE=manual\nSECURITY_CONTACT=a@example.com\n",
            repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        let readinessBefore = model.securityReportingReadiness
        #expect(readinessBefore != .alreadyConfigured)

        await model.adoptAdvisoryForm()

        #expect(await fake.enableCalls == 0)
        #expect(model.securityReportingReadiness != .alreadyConfigured)
        #expect(model.securityReportingReadiness == readinessBefore)
        #expect(model.securityReportingSettings.contacts == "a@example.com")
        #expect(!model.isSecurityReportingDirty)
    }

    @Test("a non-GitHub origin is notGitHub and makes no API call")
    func readinessNonGitHubOrigin() async throws {
        let fake = FakeRepoSecurity(readFailure: .network)
        let model = try makeModel(remote: "https://gitlab.com/acme/site.git\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .notGitHub)
        #expect(model.securityReportingError == nil)
    }

    @Test("adopting the form on a ready repo prepends it and saves, without a PVR write")
    func adoptWhenReady() async throws {
        let fake = FakeRepoSecurity()
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        await model.adoptAdvisoryForm()
        #expect(model.securityReportingSettings.contacts
            == "https://github.com/acme/site/security/advisories/new\na@example.com")
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(await fake.enableCalls == 0)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new,a@example.com"))
    }

    @Test("adopting the form when PVR is off enables it first")
    func adoptEnablesPVR() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
        await model.adoptAdvisoryForm()
        #expect(await fake.enableCalls == 1)
        #expect(model.securityReportingReadiness == .alreadyConfigured)
    }

    @Test("a 403 on the PVR write names the missing repo permission and changes nothing")
    func adoptWithoutAdminPermission() async throws {
        // Reads succeed (so readiness lands on .needsPVR); only the write is forbidden — exactly
        // what a token without repo admin looks like.
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(pvr: false, writeFailure: .unauthorized(status: 403)))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
        await model.adoptAdvisoryForm()
        #expect(model.securityReportingError?.contains("admin") == true)
        #expect(model.securityReportingSettings.contacts == "a@example.com")
        #expect(model.securityReportingReadiness == .needsPVR)
    }

    @Test("a network failure reports the error and keeps the previous readiness")
    func networkFailureKeepsReadiness() async throws {
        let fake = FakeRepoSecurity()
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .ready)

        await fake.setReadFailure(.network)
        await model.refreshRepoSecurityState()
        // Must NOT fall through to .notGitHub — that would falsely claim the site has no remote.
        #expect(model.securityReportingReadiness == .ready)
        #expect(model.securityReportingError != nil)
    }

    @Test("no stored token reports the problem rather than claiming there's no GitHub remote")
    func missingToken() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", token: nil)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness != .notGitHub)
        #expect(model.securityReportingError != nil)
    }

    @Test("a first-ever failed check on an already-configured repo leaves the state flagged unknown")
    func firstCheckFailureLeavesStateUnknown() async throws {
        let fake = FakeRepoSecurity(readFailure: .network)
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        // Derived purely from the local contacts list, so a failed network check still lands here.
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        // But neither sub-flag was ever populated by a successful check — the view must not warn
        // about visibility or PVR state from these unpopulated `false` defaults.
        #expect(!model.securityReportingStateIsKnown)
        #expect(model.securityReportingError != nil)
    }

    @Test("a later failure after a successful check keeps the last known values")
    func laterFailureKeepsLastKnownValues() async throws {
        let fake = FakeRepoSecurity(privateRepo: false, pvr: true)
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(model.securityReportingStateIsKnown)
        #expect(!model.securityReportingRepoIsPrivate)
        #expect(model.securityReportingPVREnabled)

        await fake.setReadFailure(.network)
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        // The last known values survive the failed check rather than reverting to unpopulated
        // defaults — a stale-but-true fact beats a fresh-but-wrong one here.
        #expect(model.securityReportingStateIsKnown)
        #expect(!model.securityReportingRepoIsPrivate)
        #expect(model.securityReportingPVREnabled)
        #expect(model.securityReportingError != nil)
    }

    @Test("flushBeforeLeaving saves a dirty security-reporting facet instead of discarding it")
    func flushBeforeLeavingSavesSecurityReporting() async throws {
        let model = try makeModel()
        await model.load()
        model.securityReportingSettings.contacts = "a@example.com"
        #expect(model.isSecurityReportingDirty)
        #expect(await model.flushBeforeLeaving())
        #expect(!model.isSecurityReportingDirty)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_CONTACT=a@example.com"))
    }

    @Test("a second concurrent adopt call does not duplicate the PVR write")
    func concurrentAdoptDoesNotDuplicateWrite() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)

        async let first: Void = model.adoptAdvisoryForm()
        async let second: Void = model.adoptAdvisoryForm()
        _ = await (first, second)

        #expect(await fake.enableCalls == 1)
        #expect(model.securityReportingReadiness == .alreadyConfigured)
    }

    @Test("a partial adopt failure (PVR enabled, save fails) still reports .ready, not .needsPVR")
    func adoptPartialFailureReportsReadyNotNeedsPVR() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)

        // Force the subsequent save to fail deterministically: the site directory (and thus
        // .site-config's parent) is gone by the time `saveSecurityReporting()` tries to write it.
        try FileManager.default.removeItem(at: model.sourceDirectory)

        await model.adoptAdvisoryForm()
        #expect(await fake.enableCalls == 1)
        #expect(model.securityReportingError != nil)
        #expect(model.securityReportingReadiness == .ready)
    }
}
