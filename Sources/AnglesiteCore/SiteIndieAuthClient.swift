import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Loopback (RFC 8252 §7.3) client identity for signing in against a *site's own* IndieAuth
/// server — as opposed to `CloudflareOAuthConfiguration`'s fixed, Anglesite-hosted `client_id`/
/// `redirect_uri`. A per-site server has no pre-registered client, and `@dwk/indieauth`'s default
/// `redirectUriPolicy` requires `redirect_uri` to share an origin with `client_id` — a loopback
/// origin satisfies both `isHttpUrl`'s "loopback host" exception (`handler.ts`) and the
/// same-origin check at once.
///
/// Nothing actually listens on `redirectPort`: after the user approves sign-in in the system
/// browser, the site's IndieAuth server redirects the browser to `redirectURI` with `code`/
/// `state` in the query. The connection fails to load (there's no local server), but the
/// browser's address bar still shows that final URL — `MicrosubReaderModel`'s sign-in flow has
/// the user copy it back into the app rather than standing up a real loopback HTTP server to
/// capture it automatically. Neither URL is a secret (PKCE public clients have none).
public enum SiteIndieAuthLoopback {
    public static let redirectPort: UInt16 = 51789
    public static let clientID = URL(string: "http://127.0.0.1:51789/")!
    public static let redirectURI = URL(string: "http://127.0.0.1:51789/callback")!

    /// The scopes `@dwk/microsub` needs: read the timeline, manage channels, follow/unfollow
    /// feeds (`spec/packages/microsub.md`'s scope names, checked against `handler.ts`'s
    /// `requireAuth` calls).
    public static let microsubScope = "read channels follow"
}

/// The subset of an IndieAuth server's `.well-known/oauth-authorization-server` metadata
/// (RFC 8414) a client needs: where to send the user and where to redeem the code.
struct IndieAuthMetadata: Decodable, Sendable {
    let issuer: String
    let authorizationEndpoint: URL
    let tokenEndpoint: URL

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
    }
}

public enum SiteIndieAuthError: Error, Equatable, Sendable {
    /// Discovery document couldn't be fetched or decoded.
    case discoveryUnavailable(String)
    /// The callback's `state` didn't match the one this request minted — possible CSRF, never
    /// silently accepted.
    case stateMismatch
    /// The authorization server (or the user) denied the request, e.g. `error=access_denied`.
    case callbackDenied(String)
    /// The callback had a matching `state` but no `code`.
    case missingAuthorizationCode
    /// The token endpoint rejected the exchange or returned something undecodable.
    case tokenExchangeFailed(String)
    /// Signing the DPoP proof needs CryptoKit (Apple platforms only).
    case dpopUnavailable
    /// The pasted-back URL's scheme/host/port/path don't match `request.redirectURI` — not the
    /// callback URL for this sign-in attempt (e.g. pasted from a stale browser tab).
    case redirectURIMismatch
}

/// One authorize attempt: the URL to present plus what's needed to complete it once a callback
/// URL comes back — pasted back by the user, not captured automatically (see
/// `SiteIndieAuthLoopback`'s doc comment for why).
public struct SiteIndieAuthRequest: Sendable {
    public let authorizeURL: URL
    let state: String
    let codeVerifier: String
    let clientID: URL
    let redirectURI: URL
    let tokenEndpoint: URL
}

/// The token response from a site's own `/token` endpoint (`@dwk/indieauth`'s DPoP-bound access
/// token, see `token.ts`'s `signAccessToken`).
public struct SiteIndieAuthToken: Sendable, Equatable {
    public let accessToken: String
    public let tokenType: String
    public let scope: String
    public let me: String
    public let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case scope
        case me
        case expiresIn = "expires_in"
    }
}

extension SiteIndieAuthToken: Decodable {}

