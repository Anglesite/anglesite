// Tests/AnglesiteCoreTests/ContentFieldValidationTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContentFieldValidation")
struct ContentFieldValidationTests {
    @Test("isAbsoluteURL accepts http(s) URLs with a host")
    func acceptsAbsoluteURLs() {
        #expect(ContentFieldValidation.isAbsoluteURL("https://example.com"))
        #expect(ContentFieldValidation.isAbsoluteURL("https://example.com/blog/hello-world"))
        #expect(ContentFieldValidation.isAbsoluteURL("http://a.b/c?d=e#f"))
    }

    @Test("isAbsoluteURL rejects anything without a scheme and host")
    func rejectsNonAbsoluteURLs() {
        #expect(!ContentFieldValidation.isAbsoluteURL(""))
        #expect(!ContentFieldValidation.isAbsoluteURL("   "))
        #expect(!ContentFieldValidation.isAbsoluteURL("not a url"))
        #expect(!ContentFieldValidation.isAbsoluteURL("example.com"))
        #expect(!ContentFieldValidation.isAbsoluteURL("/relative/path"))
        #expect(!ContentFieldValidation.isAbsoluteURL("https:"))
        // A scheme with no host: parses, but yields no usable u-* microformat value.
        #expect(!ContentFieldValidation.isAbsoluteURL("mailto:a@b.c"))
    }

    @Test("isAbsoluteURL enforces the WHATWG/Zod port range")
    func enforcesPortRange() {
        // 0 and 65535 are the boundaries WHATWG's URL parser (and z.string().url()) accepts.
        #expect(ContentFieldValidation.isAbsoluteURL("http://example.com:65535"))
        #expect(ContentFieldValidation.isAbsoluteURL("http://example.com:0"))
        // Anything above 65535 parses via URLComponents but is rejected by z.string().url(),
        // so it must fail here too or the invariant with astro check breaks.
        #expect(!ContentFieldValidation.isAbsoluteURL("http://example.com:65536"))
        #expect(!ContentFieldValidation.isAbsoluteURL("http://example.com:99999"))
    }

    @Test("isAbsoluteURL rejects an interior newline or space URLComponents would otherwise let through")
    func rejectsInteriorWhitespaceAndNewlines() {
        // `URLComponents` parses an interior newline without complaint (unlike an interior space,
        // which it already rejects on its own), but a raw newline would split the YAML frontmatter
        // line it's written into (escapeYAML doesn't escape newlines) — so this has to be caught
        // explicitly rather than left to the parser.
        #expect(!ContentFieldValidation.isAbsoluteURL("https://example.com/post\nevil: true"))
        #expect(!ContentFieldValidation.isAbsoluteURL("https://exa mple.com"))
    }

    @Test("isAbsoluteURL accepts a value with only leading/trailing whitespace, trimming it away")
    func acceptsSurroundingWhitespace() {
        // A trailing/leading newline or space is not an *interior* character once trimmed, so it's
        // approved here — the caller (NativeContentOperations.createTyped) is responsible for
        // persisting the same trimmed value it validated, not the raw one (#916 follow-up).
        #expect(ContentFieldValidation.isAbsoluteURL("https://example.com/post\n"))
        #expect(ContentFieldValidation.isAbsoluteURL("  https://example.com/post  "))
    }
}
