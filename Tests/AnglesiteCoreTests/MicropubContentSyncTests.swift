// Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct MicropubContentSyncTests {
    // MARK: - collectionAndSlug

    @Test("collectionAndSlug parses a two-segment collection URL")
    func collectionAndSlugParsesTwoSegments() {
        let result = MicropubContentSync.collectionAndSlug(from: "https://me.example/notes/hello-abc123")
        #expect(result?.collection == "notes")
        #expect(result?.slug == "hello-abc123")
    }

    @Test("collectionAndSlug returns nil for the flat one-segment fallback URL")
    func collectionAndSlugNilForFlatURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "https://me.example/hello-abc123") == nil)
    }

    @Test("collectionAndSlug returns nil for a malformed URL")
    func collectionAndSlugNilForMalformedURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "not a url") == nil)
    }

    // MARK: - plainText

    @Test("plainText reads a bare string value")
    func plainTextReadsBareString() {
        #expect(MicropubContentSync.plainText(from: .string("hello")) == "hello")
    }

    @Test("plainText reads a rich-text object's value key")
    func plainTextReadsRichTextValue() {
        let value = JSONValue.object(["html": .string("<p>hi</p>"), "value": .string("hi")])
        #expect(MicropubContentSync.plainText(from: value) == "hi")
    }

    @Test("plainText returns nil for an unsupported shape")
    func plainTextNilForUnsupportedShape() {
        #expect(MicropubContentSync.plainText(from: .bool(true)) == nil)
        #expect(MicropubContentSync.plainText(from: nil) == nil)
    }

    // MARK: - values(for:properties:)

    @Test("values builds a note's fields from raw mf2 properties")
    func valuesBuildsNoteFields() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello world")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "category": [.string("indieweb"), .string("test")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["body"] == .text("Hello world"))
        #expect(values["tags"] == .list(["indieweb", "test"]))
        guard case .date(let date) = values["publishDate"] else {
            Issue.record("expected publishDate to decode as a date")
            return
        }
        #expect(date?.timeIntervalSince1970 == 1_784_894_400)
    }

    @Test("values derives draft from the post-status extension property, not a raw field")
    func valuesDerivesDraftFromPostStatus() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "post-status": [.string("draft")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(true))
    }

    @Test("values defaults draft to false when post-status is absent (published)")
    func valuesDefaultsDraftToFalse() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(false))
    }

    @Test("values returns nil when a required field has no matching mf2 property")
    func valuesNilWhenRequiredFieldMissing() {
        let note = ContentTypeRegistry.note
        // "body" (e-content, required) is missing.
        let properties: [String: [JSONValue]] = ["published": [.string("2026-07-24T12:00:00Z")]]
        #expect(MicropubContentSync.values(for: note, properties: properties) == nil)
    }

    @Test("values requires all photo values to resolve album's imageArray, or fails")
    func valuesRequiresAlbumImages() {
        let album = ContentTypeRegistry.album
        let properties: [String: [JSONValue]] = [
            "name": [.string("Trip")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        // "images" (u-photo, required imageArray) has no matching values at all.
        #expect(MicropubContentSync.values(for: album, properties: properties) == nil)
    }

    // MARK: - resolve

    @Test("resolve maps a post to its descriptor via the URL's collection segment")
    func resolveMapsPostToDescriptor() throws {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/notes/hello-abc123", type: "h-entry",
            properties: ["content": [.string("Hello")], "published": [.string("2026-07-24T12:00:00Z")]],
            deleted: false, updatedAt: 1_753_300_000)
        let resolved = try #require(MicropubContentSync.resolve(post: post))
        #expect(resolved.collection == "notes")
        #expect(resolved.descriptor.id == "note")
        #expect(resolved.url == post.url)
        #expect(resolved.updatedAt == 1_753_300_000)
    }

    @Test("resolve returns nil for the flat fallback URL (no collection segment)")
    func resolveNilForFlatURL() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/hello-abc123", type: "h-card",
            properties: ["name": [.string("Jane")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }

    @Test("resolve returns nil when the URL's collection has no registered content type")
    func resolveNilForUnknownCollection() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/mystery/abc123", type: "h-entry",
            properties: ["content": [.string("hi")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }
}
