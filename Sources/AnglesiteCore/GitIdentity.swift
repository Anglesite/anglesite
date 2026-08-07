#if canImport(Darwin)
import Foundation
import SwiftGit2

/// The identity app-initiated commits are made with.
///
/// `git_signature_default` (SwiftGit2's `defaultSignature()`) walks git's own config chain —
/// repo, then global, then system. Under App Sandbox that chain is truncated: `HOME` is
/// redirected into the app's container, so the user's `~/.gitconfig` is invisible to libgit2 no
/// matter how they configured git in Terminal, and only a *repo-local* identity resolves. libgit2
/// then fails with "config value 'user.name' was not found", and every commit path that treated
/// that failure as fatal did nothing at all: Delete removed the file, failed to commit, rolled
/// back, and reported nothing, so it read as "I clicked Delete and nothing happened" (#969, and
/// #656's duplicate-commit box).
///
/// Confirmed by A/B against a real sandboxed process (ad-hoc-signed bundle carrying
/// `com.apple.security.app-sandbox`, operating on a `~/Sites/*.anglesite` package with the
/// relocated git dir): the full remove→commit sequence succeeds unsandboxed via `~/.gitconfig`
/// and fails sandboxed with exactly that error. libgit2 itself is unaffected by the sandbox — the
/// same sequence succeeds sandboxed as soon as an identity is reachable, so this is an identity
/// problem, not the `/usr/bin/git`-under-sandbox problem (#640) surviving the SwiftGit2 migration.
///
/// So a resolvable identity is preferred and an app-owned one is the fallback, rather than the
/// operation failing. `RepoBootstrap.commitAll` already made exactly this call for a new site's
/// initial commit; this hoists that identity into one place so later commits match it.
public enum GitIdentity {
    /// The identity used when libgit2 can't resolve a configured one. Deliberately
    /// app-attributed rather than a guessed personal identity: the app really is the author, and
    /// synthesizing a `user@host` address the way bare `git` does would put an address the user
    /// never chose — and can't receive mail at — into permanent, publishable history.
    ///
    /// Computed rather than `static let`: `Signature.init` defaults `time` to `Date()`, and a
    /// `static let` would evaluate that default once and cache it for the process lifetime,
    /// stamping every fallback-identity commit with the same frozen timestamp instead of its
    /// actual commit time.
    public static var appFallback: Signature { Signature(name: "Anglesite", email: "noreply@anglesite.app") }

    /// `repo`'s configured identity, falling back to ``appFallback``.
    ///
    /// The fallback is logged rather than silent: it changes what lands in the user's git history,
    /// and it's the signal that tells them a repo-local identity would attribute these commits to
    /// them instead.
    public static func signature(for repo: Repository) async -> Signature {
        if case .success(let configured) = repo.defaultSignature() { return configured }
        let fallback = appFallback
        await logSubstitution(fallback)
        return fallback
    }

    /// Records that `substitute` stood in for a configured identity.
    ///
    /// Separate from ``signature(for:)`` for the one caller that can't use it:
    /// `RepoBootstrap.ensureCommittable` takes its fallback as a parameter precisely so the
    /// GitHub-publish path can pass none and *refuse* instead of substituting (its own tests pin
    /// that refusal). It still needs the substitution it does make to be logged the same way, so
    /// the logging lives here rather than inside the resolver.
    static func logSubstitution(_ substitute: Signature) async {
        await LogCenter.shared.append(
            source: "git:identity", stream: .stderr,
            text: "No git identity resolved for this site — a sandboxed app can't read ~/.gitconfig. "
                + "Using the app fallback identity for this commit. To attribute commits to you, "
                + "set one in the site's Source/: `git config user.name \"You\"` and `git config user.email you@example.com`.")
    }
}
#endif
