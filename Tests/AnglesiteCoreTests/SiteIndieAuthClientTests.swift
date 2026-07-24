import Testing
import Foundation
@testable import AnglesiteCore

/// Tests `SiteIndieAuthClient`'s pure logic — discovery parsing, authorize-URL construction,
/// callback validation, and DPoP-bound token exchange — all against an injected `Transport`, no
/// real network and no browser/UI (that boundary is the whole point of the type, mirroring
/// `CloudflareOAuthClientTests`).
@Suite(.serialized)
struct SiteIndieAuthClientTests {
    private let siteURL = URL(string: "https://owner.example")!
    private let metadataURL = URL(string: "https://owner.example/.well-known/oauth-authorization-server")!
    private let clientID = SiteIndieAuthLoopback.clientID
    private let redirectURI = SiteIndieAuthLoopback.redirectURI
    private let metadataJSON = Data("""
    {"issuer":"https://owner.example","authorization_endpoint":"https://owner.example/authorize","token_endpoint":"https://owner.example/token"}
    """.utf8)

    private func response(_ code: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: metadataURL, statusCode: code, httpVersion: nil, headerFields: nil)!
    }

    // MARK: Authorization request

    @Test("makeAuthorizationRequest builds a well-formed authorize URL from site metadata")
    func buildsAuthorizeURL() async throws {
        let client = SiteIndieAuthClient(transport: { [metadataJSON] _ in (metadataJSON, self.response(200)) })
        let request = try await client.makeAuthorizationRequest(
            siteURL: siteURL, scope: SiteIndieAuthLoopback.microsubScope,
            clientID: clientID, redirectURI: redirectURI
        )

        let items = URLComponents(url: request.authorizeURL, resolvingAgainstBaseURL: false)!.queryItems!
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        #expect(request.authorizeURL.host == "owner.example")
        #expect(request.authorizeURL.path == "/authorize")
        #expect(value("response_type") == "code")
        #expect(value("client_id") == clientID.absoluteString)
        #expect(value("redirect_uri") == redirectURI.absoluteString)
        #expect(value("scope") == SiteIndieAuthLoopback.microsubScope)
        #expect(value("state") == request.state)
        #expect(value("code_challenge_method") == "S256")
        #expect(value("code_challenge")?.isEmpty == false)
    }

    @Test("client_id and redirect_uri share one origin, satisfying the server's same-origin redirect policy")
    func clientIDAndRedirectShareOrigin() {
        #expect(clientID.scheme == redirectURI.scheme)
        #expect(clientID.host == redirectURI.host)
        #expect(clientID.port == redirectURI.port)
    }

    @Test("discovery HTTP failure surfaces as .discoveryUnavailable")
    func discoveryFailureSurfaces() async {
        let client = SiteIndieAuthClient(transport: { _ in (Data(), self.response(500)) })
        await #expect(throws: SiteIndieAuthError.self) {
            _ = try await client.makeAuthorizationRequest(
                siteURL: siteURL, scope: "read", clientID: clientID, redirectURI: redirectURI
            )
        }
    }

    // MARK: Callback validation (pure, no network)

    private func makeRequest(state: String = "abc123") -> SiteIndieAuthRequest {
        SiteIndieAuthRequest(
            authorizeURL: URL(string: "https://owner.example/authorize")!,
            state: state, codeVerifier: "verifier",
            clientID: clientID, redirectURI: redirectURI,
            tokenEndpoint: URL(string: "https://owner.example/token")!
        )
    }

    @Test("a matching state yields the code")
    func callbackMatchingState() throws {
        let request = makeRequest()
        let callback = URL(string: "http://127.0.0.1:51789/callback?code=xyz&state=abc123")!
        #expect(try SiteIndieAuthClient.authorizationCode(from: callback, matching: request) == "xyz")
    }

    @Test("a URL that isn't the redirect URI throws .redirectURIMismatch, even with a matching state/code")
    func callbackWrongRedirectURI() {
        let request = makeRequest()
        // A plausible "pasted the wrong tab" mistake: right query params, wrong origin entirely.
        let callback = URL(string: "https://accounts.example.com/oauth/callback?code=xyz&state=abc123")!
        #expect(throws: SiteIndieAuthError.redirectURIMismatch) {
            _ = try SiteIndieAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("a URL on the right host but wrong path throws .redirectURIMismatch")
    func callbackWrongPath() {
        let request = makeRequest()
        let callback = URL(string: "http://127.0.0.1:51789/not-the-callback?code=xyz&state=abc123")!
        #expect(throws: SiteIndieAuthError.redirectURIMismatch) {
            _ = try SiteIndieAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("a mismatched state throws .stateMismatch, never returns the code")
    func callbackMismatchedState() {
        let request = makeRequest()
        let callback = URL(string: "http://127.0.0.1:51789/callback?code=xyz&state=WRONG")!
        #expect(throws: SiteIndieAuthError.stateMismatch) {
            _ = try SiteIndieAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("an error query param throws .callbackDenied when the state matches")
    func callbackDenied() {
        let request = makeRequest()
        let callback = URL(string: "http://127.0.0.1:51789/callback?error=access_denied&state=abc123")!
        #expect(throws: SiteIndieAuthError.callbackDenied("access_denied")) {
            _ = try SiteIndieAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("a matching state but missing code throws .missingAuthorizationCode")
    func callbackMissingCode() {
        let request = makeRequest()
        let callback = URL(string: "http://127.0.0.1:51789/callback?state=abc123")!
        #expect(throws: SiteIndieAuthError.missingAuthorizationCode) {
            _ = try SiteIndieAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    // MARK: Token exchange

    #if canImport(CryptoKit)
    @Test("exchange posts a DPoP proof + the PKCE verifier and decodes the token, without re-fetching discovery")
    func exchangeParsesToken() async throws {
        let request = makeRequest()
        let dpopKeyPair = DPoPKeyPair()
        var capturedBody: String?
        var capturedDPoPHeader: String?
        var transportCallCount = 0
        let client = SiteIndieAuthClient(transport: { req in
            transportCallCount += 1
            #expect(req.url == request.tokenEndpoint)
            #expect(req.httpMethod == "POST")
            capturedBody = req.httpBody.flatMap { String(data: $0, encoding: .utf8) }
            capturedDPoPHeader = req.value(forHTTPHeaderField: "DPoP")
            let body = #"{"access_token":"tok-123","token_type":"DPoP","scope":"read","me":"https://owner.example/","expires_in":3600}"#
            return (Data(body.utf8), self.response(200))
        })
        let token = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: dpopKeyPair)

        #expect(token.accessToken == "tok-123")
        #expect(token.tokenType == "DPoP")
        #expect(token.scope == "read")
        #expect(token.me == "https://owner.example/")
        #expect(token.expiresIn == 3600)
        #expect(capturedBody?.contains("code_verifier=verifier") == true)
        #expect(capturedBody?.contains("code=auth-code") == true)
        #expect(capturedBody?.contains("grant_type=authorization_code") == true)
        #expect(capturedDPoPHeader?.split(separator: ".").count == 3)
        #expect(transportCallCount == 1) // no second discovery round trip
    }
    #endif

    @Test("a non-2xx token response throws .tokenExchangeFailed")
    func exchangeHTTPFailure() async {
        let request = makeRequest()
        let client = SiteIndieAuthClient(transport: { _ in (Data("bad code".utf8), self.response(400)) })
        await #expect(throws: SiteIndieAuthError.self) {
            _ = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: DPoPKeyPair())
        }
    }

    @Test("an undecodable token response throws .tokenExchangeFailed")
    func exchangeBadJSON() async {
        let request = makeRequest()
        let client = SiteIndieAuthClient(transport: { _ in (Data("not json".utf8), self.response(200)) })
        await #expect(throws: SiteIndieAuthError.self) {
            _ = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: DPoPKeyPair())
        }
    }

    @Test("exchange retries once with the echoed nonce after a use_dpop_nonce challenge")
    func exchangeRetriesOnNonceChallenge() async throws {
        let request = makeRequest()
        let dpopKeyPair = DPoPKeyPair()
        var capturedDPoPHeaders: [String] = []
        var transportCallCount = 0
        let client = SiteIndieAuthClient(transport: { req in
            transportCallCount += 1
            capturedDPoPHeaders.append(req.value(forHTTPHeaderField: "DPoP") ?? "")
            if transportCallCount == 1 {
                let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
                let http = HTTPURLResponse(
                    url: request.tokenEndpoint, statusCode: 400, httpVersion: nil,
                    headerFields: ["DPoP-Nonce": "server-nonce-1"]
                )!
                return (challenge, http)
            }
            let body = #"{"access_token":"tok-123","token_type":"DPoP","scope":"read","me":"https://owner.example/","expires_in":3600}"#
            return (Data(body.utf8), self.response(200))
        })

        let token = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: dpopKeyPair)

        #expect(token.accessToken == "tok-123")
        #expect(transportCallCount == 2)

        func base64urlDecode(_ segment: Substring) -> Data {
            var base64 = segment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while base64.count % 4 != 0 { base64 += "=" }
            return Data(base64Encoded: base64) ?? Data()
        }
        let firstPayload = try JSONSerialization.jsonObject(
            with: base64urlDecode(capturedDPoPHeaders[0].split(separator: ".")[1])
        ) as! [String: Any]
        #expect(firstPayload["nonce"] == nil)

        let retryPayload = try JSONSerialization.jsonObject(
            with: base64urlDecode(capturedDPoPHeaders[1].split(separator: ".")[1])
        ) as! [String: Any]
        #expect(retryPayload["nonce"] as? String == "server-nonce-1")
    }

    @Test("exchange caps at one retry — a repeated nonce challenge still throws .tokenExchangeFailed")
    func exchangeCapsRetryAtOne() async {
        let request = makeRequest()
        var transportCallCount = 0
        let client = SiteIndieAuthClient(transport: { _ in
            transportCallCount += 1
            let challenge = Data(#"{"error":"use_dpop_nonce"}"#.utf8)
            let http = HTTPURLResponse(
                url: request.tokenEndpoint, statusCode: 400, httpVersion: nil,
                headerFields: ["DPoP-Nonce": "server-nonce-\(transportCallCount)"]
            )!
            return (challenge, http)
        })

        await #expect(throws: SiteIndieAuthError.self) {
            _ = try await client.exchange(code: "auth-code", for: request, dpopKeyPair: DPoPKeyPair())
        }
        #expect(transportCallCount == 2)
    }
}
