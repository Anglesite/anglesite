import Foundation

/// Shared "read `origin` and parse it as a GitHub `RemoteRepo`" lookup. Extracted from
/// `PlistEditorModel.currentRemoteRepo()` and `SiteWindowModel.currentGitHubRemote()`, which had
/// each grown byte-for-byte identical copies of this (flagged in #975's final whole-branch
/// review). Both keep their own `gitRunner` init parameter as the test-injection seam and just
/// call through to this instead of re-implementing the lookup.
///
/// `RepoBootstrap.remote(of:)` (used by `PublishModel`) intentionally stays separate rather than
/// also routing through here: on Darwin it reads `origin` via direct in-process SwiftGit2 as one
/// step of `RepoBootstrap`'s own actor-owned `publish()` pipeline (the idempotence check that lets
/// an already-published site short-circuit straight to `.published`), and off-Darwin it uses
/// `RepoCommandRunner` (`executable`/`args`/`cwd`) — a different shape than `BackupCommand.GitRunner`
/// (`siteDirectory`/`arguments`). Unifying it here would mean either widening this helper's
/// contract to cover both runner shapes or changing what `RepoBootstrap` injects, for a lookup
/// that's a one-line implementation detail of a much larger create-and-push pipeline rather than a
/// standalone resolution `PlistEditorModel`/`SiteWindowModel` also need.
public enum GitRemoteResolver {
    /// Runs `git remote get-url origin` in `siteDirectory` via `runner` and parses the result.
    /// `nil` for no remote, a non-GitHub remote, or a failed git call.
    public static func origin(
        in siteDirectory: URL,
        runner: BackupCommand.GitRunner
    ) async -> RemoteRepo? {
        guard let result = try? await runner(siteDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }
}
