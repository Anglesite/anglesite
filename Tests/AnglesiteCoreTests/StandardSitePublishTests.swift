import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("Standard.site records")
struct StandardSiteRecordsTests {
    @Test("publication and document records carry the lexicon's $type")
    func recordShape() throws {
        let publication = StandardSitePublicationRecord(
            name: "Owner Site", url: "https://owner.example", description: "A personal site."
        )
        let publicationData = try JSONEncoder().encode(publication)
        let publicationObject = try #require(try JSONSerialization.jsonObject(with: publicationData) as? [String: Any])
        #expect(publicationObject["$type"] as? String == "site.standard.publication")
        #expect(publicationObject["name"] as? String == "Owner Site")
        #expect(publicationObject["url"] as? String == "https://owner.example")
        #expect(publicationObject["description"] as? String == "A personal site.")

        let document = StandardSiteDocumentRecord(
            site: "at://did:plc:owner/site.standard.publication/anglesite-abc",
            title: "Hello", description: "A note.", path: "/notes/hello/",
            publishedAt: "2026-01-01T00:00:00Z", updatedAt: nil, tags: ["a", "b"], textContent: "Body."
        )
        let documentData = try JSONEncoder().encode(document)
        let documentObject = try #require(try JSONSerialization.jsonObject(with: documentData) as? [String: Any])
        #expect(documentObject["$type"] as? String == "site.standard.document")
        #expect(documentObject["site"] as? String == "at://did:plc:owner/site.standard.publication/anglesite-abc")
        #expect(documentObject["title"] as? String == "Hello")
        #expect(documentObject["publishedAt"] as? String == "2026-01-01T00:00:00Z")
        #expect(documentObject["tags"] as? [String] == ["a", "b"])
    }

    @Test("nil optional fields are omitted from the encoded record, not written as null")
    func optionalFieldsOmitted() throws {
        let publication = StandardSitePublicationRecord(name: "Site", url: "https://owner.example", description: nil)
        let data = try JSONEncoder().encode(publication)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["description"] == nil)

        let document = StandardSiteDocumentRecord(
            site: "at://did:plc:owner/site.standard.publication/anglesite-abc",
            title: "Hello", description: nil, path: nil,
            publishedAt: "2026-01-01T00:00:00Z", updatedAt: nil, tags: [], textContent: nil
        )
        let documentData = try JSONEncoder().encode(document)
        let documentObject = try #require(try JSONSerialization.jsonObject(with: documentData) as? [String: Any])
        #expect(documentObject["description"] == nil)
        #expect(documentObject["path"] == nil)
        #expect(documentObject["updatedAt"] == nil)
        #expect(documentObject["textContent"] == nil)
    }

    @Test("title and description are truncated to the lexicon's grapheme limits")
    func truncatesLongText() {
        let longTitle = String(repeating: "T", count: 600)
        let longDescription = String(repeating: "D", count: 3500)
        let publication = StandardSitePublicationRecord(name: longTitle, url: "https://owner.example", description: longDescription)
        #expect(publication.name.count == StandardSiteText.titleGraphemeLimit)
        #expect(publication.description?.count == StandardSiteText.descriptionGraphemeLimit)

        let document = StandardSiteDocumentRecord(
            site: "at://did:plc:owner/site.standard.publication/anglesite-abc",
            title: longTitle, description: longDescription, path: "/notes/hello/",
            publishedAt: "2026-01-01T00:00:00Z", updatedAt: nil, tags: [], textContent: nil
        )
        #expect(document.title.count == StandardSiteText.titleGraphemeLimit)
        #expect(document.description?.count == StandardSiteText.descriptionGraphemeLimit)
    }

    @Test("rkeys are deterministic for the same site/path and differ across sites/paths")
    func rkeyDeterminism() {
        let publicationRkeyA = "anglesite-\(POSSEStableKey.make("site-1"))"
        let publicationRkeyB = "anglesite-\(POSSEStableKey.make("site-1"))"
        #expect(publicationRkeyA == publicationRkeyB)

        let documentRkeyA = "anglesite-\(POSSEStableKey.make("site-1\n/notes/hello/"))"
        let documentRkeyB = "anglesite-\(POSSEStableKey.make("site-1\n/notes/hello/"))"
        #expect(documentRkeyA == documentRkeyB)

        let documentOtherPath = "anglesite-\(POSSEStableKey.make("site-1\n/notes/other/"))"
        #expect(documentRkeyA != documentOtherPath)

        let documentOtherSite = "anglesite-\(POSSEStableKey.make("site-2\n/notes/hello/"))"
        #expect(documentRkeyA != documentOtherSite)
    }
}

@Suite("Standard.site document plan")
struct StandardSiteDocumentPlanTests {
    private let referenceDate = Date(timeIntervalSince1970: 1_782_777_600) // 2026-06-30T00:00:00Z

