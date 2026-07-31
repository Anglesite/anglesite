#if canImport(Darwin)
import Foundation
import SwiftGit2

/// Executes `BackupCommand`'s git vocabulary in-process via SwiftGit2 (libgit2) — `/usr/bin/git`
/// cannot execute at all under the MAS App Sandbox (#640/#653). This is deliberately an
/// interpreter for the *exact* argument vectors `BackupCommand` issues, not a general git CLI
/// shim: the vocabulary is closed (nine shapes: `rev-parse --is-inside-work-tree`, `rev-parse
/// --abbrev-ref HEAD`, `rev-parse HEAD`, `remote get-url <name>`, `status --porcelain`,
/// `rev-list --count <upstream>..HEAD`, `add -A`, `commit -m <msg>`, `push <remote> <branch>`),
/// both ends live in this module, and keeping the `GitRunner`/`GitStreamer` seams' shape means
/// the command's orchestration — refusal ordering, cancellation guards, the #246 unpushed-commit
/// check — and its entire test suite carry over unchanged. An argument vector outside the
/// vocabulary fails loudly (exit 64) rather than guessing.
///
/// Exit codes are synthesized: 0 success, 1 generic failure, 128 "not a repository" (matching
/// subprocess git's fatal exit), 64 unsupported usage. `BackupCommand` only branches on
/// zero/non-zero; the codes exist for log readability.
///
/// libgit2 calls are blocking (push does real network I/O), so they run on a Dispatch global
/// queue via `offPool` rather than on the cooperative pool. Like `NativeContentOperations`,
/// each call opens its own `Repository` handle for the site directory it's given.
///
/// Concurrency: the fork's own test suite runs `.serialized` because uncoordinated concurrent
/// libgit2 use is unsafe in general — but the risk that guards against (racing the process-wide,
/// lazily-populated libgit2 config-search-path cache on first use) is already closed here by
/// `SwiftGit2Bootstrap.ensureInitialized`'s `static let`: Swift guarantees a `static let`
/// initializer runs exactly once even when first touched concurrently from multiple threads, so
/// every caller blocks on the same one-time `SwiftGit2Init()` before any repository operation
/// runs. Past that, two concurrent calls against *different* site directories each open their own
/// `Repository` handle and don't share libgit2 state, so concurrent backups of different sites
/// are safe. Two concurrent calls against the *same* site directory are not coordinated — the
/// same class of hazard as two `git` processes racing on one working directory, not something new
/// this port introduced.
public enum InProcessGit {
    /// Reads the GitHub personal access token used for HTTPS pushes. The default reads the
    /// app-owned Keychain slot (`SecretAccounts.gitHubToken`); tests inject their own.
    public typealias TokenProvider = @Sendable () throws -> String?

    /// The production ``TokenProvider``: reads the app-owned Keychain slot via
    /// ``PlatformSecretStore``. It's the default argument of
    /// ``stream(siteDirectory:arguments:source:tokenProvider:)``, so only tests (which must not
    /// touch the real Keychain) ever pass a provider explicitly.
    public static let defaultTokenProvider: TokenProvider = {
        try PlatformSecretStore.make().readGitHubToken()
    }

    // MARK: - Introspection (BackupCommand.GitRunner shape)

    /// Handles: `rev-parse --is-inside-work-tree`, `rev-parse --abbrev-ref HEAD`,
    /// `rev-parse HEAD`, `remote get-url <name>`, `status --porcelain`,
    /// `rev-list --count <upstream>..HEAD`.
    public static func run(siteDirectory: URL, arguments: [String]) async -> ProcessSupervisor.RunResult {
        await offPool { runSync(siteDirectory: siteDirectory, arguments: arguments) }
    }

    // MARK: - Mutations (BackupCommand.GitStreamer shape)

    /// Handles: `add -A`, `commit -m <message>`, `push <remote> <branch>`. Step-level progress
    /// and failure detail stream to `LogCenter` under `source` (logs are sacred); the returned
    /// `stderr` carries the same failure detail so `BackupCommand` can surface it in the
    /// `.failed` reason.
    ///
    /// Unlike the subprocess streamer there is no process to SIGTERM on cancellation:
    /// `BackupCommand`'s between-step guards still apply, but an in-flight push runs to
    /// completion — the #246 ahead-check recovers the "committed, cancelled before push
    /// finished" case either way.
    public static func stream(
        siteDirectory: URL,
        arguments: [String],
        source: String,
        tokenProvider: @escaping TokenProvider = InProcessGit.defaultTokenProvider
    ) async -> (exitCode: Int32, stderr: String) {
        let log = LogCenter.shared
        // Narrate the slow step up front: everything else here is local and fast, but a push
        // does network I/O, and the drawer should show "pushing…" while it happens — not a
        // batch of lines after the fact.
        if arguments.count == 3, arguments[0] == "push" {
            await log.append(source: source, stream: .stdout, text: "pushing \(arguments[2]) to \(arguments[1])…")
        }
        let result = await offPool { streamSync(siteDirectory: siteDirectory, arguments: arguments, tokenProvider: tokenProvider) }
        for line in result.stdoutLines {
            await log.append(source: source, stream: .stdout, text: line)
        }
        if !result.stderr.isEmpty {
            await log.append(source: source, stream: .stderr, text: result.stderr)
        }
        return (result.exitCode, result.stderr)
    }

