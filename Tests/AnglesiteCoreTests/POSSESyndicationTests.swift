import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("POSSE syndication")
struct POSSESyndicationTests {
    private actor APIStub {
        var requests: [URLRequest] = []

        func respond(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requests.append(request)
            let url = request.url ?? URL(string: "https://invalid.example")!
            let path = url.path
            let status: Int
            let json: String
            switch path {
            case "/api/v1/statuses":
                status = 200
                json = #"{"url":"https://mastodon.example/@owner/123"}"#
            case "/xrpc/com.atproto.server.createSession":
                status = 200
                json = #"{"accessJwt":"jwt","did":"did:plc:owner","handle":"owner.test"}"#
            case "/xrpc/com.atproto.repo.createRecord":
                status = 200
                json = #"{"uri":"at://did:plc:owner/app.bsky.feed.post/record123"}"#
            default:
                // Existing ledger entries try standard Webmention discovery on the next deploy.
                status = 200
                json = "<html><body>No endpoint</body></html>"
            }
            guard let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": path.hasPrefix("/xrpc/") ? "application/json" : "text/html"]
            ) else { throw URLError(.badServerResponse) }
            return (Data(json.utf8), response)
        }

        func count(path: String, method: String = "POST") -> Int {
            requests.count { $0.url?.path == path && $0.httpMethod == method }
        }

