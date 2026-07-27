import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

/// Tests the aggregate dirty/save seam (#741) that `SiteWindowModel` folds over instead of
/// hand-checking each settings-pane facet (Website, Analytics, Redirects) by name. These tests
/// prove the aggregation is generic — driven by whichever facet is dirty, not hardcoded to only
/// two of the three — so a future settings pane registered in `PlistEditorModel.dirtyFacets`
/// needs no further edits here or in `SiteWindowModel`.
@Suite("PlistEditorModel dirty-facet aggregation (#741)")
@MainActor
struct PlistEditorModelDirtyFacetsTests {
    // Includes `displayName` (unlike the sibling `PlistEditorModelRedirectsTests` fixture) so
    // `websiteTitle`'s setter — which only mutates an *existing* display-name entry — has one to
    // find, letting the "every dirty facet" test dirty the Website facet realistically.
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
            <key>displayName</key>
            <string>Test Site</string>
        </dict></plist>
        """

    private func makeModel() throws -> PlistEditorModel {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelDirtyFacetsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let plistURL = dir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: plistURL, group: .metadata, name: "Info.plist")
        return PlistEditorModel(file: file, websiteTitle: "Test Site", sourceDirectory: dir)
    }

    @Test("hasAnyUnsavedEdits is false on a freshly loaded model")
    func hasAnyUnsavedEditsFalseWhenClean() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.hasAnyUnsavedEdits == false)
    }

    @Test("hasAnyUnsavedEdits reflects Redirects dirty state alone, with Website/Analytics untouched")
    func hasAnyUnsavedEditsReflectsRedirectsAlone() async throws {
        let model = try makeModel()
        await model.load()
        model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "/old", destination: "/new", code: .permanent))
        #expect(model.isDirty == false)
        #expect(model.isAnalyticsDirty == false)
        #expect(model.hasAnyUnsavedEdits == true)
    }

    @Test("hasAnyUnsavedEdits reflects Analytics dirty state alone")
    func hasAnyUnsavedEditsReflectsAnalyticsAlone() async throws {
        let model = try makeModel()
        await model.load()
        model.analyticsSettings.cloudflareToken = "some-site-tag"
        #expect(model.isDirty == false)
        #expect(model.isRedirectsDirty == false)
        #expect(model.hasAnyUnsavedEdits == true)
    }

    @Test("saveAllDirty saves only Redirects when only Redirects is dirty")
    func saveAllDirtySavesOnlyDirtyFacet() async throws {
        let model = try makeModel()
        await model.load()
        model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "/old", destination: "/new", code: .permanent))

        await model.saveAllDirty()

        #expect(model.isRedirectsDirty == false)
        #expect(try RedirectsStore(sourceDirectory: model.sourceDirectory).load() == model.redirectEntries)
        #expect(model.hasAnyUnsavedEdits == false)
    }

    @Test("saveAllDirty saves every dirty facet in one call")
    func saveAllDirtySavesEveryDirtyFacet() async throws {
        let model = try makeModel()
        await model.load()
        model.websiteTitle = "Renamed Site"
        model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "/a", destination: "/b", code: .permanent))
        #expect(model.isDirty == true)
        #expect(model.isRedirectsDirty == true)

        await model.saveAllDirty()

        #expect(model.hasAnyUnsavedEdits == false)
        #expect(try RedirectsStore(sourceDirectory: model.sourceDirectory).load() == model.redirectEntries)
    }

    @Test("saveAllDirty leaves a facet dirty when its own validation rejects the save, without blocking the others")
    func saveAllDirtyLeavesInvalidFacetDirty() async throws {
        let model = try makeModel()
        await model.load()
        // An identical source/destination fails RedirectsStore's own validation (mirrors
        // PlistEditorModelRedirectsTests.saveValidationFailureSurfacesError).
        model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "/a", destination: "/a", code: .permanent))
        model.websiteTitle = "Renamed Site"

        await model.saveAllDirty()

        #expect(model.isRedirectsDirty == true)
        #expect(model.redirectsError != nil)
        #expect(model.isDirty == false, "the Website facet should still have saved despite Redirects failing validation")
    }

    @Test("hasAnyUnsavedEdits reflects content-licensing dirty state alone — the #991 facet added after this seam existed")
    func hasAnyUnsavedEditsReflectsLicensingAlone() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(
            url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")
        #expect(model.isDirty == false)
        #expect(model.isRedirectsDirty == false)
        #expect(model.isAnalyticsDirty == false)
        #expect(model.hasAnyUnsavedEdits == true)
    }

    @Test("saveAllDirty saves a dirty licensing policy into licensing.json")
    func saveAllDirtySavesLicensing() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(
            url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")
        model.licensingPolicy.usage.aiTrain = .no

        await model.saveAllDirty()

        #expect(model.isLicensingDirty == false)
        let onDisk = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(onDisk == model.licensingPolicy)
    }

    @Test("isAnySaving is true while saveRedirects is in flight")
    func isAnySavingReflectsRedirectsInFlight() async throws {
        let model = try makeModel()
        await model.load()
        model.redirectEntries.append(RedirectsStore.RedirectEntry(source: "/old", destination: "/new", code: .permanent))

        async let saveTask: Void = model.saveAllDirty()
        // `isSavingRedirects` is set synchronously before the off-main write, so a single yield is
        // enough to observe it — matching the polling pattern used elsewhere in this test target.
        var sawSaving = false
        for _ in 0..<1000 where !sawSaving {
            if model.isAnySaving { sawSaving = true }
            await Task.yield()
        }
        await saveTask
        #expect(sawSaving)
        #expect(model.isAnySaving == false)
    }

    @Test("flushBeforeLeaving saves a dirty licensing facet instead of discarding it")
    func flushBeforeLeavingSavesLicensing() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(
            url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")
        #expect(model.isLicensingDirty)
        #expect(await model.flushBeforeLeaving())
        #expect(!model.isLicensingDirty)
        let onDisk = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(onDisk.defaultLicense?.url == "https://creativecommons.org/licenses/by/4.0/")
        #expect(onDisk.defaultLicense?.name == "CC BY 4.0")
    }
}
