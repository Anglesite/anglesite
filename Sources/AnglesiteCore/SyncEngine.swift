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
/// **Divergence reconciliation (#880, design doc §3).** When local history and the artifact
/// diverge, `pull()` doesn't just report it: it snapshots local changes, fetches every
/// NSFileVersion conflict version of the artifact alongside the current one, and folds each tip
/// into the local branch — fast-forwarding when possible, three-way-merging (auto-committed) on a
/// clean divergence. A textual conflict stops the line and surfaces as a typed `SyncConflict`,
/// never auto-resolved or rewound; full convergence checks the merged history out and pushes it
/// back. `push()` never merges; it just mirrors the local repo's current heads into the artifact,
/// pausing while a conflict from an earlier `pull()` is unacknowledged.
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

    /// Outcome of one `push()`. Distinguishes "nothing to do" from "wrote the artifact" so
    /// callers can avoid logging/status churn on the overwhelmingly common no-op case.
    public enum PushResult: Sendable, Equatable {
        /// The artifact already reflected the repo's heads — nothing written, no iCloud churn.
        case unchanged
        /// A fresh artifact was verified and swapped into place; `refs` is what it now carries.
        case pushed(refs: [SyncArtifactRef])
        /// A prior `pull()` hit a textual merge conflict on this branch (`SyncConflict`) that
        /// hasn't been acknowledged resolved yet (`acknowledgeConflictResolved(package:)`) —
        /// design doc §3: "pushes of that branch pause" while the local copy stays editable and
        /// incoming bundles keep fetching. Not an error: the caller should surface the pending
        /// conflict (`pendingConflict(package:)`) rather than retry.
        case pausedForConflict(branch: String)
        /// The push couldn't complete; `reason` is already owner-readable prose.
        case failed(reason: String)
    }

    /// Outcome of one `pull()` — one case per distinct way local history can relate to the
    /// artifact's, so callers (``SyncScheduler``, the status UI) never have to re-derive what
    /// happened from repo state.
    public enum PullResult: Sendable, Equatable {
        /// The artifact carries nothing this repo doesn't already have (including "artifact
        /// doesn't carry the current branch at all").
        case upToDate
        /// The current branch was strictly behind and moved forward to the artifact's tip
        /// (`from`/`to` are full commit ids, for logging).
        case fastForwarded(branch: String, from: String, to: String)
        /// This Mac's branch is ahead of the artifact — nothing to pull; call `push()`.
        case localAhead(branch: String)
        /// Local and artifact history diverged, and every fetched tip (the current artifact plus
        /// every NSFileVersion conflict version) merged or fast-forwarded cleanly — the merged
        /// history is checked out into `Source/` and already pushed back to the artifact (design
        /// doc §3 steps 3–4). `mergedTips` lists the sources folded in, in the order they were
        /// applied: `"icloud"` for the current artifact, `"peer-<n>"` for the nth conflict
        /// version.
        case merged(branch: String, mergedTips: [String])
        /// A three-way merge against `theirSource`'s tip hit textual conflicts — never
        /// auto-resolved, never rewound (design doc §3 step 3). Local HEAD is exactly where it
        /// was before this merge attempt; any earlier tip in this same pull that merged cleanly
        /// stays merged. `push()` on this branch pauses until the conflict is acknowledged
        /// resolved.
        case conflicted(SyncConflict)
        /// `Source/` had a dangling gitfile, or its live repo failed to open — rebuilt from the
        /// artifact (fresh peer, or the integrity-check repair path). Any working-tree edits newer
        /// than the artifact's history landed as a snapshot commit on top, never clobbered.
        case bootstrapped(branch: String)
        /// The artifact is evicted and iCloud didn't finish downloading it within the timeout.
        case waitingForICloud
        /// The pull couldn't complete; `reason` is already owner-readable prose.
        case failed(reason: String)
    }

    /// A three-way merge (design doc §3 step 3) that hit textual conflicts and was left
    /// unresolved — both tips stay fully intact in git history (`ourOID`/`theirOID`), nothing is
    /// rewound or guessed at. P5 builds the resolution UI on top of this; this module's job ends
    /// at detecting, persisting, and reporting it (`pendingConflict(package:)`), and clearing the
    /// pause once the caller says it's resolved (`acknowledgeConflictResolved(package:)`).
    public struct SyncConflict: Sendable, Equatable, Codable {
        /// The local branch whose merge conflicted — the branch whose pushes pause.
        public let branch: String
        /// Paths git flagged with textual conflicts in the failed three-way merge.
        public let conflictedPaths: [String]
        /// This Mac's tip going into the failed merge attempt.
        public let ourOID: String
        /// The tip that conflicted — the other Mac's edit, still fully reachable from its own
        /// history (`refs/remotes/<theirSource>/<branch>`).
        public let theirOID: String
        /// Which fetched tip this came from: `"icloud"` for the current artifact, `"peer-<n>"`
        /// for the nth NSFileVersion conflict version — so the UI can say which Mac's edit
        /// collided.
        public let theirSource: String
    }

    // MARK: - Configuration

    /// Synthetic remote namespace fetched refs land under — kept out of the user's real
    /// `refs/heads/*`/`refs/tags/*`, matching `BundleSync`'s own convention.
    private static let namespace = "icloud"

    private let artifact: any SyncArtifact
    private let versionStore: any VersionStore
    private let materializeTimeout: TimeInterval

    /// Creates an engine. Both seams default to production (git-bundle codec, NSFileVersion-
    /// backed store); tests inject fakes to run without iCloud. `materializeTimeout` bounds how
    /// long push/pull wait for iCloud to download an evicted artifact before giving up with a
    /// "waiting" result instead of blocking the caller indefinitely.
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
        let repo: Repository
        switch await prepareRepository(package: package) {
        case .failure(let reason):
            return .failed(reason: reason.message)
        case .success(.bootstrapped(let bootstrapped, _)):
            repo = bootstrapped
        case .success(.existing(let existing)):
            repo = existing
        }

        // A pending conflict on the currently checked-out branch pauses its pushes (design doc
        // §3: "local branch stays editable; pushes of that branch pause") until the caller
        // acknowledges it resolved — never auto-lifted, since only the caller (P5's resolution
        // UI, or whatever committed a fix) knows the conflict is actually settled.
        if let conflict = pendingConflict(package: package),
           case .success(let head) = repo.HEAD(), let branch = head as? Branch, branch.name == conflict.branch {
            return .pausedForConflict(branch: conflict.branch)
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
    ///
    /// On genuine divergence, hands off to `reconcileDivergence(repo:package:branchName:branchRefName:localOID:icloudOID:)`
    /// (#880, design doc §3) for full reconciliation — fast-forward/merge every NSFileVersion
    /// conflict version of the artifact alongside the current one, rather than just reporting the
    /// divergence.
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

        // Working-tree conflict-copy sweep (design doc §3): `Source/`'s own files sync as plain
        // files independently of git, so iCloud can drop `name (conflicted copy …).ext`/`name
        // 2.ext`-style copies there. Both sides' real content already lives in git history by the
        // time this runs, so these are redundant — quarantined rather than left to pollute the
        // snapshot commit below or be mistaken for resolved history.
        Self.quarantineConflictCopies(package: package)

        // Detached HEAD is checked before the snapshot below, so a snapshot commit is never
        // created only to be stranded off any branch.
        guard case .success(let headBeforeSnapshot) = repo.HEAD(), (headBeforeSnapshot as? Branch)?.isLocal == true else {
            return .failed(reason: "the repo is in a detached-HEAD state — check out a branch before syncing.")
        }

        // Snapshot local changes before any history moves (design doc §3 step 1) — the same
        // addAll + GitIdentity + commit machinery `bootstrapFromArtifact` uses for its own
        // snapshot, mirroring the deterministic add→commit shape `BackupCommand` established for
        // user-triggered backups.
        if case .failure(let reason) = await Self.snapshotIfDirty(repo: repo, message: "Snapshot: local edits before syncing") {
            return .failed(reason: "couldn't snapshot local changes before syncing: \(reason.message)")
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
            return await reconcileDivergence(
                repo: repo, package: package, branchName: branchName, branchRefName: currentBranch.longName,
                localOID: localOID, icloudOID: remoteOID)
        }
    }

    // MARK: - Divergence reconciliation (#880, design doc §3)

    /// Folds every fetched tip — the current artifact plus each NSFileVersion conflict version —
    /// into the local branch, one at a time: fast-forward when a tip is strictly ahead, a libgit2
    /// three-way merge (auto-committed) when it diverges cleanly. The first tip whose merge hits a
    /// textual conflict stops the line: nothing merged so far in this call is rewound, but no
    /// further tips are attempted and the branch's next push pauses until the conflict is
    /// acknowledged resolved. Only entered once the caller has already established that the
    /// current artifact itself diverges from local history.
    private func reconcileDivergence(
        repo: Repository, package: AnglesitePackage, branchName: String, branchRefName: String,
        localOID: OID, icloudOID: OID
    ) async -> PullResult {
        var tips: [(source: String, oid: OID)] = [(Self.namespace, icloudOID)]
        var handlesBySource: [String: ConflictVersionHandle] = [:]

        for (index, handle) in await versionStore.conflictVersions(of: package.syncBundleURL).enumerated() {
            let source = "peer-\(index)"
            handlesBySource[source] = handle
            do {
                let landedPeer = try artifact.fetch(into: package.sourceURL, namespace: source, from: handle.contentURL)
                guard let peerRef = landedPeer.first(where: { $0.name == "refs/remotes/\(source)/\(branchName)" }),
                      let peerOID = OID(string: peerRef.oid) else {
                    continue // this conflict version doesn't carry the branch we're syncing — skip it
                }
                tips.append((source, peerOID))
            } catch {
                return .failed(reason: "couldn't fetch a conflicting version of the synced history: \(error.localizedDescription)")
            }
        }

        var currentOID = localOID
        var mergedTips: [String] = []

        for (source, tipOID) in tips {
            guard case .success(let counts) = repo.aheadBehind(local: currentOID, upstream: tipOID) else {
                return .failed(reason: "couldn't compare local history to \(source).")
            }
            if counts.behind == 0 {
                continue // nothing from this tip we don't already have
            }

            if counts.ahead == 0 {
                guard case .success = Self.fastForward(repo: repo, branchRefName: branchRefName, to: tipOID) else {
                    return .failed(reason: "couldn't fast-forward \(branchName) to \(source).")
                }
                currentOID = tipOID
                mergedTips.append(source)
                continue
            }

            switch await Self.threeWayMerge(repo: repo, ours: currentOID, theirs: tipOID, branchName: branchName) {
            case .failure(let reason):
                return .failed(reason: "couldn't merge \(source) into \(branchName): \(reason)")
            case .success(.conflicted(let paths)):
                let conflict = SyncConflict(
                    branch: branchName, conflictedPaths: paths,
                    ourOID: currentOID.description, theirOID: tipOID.description, theirSource: source)
                Self.persistConflict(conflict, package: package)
                await LogCenter.shared.append(
                    source: "sync:pull", stream: .stderr,
                    text: "merge conflict syncing \(branchName) against \(source) — "
                        + "\(paths.count) file\(paths.count == 1 ? "" : "s") need attention: \(paths.joined(separator: ", "))")
                return .conflicted(conflict)
            case .success(.merged(let mergeCommit)):
                guard case .success = repo.checkout(strategy: [.force, .recreateMissing]) else {
                    return .failed(reason: "checkout failed after merging \(source) into \(branchName)")
                }
                currentOID = mergeCommit.oid
                mergedTips.append(source)
            }
        }

        guard !mergedTips.isEmpty else {
            // Unreachable in practice: this function only runs once the caller already found the
            // *icloud* tip diverged, and icloud is always the first tip processed above — but
            // fail loudly rather than silently reporting an inaccurate result if that invariant
            // is ever violated.
            return .failed(reason: "internal error: reconciliation found no changes despite a detected divergence")
        }

        // Full convergence: every fetched tip merged or fast-forwarded cleanly. Resolve the
        // folded-in conflict versions, clear any stale conflict marker, and push the result back
        // (design doc §3 step 4).
        for source in mergedTips where source != Self.namespace {
            handlesBySource[source]?.markResolved()
        }
        Self.clearPersistedConflict(package: package)

        await LogCenter.shared.append(
            source: "sync:pull", stream: .stdout,
            text: "merged \(mergedTips.joined(separator: ", ")) into \(branchName) "
                + "(\(localOID.description.prefix(7)) → \(currentOID.description.prefix(7)))")

        if case .failed(let reason) = await push(package: package) {
            return .failed(reason: "merged \(branchName) locally but couldn't push the result: \(reason)")
        }

        return .merged(branch: branchName, mergedTips: mergedTips)
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
        if case .failure(let reason) = await Self.snapshotIfDirty(
            repo: repo, message: "Snapshot: local edits synced ahead of this Mac's git history"
        ) {
            return .failure("couldn't snapshot local edits: \(reason.message)")
        }

        await LogCenter.shared.append(
            source: "sync:bootstrap", stream: .stdout,
            text: "rebuilt \(package.liveRepositoryURL.lastPathComponent) from the synced history (\(branch))")
        return .success((repo, branch))
    }

    // MARK: - Snapshot commit (shared by pull()'s pre-reconciliation step and bootstrap)

    /// Auto-commits any dirty `Source/` working-tree state — the same addAll + `GitIdentity` +
    /// commit machinery the fresh-peer bootstrap path uses for its own snapshot, mirroring the
    /// deterministic add→commit shape `BackupCommand` established for user-triggered backups. A
    /// no-op on a clean tree.
    private static func snapshotIfDirty(repo: Repository, message: String) async -> Result<Void, EngineError> {
        guard case .success(let status) = repo.status(options: [.includeUntracked, .recurseUntrackedDirs]) else {
            return .failure("couldn't read working-tree status.")
        }
        guard !status.isEmpty else { return .success(()) }

        guard case .success = repo.addAll() else {
            return .failure("couldn't stage local changes for the pre-sync snapshot.")
        }
        let signature = await GitIdentity.signature(for: repo)
        guard case .success = repo.commit(message: message, signature: signature) else {
            return .failure("couldn't create the pre-sync snapshot commit.")
        }
        return .success(())
    }

    // MARK: - Three-way merge (#880, design doc §3 step 3)

    private enum MergeOutcome {
        case merged(Commit)
        case conflicted([String])
    }

    /// Three-way-merges `theirs` into `ours` via libgit2's `git_merge_commits` (computes the
    /// merge base itself; touches no working-directory or index state of its own — the caller
    /// checks out the result explicitly). A clean result creates a merge commit (parents `ours`,
    /// `theirs`) via `Repository.commit(tree:parents:message:signature:)`, whose own
    /// `update_ref: "HEAD"` moves the current branch to it — valid here because every caller only
    /// ever passes the *actual* current branch tip as `ours`. A conflicted result touches
    /// nothing: no commit, no ref move — so the caller can report it without rewinding anything
    /// already merged earlier in the same reconciliation.
    private static func threeWayMerge(
        repo: Repository, ours oursOID: OID, theirs theirsOID: OID, branchName: String
    ) async -> Result<MergeOutcome, EngineError> {
        var oursGitOID = oursOID.oid
        var oursRaw: OpaquePointer?
        guard git_commit_lookup(&oursRaw, repo.pointer, &oursGitOID) == GIT_OK.rawValue, let oursRaw else {
            return .failure("couldn't look up this Mac's commit: \(lastErrorMessage())")
        }
        defer { git_commit_free(oursRaw) }

        var theirsGitOID = theirsOID.oid
        var theirsRaw: OpaquePointer?
        guard git_commit_lookup(&theirsRaw, repo.pointer, &theirsGitOID) == GIT_OK.rawValue, let theirsRaw else {
            return .failure("couldn't look up the synced commit: \(lastErrorMessage())")
        }
        defer { git_commit_free(theirsRaw) }

        var mergeOptions = git_merge_options()
        guard git_merge_options_init(&mergeOptions, UInt32(GIT_MERGE_OPTIONS_VERSION)) == GIT_OK.rawValue else {
            return .failure("git_merge_options_init failed: \(lastErrorMessage())")
        }

        var index: OpaquePointer?
        guard git_merge_commits(&index, repo.pointer, oursRaw, theirsRaw, &mergeOptions) == GIT_OK.rawValue, let index else {
            return .failure("git_merge_commits failed: \(lastErrorMessage())")
        }
        defer { git_index_free(index) }

        if git_index_has_conflicts(index) != 0 {
            return .success(.conflicted(Self.conflictedPaths(in: index)))
        }

        var mergedTreeOID = git_oid()
        guard git_index_write_tree_to(&mergedTreeOID, index, repo.pointer) == GIT_OK.rawValue else {
            return .failure("git_index_write_tree_to failed: \(lastErrorMessage())")
        }

        guard case .success(let oursCommit) = repo.commit(oursOID),
              case .success(let theirsCommit) = repo.commit(theirsOID) else {
            return .failure("couldn't re-read this merge's parent commits.")
        }
        let signature = await GitIdentity.signature(for: repo)
        let message = "Merge synced history into \(branchName) (\(oursOID.description.prefix(7)) + \(theirsOID.description.prefix(7)))"
        switch repo.commit(tree: OID(mergedTreeOID), parents: [oursCommit, theirsCommit], message: message, signature: signature) {
        case .success(let mergeCommit):
            return .success(.merged(mergeCommit))
        case .failure(let error):
            return .failure(EngineError(error.localizedDescription))
        }
    }

    /// The paths flagged with textual conflicts in a merged `git_index` — from whichever of the
    /// conflict's ancestor/ours/theirs entries is present (a pure add/add or add/delete conflict
    /// may not carry an ancestor entry at all).
    private static func conflictedPaths(in index: OpaquePointer) -> [String] {
        var iterator: OpaquePointer?
        guard git_index_conflict_iterator_new(&iterator, index) == GIT_OK.rawValue, let iterator else { return [] }
        defer { git_index_conflict_iterator_free(iterator) }

        var paths: Set<String> = []
        while true {
            var ancestor: UnsafePointer<git_index_entry>?
            var ours: UnsafePointer<git_index_entry>?
            var theirs: UnsafePointer<git_index_entry>?
            let result = git_index_conflict_next(&ancestor, &ours, &theirs, iterator)
            if result == GIT_ITEROVER.rawValue { break }
            guard result == GIT_OK.rawValue else { break }
            if let path = ancestor?.pointee.path ?? ours?.pointee.path ?? theirs?.pointee.path {
                paths.insert(String(cString: path))
            }
        }
        return paths.sorted()
    }

    // MARK: - Conflicted-state persistence (#880, design doc §3)

    private static func conflictMarkerURL(for package: AnglesitePackage) -> URL {
        package.syncDirectoryURL.appendingPathComponent("conflict.json", isDirectory: false)
    }

    private static func persistConflict(_ conflict: SyncConflict, package: AnglesitePackage) {
        do {
            try FileManager.default.createDirectory(at: package.syncDirectoryURL, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(conflict)
            try data.write(to: conflictMarkerURL(for: package), options: .atomic)
        } catch {
            // Best-effort: a failure to persist only means push()'s pause-while-conflicted check
            // won't fire on this Mac — the SyncConflict itself is still returned to this pull()
            // call's own caller, so nothing here is silently lost.
        }
    }

    private static func clearPersistedConflict(package: AnglesitePackage) {
        try? FileManager.default.removeItem(at: conflictMarkerURL(for: package))
    }

    /// The unresolved `SyncConflict` recorded against `package`, if any — for callers (P5's
    /// conflict banner) that want to check without going through a `push()`/`pull()` call.
    /// `nonisolated`: a plain file read with no actor state to protect.
    public nonisolated func pendingConflict(package: AnglesitePackage) -> SyncConflict? {
        guard let data = try? Data(contentsOf: Self.conflictMarkerURL(for: package)) else { return nil }
        return try? JSONDecoder().decode(SyncConflict.self, from: data)
    }

    /// Clears the pause `push()` applies while `package` has a pending conflict. This module
    /// doesn't drive conflict resolution itself (out of scope for #880 — P5 builds the resolution
    /// UI on top of the typed `SyncConflict` `pull()` returns); it only owns lifting the pause
    /// once the caller says the branch is ready to sync again — e.g. after committing a chosen
    /// resolution (stage the chosen content, commit with both tips as parents; or a "keep this
    /// Mac's"/"keep the other's" choice) on top of `conflictedPaths`.
    public func acknowledgeConflictResolved(package: AnglesitePackage) {
        Self.clearPersistedConflict(package: package)
    }

    // MARK: - Working-tree conflict-copy quarantine (#880, design doc §3)

    private static let numberedDuplicatePattern = try! NSRegularExpression(pattern: #"^(.+) (\d+)(\.[^./]+)?$"#)

    /// Sweeps `Source/` for files matching iCloud's conflict-copy naming and moves them into
    /// `Config/conflicts/` — quarantined, never silently deleted. Best-effort: a failure to
    /// enumerate or move a file just leaves it where it was, it's never lost either way.
    private static func quarantineConflictCopies(package: AnglesitePackage) {
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: package.sourceURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
        ) else { return }

        var quarantined: [URL] = []
        for case let url as URL in enumerator {
            guard !url.lastPathComponent.hasPrefix(".") else { continue }
            guard let isDirectory = try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory, isDirectory != true else { continue }
            guard Self.isConflictCopyName(url.lastPathComponent, in: url.deletingLastPathComponent(), fileManager: fileManager) else { continue }
            quarantined.append(url)
        }
        guard !quarantined.isEmpty else { return }

        let quarantineDirectory = package.conflictsDirectoryURL
        try? fileManager.createDirectory(at: quarantineDirectory, withIntermediateDirectories: true)
        for url in quarantined {
            let destination = quarantineDirectory.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
            try? fileManager.moveItem(at: url, to: destination)
        }
    }

    /// `true` for a filename iCloud would have generated as a conflict copy: either its classic
    /// verbose "conflicted copy" naming, or the numbered-duplicate form (`"name 2.ext"`) *and* a
    /// sibling without the number suffix exists alongside it — requiring the sibling is what
    /// distinguishes a real iCloud conflict copy from an ordinary, legitimately numbered filename.
    private static func isConflictCopyName(_ filename: String, in directory: URL, fileManager: FileManager) -> Bool {
        if filename.range(of: "conflicted copy", options: [.caseInsensitive]) != nil { return true }

        let fullRange = NSRange(filename.startIndex..., in: filename)
        guard let match = numberedDuplicatePattern.firstMatch(in: filename, range: fullRange),
              let stemRange = Range(match.range(at: 1), in: filename) else { return false }

        let ext: String
        if match.range(at: 3).location != NSNotFound, let extRange = Range(match.range(at: 3), in: filename) {
            ext = String(filename[extRange])
        } else {
            ext = ""
        }
        let baseName = String(filename[stemRange]) + ext
        return fileManager.fileExists(atPath: directory.appendingPathComponent(baseName).path)
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
    /// branch symbolically) — the fast-forward's working-tree update. Safe to call only once the
    /// caller has confirmed a clean working tree.
    ///
    /// The strategy must be `.force`, not `.safe` (#1245). `Repository.checkout(strategy:)` calls
    /// libgit2's `git_checkout_head`, whose `baseline` defaults to HEAD — and by this point the ref
    /// move above has already pointed HEAD at the target. A file the peer changed therefore differs
    /// from that baseline, so libgit2 classifies it as a *local modification*: `.safe` preserves it
    /// and the peer's edit is silently dropped, leaving history advanced but `Source/` stale.
    /// `.recreateMissing` masks this for added files (they're absent, so they're recreated), which
    /// is why it went unnoticed until a test asserted content rather than mere presence.
    /// `.force` takes the target as definitive, matching `reconcileDivergence`'s post-merge
    /// checkout and `SyncConflictResolver`'s.
    ///
    /// Nothing of the owner's can be lost to `.force` here: `pull()` snapshots a dirty tree into a
    /// commit before reconciling, and a fast-forward only runs when the branch is not ahead — so
    /// the working tree is clean by the time this is reached.
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
        guard case .success = repo.checkout(strategy: [.force, .recreateMissing]) else {
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
