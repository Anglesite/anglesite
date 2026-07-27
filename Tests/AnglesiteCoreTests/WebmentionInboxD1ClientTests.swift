import Testing
import Foundation
@testable import AnglesiteCore

struct WebmentionInboxD1ClientTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    @Test("lists verified mentions with full enrichment fields")
    func listsVerifiedMentionsWithEnrichment() async throws {
        let body = Data("""
        {"success": true, "result": [{"success": true, "results": [
            {"id": "wm-abc123", "source": "https://alice.example/post", "target": "https://me.example/blog/hi",
             "verified_at": 1753300000000, "interaction_type": "reply", "author_name": "Alice",
             "author_url": "https://alice.example", "author_photo": "https://alice.example/photo.jpg",
             "content": "Great post!", "published_at": 1753299000000}
        ]}]}
        """.utf8)

        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let mentions = try await client.listVerifiedMentions()
        #expect(mentions.count == 1)
        let mention = try #require(mentions.first)
        #expect(mention.id == "wm-abc123")
        #expect(mention.source == "https://alice.example/post")
        #expect(mention.target == "https://me.example/blog/hi")
        #expect(mention.verifiedAt == 1_753_300_000_000)
        #expect(mention.interactionType == "reply")
        #expect(mention.authorName == "Alice")
        #expect(mention.authorURL == "https://alice.example")
        #expect(mention.authorPhoto == "https://alice.example/photo.jpg")
        #expect(mention.content == "Great post!")
        #expect(mention.publishedAt == 1_753_299_000_000)
    }

    @Test("decodes rows from a pre-enrichment inbox where the new columns are all null")
    func decodesLegacyRowsWithNullEnrichmentColumns() async throws {
        let body = Data("""
        {"success": true, "result": [{"success": true, "results": [
            {"id": "wm-def456", "source": "https://bob.example/post", "target": "https://me.example/blog/hi",
             "verified_at": 1753300000000, "interaction_type": null, "author_name": null,
             "author_url": null, "author_photo": null, "content": null, "published_at": null}
        ]}]}
        """.utf8)

        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let mentions = try await client.listVerifiedMentions()
        let mention = try #require(mentions.first)
        #expect(mention.id == "wm-def456")
        #expect(mention.interactionType == nil)
        #expect(mention.authorName == nil)
        #expect(mention.content == nil)
        #expect(mention.publishedAt == nil)
    }

    @Test("skips a row with no id and no way to derive one")
    func skipsRowMissingID() async throws {
        let body = Data("""
        {"success": true, "result": [{"success": true, "results": [
            {"id": null, "source": "https://carol.example/post", "target": "https://me.example/blog/hi",
             "verified_at": 1753300000000, "interaction_type": null, "author_name": null,
             "author_url": null, "author_photo": null, "content": null, "published_at": null}
        ]}]}
        """.utf8)

        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (body, Self.response(200)) })

        let mentions = try await client.listVerifiedMentions()
        #expect(mentions.isEmpty)
    }

    @Test("throws unauthorized on 401")
    func throwsUnauthorizedOn401() async throws {
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "bad-token",
            transport: { _ in (Data(), Self.response(401)) })

        await #expect(throws: CloudflareError.unauthorized) {
            _ = try await client.listVerifiedMentions()
        }
    }

    @Test("throws http error on a non-2xx, non-auth status")
    func throwsHTTPErrorOnFailureStatus() async throws {
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { _ in (Data(), Self.response(500)) })

        await #expect(throws: CloudflareError.http(status: 500)) {
            _ = try await client.listVerifiedMentions()
        }
    }

    @Test("sends the query as a POST to the D1 query endpoint for the given account and database")
    func sendsPostToD1QueryEndpoint() async throws {
        let capturedRequest = ActorBox<URLRequest?>(nil)
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token",
            transport: { request in
                await capturedRequest.set(request)
                let body = Data("""
                {"success": true, "result": [{"success": true, "results": []}]}
                """.utf8)
                return (body, Self.response(200))
            })

        _ = try await client.listVerifiedMentions()
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
