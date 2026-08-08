import Testing
import Foundation
@testable import AnglesiteCore

struct RepoAdvisoryReadingTests {
    @Test("Severity decodes known values and falls back to .unknown for anything else")
    func severityDecoding() throws {
        func decode(_ raw: String) throws -> SecurityAdvisory.Severity {
            try JSONDecoder().decode(SecurityAdvisory.Severity.self, from: Data("\"\(raw)\"".utf8))
        }
        #expect(try decode("critical") == .critical)
        #expect(try decode("high") == .high)
        // GitHub's API sends "medium" on the wire for this tier, not "moderate" — only the
        // Swift-side case name is "moderate".
        #expect(try decode("medium") == .moderate)
        #expect(try decode("low") == .low)
        #expect(try decode("something-new-github-adds-later") == .unknown)
    }

    @Test("Severity decodes a JSON null (documented nullable on repository advisories) to .unknown")
    func severityDecodingNull() throws {
        let severity = try JSONDecoder().decode(SecurityAdvisory.Severity.self, from: Data("null".utf8))
        #expect(severity == .unknown)
    }

    @Test("SecurityAdvisory and DependabotAlert are Identifiable by their natural keys")
    func identifiableKeys() {
        let advisory = SecurityAdvisory(
            id: "GHSA-xxxx-yyyy-zzzz", summary: "Example", severity: .high,
            htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz")!,
            publishedAt: nil)
        #expect(advisory.id == "GHSA-xxxx-yyyy-zzzz")

        let alert = DependabotAlert(
            id: 7, packageName: "left-pad", ecosystem: "npm", severity: .moderate,
            patchedVersion: "1.3.0",
            htmlURL: URL(string: "https://github.com/acme/site/security/dependabot/7")!)
        #expect(alert.id == 7)
    }
}
