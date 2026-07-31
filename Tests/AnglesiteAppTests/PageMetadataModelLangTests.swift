import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PageMetadataModel siteDefaultLangTag (#956)")
@MainActor
struct PageMetadataModelLangTests {
    private func makeModel(config: String? = nil) throws -> (PageMetadataModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PageMetadataModelLangTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/a-page.md")
        try "---\ntitle: \"A Page\"\ndescription: \"D\"\n---\nBody.\n".write(to: pageURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        let file = FileRef(url: pageURL, group: .pages, name: "a-page.md")
        let model = PageMetadataModel(file: file, route: "/a-page/", sourceDirectory: dir)
        return (model, dir)
    }

    @Test("loads the site default language tag from .site-config")
    func loadsSeededTag() async throws {
        let (model, _) = try makeModel(config: "LANG=fr-CA\n")
        await model.load()
        #expect(model.siteDefaultLangTag == "fr-CA")
    }

    @Test("defaults to en when .site-config is absent")
    func defaultsToEnglishWhenConfigAbsent() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.siteDefaultLangTag == "en")
    }

    @Test("defaults to en when .site-config has no LANG key")
    func defaultsToEnglishWhenNoLangKey() async throws {
        let (model, _) = try makeModel(config: "SITE_NAME=Acme\n")
        await model.load()
        #expect(model.siteDefaultLangTag == "en")
    }

    @Test("a lang edit shows up as dirty and round-trips through save()")
    func editIsDirtyAndSaves() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        #expect(model.isDirty == false)

        model.langBinding().wrappedValue = "es"
        #expect(model.isDirty)

        let saved = await model.save()
        #expect(saved)
        #expect(!model.isDirty)

        let contents = try String(contentsOf: dir.appendingPathComponent("src/pages/a-page.md"), encoding: .utf8)
        let reread = PageMetadataEditor.read(contents)
        #expect(reread.lang == "es")
        #expect(model.langBinding().wrappedValue == "es")
    }
}
