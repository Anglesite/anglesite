import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityTxtAuditRunner (#843)")
struct SecurityTxtAuditRunnerTests {
    private static func siteDirectory(config: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("SecurityTxtAuditRunnerTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try config.write(to: root.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return root
    }

    private static func gitRunner(remote: String) -> BackupCommand.GitRunner {
        { _, _ in ProcessSupervisor.RunResult(stdout: remote, stderr: "", exitCode: 0) }
    }

    private static func run(config: String, gitRunner: @escaping BackupCommand.GitRunner) async throws -> [AuditReport.Finding] {
        let root = try siteDirectory(config: config)
        defer { try? FileManager.default.removeItem(at: root) }
        return try await SecurityTxtAuditRunner(gitRunner: gitRunner).run(
            siteDirectory: root, executor: HostAuditExecutor(), logCenter: .shared, source: "test")
    }

    @Test("flags a GitHub-backed site that isn't routing reports to its advisory form")
    func flagsUnconfiguredSite() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.count == 1)
        #expect(findings[0].category == .security)
        #expect(findings[0].severity == .info)
        #expect(findings[0].remediation?.contains("Security Reports") == true)
        #expect(findings[0].detail.contains("acme/site"))
    }

    @Test("flags a GitHub-backed site in generated mode with no contact configured at all")
    func flagsSiteWithNoContact() async throws {
        let findings = try await Self.run(
            config: "SECURITY_TXT_MODE=generated\n",
            gitRunner: Self.gitRunner(remote: "git@github.com:acme/site.git\n"))
        #expect(findings.count == 1)
    }

    @Test("says nothing for a site with no mode set and no contact configured (resolves to disabled)")
    func silentWhenModeAndContactBothUnset() async throws {
        // Mirrors resolveSecurityTxtMode/SecurityReportingAsset.parseSettings' inference: an
        // unset mode with an empty contact resolves to `.disabled`, not `.generated` — so this
        // is a `.disabled`-mode case, not a fresh "misconfigured" one.
        let findings = try await Self.run(
            config: "SITE_NAME=Acme\n",
            gitRunner: Self.gitRunner(remote: "git@github.com:acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing when the advisory form is already a contact")
    func silentWhenConfigured() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new,s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing in manual mode, even with an unrouted contact configured")
    func silentInManualMode() async throws {
        let findings = try await Self.run(
            config: "SECURITY_TXT_MODE=manual\nSECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing in disabled mode, even with an unrouted contact configured")
    func silentInDisabledMode() async throws {
        let findings = try await Self.run(
            config: "SECURITY_TXT_MODE=disabled\nSECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing for a non-GitHub origin")
    func silentForNonGitHubOrigin() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://gitlab.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing when there is no origin")
    func silentWithoutOrigin() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: "", stderr: "no such remote", exitCode: 2) })
        #expect(findings.isEmpty)
    }

    @Test("a throwing git runner yields no findings rather than failing the audit")
    func silentWhenGitUnavailable() async throws {
        struct Boom: Error {}
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: { _, _ in throw Boom() })
        #expect(findings.isEmpty)
    }
}
