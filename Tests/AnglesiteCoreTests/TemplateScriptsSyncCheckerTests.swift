import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsSyncCheckerTests {
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

    @Test func existingButUnreadableSiteFileIsSkippedNotSilentlyOverwritten() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        // A file that genuinely exists but can't be decoded as UTF-8 — distinct from "doesn't
        // exist," and must not be silently queued for `.create` (which would unconditionally
        // overwrite whatever's actually there).
        let siteURL = source.appendingPathComponent("scripts/pre-deploy-check.ts")
        try FileManager.default.createDirectory(at: siteURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data([0xFF, 0xFE, 0xFD]).write(to: siteURL)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)
        #expect(TemplateScriptsBaseline.load(from: config).files["scripts/pre-deploy-check.ts"] == nil)
    }

    @Test func newTemplateFileNotOnSiteIsQueuedForSilentCreate() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.create(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)
    }

    @Test func matchingContentIsANoOpAndBackfillsMissingBaseline() throws {
        let template = try makeTemplate("same content")
        let (source, config) = makeSite()
        try writeFile("same content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)

        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("same content"))
    }

    @Test func legacySiteWithNoBaselineAndDifferingContentIsQueuedAsADivergenceNotSilentlyOverwritten() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("old site content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline file at all — a pre-existing site from before #745 shipped. #745 changes
        // this case: the app can no longer tell "stale but never touched" from "the owner
        // customized this," so it must never silently overwrite it (design doc "Relationship to
        // TemplateScriptsSync").

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("new template content")
            )
        ])

        // A provisional baseline is still recorded — `TemplateScriptsSyncApplier.resolve` needs
        // an entry to update regardless of which way the owner (or the noninteractive Preserve
        // default) decides.
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("old site content"))
    }

    @Test func legacySiteWithNoBaselineButContentMatchingTheTemplateIsStillANoOp() throws {
        let template = try makeTemplate("shared content")
        let (source, config) = makeSite()
        try writeFile("shared content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline recorded, but the site's content happens to already match the template
        // exactly — this never reaches the "no baseline" branch at all (it's caught by the
        // templateHash == siteHash check first), so it stays a silent no-op/backfill, unchanged
        // by #745.

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("shared content"))
    }

    @Test func unmodifiedSiteFileWithExistingBaselineIsQueuedForRefreshWithoutRewritingBaseline() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("scaffolded content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: VectorMath.stableHash("scaffolded content"))
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.refresh(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)
        // The checker never bumps the baseline for a queued refresh — only the applier does,
        // once the file is actually written.
        #expect(TemplateScriptsBaseline.load(from: config) == baseline)
    }

    @Test func ownerEditedFileIsQueuedAsADivergence() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: VectorMath.stableHash("scaffolded content"))
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("new template content")
            )
        ])
    }

    @Test func acknowledgedDivergenceAtTheSameTemplateHashIsSkipped() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(
            baselineHash: VectorMath.stableHash("scaffolded content"),
            acknowledgedTemplateHash: VectorMath.stableHash("new template content")
        )
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)
    }

    @Test func divergenceIsRequeuedWhenTemplateChangesAgainAfterAnAcknowledgement() throws {
        let template = try makeTemplate("yet another template revision")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(
            baselineHash: VectorMath.stableHash("scaffolded content"),
            acknowledgedTemplateHash: VectorMath.stableHash("new template content")  // an older revision
        )
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("yet another template revision")
            )
        ])
    }
}
