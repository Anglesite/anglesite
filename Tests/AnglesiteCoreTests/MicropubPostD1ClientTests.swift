// Tests/AnglesiteCoreTests/MicropubPostD1ClientTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct MicropubPostD1ClientTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    private static func d1Body(_ rowsJSON: String) -> Data {
        Data("""
        {"success": true, "result": [{"success": true, "results": [\(rowsJSON)]}]}
        """.utf8)
    }

    @Test("lists a live post and decodes its mf2 properties")
    func listsLivePost() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello world\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        #expect(post.url == "https://me.example/notes/abc123")
        #expect(post.type == "h-entry")
        #expect(post.deleted == false)
        #expect(post.updatedAt == 1_753_300_000)
        #expect(post.properties["content"] == [.string("Hello world")])
        #expect(post.properties["published"] == [.string("2026-07-24T12:00:00Z")])
    }

    @Test("decodes a nested rich-text content value")
    func decodesRichTextContent() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/articles/hi", "type": "h-entry",
         "properties": "{\\"content\\":[{\\"html\\":\\"<p>Hi</p>\\",\\"value\\":\\"Hi\\"}]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        let contentValues = try #require(post.properties["content"])
        #expect(contentValues.count == 1)
        guard case .object(let obj) = contentValues[0] else {
            Issue.record("expected content[0] to decode as a JSONValue.object")
            return
        }
        #expect(obj["value"] == .string("Hi"))
    }

    @Test("includes soft-deleted rows so the sync bridge can remove their git snapshot")
    func includesSoftDeletedRows() async throws {
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/gone", "type": "h-entry",
         "properties": "{\\"content\\":[\\"bye\\"]}", "deleted": 1, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        let post = try #require(posts.first)
        #expect(post.deleted == true)
    }

    @Test("skips a row whose properties column isn't valid JSON, and logs the skip")
    func skipsMalformedPropertiesRow() async throws {
        // Unique to this test, so the filter below can't pick up another test's entry —
        // `LogCenter.shared` is process-global and Swift Testing runs suites in parallel, so
        // asserting on its total count or its `.last` entry is a race (#977).
        let url = "https://me.example/notes/bad-properties-\(UUID().uuidString)"
        let body = Self.d1Body("""
        {"url": "\(url)", "type": "h-entry",
         "properties": "not json", "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let posts = try await client.listAllPosts()
        #expect(posts.isEmpty)

        // Filter to the entries this call caused, then assert on those — the pattern
        // `BackupCommandInProcessTests` already uses against the same shared log. Filtering on
        // the marker alone (not the source) keeps the source assertion below meaningful.
        let logged = await LogCenter.shared.snapshot().filter { $0.text.contains(url) }
        #expect(logged.count == 1)
        let entry = try #require(logged.last)
        #expect(entry.source == "MicropubPostD1Client")
        #expect(entry.stream == .stderr)
    }

    @Test("throws unauthorized on 401")
    func throwsUnauthorizedOn401() async throws {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "bad-token",
            transport: { _ in (Data(), Self.response(401)) })

        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.listAllPosts()
        }
    }

    @Test("throws http error on a non-2xx, non-auth status")
    func throwsHTTPErrorOnFailureStatus() async throws {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (Data(), Self.response(500)) })

        await #expect(throws: CloudflareError.http(status: 500)) {
            _ = try await client.listAllPosts()
        }
    }

    @Test("sends the query as a POST to the D1 query endpoint for the given account and database")
    func sendsPostToD1QueryEndpoint() async throws {
        let capturedRequest = ActorBox<URLRequest?>(nil)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { request in
                await capturedRequest.set(request)
                return (Self.d1Body(""), Self.response(200))
            })

        _ = try await client.listAllPosts()
        let request = await capturedRequest.get()
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.absoluteString == "https://api.cloudflare.com/client/v4/accounts/acct1/d1/database/db1/query")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer token")
    }
}

private actor ActorBox<Value: Sendable> {
    private var value: Value
    init(_ value: Value) { self.value = value }
    func set(_ newValue: Value) { value = newValue }
    func get() -> Value { value }
}
