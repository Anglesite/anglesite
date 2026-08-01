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

    @Test("attribution(withID:) finds an entry in its source")
    func attributionByIDFindsAcrossSources() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.attribution(withID: SelectedAttribution(source: .containerImage, id: "express@4.19.0"))?.name == "express")
        #expect(model.attribution(withID: SelectedAttribution(source: .containerImage, id: "nonexistent@0.0.0")) == nil)
    }

    @Test("attribution(withID:) disambiguates entries sharing a name@version id across sources")
    func attributionByIDDisambiguatesAcrossSources() {
        // container-image and website-template are both npm dependency trees that can
        // (and do) share identical name@version pairs — the lookup must be source-scoped,
        // not resolve to whichever source's copy a flattened dictionary happens to hit first.
        let catalogs: [AttributionSource: [OSSAttribution]] = [
            .appBinary: [],
            .containerImage: [
                OSSAttribution(name: "@babel/code-frame", version: "7.29.7", licenseSPDXId: "MIT", licenseText: "container-image copy", homepage: nil),
            ],
            .websiteTemplate: [
                OSSAttribution(name: "@babel/code-frame", version: "7.29.7", licenseSPDXId: "MIT", licenseText: "website-template copy", homepage: nil),
            ],
        ]
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()

        let containerImageEntry = model.attribution(withID: SelectedAttribution(source: .containerImage, id: "@babel/code-frame@7.29.7"))
        let websiteTemplateEntry = model.attribution(withID: SelectedAttribution(source: .websiteTemplate, id: "@babel/code-frame@7.29.7"))

        #expect(containerImageEntry?.licenseText == "container-image copy")
        #expect(websiteTemplateEntry?.licenseText == "website-template copy")
    }
}
