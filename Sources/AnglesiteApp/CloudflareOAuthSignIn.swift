import AuthenticationServices
import AnglesiteCore

/// Drives one Cloudflare OAuth sign-in attempt: authorize → present the browser sheet → exchange
/// the callback for a token. Presentation is injected so `DeployModel`'s tests can drive this
/// without `AuthenticationServices` or a real browser window — the same seam philosophy
/// `TokenVerifying`/`CloudflareOAuthClient.Transport` already use elsewhere in this codebase.
struct CloudflareOAuthSignIn: Sendable {
    /// One completed OAuth sign-in: the token plus the token endpoint used to obtain it — needed
    /// later to refresh, since `OAuthToken` itself doesn't carry it.
    struct Result: Sendable {
        let token: OAuthToken
        let tokenEndpoint: URL
    }

    /// Presents `authorizeURL` (e.g. via `ASWebAuthenticationSession`) and returns the callback URL
    /// the session completes with. Throws on cancel/failure.
    typealias Presenter = @Sendable (_ authorizeURL: URL) async throws -> URL

    private let client: CloudflareOAuthClient
    private let present: Presenter

    init(client: CloudflareOAuthClient, present: @escaping Presenter) {
        self.client = client
        self.present = present
    }

    func run() async throws -> Result {
        let request = try await client.makeAuthorizationRequest()
        let callbackURL = try await present(request.authorizeURL)
        let code = try CloudflareOAuthClient.authorizationCode(from: callbackURL, matching: request)
        let token = try await client.exchange(code: code, for: request)
        return Result(token: token, tokenEndpoint: request.tokenEndpoint)
    }
}

extension CloudflareOAuthSignIn {
    /// Production presenter: a real `ASWebAuthenticationSession` anchored via
    /// `CloudflareOAuthPresentationContext`, matched against the callback Worker's `/oauth-callback`
    /// route via Associated Domains. `.https(host:path:)` callback matching has been available
    /// since macOS 14.4 (well under this app's macOS 27 floor) — confirmed against the macOS 27 SDK
    /// (`init(url:callback:completionHandler:)`) while implementing this task. It isn't
    /// unit-testable (real `AuthenticationServices` UI), so this is a manual/smoke-test item per
    /// the design doc's Testing section.
    @MainActor
    static let defaultPresenter: Presenter = { authorizeURL in
        let contextProvider = CloudflareOAuthPresentationContext()
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authorizeURL,
                callback: .https(
                    host: CloudflareOAuthConfiguration.redirectURI.host!,
                    path: CloudflareOAuthConfiguration.redirectURI.path)
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: CloudflareOAuthError.missingAuthorizationCode)
                }
            }
            session.presentationContextProvider = contextProvider
            session.start()
        }
    }
}
