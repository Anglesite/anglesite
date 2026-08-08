import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A GitHub account surfaced after a personal access token verifies — the identity Settings
/// displays instead of a bare "token stored" (mirrors Xcode's Accounts pane, which shows who
/// you're signed in as). `name` and `avatarURL` are best-effort niceties; `login` is always
/// present on a valid token.
public struct GitHubAccount: Sendable, Equatable {
    /// The account's GitHub username (the `@handle`). The one field a valid token always yields,
    /// so display code can rely on it without a fallback.
    public let login: String
    /// The user's display name, if they've set one on their GitHub profile.
    public let name: String?
    /// The profile avatar URL, if GitHub returned a parseable one.
    public let avatarURL: URL?

    /// Memberwise initializer, public so tests and previews can fabricate accounts without a
    /// network verify.
    public init(login: String, name: String?, avatarURL: URL?) {
        self.login = login
        self.name = name
        self.avatarURL = avatarURL
    }
}

/// Why verifying a pasted GitHub token failed, with the user-facing copy Settings shows.
public enum GitHubTokenVerifyError: Error, Equatable, Sendable {
    /// The token was rejected by GitHub (bad/expired/revoked).
    case invalidToken
    /// We couldn't reach GitHub (DNS/connection failure).
    case network
    /// We couldn't check the token at all (rate limit, outage, unexpected response).
    case unavailable(String)

    /// The user-facing copy Settings shows for this failure. Notably, ``invalidToken``'s message
    /// carries the full token-creation recipe (fine-grained, All repositories, Contents +
    /// Administration read/write, plus read-only Repository security advisories and Dependabot
    /// alerts for #975) so the user can fix it without leaving the prompt.
    public var userMessage: String {
        switch self {
        case .invalidToken:
            return "That token didn’t work. Create a fine-grained token scoped to All repositories with Contents: Read and write, Administration: Read and write, Repository security advisories: Read, and Dependabot alerts: Read access at github.com/settings/tokens and paste the whole token."
        case .network:
            return "Couldn’t reach GitHub. Check your connection and try again."
        case .unavailable(let reason):
            return reason
        }
    }
}

/// Verifies a GitHub personal access token before it's persisted, so a bad token is caught at
/// the point of entry — and surfaces the connected identity for display, the same "verify then
/// persist" shape as `TokenVerifying` (Cloudflare).
public protocol GitHubTokenVerifying: Sendable {
    /// Checks `token` against GitHub, returning the connected account on success. A `Result`
    /// rather than `throws` so callers must classify every failure (bad token vs. offline vs.
    /// GitHub outage) — each gets different user-facing copy via
    /// ``GitHubTokenVerifyError/userMessage``.
    func verify(token: String) async -> Result<GitHubAccount, GitHubTokenVerifyError>
}

/// Verifies a GitHub PAT by calling `GET /user` on the GitHub REST API directly. The HTTP step
/// is injected (`Transport`) so the classification logic is unit-testable without real network —
/// same seam philosophy as `CloudflareAPITokenVerifier`.
public struct GitHubAPITokenVerifier: GitHubTokenVerifying {
    /// Performs one authenticated GET and returns its body + response. Throws on connection failure.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let baseURL: URL
    private let transport: Transport

    /// Both parameters exist for tests: `baseURL` points the client at a stub server, and
    /// `transport` replaces the network entirely. Production uses the defaults.
    public init(
        baseURL: URL = URL(string: "https://api.github.com")!,
        transport: @escaping Transport = GitHubAPITokenVerifier.defaultTransport
    ) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Calls `GET /user` with the token and classifies the outcome. Only a 401 blames the token
    /// (``GitHubTokenVerifyError/invalidToken``) — `/user` needs no specific scope, so a 403 is
    /// far more likely a rate limit, and it's grouped with 429/5xx as
    /// ``GitHubTokenVerifyError/unavailable(_:)`` rather than telling the user their token is bad
    /// when it probably isn't.
    public func verify(token: String) async -> Result<GitHubAccount, GitHubTokenVerifyError> {
        var request = URLRequest(url: baseURL.appendingPathComponent("user"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            return .failure(.network)
        }

        // 401 is an unambiguous bad/expired/revoked token. `/user` needs no specific scope, so a
        // 403 is far more likely a rate limit than a genuinely invalid token — don't blame the
        // user's token for it. 429/5xx are transient outages, same reasoning.
        if http.statusCode == 401 {
            return .failure(.invalidToken)
        }
        if http.statusCode == 403 || http.statusCode == 429 || http.statusCode >= 500 {
            return .failure(.unavailable("GitHub is unavailable right now (HTTP \(http.statusCode)). Try again in a moment."))
        }
        guard (200..<300).contains(http.statusCode),
              let user = try? JSONDecoder().decode(UserResponse.self, from: data)
        else {
            return .failure(.unavailable("GitHub returned an unexpected response while checking the token."))
        }
        return .success(GitHubAccount(login: user.login, name: user.name, avatarURL: user.avatarURLString.flatMap(URL.init(string:))))
    }

    /// Production transport: a plain `URLSession` GET.
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    private struct UserResponse: Decodable {
        let login: String
        let name: String?
        let avatarURLString: String?

        enum CodingKeys: String, CodingKey {
            case login, name
            case avatarURLString = "avatar_url"
        }
    }
}
