import XCTest
@testable import AnglesiteCore

final class ThirdPartyNoticeRendererTests: XCTestCase {
    func testRendersNameVersionLicenseAndHomepage() {
        let attribution = OSSAttribution(
            name: "astro", version: "7.1.3", licenseSPDXId: "MIT",
            licenseText: "MIT License\n\nCopyright (c) …", homepage: "https://astro.build"
        )
        let markdown = ThirdPartyNoticeRenderer.render([attribution])
        XCTAssertTrue(markdown.contains("## astro 7.1.3"))
        XCTAssertTrue(markdown.contains("License: MIT"))
        XCTAssertTrue(markdown.contains("Homepage: https://astro.build"))
        XCTAssertTrue(markdown.contains("MIT License"))
    }

    func testOmitsMissingFieldsGracefully() {
        let attribution = OSSAttribution(
            name: "some-fork", version: "abc123", licenseSPDXId: nil,
            licenseText: "Custom text.", homepage: nil
        )
        let markdown = ThirdPartyNoticeRenderer.render([attribution])
        XCTAssertFalse(markdown.contains("License: "))
        XCTAssertFalse(markdown.contains("Homepage: "))
        XCTAssertTrue(markdown.contains("Custom text."))
    }

    func testEmptyListRendersJustTheHeader() {
        let markdown = ThirdPartyNoticeRenderer.render([])
        XCTAssertTrue(markdown.hasPrefix("# Third-Party Notices"))
    }
}
