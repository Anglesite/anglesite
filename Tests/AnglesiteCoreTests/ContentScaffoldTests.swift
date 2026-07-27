// Tests/AnglesiteCoreTests/ContentScaffoldTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContentScaffold")
struct ContentScaffoldTests {
    @Test("slugify lowercases, strips diacritics, collapses to hyphens, trims")
    func slugifyBasics() {
        #expect(ContentScaffold.slugify("About Us") == "about-us")
        #expect(ContentScaffold.slugify("Héllo Wörld") == "hello-world")
        #expect(ContentScaffold.slugify("  --Tom's Page--  ") == "toms-page")
        #expect(ContentScaffold.slugify("A/B") == "a-b")
        #expect(ContentScaffold.slugify("\"Quoted\"") == "quoted")
    }

    @Test("renderComponent produces a minimal blank .astro component")
    func renderComponentIsMinimal() {
        let rendered = ContentScaffold.renderComponent(name: "MyWidget")
        #expect(rendered.contains("MyWidget"))
        #expect(rendered.hasPrefix("---"))
    }

    @Test("normalizeRoute slugifies each segment and joins with slash")
    func normalizeRouteSegments() {
        #expect(ContentScaffold.normalizeRoute("/About//Us/") == "/about/us")
        #expect(ContentScaffold.normalizeRoute("About") == "/about")
        #expect(ContentScaffold.normalizeRoute("/") == "/")
    }

    @Test("layoutImport depth tracks route segment count")
    func layoutImportDepth() {
        #expect(ContentScaffold.layoutImport(normalizedRoute: "/about") == "../layouts/BaseLayout.astro")
        #expect(ContentScaffold.layoutImport(normalizedRoute: "/a/b") == "../../layouts/BaseLayout.astro")
    }

    @Test("path builders match the sidecar layout")
    func paths() {
        #expect(ContentScaffold.pageRelativePath(normalizedRoute: "/about") == "src/pages/about.astro")
        #expect(ContentScaffold.pageRelativePath(normalizedRoute: "/a/b") == "src/pages/a/b.astro")
        #expect(ContentScaffold.postRelativePath(collection: "posts", slug: "hello") == "src/content/posts/hello.md")
    }

    @Test("renderPage escapes attrs and html and ends with one newline")
    func renderPage() {
        let out = ContentScaffold.renderPage(title: "A & \"B\"", layoutImport: "../layouts/BaseLayout.astro")
        #expect(out.contains("import BaseLayout from \"../layouts/BaseLayout.astro\";"))
        #expect(out.contains("<BaseLayout title=\"A &amp; &quot;B&quot;\" description=\"A &amp; &quot;B&quot;.\">"))
        #expect(out.contains("<h1>A &amp; \"B\"</h1>"))
        #expect(out.hasSuffix("</BaseLayout>\n"))
    }

    @Test("renderPage uses a provided description instead of the title-derived default")
    func renderPageCustomDescription() {
        let out = ContentScaffold.renderPage(
            title: "About",
            layoutImport: "../layouts/BaseLayout.astro",
            description: "Meet the team behind the studio."
        )
        #expect(out.contains("description=\"Meet the team behind the studio.\""))
        #expect(!out.contains("description=\"About.\""))
    }

    @Test("renderPage falls back to the title-derived description when none is given")
    func renderPageDefaultDescription() {
        let out = ContentScaffold.renderPage(title: "About", layoutImport: "../layouts/BaseLayout.astro")
        #expect(out.contains("description=\"About.\""))
    }

    @Test("renderPost emits a draft with ISO8601 publishDate and YAML-escaped title")
    func renderPost() {
        let date = Date(timeIntervalSince1970: 1_750_000_000) // fixed, deterministic
        let out = ContentScaffold.renderPost(title: "Back\\slash \"quote\"", now: date)
        #expect(out.contains("title: \"Back\\\\slash \\\"quote\\\"\""))
        #expect(out.contains("draft: true"))
        #expect(out.contains("publishDate: 2025-06-15T15:06:40.000Z"))
        #expect(out.hasSuffix("Write your post here.\n"))
    }

