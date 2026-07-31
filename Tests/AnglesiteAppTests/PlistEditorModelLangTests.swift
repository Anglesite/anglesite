import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel Language (#956)")
@MainActor
struct PlistEditorModelLangTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(config: String? = nil) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PlistEditorModelLangTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: directory.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        return PlistEditorModel(file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"), websiteTitle: "Test Site", sourceDirectory: directory)
    }

    @Test("loads the language from .site-config")
    func load() async throws {
        let model = try makeModel(config: "LANG=fr-CA\n")
        await model.load()
        #expect(model.langSettings == .init(lang: "fr-CA"))
        #expect(!model.isLangDirty)
    }

    @Test("a site scaffolded before LANG existed loads as en")
    func loadDefaultsToEnglish() async throws {
        let model = try makeModel(config: "SITE_NAME=Acme\n")
        await model.load()
        #expect(model.langSettings == .init(lang: "en"))
    }

    @Test("saves a dirty language facet and includes it in aggregate saves")
    func save() async throws {
        let model = try makeModel()
        await model.load()
        model.langSettings = .init(lang: "es")
        #expect(model.isLangDirty)
        #expect(model.hasAnyUnsavedEdits)
        await model.saveAllDirty()
        #expect(!model.isLangDirty)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteLanguageAsset.parseSettings(from: config) == model.langSettings)
    }
}