        func first(path: String) -> URLRequest? { requests.first { $0.url?.path == path } }
    }

    private func makeSite() throws -> (root: URL, source: URL, config: URL, file: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("posse-\(UUID().uuidString)", isDirectory: true)
        let source = root.appendingPathComponent("Source", isDirectory: true)
        let config = root.appendingPathComponent("Config", isDirectory: true)
        let file = source.appendingPathComponent("src/content/notes/hello.md")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try Data("""
        ---
        title: Hello world
        description: A short update from my own site.
        posse: [mastodon, bluesky]
        ---
        Full body.
        """.utf8).write(to: file)
        return (root, source, config, file)
    }

    private var credentials: POSSECredentials {
        POSSECredentials(
            mastodon: .init(baseURL: URL(string: "https://mastodon.example")!, accessToken: "secret-m"),
            bluesky: .init(pdsURL: URL(string: "https://pds.example")!, identifier: "owner.test", appPassword: "secret-b")
        )
    }

    @Test("post text preserves the canonical URL within platform limits")
    func boundedText() {
        let post = POSSEPost(
            title: String(repeating: "T", count: 200),
            summary: String(repeating: "S", count: 500),
            canonicalURL: URL(string: "https://example.com/notes/hello/")!
        )
        let text = post.text(limit: 300)
        #expect(text.count <= 300)
        #expect(text.hasSuffix("https://example.com/notes/hello/"))
        #expect(text.contains("…"))
    }

    @Test("Mastodon request carries form copy, bearer auth, and an idempotency key")
    func mastodonRequest() async throws {
        let stub = APIStub()
        let post = POSSEPost(title: "Hello", summary: "Summary", canonicalURL: URL(string: "https://example.com/notes/hello/")!)
        let url = try await MastodonPOSSEClient.post(
            post,
            credentials: credentials.mastodon!,
            idempotencyKey: "anglesite-stable",
            transport: { request in try await stub.respond(request) }
        )
        #expect(url.absoluteString == "https://mastodon.example/@owner/123")
        let request = await stub.first(path: "/api/v1/statuses")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer secret-m")
        #expect(request?.value(forHTTPHeaderField: "Idempotency-Key") == "anglesite-stable")
        let body = request?.httpBody.flatMap { String(data: $0, encoding: .utf8) }
        #expect(body?.contains("status=") == true)
        #expect(body?.contains("secret-m") == false)
    }

    @Test("Bluesky creates a session and a deterministic rich-text post record")
    func blueskyRequest() async throws {
        let stub = APIStub()
        let canonical = URL(string: "https://example.com/notes/hello/")!
        let post = POSSEPost(title: "Hello", summary: "Summary", canonicalURL: canonical)
        let url = try await BlueskyPOSSEClient.post(
            post,
            credentials: credentials.bluesky!,
            recordKey: "anglesite-stable",
            now: Date(timeIntervalSince1970: 1_700_000_000),
            transport: { request in try await stub.respond(request) }
        )
        #expect(url.absoluteString == "https://bsky.app/profile/owner.test/post/record123")
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 1)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.createRecord") == 1)
        let request = await stub.first(path: "/xrpc/com.atproto.repo.createRecord")
        let body = try #require(request?.httpBody)
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(object["rkey"] as? String == "anglesite-stable")
        let record = try #require(object["record"] as? [String: Any])
        #expect(record["$type"] as? String == "app.bsky.feed.post")
        #expect((record["text"] as? String)?.hasSuffix(canonical.absoluteString) == true)
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer jwt")
    }

    @Test("command posts once, writes both u-syndication URLs, and repairs source from its ledger")
    func commandEndToEndAndIdempotency() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let command = POSSESyndicationCommand(
            credentials: { _, _ in credentials },
            transport: { request in try await stub.respond(request) },
            logCenter: LogCenter(),
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )

        await command.syndicate(
            siteID: "site-1", siteDirectory: site.source, configDirectory: site.config,
            siteBase: URL(string: "https://example.com")!
        )

        var source = try String(contentsOf: site.file, encoding: .utf8)
        #expect(source.contains("syndication:"))
        #expect(source.contains("https://mastodon.example/@owner/123"))
        #expect(source.contains("https://bsky.app/profile/owner.test/post/record123"))
        #expect(POSSESyndicationLog.load(from: site.config)?.entries.count == 2)
        #expect(await stub.count(path: "/api/v1/statuses") == 1)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.createRecord") == 1)

        // Simulate source write-back being lost after remote success. The next pass must repair it
        // from Config without making another social API post.
        source = source.components(separatedBy: "\n").filter {
            !$0.contains("posse:") && !$0.contains("syndication:")
                && !$0.contains("mastodon.example") && !$0.contains("bsky.app/profile")
        }.joined(separator: "\n")
        try Data(source.utf8).write(to: site.file)

        await command.syndicate(
            siteID: "site-1", siteDirectory: site.source, configDirectory: site.config,
            siteBase: URL(string: "https://example.com")!
        )
        let repaired = try String(contentsOf: site.file, encoding: .utf8)
        #expect(repaired.contains("https://mastodon.example/@owner/123"))
        #expect(repaired.contains("https://bsky.app/profile/owner.test/post/record123"))
        #expect(await stub.count(path: "/api/v1/statuses") == 1)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.createRecord") == 1)
        #expect(await command.activeSiteCount == 0)
    }

    @Test("template accepts POSSE metadata and projects returned URLs as u-syndication")
    func templateContract() throws {
        let root = try templateRoot().appendingPathComponent("src", isDirectory: true)
        let config = try String(contentsOf: root.appendingPathComponent("content.config.ts"), encoding: .utf8)
        let contentSchemas = try String(
            contentsOf: root.appendingPathComponent("lib/content-schemas.ts"), encoding: .utf8)
        let links = try String(
            contentsOf: root.appendingPathComponent("components/SyndicationLinks.astro"), encoding: .utf8)
        // `socialFields` (and its `syndication` field) moved into lib/content-schemas.ts (#369) so
        // it's unit-testable outside Astro's `astro:content` virtual module; every collection that
        // spreads `...socialFields,` still does, just split across the two files now.
        #expect(contentSchemas.contains("const socialFields"))
        let spreadCount = [config, contentSchemas]
            .map { $0.components(separatedBy: "...socialFields,").count - 1 }
            .reduce(0, +)
        #expect(spreadCount == 12)
        #expect(contentSchemas.contains("syndication: z.array(z.string().url()).optional()"))
        #expect(links.contains("class=\"u-syndication\""))
        #expect(links.contains("rel=\"syndication\""))
    }
}
