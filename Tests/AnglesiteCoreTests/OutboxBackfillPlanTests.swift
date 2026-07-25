import Foundation
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("OutboxBackfillPlan")
struct OutboxBackfillPlanTests {
    let referenceDate = ISO8601DateFormatter().date(from: "2026-07-24T00:00:00Z")!

    @Test("covers all 11 in-scope collections, excluding members")
    func coversElevenCollections() throws {
        let expected: Set<String> = [
            "blog", "articles", "notes", "replies", "bookmarks", "likes",
            "photos", "albums", "events", "announcements", "reviews",
        ]
        #expect(OutboxBackfillPlan.collectionNames == expected)
        #expect(!OutboxBackfillPlan.collectionNames.contains("members"))
    }

    @Test("blog post maps to Article with a title and canonical URL")
    func blogMapsToArticle() throws {
        let root = try writeSiteTree([
            "src/content/blog/hello.md": """
            ---
            title: Hello World
            pubDate: 2026-01-01
            ---
            This is the body of my first post.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        #expect(plan.entries.count == 1)
        let entry = try #require(plan.entries.first)
        #expect(entry.kind == .article)
        #expect(entry.name == "Hello World")
        #expect(entry.canonicalURL.absoluteString == "https://owner.example/blog/hello/")
        #expect(entry.content == "This is the body of my first post.")
    }

    @Test("note has no title and maps to Note")
    func noteMapsToNoteWithNoTitle() throws {
        let root = try writeSiteTree([
            "src/content/notes/a-thought.md": """
            ---
            publishDate: 2026-02-01
            ---
            Just a quick thought.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.kind == .note)
        #expect(entry.name == nil)
    }

    @Test("reply sets inReplyTo as a real AS2 property")
    func replySetsInReplyTo() throws {
        let root = try writeSiteTree([
            "src/content/replies/re-something.md": """
            ---
            publishDate: 2026-02-02
            inReplyTo: https://example.net/their-post/
            ---
            Great point!
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.inReplyTo == "https://example.net/their-post/")
    }

    @Test("like prefixes content with the liked URL, not a real AS2 property")
    func likePrefixesContent() throws {
        let root = try writeSiteTree([
            "src/content/likes/liked-a-thing.md": """
            ---
            publishDate: 2026-02-03
            likeOf: https://example.net/their-thing/
            ---
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.inReplyTo == nil)
        #expect(entry.content == "Liked: https://example.net/their-thing/")
    }

    @Test("photo carries its image as an attachment")
    func photoCarriesAttachment() throws {
        let root = try writeSiteTree([
            "src/content/photos/sunset.md": """
            ---
            publishDate: 2026-02-04
            image: /images/sunset.jpg
            ---
            A nice sunset.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.attachments.count == 1)
        #expect(entry.attachments.first?.url == "https://owner.example/images/sunset.jpg")
    }

    @Test("event's title comes from name and its date from start")
    func eventUsesNameAndStart() throws {
        let root = try writeSiteTree([
            "src/content/events/launch-party.md": """
            ---
            name: Launch Party
            start: 2026-03-01
            ---
            Come celebrate!
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.name == "Launch Party")
        #expect(entry.kind == .note)
    }

    @Test("draft entries are excluded")
    func draftsExcluded() throws {
        let root = try writeSiteTree([
            "src/content/blog/unfinished.md": """
            ---
            title: Unfinished
            pubDate: 2026-01-01
            draft: true
            ---
            Not ready yet.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        #expect(plan.entries.isEmpty)
    }

    @Test("future-dated entries are excluded")
    func futureDatedExcluded() throws {
        let root = try writeSiteTree([
            "src/content/blog/from-the-future.md": """
            ---
            title: From The Future
            pubDate: 2099-01-01
            ---
            Not yet.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        #expect(plan.entries.isEmpty)
    }

    @Test("long body content is truncated to roughly 500 characters")
    func longBodyIsTruncated() throws {
        let longBody = String(repeating: "word ", count: 200) // 1000 chars
        let root = try writeSiteTree([
            "src/content/blog/long-post.md": """
            ---
            title: Long Post
            pubDate: 2026-01-01
            ---
            \(longBody)
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = OutboxBackfillPlan.build(
            projectRoot: root, siteBase: URL(string: "https://owner.example")!, referenceDate: referenceDate
        )

        let entry = try #require(plan.entries.first)
        #expect(entry.content.count <= 501) // 500 chars + "…"
        #expect(entry.content.hasSuffix("…"))
    }
}
