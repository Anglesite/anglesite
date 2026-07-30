import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

struct SiteFileTreeTests {

    private func write(_ relative: String, under root: URL) throws {
        let url = root.appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("x".utf8).write(to: url)
    }

    @Test("plain (non-package) site resolves layout to the site root, no config")
    func plainLayout() throws {
        let root = try makeTempDir(prefix: "anglesite-filetree"); defer { try? FileManager.default.removeItem(at: root) }
        let layout = SiteFileTree.layout(for: root)
        #expect(layout.sourceDir == root)
        #expect(layout.configDir == nil)
        #expect(layout.infoPlist == nil)
    }

    @Test("package site resolves layout to Source/ and Config/")
    func packageLayout() throws {
        let parent = try makeTempDir(prefix: "anglesite-filetree"); defer { try? FileManager.default.removeItem(at: parent) }
        let pkgURL = parent.appendingPathComponent("Acme.anglesite", isDirectory: true)
        let pkg = AnglesitePackage(url: pkgURL)
        try FileManager.default.createDirectory(at: pkg.sourceURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: pkg.configURL, withIntermediateDirectories: true)
        try pkg.writeMarker(AnglesitePackage.Marker(siteID: UUID(), displayName: "Acme", createdDate: Date(timeIntervalSince1970: 0)))

        let layout = SiteFileTree.layout(for: pkgURL)
        #expect(layout.sourceDir == pkg.sourceURL)
        #expect(layout.configDir == pkg.configURL)
        #expect(layout.infoPlist == pkg.infoPlistURL)
    }

    @Test("scan groups components, styles, and metadata; excludes plumbing")
    func scanGroups() throws {
        let root = try makeTempDir(prefix: "anglesite-filetree"); defer { try? FileManager.default.removeItem(at: root) }
        try write("src/layouts/BaseLayout.astro", under: root)
        try write("src/components/Card.astro", under: root)
        try write("src/styles/global.css", under: root)
        try write("src/pages/index.astro", under: root)        // pages handled elsewhere — NOT in scan
        try write("node_modules/pkg/index.js", under: root)    // plumbing — excluded
        try write("dist/index.html", under: root)              // build output — excluded

        let groups = SiteFileTree.scan(siteRoot: root)
        let componentNames = (groups[.components] ?? []).map(\.name).sorted()
        let styleNames = (groups[.styles] ?? []).map(\.name).sorted()
        #expect(componentNames == ["BaseLayout.astro", "Card.astro"])
        #expect(styleNames == ["global.css"])
        #expect(groups[.pages] == nil)   // pages are content-graph sourced, never filesystem-scanned
        let allURLs = groups.values.flatMap { $0 }.map(\.url.path)
        #expect(!allURLs.contains { $0.contains("node_modules") })
        #expect(!allURLs.contains { $0.contains("/dist/") })
    }

    @Test("empty groups are absent from the result")
    func emptyGroupsAbsent() throws {
        let root = try makeTempDir(prefix: "anglesite-filetree"); defer { try? FileManager.default.removeItem(at: root) }
        try write("src/styles/only.css", under: root)
        let groups = SiteFileTree.scan(siteRoot: root)
        #expect(groups[.styles]?.count == 1)
        #expect(groups[.components] == nil)
    }

    @Test("feedCollections finds collections with an rss.xml.ts route and ignores everything else")
    func feedCollections() throws {
        let root = try makeTempDir(prefix: "anglesite-filetree"); defer { try? FileManager.default.removeItem(at: root) }
        // notes has a feed; photos has a directory but no rss route; the root rss.xml.ts is site-wide.
        try write("src/pages/notes/rss.xml.ts", under: root)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("src/pages/photos"),
                                                 withIntermediateDirectories: true)
        try write("src/pages/rss.xml.ts", under: root)

        #expect(SiteFileTree.feedCollections(siteRoot: root) == ["notes"])
    }

    @Test("feedCollections is empty for a missing src/pages")
    func feedCollectionsMissingDir() {
        let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("anglesite-filetree-absent-\(UUID().uuidString)", isDirectory: true)
        #expect(SiteFileTree.feedCollections(siteRoot: root) == [])
    }

    @Test("detectedFeeds reports each feed route the collection ships, in rss/atom/json order")
    func detectedFeeds() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("sft-feeds-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let notes = root.appendingPathComponent("src/pages/notes")
        try FileManager.default.createDirectory(at: notes, withIntermediateDirectories: true)
        try Data().write(to: notes.appendingPathComponent("rss.xml.ts"))
        try Data().write(to: notes.appendingPathComponent("feed.json.ts"))

        let feeds = SiteFileTree.detectedFeeds(siteRoot: root, collection: "notes")
        #expect(feeds.map(\.kind) == [.rss, .json])
        #expect(feeds.map(\.route) == ["/notes/rss.xml", "/notes/feed.json"])
    }

    @Test("detectedFeeds is empty for a collection with no feed routes or a missing directory")
    func detectedFeedsEmpty() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("sft-feeds-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("src/pages/plain"), withIntermediateDirectories: true)

        #expect(SiteFileTree.detectedFeeds(siteRoot: root, collection: "plain").isEmpty)
        #expect(SiteFileTree.detectedFeeds(siteRoot: root, collection: "absent").isEmpty)
    }
}
