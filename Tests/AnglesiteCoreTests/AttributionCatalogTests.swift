import XCTest
@testable import AnglesiteCore

final class AttributionCatalogTests: XCTestCase {
    func testDecodeRoundTripsAFixtureEntry() throws {
        let json = """
        [{"name":"swift-nio","version":"2.65.0","licenseSPDXId":"Apache-2.0","licenseText":"Apache License text…","homepage":"https://github.com/apple/swift-nio"}]
        """
        let entries = try AttributionCatalog.decode(Data(json.utf8), source: .appBinary)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].name, "swift-nio")
        XCTAssertEqual(entries[0].licenseSPDXId, "Apache-2.0")
    }

    func testDecodeToleratesNilHomepageAndSPDXId() throws {
        let json = """
        [{"name":"some-fork","version":"abc1234","licenseSPDXId":null,"licenseText":"Custom license text.","homepage":null}]
        """
        let entries = try AttributionCatalog.decode(Data(json.utf8), source: .containerImage)
        XCTAssertEqual(entries.count, 1)
        XCTAssertNil(entries[0].licenseSPDXId)
        XCTAssertNil(entries[0].homepage)
    }

    func testDecodeThrowsDecodingFailedOnMalformedJSON() {
        XCTAssertThrowsError(try AttributionCatalog.decode(Data("not json".utf8), source: .websiteTemplate)) { error in
            XCTAssertEqual(error as? AttributionCatalogError, .decodingFailed(.websiteTemplate))
        }
    }

    func testLoadThrowsResourceMissingWhenBundleHasNoAttributionsFolder() {
        // Bundle.main inside `swift test` is the xctest runner, which has no
        // Resources/Attributions — same "missing bundled resource" shape TemplateRuntime
        // exercises for Resources/Template (TemplateRuntimeTests.resolveReportsMissingWhenNoSourceFound).
        XCTAssertThrowsError(try AttributionCatalog.load(.appBinary)) { error in
            XCTAssertEqual(error as? AttributionCatalogError, .resourceMissing(.appBinary))
        }
    }
}
