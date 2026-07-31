#if canImport(Darwin)
import Foundation
import Clibgit2
import SwiftGit2
import AnglesiteSiteModel

/// Commits a user's per-file resolution of a `SyncEngine.SyncConflict` (#881, design doc §3's
/// "Conflict UX" paragraph): reads both tips' versions of each conflicted path so the resolution
/// sheet can show them side by side, then — once every path has a `Choice` — replays the same
/// `git_merge_commits` three-way merge `SyncEngine.threeWayMerge` ran (deterministically
/// reproducing the same textual conflicts), resolves each conflicted index entry to the user's
/// chosen side, and commits the result with `[ourOID, theirOID]` as parents. That commit *is* the
/// merge `SyncEngine`'s own automatic three-way merge would have produced had the edits not
/// overlapped — nothing here rewrites history, it only supplies the missing human judgment call.
///
/// This module doesn't decide the pause is lifted: the caller commits a resolution via `resolve`,
/// then calls `SyncEngine.acknowledgeConflictResolved(package:)` itself — the two-step split
/// keeps this type from needing a `SyncEngine` reference at all (it operates purely via
/// `Repository`/libgit2 against `package.sourceURL`, the same live repo `SyncEngine` uses).
public actor SyncConflictResolver {
    /// Which side's content to keep for one conflicted path.
    public enum Choice: Sendable, Equatable {
        /// Keep this Mac's version (the conflict's `ourOID` side).
        case keepMine
        /// Keep the synced version from the other Mac (the conflict's `theirOID` side).
        case keepTheirs
    }

    /// Both tips' content for one conflicted path, for the resolution sheet's side-by-side view.
    /// `nil` text means that side deleted the path, or the blob is binary/too large to preview
    /// (200 KB cap — plenty for template source files, not for images).
    public struct ConflictedFile: Sendable, Equatable, Identifiable {
        /// `Identifiable` via the path — paths are unique within one conflict, and stable ids
        /// keep SwiftUI list rows from resetting as the user works through the sheet.
        public var id: String { path }
        /// The conflicted path, relative to `Source/`.
        public let path: String
        /// This Mac's version of the file, or `nil` when deleted/binary/too large (see type doc).
        public let oursText: String?
        /// The other Mac's version of the file, or `nil` when deleted/binary/too large (see type doc).
        public let theirsText: String?
    }

    /// Why a `resolve` call couldn't commit. Messages are lower-case fragments meant to be
    /// wrapped by the caller's own owner-facing sentence.
    public enum ResolveError: Error, Equatable, CustomStringConvertible {
        /// `package.sourceURL` didn't open as a git repository.
        case repositoryUnavailable
        /// The recorded conflict's `ourOID`/`theirOID` strings don't parse as commit ids.
        case invalidConflict
        /// One or more conflicted paths were given no `Choice` — a partial resolution can't
        /// produce a valid tree, so nothing was committed.
        case missingChoices(paths: [String])
        /// After applying every choice the replayed merge index still reports conflicts —
        /// committing would bake unresolved state into history, so nothing was committed.
        case stillConflicted
        /// A libgit2 call failed; the payload carries libgit2's own message for the debug pane.
        case libgit2(String)

        /// Human-readable summary of the failure, used directly in error surfaces.
        public var description: String {
            switch self {
            case .repositoryUnavailable: return "this site's git repository couldn't be opened."
            case .invalidConflict: return "the recorded conflict is missing its commit tips."
            case .missingChoices(let paths): return "no choice was made for: \(paths.joined(separator: ", "))"
            case .stillConflicted: return "some paths are still conflicted after applying the chosen resolutions."
            case .libgit2(let message): return message
            }
        }
    }

    /// Stateless apart from actor serialization — the actor wrapper exists to serialize libgit2
    /// access (not thread-safe here), not to hold configuration.
    public init() {}

    /// Reads both sides' content for every path in `conflict.conflictedPaths`, for display in the
    /// resolution sheet. Best-effort per file: a path this can't read on either side just gets
    /// `nil` text for that side rather than failing the whole read.
    public func loadConflictedFiles(package: AnglesitePackage, conflict: SyncEngine.SyncConflict) -> [ConflictedFile] {
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(package.sourceURL),
              let ourOID = OID(string: conflict.ourOID), let theirOID = OID(string: conflict.theirOID)
        else { return [] }

        return conflict.conflictedPaths.map { path in
            ConflictedFile(
                path: path,
                oursText: Self.blobText(repo: repo, commitOID: ourOID, path: path),
                theirsText: Self.blobText(repo: repo, commitOID: theirOID, path: path)
            )
        }
    }

    /// Commits `choices` as a merge resolving `conflict`. Every path in
    /// `conflict.conflictedPaths` must have a `Choice` — a partial resolution can't produce a
    /// valid tree, so this fails loudly (`.missingChoices`) rather than guessing or silently
    /// dropping a path. On success, `Source/` is checked out to the merge commit and the caller
    /// should call `SyncEngine.acknowledgeConflictResolved(package:)` to lift the push pause.
    public func resolve(
        package: AnglesitePackage,
        conflict: SyncEngine.SyncConflict,
        choices: [String: Choice]
    ) async -> Result<Void, ResolveError> {
        SwiftGit2Bootstrap.ensureInitialized
        let missing = conflict.conflictedPaths.filter { choices[$0] == nil }
        guard missing.isEmpty else { return .failure(.missingChoices(paths: missing)) }
        guard case .success(let repo) = Repository.at(package.sourceURL) else {
            return .failure(.repositoryUnavailable)
        }
        guard let ourOID = OID(string: conflict.ourOID), let theirOID = OID(string: conflict.theirOID) else {
            return .failure(.invalidConflict)
        }

        var oursGitOID = ourOID.oid
        var oursRaw: OpaquePointer?
        guard git_commit_lookup(&oursRaw, repo.pointer, &oursGitOID) == GIT_OK.rawValue, let oursRaw else {
            return .failure(.libgit2("couldn't look up this Mac's commit: \(Self.lastErrorMessage())"))
        }
        defer { git_commit_free(oursRaw) }

        var theirsGitOID = theirOID.oid
        var theirsRaw: OpaquePointer?
        guard git_commit_lookup(&theirsRaw, repo.pointer, &theirsGitOID) == GIT_OK.rawValue, let theirsRaw else {
            return .failure(.libgit2("couldn't look up the synced commit: \(Self.lastErrorMessage())"))
        }
        defer { git_commit_free(theirsRaw) }

        var mergeOptions = git_merge_options()
        guard git_merge_options_init(&mergeOptions, UInt32(GIT_MERGE_OPTIONS_VERSION)) == GIT_OK.rawValue else {
            return .failure(.libgit2("git_merge_options_init failed: \(Self.lastErrorMessage())"))
        }
        var index: OpaquePointer?
        guard git_merge_commits(&index, repo.pointer, oursRaw, theirsRaw, &mergeOptions) == GIT_OK.rawValue, let index else {
            return .failure(.libgit2("git_merge_commits failed: \(Self.lastErrorMessage())"))
        }
        defer { git_index_free(index) }

        for path in conflict.conflictedPaths {
            guard let choice = choices[path] else { continue }
            if case .failure(let error) = Self.resolveConflictEntry(index: index, path: path, choice: choice) {
                return .failure(error)
            }
        }
        guard git_index_has_conflicts(index) == 0 else {
            return .failure(.stillConflicted)
        }

        var mergedTreeOID = git_oid()
        guard git_index_write_tree_to(&mergedTreeOID, index, repo.pointer) == GIT_OK.rawValue else {
            return .failure(.libgit2("git_index_write_tree_to failed: \(Self.lastErrorMessage())"))
        }
        guard case .success(let oursCommit) = repo.commit(ourOID), case .success(let theirsCommit) = repo.commit(theirOID) else {
            return .failure(.libgit2("couldn't re-read this conflict's parent commits."))
        }
        let signature = await GitIdentity.signature(for: repo)
        let message = "Merge synced history into \(conflict.branch) (resolved conflict)"
        switch repo.commit(tree: OID(mergedTreeOID), parents: [oursCommit, theirsCommit], message: message, signature: signature) {
        case .failure(let error):
            return .failure(.libgit2(error.localizedDescription))
        case .success:
            break
        }

        guard case .success = repo.checkout(strategy: [.force, .recreateMissing]) else {
            return .failure(.libgit2("checkout failed after committing the resolution."))
        }
        return .success(())
    }

    // MARK: - Index conflict resolution

    private static func resolveConflictEntry(index: OpaquePointer, path: String, choice: Choice) -> Result<Void, ResolveError> {
        var ancestor: UnsafePointer<git_index_entry>?
        var ours: UnsafePointer<git_index_entry>?
        var theirs: UnsafePointer<git_index_entry>?
        let getResult = path.withCString { cPath in
            git_index_conflict_get(&ancestor, &ours, &theirs, index, cPath)
        }
        guard getResult == GIT_OK.rawValue else {
            // Not actually conflicted in this replayed merge (e.g. the same content on both
            // sides) — nothing to resolve for this path.
            return .success(())
        }

        // Snapshot the chosen side's scalar fields (id/mode/etc.) now — `chosen` points into
        // memory `git_index_conflict_remove` below owns and frees (including the entry's own
        // `path` C string), so nothing here can still read through that pointer afterward.
        let chosenEntrySnapshot: git_index_entry? = ((choice == .keepMine) ? ours : theirs)?.pointee

        let removeResult = path.withCString { cPath in git_index_conflict_remove(index, cPath) }
        guard removeResult == GIT_OK.rawValue else {
            return .failure(.libgit2("couldn't clear conflict markers for \(path): \(lastErrorMessage())"))
        }

        if var chosenEntry = chosenEntrySnapshot {
            // Clear the conflict stage bits (and any other flags) so this re-lands as a normal
            // stage-0 entry — the same normalization `git checkout --ours/--theirs` performs.
            chosenEntry.flags = 0
            chosenEntry.flags_extended = 0
            let addResult = path.withCString { cPath -> Int32 in
                // Repoint `path` at a C string that's alive for exactly this call — the one
                // copied from `chosen.pointee` above no longer is. `git_index_add` copies the
                // string into its own storage before returning, so it doesn't need to outlive
                // this closure.
                chosenEntry.path = cPath
                return git_index_add(index, &chosenEntry)
            }
            guard addResult == GIT_OK.rawValue else {
                return .failure(.libgit2("couldn't stage the chosen version of \(path): \(lastErrorMessage())"))
            }
        } else {
            // The chosen side deleted this path.
            let removePathResult = path.withCString { cPath in git_index_remove_bypath(index, cPath) }
            guard removePathResult == GIT_OK.rawValue else {
                return .failure(.libgit2("couldn't remove \(path): \(lastErrorMessage())"))
            }
        }
        return .success(())
    }

    // MARK: - Blob preview

    private static func blobText(repo: Repository, commitOID: OID, path: String) -> String? {
        var oid = commitOID.oid
        var commitObject: OpaquePointer?
        guard git_object_lookup(&commitObject, repo.pointer, &oid, GIT_OBJECT_COMMIT) == GIT_OK.rawValue, let commitObject else {
            return nil
        }
        defer { git_object_free(commitObject) }
        guard let treeOIDPointer = git_commit_tree_id(commitObject) else { return nil }
        var treeOID = treeOIDPointer.pointee
        var tree: OpaquePointer?
        guard git_tree_lookup(&tree, repo.pointer, &treeOID) == GIT_OK.rawValue, let tree else { return nil }
        defer { git_object_free(tree) }

        var entry: OpaquePointer?
        let entryResult = path.withCString { cPath in git_tree_entry_bypath(&entry, tree, cPath) }
        guard entryResult == GIT_OK.rawValue, let entry else { return nil }
        defer { git_tree_entry_free(entry) }
        guard git_tree_entry_type(entry) == GIT_OBJECT_BLOB, let blobOIDPointer = git_tree_entry_id(entry) else {
            return nil
        }

        var blobOID = blobOIDPointer.pointee
        var blob: OpaquePointer?
        guard git_blob_lookup(&blob, repo.pointer, &blobOID) == GIT_OK.rawValue, let blob else { return nil }
        defer { git_blob_free(blob) }
        guard git_blob_is_binary(blob) == 0 else { return nil }

        let size = git_blob_rawsize(blob)
        guard size <= 200_000, let raw = git_blob_rawcontent(blob) else { return nil }
        let data = Data(bytes: raw, count: Int(size))
        return String(data: data, encoding: .utf8)
    }

    private static func lastErrorMessage() -> String {
        if let error = git_error_last() {
            return String(cString: error.pointee.message)
        }
        return "unknown libgit2 error"
    }
}
#endif
