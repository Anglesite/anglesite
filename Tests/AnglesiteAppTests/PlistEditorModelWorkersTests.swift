import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel Workers tab (#710)")
@MainActor
struct PlistEditorModelWorkersTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private static let catalog: [WorkerDescriptor] = [
        WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "Receive webmentions",
            group: "social", binding: .componentTied(componentIDs: ["webmention-form"]),
            resources: WorkerDescriptor.Resources(needsD1: true, needsKV: false, needsR2: false)),
        WorkerDescriptor(
            id: "solid-pod", displayName: "Solid Pod", description: "Personal data store",
            group: "storage", binding: .settingsActivated,
            resources: WorkerDescriptor.Resources(needsD1: false, needsKV: true, needsR2: true)),
        WorkerDescriptor(
            id: "webdav", displayName: "WebDav", description: "OS-native file access",
            group: "storage", binding: .settingsActivated,
            resources: WorkerDescriptor.Resources(needsD1: false, needsKV: false, needsR2: true)),
    ]

    /// A snapshot in which the real-shaped WebmentionForm component is imported by one page.
    private static let usedSnapshot = SiteGraphExplorerSnapshot(
        nodes: [
            SiteGraphNode(
                id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                title: "WebmentionForm.astro", detail: nil,
                filePath: "src/components/WebmentionForm.astro", route: nil),
            SiteGraphNode(
                id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                filePath: "src/pages/index.astro", route: "/"),
        ],
        edges: [
            SiteGraphEdge(
                sourceID: "site1:page:index",
                targetID: "site1:file:src/components/WebmentionForm.astro",
                kind: .imports)
        ])

    private struct Fixture {
        let model: PlistEditorModel
        let configDirectory: URL
        let notified: NotifiedSettings
    }

    /// Thread-safe capture box for the `onActiveWorkersChanged` callback.
    final class NotifiedSettings: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [SiteSettings] = []
        func append(_ settings: SiteSettings) {
            lock.lock()
            defer { lock.unlock() }
            values.append(settings)
        }
        var all: [SiteSettings] {
            lock.lock()
            defer { lock.unlock() }
            return values
        }
    }

    private func makeFixture(
        settings: SiteSettings? = nil,
        catalog: [WorkerDescriptor] = PlistEditorModelWorkersTests.catalog,
        snapshot: SiteGraphExplorerSnapshot? = PlistEditorModelWorkersTests.usedSnapshot
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelWorkersTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let settings {
            try await SiteConfigStore(configDirectory: configDir).save(settings)
        }
        let notified = NotifiedSettings()
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            workerCatalogProvider: { catalog },
            graphSnapshotProvider: { snapshot },
            onActiveWorkersChanged: { notified.append($0) })
        return Fixture(model: model, configDirectory: configDir, notified: notified)
    }

    @Test("loadWorkers groups by catalog group and sorts groups and rows")
    func loadWorkersGroupsAndSorts() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        #expect(fixture.model.workerGroups.map(\.id) == ["social", "storage"])
        let storage = try #require(fixture.model.workerGroups.last)
        #expect(storage.rows.map(\.id) == ["solid-pod", "webdav"])
        #expect(fixture.model.workersError == nil)
    }

    @Test("a component-tied worker used on a page reports its affected pages")
    func componentTiedReportsAffectedPages() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        let social = try #require(fixture.model.workerGroups.first { $0.id == "social" })
        let webmention = try #require(social.rows.first { $0.id == "webmention" })
        guard case .componentTied(let pages) = webmention.status else {
            Issue.record("expected componentTied status")
            return
        }
        #expect(pages.map(\.title) == ["Home"])
    }

    @Test("a component-tied worker with no usage reports no affected pages")
    func componentTiedUnused() async throws {
        let fixture = try await makeFixture(
            snapshot: SiteGraphExplorerSnapshot(nodes: [], edges: []))
        await fixture.model.loadWorkers()

        let social = try #require(fixture.model.workerGroups.first { $0.id == "social" })
        let webmention = try #require(social.rows.first { $0.id == "webmention" })
        #expect(webmention.status == .componentTied(affectedPages: []))
    }

    @Test("settings-activated rows reflect persisted activeWorkerIDs")
    func settingsActivatedReflectsPersistedState() async throws {
        let fixture = try await makeFixture(settings: SiteSettings(activeWorkerIDs: ["webdav"]))
        await fixture.model.loadWorkers()

        let storage = try #require(fixture.model.workerGroups.first { $0.id == "storage" })
        #expect(storage.rows.first { $0.id == "solid-pod" }?.status == .settingsActivated(isOn: false))
        #expect(storage.rows.first { $0.id == "webdav" }?.status == .settingsActivated(isOn: true))
    }

    @Test("toggling on persists the id, updates the row, and notifies the runtime")
    func toggleOnPersistsAndNotifies() async throws {
        let fixture = try await makeFixture()
        await fixture.model.loadWorkers()

        await fixture.model.setWorkerActive("solid-pod", isOn: true)

        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.activeWorkerIDs == ["solid-pod"])
        let storage = try #require(fixture.model.workerGroups.first { $0.id == "storage" })
        #expect(storage.rows.first { $0.id == "solid-pod" }?.status == .settingsActivated(isOn: true))
        #expect(fixture.notified.all.map(\.activeWorkerIDs) == [["solid-pod"]])
    }

    @Test("toggling off removes the id and preserves unrelated settings fields")
    func toggleOffPreservesOtherFields() async throws {
        let fixture = try await makeFixture(
            settings: SiteSettings(displayName: "Kept", activeWorkerIDs: ["solid-pod", "webdav"]))
        await fixture.model.loadWorkers()

        await fixture.model.setWorkerActive("solid-pod", isOn: false)

        let saved = try await SiteConfigStore(configDirectory: fixture.configDirectory).load()
        #expect(saved.activeWorkerIDs == ["webdav"])
        #expect(saved.displayName == "Kept")
    }

    @Test("dashboard buttons stay disabled until lastDeployedWorkerIDs is non-empty")
    func dashboardEnablement() async throws {
        let disabled = try await makeFixture()
        await disabled.model.loadWorkers()
        #expect(disabled.model.workerDashboardEnabled == false)

        let enabled = try await makeFixture(
            settings: SiteSettings(lastDeployedWorkerIDs: ["webmention"]))
        await enabled.model.loadWorkers()
        #expect(enabled.model.workerDashboardEnabled == true)
    }

    @Test("dashboard links target the site's deployed worker name")
    func dashboardLinksUseSiteSlug() async throws {
        let fixture = try await makeFixture()
        #expect(fixture.model.workerDashboardLogsURL
            == WorkerDashboardLinks.productionLogsURL(workerName: "my-test-site"))
        #expect(fixture.model.workerDashboardAnalyticsURL
            == WorkerDashboardLinks.analyticsURL(workerName: "my-test-site"))
    }

    @Test("an empty catalog surfaces an error instead of an empty silent pane")
    func emptyCatalogSurfacesError() async throws {
        let fixture = try await makeFixture(catalog: [])
        await fixture.model.loadWorkers()

        #expect(fixture.model.workerGroups.isEmpty)
        #expect(fixture.model.workersError != nil)
    }

    @Test("without a configDirectory the tab reports unavailability and toggles no-op")
    func noConfigDirectory() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelWorkersTests-nocfg-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let plistURL = dir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test", sourceDirectory: dir,
            workerCatalogProvider: { Self.catalog })

        await model.loadWorkers()

        #expect(model.workerGroups.isEmpty)
        #expect(model.workersError != nil)
        await model.setWorkerActive("solid-pod", isOn: true)  // must not crash
    }
}
