import Testing
import Foundation
// URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin platforms
// (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import AnglesiteCore

/// Tests `MicropubClient` against an injected `Transport` — request shaping (method, DPoP/
/// Authorization headers, JSON bodies, query params, multipart), response decoding, and the
/// #867 error taxonomy (401/403 → re-auth signal, 5xx/unreachable → retryable signal) — no real
/// networking. Same faked-seam style as `MicrosubClientTests`/the `SandboxControlClient` tests.
@Suite(.serialized)
struct MicropubClientTests {
    private let endpoint = URL(string: "https://owner.example/micropub")!
    private let mediaEndpoint = URL(string: "https://owner.example/media")!

    private func response(_ code: Int, headers: [String: String]? = nil) -> HTTPURLResponse {
        HTTPURLResponse(url: endpoint, statusCode: code, httpVersion: nil, headerFields: headers)!
    }

    // MARK: - mp-slug derivation (parity with NativeContentOperations.createPost)

    @Test("deriveSlug matches the file path's slug for a plain title")
    func deriveSlugFromTitle() {
        #expect(MicropubClient.deriveSlug(title: "My Big Announcement") == "my-big-announcement")
        // Identical to what NativeContentOperations.createPost computes for the same title.
        #expect(MicropubClient.deriveSlug(title: "My Big Announcement") == ContentScaffold.slugify("My Big Announcement"))
    }

    @Test("deriveSlug applies the same accent/quote folding as ContentScaffold.slugify")
    func deriveSlugFoldsLikeScaffold() {
        #expect(MicropubClient.deriveSlug(title: "Café Crème!") == "cafe-creme")
        #expect(MicropubClient.deriveSlug(title: "Rock 'n' Roll") == "rock-n-roll")
    }

    @Test("an explicit slug wins over the title, same precedence as createPost's slug ?? title")
    func deriveSlugExplicitWins() {
        #expect(MicropubClient.deriveSlug(title: "A Title", explicitSlug: "Custom Slug") == "custom-slug")
        // An empty explicit slug falls through to the title, matching createPost's
        // `slug.flatMap { $0.isEmpty ? nil : $0 } ?? title`.
        #expect(MicropubClient.deriveSlug(title: "A Title", explicitSlug: "") == "a-title")
    }

    @Test("deriveSlug is nil when nothing yields a slug — mp-slug omitted, server generates")
    func deriveSlugNilWhenUnderivable() {
        #expect(MicropubClient.deriveSlug(title: nil) == nil)
        #expect(MicropubClient.deriveSlug(title: "   ") == nil)
        #expect(MicropubClient.deriveSlug(title: "!!!") == nil)
    }

    // MARK: - MicropubPost building & reading

    @Test("entry stamps content, name, post-status, and a derived mp-slug")
    func entryBuildsProperties() {
        let post = MicropubPost.entry(title: "Hello World", content: "Body text", status: .published)
        #expect(post.type == ["h-entry"])
        #expect(post.properties["content"] == [.string("Body text")])
        #expect(post.properties["name"] == [.string("Hello World")])
        #expect(post.properties["post-status"] == [.string("published")])
        #expect(post.properties["mp-slug"] == [.string("hello-world")])
    }

    @Test("entry defaults to draft and omits name/mp-slug for an untitled note")
    func entryUntitledNote() {
        let post = MicropubPost.entry(content: "Just a quick note")
        #expect(post.properties["post-status"] == [.string("draft")])
        #expect(post.properties["name"] == nil)
        #expect(post.properties["mp-slug"] == nil)
    }

    @Test("post-status reads back as an enum, defaulting to published when absent")
    func statusDefaultsToPublished() {
        let draft = MicropubPost(properties: ["post-status": [.string("draft")]])
        #expect(draft.status == .draft)
        let bare = MicropubPost(properties: ["content": [.string("hi")]])
        #expect(bare.status == .published)
    }

    #if canImport(CryptoKit)
    // MARK: - Create

