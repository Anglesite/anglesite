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
