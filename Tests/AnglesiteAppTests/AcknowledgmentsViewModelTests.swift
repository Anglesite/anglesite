import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

@Suite("AcknowledgmentsViewModel")
@MainActor
struct AcknowledgmentsViewModelTests {
    private func makeCatalogs() -> [AttributionSource: [OSSAttribution]] {
        [
            .appBinary: [
                OSSAttribution(name: "swift-nio", version: "2.65.0", licenseSPDXId: "Apache-2.0", licenseText: "…", homepage: nil),
                OSSAttribution(name: "SwiftGit2", version: "abc123", licenseSPDXId: "MIT", licenseText: "…", homepage: nil),
            ],
            .containerImage: [
                OSSAttribution(name: "express", version: "4.19.0", licenseSPDXId: "MIT", licenseText: "…", homepage: nil),
            ],
            .websiteTemplate: [],
        ]
    }

    @Test("loadAll populates every source")
    func loadAllPopulatesEverySource() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.catalogs[.appBinary]?.count == 2)
        #expect(model.catalogs[.containerImage]?.count == 1)
        #expect(model.catalogs[.websiteTemplate]?.count == 0)
        #expect(model.unavailableSources.isEmpty)
    }

    @Test("filtered matches case-insensitively by substring")
    func filteredMatchesCaseInsensitiveSubstring() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        model.searchText = "swift"
        #expect(model.filtered(.appBinary).map(\.name).sorted() == ["SwiftGit2", "swift-nio"])
        #expect(model.filtered(.containerImage).isEmpty)
    }

    @Test("empty search returns everything for a source")
    func emptySearchReturnsEverythingForSource() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.filtered(.appBinary).count == 2)
    }

    @Test("a load failure marks its source unavailable without losing the others")
    func loadFailureMarksSourceUnavailableWithoutLosingOthers() {
        struct Boom: Error {}
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(
            load: { source in
                if source == .containerImage { throw Boom() }
                return catalogs[source] ?? []
            },
            log: { _ in }
        )
        model.loadAll()
        #expect(model.unavailableSources.contains(.containerImage))
        #expect(model.catalogs[.containerImage] == nil)
        #expect(model.catalogs[.appBinary]?.count == 2)
    }

    @Test("attribution(withID:) finds an entry across sources")
    func attributionByIDFindsAcrossSources() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.attribution(withID: "express@4.19.0")?.name == "express")
        #expect(model.attribution(withID: "nonexistent@0.0.0") == nil)
    }
}
