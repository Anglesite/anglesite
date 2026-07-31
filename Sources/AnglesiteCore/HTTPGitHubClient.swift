import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors surfaced by the GitHub repo-creation client.
public enum GitHubRepoAPIError: Error, Equatable, Sendable {
    /// The transport itself failed (DNS/offline/TLS/timeout) — never reached GitHub, so this is
    /// distinct from `.api`, which means GitHub responded with a rejection.
    case network
    /// GitHub returned 401 or 403 — the token is invalid, expired, or missing the required scope.
    /// Both statuses collapse into one case because the user-facing remedy is identical: fix the
    /// token in Settings.
    case unauthorized
    /// A 422 whose `errors[].message` says the repository name is taken. Split out from `.api`
    /// so callers can offer a rename instead of showing a raw API message.
    case nameAlreadyExists
    /// Any other non-2xx status with no more specific mapping.
    case http(status: Int)
    /// A 422 rejection that isn't a name conflict — carries GitHub's own `message` for display.
    case api(message: String)
    /// GitHub returned a success status but the body didn't decode into the expected shape.
    case malformedResponse
}

/// Creates a GitHub repository via the REST API — no `gh` CLI, no Node. Part of #654's
/// sandbox-safe Publish-to-GitHub path: `gh repo create` shells out and MAS users generally
/// won't have `gh` installed at all.
///
/// `createRepo` only creates the remote repository — wiring `origin` and pushing into it is
/// `HTTPRepoProvider`'s job, using SwiftGit2's `addRemote`/`push` (#659).
public struct HTTPGitHubClient: Sendable {
    private static let base = "https://api.github.com"
    private let transport: GitHubAPITokenVerifier.Transport

    /// Creates a client over the given transport. Reuses ``GitHubAPITokenVerifier``'s `Transport`
    /// seam (rather than defining a parallel one) so tests mock all GitHub HTTP the same way; the
    /// default is the real `URLSession`-backed transport.
    public init(transport: @escaping GitHubAPITokenVerifier.Transport = GitHubAPITokenVerifier.defaultTransport) {
        self.transport = transport
    }

    /// `POST /user/repos` — creates a repository owned by the authenticated user.
    public func createRepo(name: String, isPrivate: Bool, token: String) async throws -> RemoteRepo {
        guard let url = URL(string: Self.base + "/user/repos") else { throw GitHubRepoAPIError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CreateRepoBody(name: name, isPrivate: isPrivate))

        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw GitHubRepoAPIError.network
        }

        if http.statusCode == 401 || http.statusCode == 403 { throw GitHubRepoAPIError.unauthorized }
        if http.statusCode == 422 {
            let envelope = try? JSONDecoder().decode(GitHubErrorResponse.self, from: data)
            // The name-conflict detail lives in `errors[].message`, not the top-level `message`
            // (which is a generic "Repository creation failed." for every 422 cause).
            if envelope?.errors?.contains(where: { $0.message.localizedCaseInsensitiveContains("already exists") }) == true {
                throw GitHubRepoAPIError.nameAlreadyExists
            }
            throw GitHubRepoAPIError.api(message: envelope?.message ?? "request failed")
        }
        guard (200..<300).contains(http.statusCode) else { throw GitHubRepoAPIError.http(status: http.statusCode) }
        guard let created = try? JSONDecoder().decode(CreatedRepoResponse.self, from: data),
              let browse = URL(string: created.htmlURL) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return RemoteRepo(url: browse, owner: created.owner.login, name: created.name)
    }

    /// Shared request builder for the repo-security calls — same headers and auth as `createRepo`.
    private func repoRequest(method: String, path: String, token: String) throws -> URLRequest {
        guard let url = URL(string: Self.base + path) else { throw GitHubRepoAPIError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        return request
    }

    /// Sends `request`, mapping transport and status failures the same way `createRepo` does.
    /// Returns the body for callers that need to decode one.
    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw GitHubRepoAPIError.network
        }
        if http.statusCode == 401 || http.statusCode == 403 { throw GitHubRepoAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw GitHubRepoAPIError.http(status: http.statusCode) }
        return data
    }

    private struct RepositoryResponse: Decodable {
        let isPrivate: Bool
        enum CodingKeys: String, CodingKey { case isPrivate = "private" }
    }

    private struct PVRResponse: Decodable {
        let enabled: Bool
    }

    private struct CreateRepoBody: Encodable {
        let name: String
        let isPrivate: Bool
        enum CodingKeys: String, CodingKey { case name, isPrivate = "private" }
    }

    private struct CreatedRepoResponse: Decodable {
        let name: String
        let htmlURL: String
        let owner: Owner
        enum CodingKeys: String, CodingKey { case name, htmlURL = "html_url", owner }
        struct Owner: Decodable { let login: String }
    }

    private struct GitHubErrorResponse: Decodable {
        let message: String
        let errors: [FieldError]?
        struct FieldError: Decodable { let message: String }
    }
}

extension HTTPGitHubClient: RepoSecurityReading, RepoSecurityWriting {
    /// `GET /repos/{owner}/{repo}` → the `private` flag (see ``RepoSecurityReading``: a private
    /// repo's advisory form is invisible to outside reporters, so this gates the whole
    /// private-vulnerability-reporting flow).
    public func isPrivate(owner: String, name: String, token: String) async throws -> Bool {
        let data = try await send(repoRequest(method: "GET", path: "/repos/\(owner)/\(name)", token: token))
        guard let repo = try? JSONDecoder().decode(RepositoryResponse.self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return repo.isPrivate
    }

    /// `GET /repos/{owner}/{repo}/private-vulnerability-reporting` → whether the private advisory
    /// channel is already enabled, so the app only offers to enable it when it's actually off.
    public func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool {
        let data = try await send(repoRequest(
            method: "GET", path: "/repos/\(owner)/\(name)/private-vulnerability-reporting", token: token))
        guard let state = try? JSONDecoder().decode(PVRResponse.self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return state.enabled
    }

    /// `PUT /repos/{owner}/{repo}/private-vulnerability-reporting` — enable only, per
    /// ``RepoSecurityWriting``'s contract (the app never disables a reporting channel it didn't
    /// create). Requires admin access; a token without it surfaces as
    /// ``GitHubRepoAPIError/unauthorized``.
    public func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws {
        // A 204 with an empty body is the documented success response — nothing to decode.
        _ = try await send(repoRequest(
            method: "PUT", path: "/repos/\(owner)/\(name)/private-vulnerability-reporting", token: token))
    }
}
