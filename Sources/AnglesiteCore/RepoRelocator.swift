import Foundation
import AnglesiteSiteModel

/// Moves a `.anglesite` package's embedded `Source/.git` directory to `Config/repo.nosync/`,
/// replacing it with a relative gitfile — the local half of the iCloud git-sync design (#863/#875).
/// iCloud Drive never uploads a `*.nosync` path, so the live repository stays off iCloud while
/// `Source/` keeps working as an ordinary git working tree for `cd`/git/VS Code/`git clone` — the
/// gitfile's relative `gitdir:` pointer is git's own submodule mechanism, followed transparently
/// by both stock git and libgit2.
///
/// Idempotent and resumable: `migrate` inspects the current on-disk state rather than assuming a
/// fresh embedded repo, so re-running after an interrupted migration (a crash between the
/// directory move and the gitfile write) completes it instead of erroring or duplicating work.
/// Deliberately not Darwin-gated at the type level (only the `NSFileCoordinator`-touching
/// internals are, matching `BundleSync.coordinatedReplace`) — the split-repo layout is meant to
/// apply uniformly, including on the cross-platform port (#571).
public enum RepoRelocator {
    /// `gitdir:` pointer content, relative from `Source/` to `Config/repo.nosync/`.
    static let gitfileContents = "gitdir: ../Config/repo.nosync\n"

    /// What ``migrate(package:fileManager:)`` found and did. Distinguishing the no-op cases lets
    /// callers (and tests) verify heal-on-open really was a no-op rather than silently redoing work.
    public enum MigrationResult: Sendable, Equatable {
        /// Moved an embedded `Source/.git` directory to `Config/repo.nosync/` and wrote the
        /// gitfile, or completed an interrupted prior migration (repo already relocated, gitfile
        /// missing or corrupted).
        case migrated
        /// Already in split-repo layout: `Source/.git` is the gitfile, `Config/repo.nosync/`
        /// exists, and the gitfile already carries the correct content.
        case alreadySplit
        /// Neither an embedded nor a split repository exists yet — nothing to migrate (e.g. a
        /// freshly-scaffolded skeleton).
        case noRepository
    }

    /// The states ``migrate(package:fileManager:)`` refuses to resolve automatically — both are
    /// "a human (or a later sync phase) must decide" situations, never data-loss candidates.
    public enum RelocationError: Error, Equatable, Sendable, LocalizedError {
        /// `Source/.git` is a gitfile, but its target `Config/repo.nosync/` doesn't exist on this
        /// Mac. This is the "fresh peer" case — a package synced in from iCloud before its live
        /// repo history arrived. `RepoRelocator` only relocates a repo that already exists
        /// locally; bootstrapping one from the sync bundle is a separate, later phase (#879).
        case danglingGitfile(URL)
        /// Both `Source/.git` (a directory) and `Config/repo.nosync/` exist — an ambiguous state
        /// `RepoRelocator` refuses to resolve automatically rather than risk discarding history.
        case conflictingRepositories(embedded: URL, live: URL)

        /// Owner-facing wording: phrased around consequences to the site ("history hasn't arrived
        /// yet"), not git mechanics, per the app's advise-don't-delegate rule.
        public var errorDescription: String? {
            switch self {
            case .danglingGitfile(let url):
                return "This site's local git history hasn't arrived yet (gitfile at \(url.path) has no target). Wait for iCloud to sync, or open it on the Mac that has the history."
            case .conflictingRepositories(let embedded, let live):
                return "Found two git histories for this site (\(embedded.path) and \(live.path)) — resolve this manually before continuing."
            }
        }
    }

    /// Migrates `package` to the split-repo layout if needed. Safe to call on every package open
    /// (heal-on-open): an already-split package is a no-op, and a package with no repository yet
    /// is also a no-op.
    @discardableResult
    public static func migrate(
        package: AnglesitePackage,
        fileManager: FileManager = .default
    ) throws -> MigrationResult {
        let gitPath = package.sourceURL.appendingPathComponent(".git", isDirectory: false)
        let liveRepoURL = package.liveRepositoryURL

        var gitPathIsDirectory: ObjCBool = false
        let gitPathExists = fileManager.fileExists(atPath: gitPath.path, isDirectory: &gitPathIsDirectory)
        let liveRepoExists = fileManager.fileExists(atPath: liveRepoURL.path)

        switch (gitPathExists, gitPathIsDirectory.boolValue, liveRepoExists) {
        case (false, _, false):
            return .noRepository

        case (true, true, false):
            // Embedded, unmigrated: move Source/.git -> Config/repo.nosync/, write the gitfile.
            try fileManager.createDirectory(at: package.configURL, withIntermediateDirectories: true)
            try coordinatedMove(from: gitPath, to: liveRepoURL)
            try writeGitfile(at: gitPath)
            return .migrated

        case (true, true, true):
            throw RelocationError.conflictingRepositories(embedded: gitPath, live: liveRepoURL)

        case (false, _, true):
            // Interrupted mid-migration (moved, gitfile never written) — heal by writing it.
            try writeGitfile(at: gitPath)
            return .migrated

        case (true, false, true):
            // Gitfile already present with a target — heal it only if its content is wrong
            // (corrupted, foreign, or stale), rather than trusting it blindly.
            let contents = try? String(contentsOf: gitPath, encoding: .utf8)
            if contents == Self.gitfileContents {
                return .alreadySplit
            }
            try writeGitfile(at: gitPath)
            return .migrated

        case (true, false, false):
            throw RelocationError.danglingGitfile(gitPath)
        }
    }

    // MARK: - Coordinated filesystem operations

    #if canImport(Darwin)
    /// Coordinated directory move — the documented way to relocate an item that may be under an
    /// iCloud/file-presenter's watch, matching `BundleSync.coordinatedReplace`'s pattern.
    private static func coordinatedMove(from source: URL, to destination: URL) throws {
        var coordinationError: NSError?
        var ioError: Error?
        NSFileCoordinator().coordinate(
            writingItemAt: source, options: .forMoving,
            writingItemAt: destination, options: [],
            error: &coordinationError
        ) { movingURL, destinationURL in
            do {
                try FileManager.default.moveItem(at: movingURL, to: destinationURL)
            } catch {
                ioError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let ioError { throw ioError }
    }

    private static func writeGitfile(at gitfileURL: URL) throws {
        var coordinationError: NSError?
        var ioError: Error?
        NSFileCoordinator().coordinate(writingItemAt: gitfileURL, options: [], error: &coordinationError) { url in
            do {
                try Self.gitfileContents.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                ioError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let ioError { throw ioError }
    }
    #else
    /// `NSFileCoordinator` (and the iCloud Drive sync it coordinates with) doesn't exist off
    /// Darwin, so there's no peer to race against — a direct move/write is equivalent.
    private static func coordinatedMove(from source: URL, to destination: URL) throws {
        try FileManager.default.moveItem(at: source, to: destination)
    }

    private static func writeGitfile(at gitfileURL: URL) throws {
        try Self.gitfileContents.write(to: gitfileURL, atomically: true, encoding: .utf8)
    }
    #endif
}
