import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunityMembershipClient")
struct CommunityMembershipClientTests {
    actor FakeTransport {
        private let status: Int
        private let body: String
        private(set) var requestedURLs: [URL] = []
        private(set) var requestedHeaders: [[String: String]] = []
        private(set) var requestedBodies: [[String: Any]] = []

        init(status: Int = 202, body: String = "{}") {
            self.status = status
            self.body = body
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requestedURLs.append(request.url!)
            requestedHeaders.append(request.allHTTPHeaderFields ?? [:])
            if let bodyData = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
                requestedBodies.append(json)
            }
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: CommunityMembershipClient.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    private static func client(_ fake: FakeTransport) -> CommunityMembershipClient {
        CommunityMembershipClient(
            ownActorURL: URL(string: "https://example.com/users/site")!,
            publishToken: "secret-token",
            transport: fake.transport)
    }

    @Test("POSTs a Follow activity to this site's own outbox")
    func postsFollow() async throws {
        let fake = FakeTransport(status: 202, body: #"{"id":"https://example.com/users/site/outbox/1"}"#)
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        let activityID = try await Self.client(fake).follow(target: target)

        #expect(activityID == "https://example.com/users/site/outbox/1")
        #expect(await fake.requestedURLs.first?.absoluteString == "https://example.com/users/site/outbox")
        let headers = await fake.requestedHeaders.first
        #expect(headers?["Authorization"] == "Bearer secret-token")
        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Follow")
        #expect(body?["object"] as? String == "https://lemmy.ml/c/birding")
        #expect(body?["actor"] as? String == "https://example.com/users/site")
    }

    @Test("falls back to the target URL as the activity id when the response carries none")
    func followWithoutIDInResponse() async throws {
        let fake = FakeTransport(status: 202, body: "{}")
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        let activityID = try await Self.client(fake).follow(target: target)

        #expect(activityID == "https://lemmy.ml/c/birding")
    }

    @Test("POSTs an Undo(Follow) referencing the original activity id")
    func postsUndoWithActivityID() async throws {
        let fake = FakeTransport()
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        try await Self.client(fake).unfollow(
            target: target, followActivityID: "https://example.com/users/site/outbox/1")

        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Undo")
        #expect(body?["object"] as? String == "https://example.com/users/site/outbox/1")
    }

    @Test("synthesizes a nested Follow object for Undo when no activity id is known")
    func postsUndoWithoutActivityID() async throws {
        let fake = FakeTransport()
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))

        try await Self.client(fake).unfollow(target: target, followActivityID: nil)

        let body = await fake.requestedBodies.first
        #expect(body?["type"] as? String == "Undo")
        let nestedFollow = body?["object"] as? [String: Any]
        #expect(nestedFollow?["type"] as? String == "Follow")
        #expect(nestedFollow?["object"] as? String == "https://lemmy.ml/c/birding")
    }

    @Test("maps a non-2xx status to requestFailed")
    func mapsNon2xx() async throws {
        let fake = FakeTransport(status: 403, body: "forbidden")
        let target = try #require(URL(string: "https://lemmy.ml/c/birding"))
        await #expect(throws: CommunityMembershipError.requestFailed(status: 403, body: "forbidden")) {
            _ = try await Self.client(fake).follow(target: target)
        }
    }
}
