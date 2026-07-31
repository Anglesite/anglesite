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

    /// The collection loaders glob `**/*.md`, so a bare-basename id would make these two entries
    /// indistinguishable and toggling one would silently move the other's settings (#1093 review).
    @Test("save: a nested entry's id keeps its subdirectory, so same-basename entries don't collide")
    func nestedEntriesGetDistinctIds() async throws {
        let (a, dirA) = try makeModel(
            route: "/notes/2026/my-note/", relativeEntryPath: "src/content/notes/2026/my-note.md")
        await a.load()
        a.noindexBinding().wrappedValue = true
        _ = await a.save()
        #expect(RobotsConfigFile.read(under: dirA).noindex.map(\.source) == [.collection("notes", id: "2026/my-note")])

        let (b, dirB) = try makeModel(
            route: "/notes/2025/my-note/", relativeEntryPath: "src/content/notes/2025/my-note.md")
        await b.load()
        b.noindexBinding().wrappedValue = true
        _ = await b.save()
        #expect(RobotsConfigFile.read(under: dirB).noindex.map(\.source) == [.collection("notes", id: "2025/my-note")])
    }

    /// A `hasPrefix` string check against the collection root (without a `/`-boundary guard) would
    /// treat `notes-archive/` as nested inside a `notes` collection, since `"notes-archive"` starts
    /// with the string `"notes"`. That must not happen: an entry that doesn't actually live under
    /// its descriptor's collection root falls back to its bare basename id rather than a mangled
    /// `-archive/my-note` id (#1093 review).
    @Test("save: a sibling directory sharing the collection name as a string prefix doesn't collide")
    func siblingDirectoryPrefixDoesNotCollide() async throws {
        let (model, dir) = try makeModel(
            route: "/notes/my-note/", relativeEntryPath: "src/content/notes-archive/my-note.md")
        await model.load()
        model.noindexBinding().wrappedValue = true
        _ = await model.save()
        #expect(RobotsConfigFile.read(under: dir).noindex.map(\.source) == [.collection("notes", id: "my-note")])
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
