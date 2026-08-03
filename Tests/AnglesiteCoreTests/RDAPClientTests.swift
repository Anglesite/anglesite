import Testing
import Foundation
@testable import AnglesiteCore

/// Routes each request to a canned status/body keyed by exact URL string, so `RDAPClient`'s
/// two-hop fetch (bootstrap registry, then the domain-specific RDAP server) can be exercised
/// without a real network call. Unlike `WorkerCatalogStubURLProtocol` (which returns one fixed
/// response for every request), `RDAPClient` makes two *different* requests per lookup, so the
/// stub needs to distinguish them.
private final class RDAPStubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Stub { let statusCode: Int; let body: String }
    nonisolated(unsafe) static var responses: [String: Stub] = [:]
    nonisolated(unsafe) static var failingURLs: Set<String> = []
    /// Every URL actually requested through this protocol, in request order — lets tests prove a
    /// fetch was *skipped* entirely (e.g. the bootstrap-cache TTL short-circuit), not just that it
    /// happened to return the right answer.
    nonisolated(unsafe) static var requestedURLs: [String] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = request.url?.absoluteString ?? ""
        Self.requestedURLs.append(key)
        if Self.failingURLs.contains(key) {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        guard let stub = Self.responses[key] else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        responses = [:]
        failingURLs = []
        requestedURLs = []
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RDAPStubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

// .serialized: tests share RDAPStubURLProtocol's mutable static response table, which would race
// under Swift Testing's default parallel execution.
@Suite(.serialized) struct RDAPClientTests {
    private let bootstrapURL = URL(string: "https://example.invalid/rdap/dns.json")!
    private let domainURL = "https://example.invalid/rdap-com/domain/example.com"

    private let bootstrapJSON = """
    {"services":[[["com","net"],["https://example.invalid/rdap-com/"]],[["org"],["https://example.invalid/rdap-org/"]]]}
    """
    private let domainJSON = """
    {
      "events":[
        {"eventAction":"registration","eventDate":"1995-08-14T04:00:00Z"},
        {"eventAction":"expiration","eventDate":"2027-08-13T04:00:00Z"}
      ],
      "entities":[
        {"roles":["registrar"],"vcardArray":["vcard",[["version",{},"text","4.0"],["fn",{},"text","Example Registrar, LLC"]]]}
      ]
    }
    """

    private func tempCacheURL() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("rdap-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("rdap-bootstrap-cache.json")
    }

    @Test("looks up registrar and expiration for a known TLD")
    func looksUpRegistrarAndExpiration() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "Example.com")

        #expect(info?.registrar == "Example Registrar, LLC")
        #expect(info?.expiresAt == "2027-08-13T04:00:00Z")
    }

    @Test("returns nil for a TLD absent from the bootstrap registry")
    func returnsNilForUnknownTLD() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.zzz")

        #expect(info == nil)
    }

    @Test("returns nil when the domain lookup responds with a non-2xx status")
    func returnsNilOnBadDomainStatus() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 404, body: "not found")
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("falls back to the cached bootstrap registry when the live fetch fails")
    func fallsBackToCachedBootstrapOnFetchFailure() async throws {
        RDAPStubURLProtocol.reset()
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(bootstrapJSON.utf8).write(to: cacheURL)

        RDAPStubURLProtocol.failingURLs = [bootstrapURL.absoluteString]
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info?.registrar == "Example Registrar, LLC")
    }

    @Test("returns nil when the bootstrap fetch fails and there is no cache")
    func returnsNilWhenNoCacheAndFetchFails() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.failingURLs = [bootstrapURL.absoluteString]
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("caches the bootstrap registry to disk on a successful fetch")
    func cachesBootstrapOnSuccess() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        _ = await client.lookup(hostname: "example.com")

        #expect(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    @Test("returns nil when the domain response has neither a registrar nor an expiration date")
    func returnsNilWhenNoUsefulData() async throws {
        RDAPStubURLProtocol.reset()
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: bootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: "{}")
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info == nil)
    }

    @Test("productionBootstrapURL points at IANA's RDAP bootstrap registry")
    func productionBootstrapURLIsIANA() {
        #expect(RDAPClient.productionBootstrapURL == URL(string: "https://data.iana.org/rdap/dns.json")!)
    }

    /// #1194 review round 3, finding 6: a fresh (<24h old) cached bootstrap registry must be used
    /// directly, with no network fetch at all — not merely "the fetch fails over to the same
    /// cache and produces the right answer," which the pre-fix always-fetch-first implementation
    /// already did. `RDAPStubURLProtocol.requestedURLs` distinguishes the two.
    @Test("skips the bootstrap network fetch entirely when the cache is fresh")
    func skipsNetworkFetchWhenBootstrapCacheIsFresh() async throws {
        RDAPStubURLProtocol.reset()
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(bootstrapJSON.utf8).write(to: cacheURL)
        // Deliberately no stub registered for bootstrapURL — if the client attempted the fetch
        // anyway, it would hit the protocol's "no stub" branch (a hard failure), not silently
        // succeed, so this test would fail loudly rather than passing by accident.
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        #expect(info?.registrar == "Example Registrar, LLC")
        #expect(!RDAPStubURLProtocol.requestedURLs.contains(bootstrapURL.absoluteString))
    }

    /// #1194 review round 3, bundled trivial fix: RFC 9224 says https SHOULD be preferred, and some
    /// TLDs list `http://` first — App Transport Security would block that and silently produce a
    /// `nil` lookup. This bootstrap entry deliberately lists `http://` first to prove the https
    /// entry is chosen instead.
    @Test("prefers an https RDAP server URL over an http one for the same TLD")
    func prefersHTTPSRDAPServerURL() async throws {
        RDAPStubURLProtocol.reset()
        let httpFirstBootstrapJSON = """
        {"services":[[["com"],["http://insecure.example.invalid/rdap-com/","https://example.invalid/rdap-com/"]]]}
        """
        RDAPStubURLProtocol.responses[bootstrapURL.absoluteString] = .init(statusCode: 200, body: httpFirstBootstrapJSON)
        RDAPStubURLProtocol.responses[domainURL] = .init(statusCode: 200, body: domainJSON)
        let cacheURL = tempCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL.deletingLastPathComponent()) }

        let client = RDAPClient(bootstrapURL: bootstrapURL, cacheURL: cacheURL, session: RDAPStubURLProtocol.makeSession())
        let info = await client.lookup(hostname: "example.com")

        // If the client had used the http:// URL listed first, it would have requested an
        // unstubbed domain endpoint under insecure.example.invalid and gotten nil back instead.
        #expect(info?.registrar == "Example Registrar, LLC")
    }
}
