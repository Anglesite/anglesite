import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("PageMetadataModel robots settings (#1093)")
@MainActor
struct PageMetadataModelRobotsSettingsTests {
    private func makeModel(route: String = "/a-page/") throws -> (PageMetadataModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PageMetadataModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/a-page.md")
        try "---\ntitle: \"A Page\"\ndescription: \"D\"\n---\nBody.\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "a-page.md")
        return (PageMetadataModel(file: file, route: route, sourceDirectory: dir), dir)
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
}
