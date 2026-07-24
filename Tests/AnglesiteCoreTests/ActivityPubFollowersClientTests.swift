import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("ActivityPubFollowersClient")
struct ActivityPubFollowersClientTests {
    /// A transport that answers every request with one canned status + body, and records the
    /// URLs it was asked for.
    final class FakeTransport: @unchecked Sendable {
        let status: Int
        let body: String
        private(set) var requestedURLs: [URL] = []

        init(status: Int = 200, body: String) {
            self.status = status
            self.body = body
        }

        var transport: ActivityPubFollowersClient.Transport {
            { [self] request in
                requestedURLs.append(request.url!)
                let http = HTTPURLResponse(
                    url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
                return (Data(body.utf8), http)
            }
        }
    }

    private static func client(_ fake: FakeTransport) throws -> ActivityPubFollowersClient {
        ActivityPubFollowersClient(
            siteURL: try #require(URL(string: "https://example.com")), transport: fake.transport)
    }

    @Test("decodes an OrderedCollection head with a first page link")
    func decodesCollection() async throws {
        let fake = FakeTransport(body: """
        {"@context":"https://www.w3.org/ns/activitystreams",
         "id":"https://example.com/users/site/followers","type":"OrderedCollection",
         "totalItems":42,
         "first":"https://example.com/users/site/followers?page=1",
         "last":"https://example.com/users/site/followers?page=3"}
        """)
        let collection = try await Self.client(fake).collection()

        #expect(collection.totalItems == 42)
        #expect(collection.firstPage?.absoluteString
            == "https://example.com/users/site/followers?page=1")
        #expect(fake.requestedURLs.first?.absoluteString
            == "https://example.com/users/site/followers")
    }

    /// `@dwk/activitypub` omits `first`/`last` entirely when the collection is empty, which is
    /// how the pane detects the genuine empty state without a second request.
    @Test("decodes an empty collection as totalItems 0 with no first page")
    func decodesEmptyCollection() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://example.com/users/site/followers",
         "type":"OrderedCollection","totalItems":0}
        """)
        let collection = try await Self.client(fake).collection()

        #expect(collection.totalItems == 0)
        #expect(collection.firstPage == nil)
    }

    @Test("decodes a page's actor IRIs and its next link")
    func decodesPage() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://example.com/users/site/followers?page=1",
         "type":"OrderedCollectionPage","totalItems":42,
         "orderedItems":["https://mastodon.social/users/alice","https://lemmy.world/u/bob"],
         "next":"https://example.com/users/site/followers?page=2"}
        """)
        let url = try #require(URL(string: "https://example.com/users/site/followers?page=1"))
        let page = try await Self.client(fake).page(at: url)

        #expect(page.items.map(\.absoluteString)
            == ["https://mastodon.social/users/alice", "https://lemmy.world/u/bob"])
        #expect(page.next?.absoluteString == "https://example.com/users/site/followers?page=2")
    }

    @Test("decodes a final page as having no next link")
    func decodesFinalPage() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://example.com/users/site/followers?page=3",
         "type":"OrderedCollectionPage","totalItems":42,
         "orderedItems":["https://mastodon.social/users/zoe"],
         "prev":"https://example.com/users/site/followers?page=2"}
        """)
        let url = try #require(URL(string: "https://example.com/users/site/followers?page=3"))
        let page = try await Self.client(fake).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.next == nil)
    }

    /// 503 is what the composed Worker answers when ActivityPub isn't provisioned; the pane
    /// distinguishes it from 404 (Worker not deployed), so the status must survive.
    @Test("maps a non-2xx status to requestFailed carrying that status")
    func mapsNon2xx() async throws {
        let fake = FakeTransport(status: 503, body: "ActivityPub is not configured")
        await #expect(throws: ActivityPubFollowersError.requestFailed(
            status: 503, body: "ActivityPub is not configured")) {
            _ = try await Self.client(fake).collection()
        }
    }

    @Test("maps a malformed body to decodingFailed")
    func mapsMalformedBody() async throws {
        let fake = FakeTransport(body: "not json at all")
        await #expect(throws: ActivityPubFollowersError.self) {
            _ = try await Self.client(fake).collection()
        }
    }
}
