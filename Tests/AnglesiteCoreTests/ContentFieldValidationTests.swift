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
}
