import Foundation

/// One-shot orchestrator for the deterministic backup path: `git add -A` →
/// `git commit -m "Backup <ISO timestamp>"` → `git push origin <branch>`.
///
/// Pairs with the LLM-routed `/anglesite:backup` skill, which retains the broader
/// surface (restore flow, descriptive commit summaries, branch-switching, gh-auth
/// recovery). The direct path is the optimistic case the chat panel wired through
/// Claude for no reason — Claude was just calling the same git tools every time.
///
/// Pre-flight checks before any working-tree mutation:
///   1. Branch: refuse on `main`. The plugin's backup skill is explicit that backup
///      pushes go to feature/draft branches; `main` is reserved for the deploy
///      pipeline. We surface a `.failed` with no override and let the user switch
///      branches (or use the chat-routed path, which can auto-switch to `draft`).
///   2. Remote: refuse if `origin` isn't configured. There's nowhere to push to.
///   3. Status: on a clean working tree, generate no commit — but if HEAD is ahead of
///      `origin/<branch>` (an unpushed commit from a prior cancelled backup, #246), push it
///      and report `.succeeded`; only a clean tree that's also in sync yields `.noChanges`.
///
/// Then the action steps stream their output to `LogCenter` under
/// `backup:<siteID>`, so the drawer UI can show progress in real time.
public actor BackupCommand {
    /// Terminal outcome of one ``BackupCommand/backup(siteID:siteDirectory:onProgress:)`` run.
    /// Deliberately a
    /// three-way enum rather than a thrown error: a clean, in-sync tree is a normal outcome the
    /// UI narrates ("nothing to back up"), not a failure, and refusals carry a user-facing
    /// `reason` string instead of an error type callers would have to translate.
    public enum Result: Sendable, Equatable {
        /// A push landed on `origin`. `commitSHA` is the pushed HEAD — which may be a commit from
        /// a *prior* cancelled backup rather than one this run created (the clean-tree-but-ahead
        /// recovery path, #246).
        case succeeded(commitSHA: String, branch: String, remote: String)
        /// Clean working tree *and* HEAD in sync with `origin/<branch>` — nothing was committed
        /// or pushed. A clean tree alone isn't enough; see pre-flight check 3 on the type.
        case noChanges
        /// `exitCode` is `nil` for pre-spawn refusals (on `main`, no remote) and for
        /// spawn failures; otherwise it's the failing git subprocess's exit code.
        case failed(reason: String, exitCode: Int32?)
    }

    /// Runs a one-shot git command in the site directory, returns captured output.
    /// Used for introspection steps whose output we parse (`status`, `rev-parse`,
    /// `remote get-url`). Production uses `ProcessSupervisor.run(...)`; tests fake.
    public typealias GitRunner = @Sendable (_ siteDirectory: URL, _ arguments: [String]) async throws -> ProcessSupervisor.RunResult

    /// Runs a streaming git command (logs flow to `LogCenter` under `source`).
    /// Used for action steps whose output the drawer renders live (`add`, `commit`,
    /// `push`). Returns the git exit code **and** the stderr it emitted (also streamed
    /// live), so a failing step can surface git's own message — e.g. the
    /// `! [rejected] ... (fetch first)` of a push rejection — in the `.failed` reason
    /// rather than only in the drawer log. Throws only on spawn failure.
    public typealias GitStreamer = @Sendable (_ siteDirectory: URL, _ arguments: [String], _ source: String) async throws -> (exitCode: Int32, stderr: String)

    private let runner: GitRunner
    private let streamer: GitStreamer
    private let clock: @Sendable () -> Date

    /// Creates a backup command with injectable seams; production callers take the defaults
    /// (`defaultRunner`/`defaultStreamer` — in-process SwiftGit2 on Darwin, subprocess `git`
    /// elsewhere). `clock` feeds the commit-message timestamp so tests can pin it to a known
    /// instant instead of matching a live `Date()`.
    public init(
        runner: @escaping GitRunner = BackupCommand.defaultRunner,
        streamer: @escaping GitStreamer = BackupCommand.defaultStreamer,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.runner = runner
        self.streamer = streamer
        self.clock = clock
    }

    /// Runs the full pre-flight + `add` → `commit` → `push` sequence described on the type.
    /// Never throws — every failure mode folds into ``Result`` so all callers (menu command,
    /// Siri/Shortcuts intent) share one rendering path. `onProgress` receives coarse phase
    /// markers (staging/committing/pushing) for intent progress UI; detailed log lines stream to
    /// `LogCenter` under `backup:<siteID>` independently. Cooperative cancellation is honored
    /// between steps — a cancel mid-sequence yields `.failed`, and a commit stranded by a cancel
    /// before its push is recovered by the *next* backup (#246).
    public func backup(siteID: String, siteDirectory: URL, onProgress: ProgressHandler? = nil) async -> Result {
        let source = "backup:\(siteID)"

        // 0. Repository — refuse outside a git work tree with a clear, actionable message.
        // `git rev-parse --is-inside-work-tree` exits 0 inside any repo (including a fresh
        // one with no commits) and non-zero outside one, so it distinguishes "not a repo"
        // from the later "couldn't read branch"/"no remote" cases that would otherwise
        // produce a confusing diagnosis on a plain directory.
        do {
            let result = try await runner(siteDirectory, ["rev-parse", "--is-inside-work-tree"])
            guard result.exitCode == 0 else {
                return .failed(
                    reason: "this site isn't a git repository — run `git init` and add an `origin` remote, or use `/anglesite:backup` in chat to set it up.",
                    exitCode: nil
                )
            }
        } catch {
            return .failed(reason: "couldn't check the git repository: \(error)", exitCode: nil)
        }

        // 1. Branch — refuse on main. Done first so a user who's on main isn't
        // surprised by a "no changes" message that would mask the real issue
        // when they later try to back up actual work.
        let branch: String
        do {
            let result = try await runner(siteDirectory, ["rev-parse", "--abbrev-ref", "HEAD"])
            guard result.exitCode == 0 else {
                return .failed(reason: "couldn't read current branch (`git rev-parse` exit \(result.exitCode))", exitCode: result.exitCode)
            }
            branch = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return .failed(reason: "couldn't run `git rev-parse`: \(error)", exitCode: nil)
        }
        if branch == "main" {
            return .failed(
                reason: "backup refuses to push to `main` — that's the deploy branch. Switch to `draft` (or another working branch) and try again.",
                exitCode: nil
            )
        }

        // 2. Remote — refuse when `origin` isn't configured. `git remote get-url`
        // exits non-zero with an empty stdout when the remote doesn't exist. This is the
        // remote *URL*; the git operations below address the remote by name (`origin`), so the
        // URL is only carried through to the `.succeeded` result for the caller's reference.
        let remoteURL: String
        do {
            let result = try await runner(siteDirectory, ["remote", "get-url", "origin"])
            guard result.exitCode == 0 else {
                return .failed(
                    reason: "no `origin` remote configured — run `/anglesite:backup` in chat to set one up, or add one with `git remote add origin <url>`.",
                    exitCode: nil
                )
            }
            remoteURL = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !remoteURL.isEmpty else {
                return .failed(reason: "the `origin` remote is configured but empty.", exitCode: nil)
            }
        } catch {
            return .failed(reason: "couldn't read `origin` remote: \(error)", exitCode: nil)
        }

        // 3. Status — on a clean working tree there's nothing new to commit, but HEAD may
        // still be *ahead* of the remote: a prior backup that committed and was cancelled (or
        // failed) before its push leaves an unpushed commit (#246). A naive `.noChanges` here
        // would silently strand that work. So on a clean tree we check the ahead-count and,
        // when there are pending commits, push them and report `.succeeded` instead.
        do {
            let result = try await runner(siteDirectory, ["status", "--porcelain"])
            guard result.exitCode == 0 else {
                return .failed(reason: "`git status` exited \(result.exitCode)", exitCode: result.exitCode)
            }
            if result.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return await pushPendingCommitsIfAhead(branch: branch, remoteURL: remoteURL, in: siteDirectory, source: source, onProgress: onProgress)
            }
        } catch {
            return .failed(reason: "couldn't run `git status`: \(error)", exitCode: nil)
        }

        // 4. add → 5. commit → 6. read HEAD SHA → 7. push.
        // A CancellableIntent (Siri/Shortcuts) may cancel between steps; bail before issuing the
        // next git mutation. The streamed step itself SIGTERMs on cancel (see defaultStreamer).
        if Task.isCancelled { return .failed(reason: "backup canceled", exitCode: nil) }
        onProgress?(.backupStaging)
        if let failure = await streamGit(["add", "-A"], in: siteDirectory, source: source, label: "git add") {
            return failure
        }
        // Note: cancelling after commit but before push leaves a local commit; the next backup detects it (ahead of origin with a clean tree) and pushes it — see `pushPendingCommitsIfAhead` (#246).
        if Task.isCancelled { return .failed(reason: "backup canceled", exitCode: nil) }
        onProgress?(.backupCommitting)
        let commitMessage = "Backup \(Self.iso8601Formatter.string(from: clock()))"
        if let failure = await streamGit(["commit", "-m", commitMessage], in: siteDirectory, source: source, label: "git commit") {
            return failure
        }
        let sha: String
        do {
            let result = try await runner(siteDirectory, ["rev-parse", "HEAD"])
            guard result.exitCode == 0 else {
                return .failed(reason: "couldn't read commit SHA (`git rev-parse HEAD` exit \(result.exitCode))", exitCode: result.exitCode)
            }
            sha = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return .failed(reason: "couldn't read commit SHA: \(error)", exitCode: nil)
        }
        if Task.isCancelled { return .failed(reason: "backup canceled", exitCode: nil) }
        onProgress?(.backupPushing)
        if let failure = await streamGit(["push", "origin", branch], in: siteDirectory, source: source, label: "git push") {
            return failure
        }

        return .succeeded(commitSHA: sha, branch: branch, remote: remoteURL)
    }

    // MARK: - Helpers

    /// Streams a single git action and maps the exit reason into a terminal `Result`.
    /// Returns `nil` on success — the caller can keep going.
    private func streamGit(
        _ arguments: [String],
        in siteDirectory: URL,
        source: String,
        label: String
    ) async -> Result? {
        do {
            let (exit, stderr) = try await streamer(siteDirectory, arguments, source)
            if exit == 0 { return nil }
            let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return .failed(
                reason: "`\(label)` failed (exit \(exit))" + (detail.isEmpty ? "" : ": \(detail)"),
                exitCode: exit
            )
        } catch {
            return .failed(reason: "couldn't spawn `\(label)`: \(error)", exitCode: nil)
        }
    }

    /// Handles the clean-tree case: pushes any commit(s) that are ahead of `origin/<branch>`
    /// and reports `.succeeded`, otherwise returns `.noChanges`. Covers the cancelled-after-
    /// commit backup (#246), where a commit was made locally but never pushed.
    ///
    /// Ahead-ness is measured against the remote-tracking ref (`origin/<branch>`), which
    /// `git push origin <branch>` keeps current — rather than `@{u}`, since a plain push
    /// (no `-u`) never configures upstream tracking. If that ref doesn't exist (the branch
    /// was never pushed), `git rev-list` exits non-zero; we treat that as "can't determine"
    /// and preserve the historical `.noChanges` rather than erroring or pushing blindly.
    private func pushPendingCommitsIfAhead(
        branch: String,
        remoteURL: String,
        in siteDirectory: URL,
        source: String,
        onProgress: ProgressHandler?
    ) async -> Result {
        let aheadCount: Int
        do {
            let result = try await runner(siteDirectory, ["rev-list", "--count", "origin/\(branch)..HEAD"])
            guard result.exitCode == 0 else { return .noChanges }
            aheadCount = Int(result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        } catch {
            return .noChanges
        }
        guard aheadCount > 0 else { return .noChanges }

        // Read the SHA we'll report before pushing it.
        let sha: String
        do {
            let result = try await runner(siteDirectory, ["rev-parse", "HEAD"])
            guard result.exitCode == 0 else {
                return .failed(reason: "couldn't read commit SHA (`git rev-parse HEAD` exit \(result.exitCode))", exitCode: result.exitCode)
            }
            sha = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            return .failed(reason: "couldn't read commit SHA: \(error)", exitCode: nil)
        }

        // Bail before the push if the task was cancelled during the rev-list/rev-parse hops.
        // `Task.isCancelled` (not `try? Task.checkCancellation()` — which would swallow the
        // error and push anyway) actually short-circuits, matching the step-level guards the
        // normal add→commit→push path gets from the cancellation work (#238).
        if Task.isCancelled { return .failed(reason: "backup canceled", exitCode: nil) }
        onProgress?(.backupPushing)
        if let failure = await streamGit(["push", "origin", branch], in: siteDirectory, source: source, label: "git push") {
            return failure
        }
        return .succeeded(commitSHA: sha, branch: branch, remote: remoteURL)
    }

    /// ISO-8601 timestamps in commit messages so they sort correctly under `git log` and
    /// stay locale-agnostic. `Backup 2026-06-10T14:13:20Z` — unambiguous, machine-friendly.
    ///
    /// Configured once here and only read via `string(from:)` afterward. Apple doesn't document
    /// `ISO8601DateFormatter` as thread-safe, so `nonisolated(unsafe)` is a deliberate choice
    /// asserting that never-mutated-after-init invariant.
    private nonisolated(unsafe) static let iso8601Formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    // MARK: - Default production seams

    #if canImport(Darwin)
    /// Default `GitRunner`: in-process SwiftGit2 via `InProcessGit` (#653) — `/usr/bin/git`
    /// cannot execute at all under the MAS App Sandbox (#640), so the old subprocess default
    /// was dead code exactly where it mattered.
    public static let defaultRunner: GitRunner = { siteDirectory, arguments in
        await InProcessGit.run(siteDirectory: siteDirectory, arguments: arguments)
    }
    #else
    /// Default `GitRunner`: shells out to `git` via `ProcessSupervisor.shared.run(...)`.
    /// Uses `/usr/bin/env` so the user's shell-resolved `git` is used (matches what they'd
    /// run in Terminal). Off-Darwin there's no App Sandbox to route around, so subprocess
    /// git remains correct here rather than a gap to fill.
    public static let defaultRunner: GitRunner = { siteDirectory, arguments in
        try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["git"] + arguments,
            currentDirectoryURL: siteDirectory
        )
    }
    #endif

    #if canImport(Darwin)
    /// Default `GitStreamer`: in-process SwiftGit2 via `InProcessGit` (#653). Step-level
    /// progress lines land in `LogCenter` under `source` (so the drawer still narrates the
    /// backup), and failure detail comes back directly as `stderr` — no subprocess, no
    /// subscription dance.
    public static let defaultStreamer: GitStreamer = { siteDirectory, arguments, source in
        await InProcessGit.stream(siteDirectory: siteDirectory, arguments: arguments, source: source)
    }
    #else
    /// Default `GitStreamer`: launches `git` via `ProcessSupervisor.shared.launch(...)` so
    /// stdout/stderr flow into `LogCenter` line-by-line under `source`. Waits for exit and
    /// returns the code; `git push`'s auth-prompt back-and-forth is therefore visible in
    /// the drawer in real time.
    ///
    /// It also subscribes to `LogCenter` *before* launching and collects this run's stderr
    /// lines, so a non-zero exit can carry git's own message back to the caller. Subscribing
    /// before launch (rather than reading a snapshot afterward) scopes the capture to exactly
    /// this invocation — a snapshot would also include earlier runs under the same `source`.
    public static let defaultStreamer: GitStreamer = { siteDirectory, arguments, source in
        let subscription = await LogCenter.shared.subscribe()
        let collector = StderrCollector()
        let collectTask = Task {
            for await line in subscription.stream where line.source == source && line.stream == .stderr {
                await collector.append(line.text)
            }
        }

        let handle = try await ProcessSupervisor.shared.launch(
            source: source,
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["git"] + arguments,
            currentDirectoryURL: siteDirectory
        )
        let reason = await withTaskCancellationHandler {
            await ProcessSupervisor.shared.waitForExit(handle)
        } onCancel: {
            Task { await ProcessSupervisor.shared.terminate(handle) }
        }

        // `waitForExit` only resumes once the supervisor's pipe-drain Tasks have finished, so
        // every stderr line is already in LogCenter; cancelling ends the stream and the await
        // drains any still-buffered lines into the collector before we read it.
        subscription.cancel()
        _ = await collectTask.value
        let stderr = await collector.joined()

        switch reason {
        case .exited(let code):                return (code, stderr)
        case .terminated:                       return (-1, stderr)
        case .retriesExhausted(let lastCode):   return (lastCode, stderr)
        }
    }
    #endif
}

#if !canImport(Darwin)
/// Accumulates streamed stderr lines for `BackupCommand.defaultStreamer`. An actor so the
/// `@Sendable` collect Task can append without a lock.
private actor StderrCollector {
    private var lines: [String] = []
    func append(_ line: String) { lines.append(line) }
    func joined() -> String { lines.joined(separator: "\n") }
}
#endif
