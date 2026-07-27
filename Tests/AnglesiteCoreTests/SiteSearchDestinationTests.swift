import Foundation
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("SiteSearchDestination")
struct SiteSearchDestinationTests {

    private let navigatorRouteIDs = [
        "/about": "page-about",
        "/blog/hello-world": "post-hello",
    ]

    @Test("a hit whose route is in the navigator resolves to that row")
    func routedHitResolvesToNavigatorRow() {
        let destination = SiteSearchDestination.resolve(
            kind: .page, route: "/about", path: "src/pages/about.astro",
            navigatorRouteIDs: navigatorRouteIDs)
        #expect(destination == .navigator(id: "page-about"))
    }

    @Test("collection entries resolve to their navigator row too")
    func contentEntryResolvesToNavigatorRow() {
        let destination = SiteSearchDestination.resolve(
            kind: .post, route: "/blog/hello-world",
            path: "src/content/blog/hello-world.md",
            navigatorRouteIDs: navigatorRouteIDs)
        #expect(destination == .navigator(id: "post-hello"))
    }

    /// `ContentRouteResolver` documents that a computed route is a convention-based guess and
    /// isn't guaranteed to be served — an unrouted collection produces exactly this case. The
    /// file is the destination that always exists, so fall back to it rather than navigating
    /// the preview to a route that may 404.
    @Test("a route the navigator doesn't show falls back to the file")
    func unknownRouteFallsBackToFile() {
        let destination = SiteSearchDestination.resolve(
            kind: .post, route: "/notes/orphan", path: "src/content/notes/orphan.md",
            navigatorRouteIDs: navigatorRouteIDs)
        #expect(destination == .file(path: "src/content/notes/orphan.md", group: .posts))
    }

    @Test("routeless kinds resolve to the file, grouped by editor kind")
    func routelessKindsResolveToFile() {
        let cases: [(SiteKnowledgeIndex.Document.Kind, String, FileGroup)] = [
            (.component, "src/components/Card.astro", .components),
            (.layout, "src/layouts/BaseLayout.astro", .components),
            (.style, "src/styles/global.css", .styles),
            (.config, "astro.config.ts", .metadata),
            (.script, "scripts/csp.ts", .components),
            (.other, "README.md", .components),
        ]
        for (kind, path, expected) in cases {
            let destination = SiteSearchDestination.resolve(
                kind: kind, route: nil, path: path, navigatorRouteIDs: navigatorRouteIDs)
            #expect(destination == .file(path: path, group: expected), "\(kind) grouped wrong")
        }
    }

    @Test("pages and posts group to their own file groups when unrouted")
    func contentKindsGroupToContentGroups() {
        #expect(
            SiteSearchDestination.resolve(
                kind: .page, route: nil, path: "src/pages/[slug].astro",
                navigatorRouteIDs: navigatorRouteIDs)
                == .file(path: "src/pages/[slug].astro", group: .pages))
        #expect(
            SiteSearchDestination.resolve(
                kind: .content, route: nil, path: "src/content/data/spec.md",
                navigatorRouteIDs: navigatorRouteIDs)
                == .file(path: "src/content/data/spec.md", group: .posts))
    }

    /// An empty navigator (site still loading, or a window whose tree hasn't refreshed) must
    /// still produce a usable destination rather than dropping the hit on the floor.
    @Test("an empty navigator map always falls back to the file")
    func emptyNavigatorMapFallsBackToFile() {
        let destination = SiteSearchDestination.resolve(
            kind: .page, route: "/about", path: "src/pages/about.astro",
            navigatorRouteIDs: [:])
        #expect(destination == .file(path: "src/pages/about.astro", group: .pages))
    }

    @Test("the Hit convenience resolves the same way as the field-wise call")
    func hitConvenienceMatchesFieldwise() async throws {
        let root = try writeSiteTree(prefix: "searchdest", [
            "src/pages/about.astro": "---\ntitle: About\n---\n# About\nAbout the studio.",
        ])
        let index = SiteKnowledgeIndex()
        await index.rebuild(siteID: "s", projectRoot: root)
        let hit = try #require(
            await SiteSearchIndex.search(index, siteID: "s", query: "about", limit: 5).first)

        #expect(
            SiteSearchDestination.resolve(hit: hit, navigatorRouteIDs: navigatorRouteIDs)
                == SiteSearchDestination.resolve(
                    kind: hit.kind, route: hit.route, path: hit.path,
                    navigatorRouteIDs: navigatorRouteIDs))
    }
}
