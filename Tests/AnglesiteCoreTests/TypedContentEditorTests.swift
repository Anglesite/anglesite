// Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("TypedContentEditor")
struct TypedContentEditorTests {
    private var note: ContentTypeDescriptor { ContentTypeRegistry().descriptor(id: "note")! }
    private var event: ContentTypeDescriptor { ContentTypeRegistry().descriptor(id: "event")! }
    private var reply: ContentTypeDescriptor { ContentTypeRegistry().descriptor(id: "reply")! }
    private var review: ContentTypeDescriptor { ContentTypeRegistry().descriptor(id: "review")! }

    @Test("edited number field serializes unquoted (satisfies z.number())")
    func numberWritesUnquoted() {
        let src = "---\nitemReviewed: \"Widget\"\nrating: 5\npublishDate: 2026-01-01T00:00:00.000Z\n---\n\nReview.\n"
        var v = TypedContentEditor.read(src, descriptor: review)
        v["rating"] = .number(4)
        let out = TypedContentEditor.write(v, into: src, descriptor: review)
        #expect(out.contains("rating: 4"))        // unquoted
        #expect(!out.contains("rating: \"4\""))   // not a quoted string
        // round-trips back to a number
        #expect(TypedContentEditor.read(out, descriptor: review)["rating"] == .number(4))
    }

    @Test("edited date field serializes unquoted and round-trips to the same Date")
    func dateWritesUnquoted() {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let newDate = iso.date(from: "2027-03-04T05:06:07.000Z")!

        // datetime kind (review.publishDate) → full ISO, unquoted
        let src = "---\nitemReviewed: \"Widget\"\nrating: 5\npublishDate: 2026-01-01T00:00:00.000Z\n---\n\nReview.\n"
        var v = TypedContentEditor.read(src, descriptor: review)
        v["publishDate"] = .date(newDate)
        let out = TypedContentEditor.write(v, into: src, descriptor: review)
        #expect(out.contains("publishDate: 2027-03-04T05:06:07.000Z"))     // unquoted
        #expect(!out.contains("publishDate: \"2027-03-04T05:06:07.000Z\"")) // not a quoted string
        #expect(TypedContentEditor.read(out, descriptor: review)["publishDate"] == .date(newDate))

        // an unedited date stays byte-for-byte (verbatim), never re-rendered
        var v2 = TypedContentEditor.read(src, descriptor: review)
        v2["rating"] = .number(4)
        let out2 = TypedContentEditor.write(v2, into: src, descriptor: review)
        #expect(out2.contains("publishDate: 2026-01-01T00:00:00.000Z"))    // verbatim, still unquoted
    }

    @Test("edited date-only (.date kind) field serializes as a bare yyyy-MM-dd scalar")
    func dateOnlyWritesUnquoted() {
        // No built-in type uses .date kind, so exercise the `kind == .date` branch in format() with
        // a custom descriptor.
        let dated = ContentTypeDescriptor(
            id: "dated", displayName: "Dated", storage: .collection("dated"),
            fields: [ContentTypeField("start", .date, required: true), ContentTypeField("body", .markdown)],
            projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil))

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let newDate = iso.date(from: "2027-03-04T00:00:00.000Z")!   // midnight UTC ⟷ yyyy-MM-dd

