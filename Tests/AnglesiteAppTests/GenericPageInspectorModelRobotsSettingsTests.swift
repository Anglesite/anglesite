import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("GenericPageInspectorModel robots settings (#1093)")
@MainActor
struct GenericPageInspectorModelRobotsSettingsTests {
    private func makeModel(route: String = "/") throws -> (GenericPageInspectorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("GenericPageInspectorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/index.astro")
        try "---\nconst title = \"Home\";\n---\n<h1>{title}</h1>\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "index.astro")
        return (GenericPageInspectorModel(file: file, route: route, sourceDirectory: dir), dir)
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
}
