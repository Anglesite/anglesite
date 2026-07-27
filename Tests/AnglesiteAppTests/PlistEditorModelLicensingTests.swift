import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel content licensing (#991)")
@MainActor
struct PlistEditorModelLicensingTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private let ccBY = LicenseRef(url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")

    /// Builds a `PlistEditorModel` against a fresh temp `sourceDirectory` with a minimal
    /// `Info.plist` and, when given, a `src/data/licensing.json`.
    private func makeModel(licensingJSON: String? = nil) throws -> PlistEditorModel {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelLicensingTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let plistURL = dir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let licensingJSON {
            let dataDir = dir.appendingPathComponent("src/data", isDirectory: true)
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try licensingJSON.write(
                to: dataDir.appendingPathComponent("licensing.json"), atomically: true, encoding: .utf8)
        }
        let file = FileRef(url: plistURL, group: .metadata, name: "Info.plist")
        return PlistEditorModel(file: file, websiteTitle: "Test Site", sourceDirectory: dir)
    }

    @Test("load() yields an empty policy when licensing.json is absent")
    func loadDefaultsWhenAbsent() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.licensingPolicy == LicensingPolicy())
        #expect(model.isLicensingDirty == false)
        #expect(model.licensingLoadFailed == false)
    }

    @Test("load() populates the policy from an existing licensing.json")
    func loadPopulates() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://creativecommons.org/licenses/by/4.0/","name":"CC BY 4.0"},"collections":{"notes":null},"usage":{"search":"yes","aiTrain":"no"}}"#)
        await model.load()
        #expect(model.licensingPolicy.defaultLicense == ccBY)
        #expect(model.licensingPolicy.rule(for: .notes) == .assertNothing)
        #expect(model.licensingPolicy.rule(for: .photos) == .inherit)
        #expect(model.licensingPolicy.usage.search == .yes)
        #expect(model.licensingPolicy.usage.aiTrain == .no)
        #expect(model.isLicensingDirty == false)
    }

    @Test("isLicensingDirty flips true after an edit, false after save, and the write lands on disk")
    func dirtyTrackingAndSave() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = ccBY
        #expect(model.isLicensingDirty == true)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        #expect(model.isLicensingDirty == false)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.defaultLicense == ccBY)
    }

    // This test is the only thing standing between the repo and a reintroduced infinite-recursion
    // SIGSEGV: `model.licensingPolicy.usage.aiTrain = .yes` below writes through `@Observable`'s
    // generated setter for `licensingPolicy`, which is exactly the reentrant path described in
    // `PlistEditorModel`'s `licensingPolicy` `didSet` (`Sources/AnglesiteApp/PlistEditorModel.swift`)
    // — deleting that `didSet`'s `if clamped != licensingPolicy.usage` guard crashes this whole test
    // suite, not just this one test. Do not "simplify" either one without keeping the other in mind.
    @Test("permitting an AI purpose clears a blocklist toggle that is no longer allowed")
    func editingUsageClearsBlocklist() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.usage = AIUsage(aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        #expect(model.licensingPolicy.usage.blockAICrawlers == true)

        model.licensingPolicy.usage.aiTrain = .yes

        #expect(model.licensingPolicy.usage.blockAICrawlers == false)
    }

    @Test("a malformed licensing.json blocks the save rather than overwriting it")
    func refusesToSaveOverUnreadableFile() async throws {
        let model = try makeModel(licensingJSON: "{ not json")
        await model.load()
        #expect(model.licensingLoadFailed == true)
        #expect(model.licensingError != nil)

        model.licensingPolicy.defaultLicense = ccBY
        let saved = await model.saveLicensing()

        #expect(saved == false)
        let onDisk = try String(
            contentsOf: model.sourceDirectory.appendingPathComponent("src/data/licensing.json"),
            encoding: .utf8)
        #expect(onDisk == "{ not json")
    }

    @Test("an unsafe license URL surfaces an error instead of being written")
    func rejectsUnsafeURL() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(url: "javascript:alert(1)", name: "Evil")

        let saved = await model.saveLicensing()

        #expect(saved == false)
        #expect(model.licensingError != nil)
    }

    @Test("a no-op save on an unedited model returns true and does not create licensing.json")
    func saveNoOpsWhenClean() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.isLicensingDirty == false)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        let licensingPath = model.sourceDirectory.appendingPathComponent("src/data/licensing.json")
        #expect(!FileManager.default.fileExists(atPath: licensingPath.path))
    }

    // MARK: - #991 review finding 1: "Custom…" without a typed URL

    /// The store-level (second) defense: no matter how an empty-URL default license reaches
    /// `saveLicensing`, it must save cleanly as "no license" instead of throwing
    /// `unsafeLicenseURL("")` and blocking `flushBeforeLeaving`.
    @Test("an empty-URL default license saves as no license instead of blocking the flush")
    func emptyURLDefaultLicenseSavesAsNoLicense() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(url: "", name: "")
        #expect(model.isLicensingDirty == true)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        #expect(model.licensingError == nil)
        #expect(model.licensingPolicy.defaultLicense == nil)
        #expect(model.isLicensingDirty == false)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.defaultLicense == nil)
    }

    /// The tab-level (first) defense, tested directly on `ContentLicensingTab.PendingCustomLicense`
    /// rather than by driving the view's `@State` from outside a live SwiftUI hierarchy — `@State`
    /// writes are silently dropped when a `View` value is constructed and manipulated directly
    /// (as a unit test must) instead of hosted by SwiftUI's render pass, so a test spanning
    /// separate statements can't observe its own writes through the view. Extracting the logic
    /// into this plain value type is what makes it verifiable at all.
    @Test("selecting Custom reveals fields without creating a license")
    func pendingCustomLicenseSelectDoesNotCreateALicense() {
        var draft = ContentLicensingTab.PendingCustomLicense()
        draft.select()
        #expect(draft.isPending == true)
        #expect(draft.pendingName == "")
    }

    @Test("a name typed before the URL is preserved for the license the URL creates")
    func pendingCustomLicenseCarriesTypedNameToTheNewLicense() {
        var draft = ContentLicensingTab.PendingCustomLicense()
        draft.select()
        draft.recordName("My License")

        let name = draft.consumeForNewLicense()

        #expect(name == "My License")
        #expect(draft.isPending == false)
        #expect(draft.pendingName == "")
    }

    @Test("picking a different choice clears any pending custom state")
    func pendingCustomLicenseClearResetsEverything() {
        var draft = ContentLicensingTab.PendingCustomLicense()
        draft.select()
        draft.recordName("Half-typed")

        draft.clear()

        #expect(draft == ContentLicensingTab.PendingCustomLicense())
    }

    /// End-to-end confirmation that the tab-level fix does not regress ordinary use: a genuinely
    /// typed custom license still saves. This drives `ContentLicensingTab`'s bindings within a
    /// single statement each — the one shape of direct manipulation that does not depend on
    /// `@State` persisting across statements outside a hosted view (see the tests above).
    @Test("choosing Custom… and typing a URL directly on the model still saves")
    func typingACustomURLDirectlyOnTheModelStillSaves() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(url: "https://example.com/my-license", name: "My License")
        #expect(model.isLicensingDirty == true)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.defaultLicense == LicenseRef(url: "https://example.com/my-license", name: "My License"))
    }
}
