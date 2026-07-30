import Testing
import Foundation
@testable import AnglesiteCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunitySearchClient")
struct CommunitySearchClientTests {
    /// Answers each requested URL from a fixed table; unmatched URLs 404. Mirrors
    /// `CommunityActorResolverTests.FakeTransport` — search is a single request, but the same
    /// per-URL routing keeps the fixture URL visible at the call site instead of hidden behind a
    /// single-response stub.
    actor FakeTransport {
        private var responses: [String: (status: Int, body: String)]
        private(set) var requestedURLs: [URL] = []

        init(_ responses: [String: (status: Int, body: String)]) {
            self.responses = responses
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            let url = request.url!
            requestedURLs.append(url)
            let (status, body) = responses[url.absoluteString] ?? (404, "not found")
            let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: CommunitySearchClient.Transport {
            { request in try await self.respond(to: request) }
        }
    }

    private static let searchURL =
        "https://lemmy.world/api/v3/search?q=birding&type_=Communities&listing_type=All&sort=TopAll&limit=20"

    @Test("parses communities, reading instance from the result's own actor_id host")
    func parsesResults() async throws {
        // The instance queried (lemmy.world) differs from where this result actually lives
        // (lemmy.ml) — Lemmy's federated search can surface communities from other instances than
        // the one asked, and `instance` should reflect that, not the query target.
        let fake = FakeTransport([Self.searchURL: (200, """
            {"communities":[
              {"community":{"name":"birding","title":"Birding",
                "actor_id":"https://lemmy.ml/c/birding"},
               "counts":{"subscribers":1234}}
            ]}
            """)])
        let client = CommunitySearchClient(transport: fake.transport)

        let results = try await client.search(query: "birding", instance: "lemmy.world")

        #expect(results.count == 1)
        #expect(results.first?.actorID.absoluteString == "https://lemmy.ml/c/birding")
        #expect(results.first?.name == "birding")
        #expect(results.first?.title == "Birding")
        #expect(results.first?.instance == "lemmy.ml")
        #expect(results.first?.subscriberCount == 1234)
    }

    @Test("builds the search URL with type_=Communities, listing_type=All, and the given query")
    func buildsExpectedURL() async throws {
        let fake = FakeTransport([Self.searchURL: (200, #"{"communities":[]}"#)])
        let client = CommunitySearchClient(transport: fake.transport)

        _ = try await client.search(query: "birding", instance: "lemmy.world")

        let requested = await fake.requestedURLs
        #expect(requested.map(\.absoluteString) == [Self.searchURL])
    }

    @Test("accepts a pasted https:// instance URL, not just a bare host")
    func acceptsPastedInstanceURL() async throws {
        let fake = FakeTransport([Self.searchURL: (200, #"{"communities":[]}"#)])
        let client = CommunitySearchClient(transport: fake.transport)

        _ = try await client.search(query: "birding", instance: "https://lemmy.world/")

        let requested = await fake.requestedURLs
        #expect(requested.map(\.absoluteString) == [Self.searchURL])
    }

    @Test("accepts a bare host:port instance, a self-hosted-instance shape")
    func acceptsBareHostPortInstance() async throws {
        let expectedURL = "https://lemmy.example:8080/api/v3/search"
            + "?q=birding&type_=Communities&listing_type=All&sort=TopAll&limit=20"
        let fake = FakeTransport([expectedURL: (200, #"{"communities":[]}"#)])
        let client = CommunitySearchClient(transport: fake.transport)

        _ = try await client.search(query: "birding", instance: "lemmy.example:8080")

        let requested = await fake.requestedURLs
        #expect(requested.map(\.absoluteString) == [expectedURL])
    }

    @Test("carries the port through from a pasted https:// URL with a non-standard port")
    func carriesPortFromPastedInstanceURL() async throws {
        let expectedURL = "https://lemmy.example:8080/api/v3/search"
            + "?q=birding&type_=Communities&listing_type=All&sort=TopAll&limit=20"
        let fake = FakeTransport([expectedURL: (200, #"{"communities":[]}"#)])
        let client = CommunitySearchClient(transport: fake.transport)

        _ = try await client.search(query: "birding", instance: "https://lemmy.example:8080/")

        let requested = await fake.requestedURLs
        #expect(requested.map(\.absoluteString) == [expectedURL])
    }

    @Test("an empty communities field is an empty result, not an error")
    func emptyResultsList() async throws {
        let fake = FakeTransport([Self.searchURL: (200, #"{"communities":[]}"#)])
        let client = CommunitySearchClient(transport: fake.transport)

        let results = try await client.search(query: "birding", instance: "lemmy.world")

        #expect(results.isEmpty)
    }

    @Test("a missing communities field is also an empty result")
    func missingCommunitiesFieldIsEmpty() async throws {
        let fake = FakeTransport([Self.searchURL: (200, "{}")])
        let client = CommunitySearchClient(transport: fake.transport)

        let results = try await client.search(query: "birding", instance: "lemmy.world")

        #expect(results.isEmpty)
    }

    @Test("drops a result whose own actor_id is insecure rather than failing the whole search")
    func dropsInsecureResult() async throws {
        let fake = FakeTransport([Self.searchURL: (200, """
            {"communities":[
              {"community":{"name":"birding","title":"Birding",
                "actor_id":"http://lemmy.ml/c/birding"}}
            ]}
            """)])
        let client = CommunitySearchClient(transport: fake.transport)

        let results = try await client.search(query: "birding", instance: "lemmy.world")

        #expect(results.isEmpty)
    }

    @Test("throws emptyQuery for a blank query, without making a request")
    func rejectsBlankQuery() async throws {
        let fake = FakeTransport([:])
        let client = CommunitySearchClient(transport: fake.transport)

        await #expect(throws: CommunitySearchError.emptyQuery) {
            _ = try await client.search(query: "   ", instance: "lemmy.world")
        }
        #expect(await fake.requestedURLs.isEmpty)
    }

    @Test("throws invalidInstance for a blank instance")
    func rejectsBlankInstance() async throws {
        let fake = FakeTransport([:])
        let client = CommunitySearchClient(transport: fake.transport)

        await #expect(throws: CommunitySearchError.invalidInstance) {
            _ = try await client.search(query: "birding", instance: "  ")
        }
    }

    @Test("surfaces a non-2xx status as requestFailed")
    func surfacesErrorStatus() async throws {
        let fake = FakeTransport([Self.searchURL: (500, "internal error")])
        let client = CommunitySearchClient(transport: fake.transport)

        await #expect(throws: CommunitySearchError.requestFailed(status: 500, body: "internal error")) {
            _ = try await client.search(query: "birding", instance: "lemmy.world")
        }
    }

    @Test("rejects a redirect to an insecure URL")
    func rejectsInsecureRedirect() async throws {
        actor RedirectingTransport {
            private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
                let insecureURL = URL(string: "http://lemmy.world/api/v3/search")!
                let http = HTTPURLResponse(url: insecureURL, statusCode: 200, httpVersion: nil, headerFields: nil)!
                return (Data(#"{"communities":[]}"#.utf8), http)
            }
            nonisolated var transport: CommunitySearchClient.Transport {
                { request in try await self.respond(to: request) }
            }
        }
        let client = CommunitySearchClient(transport: RedirectingTransport().transport)

        await #expect(throws: CommunitySearchError.insecureURL) {
            _ = try await client.search(query: "birding", instance: "lemmy.world")
        }
    }

    /// Defense-in-depth: `defaultTransport` is already capped via `CappedHTTPTransport`, but a
    /// caller-injected `Transport` (like this test's `FakeTransport`) might not be — mirrors
    /// `CommunityActorResolverTests.rejectsOversizedActorDocument`, including the same
    /// keep-it-valid-JSON padding technique so the failure is provably the size guard, not a
    /// decoding failure that would happen regardless.
    @Test("rejects an oversized search response")
    func rejectsOversizedResponse() async throws {
        let maxBytes = CommunitySearchClient.maximumResponseBytes
        let prefix = #"{"communities":[],"padding":""#
        let suffix = "\"}"
        let paddingLength = maxBytes - prefix.utf8.count - suffix.utf8.count + 1
        let oversizedBody = prefix + String(repeating: "x", count: paddingLength) + suffix
        let byteCount = Data(oversizedBody.utf8).count
        #expect(byteCount > maxBytes)

        let fake = FakeTransport([Self.searchURL: (200, oversizedBody)])
        let client = CommunitySearchClient(transport: fake.transport)

        await #expect(throws: CommunitySearchError.requestFailed(
            status: 0, body: "response too large (\(byteCount) bytes)")) {
            _ = try await client.search(query: "birding", instance: "lemmy.world")
        }
    }
}
