# Site Content Search Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a query-ready site content search backend (#765) — a thin facade over the existing `SiteKnowledgeIndex` lexical index that fills in the one missing piece (a navigable `route`) so #520's toolbar search has something to call.

**Architecture:** One new file, `Sources/AnglesiteCore/SiteSearchIndex.swift`, with two stateless pieces: `ContentRouteResolver` (a pure function computing a route from a document's kind/path/frontmatter) and `SiteSearchIndex` (an enum namespace wrapping `SiteKnowledgeIndex.search()` and mapping results to a UI-shaped `Hit`). No changes to `SiteKnowledgeIndex` itself; no new actor; no new file-watch wiring — this rides entirely on the incremental reindexing (`KnowledgeReindex`) that already exists.

**Tech Stack:** Swift 6.4, Swift Testing (`@Suite`/`@Test`/`#expect`/`#require`), SwiftPM (`AnglesiteCore` target + `AnglesiteCoreTests`), `AnglesiteTestSupport`'s `writeSiteTree` fixture helper.

## Global Constraints

- Conventional commits, subject ≤72 characters, reference `#765` where relevant (per `CONTRIBUTING.md`).
- Swift/SwiftUI with Apple frameworks only — no new third-party dependencies (none needed here).
- Run `swift test --package-path .` before each commit that touches Swift code.
- Spec of record: [`docs/superpowers/specs/2026-07-25-site-content-search-backend-design.md`](../specs/2026-07-25-site-content-search-backend-design.md).

---

### Task 1: `ContentRouteResolver`

**Files:**
- Create: `Sources/AnglesiteCore/SiteSearchIndex.swift`
- Test: `Tests/AnglesiteCoreTests/ContentRouteResolverTests.swift`

**Interfaces:**
- Consumes: `SiteKnowledgeIndex.Document.Kind` (existing enum: `.page, .post, .component, .layout, .content, .config, .style, .script, .other`), `FrontmatterValue` (existing enum: `.string(String), .bool(Bool), .array([String]), .number(Double), .date(String)`, from `Sources/AnglesiteCore/Frontmatter.swift`), `ContentScanner.routeFromPagePath(_ relPosix: String) -> String` (existing, `Sources/AnglesiteCore/ContentScanner.swift:62`, same-module internal).
- Produces: `enum ContentRouteResolver { static func route(kind: SiteKnowledgeIndex.Document.Kind, path: String, frontmatter: [String: FrontmatterValue]) -> String? }` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/ContentRouteResolverTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("ContentRouteResolver")
struct ContentRouteResolverTests {

    @Test("page route strips src/pages/ prefix and extension")
    func pageRouteBasic() {
        let route = ContentRouteResolver.route(kind: .page, path: "src/pages/about.astro", frontmatter: [:])
        #expect(route == "/about")
    }

    @Test("page route drops a trailing index segment")
    func pageRouteNestedIndex() {
        let route = ContentRouteResolver.route(kind: .page, path: "src/pages/blog/index.astro", frontmatter: [:])
        #expect(route == "/blog")
    }

    @Test("page route for the root index is the root path")
    func pageRouteRootIndex() {
        let route = ContentRouteResolver.route(kind: .page, path: "src/pages/index.astro", frontmatter: [:])
        #expect(route == "/")
    }

    @Test("page route is nil for a dynamic route template")
    func pageRouteSkipsDynamicTemplate() {
        let route = ContentRouteResolver.route(kind: .page, path: "src/pages/blog/[...slug].astro", frontmatter: [:])
        #expect(route == nil)
    }

    @Test("post route prefers a frontmatter slug override")
    func postRouteUsesFrontmatterSlug() {
        let route = ContentRouteResolver.route(
            kind: .post,
            path: "src/content/posts/my-file.md",
            frontmatter: ["slug": .string("custom-slug")]
        )
        #expect(route == "/posts/custom-slug")
    }

    @Test("post route falls back to the filename stem when no slug frontmatter is present")
    func postRouteFallsBackToFilename() {
        let route = ContentRouteResolver.route(kind: .post, path: "src/content/posts/hello-world.md", frontmatter: [:])
        #expect(route == "/posts/hello-world")
    }

    @Test("content route follows the same collection/slug convention as post")
    func contentRouteForRegistryBackedCollection() {
        let route = ContentRouteResolver.route(kind: .content, path: "src/content/events/2026-launch.md", frontmatter: [:])
        #expect(route == "/events/2026-launch")
    }

    @Test("content route is nil for an empty frontmatter slug string")
    func contentRouteIgnoresEmptySlug() {
        let route = ContentRouteResolver.route(
            kind: .content,
            path: "src/content/events/2026-launch.md",
            frontmatter: ["slug": .string("")]
        )
        #expect(route == "/events/2026-launch")
    }

    @Test("content route is nil when there is no collection folder under src/content/")
    func contentRouteNilForShallowPath() {
        let route = ContentRouteResolver.route(kind: .content, path: "src/content/onlyfile.md", frontmatter: [:])
        #expect(route == nil)
    }

    @Test("content route is nil when the path isn't under src/content/")
    func contentRouteNilOutsideContentDir() {
        let route = ContentRouteResolver.route(kind: .content, path: "src/data/misc.json", frontmatter: [:])
        #expect(route == nil)
    }

    @Test("non-routable kinds always resolve to nil", arguments: [
        SiteKnowledgeIndex.Document.Kind.component,
        .layout, .config, .style, .script, .other,
    ])
    func nonRoutableKindsAreNil(kind: SiteKnowledgeIndex.Document.Kind) {
        let route = ContentRouteResolver.route(kind: kind, path: "src/components/Card.astro", frontmatter: [:])
        #expect(route == nil)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter ContentRouteResolverTests`
Expected: FAIL — `ContentRouteResolver` does not exist (build error, since `Sources/AnglesiteCore/SiteSearchIndex.swift` hasn't been created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `Sources/AnglesiteCore/SiteSearchIndex.swift`:

```swift
import Foundation

/// Computes a UI-navigable route for a `SiteKnowledgeIndex.Document`, when one exists. Pure and
/// stateless — no I/O, no dependency on `SiteKnowledgeIndex` itself, so it's testable directly
/// against arbitrary (kind, path, frontmatter) inputs.
enum ContentRouteResolver {
    static func route(
        kind: SiteKnowledgeIndex.Document.Kind,
        path: String,
        frontmatter: [String: FrontmatterValue]
    ) -> String? {
        switch kind {
        case .page:
            // Dynamic route templates (`[slug]`, `[...rest]`) aren't a single navigable route —
            // `ContentScanner.scanPages` skips these entirely when building `SiteContentGraph`;
            // mirror that here rather than emitting a route with a literal `[...slug]` segment.
            guard !path.contains("[") else { return nil }
            return ContentScanner.routeFromPagePath(path)
        case .post, .content:
            return collectionEntryRoute(path: path, frontmatter: frontmatter)
        case .layout, .config, .style, .script, .component, .other:
            return nil
        }
    }

    /// `src/content/{collection}/{entry}` → `/{collection}/{slug}`, matching the shipped
    /// template's `[collection]/[...slug].astro` catch-all route. `nil` when `path` isn't at
    /// least two segments under `src/content/` (no collection folder to anchor the route on).
    private static func collectionEntryRoute(
        path: String, frontmatter: [String: FrontmatterValue]
    ) -> String? {
        let prefix = "src/content/"
        guard path.hasPrefix(prefix) else { return nil }
        let rest = path.dropFirst(prefix.count)
        let segments = rest.split(separator: "/")
        guard segments.count >= 2, let filename = segments.last else { return nil }
        let collection = segments[0]
        if case let .string(slug)? = frontmatter["slug"], !slug.isEmpty {
            return "/\(collection)/\(slug)"
        }
        let slug = URL(fileURLWithPath: String(filename)).deletingPathExtension().lastPathComponent
        return "/\(collection)/\(slug)"
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ContentRouteResolverTests`
Expected: PASS — all 12 tests (7 named + a 6-argument parameterized test) succeed.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteSearchIndex.swift Tests/AnglesiteCoreTests/ContentRouteResolverTests.swift
git commit -m "feat(#765): add ContentRouteResolver for search hit routes"
```

---

### Task 2: `SiteSearchIndex` query facade

**Files:**
- Modify: `Sources/AnglesiteCore/SiteSearchIndex.swift` (append `SiteSearchIndex` enum)
- Test: `Tests/AnglesiteCoreTests/SiteSearchIndexTests.swift`

**Interfaces:**
- Consumes: `ContentRouteResolver.route(kind:path:frontmatter:) -> String?` (Task 1). `SiteKnowledgeIndex` (existing actor, `Sources/AnglesiteCore/SiteKnowledgeIndex.swift`): `func rebuild(siteID: String, projectRoot: URL) async`, `func search(siteID: String, query: String, options: SearchOptions = .init()) async -> [SearchResult]`, `struct SearchOptions { init(limit: Int = 8, kinds: Set<Document.Kind>? = nil) }`, `struct SearchResult { let id: String; let document: Document; let score: Double; let excerpt: String; let lineRange: ClosedRange<Int>? }`, `struct Document { let id, siteID, path: String; let kind: Kind; let title: String?; let frontmatter: [String: FrontmatterValue]; ... }`. `writeSiteTree(prefix: String = "anglesite-test", _ files: [String: String]) throws -> URL` from `AnglesiteTestSupport` (`Tests/AnglesiteTestSupport/TestFixtures.swift:31`).
- Produces: `public enum SiteSearchIndex { public struct Hit: Sendable, Equatable, Identifiable { public let id, path, matchContext: String; public let kind: SiteKnowledgeIndex.Document.Kind; public let title, route: String?; public let score: Double }; public static func search(_ index: SiteKnowledgeIndex, siteID: String, query: String, limit: Int = 8, kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil) async -> [Hit] }` — this is the public API #520 will call.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/SiteSearchIndexTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteSearchIndexTests`
Expected: FAIL — `SiteSearchIndex` does not exist (build error).

- [ ] **Step 3: Write the minimal implementation**

Append to `Sources/AnglesiteCore/SiteSearchIndex.swift` (after `ContentRouteResolver`):

```swift
/// UI-facing search over a site's `SiteKnowledgeIndex`, shaped for toolbar-style consumers
/// (#765/#520): ranked hits with kind, title, a navigable route where one exists, and match
/// context. Wraps `SiteKnowledgeIndex.search()` as-is — same lexical ranking, no semantic
/// reranking — since a toolbar search field wants fast literal matching, not RAG recall. Holds
/// no state of its own: every call reads the live index, so results always reflect whatever the
/// file-watcher pipeline (`KnowledgeReindex`) has most recently applied.
public enum SiteSearchIndex {
    public struct Hit: Sendable, Equatable, Identifiable {
        public let id: String
        public let kind: SiteKnowledgeIndex.Document.Kind
        public let title: String?
        public let route: String?
        public let path: String
        public let matchContext: String
        public let score: Double
    }

    public static func search(
        _ index: SiteKnowledgeIndex,
        siteID: String,
        query: String,
        limit: Int = 8,
        kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil
    ) async -> [Hit] {
        let results = await index.search(
            siteID: siteID, query: query, options: .init(limit: limit, kinds: kinds))
        return results.map { result in
            Hit(
                id: result.id,
                kind: result.document.kind,
                title: result.document.title,
                route: ContentRouteResolver.route(
                    kind: result.document.kind,
                    path: result.document.path,
                    frontmatter: result.document.frontmatter
                ),
                path: result.document.path,
                matchContext: result.excerpt,
                score: result.score
            )
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteSearchIndexTests`
Expected: PASS — all 4 tests succeed.

- [ ] **Step 5: Run the full AnglesiteCore test suite to check for regressions**

Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS — no regressions in the broader `AnglesiteCore` suite (this change is purely additive).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/SiteSearchIndex.swift Tests/AnglesiteCoreTests/SiteSearchIndexTests.swift
git commit -m "feat(#765): add SiteSearchIndex query facade"
```

---

## Follow-up (not part of this plan)

`SiteSearchIndex.search` is now available for #520 (toolbar `.searchable` UI) to call directly — that wiring, and any UI-side decisions about which `kinds` to default to, belong to #520, not this plan.
