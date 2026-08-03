import Testing
import Foundation
@testable import AnglesiteCore

/// Tests `CloudflareOAuthClient`'s pure logic — PKCE generation, discovery parsing, authorize-URL
/// construction, callback validation, and token exchange — all against an injected `Transport`, no
/// real network and no `AuthenticationServices`/UI (that boundary is the whole point of the type).
@Suite(.serialized)
struct CloudflareOAuthClientTests {
    private let discoveryURL = URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!
    private let redirectURI = URL(string: "https://auth.anglesite.dwk.io/oauth-callback")!
    private let discoveryJSON = Data("""
    {"authorization_endpoint":"https://dash.cloudflare.com/oauth2/auth","token_endpoint":"https://dash.cloudflare.com/oauth2/token"}
    """.utf8)

    private func response(_ code: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: discoveryURL, statusCode: code, httpVersion: nil, headerFields: nil)!
    }

    // MARK: PKCE

    @Test("code_challenge matches RFC 7636 Appendix B's test vector")
    func rfc7636Vector() throws {
        // https://www.rfc-editor.org/rfc/rfc7636#appendix-B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        #expect(try CloudflareOAuthClient.codeChallenge(for: verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test("makeCodeVerifier produces a base64url string with no padding/plus/slash")
    func verifierIsBase64URL() {
        let verifier = CloudflareOAuthClient.makeCodeVerifier()
        #expect(!verifier.contains("+"))
        #expect(!verifier.contains("/"))
        #expect(!verifier.contains("="))
        #expect(verifier.count >= 43) // RFC 7636's floor
    }

    @Test("makeState produces distinct values across calls")
    func stateIsRandom() {
        #expect(CloudflareOAuthClient.makeState() != CloudflareOAuthClient.makeState())
    }

    // MARK: Authorization request

    @Test("makeAuthorizationRequest builds a well-formed authorize URL")
    func buildsAuthorizeURL() async throws {
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { [discoveryJSON] _ in (discoveryJSON, self.response(200)) })
        let request = try await client.makeAuthorizationRequest()

        let items = URLComponents(url: request.authorizeURL, resolvingAgainstBaseURL: false)!.queryItems!
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        #expect(request.authorizeURL.host == "dash.cloudflare.com")
        #expect(request.authorizeURL.path == "/oauth2/auth")
        #expect(value("response_type") == "code")
        #expect(value("redirect_uri") == redirectURI.absoluteString)
        #expect(value("scope") == "user.read")
        #expect(value("state") == request.state)
        #expect(value("code_challenge_method") == "S256")
        #expect(value("code_challenge")?.isEmpty == false)
    }

    @Test("discovery HTTP failure surfaces as .discoveryUnavailable")
    func discoveryFailureSurfaces() async {
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { _ in (Data(), self.response(500)) })
        await #expect(throws: CloudflareOAuthError.self) {
            _ = try await client.makeAuthorizationRequest()
        }
    }

    // MARK: Callback validation (pure, no network)

    private func makeRequest(state: String = "abc123") -> CloudflareOAuthRequest {
        CloudflareOAuthRequest(
            authorizeURL: URL(string: "https://dash.cloudflare.com/oauth2/auth")!,
            state: state, codeVerifier: "verifier",
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!)
    }

    @Test("a matching state yields the code")
    func callbackMatchingState() throws {
        let request = makeRequest()
        let callback = URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=xyz&state=abc123")!
        #expect(try CloudflareOAuthClient.authorizationCode(from: callback, matching: request) == "xyz")
    }

    @Test("a mismatched state throws .stateMismatch, never returns the code")
    func callbackMismatchedState() {
        let request = makeRequest()
        let callback = URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=xyz&state=WRONG")!
        #expect(throws: CloudflareOAuthError.stateMismatch) {
            _ = try CloudflareOAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("an error query param throws .callbackDenied when the state matches")
    func callbackDenied() {
        let request = makeRequest()
        let callback = URL(string: "https://auth.anglesite.dwk.io/oauth-callback?error=access_denied&state=abc123")!
        #expect(throws: CloudflareOAuthError.callbackDenied("access_denied")) {
            _ = try CloudflareOAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("an error query param with a non-matching state throws .stateMismatch, not .callbackDenied")
    func callbackErrorWithMismatchedStateIsStateMismatch() {
        let request = makeRequest()
        let callback = URL(string: "https://auth.anglesite.dwk.io/oauth-callback?error=access_denied&state=WRONG")!
        #expect(throws: CloudflareOAuthError.stateMismatch) {
            _ = try CloudflareOAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    @Test("a matching state but missing code throws .missingAuthorizationCode")
    func callbackMissingCode() {
        let request = makeRequest()
        let callback = URL(string: "https://auth.anglesite.dwk.io/oauth-callback?state=abc123")!
        #expect(throws: CloudflareOAuthError.missingAuthorizationCode) {
            _ = try CloudflareOAuthClient.authorizationCode(from: callback, matching: request)
        }
    }

    // MARK: Token exchange

    @Test("exchange posts the PKCE verifier and decodes the token, without re-fetching discovery")
    func exchangeParsesToken() async throws {
        let request = makeRequest()
        var capturedBody: String?
        var transportCallCount = 0
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { req in
                transportCallCount += 1
                #expect(req.url == request.tokenEndpoint)
                #expect(req.httpMethod == "POST")
                capturedBody = req.httpBody.flatMap { String(data: $0, encoding: .utf8) }
                let body = #"{"access_token":"tok-123","token_type":"bearer","expires_in":3600}"#
                return (Data(body.utf8), self.response(200))
            })
        let token = try await client.exchange(code: "auth-code", for: request)

        #expect(token.accessToken == "tok-123")
        #expect(token.tokenType == "bearer")
        #expect(token.expiresIn == 3600)
        #expect(capturedBody?.contains("code_verifier=verifier") == true)
        #expect(capturedBody?.contains("code=auth-code") == true)
        #expect(capturedBody?.contains("grant_type=authorization_code") == true)
        #expect(transportCallCount == 1) // no second discovery round trip
    }

    @Test("a non-2xx token response throws .tokenExchangeFailed")
    func exchangeHTTPFailure() async {
        let request = makeRequest()
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { _ in (Data("bad code".utf8), self.response(400)) })
        await #expect(throws: CloudflareOAuthError.self) {
            _ = try await client.exchange(code: "auth-code", for: request)
        }
    }

    @Test("an undecodable token response throws .tokenExchangeFailed")
    func exchangeBadJSON() async {
        let request = makeRequest()
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { _ in (Data("not json".utf8), self.response(200)) })
        await #expect(throws: CloudflareOAuthError.self) {
            _ = try await client.exchange(code: "auth-code", for: request)
        }
    }

    // MARK: Refresh

    @Test("refresh posts grant_type=refresh_token and decodes the new token")
    func refreshPostsGrantType() async throws {
        var capturedBody: String?
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { req in
                capturedBody = req.httpBody.flatMap { String(data: $0, encoding: .utf8) }
                let body = #"{"access_token":"new-tok","token_type":"bearer","expires_in":3600,"refresh_token":"new-refresh"}"#
                return (Data(body.utf8), self.response(200))
            })
        let token = try await client.refresh(
            refreshToken: "old-refresh",
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!)

        #expect(token.accessToken == "new-tok")
        #expect(token.refreshToken == "new-refresh")
        #expect(capturedBody?.contains("grant_type=refresh_token") == true)
        #expect(capturedBody?.contains("refresh_token=old-refresh") == true)
    }

    @Test("a non-2xx refresh response throws .tokenExchangeFailed")
    func refreshHTTPFailure() async {
        let client = CloudflareOAuthClient(
            redirectURI: redirectURI, scope: "user.read", discoveryURL: discoveryURL,
            transport: { _ in (Data("bad".utf8), self.response(400)) })
        await #expect(throws: CloudflareOAuthError.self) {
            _ = try await client.refresh(
                refreshToken: "old", tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!)
        }
    }

    @Test("OAuthToken decodes an absent refresh_token as nil")
    func tokenWithoutRefreshTokenDecodesNil() throws {
        let data = Data(#"{"access_token":"tok","token_type":"bearer"}"#.utf8)
        let token = try JSONDecoder().decode(OAuthToken.self, from: data)
        #expect(token.refreshToken == nil)
    }
}
