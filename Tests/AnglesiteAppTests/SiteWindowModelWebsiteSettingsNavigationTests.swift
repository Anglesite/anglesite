import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

/// Wiring tests for `SiteWindowModel.openWebsiteSettings(landOn:)` (#975 follow-up): the
/// security-reports toolbar badge's "View all in Security Reports" button needs a route into
/// Website Settings ▸ Security Reports, per the design doc's "its popover is a summary, not the
/// full view" call-out. Covers both the cold-open path (nothing open yet, so the request has to
/// survive `openFile`'s async model-construction `Task` via `pendingWebsiteSettingsTab`) and the
/// already-open path (the request lands directly on the live `PlistEditorModel` instead of
/// rebuilding it) — see `SiteWindowModel.websiteSettingsFileRef()`/`openWebsiteSettings(landOn:)`.
@Suite("SiteWindowModel website settings navigation (#975 follow-up)")
@MainActor
struct SiteWindowModelWebsiteSettingsNavigationTests {
    private func makeModel() -> SiteWindowModel {
        SiteWindowModel(
            contentGraph: SiteContentGraph(),
            knowledgeIndex: SiteKnowledgeIndex(),
            semanticRanker: nil,
            conventionsEngine: ProjectConventionsEngine(),
            runtimeFactory: NeverStartedSiteRuntimeFactory(),
            contentIndexerStore: ContentIndexerStore()
        )
    }

    /// Same shape as `SiteWindowModelTests.makeSitePackage(named:)` — a real `.anglesite` package
    /// skeleton on disk, since `openWebsiteSettings(landOn:)` resolves Info.plist through
    /// `SiteFileTree.layout(for:)`, which needs an actual package to find.
    private func makeSitePackage(named name: String = "Test") throws -> (root: URL, packageURL: URL, package: AnglesitePackage) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-website-settings-nav-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let packageURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (package, _) = try AnglesitePackage.createSkeleton(at: packageURL, displayName: name)
        return (root, packageURL, package)
    }

    @Test("opens Website Settings and requests the given tab when nothing is open yet")
    func coldOpenRequestsTab() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil)

        model.openWebsiteSettings(landOn: .securityReports)

        // Same suspension-point shape as `applyNavigatorSelectionWebsiteSettingsOpensInfoPlist`
        // in `SiteWindowModelTests`: `openFile` builds the `.plist` editor from inside its own
        // `Task`, so poll rather than assert inline.
        while model.activeEditor == nil { await Task.yield() }
        guard case .plist(let plistModel) = model.activeEditor else {
            Issue.record("expected the Info.plist to open as a .plist editor")
            return
        }
        #expect(plistModel.file.url == package.infoPlistURL)
        #expect(plistModel.requestedTab == .securityReports)
        #expect(model.mainPaneMode == .editor(plistModel.file))
    }

    @Test("lands the request on the live PlistEditorModel instead of rebuilding it when already open")
    func reusesLiveModelWhenAlreadyOpen() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil)

        model.openWebsiteSettings(landOn: .website)
        while model.activeEditor == nil { await Task.yield() }
        guard case .plist(let firstModel) = model.activeEditor else {
            Issue.record("expected the Info.plist to open as a .plist editor")
            return
        }
        #expect(firstModel.requestedTab == .website)

        // Navigate away, then request Security Reports from the badge — the scenario this
        // wiring exists for: the pane isn't showing Website Settings right now, but the editor
        // model is still alive underneath.
        model.mainPaneMode = .preview
        model.openWebsiteSettings(landOn: .securityReports)

        guard case .plist(let secondModel) = model.activeEditor else {
            Issue.record("expected the .plist editor to still be active")
            return
        }
        #expect(secondModel === firstModel)
        #expect(secondModel.requestedTab == .securityReports)
        #expect(model.mainPaneMode == .editor(secondModel.file))
    }

    @Test("without an open site does nothing")
    func noSiteIsNoOp() {
        let model = makeModel()
        model.openWebsiteSettings(landOn: .securityReports)
        #expect(model.activeEditor == nil)
        #expect(model.mainPaneMode == .preview)
    }
}