    @Test("renderPost uses a provided description instead of leaving it empty")
    func renderPostCustomDescription() {
        let date = Date(timeIntervalSince1970: 1_750_000_000)
        let out = ContentScaffold.renderPost(title: "Launch Day", now: date, description: "How we shipped it.")
        #expect(out.contains("description: \"How we shipped it.\""))
    }

    @Test("renderEntry emits frontmatter for a note with body below the block, as a draft")
    func renderEntryNote() {
        let note = try! #require(ContentTypeRegistry().descriptor(id: "note"))
        let out = ContentScaffold.renderEntry(
            descriptor: note, title: nil, now: Date(timeIntervalSince1970: 1_750_000_000))
        #expect(out == """
        ---
        publishDate: 2025-06-15T15:06:40.000Z
        tags: []
        # audience: ""
        draft: true
        ---

        Write your note here.

        """)
    }

    @Test("optional .url fields scaffold commented-out, so an empty default never breaks z.string().url()")
    func optionalURLFieldsScaffoldCommented() {
        let now = Date(timeIntervalSince1970: 0)
        for descriptor in ContentTypeRegistry.builtIns where descriptor.collection != nil {
            let out = ContentScaffold.renderEntry(descriptor: descriptor, title: "Title", now: now)
            for field in descriptor.fields where field.kind == .url && !field.required {
                #expect(out.contains("# \(field.name): \"\""),
                        "\(descriptor.id).\(field.name): optional .url field must scaffold commented-out, not live")
            }
            for field in descriptor.fields where field.kind == .url && field.required {
                #expect(!out.contains("# \(field.name): "),
                        "\(descriptor.id).\(field.name): required .url field must stay live")
            }
        }
    }

    @Test("renderEntry emits business-type frontmatter from the registry descriptor")
    func businessTypeFrontmatter() throws {
        let registry = ContentTypeRegistry()
        let now = Date(timeIntervalSince1970: 0) // 1970-01-01T00:00:00.000Z

        let event = try #require(registry.descriptor(id: "event"))
        let eventOut = ContentScaffold.renderEntry(descriptor: event, title: "Launch", now: now)
        #expect(eventOut.contains("name: \"Launch\""))
        #expect(eventOut.contains("start: 1970-01-01T00:00:00.000Z")) // required → live
        #expect(eventOut.contains("# end: 1970-01-01T00:00:00.000Z")) // optional → commented out
        #expect(!eventOut.contains("\nend: ")) // never a live optional dt-end
        #expect(eventOut.contains("location: \"\""))
        #expect(eventOut.contains("Write your event here."))

        let review = try #require(registry.descriptor(id: "review"))
        let reviewOut = ContentScaffold.renderEntry(descriptor: review, title: "Widget", now: now)
        #expect(reviewOut.contains("itemReviewed: \"Widget\"")) // itemReviewed is title-like (#386)
        #expect(reviewOut.contains("rating: 0"))
        #expect(reviewOut.contains("publishDate: 1970-01-01T00:00:00.000Z"))
    }

    @Test("renderEntry fills the title field and uses imageArray/url defaults")
    func renderEntryAlbumAndLike() {
        let registry = ContentTypeRegistry()
        let album = try! #require(registry.descriptor(id: "album"))
        let albumOut = ContentScaffold.renderEntry(
            descriptor: album, title: "Trip", now: Date(timeIntervalSince1970: 1_750_000_000))
        #expect(albumOut.contains("title: \"Trip\""))
        #expect(albumOut.contains("images: []"))
        #expect(albumOut.contains("publishDate: 2025-06-15T15:06:40.000Z"))
        #expect(albumOut.contains("Write your album here."))

        let like = try! #require(registry.descriptor(id: "like"))
        let likeOut = ContentScaffold.renderEntry(
            descriptor: like, title: nil, now: Date(timeIntervalSince1970: 1_750_000_000))
        #expect(likeOut.contains("likeOf: \"\""))
        #expect(likeOut.contains("publishDate: 2025-06-15T15:06:40.000Z"))
        // No markdown field on a like → no body placeholder.
        #expect(!likeOut.contains("Write your"))
    }

    @Test("renderEntry only emits schema-declared display fields")
    func renderEntryReviewUsesItemReviewedWithoutExtraKeys() {
        let review = try! #require(ContentTypeRegistry().descriptor(id: "review"))
        let out = ContentScaffold.renderEntry(
            descriptor: review, title: "Tiny Cafe", now: Date(timeIntervalSince1970: 1_750_000_000))

        #expect(out.contains("itemReviewed: \"Tiny Cafe\""))
        #expect(out.contains("rating: 0"))
        #expect(out.contains("publishDate: 2025-06-15T15:06:40.000Z"))
        #expect(!out.contains("\ntitle:"))
        #expect(!out.contains("\ndraft:"))
    }

    @Test("singletonRelativePath maps a slot to a data-module json path")
    func singletonPath() {
        #expect(ContentScaffold.singletonRelativePath(slot: "profile") == "src/data/profile.json")
    }

    @Test("renderSingleton emits a business profile with type, filled name, and empty defaults")
    func renderSingletonBusiness() throws {
        let biz = try #require(ContentTypeRegistry().descriptor(id: "businessProfile"))
        let out = ContentScaffold.renderSingleton(descriptor: biz, name: "Acme \"Co\"")
        #expect(out == """
        {
          "type": "businessProfile",
          "name": "Acme \\"Co\\"",
          "description": "",
          "telephone": "",
          "email": "",
          "streetAddress": "",
          "locality": "",
          "region": "",
          "postalCode": "",
          "hours": [],
          "url": ""
        }
        """ + "\n")
    }

    @Test("renderSingleton for a personal profile omits business-only keys")
    func renderSingletonPersonal() throws {
        let person = try #require(ContentTypeRegistry().descriptor(id: "personalProfile"))
        let out = ContentScaffold.renderSingleton(descriptor: person, name: "Ada")
        #expect(out.contains("\"type\": \"personalProfile\""))
        #expect(out.contains("\"name\": \"Ada\""))
        #expect(out.contains("\"photo\": \"\""))
        #expect(!out.contains("streetAddress"))
        #expect(!out.contains("hours"))
        #expect(out.hasSuffix("}\n"))
    }

    @Test("renderSingleton emits valid JSON even when the name carries control characters")
    func renderSingletonEscapesControlChars() throws {
        let person = try #require(ContentTypeRegistry().descriptor(id: "personalProfile"))
        // NUL, SOH, backspace, form-feed (C0) plus U+2028/U+2029 (the JS-in-<script> landmine).
        let tricky = "A\u{0}\u{1}\u{8}\u{C}\u{2028}\u{2029}B"
        let out = ContentScaffold.renderSingleton(descriptor: person, name: tricky)
        // U+2028/U+2029 must be emitted as \u escapes, not raw, so inline-<script> embedding is safe.
        #expect(!out.unicodeScalars.contains("\u{2028}"))
        #expect(!out.unicodeScalars.contains("\u{2029}"))
        let data = try #require(out.data(using: .utf8))
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(obj?["type"] as? String == "personalProfile")
        #expect(obj?["name"] as? String == tricky) // round-trips losslessly
    }

    @Test("renderEntry renders a supplied required .url value live and valid")
    func renderEntrySuppliedRequiredURL() throws {
        let like = try #require(ContentTypeRegistry().descriptor(id: "like"))
        let out = ContentScaffold.renderEntry(
            descriptor: like,
            title: nil,
            now: Date(timeIntervalSince1970: 1_750_000_000),
            fieldValues: ["likeOf": "https://example.com/post"])
        #expect(out.contains("likeOf: \"https://example.com/post\""))
        #expect(!out.contains("likeOf: \"\""))
    }

    @Test("a supplied optional .url value renders live instead of commented out")
    func renderEntrySuppliedOptionalURL() throws {
        let note = try #require(ContentTypeRegistry().descriptor(id: "note"))
        let now = Date(timeIntervalSince1970: 1_750_000_000)

        let withValue = ContentScaffold.renderEntry(
            descriptor: note, title: nil, now: now,
            fieldValues: ["audience": "https://example.com/friends"])
        #expect(withValue.contains("\naudience: \"https://example.com/friends\""))
        #expect(!withValue.contains("# audience:"))

        // An explicitly empty value is treated the same as no value: commented out (#913).
        let withEmpty = ContentScaffold.renderEntry(
            descriptor: note, title: nil, now: now, fieldValues: ["audience": ""])
        #expect(withEmpty.contains("# audience: \"\""))
    }

    @Test("renderEntry escapes a supplied value and ignores unknown field names")
    func renderEntrySuppliedValueEscaping() throws {
        let bookmark = try #require(ContentTypeRegistry().descriptor(id: "bookmark"))
        let out = ContentScaffold.renderEntry(
            descriptor: bookmark,
            title: "Title",
            now: Date(timeIntervalSince1970: 1_750_000_000),
            fieldValues: ["bookmarkOf": "https://example.com/a\"b", "notAField": "ignored"])
        #expect(out.contains("bookmarkOf: \"https://example.com/a\\\"b\""))
        #expect(!out.contains("notAField"))
    }

    @Test("a title-like optional .url field never falls back to the title, only to empty")
    func optionalURLFieldNamedLikeTitleDoesNotLeakTitle() {
        // `titleLikeFieldNames` ("title", "name", "itemReviewed") is a name-based heuristic meant
        // for .string fields; a custom descriptor (via ContentTypeRegistry.register(_:)) could
        // declare an *optional* .url field with one of those names. Falling back to the title would
        // render a non-URL string into a z.string().url() slot as a live line — exactly the
        // schema-invalid write this file exists to prevent (#916 follow-up).
        let descriptor = ContentTypeDescriptor(
            id: "syntheticURLTitle",
            displayName: "Synthetic URL Title",
            storage: .collection("synthetics"),
            fields: [
                ContentTypeField("name", .url),
            ],
            projections: ContentTypeProjections(
                microformat: "h-entry", microformatProperties: [:], schemaType: nil))

        let out = ContentScaffold.renderEntry(
            descriptor: descriptor, title: "Some Title",
            now: Date(timeIntervalSince1970: 1_750_000_000))
        #expect(out.contains("# name: \"\""))
        #expect(!out.contains("\nname: \"Some Title\""))
    }

    @Test("required .url fields scaffold as an empty live line when nothing is supplied")
    func renderEntryEmptyFieldValuesIsUnchanged() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        for descriptor in ContentTypeRegistry.builtIns where descriptor.collection != nil {
            let withDefault = ContentScaffold.renderEntry(descriptor: descriptor, title: "Title", now: now)
            // Required .url fields still scaffold as an empty live line when nothing is supplied —
            // the create path (NativeContentOperations) is what refuses to write that, not the
            // renderer, which stays a pure formatter.
            for field in descriptor.requiredURLFields {
                #expect(withDefault.contains("\(field.name): \"\""), "\(descriptor.id).\(field.name)")
            }
        }
    }

    @Test("slugFromURL combines the UTC date, host, and last path segment")
    func slugFromURLShape() {
        // 1_750_000_000 == 2025-06-15T15:06:40Z
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        #expect(ContentScaffold.slugFromURL("https://example.com/blog/hello-world", now: now)
                == "2025-06-15-example-com-hello-world")
        #expect(ContentScaffold.slugFromURL("https://www.example.com/a/b/", now: now)
                == "2025-06-15-example-com-b")
        #expect(ContentScaffold.slugFromURL("https://example.com/", now: now)
                == "2025-06-15-example-com")
        #expect(ContentScaffold.slugFromURL("https://example.com", now: now)
                == "2025-06-15-example-com")
        // Query and fragment are not part of the slug.
        #expect(ContentScaffold.slugFromURL("https://example.com/post?utm=x#frag", now: now)
                == "2025-06-15-example-com-post")
    }

    @Test("slugFromURL returns empty for a value with no host, so callers can fall back")
    func slugFromURLNoHost() {
        let now = Date(timeIntervalSince1970: 1_750_000_000)
        #expect(ContentScaffold.slugFromURL("", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("not a url", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("/relative/path", now: now).isEmpty)
        #expect(ContentScaffold.slugFromURL("mailto:a@b.c", now: now).isEmpty)
    }
}
