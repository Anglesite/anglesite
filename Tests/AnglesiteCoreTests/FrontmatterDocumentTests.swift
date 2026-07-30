// Tests/AnglesiteCoreTests/FrontmatterDocumentTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("FrontmatterDocument")
struct FrontmatterDocumentTests {

    @Test("unedited round-trip is the identity")
    func identity() {
        let src = """
        ---
        title: "Hello"
        draft: false
        tags:
          - a
          - b
        ---

        Body text here.
        """ + "\n"
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("reads scalar, bool, and array values")
    func reads() {
        let doc = FrontmatterDocument.parse("---\ntitle: \"Hi\"\ndraft: true\ntags: [x, y]\n---\nB\n")
        #expect(doc.value(for: "title") == .string("Hi"))
        #expect(doc.value(for: "draft") == .bool(true))
        #expect(doc.value(for: "tags") == .array(["x", "y"]))
        #expect(doc.value(for: "missing") == nil)
    }

    @Test("editing one field leaves untouched keys and body verbatim")
    func editPreserves() {
        let src = "---\ntitle: \"Old\"\nweirdKey: keep-me-exactly\ndraft: false\n---\n\nBody.\n"
        var doc = FrontmatterDocument.parse(src)
        doc.set(.string("New"), for: "title")
        let out = doc.serialized()
        #expect(out.contains("title: \"New\""))
        #expect(out.contains("weirdKey: keep-me-exactly"))   // unknown key preserved verbatim
        #expect(out.contains("draft: false"))
        #expect(out.hasSuffix("\n\nBody.\n"))                // body verbatim
    }

    @Test("setting a new key appends it")
    func appendsNewKey() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.string("noreply@x.io"), for: "email")
        #expect(doc.serialized().contains("email: \"noreply@x.io\""))
        #expect(doc.value(for: "email") == .string("noreply@x.io"))
    }

    @Test("no-frontmatter source is all body")
    func noFrontmatter() {
        let doc = FrontmatterDocument.parse("# Heading\n\nbody\n")
        #expect(doc.keys.isEmpty)
        #expect(doc.body == "# Heading\n\nbody\n")
        #expect(doc.serialized() == "# Heading\n\nbody\n")
    }

    @Test("editing the body leaves frontmatter verbatim")
    func editBody() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\n\nold body\n")
        doc.body = "\nnew body\n"
        let out = doc.serialized()
        #expect(out.contains("title: \"T\""))
        #expect(out.hasSuffix("\nnew body\n"))
    }

    @Test("array set renders block form and round-trips")
    func arraySet() {
        var doc = FrontmatterDocument.parse("---\nhours: []\n---\n")
        doc.set(.array(["Mon 9-5", "Tue 9-5"]), for: "hours")
        let out = doc.serialized()
        let reparsed = FrontmatterDocument.parse(out)
        #expect(reparsed.value(for: "hours") == .array(["Mon 9-5", "Tue 9-5"]))
    }

    @Test("comments and blank lines inside frontmatter survive an unedited round-trip")
    func commentsSurvive() {
        let src = "---\ntitle: \"T\"\n# a comment\n\ndraft: false\n---\nB\n"
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("frontmatter-only source with no trailing newline round-trips without injecting one")
    func noTrailingNewlineIdentity() {
        let src = "---\ntitle: \"T\"\n---"          // no body, no terminal newline
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("frontmatter-only source with a trailing newline round-trips")
    func trailingNewlineIdentity() {
        let src = "---\ntitle: \"T\"\n---\n"        // terminal newline, still no body
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("string value containing a double-quote round-trips")
    func roundTripsDoubleQuote() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"x\"\n---\n")
        doc.set(.string("a \"quoted\" b"), for: "title")
        let out = doc.serialized()
        #expect(FrontmatterDocument.parse(out).value(for: "title") == .string("a \"quoted\" b"))
    }

    @Test("string value containing a newline round-trips (escape)")
    func roundTripsNewline() {
        var doc = FrontmatterDocument.parse("---\ndescription: \"x\"\n---\n\nBody.\n")
        doc.set(.string("line one\nline two"), for: "description")
        let out = doc.serialized()
        // The embedded newline must be escaped, not emitted literally (which would break the fence).
        #expect(FrontmatterDocument.parse(out).value(for: "description") == .string("line one\nline two"))
        #expect(out.contains("Body."))   // body intact, frontmatter still a single block
    }

    @Test("string value containing a bare colon round-trips (split on first colon only)")
    func roundTripsBareColon() {
        var doc = FrontmatterDocument.parse("---\nurl: \"x\"\n---\n")
        doc.set(.string("https://example.com"), for: "url")
        let out = doc.serialized()
        #expect(FrontmatterDocument.parse(out).value(for: "url") == .string("https://example.com"))
    }

    @Test("duplicate top-level key survives an unedited round-trip verbatim")
    func duplicateKeyIdentity() {
        let src = "---\ntitle: \"A\"\ntitle: \"B\"\n---\nB\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.serialized() == src)                  // both occurrences preserved
        #expect(doc.value(for: "title") == .string("B"))  // get addresses the last
    }

    @Test("setting an object-array value renders block-mapping-list YAML")
    func setObjectArray() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([
            [FrontmatterRecordField("title", .string("Engineer")), FrontmatterRecordField("start", .date("2020-01-01"))],
            [FrontmatterRecordField("title", .string("Intern")), FrontmatterRecordField("start", .date("2018-06-01"))],
        ]), for: "experience")
        let out = doc.serialized()
        #expect(out.contains("""
        experience:
          - title: "Engineer"
            start: 2020-01-01
          - title: "Intern"
            start: 2018-06-01
        """))
    }

    @Test("setting an empty object-array value renders an inline empty array")
    func setEmptyObjectArray() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([]), for: "experience")
        #expect(doc.serialized().contains("experience: []"))
    }

    @Test("an object-array record with no fields renders as an empty mapping item")
    func setObjectArrayEmptyRecord() {
        var doc = FrontmatterDocument.parse("---\ntitle: \"T\"\n---\nB\n")
        doc.set(.objectArray([[]]), for: "experience")
        #expect(doc.serialized().contains("experience:\n  - {}"))
    }

    @Test("reads a block object-array into ordered records")
    func readsObjectArray() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
            start: 2020-01-01
          - title: "Intern"
            org: "Other Co"
            start: 2018-06-01
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "experience") == .objectArray([
            [FrontmatterRecordField("title", .string("Engineer")),
             FrontmatterRecordField("org", .string("Acme")),
             FrontmatterRecordField("start", .string("2020-01-01"))],
            [FrontmatterRecordField("title", .string("Intern")),
             FrontmatterRecordField("org", .string("Other Co")),
             FrontmatterRecordField("start", .string("2018-06-01"))],
        ]))
    }

    @Test("unedited object-array round-trip is the identity")
    func objectArrayIdentity() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
        ---
        Body.
        """ + "\n"
        #expect(FrontmatterDocument.parse(src).serialized() == src)
    }

    @Test("editing an object-array field re-renders only that field")
    func objectArrayEditRoundTrips() {
        let src = "---\ntitle: \"Resume\"\nexperience:\n  - title: \"Engineer\"\n    org: \"Acme\"\n---\nBody.\n"
        var doc = FrontmatterDocument.parse(src)
        doc.set(.objectArray([[FrontmatterRecordField("title", .string("Senior Engineer")),
                                FrontmatterRecordField("org", .string("Acme"))]]), for: "experience")
        let out = doc.serialized()
        #expect(out.contains("title: \"Senior Engineer\""))
        #expect(FrontmatterDocument.parse(out).value(for: "experience")
                == .objectArray([[FrontmatterRecordField("title", .string("Senior Engineer")),
                                   FrontmatterRecordField("org", .string("Acme"))]]))
    }

    // MARK: Object-array detection must not swallow flat string arrays (#1117 final review)
    //
    // `Frontmatter.splitKeyValue` splits on the first colon with no space required, so plenty of
    // legitimate *unquoted* flat-array items look like `key: value`. Misclassifying one as an
    // object array makes `TypedContentEditor.decode` hand the editor an empty list, and the next
    // save writes that emptiness back over the author's data. Both cases below are real shipped
    // `.stringArray` fields (`businessProfile.hours`, `member.links`) as a person would hand-author
    // them, without quotes.

    @Test("unquoted `Monday: 9:00-17:00` hours parse as a flat string array, not an object array")
    func unquotedHoursStayFlat() {
        let src = """
        ---
        title: "Acme"
        hours:
          - Monday: 9:00-17:00
          - Tuesday: 9:00-17:00
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "hours") == .array(["Monday: 9:00-17:00", "Tuesday: 9:00-17:00"]))
    }

    @Test("unquoted URL list items parse as a flat string array, not an object array")
    func unquotedURLsStayFlat() {
        let src = """
        ---
        name: "Someone"
        links:
          - https://example.com
          - https://mastodon.social/@me
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "links") == .array(["https://example.com", "https://mastodon.social/@me"]))
    }

    @Test("editing another field preserves an unquoted hours list verbatim")
    func unquotedHoursSurviveUnrelatedEdit() {
        let src = """
        ---
        title: "Acme"
        hours:
          - Monday: 9:00-17:00
          - Tuesday: 9:00-17:00
        ---
        Body.
        """ + "\n"
        var doc = FrontmatterDocument.parse(src)
        doc.set(.string("Acme Inc."), for: "title")
        let out = doc.serialized()
        #expect(out.contains("title: \"Acme Inc.\""))
        // The untouched field keeps its original unquoted source lines…
        #expect(out.contains("hours:\n  - Monday: 9:00-17:00\n  - Tuesday: 9:00-17:00"))
        // …and still reads back as the same flat list (the parse-side misclassification that
        // caused the data loss is what this pins).
        #expect(FrontmatterDocument.parse(out).value(for: "hours")
                == .array(["Monday: 9:00-17:00", "Tuesday: 9:00-17:00"]))
    }

    @Test("a short FIRST record doesn't hide a later record's continuation")
    func objectArrayDetectedWhenOnlyLaterRecordHasContinuation() {
        // Records need not be uniform, and a hand-edited list is very likely to be filled in
        // unevenly. Detection reads the whole block, so evidence in the *second* record counts:
        // judging from the first record alone would call this flat and strand `org: "Acme"` as an
        // orphaned raw line detached from `experience` (zero rows in the editor, on read).
        let src = """
        ---
        experience:
          - title: "Engineer"
          - title: "Intern"
            org: "Acme"
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "experience") == .objectArray([
            [FrontmatterRecordField("title", .string("Engineer"))],
            [FrontmatterRecordField("title", .string("Intern")),
             FrontmatterRecordField("org", .string("Acme"))],
        ]))
        #expect(doc.serialized() == src)   // every line still belongs to `experience`
    }

    @Test("a short LAST record is still part of the object array")
    func objectArrayDetectedWhenOnlyEarlierRecordHasContinuation() {
        // The mirror image of the case above — the same whole-block rule has to cover both
        // orderings, so pin the direction the detection peek used to get right by luck.
        let src = """
        ---
        experience:
          - title: "Engineer"
            org: "Acme"
          - title: "Intern"
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        #expect(doc.value(for: "experience") == .objectArray([
            [FrontmatterRecordField("title", .string("Engineer")),
             FrontmatterRecordField("org", .string("Acme"))],
            [FrontmatterRecordField("title", .string("Intern"))],
        ]))
        #expect(doc.serialized() == src)
    }

    @Test("a single-field record is read as a flat list (documented detection trade-off)")
    func singleFieldRecordReadsAsFlatList() {
        let src = """
        ---
        experience:
          - title: "Engineer"
          - title: "Intern"
        ---
        Body.
        """ + "\n"
        let doc = FrontmatterDocument.parse(src)
        // No continuation line *anywhere in the block* ⟹ nothing in the source distinguishes this
        // from a flat list of `key: value`-shaped strings, so it reads as one. Every planned real
        // use of `.objectArray` has multiple fields in at least one record (see the case above),
        // so this costs nothing in practice.
        #expect(doc.value(for: "experience") == .array(["title: \"Engineer\"", "title: \"Intern\""]))
        #expect(doc.serialized() == src)   // still verbatim when untouched
    }
}
