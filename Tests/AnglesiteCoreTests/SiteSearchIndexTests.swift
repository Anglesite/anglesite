import Foundation
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("SiteSearchIndex")
struct SiteSearchIndexTests {

    @Test("search computes a route for routable kinds and nil for others")
    func searchComputesRoute() async throws {
        let root = try writeSiteTree(prefix: "sitesearch", [
            "src/pages/about.astro": "---\ntitle: About Us\n---\n# About Us\nLearn about our mission.",
            "src/content/posts/hello-world.md": "---\ntitle: Hello World\n---\n# Hello World\nA post about launching.",
            "src/components/Card.astro": "<div>A card component, about nothing in particular.</div>",
        ])
        let index = SiteKnowledgeIndex()
        await index.rebuild(siteID: "s", projectRoot: root)

        let hits = await SiteSearchIndex.search(index, siteID: "s", query: "about", limit: 10)
        #expect(hits.count == 3)

        let page = try #require(hits.first { $0.kind == .page })
        #expect(page.route == "/about")
        #expect(page.title == "About Us")

        let post = try #require(hits.first { $0.kind == .post })
        #expect(post.route == "/posts/hello-world")

        let component = try #require(hits.first { $0.kind == .component })
        #expect(component.route == nil)
    }

    @Test("search respects the kinds filter")
    func searchFiltersByKind() async throws {
        let root = try writeSiteTree(prefix: "sitesearch", [
            "src/pages/about.astro": "---\ntitle: About Us\n---\nabout body",
            "src/components/Card.astro": "about card component",
        ])
        let index = SiteKnowledgeIndex()
        await index.rebuild(siteID: "s", projectRoot: root)

        let hits = await SiteSearchIndex.search(index, siteID: "s", query: "about", kinds: [.page])
        #expect(hits.count == 1)
        #expect(hits[0].kind == .page)
    }

    @Test("search passes through ordering, limit, score, and match context from the underlying index")
    func searchPassesThroughOrderingAndContext() async throws {
        let root = try writeSiteTree(prefix: "sitesearch", [
            "src/pages/about.astro": "---\ntitle: About About\n---\nabout about about",
            "src/pages/contact.astro": "---\ntitle: Contact\n---\na single mention of about here",
        ])
        let index = SiteKnowledgeIndex()
        await index.rebuild(siteID: "s", projectRoot: root)

        let direct = await index.search(siteID: "s", query: "about", options: .init(limit: 10))
        let hits = await SiteSearchIndex.search(index, siteID: "s", query: "about", limit: 1)

        #expect(hits.count == 1)
        #expect(hits[0].path == direct[0].document.path)
        #expect(hits[0].score == direct[0].score)
        #expect(hits[0].matchContext == direct[0].excerpt)
    }

    @Test("search returns no hits for an unindexed site")
    func searchEmptyForUnknownSite() async {
        let index = SiteKnowledgeIndex()
        let hits = await SiteSearchIndex.search(index, siteID: "never-loaded", query: "anything")
        #expect(hits.isEmpty)
    }
}
