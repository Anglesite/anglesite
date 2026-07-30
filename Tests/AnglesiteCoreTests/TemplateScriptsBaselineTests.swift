import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsBaselineTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test func loadReturnsEmptyWhenFileIsAbsent() {
        let config = tmpDir()
        #expect(TemplateScriptsBaseline.load(from: config) == TemplateScriptsBaseline())
    }

    @Test func saveThenLoadRoundTripsEntriesIncludingAcknowledgedHash() throws {
        let config = tmpDir()
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: "abc")
        baseline.files["scripts/edge-artifacts.ts"] = .init(baselineHash: "def", acknowledgedTemplateHash: "ghi")
        try baseline.save(to: config)

        #expect(TemplateScriptsBaseline.load(from: config) == baseline)
    }

    @Test func loadReturnsEmptyWhenFileIsCorrupt() throws {
        let config = tmpDir()
        try Data("not json".utf8).write(to: config.appendingPathComponent(TemplateScriptsBaseline.filename))
        #expect(TemplateScriptsBaseline.load(from: config) == TemplateScriptsBaseline())
    }
}
