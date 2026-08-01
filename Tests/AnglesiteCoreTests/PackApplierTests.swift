import XCTest
@testable import AnglesiteCore

final class PackApplierTests: XCTestCase {

    private var template: URL!
    private var site: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        template = base.appendingPathComponent("template")
        site = base.appendingPathComponent("site")
        // Minimal scaffolded site: base global.css + a page the pack does NOT override.
        try write("::root base", to: site.appendingPathComponent("src/styles/global.css"))
        try write("<h1>About</h1>", to: site.appendingPathComponent("src/pages/about.astro"))
        // Pack overlay: replaces global.css, adds a component in a nested dir, ships a LICENSE.
        let pack = template.appendingPathComponent("packs/paper")
        try write(":root { --pack: 1 }", to: pack.appendingPathComponent("src/styles/global.css"))
        try write("<nav/>", to: pack.appendingPathComponent("src/components/PaperNav.astro"))
        try write("MIT License — upstream", to: pack.appendingPathComponent("LICENSE"))
    }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func read(_ url: URL) throws -> String { try String(contentsOf: url, encoding: .utf8) }

    func testApplyOverlaysReplacesAndAddsFiles() throws {
        try PackApplier.apply(packNamed: "paper", templateURL: template, siteDirectory: site)
        XCTAssertEqual(try read(site.appendingPathComponent("src/styles/global.css")), ":root { --pack: 1 }")
        XCTAssertEqual(try read(site.appendingPathComponent("src/components/PaperNav.astro")), "<nav/>")
        // Files the pack doesn't override survive.
        XCTAssertEqual(try read(site.appendingPathComponent("src/pages/about.astro")), "<h1>About</h1>")
    }

    func testApplyCopiesLicenseToSiteRoot() throws {
        try PackApplier.apply(packNamed: "paper", templateURL: template, siteDirectory: site)
        XCTAssertEqual(try read(site.appendingPathComponent(PackApplier.licenseFileName)),
                       "MIT License — upstream")
    }

    func testApplyThrowsWhenPackMissing() {
        XCTAssertThrowsError(try PackApplier.apply(packNamed: "nope", templateURL: template, siteDirectory: site)) { error in
            guard case PackApplier.PackError.packNotFound = error else {
                return XCTFail("expected packNotFound, got \(error)")
            }
        }
    }
}