        let src = "---\nstart: 2026-01-01\n---\n\nEntry.\n"
        var v = TypedContentEditor.read(src, descriptor: dated)
        v["start"] = .date(newDate)
        let out = TypedContentEditor.write(v, into: src, descriptor: dated)
        #expect(out.contains("start: 2027-03-04"))       // bare date, unquoted
        #expect(!out.contains("start: 2027-03-04T"))      // not the full datetime
        #expect(!out.contains("start: \"2027-03-04\""))   // not a quoted string
        #expect(TypedContentEditor.read(out, descriptor: dated)["start"] == .date(newDate))
    }

    @Test("reads markdown field from body and scalars from frontmatter")
    func reads() {
        let src = "---\npublishDate: 2026-01-02T03:04:05.000Z\ntags: [a, b]\n---\n\nHello body.\n"
        let v = TypedContentEditor.read(src, descriptor: note)
        #expect(v["body"] == .text("\nHello body.\n"))           // markdown ⟷ body
        #expect(v["tags"] == .list(["a", "b"]))
        if case .date(let d?) = v["publishDate"] { #expect(d.timeIntervalSince1970 > 0) } else { Issue.record("no date") }
    }

    @Test("audience round-trips through the editor like any other optional url field")
    func audienceRoundTrips() {
        let src = "---\npublishDate: 2026-01-02T03:04:05.000Z\n---\n\nHello.\n"

        // absent in the source -> empty default, same as every other optional scalar
        let read = TypedContentEditor.read(src, descriptor: note)
        #expect(read["audience"] == .text(""))

        // editing it writes a quoted scalar and round-trips back to the same value
        var v = read
        v["audience"] = .text("https://community.example/c/local")
        let out = TypedContentEditor.write(v, into: src, descriptor: note)
        #expect(out.contains("audience: \"https://community.example/c/local\""))
        #expect(TypedContentEditor.read(out, descriptor: note)["audience"]
                == .text("https://community.example/c/local"))

        // leaving it untouched writes nothing new for it
        var unchanged = read
        unchanged["publishDate"] = read["publishDate"]!
        let out2 = TypedContentEditor.write(unchanged, into: src, descriptor: note)
        #expect(!out2.contains("audience:"))
    }

    @Test("missing fields get empty defaults")
    func defaults() {
        let v = TypedContentEditor.read("---\n---\n", descriptor: reply)
        #expect(v["inReplyTo"] == .text(""))
        #expect(v["body"] == .text(""))
    }

    @Test("write applies only changed fields, leaving others verbatim")
    func writeChangedOnly() {
        let src = "---\ninReplyTo: \"https://a.example/x\"\npublishDate: 2026-01-02T03:04:05.000Z\n---\n\nold.\n"
        var v = TypedContentEditor.read(src, descriptor: reply)
        v = TypedContentEditor.Values([
            "inReplyTo": .text("https://b.example/y"),      // changed
            "publishDate": v["publishDate"]!,               // unchanged
            "body": v["body"]!                              // unchanged
        ])
        let out = TypedContentEditor.write(v, into: src, descriptor: reply)
        #expect(out.contains("inReplyTo: \"https://b.example/y\""))
        #expect(out.contains("publishDate: 2026-01-02T03:04:05.000Z"))  // verbatim, not reformatted
        #expect(out.hasSuffix("\nold.\n"))                              // body verbatim
    }

    @Test("write updates the markdown body")
    func writeBody() {
        let src = "---\npublishDate: 2026-01-02T03:04:05.000Z\n---\n\nold.\n"
        var v = TypedContentEditor.read(src, descriptor: note)
        v = TypedContentEditor.Values(["publishDate": v["publishDate"]!, "tags": v["tags"] ?? .list([]),
                                       "body": .text("\nnew body.\n")])
        let out = TypedContentEditor.write(v, into: src, descriptor: note)
        #expect(out.hasSuffix("\nnew body.\n"))
    }

    @Test("write round-trips a list field into block YAML")
    func writeList() {
        let profile = ContentTypeRegistry().descriptor(id: "businessProfile")!
        let src = "---\ntype: businessProfile\nname: \"Acme\"\nhours: []\n---\n"
        var v = TypedContentEditor.read(src, descriptor: profile)
        var dict = [String: TypedContentEditor.FieldValue]()
        for f in profile.fields { dict[f.name] = v[f.name] }
        dict["hours"] = .list(["Mon 9-5", "Sat closed"])
        let out = TypedContentEditor.write(TypedContentEditor.Values(dict), into: src, descriptor: profile)
        #expect(TypedContentEditor.read(out, descriptor: profile)["hours"] == .list(["Mon 9-5", "Sat closed"]))
        #expect(out.contains("type: businessProfile"))   // unknown-to-schema key preserved
    }

    @Test("template about.md reads as businessProfile with marker preserved")
    func aboutPage() {
        let profile = ContentTypeRegistry().descriptor(id: "businessProfile")!
        let src = """
        ---
        layout: ../layouts/BaseLayout.astro
        title: "About"
        type: businessProfile
        name: "Your Business Name"
        hours: []
        url: ""
        ---

        # About
        """ + "\n"
        let v = TypedContentEditor.read(src, descriptor: profile)
        #expect(v["name"] == .text("Your Business Name"))
        var dict = [String: TypedContentEditor.FieldValue]()
        for f in profile.fields { dict[f.name] = v[f.name] }
        dict["name"] = .text("Acme Co")
        let out = TypedContentEditor.write(TypedContentEditor.Values(dict), into: src, descriptor: profile)
        #expect(out.contains("name: \"Acme Co\""))
        #expect(out.contains("type: businessProfile"))           // marker preserved
        #expect(out.contains("layout: ../layouts/BaseLayout.astro")) // layout preserved
    }
}
