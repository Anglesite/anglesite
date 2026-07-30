// Tests/AnglesiteCoreTests/FrontmatterTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

/// Native port of `server/content-frontmatter.mjs` — a deliberately minimal YAML-frontmatter
/// reader for the `list_content` scan. These tests pin it to the Node parser it replaces.
@Suite("Frontmatter")
struct FrontmatterTests {

    @Test("no frontmatter delimiter yields an empty map")
    func noFrontmatter() {
        #expect(Frontmatter.parse("# Just a heading\n\nbody").isEmpty)
        #expect(Frontmatter.parse("leading text\n---\ntitle: x\n---").isEmpty)
    }

    @Test("quoted and unquoted scalars")
    func scalars() {
        let fm = Frontmatter.parse("---\ntitle: Hello World\nslug: 'my-post'\nname: \"Quoted\"\n---\nbody")
        #expect(fm["title"] == .string("Hello World"))
        #expect(fm["slug"] == .string("my-post"))
        #expect(fm["name"] == .string("Quoted"))
    }

    @Test("booleans parse to bool, not string")
    func booleans() {
        let fm = Frontmatter.parse("---\ndraft: true\npublished: false\n---")
        #expect(fm["draft"] == .bool(true))
        #expect(fm["published"] == .bool(false))
    }

    @Test("inline arrays")
    func inlineArrays() {
        let fm = Frontmatter.parse("---\ntags: [swift, ios, \"web dev\"]\nempty: []\n---")
        #expect(fm["tags"] == .array(["swift", "ios", "web dev"]))
        #expect(fm["empty"] == .array([]))
    }

    @Test("block arrays on following indented dash lines")
    func blockArrays() {
        let fm = Frontmatter.parse("---\ntags:\n  - swift\n  - 'ios'\nother: x\n---")
        #expect(fm["tags"] == .array(["swift", "ios"]))
        #expect(fm["other"] == .string("x"))
    }

    @Test("comments and blank lines are skipped")
    func commentsSkipped() {
        let fm = Frontmatter.parse("---\n# a comment\ntitle: T\n\n# another\n---")
        #expect(fm["title"] == .string("T"))
        #expect(fm.count == 1)
    }

    @Test("indented (nested) keys are ignored as top-level fields")
    func nestedIgnored() {
        let fm = Frontmatter.parse("---\nauthor:\n  name: Dana\ntitle: T\n---")
        // `author:` has an empty value with no dash-lines → "" ; nested `name:` is indented, ignored.
        #expect(fm["name"] == nil)
        #expect(fm["author"] == .string(""))
        #expect(fm["title"] == .string("T"))
    }

    @Test("CRLF line endings are handled")
    func crlf() {
        let fm = Frontmatter.parse("---\r\ntitle: T\r\ndraft: true\r\n---\r\nbody")
        #expect(fm["title"] == .string("T"))
        #expect(fm["draft"] == .bool(true))
    }

    // MARK: - YAML escape decoding (Fix 1)

    @Test("double-quoted scalar: decodes \\\" and \\\\ escapes")
    func doubleQuotedEscapes() {
        // Source line: title: "a\"b\\c"  — writer output for title a"b\c
        let fm = Frontmatter.parse("---\ntitle: \"a\\\"b\\\\c\"\n---")
        #expect(fm["title"] == .string("a\"b\\c"))
    }

    @Test("double-quoted scalar: \\n decodes to newline, \\t to tab")
    func doubleQuotedNewlineTab() {
        let fm = Frontmatter.parse("---\ntitle: \"line1\\nline2\"\ntag: \"a\\tb\"\n---")
        #expect(fm["title"] == .string("line1\nline2"))
        #expect(fm["tag"] == .string("a\tb"))
    }

    @Test("double-quoted scalar: \\\\n is backslash-then-n, NOT newline (single-pass guard)")
    func doubleQuotedBackslashBackslashN() {
        // Source: "a\\nb"  — escaped form of title a\nb (backslash then literal n)
        let fm = Frontmatter.parse("---\ntitle: \"a\\\\nb\"\n---")
        #expect(fm["title"] == .string("a\\nb"))
    }

    @Test("double-quoted scalar: unknown escape keeps backslash+char")
    func doubleQuotedUnknownEscape() {
        let fm = Frontmatter.parse("---\ntitle: \"hello\\xworld\"\n---")
        #expect(fm["title"] == .string("hello\\xworld"))
    }

    @Test("single-quoted scalar: '' decodes to single quote")
    func singleQuotedDoubling() {
        // YAML single-quoted escape: '' → '
        let fm = Frontmatter.parse("---\ntitle: 'it''s a test'\n---")
        #expect(fm["title"] == .string("it's a test"))
    }

    @Test("unquoted scalar: returned as-is (no escape processing)")
    func unquotedUnchanged() {
        let fm = Frontmatter.parse("---\ntitle: plain value\n---")
        #expect(fm["title"] == .string("plain value"))
    }

    // MARK: - Body accessor (Slice 6, #465)

    @Test("body: everything after the closing fence")
    func bodyAfterFence() {
        let body = Frontmatter.body("---\ntitle: Our Story\ndescription: How we started\n---\n\n# Hello\nBody text.")
        #expect(body.contains("Body text."))
        #expect(!body.contains("title:"))
    }

    @Test("body: unfenced input is returned whole")
    func bodyUnfenced() {
        #expect(Frontmatter.body("just text") == "just text")
        #expect(Frontmatter.body("# Just a heading\n\nbody") == "# Just a heading\n\nbody")
    }

    @Test("body: unterminated fence returns whole input")
    func bodyUnterminatedFence() {
        let src = "---\ntitle: x\nno closing fence"
        #expect(Frontmatter.body(src) == src)
    }

    // MARK: - Shared line-based helpers (frontmatter-parsing unification)

    @Test("closingFenceIndex: exact `---` lines only, index into the original array")
    func closingFence() {
        #expect(Frontmatter.closingFenceIndex(of: ["---", "title: x", "---", "body"]) == 2)
        #expect(Frontmatter.closingFenceIndex(of: ["---", "---"]) == 1)
        #expect(Frontmatter.closingFenceIndex(of: ["---", "title: x"]) == nil)     // unterminated
        #expect(Frontmatter.closingFenceIndex(of: ["--- ", "x", "---"]) == nil)    // trailing space
        #expect(Frontmatter.closingFenceIndex(of: ["---"]) == nil)                 // lone fence
        #expect(Frontmatter.closingFenceIndex(of: ["body"]) == nil)                // no fence
        #expect(Frontmatter.closingFenceIndex(of: []) == nil)
    }

    @Test("doubleQuoted round-trips through parse, including newlines")
    func doubleQuotedRoundTrip() {
        for original in ["plain", "a\"b\\c", "line1\nline2", "cr\rlf", "tab\there", ""] {
            let fm = Frontmatter.parse("---\ntitle: \(Frontmatter.doubleQuoted(original))\n---")
            #expect(fm["title"] == .string(original), "round-trip failed for \(original.debugDescription)")
        }
    }

    @Test("an object-array field doesn't corrupt sibling top-level fields (Frontmatter.parse is not record-aware by design)")
    func objectArrayFieldDoesNotCorruptSiblings() {
        let src = """
        ---
        title: "Resume"
        experience:
          - title: "Engineer"
            org: "Acme"
        draft: true
        ---
        """
        let fm = Frontmatter.parse(src)
        #expect(fm["title"] == .string("Resume"))
        #expect(fm["draft"] == .bool(true))
    }
}
