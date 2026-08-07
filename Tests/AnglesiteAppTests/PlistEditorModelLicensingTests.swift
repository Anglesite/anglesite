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

    @Test("toggling publishRSL is dirty, and round-trips through save/load (#992)")
    func publishRSLDirtyTrackingAndSave() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.licensingPolicy.publishRSL == false)

        model.licensingPolicy.publishRSL = true
        #expect(model.isLicensingDirty == true)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        #expect(model.isLicensingDirty == false)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.publishRSL == true)
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

    /// Pure-value-type coverage for `PendingCustomLicense` itself, independent of the view. These
    /// stay useful alongside the binding-level tests below: they pin down `select`/`recordName`/
    /// `consumeForNewLicense`/`clear`'s own behavior without needing a `ContentLicensingTab` at
    /// all.
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

    /// Direct coverage of the `.custom` setter's decision, independent of the model or view. This
    /// is the exact regression: the pre-fix guard was `license == nil`, so picking Custom… over an
    /// already-selected catalog license (`ccBY` here) did not reveal draft fields and the picker
    /// snapped back — reverting `shouldRevealCustomFields` to that guard must fail the middle
    /// expectation below.
    @Test("shouldRevealCustomFields is true for no license and any catalog license, false for an existing custom one")
    func shouldRevealCustomFieldsDecidesFromThePriorLicenseAlone() {
        #expect(ContentLicensingTab.shouldRevealCustomFields(over: nil) == true)
        #expect(ContentLicensingTab.shouldRevealCustomFields(over: ccBY) == true)

        let existingCustom = LicenseRef(url: "https://mysite.example/license", name: "Site License")
        #expect(ContentLicensingTab.shouldRevealCustomFields(over: existingCustom) == false)
    }

    // MARK: - #991 review finding 1 (regression): driving the real `defaultChoice` binding
    //
    // `ContentLicensingTab`'s `@State var customDraft` genuinely cannot be *mutated* from outside
    // a hosted SwiftUI render pass — a write made through a `Binding`'s setter (even via a
    // mutating method on the wrapped value) on a directly-constructed view is silently dropped,
    // confirmed empirically against this toolchain before writing these tests. So these tests
    // never chain "call the setter, then read the same view's state back" — instead:
    //   - each step of a flow is modeled by constructing a *fresh* `ContentLicensingTab` with the
    //     `customDraft` value that step should already be in (the synthesized memberwise init
    //     accepts it, and *reading* an `@State` property's constructor-supplied initial value
    //     works fine outside hosting — only post-construction writes don't), and
    //   - every setter call is verified through its effect on `model.licensingPolicy`, which is
    //     backed by an `@Observable` class and so genuinely persists across statements.
    // This still drives the real `defaultChoice`/`customURL`/`customName` bindings and the real
    // getter/setter closures in `ContentLicensingTab` — nothing here reimplements their logic.

    // This flow used to start from "All rights reserved" (`defaultLicense == nil`), which only
    // exercises the one guard clause ( `license == nil`) that the pre-fix code already got right —
    // it would have passed under the original #991 regression too. Starting from a catalog
    // license (`ccBY`) instead covers the path that actually broke: picking Custom… over an
    // *already-selected* license.
    @Test("Catalog license to Custom: fields appear, policy untouched, navigating away is clean")
    func allRightsReservedToCustomRevealsFieldsWithoutMutating() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://creativecommons.org/licenses/by/4.0/","name":"CC BY 4.0"}}"#)
        await model.load()
        #expect(model.licensingPolicy.defaultLicense == ccBY)

        // Drive the real setter from the catalog-selected state.
        let view = ContentLicensingTab(model: model)
        view.defaultChoice.wrappedValue = .custom

        // The model is untouched by picking Custom… — the setter's `.custom` branch never writes
        // `model.licensingPolicy` at all.
        #expect(model.licensingPolicy.defaultLicense == ccBY)
        #expect(model.isLicensingDirty == false)

        // The getter reveals empty fields once pending — modeled by a fresh view constructed with
        // the draft state `select()` produces, since that write can't be observed on `view` itself.
        let pendingView = ContentLicensingTab(
            model: model, customDraft: ContentLicensingTab.PendingCustomLicense(isPending: true))
        #expect(pendingView.defaultChoice.wrappedValue == .custom)
        #expect(pendingView.customURL.wrappedValue == "")
        #expect(pendingView.customName.wrappedValue == "")

        // Navigating away neither errors nor blocks: nothing was ever written to the model.
        let flushed = await model.flushBeforeLeaving()
        #expect(flushed == true)
    }

    @Test("CC BY 4.0 to Custom: fields appear empty, policy not mutated until a URL is typed")
    func catalogToCustomRevealsEmptyFieldsWithoutMutating() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = ccBY

        let view = ContentLicensingTab(model: model)
        view.defaultChoice.wrappedValue = .custom

        // Regression check for #991 finding 1: picking Custom… over a catalog license used to be
        // a dead no-op (the setter only went pending when `defaultLicense == nil`), so the model
        // still held `ccBY` and the getter kept reporting `.catalog`, snapping the picker back.
        // The model must stay exactly as it was — untouched, not cleared either.
        #expect(model.licensingPolicy.defaultLicense == ccBY)

        let pendingView = ContentLicensingTab(
            model: model, customDraft: ContentLicensingTab.PendingCustomLicense(isPending: true))
        #expect(pendingView.defaultChoice.wrappedValue == .custom)
        #expect(pendingView.customURL.wrappedValue == "")
        #expect(pendingView.customName.wrappedValue == "")
    }

    @Test("CC BY 4.0 to Custom, then typing a URL, is what gets saved")
    func catalogToCustomThenTypedURLIsWhatGetsWritten() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = ccBY

        // Model the state right after `.custom` was selected over the catalog license and a name
        // was typed into the (still-empty-URL) Name field: pending, with a name recorded but no
        // license created yet. (A *second* write on the same view instance — e.g. calling
        // `customURL` and then `customName` in sequence here — can't be used to build this state:
        // per this file's "driving the real binding" note above, only the first write against a
        // freshly-constructed instance is observable outside a hosted render pass.)
        let pendingView = ContentLicensingTab(
            model: model,
            customDraft: ContentLicensingTab.PendingCustomLicense(isPending: true, pendingName: "My License"))

        // Typing the URL is what actually creates the license, discarding whatever catalog ref was
        // sitting underneath and attaching the already-recorded name.
        pendingView.customURL.wrappedValue = "https://example.com/my-license"

        #expect(model.licensingPolicy.defaultLicense
            == LicenseRef(url: "https://example.com/my-license", name: "My License"))

        let saved = await model.saveLicensing()
        #expect(saved == true)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.defaultLicense == LicenseRef(url: "https://example.com/my-license", name: "My License"))
    }

    @Test("Custom left empty, then a catalog license is picked: the catalog license is written")
    func customLeftEmptyThenCatalogPickedWritesTheCatalogLicense() async throws {
        let model = try makeModel()
        await model.load()

        // Model "selected Custom…, left the URL empty" — pending, with a half-typed name that
        // must not survive the switch to a catalog choice.
        let pendingView = ContentLicensingTab(
            model: model,
            customDraft: ContentLicensingTab.PendingCustomLicense(isPending: true, pendingName: "Half-typed"))

        pendingView.defaultChoice.wrappedValue = .catalog("cc-by-4.0")

        #expect(model.licensingPolicy.defaultLicense == ccBY)
        #expect(model.isLicensingDirty == true)
        // The draft's own discard-on-clear behavior is covered directly by
        // `pendingCustomLicenseClearResetsEverything` above; `defaultChoice`'s `.catalog` branch
        // calls the same `customDraft.clear()`.
    }

    @Test("a non-catalog license already in licensing.json loads showing Custom with fields populated")
    func nonCatalogLicenseLoadsAsCustomWithFieldsPopulated() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://mysite.example/license","name":"Site License"}}"#)
        await model.load()

        let view = ContentLicensingTab(model: model)

        #expect(view.defaultChoice.wrappedValue == .custom)
        #expect(view.customURL.wrappedValue == "https://mysite.example/license")
        #expect(view.customName.wrappedValue == "Site License")
    }

    // As above: starting from "All rights reserved" only exercises the guard clause the pre-fix
    // code already handled correctly. Starting from a catalog license instead covers the path
    // that actually broke.
    @Test("Catalog license, Custom left empty, then navigating away: no error, no blocked navigation")
    func customLeftEmptyThenNavigatingAwayDoesNotBlock() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://creativecommons.org/licenses/by/4.0/","name":"CC BY 4.0"}}"#)
        await model.load()
        #expect(model.licensingPolicy.defaultLicense == ccBY)

        let view = ContentLicensingTab(model: model)
        view.defaultChoice.wrappedValue = .custom

        #expect(model.licensingPolicy.defaultLicense == ccBY)
        #expect(model.isLicensingDirty == false)
        let flushed = await model.flushBeforeLeaving()
        #expect(flushed == true)
    }

    /// Regression coverage for the `customName` setter's `!customDraft.isPending` guard: while
    /// pending (Custom… picked over a catalog license, no URL typed yet), typing into the Name
    /// field must go to the draft, not rename the catalog ref still sitting in the model
    /// underneath. Dropping that guard makes the setter fall through to
    /// `model.licensingPolicy.defaultLicense?.name = newValue` whenever a license already exists,
    /// pending or not — renaming `ccBY` in place and dirtying the model.
    @Test("typing a name while pending records it in the draft, leaving a catalog license alone")
    func customNameWhilePendingDoesNotRenameTheUnderlyingCatalogLicense() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://creativecommons.org/licenses/by/4.0/","name":"CC BY 4.0"}}"#)
        await model.load()
        #expect(model.licensingPolicy.defaultLicense == ccBY)

        let pendingView = ContentLicensingTab(
            model: model, customDraft: ContentLicensingTab.PendingCustomLicense(isPending: true))
        pendingView.customName.wrappedValue = "X"

        #expect(model.licensingPolicy.defaultLicense == ccBY)
    }

    /// End-to-end confirmation that the tab-level fix does not regress ordinary use: a genuinely
    /// typed custom license still saves.
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
