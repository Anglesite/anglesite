// Tests/AnglesiteCoreTests/GroupTimelineClientTests.swift
import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("GroupTimelineClient")
struct GroupTimelineClientTests {
    actor FakeTransport {
        private let status: Int
        private let body: String
        private(set) var requestedURLs: [URL] = []

        init(status: Int = 200, body: String) {
            self.status = status
            self.body = body
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requestedURLs.append(request.url!)
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: GroupTimelineClient.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    @Test("reads the outbox collection head")
    func readsCollectionHead() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox","type":"OrderedCollection","totalItems":2,
         "first":"https://lemmy.ml/c/birding/outbox?page=1"}
        """)
        let outboxURL = try #require(URL(string: "https://lemmy.ml/c/birding/outbox"))
        let result = try await GroupTimelineClient(transport: fake.transport).collection(at: outboxURL)

        #expect(result.totalItems == 2)
        #expect(result.firstPage?.absoluteString == "https://lemmy.ml/c/birding/outbox?page=1")
    }

    @Test("decodes a page of Create-wrapped Note activities into GroupPosts")
    func decodesCreateWrappedPage() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
         "orderedItems":[
           {"id":"https://lemmy.ml/activities/1","type":"Create",
            "object":{"id":"https://lemmy.ml/post/1","type":"Page","name":"Osprey sighting",
                      "content":"<p>Saw one today</p>","url":"https://lemmy.ml/post/1",
                      "published":"2026-07-20T12:00:00Z",
                      "attributedTo":"https://lemmy.ml/u/alice"}}
         ],
         "next":"https://lemmy.ml/c/birding/outbox?page=2"}
        """)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox?page=1"))
        let page = try await GroupTimelineClient(transport: fake.transport).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.items[0].id == "https://lemmy.ml/post/1")
        #expect(page.items[0].title == "Osprey sighting")
        #expect(page.items[0].contentHTML == "<p>Saw one today</p>")
        #expect(page.items[0].url?.absoluteString == "https://lemmy.ml/post/1")
        #expect(page.next?.absoluteString == "https://lemmy.ml/c/birding/outbox?page=2")
    }

    /// `content` is exactly as attacker-controlled as `name`/`attributedTo` (the remote Group's
    /// own server writes it) and `CommunitiesView` falls back to rendering it verbatim
    /// (`post.title ?? post.contentHTML ?? post.id`), so it needs the same
    /// `DisplayString.safe` bidi/control-scalar stripping `title`/`authorName` already get right
    /// next to it — otherwise a hostile post with no `name` can smuggle a
    /// U+202E RIGHT-TO-LEFT OVERRIDE (or similar) into the timeline row to visually spoof it.
    @Test("strips bidi-control scalars from contentHTML, matching title/authorName")
    func sanitizesContentHTML() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
         "orderedItems":[
           {"id":"https://lemmy.ml/activities/3","type":"Create",
            "object":{"id":"https://lemmy.ml/post/3","type":"Note",
                      "content":"safe\\u202Eevil"}}
         ]}
        """)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox?page=1"))
        let page = try await GroupTimelineClient(transport: fake.transport).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.items[0].contentHTML == "safeevil")
    }

    @Test("falls back to a bare-id stub for an item with no embedded object")
    func decodesBareIDItem() async throws {
        let fake = FakeTransport(body: """
        {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
         "orderedItems":["https://lemmy.ml/activities/2"]}
        """)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox?page=1"))
        let page = try await GroupTimelineClient(transport: fake.transport).page(at: url)

        #expect(page.items.count == 1)
        #expect(page.items[0].id == "https://lemmy.ml/activities/2")
        #expect(page.items[0].title == nil)
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let fake = FakeTransport(status: 404, body: "not found")
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox"))
        await #expect(throws: GroupTimelineError.requestFailed(status: 404, body: "not found")) {
            _ = try await GroupTimelineClient(transport: fake.transport).collection(at: url)
        }
    }

    /// The outbox belongs to an arbitrary remote Group, the same trust level as a follower's
    /// actor document (`ActorProfileFetcher`) — this guard is load-bearing, not decorative.
    @Test("rejects a plain http outbox URL")
    func rejectsInsecureURL() async throws {
        let fake = FakeTransport(body: "{}")
        let url = try #require(URL(string: "http://lemmy.ml/c/birding/outbox"))
        await #expect(throws: GroupTimelineError.insecureURL) {
            _ = try await GroupTimelineClient(transport: fake.transport).collection(at: url)
        }
    }

    @Test("rejects an oversized response body")
    func rejectsOversizedBody() async throws {
        let maxBytes = GroupTimelineClient.maximumResponseBytes
        // Build oversized valid JSON: {"padding":"xxxx..."}
        // Overhead: {"padding":""} = 14 bytes, so padding needs maxBytes - 13 to total maxBytes + 1
        let paddingLength = maxBytes - 13
        let oversizedBody = "{\"padding\":\"\(String(repeating: "x", count: paddingLength))\"}"

        let bodyBytes = Data(oversizedBody.utf8)
        let byteCount = bodyBytes.count
        // Confirm it's actually oversized
        #expect(byteCount > maxBytes)

        let fake = FakeTransport(body: oversizedBody)
        let url = try #require(URL(string: "https://lemmy.ml/c/birding/outbox"))

        await #expect(throws: GroupTimelineError.requestFailed(status: 0, body: "response too large (\(byteCount) bytes)")) {
            _ = try await GroupTimelineClient(transport: fake.transport).collection(at: url)
        }
    }
}
