import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("TypedEntryEditorModel robots settings (#1093)")
@MainActor
struct TypedEntryEditorModelRobotsSettingsTests {
    private func makeModel(route: String = "/notes/my-note/") throws -> (TypedEntryEditorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("TypedEntryEditorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/content/notes"), withIntermediateDirectories: true)
        let entryURL = dir.appendingPathComponent("src/content/notes/my-note.md")
        try "---\npublishDate: 2026-01-01\n---\nBody.\n".write(to: entryURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: entryURL, group: .posts, name: "my-note.md")
        let descriptor = ContentTypeRegistry().descriptor(id: "note")!
        return (TypedEntryEditorModel(file: file, descriptor: descriptor, route: route, sourceDirectory: dir), dir)
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
}
