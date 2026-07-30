import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("PageMetadataModel robots settings (#1093)")
@MainActor
struct PageMetadataModelRobotsSettingsTests {
    private func makeModel(
        route: String = "/a-page/",
        spy: PageMetadataRobotsCommitSpy = PageMetadataRobotsCommitSpy()
    ) throws -> (PageMetadataModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PageMetadataModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/a-page.md")
        try "---\ntitle: \"A Page\"\ndescription: \"D\"\n---\nBody.\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "a-page.md")
        let model = PageMetadataModel(
            file: file, route: route, sourceDirectory: dir,
            gitCommit: { _, rel, msg in spy.record(rel, msg); return "deadbeef" }
        )
        return (model, dir)
    }

    @Test("load: no existing entry reads both toggles as off")
    func loadDefaultsOff() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.noindexBinding().wrappedValue == false)
        #expect(model.disallowCrawlBinding().wrappedValue == false)
        #expect(model.isDirty == false)
    }

    @Test("save: enabling noindex writes an entry keyed to this page's file")
    func saveWritesNoindexEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.noindexBinding().wrappedValue = true
        #expect(model.isDirty)
        let saved = await model.save()
        #expect(saved)
        #expect(!model.isDirty)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.noindex == [RobotsConfigEntry(path: "/a-page/", source: .page(file: "src/pages/a-page.md"))])
    }

    @Test("save: disabling a previously-enabled toggle removes its entry")
    func saveRemovesDisabledEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        _ = await model.save()

        model.disallowCrawlBinding().wrappedValue = false
        #expect(model.isDirty)
        _ = await model.save()

        #expect(RobotsConfigFile.read(under: dir).disallow.isEmpty)
    }

    /// `gitCommit` stages one path, so the page's own commit never carries the shared config —
    /// without a second commit every toggle leaves the site repo dirty forever (#1093).
    @Test("save: a robots change is committed to git, not just written to disk")
    func saveCommitsRobotsConfig() async throws {
        let spy = PageMetadataRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        model.noindexBinding().wrappedValue = true
        _ = await model.save()
        #expect(spy.paths().contains(RobotsConfigFile.relativePath))
        #expect(spy.paths().contains("src/pages/a-page.md"))
    }

    @Test("save: a no-op robots write doesn't add a robots-config commit")
    func saveWithoutRobotsChangeSkipsExtraCommit() async throws {
        let spy = PageMetadataRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        model.titleBinding().wrappedValue = "Renamed"
        _ = await model.save()
        #expect(!spy.paths().contains(RobotsConfigFile.relativePath))
        #expect(spy.paths() == ["src/pages/a-page.md"])
    }
}

/// Records the `(relPath, message)` pairs a model hands its injected `gitCommit`, matching the
/// spy-closure pattern `NavigatorRenameServiceTests` already uses for this seam.
final class PageMetadataRobotsCommitSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(String, String)] = []
    func record(_ rel: String, _ message: String) { lock.lock(); calls.append((rel, message)); lock.unlock() }
    func paths() -> [String] { lock.lock(); defer { lock.unlock() }; return calls.map(\.0) }
}
