#if canImport(Darwin)
import Foundation
import SwiftGit2

/// GitHub `RepoProvider` backed by the REST API (`HTTPGitHubClient.createRepo`) for repo creation
/// plus in-process SwiftGit2 (`addRemote`/`push`, following the #659 `InProcessGit` pattern) for
/// wiring `origin` and pushing. Sandbox-safe: no `gh` CLI, no `/usr/bin/git` subprocess — replaces
/// `GHRepoProvider` on Darwin (see `RepoBootstrap.live()`). #654.
public struct HTTPRepoProvider: RepoProvider {
    private let client: HTTPGitHubClient
    private let tokenProvider: InProcessGit.TokenProvider
    /// Where `addRemote`/`push` target, given the just-created repo. Always the real GitHub HTTPS
    /// clone URL in production; tests override it to point at a local bare repo instead, since
    /// `createRepo`'s transport is mocked and there is no real GitHub repo to push into.
    private let remoteURL: @Sendable (RemoteRepo) -> String

    /// Creates a provider. The defaults are the production configuration (real API client, Keychain
    /// token, real GitHub HTTPS clone URLs); tests override `remoteURL` to point pushes at a local
    /// bare repo, since a mocked `createRepo` never creates a real repository to push into.
    public init(
        client: HTTPGitHubClient = HTTPGitHubClient(),
        tokenProvider: @escaping InProcessGit.TokenProvider = InProcessGit.defaultTokenProvider,
        remoteURL: @escaping @Sendable (RemoteRepo) -> String = { "https://github.com/\($0.owner)/\($0.name).git" }
    ) {
        self.client = client
        self.tokenProvider = tokenProvider
        self.remoteURL = remoteURL
    }

    /// A stored, non-empty GitHub token is all "authenticated" means here — the token was already
    /// verified once at entry time when the user pasted it into Settings (`GitHubAPITokenVerifier`),
    /// the same "verify once, then just check presence" shape the Cloudflare token flow uses.
    public func isAuthenticated() async -> Bool {
        (try? tokenProvider())?.isEmpty == false
    }

    /// Creates the remote repository, wires `origin` in `source`, and pushes its current branch.
    ///
    /// Every error is thrown as a user-facing `RepoBootstrapError`. Failures *after* `createRepo`
    /// succeeds deliberately name the repository URL in their message: the remote now exists and
    /// the user owns it, so a bare "couldn't push" would misleadingly suggest nothing happened.
    public func createAndPush(name: String, isPrivate: Bool, source: URL) async throws -> RemoteRepo {
        let token = try readToken()

        let created: RemoteRepo
        do {
            created = try await client.createRepo(name: name, isPrivate: isPrivate, token: token)
        } catch let apiError as GitHubRepoAPIError {
            throw RepoBootstrapError(reason: Self.message(for: apiError))
        }

        // The remote repository now exists — every failure past this point must say so in its
        // message. A silent "couldn't push" would otherwise look like nothing happened, when
        // GitHub actually has a (possibly empty) repo the user now owns.
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(source) else {
            throw RepoBootstrapError(reason: "Created \(created.url.absoluteString), but \(source.path) isn't a git repository to push from.")
        }

        let url = remoteURL(created)
        if case .failure(let error) = repo.addRemote(named: "origin", url: url) {
            throw RepoBootstrapError(reason: "Created \(created.url.absoluteString), but couldn't set its origin remote: \(error.localizedDescription)")
        }

        // `ensureCommittable` (RepoBootstrap's preflight) has already run by the time
        // `createAndPush` is called, so HEAD always resolves; "main" only guards a detached HEAD,
        // which a freshly created-and-committed repo never is in practice.
        let branch: String
        if case .success(let head) = repo.HEAD(), let branchName = (head as? Branch)?.name {
            branch = branchName
        } else {
            branch = "main"
        }

        // HTTPS remotes authenticate with the app-owned GitHub token, matching InProcessGit's
        // push (#659); anything else (the local bare-repo fixture in tests) uses libgit2's
        // default credential resolution.
        let credentials: Credentials
        if url.hasPrefix("https://") || url.hasPrefix("http://") {
            credentials = .plaintext(username: "x-access-token", password: token)
        } else {
            credentials = .default
        }

        let refspec = "refs/heads/\(branch):refs/heads/\(branch)"
        if case .failure(let error) = repo.push(remoteName: "origin", refspec: refspec, credentials: credentials) {
            throw RepoBootstrapError(reason: "Created \(created.url.absoluteString), but the push failed: \(error.localizedDescription)")
        }

        return created
    }

    private func readToken() throws -> String {
        let token: String?
        do {
            token = try tokenProvider()
        } catch {
            throw RepoBootstrapError(reason: "Couldn't read the GitHub token from the Keychain: \(error)")
        }
        guard let token, !token.isEmpty else {
            throw RepoBootstrapError(reason: "No GitHub token found — add one in Settings → Advanced → Credentials.")
        }
        return token
    }

    private static func message(for error: GitHubRepoAPIError) -> String {
        switch error {
        case .network: return "Couldn’t reach GitHub. Check your connection and try again."
        case .unauthorized: return "GitHub rejected the token — update it in Settings → Advanced → Credentials."
        case .nameAlreadyExists: return "A repository with that name already exists on your GitHub account."
        case .http(let status): return "GitHub returned an unexpected error (HTTP \(status))."
        case .api(let message): return message
        case .malformedResponse: return "GitHub returned an unexpected response."
        }
    }
}
#endif
