import Foundation
import Testing
@testable import AnglesiteCore

@Suite("LicenseCatalog (#991)")
struct LicenseCatalogTests {
    private var ccBY: LicenseRef { LicenseCatalog.entries.first { $0.id == "cc-by-4.0" }!.ref }
    private var ccBYNC: LicenseRef { LicenseCatalog.entries.first { $0.id == "cc-by-nc-4.0" }!.ref }
    private let custom = LicenseRef(url: "https://example.com/terms", name: "House terms")

    @Test("every catalog entry has a safe URL and a unique id")
    func entriesWellFormed() {
        #expect(LicenseCatalog.entries.count == 7)
        #expect(Set(LicenseCatalog.entries.map(\.id)).count == LicenseCatalog.entries.count)
        for entry in LicenseCatalog.entries {
            #expect(LicenseRef.isSafeLicenseURL(entry.url), "\(entry.id) has an unsafe URL")
        }
    }

    @Test("only CC0, CC BY, and CC BY-SA are classified as permitting AI use")
    func classification() {
        let permitting = Set(LicenseCatalog.entries.filter(\.permitsAIUse).map(\.id))
        #expect(permitting == ["cc0-1.0", "cc-by-4.0", "cc-by-sa-4.0"])
    }

    @Test("entry(for:) matches by URL and returns nil for a custom or absent license")
    func entryLookup() {
        #expect(LicenseCatalog.entry(for: ccBY)?.id == "cc-by-4.0")
        #expect(LicenseCatalog.entry(for: custom) == nil)
        #expect(LicenseCatalog.entry(for: nil) == nil)
    }

    @Test("prefilled fills only unspecified purposes for a permitting license")
    func prefillFillsUnspecified() {
        let out = LicenseCatalog.prefilled(AIUsage(), for: ccBY)
        #expect(out == AIUsage(search: .yes, aiInput: .yes, aiTrain: .yes, blockAICrawlers: false))
    }

    @Test("prefilled never overwrites a purpose the user already set")
    func prefillPreservesChoices() {
        let existing = AIUsage(search: .unset, aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        let out = LicenseCatalog.prefilled(existing, for: ccBY)
        #expect(out.search == .yes)
        #expect(out.aiInput == .no)
        #expect(out.aiTrain == .no)
        #expect(out.blockAICrawlers == true)
    }

    @Test("prefilled leaves usage untouched for an unclassified or absent license")
    func prefillSkipsUnclassified() {
        #expect(LicenseCatalog.prefilled(AIUsage(), for: ccBYNC) == AIUsage())
        #expect(LicenseCatalog.prefilled(AIUsage(), for: custom) == AIUsage())
        #expect(LicenseCatalog.prefilled(AIUsage(), for: nil) == AIUsage())
    }

    @Test("coherenceWarning fires when a permitting license is paired with a denial")
    func warningFires() {
        let denyTrain = AIUsage(aiTrain: .no)
        #expect(
            LicenseCatalog.coherenceWarning(for: ccBY, usage: denyTrain)
                == .licensePermitsDeniedUse(licenseName: "CC BY 4.0"))
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(aiInput: .no)) != nil)
    }

    @Test("coherenceWarning stays silent for permitted use, denied search, or an unclassified license")
    func warningSilent() {
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(aiInput: .yes, aiTrain: .yes)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(search: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: ccBYNC, usage: AIUsage(aiTrain: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: custom, usage: AIUsage(aiTrain: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: nil, usage: AIUsage(aiTrain: .no)) == nil)
    }
}
