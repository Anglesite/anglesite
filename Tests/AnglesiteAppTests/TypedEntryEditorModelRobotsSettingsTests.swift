import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("TypedEntryEditorModel robots settings (#1093)")
@MainActor
struct TypedEntryEditorModelRobotsSettingsTests {
    private func makeModel(
        route: String = "/notes/my-note/",
        relativeEntryPath: String = "src/content/notes/my-note.md",
        spy: TypedEntryRobotsCommitSpy = TypedEntryRobotsCommitSpy()
    ) throws -> (TypedEntryEditorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("TypedEntryEditorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        let entryURL = dir.appendingPathComponent(relativeEntryPath)
        try FileManager.default.createDirectory(
            at: entryURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "---\npublishDate: 2026-01-01\n---\nBody.\n".write(to: entryURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: entryURL, group: .posts, name: entryURL.lastPathComponent)
        let descriptor = ContentTypeRegistry().descriptor(id: "note")!
        let model = TypedEntryEditorModel(
            file: file, descriptor: descriptor, route: route, sourceDirectory: dir,
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
    }

    @Test("save: enabling noindex writes a collection-sourced entry")
    func saveWritesCollectionEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.noindexBinding().wrappedValue = true
        let saved = await model.save()
        #expect(saved)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.noindex == [RobotsConfigEntry(path: "/notes/my-note/", source: .collection("notes", id: "my-note"))])
    }

    @Test("save: disabling a previously-enabled toggle removes its entry")
    func saveRemovesDisabledEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        _ = await model.save()

        model.disallowCrawlBinding().wrappedValue = false
        _ = await model.save()

        #expect(RobotsConfigFile.read(under: dir).disallow.isEmpty)
    }

    /// `gitCommit` stages one path, so the entry's own commit never carries the shared config —
    /// without a second commit every toggle leaves the site repo dirty forever (#1093).
    @Test("save: a robots change is committed to git, not just written to disk")
    func saveCommitsRobotsConfig() async throws {
        let spy = TypedEntryRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        model.noindexBinding().wrappedValue = true
        _ = await model.save()
        #expect(spy.paths().contains(RobotsConfigFile.relativePath))
        #expect(spy.paths().contains("src/content/notes/my-note.md"))
    }

    @Test("save: a no-op robots write doesn't add a robots-config commit")
    func saveWithoutRobotsChangeSkipsExtraCommit() async throws {
        let spy = TypedEntryRobotsCommitSpy()
        let (model, _) = try makeModel(spy: spy)
        await model.load()
        model.boolBinding("draft").wrappedValue = true
        _ = await model.save()
        #expect(spy.paths() == ["src/content/notes/my-note.md"])
    }
}

/// Records the `(relPath, message)` pairs a model hands its injected `gitCommit`, matching the
/// spy-closure pattern `NavigatorRenameServiceTests` already uses for this seam.
final class TypedEntryRobotsCommitSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(String, String)] = []
    func record(_ rel: String, _ message: String) { lock.lock(); calls.append((rel, message)); lock.unlock() }
    func paths() -> [String] { lock.lock(); defer { lock.unlock() }; return calls.map(\.0) }
}
