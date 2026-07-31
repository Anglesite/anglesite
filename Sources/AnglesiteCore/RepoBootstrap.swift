import Foundation
#if canImport(Darwin)
import SwiftGit2
#endif

/// One-tap "Publish to GitHub". Owns the git-side preflight (detect remote, init, commit) and
/// delegates the create-remote-and-push step to a `RepoProvider`. See #68 / the design doc.
///
/// The git `origin` is the source of truth for published state — `remote(of:)` reads it; nothing
/// is persisted app-side. On Darwin, the preflight (`remote(of:)`, `ensureCommittable`) *and* the
/// create-remote-and-push step run in-process — `/usr/bin/git` cannot execute at all under App
/// Sandbox (#640/#654), and MAS users generally won't have `gh` installed either. `.live()` picks
/// `HTTPRepoProvider` (REST API + SwiftGit2 `addRemote`/`push`, #654) on Darwin and `GHRepoProvider`
/// (subprocess `gh`/`git`) elsewhere, where there's no sandbox to route around.
/// `RepoCommandRunner` remains the seam `GHRepoProvider` and the off-Darwin preflight fallback use.
public actor RepoBootstrap {
    /// The publish pipeline's phases, in execution order — carried by
    /// ``RepoBootstrap/Event/progress(step:message:)`` so the UI can show which stage is running
    /// rather than an opaque spinner.
    public enum Step: Sendable, Equatable {
        /// Reading `origin` to detect an already-published site (the idempotence check).
        case checkingRemote
        /// Creating a git repository in a directory that isn't one yet.
        case initializing
        /// Staging the working tree and creating the initial commit.
        case committing
        /// Creating the repository on GitHub via the `RepoProvider`.
        case creatingRepo
        /// Wiring `origin` and pushing the local history up.
        case pushing
    }

    /// One update from the `publish` stream. Terminal events are ``published(_:)``,
    /// ``needsAuth``, and ``failed(reason:)`` — the stream finishes right after emitting one.
    public enum Event: Sendable, Equatable {
        /// A stage started (or completed, for `.pushing`); `message` is user-facing progress text.
        case progress(step: Step, message: String)
        /// Provider has no credentials. The UI presents a GitHub token prompt, then retries `publish`.
        case needsAuth
        /// The site is on GitHub — either just pushed, or detected as already published (in which
        /// case no other event precedes it).
        case published(RemoteRepo)
        /// The pipeline stopped; `reason` is the user-facing explanation (a `RepoBootstrapError`'s
        /// reason when the failure was anticipated, a raw error description otherwise).
        case failed(reason: String)
    }

    private let provider: RepoProvider
    private let run: RepoCommandRunner
    private let env = URL(fileURLWithPath: "/usr/bin/env")

    /// Injection seam for tests: pass a fake ``RepoProvider`` and ``RepoCommandRunner`` to drive
    /// the pipeline without touching GitHub or spawning processes. Production wiring comes from
    /// ``live(supervisor:logCenter:)``.
    public init(provider: RepoProvider, run: @escaping RepoCommandRunner) {
        self.provider = provider
        self.run = run
    }

    #if canImport(Darwin)
    /// Reads `origin` via SwiftGit2 (in-process libgit2); nil if there's no remote or `source`
    /// isn't a git repo.
    public func remote(of source: URL) async -> RemoteRepo? {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(source) else { return nil }
        guard case .success(let remote) = repo.remote(named: "origin") else { return nil }
        return RemoteRepo.parse(remoteURL: remote.URL)
    }

    /// `Repository.create` if needed, then commit if there are no commits or a dirty tree. Throws
    /// on git error. Stages by walking `status(options: [.includeUntracked])` and calling
    /// `add(path:)`/`remove(path:)` per entry — the `git add -A` equivalent; SwiftGit2 has no
    /// bulk `addAll` at the pinned revision (it lands with `push`/`addRemote` in #659).
    func ensureCommittable(
        source: URL,
        signatureFallback: Signature? = nil,
        emit: @Sendable (Event) -> Void
    ) async throws {
        SwiftGit2Bootstrap.ensureInitialized
        let repo: Repository
        switch Repository.at(source) {
        case .success(let existing):
            repo = existing
        case .failure:
            emit(.progress(step: .initializing, message: "Initializing git repository…"))
            switch Repository.create(at: source) {
            case .success(let created):
                repo = created
            case .failure(let error):
                throw RepoBootstrapError(reason: "git init failed.\n\(error.localizedDescription)")
            }
        }

        let noCommits: Bool
        if case .failure = repo.HEAD() { noCommits = true } else { noCommits = false }

        // .recurseUntrackedDirs: without it, libgit2 reports a whole new directory as a single
        // untracked entry rather than walking into it — a .env-secret nested inside a new
        // directory (e.g. config/.env.local) would be invisible to both the check below and the
        // staging loop, silently committing it.
        guard case .success(let entries) = repo.status(options: [.includeUntracked, .recurseUntrackedDirs]) else {
            throw RepoBootstrapError(reason: "Couldn't read git status.")
        }
        let dirty = !entries.isEmpty
        guard noCommits || dirty else { return }
        // A git-init'd-but-truly-empty directory (no commits, nothing to stage) must fail loudly
        // rather than create a content-less root commit — matching the old subprocess `git commit`
        // path, which reliably failed with "nothing to commit" in this case. Silently proceeding
        // would create a real (but empty) GitHub repository where publish previously refused.
        guard dirty else {
            throw RepoBootstrapError(reason: "Nothing to commit — the site directory is empty.")
        }

        // Refuse to stage likely-secret files. Staging everything would otherwise sweep
        // .env/.env.local etc. into the repo; "private by default" doesn't protect a repo later
        // made public or visible org-wide, and secrets persist in history even after a force-push.
        let secrets = Self.dotenvFiles(inStatus: entries)
        guard secrets.isEmpty else {
            throw RepoBootstrapError(reason: "Refusing to publish: \(secrets.joined(separator: ", ")) "
                + "would be committed. Add \(secrets.count == 1 ? "it" : "them") to .gitignore first.")
        }

        emit(.progress(step: .committing, message: "Committing your site…"))
        for entry in entries {
            if entry.status.contains(.workTreeDeleted), let path = Self.statusPath(entry) {
                if case .failure(let error) = repo.remove(path: path) {
                    throw RepoBootstrapError(reason: "git rm failed for \(path).\n\(error.localizedDescription)")
                }
            } else if let path = Self.statusPath(entry) {
                if case .failure(let error) = repo.add(path: path) {
                    throw RepoBootstrapError(reason: "git add failed for \(path).\n\(error.localizedDescription)")
                }
            }
        }
        let signature: Signature
        if case .success(let configuredSignature) = repo.defaultSignature() {
            signature = configuredSignature
        } else if let signatureFallback {
            // Logged, not silent — same reasoning as `GitIdentity.signature(for:)`: substituting an
            // identity changes what lands in the user's git history, and that's just as true of a
            // new site's very first commit as of any later one (PR #983 review).
            await GitIdentity.logSubstitution(signatureFallback)
            signature = signatureFallback
        } else {
            throw RepoBootstrapError(reason: "No git identity configured (user.name/user.email).")
        }
        guard case .success = repo.commit(message: "Initial commit", signature: signature) else {
            throw RepoBootstrapError(reason: "git commit failed.")
        }
    }

    /// The path a `StatusEntry` refers to: the working-tree delta's path when present (covers
    /// untracked/modified/deleted), falling back to the index delta's path for entries that are
    /// staged but otherwise unchanged in the working tree.
    private static func statusPath(_ entry: StatusEntry) -> String? {
        entry.indexToWorkDir?.newFile?.path ?? entry.indexToWorkDir?.oldFile?.path
            ?? entry.headToIndex?.newFile?.path
    }

    /// Paths among `status(options:)` entries whose filename is a dotenv secret (`.env` or
    /// `.env.<anything>`).
    static func dotenvFiles(inStatus entries: [StatusEntry]) -> [String] {
        entries.compactMap { entry -> String? in
            guard let path = statusPath(entry) else { return nil }
            let name = (path as NSString).lastPathComponent
            return (name == ".env" || name.hasPrefix(".env.")) ? path : nil
        }
    }
    #else
    /// Reads `origin`; nil if there's no remote or `source` isn't a git repo. Off-Darwin there's
    /// no App Sandbox to route around, so plain subprocess git remains correct here.
    public func remote(of source: URL) async -> RemoteRepo? {
        guard let r = try? await run(env, ["git", "remote", "get-url", "origin"], source),
              r.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: r.stdout)
    }

    /// `git init` if needed, then commit if there are no commits or a dirty tree. Throws on git error.
    func ensureCommittable(source: URL, emit: @Sendable (Event) -> Void) async throws {
        let inside = try? await run(env, ["git", "rev-parse", "--is-inside-work-tree"], source)
        if inside?.exitCode != 0 {
            emit(.progress(step: .initializing, message: "Initializing git repository…"))
            let initR = try await run(env, ["git", "init"], source)
            guard initR.exitCode == 0 else { throw RepoBootstrapError(reason: "git init failed.\n\(initR.stderr)") }
        }

        let head = try? await run(env, ["git", "rev-parse", "HEAD"], source)
        let status = try await run(env, ["git", "status", "--porcelain"], source)
        let noCommits = head?.exitCode != 0
        let dirty = !status.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard noCommits || dirty else { return }

        // Refuse to stage likely-secret files. `git add -A` would otherwise sweep .env/.env.local
        // etc. into the repo; "private by default" doesn't protect a repo later made public or
        // visible org-wide, and secrets persist in history even after a force-push.
        let secrets = Self.dotenvFiles(inPorcelain: status.stdout)
        guard secrets.isEmpty else {
            throw RepoBootstrapError(reason: "Refusing to publish: \(secrets.joined(separator: ", ")) "
                + "would be committed. Add \(secrets.count == 1 ? "it" : "them") to .gitignore first.")
        }

        emit(.progress(step: .committing, message: "Committing your site…"))
        let add = try await run(env, ["git", "add", "-A"], source)
        guard add.exitCode == 0 else { throw RepoBootstrapError(reason: "git add failed.\n\(add.stderr)") }
        let commit = try await run(env, ["git", "commit", "-m", "Initial commit"], source)
        guard commit.exitCode == 0 else { throw RepoBootstrapError(reason: "git commit failed.\n\(commit.stderr)") }
    }

    /// Paths in `git status --porcelain` output whose filename is a dotenv secret (`.env` or
    /// `.env.<anything>`). Porcelain v1 lines are `XY <path>` (or `XY <old> -> <new>` for renames).
    static func dotenvFiles(inPorcelain porcelain: String) -> [String] {
        porcelain.split(whereSeparator: \.isNewline).compactMap { line in
            guard line.count > 3 else { return nil }
            let entry = String(line.dropFirst(3))                       // strip the 2 status cols + space
            let path = entry.components(separatedBy: " -> ").last ?? entry   // rename → use the new path
            let name = (path as NSString).lastPathComponent
            return (name == ".env" || name.hasPrefix(".env.")) ? path : nil
        }
    }
    #endif

    /// Local git init+commit only — no GitHub involved. Reuses the same staging/secret-file/
    /// identity checks as `publish`'s preflight. Entry point for the new-site scaffold, which
    /// must land a real initial commit before the site can be cloned into a container runtime
    /// (an empty, commit-less repo fails `git checkout HEAD`) — see CLAUDE.md's "Git is the
    /// source of truth" (#72).
    public func commitAll(source: URL) async throws {
        #if canImport(Darwin)
        // Preserve the user's configured identity when libgit2 can resolve one. The app identity
        // is only a fallback: a sandboxed build cannot necessarily read ~/.gitconfig even when
        // Terminal can, and a commit-less new site cannot be cloned into the container runtime.
        try await ensureCommittable(source: source, signatureFallback: GitIdentity.appFallback, emit: { _ in })
        #else
        try await ensureCommittable(source: source, emit: { _ in })
        #endif
    }

    /// Detect → (auth) → ensure committable → create + push. Streams progress; settles to
    /// `.published` / `.needsAuth` / `.failed`. Idempotent: an already-published site yields
    /// `.published(existing)` with no side effects.
    public nonisolated func publish(source: URL, repoName: String, isPrivate: Bool) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let task = Task {
                let emit: @Sendable (Event) -> Void = { continuation.yield($0) }

                emit(.progress(step: .checkingRemote, message: "Checking for an existing remote…"))
                if let existing = await self.remote(of: source) {
                    emit(.published(existing)); continuation.finish(); return
                }

                if await self.provider.isAuthenticated() == false {
                    emit(.needsAuth); continuation.finish(); return
                }

                do {
                    try await self.ensureCommittable(source: source, emit: emit)
                    emit(.progress(step: .creatingRepo, message: "Creating private repository on GitHub…"))
                    // Sanitize the display name: callers pass human names ("My Cool Site!"); GitHub
                    // repo names must be URL-safe slugs, so derive one via SiteSlug.
                    let slug = SiteSlug.derive(from: repoName)
                    let created = try await self.provider.createAndPush(name: slug, isPrivate: isPrivate, source: source)
                    emit(.progress(step: .pushing, message: "Pushed to \(created.url.absoluteString)"))
                    emit(.published(created))
                } catch let err as RepoBootstrapError {
                    emit(.failed(reason: err.reason))
                } catch {
                    emit(.failed(reason: "\(error)"))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Production wiring. On Darwin, repo creation + push run in-process via `HTTPRepoProvider`
    /// (#654) — `runner` still exists for the off-Darwin `RepoProvider`/preflight fallback, so it's
    /// always built. Off-Darwin, `git`/`gh` run through `ProcessSupervisor.shared.run`; the one-shot
    /// `run` path captures rather than streams, so the runner forwards captured stdout/stderr to
    /// `LogCenter` itself — per CLAUDE.md "logs are sacred", every spawned subprocess must reach
    /// the debug pane.
    public static func live(supervisor: ProcessSupervisor = .shared, logCenter: LogCenter = .shared) -> RepoBootstrap {
        let runner: RepoCommandRunner = { executable, args, cwd in
            let result = try await supervisor.run(executable: executable, arguments: args, currentDirectoryURL: cwd)
            let source = "repo-bootstrap"
            if !result.stdout.isEmpty { await logCenter.append(source: source, stream: .stdout, text: result.stdout) }
            if !result.stderr.isEmpty { await logCenter.append(source: source, stream: .stderr, text: result.stderr) }
            return result
        }
        #if canImport(Darwin)
        return RepoBootstrap(provider: HTTPRepoProvider(), run: runner)
        #else
        return RepoBootstrap(provider: GHRepoProvider(run: runner), run: runner)
        #endif
    }
}