    // MARK: - Introspection implementation

    private static func runSync(siteDirectory: URL, arguments: [String]) -> ProcessSupervisor.RunResult {
        SwiftGit2Bootstrap.ensureInitialized

        func repository() -> Result<Repository, NSError> { Repository.at(siteDirectory) }

        /// Opens the repo, runs `body`, and maps success stdout / failure stderr into a
        /// `RunResult`. Failure exit is 1 — `BackupCommand` only branches on non-zero.
        func withRepository(_ body: (Repository) -> Result<String, NSError>) -> ProcessSupervisor.RunResult {
            switch repository().flatMap(body) {
            case .success(let stdout):
                return .init(stdout: stdout, stderr: "", exitCode: 0)
            case .failure(let error):
                return .init(stdout: "", stderr: errorText(error), exitCode: 1)
            }
        }

        if arguments == ["rev-parse", "--is-inside-work-tree"] {
            switch repository() {
            case .success:
                return .init(stdout: "true\n", stderr: "", exitCode: 0)
            case .failure(let error):
                return .init(stdout: "", stderr: errorText(error), exitCode: 128)
            }
        }

        if arguments == ["rev-parse", "--abbrev-ref", "HEAD"] {
            return withRepository { repo in
                repo.HEAD().map { head in
                    // A branch resolves to its short name; a detached HEAD prints "HEAD",
                    // matching subprocess `rev-parse --abbrev-ref`.
                    ((head as? Branch)?.name ?? "HEAD") + "\n"
                }
            }
        }

        if arguments == ["rev-parse", "HEAD"] {
            return withRepository { repo in
                repo.HEAD().map { $0.oid.description + "\n" }
            }
        }

        if arguments.count == 3, arguments[0] == "remote", arguments[1] == "get-url" {
            let name = arguments[2]
            return withRepository { repo in
                repo.remote(named: name).map { $0.URL + "\n" }
            }
        }

        if arguments == ["status", "--porcelain"] {
            return withRepository { repo in
                repo.status().map { entries in
                    entries.map { entry in
                        let path = entry.indexToWorkDir?.newFile?.path
                            ?? entry.headToIndex?.newFile?.path
                            ?? entry.headToIndex?.oldFile?.path
                            ?? "(unknown path)"
                        return "\(porcelainCode(for: entry.status)) \(path)"
                    }
                    .joined(separator: "\n")
                }
            }
        }

        if arguments.count == 3, arguments[0] == "rev-list", arguments[1] == "--count",
           arguments[2].hasSuffix("..HEAD") {
            let upstreamName = String(arguments[2].dropLast("..HEAD".count))
            guard upstreamName.contains("/") else { return unsupported(arguments) }
            return withRepository { repo in
                repo.HEAD().flatMap { head in
                    repo.remoteBranch(named: upstreamName).flatMap { upstream in
                        repo.aheadBehind(local: head.oid, upstream: upstream.oid).map { "\($0.ahead)\n" }
                    }
                }
            }
        }

        return unsupported(arguments)
    }

    // MARK: - Mutation implementation

    private struct StreamOutcome {
        var exitCode: Int32
        var stderr: String
        var stdoutLines: [String] = []
    }

    private static func streamSync(
        siteDirectory: URL,
        arguments: [String],
        tokenProvider: TokenProvider
    ) -> StreamOutcome {
        SwiftGit2Bootstrap.ensureInitialized

        let repo: Repository
        switch Repository.at(siteDirectory) {
        case .success(let opened): repo = opened
        case .failure(let error): return .init(exitCode: 128, stderr: errorText(error))
        }

        if arguments == ["add", "-A"] {
            switch repo.addAll() {
            case .success:
                return .init(exitCode: 0, stderr: "", stdoutLines: ["staged all changes (add -A)"])
            case .failure(let error):
                return .init(exitCode: 1, stderr: errorText(error))
            }
        }

        if arguments.count == 3, arguments[0] == "commit", arguments[1] == "-m" {
            let message = arguments[2]
            let result = repo.defaultSignature().flatMap { signature in
                repo.commit(message: message, signature: signature)
            }
            switch result {
            case .success(let commit):
                return .init(exitCode: 0, stderr: "", stdoutLines: ["committed \(commit.oid.description.prefix(7)): \(message)"])
            case .failure(let error):
                // The most likely failure is a missing identity (git's own "Please tell me who
                // you are"): git_signature_default needs user.name/user.email, and the sandboxed
                // app can't read ~/.gitconfig — only the site repo's local config.
                let hint = errorText(error).lowercased().contains("config")
                    ? " — set an identity in the site repository: `git config user.name \"You\"` and `git config user.email you@example.com` in \(siteDirectory.path)"
                    : ""
                return .init(exitCode: 1, stderr: errorText(error) + hint)
            }
        }

        if arguments.count == 3, arguments[0] == "push" {
            return push(remoteName: arguments[1], branch: arguments[2], in: repo, tokenProvider: tokenProvider)
        }

        let result = unsupported(arguments)
        return .init(exitCode: result.exitCode, stderr: result.stderr)
    }

