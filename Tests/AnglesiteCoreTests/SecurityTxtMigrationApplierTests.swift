import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct SecurityTxtMigrationApplierTests {
    private func tmpSite() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeSecurityTxt(_ contents: String, to source: URL) throws {
        let wellKnown = source.appendingPathComponent("public/.well-known")
        try FileManager.default.createDirectory(at: wellKnown, withIntermediateDirectories: true)
        try contents.write(to: wellKnown.appendingPathComponent("security.txt"), atomically: true, encoding: .utf8)
    }

    @Test func applyBackfillWritesModeAndReturnsTouchedPath() throws {
        let source = tmpSite()
        let touched = SecurityTxtMigrationApplier.applyBackfill(mode: .disabled, sourceDirectory: source)
        #expect(touched == [".site-config"])
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=disabled"))
    }

    @Test func applyBackfillIsANoOpWhenAlreadyCorrect() throws {
        let source = tmpSite()
        try "SECURITY_TXT_MODE=generated\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let touched = SecurityTxtMigrationApplier.applyBackfill(mode: .generated, sourceDirectory: source)
        #expect(touched.isEmpty)
    }

    @Test func applyDecisionAdoptPrependsMarkerSetsModeAndGitignoresTheFile() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\n", to: source)

        let touched = SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: source)

        #expect(Set(touched) == Set([".site-config", "public/.well-known/security.txt", ".gitignore"]))
        let content = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(content.hasPrefix(GeneratedEndpoints.securityTxtMarker + "\n"))
        #expect(content.contains("Contact: mailto:security@example.com"))
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
        let gitignore = try String(contentsOf: source.appendingPathComponent(".gitignore"), encoding: .utf8)
        #expect(gitignore.contains("public/.well-known/security.txt"))
    }

    @Test func applyDecisionAdoptStillReportsAModeChangeEvenWhenTheFileDoesNotExist() throws {
        let source = tmpSite()
        let touched = SecurityTxtMigrationApplier.applyDecision(.adopt, sourceDirectory: source)
        #expect(touched == [".site-config"])
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
    }

    @Test func applyDecisionPreserveLeavesFileUntouchedSetsManualModeAndUngitignoresIt() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)
        try "public/.well-known/security.txt\n".write(
            to: source.appendingPathComponent(".gitignore"), atomically: true, encoding: .utf8
        )

        let touched = SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: source)

        #expect(Set(touched) == Set([".site-config", ".gitignore"]))
        let content = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(content == "Contact: mailto:someone-else@example.com\n")
        let config = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=manual"))
        let gitignore = try String(contentsOf: source.appendingPathComponent(".gitignore"), encoding: .utf8)
        #expect(!gitignore.contains("public/.well-known/security.txt"))
    }

    @Test func applyDecisionPreserveWithNoExistingGitignoreEntryTouchesNothingForGitignore() throws {
        let source = tmpSite()
        try writeSecurityTxt("Contact: mailto:someone-else@example.com\n", to: source)

        let touched = SecurityTxtMigrationApplier.applyDecision(.preserve, sourceDirectory: source)

        #expect(touched == [".site-config"])
        #expect(!FileManager.default.fileExists(atPath: source.appendingPathComponent(".gitignore").path))
    }
}
