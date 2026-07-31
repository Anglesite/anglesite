import Foundation
#if canImport(Darwin)
import SwiftGit2
#endif

/// `git init`'s failure must not be discarded: it previously was in `SitesLauncherView`'s
/// production wiring (`_ = try await ProcessSupervisor...run(...)`), which meant a failing `git
/// init` never even reached `SiteScaffolder`'s `.warning` step — the new site silently kept a
/// `Source/` with no `.git`, and could never preview (#548).
public enum GitInitError: LocalizedError, Sendable, Equatable {
    #if canImport(Darwin)
    /// The in-process libgit2 `Repository.create` failed; carries SwiftGit2's error message
    /// (there is no exit code or stderr — no subprocess ran).
    case failed(message: String)
    #else
    /// `git init` exited nonzero; carries the exit code and captured stderr so the real reason
    /// reaches the user instead of being discarded (the original #548 failure mode).
    case failed(exitCode: Int32, stderr: String)
    #endif

    /// User-facing description including whatever detail the backend produced; falls back to
    /// just the exit code when stderr was empty.
    public var errorDescription: String? {
        switch self {
        #if canImport(Darwin)
        case .failed(let message):
            return "git init failed: \(message)"
        #else
        case .failed(let exitCode, let stderr):
            let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty ? "git init exited \(exitCode)." : "git init exited \(exitCode): \(detail)"
        #endif
        }
    }
}

/// Initializes the git repository for a freshly scaffolded site's `Source/` — the step that
/// makes "git is the source of truth" (#72) true from a site's first moment. Platform-split by
/// necessity, not preference: under App Sandbox `/usr/bin/git` cannot execute at all (#640), so
/// Darwin goes through in-process libgit2 (SwiftGit2), while off-Darwin keeps a plain `git init`
/// subprocess. Both surface failure as `GitInitError` rather than discarding it (#548).
public enum GitInitRunner {
    #if canImport(Darwin)
    /// Initializes a git repository at `sourceDirectory` via SwiftGit2 (in-process libgit2, no
    /// subprocess) — `/usr/bin/git` cannot execute at all under App Sandbox (#640).
    public static func run(in sourceDirectory: URL) throws {
        SwiftGit2Bootstrap.ensureInitialized
        if case .failure(let error) = Repository.create(at: sourceDirectory) {
            throw GitInitError.failed(message: error.localizedDescription)
        }
    }
    #else
    /// Runs `git init` in `sourceDirectory` via `run`, throwing `GitInitError` (carrying stderr) on
    /// a nonzero exit instead of discarding the result. Off-Darwin there's no App Sandbox to route
    /// around, so plain subprocess git remains correct here rather than a gap to fill.
    public static func run(
        in sourceDirectory: URL,
        using run: @Sendable (_ executable: URL, _ arguments: [String], _ cwd: URL?) async throws -> ProcessSupervisor.RunResult
    ) async throws {
        let git = URL(fileURLWithPath: "/usr/bin/git")
        let result = try await run(git, ["init"], sourceDirectory)
        guard result.exitCode == 0 else {
            throw GitInitError.failed(exitCode: result.exitCode, stderr: result.stderr)
        }
    }
    #endif
}
