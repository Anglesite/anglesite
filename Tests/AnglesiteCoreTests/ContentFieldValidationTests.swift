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
}
