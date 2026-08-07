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

        let longTag = String(repeating: "G", count: 200)
        let document = StandardSiteDocumentRecord(
            site: "at://did:plc:owner/site.standard.publication/anglesite-abc",
            title: longTitle, description: longDescription, path: "/notes/hello/",
            publishedAt: "2026-01-01T00:00:00Z", updatedAt: nil, tags: [longTag, "short"], textContent: nil
        )
        #expect(document.title.count == StandardSiteText.titleGraphemeLimit)
        #expect(document.description?.count == StandardSiteText.descriptionGraphemeLimit)
        #expect(document.tags[0].count == StandardSiteText.tagGraphemeLimit)
        #expect(document.tags[1] == "short")
    }

    @Test("fnv1a matches the TypeScript port's fixture (standard-site.test.ts)")
    func fnv1aFixture() {
        // Cross-checked against `Resources/Template/scripts/standard-site.test.ts`'s
        // "fnv1a matches the Swift POSSEStableKey.make fixture" test — the same four
        // inputs/outputs appear literally in both files. If the TS port ever drifts from this
        // implementation, one suite starts failing while the fixture in the other stays put,
        // which is the signal to compare them side by side.
        #expect(POSSEStableKey.make("") == "cbf29ce484222325")
        #expect(POSSEStableKey.make("a") == "af63dc4c8601ec8c")
        #expect(POSSEStableKey.make("11111111-2222-3333-4444-555555555555") == "5ff56bf05c1d58f9")
        #expect(
            POSSEStableKey.make("11111111-2222-3333-4444-555555555555\n/blog/hello-world/") == "2da1b8cd0c953401"
        )
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
        /// `getRecord` response for every rkey by default; `nil` means every lookup 404s (no
        /// Bluesky cross-post found yet) — the common case for most tests.
        var getRecordResponse: (uri: String, cid: String)?
        var uploadBlobResponse: (cid: String, mimeType: String, size: Int) = (cid: "bafyblob", mimeType: "image/png", size: 100)
        var deleteRecordStatus: Int = 200

        init(did: String = "did:plc:owner") { self.did = did }

        func respond(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
            requests.append(request)
            let url = request.url ?? URL(string: "https://invalid.example")!
            let path = url.path
            switch path {
            case "/xrpc/com.atproto.server.createSession":
                return json(#"{"accessJwt":"jwt","did":"\#(did)"}"#, url: url)
            case "/xrpc/com.atproto.repo.putRecord":
                let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
                let collection = body?["collection"] as? String ?? "unknown"
                let rkey = body?["rkey"] as? String ?? "unknown"
                return json(#"{"uri":"at://\#(did)/\#(collection)/\#(rkey)","cid":"bafycid"}"#, url: url)
            case "/xrpc/com.atproto.repo.getRecord":
                guard let getRecordResponse else { return json("{}", url: url, statusCode: 404) }
                return json(#"{"uri":"\#(getRecordResponse.uri)","cid":"\#(getRecordResponse.cid)"}"#, url: url)
            case "/xrpc/com.atproto.repo.deleteRecord":
                return json("{}", url: url, statusCode: deleteRecordStatus)
            case "/xrpc/com.atproto.repo.uploadBlob":
                let blob = uploadBlobResponse
                return json(
                    #"{"blob":{"$type":"blob","ref":{"$link":"\#(blob.cid)"},"mimeType":"\#(blob.mimeType)","size":\#(blob.size)}}"#,
                    url: url
                )
            default:
                return json("{}", url: url)
            }
        }

        private func json(_ body: String, url: URL, statusCode: Int = 200) -> (Data, HTTPURLResponse) {
            let response = HTTPURLResponse(
                url: url, statusCode: statusCode, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (Data(body.utf8), response)
        }

        func set(getRecordResponse: (uri: String, cid: String)?) { self.getRecordResponse = getRecordResponse }

        func count(path: String) -> Int { requests.count { $0.url?.path == path } }
        func requests(path: String) -> [URLRequest] { requests.filter { $0.url?.path == path } }
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

    @Test("skips and logs when disabled in Site Settings (#1233)")
    func skipsWhenDisabledInSettings() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        try await SiteConfigStore(configDirectory: site.config).save(SiteSettings(publishToAtmosphere: false))
        let stub = APIStub()
        let logCenter = LogCenter()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: logCenter
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 0)
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("skipped") && $0.text.contains("off in Site Settings") })
    }

    @Test("publishes when the setting is unset, matching the design's default-on-when-connected call")
    func publishesWhenSettingUnset() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        // No settings.plist written at all — `publishToAtmosphere` is `nil`, which must still
        // publish since a Bluesky credential is configured.
        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.server.createSession") == 1)
    }

    @Test("publishes the publication once, one document per post, ledgers entries, and persists ATPROTO_DID")
    func endToEndPublish() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let logCenter = LogCenter()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: logCenter,
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
        // Persisted alongside the DID: increment 2's template generators re-derive rkeys at build
        // time with no network, and that derivation is keyed on siteID, not just the DID.
        #expect(SiteConfigFile.value(forKey: "ATPROTO_SITE_ID", in: config) == "site-1")

        // First pass: the one document is new, so the debug-pane summary (#1233) reports it
        // published, not updated.
        let firstPassLines = await logCenter.snapshot()
        #expect(firstPassLines.contains { $0.text.contains("published /notes/hello/ as") })
        #expect(firstPassLines.contains { $0.text.contains("done — published 1, updated 0, unpublished 0, failed 0") })

        // Re-run: putRecord's create-or-update semantics make a repeat pass idempotent — same
        // rkeys, same resulting ledger, no error — even though every eligible post is re-put.
        // The ledger already has this path, so the summary now reports it updated, not published.
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        #expect(await stub.count(path: "/xrpc/com.atproto.repo.putRecord") == 4)
        let ledgerAfter = try #require(StandardSitePublishLog.load(from: site.config))
        #expect(ledgerAfter.entries.count == 1)
        #expect(ledgerAfter.entries.first?.uri == ledger.entries.first?.uri)
        let secondPassLines = await logCenter.snapshot()
        #expect(secondPassLines.contains { $0.text.contains("updated /notes/hello/ as") })
        #expect(secondPassLines.contains { $0.text.contains("done — published 0, updated 1, unpublished 0, failed 0") })
    }

    // MARK: - v1.1 (#1234): bskyPostRef, blobs, unpublish

    @Test("bskyPostRef is unset on the first pass, then filled in once POSSE has cross-posted")
    func bskyPostRefLinkage() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            now: { Date(timeIntervalSince1970: 1_782_777_600) }
        )

        // First pass: `publishStandardSite` always runs before `syndicate` in
        // `runPostDeploySequencing`, so no POSSESyndicationLog exists yet — bskyPostRef must be
        // unset.
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        let firstDocumentBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").last)
        let firstRecord = try #require(firstDocumentBody["record"] as? [String: Any])
        #expect(firstRecord["bskyPostRef"] == nil)

        // Simulate a POSSE pass having run between deploys: ledger a Bluesky cross-post for the
        // same canonical URL this document plan resolves to.
        let canonicalURL = try #require(URL(string: "/notes/hello/", relativeTo: URL(string: "https://owner.example")))
        var posseLedger = POSSESyndicationLog()
        posseLedger.record(POSSESyndicationLog.Entry(
            sourceFile: "src/content/notes/hello.md",
            canonicalURL: canonicalURL.absoluteURL,
            platform: "bluesky",
            syndicationURL: URL(string: "https://bsky.app/profile/owner.test/post/anglesite-x")!,
            postedAt: Date(timeIntervalSince1970: 1_782_777_600)
        ))
        try posseLedger.save(to: site.config)
        await stub.set(getRecordResponse: (uri: "at://did:plc:owner/app.bsky.feed.post/anglesite-x", cid: "bafypostcid"))

        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        let secondDocumentBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").last)
        let secondRecord = try #require(secondDocumentBody["record"] as? [String: Any])
        let bskyPostRef = try #require(secondRecord["bskyPostRef"] as? [String: Any])
        #expect(bskyPostRef["uri"] as? String == "at://did:plc:owner/app.bsky.feed.post/anglesite-x")
        #expect(bskyPostRef["cid"] as? String == "bafypostcid")

        // The lookup targets the same rkey POSSE itself derives for this canonical URL/platform.
        let getRecordRequest = try #require(await stub.requests(path: "/xrpc/com.atproto.repo.getRecord").last)
        let queryItems = URLComponents(url: getRecordRequest.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let expectedRkey = "anglesite-\(POSSEStableKey.make("site-1\n\(canonicalURL.absoluteURL.absoluteString)\nbluesky"))"
        #expect(queryItems.contains(URLQueryItem(name: "rkey", value: expectedRkey)))
        #expect(queryItems.contains(URLQueryItem(name: "collection", value: "app.bsky.feed.post")))
    }

    @Test("publication icon and document coverImage are uploaded as blobs when present and within the size limit")
    func blobUpload() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }

        // Site icon, at the fixed path `StandardSitePublishCommand` looks for.
        let publicDir = site.source.appendingPathComponent("public", isDirectory: true)
        try FileManager.default.createDirectory(at: publicDir, withIntermediateDirectories: true)
        try Data([0x89, 0x50, 0x4E, 0x47]).write(to: publicDir.appendingPathComponent("icon-512.png"))

        // Post cover image, referenced by frontmatter `image` (root-relative, like
        // `OutboxBackfillPlan`'s photo collections).
        let uploadsDir = publicDir.appendingPathComponent("uploads", isDirectory: true)
        try FileManager.default.createDirectory(at: uploadsDir, withIntermediateDirectories: true)
        try Data([0xFF, 0xD8, 0xFF]).write(to: uploadsDir.appendingPathComponent("hero.jpg"))
        let postURL = site.source.appendingPathComponent("src/content/notes/hello.md")
        var post = try String(contentsOf: postURL, encoding: .utf8)
        post = post.replacingOccurrences(of: "publishDate: 2026-01-01", with: "publishDate: 2026-01-01\nimage: /uploads/hero.jpg")
        try post.write(to: postURL, atomically: true, encoding: .utf8)

        let stub = APIStub()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            now: { Date(timeIntervalSince1970: 1_782_777_600) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)

        let uploadRequests = await stub.requests(path: "/xrpc/com.atproto.repo.uploadBlob")
        #expect(uploadRequests.count == 2)
        // The icon (.png) and cover image (.jpg) each carry their own real Content-Type, not a
        // canned/shared one — confirms `StandardSiteImageBlob.mimeType(for:)` is per-file.
        let contentTypes = Set(uploadRequests.map { $0.value(forHTTPHeaderField: "Content-Type") })
        #expect(contentTypes == ["image/png", "image/jpeg"])

        let publicationBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").first)
        let publicationRecord = try #require(publicationBody["record"] as? [String: Any])
        let icon = try #require(publicationRecord["icon"] as? [String: Any])
        #expect((icon["ref"] as? [String: Any])?["$link"] as? String == "bafyblob")

        let documentBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").last)
        let documentRecord = try #require(documentBody["record"] as? [String: Any])
        #expect((documentRecord["coverImage"] as? [String: Any])?["$type"] as? String == "blob")
    }

    @Test("an oversize cover image is skipped and logged rather than downscaled")
    func oversizeCoverImageIsSkipped() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        let publicDir = site.source.appendingPathComponent("public", isDirectory: true)
        let uploadsDir = publicDir.appendingPathComponent("uploads", isDirectory: true)
        try FileManager.default.createDirectory(at: uploadsDir, withIntermediateDirectories: true)
        try Data(repeating: 0, count: StandardSiteImageBlob.maxBytes + 1).write(to: uploadsDir.appendingPathComponent("huge.png"))
        let postURL = site.source.appendingPathComponent("src/content/notes/hello.md")
        var post = try String(contentsOf: postURL, encoding: .utf8)
        post = post.replacingOccurrences(of: "publishDate: 2026-01-01", with: "publishDate: 2026-01-01\nimage: /uploads/huge.png")
        try post.write(to: postURL, atomically: true, encoding: .utf8)

        let stub = APIStub()
        let logCenter = LogCenter()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: logCenter,
            now: { Date(timeIntervalSince1970: 1_782_777_600) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)

        #expect(await stub.count(path: "/xrpc/com.atproto.repo.uploadBlob") == 0)
        let documentBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").last)
        let documentRecord = try #require(documentBody["record"] as? [String: Any])
        #expect(documentRecord["coverImage"] == nil)
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("exceeds the 1 MB limit") })
    }

    @Test("a cover image with an unrecognized extension is skipped and logged, unlike a simply-unset one")
    func unsupportedCoverImageExtensionIsLoggedButMissingIconIsSilent() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        // Deliberately no icon-512.png — the common "no icon configured" case must stay silent.
        let publicDir = site.source.appendingPathComponent("public", isDirectory: true)
        let uploadsDir = publicDir.appendingPathComponent("uploads", isDirectory: true)
        try FileManager.default.createDirectory(at: uploadsDir, withIntermediateDirectories: true)
        try Data([0x00]).write(to: uploadsDir.appendingPathComponent("hero.avif"))
        let postURL = site.source.appendingPathComponent("src/content/notes/hello.md")
        var post = try String(contentsOf: postURL, encoding: .utf8)
        post = post.replacingOccurrences(of: "publishDate: 2026-01-01", with: "publishDate: 2026-01-01\nimage: /uploads/hero.avif")
        try post.write(to: postURL, atomically: true, encoding: .utf8)

        let stub = APIStub()
        let logCenter = LogCenter()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: logCenter,
            now: { Date(timeIntervalSince1970: 1_782_777_600) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)

        #expect(await stub.count(path: "/xrpc/com.atproto.repo.uploadBlob") == 0)
        let documentBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.putRecord").last)
        let documentRecord = try #require(documentBody["record"] as? [String: Any])
        #expect(documentRecord["coverImage"] == nil)

        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("unrecognized image extension \"avif\"") })
        // The missing site icon is a plain "nothing configured" case — no matching log line for it.
        #expect(!lines.contains { $0.text.contains("site icon") })
    }

    @Test("a document whose source post no longer exists is unpublished (deleteRecord) and pruned from the ledger")
    func unpublishesRemovedPost() async throws {
        let site = try makeSite()
        defer { try? FileManager.default.removeItem(at: site.root) }
        // A second post, so the pass has one survivor and one to delete.
        try """
        ---
        title: Second post
        publishDate: 2026-01-02
        ---
        Second body.
        """.write(
            to: site.source.appendingPathComponent("src/content/notes/second.md"), atomically: true, encoding: .utf8
        )

        let stub = APIStub()
        let logCenter = LogCenter()
        let command = StandardSitePublishCommand(
            credentials: { _, _ in credentials },
            transport: { try await stub.respond($0) },
            logCenter: logCenter,
            now: { Date(timeIntervalSince1970: 1_782_777_600) }
        )
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)
        let ledgerBefore = try #require(StandardSitePublishLog.load(from: site.config))
        #expect(ledgerBefore.entries.count == 2)
        let removedURI = try #require(ledgerBefore.entries.first { $0.path == "/notes/second/" }?.uri)

        // Delete the second post's source file — the next pass should unpublish its document.
        try FileManager.default.removeItem(at: site.source.appendingPathComponent("src/content/notes/second.md"))
        await command.publish(siteID: "site-1", siteDirectory: site.source, configDirectory: site.config)

        #expect(await stub.count(path: "/xrpc/com.atproto.repo.deleteRecord") == 1)
        let deleteBody = try #require(await stub.bodies(path: "/xrpc/com.atproto.repo.deleteRecord").first)
        #expect(deleteBody["collection"] as? String == "site.standard.document")
        let expectedRkey = try #require(removedURI.split(separator: "/").last).description
        #expect(deleteBody["rkey"] as? String == expectedRkey)

        let ledgerAfter = try #require(StandardSitePublishLog.load(from: site.config))
        #expect(ledgerAfter.entries.count == 1)
        #expect(ledgerAfter.entries.first?.path == "/notes/hello/")

        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("unpublished /notes/second/") })
        #expect(lines.contains { $0.text.contains("done — published 0, updated 1, unpublished 1, failed 0") })
    }
}
