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
}
