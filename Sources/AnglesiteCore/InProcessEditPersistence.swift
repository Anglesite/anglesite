import Foundation
#if canImport(Darwin)
import Darwin
import SwiftGit2

/// Imports the one committed overlay edit exported by a container without executing host tools.
/// `/usr/bin/git` is unavailable to the sandboxed MAS app (#640), so this deliberately uses the
/// already-linked libgit2 wrapper. The host must still be at the commit the container edited;
/// refusing divergence is safer than silently overwriting a native edit.
public enum InProcessEditPersistence {
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
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("anglesite-import-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temp) }
        let exported = try result(Repository.clone(from: bundleURL, to: temp, localClone: true))
        let exportedCommit = try result(exported.HEAD()).oid
        guard exportedCommit.description == commit else {
            throw SiteRuntimePersistenceError.syncFailed("exported commit did not match the requested edit")
        }
        let guestCommit = try result(exported.commit(exportedCommit))
        guard guestCommit.parents.count == 1, guestCommit.parents[0].oid == head.oid else {
            throw SiteRuntimePersistenceError.syncFailed("overlay edit conflicts with newer Source changes")
        }

        let sourceTree = try result(exported.object(from: guestCommit.tree)).asTree()
        let hostTree = try result(canonical.commit(head.oid))
        let hostRoot = try result(canonical.object(from: hostTree.tree)).asTree()
        var sourcePaths: Set<String> = []
        try materialize(tree: sourceTree, from: exported, into: sourceDirectory, prefix: "", paths: &sourcePaths)
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
