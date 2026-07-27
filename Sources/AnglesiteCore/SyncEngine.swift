#if canImport(Darwin)
import Foundation
import Clibgit2
import SwiftGit2
import AnglesiteSiteModel

/// Pushes and pulls a `.anglesite` package's git history through its single-file iCloud sync
/// artifact (design doc `2026-07-21-icloud-git-sync-design.md` §2/§4) — the successor to the
/// unshippable `BundleSync` (#283), which shelled out to `/usr/bin/git` and can't run under the
/// MAS App Sandbox (#640). Every git operation here goes through SwiftGit2/libgit2 in-process.
///
/// **Scope of this phase (#879).** `pull()` is fast-forward only: a diverged branch is *reported*
/// via `.diverged`, never merged — P4 (design doc §3) adds the three-way-merge reconciliation
/// exactly on top of that case (fetch the artifact's history into `refs/remotes/icloud/<branch>`
/// already happened by the time `.diverged` is returned, so P4's merge step has everything it
/// needs without re-fetching). `push()` never merges either; it just mirrors the local repo's
/// current heads into the artifact.
///
/// **Concurrency.** Like `BundleArtifact`/`InProcessGit`, every libgit2 call here assumes the
/// caller serializes access — wrapping the engine's public methods in an `actor` provides that
/// serialization *within* one `SyncEngine`. Callers must not run two `SyncEngine`s over the same
/// package concurrently (in practice there is one `SyncEngine` per open site window).
public actor SyncEngine {
    /// Lightweight message-carrying error for this file's internal `Result`-returning helpers.
    /// `String` itself can't conform to `Swift.Result`'s `Failure: Error` bound, and a plain
    /// reason string (not a case-by-case enum) is all these private helpers need — mirroring the
    /// public `PushResult`/`PullResult` cases' own `.failed(reason: String)` shape. Expressible
    /// from string literals/interpolations so call sites read exactly like `Result<T, String>`.
    private struct EngineError: Error, CustomStringConvertible, ExpressibleByStringInterpolation {
        let message: String
        init(_ message: String) { self.message = message }
        init(stringLiteral value: String) { message = value }
        init(stringInterpolation: DefaultStringInterpolation) { message = String(stringInterpolation: stringInterpolation) }
        var description: String { message }
    }

    // MARK: - Results

    public enum PushResult: Sendable, Equatable {
        /// The artifact already reflected the repo's heads — nothing written, no iCloud churn.
        case unchanged
        case pushed(refs: [SyncArtifactRef])
        case failed(reason: String)
    }

    public enum PullResult: Sendable, Equatable {
        case upToDate
        case fastForwarded(branch: String, from: String, to: String)
        /// This Mac's branch is ahead of the artifact — nothing to pull; call `push()`.
        case localAhead(branch: String)
        /// Local and artifact history have diverged. **Not merged in this phase** — this is the
        /// hook point P4's three-way merge replaces. The fetched history is already sitting at
        /// `refs/remotes/icloud/<branch>` in the repo by the time this is returned.
        case diverged(branch: String)
        /// `Source/` had a dangling gitfile, or its live repo failed to open — rebuilt from the
        /// artifact (fresh peer, or the integrity-check repair path). Any working-tree edits newer
        /// than the artifact's history landed as a snapshot commit on top, never clobbered.
        case bootstrapped(branch: String)
        /// The artifact is evicted and iCloud didn't finish downloading it within the timeout.
        case waitingForICloud
        case failed(reason: String)
    }

    // MARK: - Configuration

    /// Synthetic remote namespace fetched refs land under — kept out of the user's real
    /// `refs/heads/*`/`refs/tags/*`, matching `BundleSync`'s own convention.
    private static let namespace = "icloud"

    private let artifact: any SyncArtifact
    private let versionStore: any VersionStore
    private let materializeTimeout: TimeInterval

    public init(
        artifact: any SyncArtifact = BundleArtifact(),
        versionStore: any VersionStore = UbiquitousVersionStore(),
        materializeTimeout: TimeInterval = 15
    ) {
        self.artifact = artifact
        self.versionStore = versionStore
        self.materializeTimeout = materializeTimeout
    }

    // MARK: - Push

    /// Mirrors the repo's current heads into the artifact: no-op when they already match,
    /// otherwise a sibling-temp write, a verify pass, then a coordinated swap into place.
    public func push(package: AnglesitePackage) async -> PushResult {
        SwiftGit2Bootstrap.ensureInitialized
        switch await prepareRepository(package: package) {
        case .failure(let reason):
            return .failed(reason: reason.message)
        case .success:
            break // Either shape is fine for push — we only need a healthy repo, not its bootstrap branch.
        }

        let fileManager = FileManager.default
        do {
            try fileManager.createDirectory(at: package.syncDirectoryURL, withIntermediateDirectories: true)
        } catch {
            return .failed(reason: "couldn't create the sync directory: \(error.localizedDescription)")
        }

        // Materialize any existing artifact before comparing against it — otherwise reading a
        // not-yet-downloaded placeholder would look like "no artifact yet" and force a spurious
        // rewrite.
        if fileManager.fileExists(atPath: package.syncBundleURL.path) {
            if case .timedOut = await versionStore.materialize(at: package.syncBundleURL, timeout: materializeTimeout) {
                return .failed(reason: "waiting for iCloud to finish syncing this site's history before pushing.")
            }
        }

        let tempURL = package.syncDirectoryURL.appendingPathComponent(".\(package.syncBundleURL.lastPathComponent).push-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: tempURL) }

        let written: [SyncArtifactRef]
        do {
            written = try artifact.write(from: package.sourceURL, to: tempURL)
        } catch SyncArtifactError.noRefsToWrite {
            return .failed(reason: "this site has no commits yet — nothing to sync.")
        } catch {
            return .failed(reason: "couldn't capture this site's history: \(error.localizedDescription)")
        }

        if fileManager.fileExists(atPath: package.syncBundleURL.path),
           let existing = try? artifact.refs(of: package.syncBundleURL),
           Set(existing) == Set(written) {
            return .unchanged
        }

        do {
            try artifact.verify(artifactURL: tempURL)
        } catch {
            return .failed(reason: "the freshly written sync artifact failed verification: \(error.localizedDescription)")
        }

        do {
            try Self.coordinatedReplace(at: package.syncBundleURL, withItemAt: tempURL)
        } catch {
            return .failed(reason: "couldn't write the sync artifact into the package: \(error.localizedDescription)")
        }

        await LogCenter.shared.append(
            source: "sync:push", stream: .stdout,
            text: "wrote \(written.count) ref\(written.count == 1 ? "" : "s") to \(package.syncBundleURL.lastPathComponent)")
        return .pushed(refs: written)
    }

    // MARK: - Pull

    /// Brings the repo up to date from the artifact: materializes it if evicted, fetches into
    /// `refs/remotes/icloud/*`, and fast-forwards the current branch when it's strictly behind.
    /// A dangling gitfile or an unopenable live repo is rebuilt from the artifact first (fresh
    /// peer / integrity-check repair) — that already performs the equivalent of a pull, so this
    /// returns `.bootstrapped` without a separate fetch.
    public func pull(package: AnglesitePackage) async -> PullResult {
        SwiftGit2Bootstrap.ensureInitialized
        let repo: Repository
        switch await prepareRepository(package: package) {
        case .failure(let reason):
            return .failed(reason: reason.message)
        case .success(.bootstrapped(_, let branch)):
            return .bootstrapped(branch: branch)
        case .success(.existing(let existing)):
            repo = existing
        }

        guard FileManager.default.fileExists(atPath: package.syncBundleURL.path) else {
            return .failed(reason: "no synced history found yet at \(package.syncBundleURL.lastPathComponent).")
        }
        if case .timedOut = await versionStore.materialize(at: package.syncBundleURL, timeout: materializeTimeout) {
            return .waitingForICloud
        }

        guard case .success(let head) = repo.HEAD(), let currentBranch = head as? Branch, currentBranch.isLocal else {
            return .failed(reason: "the repo is in a detached-HEAD state — check out a branch before syncing.")
        }
        let branchName = currentBranch.name
        let localOID = currentBranch.oid

        let landed: [SyncArtifactRef]
        do {
            landed = try artifact.fetch(into: package.sourceURL, namespace: Self.namespace, from: package.syncBundleURL)
        } catch {
            return .failed(reason: "couldn't fetch the synced history: \(error.localizedDescription)")
        }

        guard let remoteRef = landed.first(where: { $0.name == "refs/remotes/\(Self.namespace)/\(branchName)" }),
              let remoteOID = OID(string: remoteRef.oid) else {
            // The artifact doesn't carry this branch at all (e.g. a peer synced a different one).
            return .upToDate
        }
        if remoteOID == localOID { return .upToDate }

        guard case .success(let counts) = repo.aheadBehind(local: localOID, upstream: remoteOID) else {
            return .failed(reason: "couldn't compare local and synced history.")
        }

        switch (counts.ahead, counts.behind) {
        case (0, 0):
            return .upToDate
        case (0, let behind) where behind > 0:
            guard case .success(let status) = repo.status(options: [.includeUntracked, .recurseUntrackedDirs]), status.isEmpty else {
                return .failed(reason: "the working tree has uncommitted changes — commit them before syncing.")
            }
            switch Self.fastForward(repo: repo, branchRefName: currentBranch.longName, to: remoteOID) {
            case .failure(let reason):
                return .failed(reason: "couldn't fast-forward: \(reason)")
            case .success:
                break
            }
            await LogCenter.shared.append(
                source: "sync:pull", stream: .stdout,
                text: "fast-forwarded \(branchName) \(localOID.description.prefix(7)) → \(remoteOID.description.prefix(7))")
            return .fastForwarded(branch: branchName, from: localOID.description, to: remoteOID.description)
        case (let ahead, 0) where ahead > 0:
            return .localAhead(branch: branchName)
        default:
            return .diverged(branch: branchName)
        }
    }

    // MARK: - Repository preparation (migration, dangling-gitfile / corrupted-repo repair)

    private enum PreparedRepository {
        case existing(Repository)
        case bootstrapped(Repository, branch: String)
    }

    /// Heals the package toward an openable split-repo layout before push/pull touch it:
    /// migrates an embedded repo (P1 `RepoRelocator`, heal-on-open), rebuilds from the artifact
    /// when the gitfile is dangling (fresh peer) or the live repo fails to open at all (integrity
    /// check — a corrupted `Config/repo.nosync` is always recoverable from the artifact).
    private func prepareRepository(package: AnglesitePackage) async -> Result<PreparedRepository, EngineError> {
        do {
            let outcome = try RepoRelocator.migrate(package: package)
            switch outcome {
            case .noRepository:
                return .failure("this site has no git history yet.")
            case .migrated, .alreadySplit:
                break
            }
        } catch RepoRelocator.RelocationError.danglingGitfile {
            return await bootstrapFromArtifact(package: package).map { .bootstrapped($0.0, branch: $0.1) }
        } catch RepoRelocator.RelocationError.conflictingRepositories(let embedded, let live) {
            return .failure("two git histories exist for this site (\(embedded.path), \(live.path)) — resolve manually before syncing.")
        } catch {
            return .failure(EngineError(error.localizedDescription))
        }

        switch Repository.at(package.sourceURL) {
        case .success(let repo):
            return .success(.existing(repo))
        case .failure:
            // Integrity check: the gitfile resolves but the live repo won't open — rebuild it.
            return await bootstrapFromArtifact(package: package).map { .bootstrapped($0.0, branch: $0.1) }
        }
    }

    /// Rebuilds `Config/repo.nosync` from the sync artifact: init an empty split-layout repo,
    /// fetch the artifact into it, point the default branch at its head, then snapshot whatever
    /// is actually on disk in `Source/` that differs from that history — a locally-synced edit
    /// newer than the artifact — as a commit on top. Never checks out over `Source/`, so a
    /// concurrent edit already sitting in the synced working tree is preserved, not clobbered.
    private func bootstrapFromArtifact(package: AnglesitePackage) async -> Result<(Repository, String), EngineError> {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: package.syncBundleURL.path) else {
            return .failure("this site's git history hasn't synced from iCloud yet.")
        }
        if case .timedOut = await versionStore.materialize(at: package.syncBundleURL, timeout: materializeTimeout) {
            return .failure("waiting for iCloud to download this site's history…")
        }

        let headerRefs: [SyncArtifactRef]
        do {
            headerRefs = try artifact.refs(of: package.syncBundleURL)
        } catch {
            return .failure("couldn't read the synced history: \(error.localizedDescription)")
        }
        guard let branch = Self.defaultBranch(headerRefs: headerRefs) else {
            return .failure("the synced history has no branches to check out.")
        }

        // Fully rebuildable from the artifact — safe to discard any stale/corrupted live repo.
        try? fileManager.removeItem(at: package.liveRepositoryURL)
        do {
            try fileManager.createDirectory(at: package.configURL, withIntermediateDirectories: true)
        } catch {
            return .failure("couldn't prepare Config/: \(error.localizedDescription)")
        }

        let repo: Repository
        switch Self.initSplitRepository(gitDir: package.liveRepositoryURL, workDir: package.sourceURL) {
        case .success(let created): repo = created
        case .failure(let reason): return .failure(reason)
        }
        // Normalize the gitfile to the canonical relative pointer every other reader
        // (RepoRelocator, the app) expects, in case init_ext's own gitlink write differs in form.
        _ = try? RepoRelocator.migrate(package: package)

        let landed: [SyncArtifactRef]
        do {
            landed = try artifact.fetch(into: package.sourceURL, namespace: Self.namespace, from: package.syncBundleURL)
        } catch {
            return .failure("couldn't fetch the synced history: \(error.localizedDescription)")
        }
        guard let branchRef = landed.first(where: { $0.name == "refs/remotes/\(Self.namespace)/\(branch)" }),
              let branchOID = OID(string: branchRef.oid) else {
            return .failure("the synced history's default branch didn't land.")
        }

        switch Self.pointBranchAndHEAD(repo: repo, branch: branch, at: branchOID) {
        case .failure(let reason): return .failure(reason)
        case .success: break
        }
        switch Self.resetIndexToTree(repo: repo, commit: branchOID) {
        case .failure(let reason): return .failure("couldn't stage the synced history's tree: \(reason)")
        case .success: break
        }

        // Snapshot: whatever's actually on disk in Source/ that differs from the bootstrapped
        // history lands as a commit on top — never clobbered by a checkout, since bootstrap never
        // touches the working directory.
        if case .success(let status) = repo.status(options: [.includeUntracked, .recurseUntrackedDirs]), !status.isEmpty {
            _ = repo.addAll()
            let signature = await GitIdentity.signature(for: repo)
            if case .failure(let error) = repo.commit(
                message: "Snapshot: local edits synced ahead of this Mac's git history",
                signature: signature
            ) {
                return .failure("couldn't snapshot local edits: \(error.localizedDescription)")
            }
        }

        await LogCenter.shared.append(
            source: "sync:bootstrap", stream: .stdout,
            text: "rebuilt \(package.liveRepositoryURL.lastPathComponent) from the synced history (\(branch))")
        return .success((repo, branch))
    }

    // MARK: - libgit2 helpers

    /// The bundle's default branch: the `refs/heads/*` ref its `HEAD` header line points at,
    /// falling back to the lexically-first head when no `HEAD` line is present. Ported from the
    /// #283 `BundleSync.defaultBranch` — same policy, now read from `SyncArtifact.refs(of:)`
    /// instead of `git bundle list-heads`.
    private static func defaultBranch(headerRefs: [SyncArtifactRef]) -> String? {
        let heads = headerRefs.filter { $0.name.hasPrefix("refs/heads/") }
        guard !heads.isEmpty else { return nil }
        if let head = headerRefs.first(where: { $0.name == "HEAD" }),
           let match = heads.first(where: { $0.oid == head.oid }) {
            return String(match.name.dropFirst("refs/heads/".count))
        }
        let firstByName = heads.min { $0.name < $1.name }!
        return String(firstByName.name.dropFirst("refs/heads/".count))
    }

    /// Force-updates `branchRefName` to `oid`, then checks out HEAD (which already points at that
    /// branch symbolically) with a safe strategy — the fast-forward's working-tree update. Safe
    /// to call only once the caller has confirmed a clean working tree.
    private static func fastForward(repo: Repository, branchRefName: String, to oid: OID) -> Result<Void, EngineError> {
        var targetOID = oid.oid
        var createdRef: OpaquePointer?
        let result = branchRefName.withCString { cName in
            git_reference_create(&createdRef, repo.pointer, cName, &targetOID, 1, nil)
        }
        if let createdRef { git_reference_free(createdRef) }
        guard result == GIT_OK.rawValue else {
            return .failure("couldn't update \(branchRefName): \(lastErrorMessage())")
        }
        guard case .success = repo.checkout(strategy: [.safe, .recreateMissing]) else {
            return .failure("checkout failed after moving \(branchRefName)")
        }
        return .success(())
    }

    /// Force-creates `refs/heads/<branch>` at `oid` and points HEAD at it symbolically —
    /// bootstrap's equivalent of `git checkout -B <branch> <oid>` without touching the index or
    /// working directory (that's `resetIndexToTree`'s job, called separately).
    private static func pointBranchAndHEAD(repo: Repository, branch: String, at oid: OID) -> Result<Void, EngineError> {
        let refName = "refs/heads/\(branch)"
        var targetOID = oid.oid
        var createdRef: OpaquePointer?
        let refResult = refName.withCString { cName in
            git_reference_create(&createdRef, repo.pointer, cName, &targetOID, 1, nil)
        }
        if let createdRef { git_reference_free(createdRef) }
        guard refResult == GIT_OK.rawValue else {
            return .failure("couldn't point \(branch) at the synced history: \(lastErrorMessage())")
        }
        let headResult = refName.withCString { cName in
            git_repository_set_head(repo.pointer, cName)
        }
        guard headResult == GIT_OK.rawValue else {
            return .failure("couldn't set HEAD to \(branch): \(lastErrorMessage())")
        }
        return .success(())
    }

    /// Resets the index to `commit`'s tree without touching the working directory or HEAD — the
    /// in-process equivalent of `git reset --mixed <commit>`. Used right after bootstrap points a
    /// fresh repo's HEAD at the artifact's history: it makes the *index* agree with that history
    /// so a subsequent `status()`/`addAll()` diffs the real on-disk `Source/` files (already
    /// synced from iCloud) against it, rather than reporting every file as newly untracked.
    private static func resetIndexToTree(repo: Repository, commit: OID) -> Result<Void, EngineError> {
        var indexPointer: OpaquePointer?
        guard git_repository_index(&indexPointer, repo.pointer) == GIT_OK.rawValue, let indexPointer else {
            return .failure("git_repository_index failed: \(lastErrorMessage())")
        }
        defer { git_index_free(indexPointer) }

        var commitOID = commit.oid
        var commitObject: OpaquePointer?
        guard git_object_lookup(&commitObject, repo.pointer, &commitOID, GIT_OBJECT_COMMIT) == GIT_OK.rawValue,
              let commitObject else {
            return .failure("git_object_lookup failed: \(lastErrorMessage())")
        }
        defer { git_object_free(commitObject) }

        guard let treeOIDPointer = git_commit_tree_id(commitObject) else {
            return .failure("git_commit_tree_id returned no tree")
        }
        var treeOID = treeOIDPointer.pointee
        var treePointer: OpaquePointer?
        guard git_tree_lookup(&treePointer, repo.pointer, &treeOID) == GIT_OK.rawValue, let treePointer else {
            return .failure("git_tree_lookup failed: \(lastErrorMessage())")
        }
        defer { git_object_free(treePointer) }

        guard git_index_read_tree(indexPointer, treePointer) == GIT_OK.rawValue else {
            return .failure("git_index_read_tree failed: \(lastErrorMessage())")
        }
        guard git_index_write(indexPointer) == GIT_OK.rawValue else {
            return .failure("git_index_write failed: \(lastErrorMessage())")
        }
        return .success(())
    }

    /// Initializes a split-layout repository directly: `gitDir` (`Config/repo.nosync`) as the
    /// real git directory with no `.git` appended (`NO_DOTGIT_DIR`), `workDir` (`Source/`) as its
    /// working tree with a *relative* gitlink written back into it (`RELATIVE_GITLINK`) — the same
    /// shape `RepoRelocator`'s migration produces, per the design doc's external fact that
    /// `git_repository_init_ext` can create exactly this layout in one call.
    private static func initSplitRepository(gitDir: URL, workDir: URL) -> Result<Repository, EngineError> {
        var options = git_repository_init_options()
        let initOptionsResult = git_repository_init_options_init(&options, UInt32(GIT_REPOSITORY_INIT_OPTIONS_VERSION))
        guard initOptionsResult == GIT_OK.rawValue else {
            return .failure("git_repository_init_options_init failed (\(initOptionsResult))")
        }
        options.flags = GIT_REPOSITORY_INIT_NO_DOTGIT_DIR.rawValue
            | GIT_REPOSITORY_INIT_MKDIR.rawValue
            | GIT_REPOSITORY_INIT_MKPATH.rawValue
            | GIT_REPOSITORY_INIT_RELATIVE_GITLINK.rawValue

        var repoPointer: OpaquePointer?
        let result = workDir.path.withCString { workdirCString -> Int32 in
            options.workdir_path = workdirCString
            return gitDir.path.withCString { gitDirCString in
                git_repository_init_ext(&repoPointer, gitDirCString, &options)
            }
        }
        guard result == GIT_OK.rawValue, let repoPointer else {
            return .failure("git_repository_init_ext failed (\(result)): \(lastErrorMessage())")
        }
        return .success(Repository(repoPointer))
    }

    private static func lastErrorMessage() -> String {
        if let error = git_error_last() {
            return String(cString: error.pointee.message)
        }
        return "unknown libgit2 error"
    }

    // MARK: - Coordinated filesystem swap

    /// Replaces `destination` with `source` under `NSFileCoordinator` — the documented way to
    /// mutate an item that may be syncing through iCloud, so peers see an atomic swap rather than
    /// a torn file. Ported from the #283 `BundleSync.coordinatedReplace`.
    private static func coordinatedReplace(at destination: URL, withItemAt source: URL) throws {
        let fileManager = FileManager.default
        var coordinationError: NSError?
        var ioError: Error?
        NSFileCoordinator().coordinate(writingItemAt: destination, options: .forReplacing, error: &coordinationError) { url in
            do {
                if fileManager.fileExists(atPath: url.path) {
                    _ = try fileManager.replaceItemAt(url, withItemAt: source)
                } else {
                    try fileManager.moveItem(at: source, to: url)
                }
            } catch {
                ioError = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let ioError { throw ioError }
    }
}
#endif