/// Authorization Code + PKCE + DPoP sign-in against a **site's own** IndieAuth server (V-4.3,
/// #365) — the credential `MicrosubClient` presents to the site's deployed `/microsub` endpoint.
/// Distinct from `CloudflareOAuthClient` (Anglesite's own registered Cloudflare client): here
/// every site is its own authorization server with no pre-registered client, so this type uses
/// the RFC 8252 loopback pattern (`SiteIndieAuthLoopback`) instead of a fixed `client_id`/
/// `redirect_uri`.
///
/// This type only builds requests, parses callbacks, and exchanges codes — presenting the actual
/// browser (`NSWorkspace.open`) and capturing the pasted-back callback URL are the caller's job
/// (`MicrosubReaderModel`), kept out of this type so it stays fully unit-testable without
/// networking beyond the injected `Transport`. Mirrors `CloudflareOAuthClient`'s seam.
public struct SiteIndieAuthClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let transport: Transport

    public init(transport: @escaping Transport = SiteIndieAuthClient.defaultTransport) {
        self.transport = transport
    }

    /// Fetches `siteURL`'s IndieAuth metadata, mints a PKCE verifier/challenge + CSRF state, and
    /// builds the authorize URL. The caller presents `request.authorizeURL` in the system browser
    /// and passes the pasted-back callback URL to `authorizationCode(from:matching:)`.
    public func makeAuthorizationRequest(
        siteURL: URL,
        scope: String,
        clientID: URL,
        redirectURI: URL
    ) async throws -> SiteIndieAuthRequest {
        let metadata = try await discoverMetadata(siteURL: siteURL)
        let verifier = Self.makeCodeVerifier()
        let state = Self.makeState()
        guard var components = URLComponents(url: metadata.authorizationEndpoint, resolvingAgainstBaseURL: false) else {
            throw SiteIndieAuthError.discoveryUnavailable("malformed authorization_endpoint")
        }
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID.absoluteString),
            URLQueryItem(name: "redirect_uri", value: redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: try Self.codeChallenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let url = components.url else {
            throw SiteIndieAuthError.discoveryUnavailable("couldn't build the authorize URL")
        }
        return SiteIndieAuthRequest(
            authorizeURL: url,
            state: state,
            codeVerifier: verifier,
            clientID: clientID,
            redirectURI: redirectURI,
            tokenEndpoint: metadata.tokenEndpoint
        )
    }

    /// Extracts and validates the authorization code from the pasted-back callback URL against
    /// `request`. Pure URL parsing, mirrors `CloudflareOAuthClient.authorizationCode(from:matching:)`
    /// plus one check that type has no equivalent for: since the user manually copies this URL
    /// from the browser address bar (there's no automatic capture — see `SiteIndieAuthLoopback`),
    /// a stale tab or the wrong copy/paste could hand this a URL that isn't the callback at all.
    /// Checking `redirectURI` first, before even reading `state`, turns that into a clear
    /// `.redirectURIMismatch` instead of a confusing `.stateMismatch`.
    public static func authorizationCode(from callbackURL: URL, matching request: SiteIndieAuthRequest) throws -> String {
        guard callbackURL.scheme == request.redirectURI.scheme,
              callbackURL.host == request.redirectURI.host,
              callbackURL.port == request.redirectURI.port,
              callbackURL.path == request.redirectURI.path
        else {
            throw SiteIndieAuthError.redirectURIMismatch
        }

        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        guard let state = value("state"), state == request.state else {
            throw SiteIndieAuthError.stateMismatch
        }
        if let error = value("error") {
            throw SiteIndieAuthError.callbackDenied(value("error_description") ?? error)
        }
        guard let code = value("code"), !code.isEmpty else {
            throw SiteIndieAuthError.missingAuthorizationCode
        }
        return code
    }

    /// Exchanges `code` for a DPoP-bound access token, proving possession of `dpopKeyPair` at the
    /// token endpoint (RFC 9449 §5) — the same key pair must sign every later resource-request
    /// proof, since the minted token's `cnf.jkt` binds to it. Retries exactly once, with a fresh
    /// proof echoing the nonce, if the server answers with an RFC 9449 §8 `use_dpop_nonce`
    /// challenge — anything else (including a second challenge) surfaces as
    /// `.tokenExchangeFailed`.
    public func exchange(
        code: String,
        for request: SiteIndieAuthRequest,
        dpopKeyPair: DPoPKeyPair
    ) async throws -> SiteIndieAuthToken {
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: request.clientID.absoluteString),
            URLQueryItem(name: "redirect_uri", value: request.redirectURI.absoluteString),
            URLQueryItem(name: "code_verifier", value: request.codeVerifier),
        ]
        let bodyData = Data((form.percentEncodedQuery ?? "").utf8)

        func makeRequest(nonce: String?) throws -> URLRequest {
            var urlRequest = URLRequest(url: request.tokenEndpoint)
            urlRequest.httpMethod = "POST"
            urlRequest.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = bodyData
            do {
                urlRequest.setValue(
                    try dpopKeyPair.proof(htm: "POST", htu: request.tokenEndpoint.absoluteString, nonce: nonce),
                    forHTTPHeaderField: "DPoP"
                )
            } catch is DPoPError {
                throw SiteIndieAuthError.dpopUnavailable
            }
            return urlRequest
        }

        var (data, http) = try await send(makeRequest(nonce: nil))
        if let nonce = DPoPNonceChallenge.nonce(in: data, response: http) {
            (data, http) = try await send(makeRequest(nonce: nonce))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SiteIndieAuthError.tokenExchangeFailed("HTTP \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        do {
            return try JSONDecoder().decode(SiteIndieAuthToken.self, from: data)
        } catch {
            throw SiteIndieAuthError.tokenExchangeFailed("bad response: \(error)")
        }
    }

    private func send(_ urlRequest: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(urlRequest)
        } catch {
            throw SiteIndieAuthError.tokenExchangeFailed(error.localizedDescription)
        }
    }

    private func discoverMetadata(siteURL: URL) async throws -> IndieAuthMetadata {
        let metadataURL = siteURL.appendingPathComponent(".well-known/oauth-authorization-server")
        var request = URLRequest(url: metadataURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data: Data, http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw SiteIndieAuthError.discoveryUnavailable(error.localizedDescription)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SiteIndieAuthError.discoveryUnavailable("HTTP \(http.statusCode)")
        }
        do {
            return try JSONDecoder().decode(IndieAuthMetadata.self, from: data)
        } catch {
            throw SiteIndieAuthError.discoveryUnavailable("bad response: \(error)")
        }
    }

    /// Production transport: a plain `URLSession` POST/GET, no auth of its own.
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    /// 32 random bytes, base64url-encoded (no padding) — well within RFC 7636's 43-128 char
    /// range. Mirrors `CloudflareOAuthClient.makeCodeVerifier()`.
    static func makeCodeVerifier() -> String {
        var rng = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
        return base64URLEncode(Data(bytes))
    }

    static func makeState() -> String {
        var rng = SystemRandomNumberGenerator()
        let bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max, using: &rng) }
        return base64URLEncode(Data(bytes))
    }

    #if canImport(CryptoKit)
    static func codeChallenge(for verifier: String) throws -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return base64URLEncode(Data(digest))
    }
    #else
    static func codeChallenge(for verifier: String) throws -> String {
        throw SiteIndieAuthError.dpopUnavailable
    }
    #endif

    private static func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
