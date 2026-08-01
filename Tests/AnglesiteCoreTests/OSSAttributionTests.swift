import XCTest
@testable import AnglesiteCore

final class OSSAttributionTests: XCTestCase {
    func testIdentityCombinesNameAndVersion() {
        let attribution = OSSAttribution(
            name: "swift-nio", version: "2.65.0", licenseSPDXId: "Apache-2.0",
            licenseText: "Apache License", homepage: "https://github.com/apple/swift-nio"
        )
        XCTAssertEqual(attribution.id, "swift-nio@2.65.0")
    }

    func testCodableRoundTrips() throws {
        let original = OSSAttribution(
            name: "SwiftGit2", version: "abc1234", licenseSPDXId: nil,
            licenseText: "Custom license text.", homepage: nil
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(OSSAttribution.self, from: data)
        XCTAssertEqual(decoded, original)
    }

    func testAttributionSourceRawValuesMatchManifestFileStems() {
        XCTAssertEqual(AttributionSource.appBinary.rawValue, "app-binary")
        XCTAssertEqual(AttributionSource.containerImage.rawValue, "container-image")
        XCTAssertEqual(AttributionSource.websiteTemplate.rawValue, "website-template")
    }

    func testDisplayNames() {
        XCTAssertEqual(AttributionSource.appBinary.displayName, "App")
        XCTAssertEqual(AttributionSource.containerImage.displayName, "Container & Sidecar")
        XCTAssertEqual(AttributionSource.websiteTemplate.displayName, "Website Template")
    }
}
