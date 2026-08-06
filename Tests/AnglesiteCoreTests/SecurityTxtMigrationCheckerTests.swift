import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtMigrationCheckerTests {
    private func tmpSite() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeConfig(_ contents: String, to source: URL) throws {
        try contents.write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
    }

    private func writeSecurityTxt(_ contents: String, to source: URL) throws {
        let wellKnown = source.appendingPathComponent("public/.well-known")
        try FileManager.default.createDirectory(at: wellKnown, withIntermediateDirectories: true)
        try contents.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)
    }

    @Test func modeAlreadySetIsNothingToDo() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_TXT_MODE=manual\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .nothingToDo)
    }

    @Test func noFileNoContactBackfillsDisabled() throws {
        let source = tmpSite()
        try writeConfig("", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentBackfillMode(.disabled))
    }

    @Test func noFileWithContactBackfillsGenerated() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentBackfillMode(.generated))
    }

    @Test func markerOwnedFileIsSilentAdopt() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        try writeSecurityTxt(
            "\(GeneratedEndpoints.securityTxtMarker)\nContact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\n",
            to: source
        )
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentAdopt)
    }

    @Test func unmarkedFileMatchingLegacyShapeIsSilentAdopt() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\nSITE_URL=https://example.org\n", to: source)
        try writeSecurityTxt(
            "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.org/.well-known/security.txt\n",
            to: source
        )
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .silentAdopt)
    }

    @Test func unmarkedFileNotMatchingLegacyShapeNeedsDecision() throws {
        let source = tmpSite()
        try writeConfig("SECURITY_CONTACT=security@example.com\n", to: source)
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)
        #expect(SecurityTxtMigrationChecker.check(sourceDirectory: source) == .needsDecision)
    }
}
