import XCTest
@testable import AnglesiteCore

@MainActor
final class NewSiteWizardModelTests: XCTestCase {
    private func catalog() -> ThemeCatalog {
        ThemeCatalog(themes: [
            Theme(id: "classic", name: "Classic", blurb: "", swatch: [], cssVars: [:]),
            Theme(id: "warm", name: "Warm", blurb: "", swatch: [], cssVars: [:]),
        ])
    }

    // MARK: Chooser state (#1071)

    func testStartsOnChooserWithFirstThemeAndUntitledDraft() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        XCTAssertEqual(m.step, .chooser)
        XCTAssertEqual(m.draft.themeID, "classic")     // catalog order, not a per-type default
        XCTAssertEqual(m.draft.name, "Untitled")
        XCTAssertEqual(m.draft.saveFileName, "Untitled.anglesite")
        XCTAssertEqual(m.draft.siteType, .blank)
        XCTAssertEqual(m.draft.domainChoice, .later)   // deferred to publish (#1071)
        XCTAssertEqual(m.draft.headline, "")           // template placeholder stays
        XCTAssertTrue(m.canCreate)
    }

    func testUntitledNameSkipsTakenNames() {
        let m = NewSiteWizardModel(catalog: catalog(),
                                   isNameTaken: { ["Untitled", "Untitled 2"].contains($0) })
        XCTAssertEqual(m.draft.name, "Untitled 3")
        XCTAssertEqual(m.draft.saveFileName, "Untitled 3.anglesite")
    }

    func testCanCreateRequiresACatalogTheme() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        m.draft.themeID = "no-such-theme"
        XCTAssertFalse(m.canCreate)
        m.draft.themeID = "warm"
        XCTAssertTrue(m.canCreate)
    }

    func testEmptyCatalogCannotCreate() {
        let m = NewSiteWizardModel(catalog: ThemeCatalog(themes: []), isNameTaken: { _ in false })
        XCTAssertFalse(m.canCreate)
    }

    // MARK: Build warnings (#229)

    /// A scaffolder whose `scaffold.sh` writes the template files the appliers expect, then emits a
    /// non-fatal `git init` warning.
    private func warningScaffolder(root: URL) -> SiteScaffolder {
        SiteScaffolder(
            sitesRoot: root,
            templateURL: URL(fileURLWithPath: "/template"),
            catalog: catalog(),
            run: { _, args, cwd in
                if args.contains(where: { $0.hasSuffix("scaffold.sh") }), let cwd {
                    let css = cwd.appendingPathComponent("src/styles/global.css")
                    let astro = cwd.appendingPathComponent("src/pages/index.astro")
                    try? FileManager.default.createDirectory(at: css.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? FileManager.default.createDirectory(at: astro.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? ":root { --color-primary: #2563eb; }".write(to: css, atomically: true, encoding: .utf8)
                    try? "<h1>Welcome</h1>".write(to: astro, atomically: true, encoding: .utf8)
                    try? "ANGLESITE_VERSION=1.0.0".write(to: cwd.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
                }
                return ProcessSupervisor.RunResult(stdout: "", stderr: "", exitCode: 0)
            },
            gitInit: { _ in throw CocoaError(.fileWriteUnknown) },
            gitCommit: { _ in },
            register: { pkg in SiteStore.Site(id: pkg.url.path, name: pkg.url.lastPathComponent, packageURL: pkg.url, isValid: true, missingSentinels: []) }
        )
    }

    func testFreshModelHasNoWarningsAndIsNotCompletedCleanly() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        XCTAssertFalse(m.hasWarnings)
        XCTAssertTrue(m.warnings.isEmpty)
        XCTAssertFalse(m.didCompleteCleanly)
    }

    func testBuildEntersBuildingStepAndDisablesCreate() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        _ = await m.build(using: warningScaffolder(root: root))
        XCTAssertEqual(m.step, .building)
        XCTAssertFalse(m.canCreate)
    }

    func testBuildWithWarningSurfacesWarningAndBlocksCleanCompletion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })

        let id = await m.build(using: warningScaffolder(root: root))

        XCTAssertNotNil(id)                       // the site was still registered
        XCTAssertTrue(m.hasWarnings)              // …but with a non-fatal warning
        // Assert on the stable step identifier, not the (rephrasable) message text.
        XCTAssertTrue(m.progress.contains {
            if case .warning(let step, _) = $0 { return step == "copyingTemplate" } else { return false }
        })
        XCTAssertFalse(m.didCompleteCleanly)      // so the wizard must NOT auto-open
    }
}