    private static func push(
        remoteName: String,
        branch: String,
        in repo: Repository,
        tokenProvider: TokenProvider
    ) -> StreamOutcome {
        let remoteURL: String
        switch repo.remote(named: remoteName) {
        case .success(let remote): remoteURL = remote.URL
        case .failure(let error): return .init(exitCode: 1, stderr: errorText(error))
        }

        // HTTPS remotes authenticate with the app-owned GitHub token; anything else (file://
        // test remotes, exotic setups) goes through libgit2's default credentials. A missing
        // token fails fast with a remediation instead of a network round-trip that would end
        // in an opaque libgit2 auth error.
        let credentials: Credentials
        if remoteURL.hasPrefix("https://") || remoteURL.hasPrefix("http://") {
            let token: String?
            do {
                token = try tokenProvider()
            } catch {
                return .init(exitCode: 1, stderr: "couldn't read the GitHub token from the Keychain: \(error)")
            }
            guard let token, !token.isEmpty else {
                return .init(
                    exitCode: 1,
                    stderr: "pushing to \(remoteURL) needs GitHub authentication — add a GitHub personal access token in Settings, then run Backup again."
                )
            }
            credentials = .plaintext(username: "x-access-token", password: token)
        } else {
            credentials = .default
        }

        let refspec = "refs/heads/\(branch):refs/heads/\(branch)"
        switch repo.push(remoteName: remoteName, refspec: refspec, credentials: credentials) {
        case .success:
            return .init(exitCode: 0, stderr: "", stdoutLines: ["push complete: \(branch) → \(remoteURL)"])
        case .failure(let error):
            var detail = errorText(error)
            let lowered = detail.lowercased()
            if remoteURL.hasPrefix("http"), lowered.contains("auth") || lowered.contains("credential") || lowered.contains("401") {
                detail += " — your GitHub token may have expired or lack access to this repository; update it in Settings."
            }
            return .init(exitCode: 1, stderr: detail)
        }
    }

    // MARK: - Helpers

    private static func unsupported(_ arguments: [String]) -> ProcessSupervisor.RunResult {
        return .init(
            stdout: "",
            stderr: "unsupported in-process git invocation: git \(arguments.joined(separator: " "))",
            exitCode: 64
        )
    }

    private static func errorText(_ error: NSError) -> String {
        error.localizedDescription
    }

    /// Maps a libgit2 `Diff.Status` set to git's two-letter porcelain code (`git status
    /// --porcelain`'s XY: index status, then worktree status) — real codes rather than a
    /// fabricated `??` for every entry. `BackupCommand` only checks `.isEmpty` today, but a
    /// future caller parsing codes (or a human reading `LogCenter`) should see the truth.
    /// `conflicted` collapses every unmerged combination to `UU` — real git distinguishes which
    /// side changed (`AA`, `DU`, `UD`, …), a distinction nothing here currently consumes.
    private static func porcelainCode(for status: Diff.Status) -> String {
        if status.contains(.conflicted) { return "UU" }
        if status.contains(.workTreeNew) { return "??" }

        var x: Character = " "
        if status.contains(.indexNew) { x = "A" }
        else if status.contains(.indexModified) { x = "M" }
        else if status.contains(.indexDeleted) { x = "D" }
        else if status.contains(.indexRenamed) { x = "R" }
        else if status.contains(.indexTypeChange) { x = "T" }

        var y: Character = " "
        if status.contains(.workTreeModified) { y = "M" }
        else if status.contains(.workTreeDeleted) { y = "D" }
        else if status.contains(.workTreeTypeChange) { y = "T" }
        else if status.contains(.workTreeRenamed) { y = "R" }

        return "\(x)\(y)"
    }

    /// Runs blocking libgit2 work on a Dispatch global queue so a slow network push never
    /// parks a cooperative-pool thread.
    private static func offPool<T: Sendable>(_ work: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: work())
            }
        }
    }
}
#endif
