import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("GenericPageInspectorModel robots settings (#1093)")
@MainActor
struct GenericPageInspectorModelRobotsSettingsTests {
    private func makeModel(
        route: String = "/",
        spy: GenericPageRobotsCommitSpy = GenericPageRobotsCommitSpy()
    ) throws -> (GenericPageInspectorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("GenericPageInspectorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/index.astro")
        try "---\nconst title = \"Home\";\n---\n<h1>{title}</h1>\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "index.astro")
        let model = GenericPageInspectorModel(
            file: file, route: route, sourceDirectory: dir,
            gitCommit: { _, rel, msg in spy.record(rel, msg); return "deadbeef" }
        )
        return (model, dir)
    }

    @Test("load: no existing entry reads both toggles as off, isDirty false")
    func loadDefaultsOff() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.noindexBinding().wrappedValue == false)
        #expect(model.disallowCrawlBinding().wrappedValue == false)
        #expect(model.isDirty == false)
    }

    @Test("save: enabling disallowCrawl writes an entry for this .astro page")
    func saveWritesEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        #expect(model.isDirty)
        let saved = await model.save()
        #expect(saved)
        #expect(!model.isDirty)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.disallow == [RobotsConfigEntry(path: "/", source: .page(file: "src/pages/index.astro"))])
    }

    /// This model writes no page file of its own, so the robots config is the *only* thing it has
    /// to commit — before #1093's review fix it had no `gitCommit` dependency at all and left the
    /// site repo dirty on every toggle.
    @Test("save: a robots change is committed to git, not just written to disk")
    func saveCommitsRobotsConfig() async throws {
        let spy = GenericPageRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        model.noindexBinding().wrappedValue = true
        _ = await model.save()
        #expect(spy.paths() == [RobotsConfigFile.relativePath])
    }

    @Test("save: a no-op save commits nothing")
    func saveWithoutChangeCommitsNothing() async throws {
        let spy = GenericPageRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        _ = await model.save()
        #expect(spy.paths().isEmpty)
    }
}

/// Records the `(relPath, message)` pairs a model hands its injected `gitCommit`, matching the
/// spy-closure pattern `NavigatorRenameServiceTests` already uses for this seam.
final class GenericPageRobotsCommitSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(String, String)] = []
    func record(_ rel: String, _ message: String) { lock.lock(); calls.append((rel, message)); lock.unlock() }
    func paths() -> [String] { lock.lock(); defer { lock.unlock() }; return calls.map(\.0) }
}
