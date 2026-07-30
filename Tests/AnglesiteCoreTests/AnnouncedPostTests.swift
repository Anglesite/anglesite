// Tests/AnglesiteCoreTests/AnnouncedPostTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("AnnouncedPost")
struct AnnouncedPostTests {
    @Test("round-trips through JSON encoding")
    func jsonRoundTrip() throws {
        let post = try AnnouncedPost(
            id: "ap-abc123",
            objectType: .note,
            sourceURL: URL(string: "https://member.example/posts/42")!,
            author: AnnouncedPost.Author(
                name: "Jane Doe",
                url: URL(string: "https://member.example"),
                photo: URL(string: "https://member.example/photo.jpg")
            ),
            content: "Hello, community!",
            published: ISO8601DateFormatter().date(from: "2026-06-28T14:30:00Z")!,
            announcedAt: ISO8601DateFormatter().date(from: "2026-06-28T14:30:05Z")!
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(post)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(AnnouncedPost.self, from: data)
        #expect(decoded == post)
    }

    @Test("gitPath produces the expected file path")
    func gitPath() throws {
        let post = try AnnouncedPost(
            id: "ap-abc123",
            objectType: .note,
            sourceURL: URL(string: "https://member.example/posts/42")!,
            author: nil,
            content: nil,
            published: Date(),
            announcedAt: Date()
        )
        #expect(post.gitPath == "data/community-posts/ap-abc123.json")
    }

    @Test("rejects IDs containing path-traversal sequences")
    func rejectsPathTraversal() {
        #expect(throws: AnnouncedPost.ValidationError.self) {
            try AnnouncedPost(
                id: "../../etc/passwd",
                objectType: .note,
                sourceURL: URL(string: "https://member.example/posts/42")!,
                author: nil,
                content: nil,
                published: Date(),
                announcedAt: Date()
            )
        }
    }

    @Test("author and content are optional")
    func optionalFields() throws {
        let post = try AnnouncedPost(
            id: "ap-abc123",
            objectType: .article,
            sourceURL: URL(string: "https://member.example/posts/42")!,
            author: nil,
            content: nil,
            published: Date(),
            announcedAt: Date()
        )
        #expect(post.author == nil)
        #expect(post.content == nil)
    }

    @Test("every AS2 object type round-trips")
    func objectTypeCoverage() throws {
        for objectType: AnnouncedPost.ObjectType in [.note, .article, .page, .video, .event] {
            let post = try AnnouncedPost(
                id: "ap-\(objectType.rawValue)",
                objectType: objectType,
                sourceURL: URL(string: "https://member.example/posts/42")!,
                author: nil,
                content: nil,
                published: Date(),
                announcedAt: Date()
            )
            #expect(post.objectType == objectType)
        }
    }
}
