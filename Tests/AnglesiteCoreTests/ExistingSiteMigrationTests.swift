import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationTests {
    private func tmpDirs() -> (source: URL, config: URL, template: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        let template = root.appendingPathComponent("Template")
        for d in [source, config, template] {
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        return (source, config, template)
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    @Test func cleanSiteWithNothingToMigrateCommitsNothingAndLogsNothing() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("shared", to: template.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("shared", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // SECURITY_TXT_MODE must already be set for this to be a genuinely "nothing to migrate"
        // site — an absent key (even with no security.txt file) is itself a silent-backfill case
        // per `SecurityTxtMigrationChecker.check`, which would touch `.site-config` and defeat
        // this test's "commits nothing" premise.
        try writeFile("SECURITY_TXT_MODE=disabled\n", to: source.appendingPathComponent(".site-config"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let lines = await logCenter.snapshot()
        #expect(lines.isEmpty)
    }

    @Test func unbaselinedCustomizedScriptFileIsPreservedAndReportedAsUnresolved() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("new template content", to: template.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("owner's content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        try writeFile("", to: source.appendingPathComponent(".site-config"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(unchanged == "owner's content")
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("scripts/pre-deploy-check.ts") && $0.text.contains("unresolved ownership") })
    }

    @Test func unmarkedSecurityTxtNeedingDecisionDefaultsToPreserveAndIsReported() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("SECURITY_CONTACT=security@example.com\n", to: source.appendingPathComponent(".site-config"))
        try writeFile("Contact: mailto:someone-else@example.com\n", to: source.appendingPathComponent("public/.well-known/security.txt"))

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("public/.well-known/security.txt"), encoding: .utf8)
        #expect(unchanged == "Contact: mailto:someone-else@example.com\n")
        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(siteConfig.contains("SECURITY_TXT_MODE=manual"))
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("public/.well-known/security.txt") })
    }

    @Test func silentBackfillsCommitWithoutAnyLoggedFinding() async throws {
        let (source, config, template) = tmpDirs()
        let logCenter = LogCenter()
        try writeFile("SECURITY_CONTACT=security@example.com\n", to: source.appendingPathComponent(".site-config"))
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)

        await ExistingSiteMigration.runNoninteractively(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            source: "test", logCenter: logCenter
        )

        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(siteConfig.contains("SECURITY_TXT_MODE=generated"))
        let lines = await logCenter.snapshot()
        #expect(!lines.contains { $0.text.contains("unresolved") })
    }
}
