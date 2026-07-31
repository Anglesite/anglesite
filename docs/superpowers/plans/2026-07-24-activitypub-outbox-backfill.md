# ActivityPub Outbox Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync a site's existing content-collection posts into its ActivityPub actor's outbox at deploy time, so a fediverse follower sees the site's real history, not just posts made after activation.

**Architecture:** Three new pure/best-effort Swift types in `AnglesiteCore` — a filesystem-walking content enumerator (`OutboxBackfillPlan`), a JSON idempotency ledger (`ActivityPubOutboxLedger`), and an HTTP orchestrator (`ActivityPubOutboxBackfill`) — wired as a fourth best-effort step in `DeployCoordinator.runPostDeploySequencing`, mirroring the existing `WebSubPublishPing`/`POSSESyndicationLog`/`SocialPublishPlan` precedents exactly.

**Tech Stack:** Swift 6.4, Swift Testing (`@Suite`/`@Test`/`#expect`), no third-party dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-activitypub-outbox-backfill-design.md`.
- **Task 6 (DeployModel wiring) is BLOCKED.** It must not be executed/merged until `davidwkeith/workers#451` lands in a tagged `@dwk/workers` release AND `Resources/Template/package.json`'s `@dwk/activitypub` pin is bumped to a version including it, in the same PR. Tasks 1–5 build and test the isolated Swift types against injected transports and have no such dependency — they can be implemented, tested, and merged now.
- 11 of 12 content collections are in scope: `blog`, `articles`, `notes`, `replies`, `bookmarks`, `likes`, `photos`, `albums`, `events`, `announcements`, `reviews`. `members` is excluded (D3).
- AS2 mapping is Note or Article only, never a custom type (D4).
- CMS-mode sites (`CMS_CONTENT_API_URL` set) are out of scope for v1 — the filesystem walk silently finds nothing there (D5).
- Object `content` is a ~500-char plain-text excerpt of the raw markdown body, not rendered HTML (D8).
- The outbox POST body's `skipDelivery: true` field and preserved `published` timestamp are this plan's best guess at the upstream API shape requested in `davidwkeith/workers#451` — **verify against the actual merged implementation before Task 6 ships** (see Task 3's code comment).

---

## Task 1: Widen `SocialPublishPlan`'s shared helpers to `internal`

**Files:**
- Modify: `Sources/AnglesiteCore/SocialPublishPlan.swift`

**Interfaces:**
- Produces (all newly `internal`/module-visible instead of `private`, exact existing signatures unchanged — verified against the real file at `Sources/AnglesiteCore/SocialPublishPlan.swift:44,174,195,211,221,238`):
  - `SocialPublishPlan.entryExtensions: Set<String>`
  - `SocialPublishPlan.isDraft(_ value: FrontmatterValue?) -> Bool`
  - `SocialPublishPlan.parseDate(_ raw: String?) -> Date?` — takes a single optional date string, NOT a frontmatter dict; callers do their own key-fallback lookup before calling this.
  - `SocialPublishPlan.string(_ value: FrontmatterValue?) -> String?`
  - `SocialPublishPlan.walk(_ dir: URL) -> [URL]`
  - `SocialPublishPlan.relativePosix(_ url: URL, from base: URL) -> String`
  
  Reused by `OutboxBackfillPlan` (Task 2) so it doesn't duplicate filesystem-walk/frontmatter-parsing logic.

This task has no new behavior, so it's a mechanical visibility change plus a full existing-test run to confirm nothing broke — no new test to write.

- [ ] **Step 1: Change six `private` declarations to internal (module-default) visibility**

In `Sources/AnglesiteCore/SocialPublishPlan.swift`, change exactly these six lines by removing the leading `private` keyword (everything else on each line, including `static`, stays unchanged):

Line 44: `private static let entryExtensions: Set<String> = ["md", "mdx", "mdoc", "markdown"]` → `static let entryExtensions: Set<String> = ["md", "mdx", "mdoc", "markdown"]`

Line 174: `private static func isDraft(_ value: FrontmatterValue?) -> Bool {` → `static func isDraft(_ value: FrontmatterValue?) -> Bool {`

Line 195: `private static func parseDate(_ raw: String?) -> Date? {` → `static func parseDate(_ raw: String?) -> Date? {`

Line 211: `private static func string(_ value: FrontmatterValue?) -> String? {` → `static func string(_ value: FrontmatterValue?) -> String? {`

Line 221: `private static func walk(_ dir: URL) -> [URL] {` → `static func walk(_ dir: URL) -> [URL] {`

Line 238: `private static func relativePosix(_ url: URL, from base: URL) -> String {` → `static func relativePosix(_ url: URL, from base: URL) -> String {`

(Do NOT change `isFutureDated` at line 185 — it stays `private`; `OutboxBackfillPlan` needs its own per-collection multi-key date lookup, built from the now-internal `string`/`parseDate` in Task 2, not this fixed 4-key-chain helper.)

- [ ] **Step 2: Run the full AnglesiteCore test suite to confirm the visibility change is a pure no-op**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter SocialPublishPlanTests`
Expected: all existing `SocialPublishPlanTests` still pass, unchanged.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteCore/SocialPublishPlan.swift
git commit -m "refactor(#926): widen SocialPublishPlan's walk/date helpers to internal"
```

---

## Task 2: `OutboxBackfillPlan` — content enumerator + AS2 mapping

**Files:**
- Create: `Sources/AnglesiteCore/OutboxBackfillPlan.swift`
- Test: `Tests/AnglesiteCoreTests/OutboxBackfillPlanTests.swift`

**Interfaces:**
- Consumes: `SocialPublishPlan.walk(_:) -> [URL]`, `.relativePosix(_:from:) -> String`, `.string(_:) -> String?`, `.parseDate(_:) -> Date?`, `.isDraft(_:) -> Bool`, `.entryExtensions: Set<String>` (Task 1); `Frontmatter.parse(_:) -> [String: FrontmatterValue]`, `Frontmatter.body(_:) -> String` (existing).
- Produces: `OutboxBackfillPlan.build(projectRoot:siteBase:referenceDate:) -> OutboxBackfillPlan.Plan`, `OutboxBackfillPlan.Plan.entries: [OutboxBackfillPlan.Entry]`, `OutboxBackfillPlan.Entry` (fields: `sourceFile: String`, `canonicalURL: URL`, `kind: AS2Kind`, `name: String?`, `content: String`, `publishedAt: Date`, `inReplyTo: String?`, `attachments: [Attachment]`), `OutboxBackfillPlan.AS2Kind` (`.note`, `.article`), `OutboxBackfillPlan.Attachment` (`url: String`, `mediaType: String?`) — all consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/OutboxBackfillPlanTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter OutboxBackfillPlanTests`
Expected: FAIL — `error: cannot find 'OutboxBackfillPlan' in scope` (the type doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/OutboxBackfillPlan.swift`:

```swift
import Foundation

/// Enumerates a site's existing content-collection posts and maps each to the AS2 shape
/// `ActivityPubOutboxBackfill` (#926) needs to backfill into the ActivityPub outbox. Mirrors
/// `SocialPublishPlan`'s filesystem-walk pattern but does NOT apply its "has outbound social
/// work" filter (`SocialPublishPlan.build`'s `guard !targets.isEmpty || !posseTargets.isEmpty`)
/// — every publishable entry qualifies for backfill regardless of outbound links.
///
/// See design doc §4 (`docs/superpowers/specs/2026-07-24-activitypub-outbox-backfill-design.md`)
/// for the collection → AS2 kind mapping table this implements.
public enum OutboxBackfillPlan {
    public enum AS2Kind: String, Equatable, Sendable {
        case note = "Note"
        case article = "Article"
    }

    public struct Attachment: Equatable, Sendable {
        public let url: String
        public let mediaType: String?

        public init(url: String, mediaType: String? = nil) {
            self.url = url
            self.mediaType = mediaType
        }
    }

    public struct Entry: Equatable, Sendable {
        public let sourceFile: String
        public let canonicalURL: URL
        public let kind: AS2Kind
        public let name: String?
        public let content: String
        public let publishedAt: Date
        public let inReplyTo: String?
        public let attachments: [Attachment]

        public init(
            sourceFile: String,
            canonicalURL: URL,
            kind: AS2Kind,
            name: String?,
            content: String,
            publishedAt: Date,
            inReplyTo: String? = nil,
            attachments: [Attachment] = []
        ) {
            self.sourceFile = sourceFile
            self.canonicalURL = canonicalURL
            self.kind = kind
            self.name = name
            self.content = content
            self.publishedAt = publishedAt
            self.inReplyTo = inReplyTo
            self.attachments = attachments
        }
    }

    public struct Plan: Equatable, Sendable {
        public let entries: [Entry]
        public init(entries: [Entry]) { self.entries = entries }
    }

    /// How a collection's "target" frontmatter field (if any) becomes part of the AS2 object.
    private enum TargetTreatment {
        /// No target field on this collection.
        case none
        /// A real AS2 `inReplyTo` property, read from the named frontmatter key.
        case asReplyTo(key: String)
        /// Not a real AS2 property — the target URL is prefixed onto `content` as plain text
        /// (design doc D4: `likeOf`/`bookmarkOf` targets usually aren't resolvable AP objects).
        case asContentPrefix(key: String, label: String)
    }

    private struct CollectionSpec {
        let name: String
        let kind: AS2Kind
        /// Frontmatter key for the AS2 `name` (title); `nil` if this collection has no title field.
        let titleKey: String?
        /// Date frontmatter keys to try, in order — passed straight to `SocialPublishPlan.parseDate`.
        let dateKeys: [String]
        let target: TargetTreatment
        /// Frontmatter key for a single-image field (photos) or an image-array field (albums);
        /// `nil` for collections with no images.
        let imageKey: String?
        /// Whether `imageKey`'s value is a `.array` (albums) rather than a `.string` (photos).
        let imageIsArray: Bool

        init(
            _ name: String, kind: AS2Kind, titleKey: String? = nil, dateKeys: [String],
            target: TargetTreatment = .none, imageKey: String? = nil, imageIsArray: Bool = false
        ) {
            self.name = name
            self.kind = kind
            self.titleKey = titleKey
            self.dateKeys = dateKeys
            self.target = target
            self.imageKey = imageKey
            self.imageIsArray = imageIsArray
        }
    }

    private static let collections: [CollectionSpec] = [
        CollectionSpec("blog", kind: .article, titleKey: "title", dateKeys: ["pubDate"]),
        CollectionSpec("articles", kind: .article, titleKey: "title", dateKeys: ["publishDate"]),
        CollectionSpec("notes", kind: .note, dateKeys: ["publishDate"]),
        CollectionSpec("replies", kind: .note, dateKeys: ["publishDate"], target: .asReplyTo(key: "inReplyTo")),
        CollectionSpec("bookmarks", kind: .note, titleKey: "title", dateKeys: ["publishDate"],
                        target: .asContentPrefix(key: "bookmarkOf", label: "Bookmarked")),
        CollectionSpec("likes", kind: .note, dateKeys: ["publishDate"],
                        target: .asContentPrefix(key: "likeOf", label: "Liked")),
        CollectionSpec("photos", kind: .note, dateKeys: ["publishDate"], imageKey: "image"),
        CollectionSpec("albums", kind: .note, titleKey: "title", dateKeys: ["publishDate"],
                        imageKey: "images", imageIsArray: true),
        CollectionSpec("events", kind: .note, titleKey: "name", dateKeys: ["start"]),
        CollectionSpec("announcements", kind: .note, titleKey: "title", dateKeys: ["publishDate"]),
        CollectionSpec("reviews", kind: .note, dateKeys: ["publishDate"]),
    ]

    /// The 11 in-scope collection names (design doc D3) — exposed for a coverage test guarding
    /// against silently dropping one.
    public static var collectionNames: Set<String> { Set(collections.map(\.name)) }

    private static let excerptMaxLength = 500

    static func excerpt(_ body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > excerptMaxLength else { return trimmed }
        return String(trimmed.prefix(excerptMaxLength)) + "…"
    }

    /// Tries each of `keys` in order against `frontmatter`, returning the first one that parses
    /// as a date — `SocialPublishPlan.parseDate(_:)` only ever takes a single already-resolved
    /// string, so the multi-key fallback lives here rather than in that shared helper.
    private static func date(in frontmatter: [String: FrontmatterValue], keys: [String]) -> Date? {
        for key in keys {
            if let date = SocialPublishPlan.parseDate(SocialPublishPlan.string(frontmatter[key])) {
                return date
            }
        }
        return nil
    }

    /// Builds the backfill plan by walking each in-scope collection directory under
    /// `<projectRoot>/src/content/`, parsing frontmatter, filtering drafts/future-dated entries
    /// (same rule as `SocialPublishPlan`), and mapping each surviving file to an `Entry`.
    public static func build(
        projectRoot: URL,
        siteBase: URL,
        referenceDate: Date = Date()
    ) -> Plan {
        let contentRoot = projectRoot.appendingPathComponent("src/content", isDirectory: true)
        var entries: [Entry] = []

        for spec in collections {
            let collectionRoot = contentRoot.appendingPathComponent(spec.name, isDirectory: true)
            let files = SocialPublishPlan.walk(collectionRoot)
                .filter { SocialPublishPlan.entryExtensions.contains($0.pathExtension.lowercased()) }

            for file in files {
                guard let source = try? String(contentsOf: file, encoding: .utf8) else { continue }
                let frontmatter = Frontmatter.parse(source)

                if SocialPublishPlan.isDraft(frontmatter["draft"]) { continue }
                guard let publishedAt = date(in: frontmatter, keys: spec.dateKeys) else { continue }
                guard publishedAt <= referenceDate else { continue }

                let relPath = SocialPublishPlan.relativePosix(file, from: projectRoot)
                guard let canonical = canonicalURL(for: relPath, frontmatter: frontmatter, siteBase: siteBase) else {
                    continue
                }

                let body = Frontmatter.body(source)
                let name = spec.titleKey.flatMap { SocialPublishPlan.string(frontmatter[$0]) }

                var content = excerpt(body)
                var inReplyTo: String?
                switch spec.target {
                case .none:
                    break
                case .asReplyTo(let key):
                    inReplyTo = SocialPublishPlan.string(frontmatter[key])
                case .asContentPrefix(let key, let label):
                    if let target = SocialPublishPlan.string(frontmatter[key]) {
                        content = content.isEmpty ? "\(label): \(target)" : "\(label): \(target)\n\n\(content)"
                    }
                }

                var attachments: [Attachment] = []
                if let imageKey = spec.imageKey {
                    if spec.imageIsArray, case let .array(images)? = frontmatter[imageKey] {
                        attachments = images.compactMap { attachmentURL($0, siteBase: siteBase) }
                    } else if let image = SocialPublishPlan.string(frontmatter[imageKey]) {
                        attachments = [attachmentURL(image, siteBase: siteBase)].compactMap { $0 }
                    }
                }

                entries.append(Entry(
                    sourceFile: relPath, canonicalURL: canonical, kind: spec.kind, name: name,
                    content: content, publishedAt: publishedAt, inReplyTo: inReplyTo, attachments: attachments
                ))
            }
        }

        return Plan(entries: entries.sorted { $0.sourceFile < $1.sourceFile })
    }

    private static func attachmentURL(_ raw: String, siteBase: URL) -> Attachment? {
        guard let url = URL(string: raw, relativeTo: siteBase)?.absoluteURL else { return nil }
        return Attachment(url: url.absoluteString)
    }

    /// Same `/<collection>/<slug>/` scheme as `SocialPublishPlan.canonicalURL` (kept separate
    /// rather than reused since this version doesn't need `SocialPublishPlan`'s webmention-target
    /// scanning and operates on an already-known collection name from `CollectionSpec`, not a
    /// parsed path).
    private static func canonicalURL(
        for relPath: String,
        frontmatter: [String: FrontmatterValue],
        siteBase: URL
    ) -> URL? {
        let parts = relPath.split(separator: "/").map(String.init)
        guard parts.count >= 4, parts[0] == "src", parts[1] == "content" else { return nil }
        let collection = parts[2]
        let collectionRelParts = Array(parts.dropFirst(3))
        guard let lastPart = collectionRelParts.last else { return nil }
        let basename = (lastPart as NSString).deletingPathExtension
        let fallbackSlug = (collectionRelParts.dropLast() + [basename]).joined(separator: "/")
        let slug = SocialPublishPlan.string(frontmatter["slug"]) ?? fallbackSlug
        return URL(string: "/\(collection)/\(slug)/", relativeTo: siteBase)?.absoluteURL
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter OutboxBackfillPlanTests`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/OutboxBackfillPlan.swift Tests/AnglesiteCoreTests/OutboxBackfillPlanTests.swift
git commit -m "feat(#926): add OutboxBackfillPlan content enumerator + AS2 mapping"
```

---

## Task 3: `ActivityPubOutboxLedger` — idempotency ledger

**Files:**
- Create: `Sources/AnglesiteCore/ActivityPubOutboxLedger.swift`
- Test: `Tests/AnglesiteCoreTests/ActivityPubOutboxLedgerTests.swift`

**Interfaces:**
- Produces: `ActivityPubOutboxLedger.load(from:) -> ActivityPubOutboxLedger?`, `.save(to:) throws`, `.contains(canonicalURL:) -> Bool`, `.record(_:)` (mutating), `ActivityPubOutboxLedger.Entry` (`canonicalURL: String`, `activityID: String`, `syncedAt: Date`) — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/ActivityPubOutboxLedgerTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("ActivityPubOutboxLedger")
struct ActivityPubOutboxLedgerTests {
    func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("load returns nil when no ledger file exists yet")
    func loadReturnsNilWhenAbsent() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(ActivityPubOutboxLedger.load(from: dir) == nil)
    }

    @Test("record then contains reports true for that canonical URL")
    func recordThenContains() throws {
        var ledger = ActivityPubOutboxLedger()
        #expect(!ledger.contains(canonicalURL: "https://owner.example/blog/hello/"))

        ledger.record(.init(
            canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()
        ))

        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/hello/"))
    }

    @Test("recording the same canonical URL twice does not duplicate the entry")
    func recordIsIdempotent() throws {
        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()))
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "different-id", syncedAt: Date()))

        #expect(ledger.entries.count == 1)
        #expect(ledger.entries.first?.activityID == "abc123") // first write wins
    }

    @Test("save then load round-trips entries through JSON")
    func saveThenLoadRoundTrips() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        var ledger = ActivityPubOutboxLedger()
        let syncedAt = ISO8601DateFormatter().date(from: "2026-07-24T12:00:00Z")!
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: syncedAt))
        try ledger.save(to: dir)

        let loaded = try #require(ActivityPubOutboxLedger.load(from: dir))
        #expect(loaded.entries.count == 1)
        #expect(loaded.entries.first?.canonicalURL == "https://owner.example/blog/hello/")
        #expect(loaded.entries.first?.activityID == "abc123")
        #expect(loaded.entries.first?.syncedAt == syncedAt)
    }

    @Test("save creates the configDirectory if it doesn't exist yet")
    func saveCreatesDirectory() throws {
        let dir = try makeTempDir().appendingPathComponent("nested/config")
        defer { try? FileManager.default.removeItem(at: dir) }

        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()))

        try ledger.save(to: dir)

        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent(ActivityPubOutboxLedger.filename).path))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter ActivityPubOutboxLedgerTests`
Expected: FAIL — `error: cannot find 'ActivityPubOutboxLedger' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/ActivityPubOutboxLedger.swift`:

```swift
import Foundation

/// Durable per-site record of which content entries have already been backfilled into the
/// ActivityPub outbox (#926) — `Config/activitypub-outbox.json`, app-owned, never in git. Same
/// shape and crash-safety contract as `POSSESyndicationLog`, but deliberately a separate file:
/// POSSE tracks outbound copies posted to *other* platforms, this tracks entries synced into
/// *this site's own* outbox — different concepts that happen to share a JSON-ledger pattern.
public struct ActivityPubOutboxLedger: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let canonicalURL: String
        /// The activity id the outbox DO returned for this insert.
        public let activityID: String
        public let syncedAt: Date

        public init(canonicalURL: String, activityID: String, syncedAt: Date) {
            self.canonicalURL = canonicalURL
            self.activityID = activityID
            self.syncedAt = syncedAt
        }
    }

    public static let filename = "activitypub-outbox.json"

    public private(set) var entries: [Entry]

    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    public func contains(canonicalURL: String) -> Bool {
        entries.contains { $0.canonicalURL == canonicalURL }
    }

    /// No-ops if `entry.canonicalURL` is already recorded — the first successful sync wins,
    /// matching `POSSESyndicationLog.record`'s idempotent-insert contract.
    public mutating func record(_ entry: Entry) {
        guard !contains(canonicalURL: entry.canonicalURL) else { return }
        entries.append(entry)
    }

    private struct Envelope: Codable {
        let entries: [Entry]
    }

    public static func load(from configDirectory: URL) -> ActivityPubOutboxLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return ActivityPubOutboxLedger(entries: envelope.entries)
    }

    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(entries: entries))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter ActivityPubOutboxLedgerTests`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ActivityPubOutboxLedger.swift Tests/AnglesiteCoreTests/ActivityPubOutboxLedgerTests.swift
git commit -m "feat(#926): add ActivityPubOutboxLedger idempotency ledger"
```

---

## Task 4: `ActivityPubOutboxBackfill` — HTTP orchestrator

**Files:**
- Create: `Sources/AnglesiteCore/ActivityPubOutboxBackfill.swift`
- Test: `Tests/AnglesiteCoreTests/ActivityPubOutboxBackfillTests.swift`

**Interfaces:**
- Consumes: `OutboxBackfillPlan.build(projectRoot:siteBase:referenceDate:) -> Plan` (Task 2); `ActivityPubOutboxLedger.load(from:)`, `.contains(canonicalURL:)`, `.record(_:)`, `.save(to:)` (Task 3); `SecretStore.read(account:) throws -> String?` (existing, `Sources/AnglesiteCore/Platform/SecretStore.swift`); `SecretAccounts.activityPubPublishToken(siteID:) -> String` (existing); `LogCenter.shared.append(source:stream:text:)` (existing).
- Produces: `ActivityPubOutboxBackfill.backfill(siteID:siteDirectory:configDirectory:siteBase:secretStore:referenceDate:) async -> [Outcome]`, `ActivityPubOutboxBackfill.Outcome` (`canonicalURL: String`, `accepted: Bool`, `detail: String?`) — consumed by Task 6 (blocked).

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/ActivityPubOutboxBackfillTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

private final class RequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return _requests
    }
    func record(_ request: URLRequest) {
        lock.lock(); _requests.append(request); lock.unlock()
    }
}

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { token }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}

@Suite("ActivityPubOutboxBackfill")
struct ActivityPubOutboxBackfillTests {
    func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func writeBlogPost(in siteDirectory: URL, slug: String, title: String, pubDate: String, body: String) throws {
        let dir = siteDirectory.appendingPathComponent("src/content/blog", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let content = "---\ntitle: \(title)\npubDate: \(pubDate)\n---\n\(body)\n"
        try content.write(to: dir.appendingPathComponent("\(slug).md"), atomically: true, encoding: .utf8)
    }

    @Test("posts pending entries oldest-first and records them in the ledger")
    func postsOldestFirstAndRecords() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "newer", title: "Newer", pubDate: "2026-02-01", body: "Second post.")
        try writeBlogPost(in: siteDirectory, slug: "older", title: "Older", pubDate: "2026-01-01", body: "First post.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let body = "{\"id\":\"https://owner.example/users/site/outbox/\(UUID().uuidString)\"}"
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token"),
            referenceDate: ISO8601DateFormatter().date(from: "2026-07-24T00:00:00Z")!
        )

        #expect(outcomes.count == 2)
        #expect(outcomes.allSatisfy(\.accepted))
        #expect(recorder.requests.count == 2)

        // Oldest ("older", Jan 1) must be posted before "newer" (Feb 1).
        let firstBody = try #require(recorder.requests.first?.httpBody)
        let firstJSON = try #require(JSONSerialization.jsonObject(with: firstBody) as? [String: Any])
        #expect(firstJSON["content"] as? String == "First post.")

        let ledger = try #require(ActivityPubOutboxLedger.load(from: configDirectory))
        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/older/"))
        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/newer/"))
    }

    @Test("skips entries already in the ledger")
    func skipsAlreadyLedgeredEntries() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "already-synced", title: "Already Synced", pubDate: "2026-01-01", body: "Old news.")

        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(
            canonicalURL: "https://owner.example/blog/already-synced/", activityID: "existing-id", syncedAt: Date()
        ))
        try ledger.save(to: configDirectory)

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        #expect(outcomes.isEmpty)
        #expect(recorder.requests.isEmpty)
    }

    @Test("no token provisioned yields no outcomes and no requests")
    func noTokenSkipsEntirely() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "hello", title: "Hello", pubDate: "2026-01-01", body: "Hi.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: nil)
        )

        #expect(outcomes.isEmpty)
        #expect(recorder.requests.isEmpty)
    }

    @Test("a failed entry is recorded as not accepted and is not added to the ledger")
    func failedEntryNotLedgered() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "will-fail", title: "Will Fail", pubDate: "2026-01-01", body: "Oops.")

        let backfill = ActivityPubOutboxBackfill { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
            return (Data("server error".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        #expect(outcomes.count == 1)
        #expect(outcomes.first?.accepted == false)
        #expect(outcomes.first?.detail?.contains("500") == true)

        let ledger = ActivityPubOutboxLedger.load(from: configDirectory)
        #expect(ledger == nil || !ledger!.contains(canonicalURL: "https://owner.example/blog/will-fail/"))
    }

    @Test("the outgoing request sends the Bearer token and quiet-insert flag")
    func requestShape() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "hello", title: "Hello", pubDate: "2026-01-01", body: "Hi.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        _ = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        let request = try #require(recorder.requests.first)
        #expect(request.url?.absoluteString == "https://owner.example/users/site/outbox")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/activity+json")

        let body = try #require(request.httpBody)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["type"] as? String == "Article")
        #expect(json["skipDelivery"] as? Bool == true)
        #expect(json["published"] as? String != nil)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter ActivityPubOutboxBackfillTests`
Expected: FAIL — `error: cannot find 'ActivityPubOutboxBackfill' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/ActivityPubOutboxBackfill.swift`:

```swift
import Foundation

/// Backfills a site's existing content into its ActivityPub actor's outbox at deploy time
/// (#926) — reads `OutboxBackfillPlan`, skips anything already in `ActivityPubOutboxLedger`,
/// and POSTs the rest, oldest-`publishedAt`-first, to the deployed site's own `/users/site/outbox`
/// route. Shaped like `WebSubPublishPing`: `Sendable`, injectable transport, best-effort — never
/// throws out of `backfill(...)`, one failed entry never blocks the rest.
///
/// **Wire-format note:** `skipDelivery: true` and the preserved `published` timestamp in
/// `activityBody(for:)` below are this app's best guess at the shape requested in
/// `davidwkeith/workers#451` — verify against the actual merged upstream implementation and
/// adjust here if the accepted shape differs before this is wired live (design doc §3, Task 6's
/// blocking note).
public struct ActivityPubOutboxBackfill: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    public struct Outcome: Equatable, Sendable {
        public let canonicalURL: String
        public let accepted: Bool
        public let detail: String?
    }

    private let transport: Transport

    public init(transport: @escaping Transport = ActivityPubOutboxBackfill.defaultTransport) {
        self.transport = transport
    }

    /// Best-effort — always returns normally, one entry's failure never blocks the rest or
    /// throws out of this call. Returns `[]` (no requests made) when there's nothing pending or
    /// no publish token is provisioned yet.
    public func backfill(
        siteID: String,
        siteDirectory: URL,
        configDirectory: URL,
        siteBase: URL,
        secretStore: any SecretStore,
        referenceDate: Date = Date()
    ) async -> [Outcome] {
        let plan = OutboxBackfillPlan.build(projectRoot: siteDirectory, siteBase: siteBase, referenceDate: referenceDate)
        guard !plan.entries.isEmpty else { return [] }

        // `try?` on a throwing function that itself returns `String?` auto-flattens to `String?`
        // (SE-0230) — this `guard let` is `nil` both when `read` throws and when it legitimately
        // returns "no token provisioned yet", which is exactly the one "skip silently" case here.
        guard let token = try? secretStore.read(account: SecretAccounts.activityPubPublishToken(siteID: siteID)) else {
            await LogCenter.shared.append(
                source: "activitypub-backfill:\(siteID)", stream: .stderr,
                text: "skipped outbox backfill: no publish token provisioned"
            )
            return []
        }

        var ledger = ActivityPubOutboxLedger.load(from: configDirectory) ?? ActivityPubOutboxLedger()
        let pending = plan.entries
            .filter { !ledger.contains(canonicalURL: $0.canonicalURL.absoluteString) }
            .sorted { $0.publishedAt < $1.publishedAt }
        guard !pending.isEmpty else { return [] }

        let outboxURL = siteBase.appendingPathComponent("users/site/outbox")
        var outcomes: [Outcome] = []

        for entry in pending {
            var request = URLRequest(url: outboxURL)
            request.httpMethod = "POST"
            request.setValue("application/activity+json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try? JSONSerialization.data(withJSONObject: Self.activityBody(for: entry))

            let canonical = entry.canonicalURL.absoluteString
            let outcome: Outcome
            do {
                let (data, http) = try await transport(request)
                if (200..<300).contains(http.statusCode) {
                    let activityID = Self.activityID(from: data) ?? canonical
                    ledger.record(.init(canonicalURL: canonical, activityID: activityID, syncedAt: referenceDate))
                    try? ledger.save(to: configDirectory)
                    outcome = Outcome(canonicalURL: canonical, accepted: true, detail: nil)
                } else {
                    let body = String(data: data, encoding: .utf8) ?? ""
                    outcome = Outcome(
                        canonicalURL: canonical, accepted: false,
                        detail: "HTTP \(http.statusCode)\(body.isEmpty ? "" : ": \(body)")"
                    )
                }
            } catch {
                outcome = Outcome(canonicalURL: canonical, accepted: false, detail: "\(error)")
            }

            outcomes.append(outcome)
            await LogCenter.shared.append(
                source: "activitypub-backfill:\(siteID)",
                stream: outcome.accepted ? .stdout : .stderr,
                text: outcome.accepted
                    ? "backfilled outbox entry: \(canonical)"
                    : "outbox backfill failed for \(canonical): \(outcome.detail ?? "unknown error")"
            )
        }

        return outcomes
    }

    static func activityBody(for entry: OutboxBackfillPlan.Entry) -> [String: Any] {
        var object: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": entry.kind.rawValue,
            "content": entry.content,
            "url": entry.canonicalURL.absoluteString,
            "published": ISO8601DateFormatter().string(from: entry.publishedAt),
            "to": ["https://www.w3.org/ns/activitystreams#Public"],
            "skipDelivery": true,
        ]
        if let name = entry.name { object["name"] = name }
        if let inReplyTo = entry.inReplyTo { object["inReplyTo"] = inReplyTo }
        if !entry.attachments.isEmpty {
            object["attachment"] = entry.attachments.map { attachment -> [String: Any] in
                var dict: [String: Any] = ["type": "Image", "url": attachment.url]
                if let mediaType = attachment.mediaType { dict["mediaType"] = mediaType }
                return dict
            }
        }
        return object
    }

    static func activityID(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["id"] as? String
    }

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter ActivityPubOutboxBackfillTests`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ActivityPubOutboxBackfill.swift Tests/AnglesiteCoreTests/ActivityPubOutboxBackfillTests.swift
git commit -m "feat(#926): add ActivityPubOutboxBackfill HTTP orchestrator"
```

---

## Task 5: Wire a fourth `DeployCoordinator.runPostDeploySequencing` step

**Files:**
- Modify: `Sources/AnglesiteCore/OperationProgress.swift`
- Modify: `Sources/AnglesiteCore/DeployCoordinator.swift`
- Test: `Tests/AnglesiteCoreTests/DeployCoordinatorTests.swift` (create if it doesn't exist yet; if a suite for `DeployCoordinator` already exists, add to it instead)

**Interfaces:**
- Consumes: nothing new from earlier tasks (this task only touches the generic sequencing plumbing, not `ActivityPubOutboxBackfill` directly — Task 6 wires the two together).
- Produces: `DeployCoordinator.runPostDeploySequencing(onMilestone:sendWebmentions:syndicate:notifySubscribers:backfillActivityPubOutbox:)` (new fourth parameter, defaulted so all existing call sites keep compiling unchanged), `OperationProgress.deployBackfillingActivityPub` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

First check whether `Tests/AnglesiteCoreTests/DeployCoordinatorTests.swift` already exists:

Run: `ls Tests/AnglesiteCoreTests/DeployCoordinatorTests.swift`

If it exists, add this test to it (matching its existing `@Suite` and helper style). If it doesn't exist, create it:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("DeployCoordinator.runPostDeploySequencing")
struct DeployCoordinatorSequencingTests {
    @Test("calls all four steps in order: webmentions, syndicate, notifySubscribers, backfillActivityPubOutbox")
    func callsAllFourStepsInOrder() async throws {
        actor CallOrder {
            private(set) var calls: [String] = []
            func record(_ name: String) { calls.append(name) }
        }
        let order = CallOrder()

        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { _ in },
            sendWebmentions: { await order.record("sendWebmentions") },
            syndicate: { await order.record("syndicate") },
            notifySubscribers: { await order.record("notifySubscribers") },
            backfillActivityPubOutbox: { await order.record("backfillActivityPubOutbox") }
        )

        let calls = await order.calls
        #expect(calls == ["sendWebmentions", "syndicate", "notifySubscribers", "backfillActivityPubOutbox"])
    }

    @Test("backfillActivityPubOutbox defaults to a no-op, so existing call sites without it still compile and run")
    func backfillDefaultsToNoOp() async throws {
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { _ in },
            sendWebmentions: {},
            syndicate: {}
        )
        // No assertion needed beyond "this compiles and completes" — proves the new parameter
        // is additive, not a breaking change to `DeployModel`'s existing call site.
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter DeployCoordinatorSequencingTests`
Expected: FAIL — `error: incorrect argument label in call 'runPostDeploySequencing(onMilestone:sendWebmentions:syndicate:notifySubscribers:backfillActivityPubOutbox:)'` (the parameter doesn't exist yet).

- [ ] **Step 3: Add the new milestone constant**

In `Sources/AnglesiteCore/OperationProgress.swift`, immediately after the existing `deployNotifyingSubscribers` declaration, add:

```swift
static let deployBackfillingActivityPub = OperationProgress(
    kind: .deploy, phase: "activityPubBackfill", label: "Backfilling ActivityPub outbox…"
)
```

- [ ] **Step 4: Extend `runPostDeploySequencing`**

In `Sources/AnglesiteCore/DeployCoordinator.swift`, replace:

```swift
public static func runPostDeploySequencing(
    onMilestone: (OperationProgress) -> Void,
    sendWebmentions: () async -> Void,
    syndicate: () async -> Void,
    /// WebSub publish pings (#361): tells the site's own hub the feeds changed so it fans
    /// the update out to subscribers. Ordered last — the deployed feeds must exist before
    /// the hub fetches them, and (like the other two passes) it's best-effort and never
    /// throws. Callers without the hub provisioned pass a no-op.
    notifySubscribers: () async -> Void = {}
) async {
    onMilestone(.deployWebmentions)
    await sendWebmentions()
    onMilestone(.deploySyndicating)
    await syndicate()
    onMilestone(.deployNotifyingSubscribers)
    await notifySubscribers()
}
```

with:

```swift
public static func runPostDeploySequencing(
    onMilestone: (OperationProgress) -> Void,
    sendWebmentions: () async -> Void,
    syndicate: () async -> Void,
    /// WebSub publish pings (#361): tells the site's own hub the feeds changed so it fans
    /// the update out to subscribers. Ordered before the ActivityPub backfill below — the
    /// deployed feeds must exist before the hub fetches them, and (like the other passes)
    /// it's best-effort and never throws. Callers without the hub provisioned pass a no-op.
    notifySubscribers: () async -> Void = {},
    /// ActivityPub outbox backfill (#926): syncs existing content into the site's actor's
    /// outbox. Ordered last — after `syndicate()`, since POSSE write-back can change post
    /// frontmatter a backfill pass might otherwise read stale. Best-effort and never throws,
    /// like every other step here. Callers without ActivityPub provisioned pass a no-op.
    backfillActivityPubOutbox: () async -> Void = {}
) async {
    onMilestone(.deployWebmentions)
    await sendWebmentions()
    onMilestone(.deploySyndicating)
    await syndicate()
    onMilestone(.deployNotifyingSubscribers)
    await notifySubscribers()
    onMilestone(.deployBackfillingActivityPub)
    await backfillActivityPubOutbox()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter DeployCoordinatorSequencingTests`
Expected: PASS, both tests.

Then run the broader existing `DeployCoordinator`/`DeployModel` suites to confirm the additive (defaulted) parameter didn't break any existing call site:

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter DeployCoordinator`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/OperationProgress.swift Sources/AnglesiteCore/DeployCoordinator.swift Tests/AnglesiteCoreTests/DeployCoordinatorTests.swift
git commit -m "feat(#926): add backfillActivityPubOutbox step to post-deploy sequencing"
```

---

## Task 6 (unblocked 2026-07-31 — `davidwkeith/workers#451`/`#452` shipped as `@dwk/activitypub` 1.0.0-beta.2, already the pin in `Resources/Template/package.json`): Wire into `DeployModel`

All three prerequisites are satisfied:
1. `davidwkeith/workers#451` is resolved and published in a tagged `@dwk/workers` release (`@dwk/activitypub` 1.0.0-beta.2). ✅
2. The accepted wire-format for quiet-insert is a `?skipDelivery=1` query parameter on the outbox URL, not a body field — `ActivityPubOutboxBackfill.activityBody(for:)`/`backfill(...)` (Task 4) updated to match; `published` handling (a plain field on the posted AS2 object) matched this plan's original guess. ✅
3. `Resources/Template/package.json`'s `@dwk/activitypub` pin is already 1.0.0-beta.2. ✅

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift`

**Interfaces:**
- Consumes: `ActivityPubOutboxBackfill.backfill(siteID:siteDirectory:configDirectory:siteBase:secretStore:referenceDate:) async -> [Outcome]` (Task 4); `DeployCoordinator.runPostDeploySequencing(...)`'s new `backfillActivityPubOutbox:` parameter (Task 5); `WorkerComposition.activitypubWorkerID` (existing); `SecretAccounts.activityPubPublishToken(siteID:)` (existing, consumed transitively).

- [ ] **Step 1: Add an `ActivityPubOutboxBackfill` property to `DeployModel`**

In `Sources/AnglesiteApp/DeployModel.swift`, find the existing property declarations (near `webmentionCommand`/`posseCommand`/`websubPing`) and add a sibling:

```swift
private let activityPubOutboxBackfill: ActivityPubOutboxBackfill
```

In the `init`, add a matching defaulted parameter and assignment, following the exact pattern `websubPing` already uses:

```swift
websubPing: WebSubPublishPing = WebSubPublishPing(),
activityPubOutboxBackfill: ActivityPubOutboxBackfill = ActivityPubOutboxBackfill(),
```
```swift
self.websubPing = websubPing
self.activityPubOutboxBackfill = activityPubOutboxBackfill
```

- [ ] **Step 2: Compute the `activitypubProvisioned` gate**

Immediately after the existing `websubProvisioned` computation in `DeployModel.swift`, add:

```swift
let activitypubProvisioned = workers.contains(where: { $0.id == WorkerComposition.activitypubWorkerID })
```

- [ ] **Step 3: Pass a `backfillActivityPubOutbox` closure into `runPostDeploySequencing`**

In the `.succeeded(let url, let duration):` branch's call to `DeployCoordinator.runPostDeploySequencing`, add a fifth argument alongside the existing three:

```swift
notifySubscribers: { [weak self] in
    guard let self, websubProvisioned else { return }
    _ = await self.websubPing.notify(
        siteURL: siteURL ?? url.absoluteString,
        source: "websub:\(siteID)"
    )
},
backfillActivityPubOutbox: { [weak self] in
    guard let self, activitypubProvisioned else { return }
    _ = await self.activityPubOutboxBackfill.backfill(
        siteID: siteID,
        siteDirectory: siteDirectory,
        configDirectory: configDirectory,
        siteBase: url,
        secretStore: self.keychain
    )
}
```

(Replace `self.keychain` with whichever exact property name `DeployModel` uses for its `SecretStore` — confirm via `grep -n "readCloudflareToken\|: any SecretStore\|: KeychainStore" Sources/AnglesiteApp/DeployModel.swift` before writing this line, since the exact property name wasn't pinned down during planning.)

- [ ] **Step 4: Build and run the full `DeployModel`/`DeployCoordinator` test suites**

Run: `export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer && swift test --package-path . --filter DeployModel`
Expected: PASS, no regressions.

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Manual smoke test**

On a real site with ActivityPub provisioned and pre-existing blog/note content, deploy and confirm (a) the outbox at `/users/site/outbox` shows the pre-existing content after deploy, (b) no follower received a notification for the backfilled entries (check a test-follower Mastodon account's notifications), (c) redeploying immediately after does not re-post anything (check `Config/activitypub-outbox.json` entry count is unchanged).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift
git commit -m "feat(#926): wire ActivityPub outbox backfill into deploy sequencing"
```

---

## Self-Review Notes

- **Spec coverage:** D1 (upstream request) → already filed as `davidwkeith/workers#451`, referenced in Task 4's wire-format comment and Task 6's blocking preconditions. D2 (full back-catalog) → `OutboxBackfillPlan.build` has no count cap. D3 (11 collections, `members` excluded) → `collections` table + `coversElevenCollections` test. D4 (Note/Article only) → `AS2Kind` enum has exactly two cases. D5 (filesystem walk, CMS out of scope) → `OutboxBackfillPlan` walks `Source/src/content` directly, never touches `getCollection`/the CMS loader. D6 (every deploy, ledger-gated) → Task 5/6 wiring, `ActivityPubOutboxBackfill.backfill`'s ledger-filter step. D7 (dedicated ledger) → Task 3. D8 (plain-text excerpt) → `OutboxBackfillPlan.excerpt`.
- **Placeholder scan:** no TBD/TODO in code; Task 6's step 3 has one explicit "confirm via grep before writing this line" instruction for the one detail (exact `SecretStore` property name on `DeployModel`) genuinely not observable without running that grep during planning — this is a real, actionable instruction with a concrete command, not a vague placeholder.
- **Type consistency:** `OutboxBackfillPlan.Entry`/`AS2Kind`/`Attachment` used identically across Tasks 2 and 4. `ActivityPubOutboxLedger.Entry` used identically across Tasks 3 and 4. `ActivityPubOutboxBackfill.Outcome`/`.backfill(...)` signature used identically across Tasks 4 and 6.
