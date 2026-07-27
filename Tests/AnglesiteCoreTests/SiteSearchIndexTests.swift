import Foundation
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("SiteSearchIndex submitted query")
struct SiteSearchSubmissionTests {

    private func hits(_ root: URL) async -> [SiteSearchIndex.Hit] {
        let index = SiteKnowledgeIndex()
        await index.rebuild(siteID: "s", projectRoot: root)
        return await SiteSearchIndex.search(index, siteID: "s", query: "about", limit: 10)
    }

    private func fixture() throws -> URL {
        try writeSiteTree(prefix: "sitesearchsubmit", [
            "src/pages/about.astro": "---\ntitle: About\n---\n# About\nAbout the studio.",
            "src/components/Card.astro": "<div>A card, about nothing in particular.</div>",
        ])
    }

    /// Selecting a suggestion puts that hit's path in the field and submits — so an exact path
    /// match means "the user picked this row", not "the user typed a path".
    @Test("an exact path match resolves to that hit")
    func exactPathMatchResolves() async throws {
        let all = await hits(try fixture())
        let target = try #require(all.first { $0.path == "src/components/Card.astro" })

        let resolved = SiteSearchIndex.hit(forSubmittedQuery: target.path, in: all)
        #expect(resolved?.path == target.path)
    }

    /// Return on typed text commits the search, and the top-ranked hit is the only sensible
    /// destination when there's no results pane to fall back to (Spotlight's behavior).
    @Test("free text resolves to the top-ranked hit")
    func freeTextResolvesToTopHit() async throws {
        let all = await hits(try fixture())
        let resolved = SiteSearchIndex.hit(forSubmittedQuery: "about", in: all)
        #expect(resolved?.path == all.first?.path)
    }

    @Test("no hits resolves to nothing")
    func noHitsResolvesToNil() {
        #expect(SiteSearchIndex.hit(forSubmittedQuery: "about", in: []) == nil)
    }

    /// Whitespace-only submissions (Return in an empty field) must not activate the top hit —
    /// the user never typed a query.
    @Test("a blank query resolves to nothing even with hits present")
    func blankQueryResolvesToNil() async throws {
        let all = await hits(try fixture())
        #expect(!all.isEmpty)
        #expect(SiteSearchIndex.hit(forSubmittedQuery: "   ", in: all) == nil)
        #expect(SiteSearchIndex.hit(forSubmittedQuery: "", in: all) == nil)
    }
}

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
