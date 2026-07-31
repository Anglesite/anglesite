import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("TypedEntryEditorModel siteDefaultLangTag (#956)")
@MainActor
struct TypedEntryEditorModelLangTests {
    private func makeModel(config: String? = nil) throws -> TypedEntryEditorModel {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("TypedEntryEditorModelLangTests-\(UUID().uuidString)", isDirectory: true)
        let entryURL = dir.appendingPathComponent("src/content/notes/my-note.md")
        try FileManager.default.createDirectory(
            at: entryURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "---\npublishDate: 2026-01-01\n---\nBody.\n".write(to: entryURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        let file = FileRef(url: entryURL, group: .posts, name: entryURL.lastPathComponent)
        let descriptor = ContentTypeRegistry().descriptor(id: "note")!
        return TypedEntryEditorModel(file: file, descriptor: descriptor, route: "/notes/my-note/", sourceDirectory: dir)
    }

    @Test("loads the site default language tag from .site-config")
    func loadsSeededTag() async throws {
        let model = try makeModel(config: "LANG=fr-CA\n")
        await model.load()
        #expect(model.siteDefaultLangTag == "fr-CA")
    }

    @Test("defaults to en when .site-config is absent")
    func defaultsToEnglishWhenConfigAbsent() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.siteDefaultLangTag == "en")
    }

    @Test("defaults to en when .site-config has no LANG key")
    func defaultsToEnglishWhenNoLangKey() async throws {
        let model = try makeModel(config: "SITE_NAME=Acme\n")
        await model.load()
        #expect(model.siteDefaultLangTag == "en")
    }
}