    @Test("builds an entry per non-draft, non-future post with a derived path")
    func buildsEligibleEntries() throws {
        let root = try writeSiteTree(prefix: "standardsite-plan", [
            "src/content/notes/hello.md": """
            ---
            title: Hello World
            description: A note.
            tags: [a, b]
            publishDate: 2026-06-29
            ---
            Body text.
            """,
            "src/content/notes/draft.md": """
            ---
            draft: true
            ---
            Draft body.
            """,
            "src/content/notes/future-post.md": """
            ---
            publishDate: 2999-01-01
            ---
            Future body.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = StandardSiteDocumentPlan.build(projectRoot: root, referenceDate: referenceDate)
        #expect(plan.entries.count == 1)
        let entry = try #require(plan.entries.first)
        #expect(entry.path == "/notes/hello/")
        #expect(entry.title == "Hello World")
        #expect(entry.description == "A note.")
        #expect(entry.tags == ["a", "b"])
        #expect(entry.textContent.contains("Body text."))
    }

    @Test("falls back to a de-hyphenated slug title when frontmatter has none")
    func fallbackTitle() throws {
        let root = try writeSiteTree(prefix: "standardsite-plan", [
            "src/content/notes/no-title-post.md": """
            ---
            publishDate: 2026-06-29
            ---
            No title here.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = StandardSiteDocumentPlan.build(projectRoot: root, referenceDate: referenceDate)
        let entry = try #require(plan.entries.first)
        #expect(entry.title == "no title post")
    }

    @Test("an explicit slug frontmatter override wins over the filename-derived slug")
    func slugOverride() throws {
        let root = try writeSiteTree(prefix: "standardsite-plan", [
            "src/content/notes/hello.md": """
            ---
            slug: custom-slug
            publishDate: 2026-06-29
            ---
            Body.
            """,
        ])
        defer { try? FileManager.default.removeItem(at: root) }

        let plan = StandardSiteDocumentPlan.build(projectRoot: root, referenceDate: referenceDate)
        let entry = try #require(plan.entries.first)
        #expect(entry.path == "/notes/custom-slug/")
    }
}

@Suite("Standard.site publish pass")
struct StandardSitePublishCommandTests {
    private actor APIStub {
        var requests: [URLRequest] = []
        let did: String

        init(did: String = "did:plc:owner") { self.did = did }

        func respond(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requests.append(request)
            let url = request.url ?? URL(string: "https://invalid.example")!
            let path = url.path
            let json: String
            switch path {
            case "/xrpc/com.atproto.server.createSession":
                json = #"{"accessJwt":"jwt","did":"\#(did)"}"#
            case "/xrpc/com.atproto.repo.putRecord":
                let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
                let collection = body?["collection"] as? String ?? "unknown"
                let rkey = body?["rkey"] as? String ?? "unknown"
                json = #"{"uri":"at://\#(did)/\#(collection)/\#(rkey)","cid":"bafycid"}"#
            default:
                json = "{}"
            }
            guard let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            ) else { throw URLError(.badServerResponse) }
            return (Data(json.utf8), response)
        }

        func count(path: String) -> Int { requests.count { $0.url?.path == path } }
        func bodies(path: String) -> [[String: Any]] {
            var results: [[String: Any]] = []
            for request in requests where request.url?.path == path {
                guard let data = request.httpBody else { continue }
                guard let parsed = try? JSONSerialization.jsonObject(with: data) else { continue }
                guard let dict = parsed as? [String: Any] else { continue }
                results.append(dict)
            }
            return results
        }
    }

    private var credentials: POSSECredentials {
        POSSECredentials(bluesky: .init(pdsURL: URL(string: "https://pds.example")!, identifier: "owner.test", appPassword: "secret-b"))
    }

    private func makeSite(siteURL: String? = "https://owner.example") throws -> (root: URL, source: URL, config: URL) {
        var files = [
            "Source/src/content/notes/hello.md": """
            ---
            title: Hello world
            description: A short update from my own site.
            tags: [swift, atproto]
            publishDate: 2026-01-01
            ---
            Full body text.
            """,
        ]
        if let siteURL {
            files["Source/.site-config"] = "SITE_NAME=Owner Site\nSITE_URL=\(siteURL)\n"
        }
        let root = try writeSiteTree(prefix: "standardsite-command", files)
        return (root, root.appendingPathComponent("Source"), root.appendingPathComponent("Config"))
    }

    @Test("no-ops without a Bluesky credential")
    func noopWithoutCredential() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in POSSECredentials() },
            transport: { try await stub.respond($0) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 0)
        #expect(StandardSitePublishLog.load(from: site.config) == nil)
    }

    @Test("no-ops when SITE_URL is absent (never deployed / still the scaffold default)")
    func noopWithoutRealSiteURL() async throws {
        let site = try makeSite(siteURL: nil)
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 0)
    }

    @Test("publishes the publication once, one document per post, ledgers entries, and persists ATPROTO_DID")
    func endToEndPublish() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: LogCenter(),
            now: { Date(timeIntervalSince1970: 1_782_777_600) } // 2026-06-30T00:00:00Z — after the fixture's publishDate
        )

        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)

        // One session for the whole run — the publication write and every document write reuse
        // it, rather than logging into the PDS fresh for each of the two record writes.
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 1)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.putRecord") == 2)
        let publicationBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").first)
        #expect(publicationBody["collection"] as? String == "site.standard.publication")
        #expect(publicationBody["rkey"] as? String == "anglesite-\(POSSEStableKey.make("site-1"))")

        let ledger = try #require(StandardSitePublishLog.load(from: site.config))
        #expect(ledger.entries.count == 1)
        #expect(ledger.entries.first?.path == "/notes/hello/")
        #expect(ledger.publicationURI == "at://did:plc:owner/site.standard.publication/anglesite-\(POSSEStableKey.make("site-1"))")

        let config = try String(contentsOf: site.source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "ATPROTO_DID", in: config) == "did:plc:owner")

        // Re-run: putRecord's create-or-update semantics make a repeat pass idempotent — same
        // rkeys, same resulting ledger, no error — even though every eligible post is re-put.
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.putRecord") == 4)
        let ledgerAfter = try #require(StandardSitePublishLog.load(from: site.config))
        #expect(ledgerAfter.entries.count == 1)
        #expect(ledgerAfter.entries.first?.uri == ledger.entries.first?.uri)
    }
}