    @Test("create posts the mf2 JSON body with DPoP auth and returns the Location URL")
    func createPostsAndReturnsLocation() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok-123", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(201, headers: ["Location": "https://owner.example/articles/hello-world"]))
            }
        )
        let url = try await client.create(.entry(title: "Hello World", content: "Body", status: .draft))

        #expect(url == URL(string: "https://owner.example/articles/hello-world")!)
        #expect(captured?.httpMethod == "POST")
        #expect(captured?.url == endpoint)
        #expect(captured?.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(captured?.value(forHTTPHeaderField: "Authorization") == "DPoP tok-123")
        #expect(captured?.value(forHTTPHeaderField: "DPoP")?.split(separator: ".").count == 3)
        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: Any]
        #expect(body["type"] as? [String] == ["h-entry"])
        let properties = body["properties"] as! [String: [Any]]
        #expect(properties["content"] as? [String] == ["Body"])
        #expect(properties["post-status"] as? [String] == ["draft"])
        #expect(properties["mp-slug"] as? [String] == ["hello-world"])
    }

    @Test("a 2xx create with no Location header throws .decodingFailed")
    func createWithoutLocationThrows() async {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data(), self.response(201)) }
        )
        await #expect(throws: MicropubError.decodingFailed("create response had no Location header")) {
            _ = try await client.create(.entry(content: "note"))
        }
    }

    // MARK: - Update / setStatus / delete

    @Test("update sends action=update with replace/add/delete and returns nil on 204")
    func updateSendsOperations() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(204))
            }
        )
        let postURL = URL(string: "https://owner.example/notes/abc")!
        let moved = try await client.update(
            url: postURL,
            replace: ["content": [.string("Edited")]],
            add: ["category": [.string("swift")]],
            delete: .properties(["name"])
        )

        #expect(moved == nil)
        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: Any]
        #expect(body["action"] as? String == "update")
        #expect(body["url"] as? String == "https://owner.example/notes/abc")
        #expect((body["replace"] as? [String: [String]])?["content"] == ["Edited"])
        #expect((body["add"] as? [String: [String]])?["category"] == ["swift"])
        #expect(body["delete"] as? [String] == ["name"])
    }

    @Test("update returns the new Location when the server answers 201 (URL changed)")
    func updateReturnsMovedLocation() async throws {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                (Data(), self.response(201, headers: ["Location": "https://owner.example/articles/new-slug"]))
            }
        )
        let moved = try await client.update(
            url: URL(string: "https://owner.example/articles/old")!,
            replace: ["mp-slug": [.string("new-slug")]]
        )
        #expect(moved == URL(string: "https://owner.example/articles/new-slug")!)
    }

    @Test("update's value-scoped delete sends the object form")
    func updateDeleteValuesSendsObject() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(204))
            }
        )
        try await client.update(
            url: URL(string: "https://owner.example/notes/abc")!,
            delete: .values(["category": [.string("drafts")]])
        )
        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: Any]
        #expect((body["delete"] as? [String: [String]])?["category"] == ["drafts"])
    }

    @Test("setStatus publishes via a replace of post-status alone")
    func setStatusReplacesPostStatus() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(204))
            }
        )
        try await client.setStatus(url: URL(string: "https://owner.example/notes/abc")!, .published)

        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: Any]
        #expect(body["action"] as? String == "update")
        #expect(body["replace"] as? [String: [String]] == ["post-status": ["published"]])
        #expect(body["add"] == nil)
        #expect(body["delete"] == nil)
    }

    @Test("delete sends action=delete with the post URL")
    func deleteSendsAction() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(204))
            }
        )
        try await client.delete(url: URL(string: "https://owner.example/notes/abc")!)

        let body = try JSONSerialization.jsonObject(with: captured!.httpBody!) as! [String: String]
        #expect(body == ["action": "delete", "url": "https://owner.example/notes/abc"])
    }

    // MARK: - q=source read & list

    @Test("source sends q=source&url and decodes the stored post")
    func sourceReadsSinglePost() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                let body = #"{"type":["h-entry"],"properties":{"content":["Body"],"post-status":["draft"]}}"#
                return (Data(body.utf8), self.response(200))
            }
        )
        let post = try await client.source(url: URL(string: "https://owner.example/notes/abc")!)

        #expect(captured?.httpMethod == "GET")
        let items = URLComponents(url: captured!.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.contains(URLQueryItem(name: "q", value: "source")))
        #expect(items.contains(URLQueryItem(name: "url", value: "https://owner.example/notes/abc")))
        #expect(post.type == ["h-entry"])
        #expect(post.firstString("content") == "Body")
        #expect(post.status == .draft)
    }

    @Test("listPosts sends q=source with no url and decodes the items envelope")
    func listPostsDecodesItems() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                let body = """
                {"items":[
                  {"type":["h-entry"],"properties":{"name":["Post A"],"url":["https://owner.example/articles/post-a"]}},
                  {"type":["h-entry"],"properties":{"content":["draft note"],"post-status":["draft"],"url":["https://owner.example/notes/n1"]}}
                ]}
                """
                return (Data(body.utf8), self.response(200))
            }
        )
        let posts = try await client.listPosts(limit: 20, offset: 40)

        let items = URLComponents(url: captured!.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.contains(URLQueryItem(name: "q", value: "source")))
        #expect(!items.contains { $0.name == "url" })
        #expect(items.contains(URLQueryItem(name: "limit", value: "20")))
        #expect(items.contains(URLQueryItem(name: "offset", value: "40")))
        #expect(posts.count == 2)
        #expect(posts[0].url == URL(string: "https://owner.example/articles/post-a")!)
        #expect(posts[0].status == .published)
        #expect(posts[1].status == .draft)
        #expect(posts[1].url == URL(string: "https://owner.example/notes/n1")!)
    }

    @Test("configuration decodes the media endpoint and supported queries from q=config")
    func configurationDecodesMediaEndpoint() async throws {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                let body = #"{"media-endpoint":"https://owner.example/media","q":["source","config","syndicate-to"]}"#
                return (Data(body.utf8), self.response(200))
            }
        )
        let config = try await client.configuration()
        #expect(config.mediaEndpoint == URL(string: "https://owner.example/media")!)
        #expect(config.supportedQueries == ["source", "config", "syndicate-to"])
    }

    @Test("configuration resolves a relative media-endpoint against the micropub endpoint")
    func configurationResolvesRelativeMediaEndpoint() async throws {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                let body = #"{"media-endpoint":"/media","q":["source","config"]}"#
                return (Data(body.utf8), self.response(200))
            }
        )
        let config = try await client.configuration()
        #expect(config.mediaEndpoint == URL(string: "https://owner.example/media")!)
    }

    // MARK: - Media upload

    @Test("uploadMedia posts multipart form-data to the media endpoint and returns the Location")
    func uploadMediaPostsMultipart() async throws {
        var captured: URLRequest?
        let client = MicropubClient(
            endpoint: endpoint, mediaEndpoint: mediaEndpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                captured = request
                return (Data(), self.response(201, headers: ["Location": "https://owner.example/media/abc123.jpg"]))
            }
        )
        let url = try await client.uploadMedia(Data("jpeg-bytes".utf8), filename: "photo.jpg", mimeType: "image/jpeg")

        #expect(url == URL(string: "https://owner.example/media/abc123.jpg")!)
        #expect(captured?.url == mediaEndpoint)
        #expect(captured?.httpMethod == "POST")
        let contentType = captured?.value(forHTTPHeaderField: "Content-Type") ?? ""
        #expect(contentType.hasPrefix("multipart/form-data; boundary="))
        let bodyText = String(data: captured!.httpBody!, encoding: .utf8)!
        #expect(bodyText.contains(#"Content-Disposition: form-data; name="file"; filename="photo.jpg""#))
        #expect(bodyText.contains("Content-Type: image/jpeg"))
        #expect(bodyText.contains("jpeg-bytes"))
        // The DPoP proof's htu must be the media endpoint, not the micropub endpoint — the
        // server verifies the proof against the URL that actually received the request.
        let proofPayload = try proofClaims(of: captured!)
        #expect(proofPayload["htu"] as? String == mediaEndpoint.absoluteString)
    }

    @Test("uploadMedia without a configured media endpoint throws before any request")
    func uploadMediaRequiresEndpoint() async {
        var transportCalled = false
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                transportCalled = true
                return (Data(), self.response(201))
            }
        )
        await #expect(throws: MicropubError.mediaEndpointNotConfigured) {
            _ = try await client.uploadMedia(Data(), filename: "x.jpg", mimeType: "image/jpeg")
        }
        #expect(!transportCalled)
    }

    // MARK: - Error taxonomy (#867's re-auth and retryable signals)

    @Test("401 and 403 both surface as .unauthorized, the re-auth signal", arguments: [401, 403])
    func authFailureSignalsReauth(status: Int) async {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "expired", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data(#"{"error":"invalid_token"}"#.utf8), self.response(status)) }
        )
        await #expect(throws: MicropubError.unauthorized) {
            _ = try await client.create(.entry(content: "note"))
        }
        #expect(MicropubError.unauthorized.requiresReauthorization)
        #expect(!MicropubError.unauthorized.isRetryable)
    }

    @Test("a 5xx surfaces as .serverError and is retryable — the offline-queue signal")
    func serverErrorIsRetryable() async {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data("bake exploded".utf8), self.response(503)) }
        )
        let expected = MicropubError.serverError(status: 503, body: "bake exploded")
        await #expect(throws: expected) {
            _ = try await client.create(.entry(content: "note"))
        }
        #expect(expected.isRetryable)
        #expect(!expected.requiresReauthorization)
    }

    @Test("a transport failure surfaces as .unreachable and is retryable")
    func unreachableIsRetryable() async {
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in throw URLError(.notConnectedToInternet) }
        )
        do {
            _ = try await client.create(.entry(content: "note"))
            Issue.record("expected a throw")
        } catch let error as MicropubError {
            guard case .unreachable = error else {
                Issue.record("expected .unreachable, got \(error)")
                return
            }
            #expect(error.isRetryable)
            #expect(!error.requiresReauthorization)
        } catch {
            Issue.record("expected MicropubError, got \(error)")
        }
    }

    @Test("a 404 on q=source surfaces as .requestFailed — neither retryable nor re-auth")
    func notFoundIsTerminal() async {
        let body = #"{"error":"invalid_request","error_description":"no post exists at that URL"}"#
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in (Data(body.utf8), self.response(404)) }
        )
        let expected = MicropubError.requestFailed(status: 404, body: body)
        await #expect(throws: expected) {
            _ = try await client.source(url: URL(string: "https://owner.example/gone")!)
        }
        #expect(!expected.isRetryable)
        #expect(!expected.requiresReauthorization)
    }

    // MARK: - DPoP nonce challenge

    @Test("create retries once with the echoed nonce, resending the same body")
    func createRetriesOnNonceChallenge() async throws {
        var transportCallCount = 0
        var capturedBodies: [Data] = []
        var capturedProofs: [URLRequest] = []
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { request in
                transportCallCount += 1
                capturedBodies.append(request.httpBody ?? Data())
                capturedProofs.append(request)
                if transportCallCount == 1 {
                    let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                    let http = HTTPURLResponse(
                        url: self.endpoint, statusCode: 401, httpVersion: nil,
                        headerFields: ["DPoP-Nonce": "server-nonce-1"]
                    )!
                    return (challenge, http)
                }
                return (Data(), self.response(201, headers: ["Location": "https://owner.example/notes/n1"]))
            }
        )
        let url = try await client.create(.entry(content: "note"))

        #expect(url == URL(string: "https://owner.example/notes/n1")!)
        #expect(transportCallCount == 2)
        #expect(capturedBodies[0] == capturedBodies[1])
        let retryClaims = try proofClaims(of: capturedProofs[1])
        #expect(retryClaims["nonce"] as? String == "server-nonce-1")
    }

    @Test("a repeated nonce challenge caps at one retry and maps the 401 to .unauthorized")
    func repeatedChallengeCapsAtOneRetry() async {
        var transportCallCount = 0
        let client = MicropubClient(
            endpoint: endpoint, accessToken: "tok", dpopKeyPair: DPoPKeyPair(),
            transport: { _ in
                transportCallCount += 1
                let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                let http = HTTPURLResponse(
                    url: self.endpoint, statusCode: 401, httpVersion: nil,
                    headerFields: ["DPoP-Nonce": "server-nonce-\(transportCallCount)"]
                )!
                return (challenge, http)
            }
        )
        await #expect(throws: MicropubError.unauthorized) {
            _ = try await client.create(.entry(content: "note"))
        }
        #expect(transportCallCount == 2)
    }

    /// Decodes the request's DPoP proof JWT payload for claim assertions.
    private func proofClaims(of request: URLRequest) throws -> [String: Any] {
        let proof = request.value(forHTTPHeaderField: "DPoP") ?? ""
        let segment = proof.split(separator: ".")[1]
        var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        return try JSONSerialization.jsonObject(with: Data(base64Encoded: base64) ?? Data()) as! [String: Any]
    }
    #endif
}
