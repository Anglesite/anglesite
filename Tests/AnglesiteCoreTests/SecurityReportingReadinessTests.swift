import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityReportingReadiness (#843)")
struct SecurityReportingReadinessTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")
    private static let form = "https://github.com/acme/site/security/advisories/new"

    @Test("no repo means nothing to offer")
    func notGitHub() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: nil, isPrivate: false, pvrEnabled: true, contacts: "s@example.com") == .notGitHub)
    }

    @Test("a public repo with private reporting on is ready to offer")
    func ready() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: false, pvrEnabled: true, contacts: "s@example.com") == .ready)
    }

    @Test("a public repo with private reporting off needs it enabled first")
    func needsPVR() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: false, pvrEnabled: false, contacts: "s@example.com") == .needsPVR)
    }

    @Test("a private repo offers nothing — outside reporters can't reach the form")
    func repoPrivate() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: true, pvrEnabled: true, contacts: "s@example.com") == .repoPrivate)
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: true, pvrEnabled: false, contacts: "s@example.com") == .repoPrivate)
    }

    @Test("an already-listed form reports configured, whatever the repo state")
    func alreadyConfigured() {
        for (isPrivate, pvr) in [(false, true), (false, false), (true, true), (true, false)] {
            #expect(SecurityReportingReadiness.evaluate(
                repo: Self.repo, isPrivate: isPrivate, pvrEnabled: pvr,
                contacts: "\(Self.form)\ns@example.com") == .alreadyConfigured)
        }
    }

    @Test("no repo outranks an already-listed form — a stale contact isn't a GitHub offer")
    func notGitHubOutranksConfigured() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: nil, isPrivate: false, pvrEnabled: true, contacts: Self.form) == .notGitHub)
    }
}
