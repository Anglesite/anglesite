import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsSyncApplierTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeTemplate(_ contents: String) throws -> URL {
        let root = tmpDir()
        try writeFile(contents, to: root.appendingPathComponent("scripts/pre-deploy-check.ts"))
        return root
    }

    private func makeSite() -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try? FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        return (source, config)
    }

    @Test func applyQueuedCreatesAMissingFileAndRecordsItsBaseline() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        try TemplateScriptsSyncApplier.applyQueued(
            [.create(relativePath: "scripts/pre-deploy-check.ts")],
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("template content"))
    }

    @Test func applyQueuedRefreshesAnExistingFileAndBumpsItsBaseline() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("stale content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))

        try TemplateScriptsSyncApplier.applyQueued(
            [.refresh(relativePath: "scripts/pre-deploy-check.ts")],
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "new template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("new template content"))
    }

    @Test func applyQueuedWithNoActionsTouchesNothing() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        try TemplateScriptsSyncApplier.applyQueued(
            [], sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        #expect(!FileManager.default.fileExists(
            atPath: config.appendingPathComponent(TemplateScriptsBaseline.filename).path))
    }

    @Test func applyQueuedThrowsWhenTheTemplateFileIsUnreadable() throws {
        let template = tmpDir()  // no scripts/ directory at all
        let (source, config) = makeSite()

        #expect(throws: TemplateScriptsSyncApplier.ApplyError.templateReadFailed(
            relativePath: "scripts/pre-deploy-check.ts")
        ) {
            try TemplateScriptsSyncApplier.applyQueued(
                [.create(relativePath: "scripts/pre-deploy-check.ts")],
                sourceDirectory: source, configDirectory: config, templateDirectory: template
            )
        }
    }

    @Test func applyQueuedPersistsEachActionsBaselineIndividuallyOnPartialFailure() throws {
        let template = tmpDir()
        try writeFile("template content A", to: template.appendingPathComponent("scripts/a.ts"))
        // Deliberately no scripts/b.ts in the template — the second action's read will fail.
        let (source, config) = makeSite()

        #expect(throws: TemplateScriptsSyncApplier.ApplyError.templateReadFailed(relativePath: "scripts/b.ts")) {
            try TemplateScriptsSyncApplier.applyQueued(
                [.create(relativePath: "scripts/a.ts"), .create(relativePath: "scripts/b.ts")],
                sourceDirectory: source, configDirectory: config, templateDirectory: template
            )
        }

        // The first action wrote its file and its baseline entry before the second action threw —
        // neither is lost just because a later action in the same batch failed.
        let written = try String(contentsOf: source.appendingPathComponent("scripts/a.ts"), encoding: .utf8)
        #expect(written == "template content A")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/a.ts"]?.baselineHash == VectorMath.stableHash("template content A"))
    }

    @Test func resolveUpdateOverwritesTheOwnersVersion() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        let divergence = TemplateScriptsDivergence(
            relativePath: "scripts/pre-deploy-check.ts", templateHash: VectorMath.stableHash("template content")
        )

        try TemplateScriptsSyncApplier.resolve(
            divergence, decision: .update,
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("template content"))
    }

    @Test func resolveKeepMineLeavesTheFileUntouchedAndRecordsAcknowledgement() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: "original-baseline-hash")
        try baseline.save(to: config)
        let divergence = TemplateScriptsDivergence(
            relativePath: "scripts/pre-deploy-check.ts", templateHash: VectorMath.stableHash("template content")
        )

        try TemplateScriptsSyncApplier.resolve(
            divergence, decision: .keepMine,
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(unchanged == "owner's customized content")
        let saved = TemplateScriptsBaseline.load(from: config)
        #expect(saved.files["scripts/pre-deploy-check.ts"]?.baselineHash == "original-baseline-hash")
        #expect(saved.files["scripts/pre-deploy-check.ts"]?.acknowledgedTemplateHash == VectorMath.stableHash("template content"))
    }
}
