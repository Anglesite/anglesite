import Foundation
#if canImport(Darwin)
import Darwin
import SwiftGit2

/// Imports the one committed overlay edit exported by a container without executing host tools.
/// `/usr/bin/git` is unavailable to the sandboxed MAS app (#640), so this deliberately uses the
/// already-linked libgit2 wrapper. The host must still be at the commit the container edited;
/// refusing divergence is safer than silently overwriting a native edit.
public enum InProcessEditPersistence {
    /// Imports the guest's exported edit (a thin git bundle carrying exactly one commit) into
    /// the canonical `Source/` repository, materializes its tree into the worktree, and
    /// re-commits it under the host's identity (via `GitIdentity`, since the sandboxed app
    /// can't read `~/.gitconfig` — #969). Fast-forward only: the import is refused when
    /// `Source/` has uncommitted changes or the exported commit's parent isn't the current
    /// HEAD, because silently overwriting a native edit is worse than making the owner retry.
    ///
    /// The whole libgit2 sequence runs on a detached task — unbundling and tree
    /// materialization are blocking file I/O that must not park a cooperative-pool thread.
    ///
    /// - Parameters:
    ///   - bundleURL: The bundle file exported by the container runtime.
    ///   - commit: The full OID the caller expects the bundle to carry; a mismatch is refused
    ///     so a stale or tampered export can't land as a different edit.
    ///   - sourceDirectory: The site's canonical `Source/` git repository.
    /// - Throws: ``SiteRuntimePersistenceError/syncFailed(_:)`` for every refusal or libgit2
    ///   failure, with a human-readable reason.
    public static func importBundle(_ bundleURL: URL, commit: String, into sourceDirectory: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            try await performImport(bundleURL, commit: commit, into: sourceDirectory)
        }.value
    }

    private static func performImport(_ bundleURL: URL, commit: String, into sourceDirectory: URL) async throws {
        SwiftGit2Bootstrap.ensureInitialized
        let canonical = try result(Repository.at(sourceDirectory))
        guard case .success(let status) = canonical.status(), status.isEmpty else {
            throw SiteRuntimePersistenceError.syncFailed("canonical Source repository has uncommitted changes")
        }
        let head = try result(canonical.HEAD())
        // Unpack the guest's pack straight into this repository's object database. Cloning the
        // bundle instead — which is what this did until #988 — could never work: libgit2 has no
        // bundle support at all, so `Repository.clone(from:)` failed here every time with "could
        // not find repository at …/x.bundle" and nothing below it had ever executed. Reading the
        // bundle is a fork addition (Anglesite/SwiftGit2#4).
        //
        // The pack is thin (exported `^parent`), so it only resolves against a repository that
        // already has that parent — which is exactly the fast-forward-only precondition asserted
        // below, and `unbundle` reports a missing prerequisite as such rather than as a delta
        // failure. The guest's objects stay unreferenced afterwards; its blobs and trees dedupe
        // against the commit made below (identical content, identical OIDs), leaving only its
        // commit object, which `git gc --auto` reaps on the user's next git command in Source/.
        // The same holds when a guard below rejects the edit: unpacking necessarily precedes
        // reading the commit's parent, so a refused import leaves those objects behind too —
        // unreferenced, so HEAD, the index, and the worktree are all untouched by it.
        let exported = try result(canonical.unbundle(at: bundleURL))
        guard exported.references.count == 1, let exportedCommit = exported.references.values.first else {
            throw SiteRuntimePersistenceError.syncFailed("exported bundle did not carry exactly one ref")
        }
        guard exportedCommit.description == commit else {
            throw SiteRuntimePersistenceError.syncFailed("exported commit did not match the requested edit")
        }
        let guestCommit = try result(canonical.commit(exportedCommit))
        guard guestCommit.parents.count == 1, guestCommit.parents[0].oid == head.oid else {
            throw SiteRuntimePersistenceError.syncFailed("overlay edit conflicts with newer Source changes")
        }

        let sourceTree = try result(canonical.object(from: guestCommit.tree)).asTree()
        let hostTree = try result(canonical.commit(head.oid))
        let hostRoot = try result(canonical.object(from: hostTree.tree)).asTree()
        var sourcePaths: Set<String> = []
        try materialize(tree: sourceTree, from: canonical, into: sourceDirectory, prefix: "", paths: &sourcePaths)
        try removeMissing(tree: hostRoot, from: canonical, root: sourceDirectory, prefix: "", keeping: sourcePaths)
        _ = try result(canonical.addAll())
        // Resolved through `GitIdentity`, not `defaultSignature()` directly: under App Sandbox the
        // user's ~/.gitconfig is unreadable, so on a stock machine (no *repo-local* identity) that
        // call fails and takes the whole import with it — after `materialize`/`removeMissing` have
        // already written the edit into the worktree. That leaves Source/ dirty with an uncommitted
        // edit, which then trips this function's own `status.isEmpty` guard, so every subsequent
        // overlay edit fails too until the user commits or resets by hand (#969). The host identity
        // is what's recorded, as before — the guest's commit carries the container image's git
        // identity, which is no closer to the user's than the app's own.
        let signature = await GitIdentity.signature(for: canonical)
        _ = try result(canonical.commit(message: guestCommit.message, signature: signature))
    }

    private static func materialize(tree: Tree, from repo: Repository, into root: URL, prefix: String, paths: inout Set<String>) throws {
        for entry in tree.entries.values {
            let path = prefix.isEmpty ? entry.name : "\(prefix)/\(entry.name)"
            switch entry.object {
            case .tree:
                let directory = root.appendingPathComponent(path, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                paths.insert(path)
                try materialize(tree: try result(repo.object(from: entry.object)).asTree(), from: repo, into: root, prefix: path, paths: &paths)
            case .blob:
                let file = root.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                try result(repo.object(from: entry.object)).asBlob().data.write(to: file, options: .atomic)
                if entry.attributes == 0o100755 { _ = chmod(file.path, 0o755) }
                paths.insert(path)
            default:
                throw SiteRuntimePersistenceError.syncFailed("overlay edit contains an unsupported git object")
            }
        }
    }

    private static func removeMissing(tree: Tree, from repo: Repository, root: URL, prefix: String, keeping: Set<String>) throws {
        for entry in tree.entries.values {
            let path = prefix.isEmpty ? entry.name : "\(prefix)/\(entry.name)"
            if case .tree = entry.object {
                try removeMissing(tree: try result(repo.object(from: entry.object)).asTree(), from: repo, root: root, prefix: path, keeping: keeping)
            }
            if !keeping.contains(path) { try? FileManager.default.removeItem(at: root.appendingPathComponent(path)) }
        }
    }

    private static func result<T>(_ value: Result<T, NSError>) throws -> T {
        switch value { case .success(let value): value; case .failure(let error): throw SiteRuntimePersistenceError.syncFailed(error.localizedDescription) }
    }
}

private extension ObjectType {
    func asTree() throws -> Tree { guard let tree = self as? Tree else { throw SiteRuntimePersistenceError.syncFailed("expected git tree") }; return tree }
    func asCommit() throws -> Commit { guard let commit = self as? Commit else { throw SiteRuntimePersistenceError.syncFailed("expected git commit") }; return commit }
    func asBlob() throws -> Blob { guard let blob = self as? Blob else { throw SiteRuntimePersistenceError.syncFailed("expected git blob") }; return blob }
}
#endif
