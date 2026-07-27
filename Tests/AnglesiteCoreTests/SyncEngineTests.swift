#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteSiteModel
import AnglesiteTestSupport
import SwiftGit2
@testable import AnglesiteCore

/// `SyncEngine` pushes/pulls a `.anglesite` package's git history through its single-file iCloud
/// sync artifact (#879, #880; design doc `2026-07-21-icloud-git-sync-design.md` §2–§3). Fixtures
/// build real repos with subprocess git (tests run unsandboxed, matching `BundleArtifactTests`'/
/// `RepoRelocatorTests`' convention); "iCloud" is faked by literally copying the bundle file
/// between two package trees, and `VersionStore` is faked so no real iCloud materialization or
/// `NSFileVersion` conflict-version enumeration is exercised.
///
/// .serialized: libgit2 isn't safe for uncoordinated concurrent use in this codebase.
@Suite("SyncEngine", .serialized) struct SyncEngineTests {

    // MARK: - Fakes

    /// Records every URL it was asked to materialize and returns a scripted outcome — the seam
    /// that keeps real `NSFileVersion`/`startDownloadingUbiquitousItem` out of these tests (P4
    /// extends this protocol with conflict-version enumeration; this phase only needs the single
    /// scripted outcome below).
    private final class FakeVersionStore: VersionStore, @unchecked Sendable {
        var outcome: VersionMaterialization = .alreadyLocal
        private(set) var materializedURLs: [URL] = []

        /// Manufactured "iCloud conflict versions" — bundle URLs to hand back as
        /// `ConflictVersionHandle`s. Real `NSFileVersion` conflicts can't be created in CI, so
        /// tests populate this directly with sibling package bundles standing in for a peer Mac's
        /// concurrent write.
        var conflictArtifactURLs: [URL] = []
        private(set) var resolvedIDs: [String] = []

        func materialize(at url: URL, timeout: TimeInterval) async -> VersionMaterialization {
            materializedURLs.append(url)
            return outcome
        }

        func conflictVersions(of url: URL) async -> [ConflictVersionHandle] {
            conflictArtifactURLs.enumerated().map { index, artifactURL in
                let id = "peer-\(index)"
                return ConflictVersionHandle(id: id, contentURL: artifactURL) { [weak self] in
                    self?.resolvedIDs.append(id)
                }
            }
        }
    }

    // MARK: - Fixtures

    @discardableResult
    private func git(_ arguments: [String], in dir: URL) async throws -> ProcessSupervisor.RunResult {
        let result = try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["git"] + arguments,
            currentDirectoryURL: dir
        )
        #expect(result.exitCode == 0, "fixture git \(arguments.joined(separator: " ")) exited \(result.exitCode): \(result.stderr)")
        return result
    }

    private func headOID(in dir: URL) async throws -> String {
        try await git(["rev-parse", "HEAD"], in: dir).stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A package with an embedded (unmigrated — `SyncEngine` heals this on first touch), real git
    /// repo on branch `main` with `commits` sequential commits.
    private func makeGitPackage(name: String = "Test", commits: Int = 1) async throws -> AnglesitePackage {
        let root = try makeTempDir(prefix: "sync-engine")
        let pkgURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (pkg, _) = try AnglesitePackage.createSkeleton(at: pkgURL, displayName: name)
        try await git(["init", "-b", "main"], in: pkg.sourceURL)
        try await git(["config", "user.email", "t@t.io"], in: pkg.sourceURL)
        try await git(["config", "user.name", "t"], in: pkg.sourceURL)
        for i in 0..<max(commits, 1) {
            try "content \(i)".write(to: pkg.sourceURL.appendingPathComponent("file\(i).txt"), atomically: true, encoding: .utf8)
            try await git(["add", "-A"], in: pkg.sourceURL)
            try await git(["commit", "-m", "commit \(i)"], in: pkg.sourceURL)
        }
        return pkg
    }

    /// Copies `source`'s current sync artifact onto `destination` — the fake "iCloud" transport
    /// between two package trees.
    private func copyArtifact(from source: AnglesitePackage, to destination: AnglesitePackage) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: destination.syncDirectoryURL, withIntermediateDirectories: true)
        if fm.fileExists(atPath: destination.syncBundleURL.path) {
            try fm.removeItem(at: destination.syncBundleURL)
        }
        try fm.copyItem(at: source.syncBundleURL, to: destination.syncBundleURL)
    }

    /// A peer package that has never had a live repo on this Mac: `Source/` mirrors `source`'s
    /// working tree (minus `.git`), `Source/.git` is a dangling gitfile (the target,
    /// `Config/repo.nosync`, doesn't exist locally), and the sync artifact is already "synced in".
    /// This is the exact shape a package arrives in via iCloud before its history has landed.
    private func makeFreshPeerPackage(mirroring source: AnglesitePackage, name: String = "Peer") throws -> AnglesitePackage {
        let fm = FileManager.default
        let root = try makeTempDir(prefix: "sync-engine-peer")
        let pkgURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (pkg, _) = try AnglesitePackage.createSkeleton(at: pkgURL, displayName: name)
        for item in try fm.contentsOfDirectory(at: source.sourceURL, includingPropertiesForKeys: nil)
        where item.lastPathComponent != ".git" {
            try fm.copyItem(at: item, to: pkg.sourceURL.appendingPathComponent(item.lastPathComponent))
        }
        try "gitdir: ../Config/repo.nosync\n".write(
            to: pkg.sourceURL.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        try copyArtifact(from: source, to: pkg)
        return pkg
    }

    private struct FixtureFailure: Error, CustomStringConvertible {
        let message: String
        var description: String { message }
    }

    /// Builds a standalone package that bootstraps from `base`'s already-pushed history, applies
    /// `edit`, commits, and pushes — returning its own sync-artifact file to hand a
    /// `FakeVersionStore` as a manufactured NSFileVersion conflict version. Real conflict versions
    /// can't be created in CI (#880 scope note); this stands in for "a peer Mac wrote
    /// concurrently" the same way `makeFreshPeerPackage`/`copyArtifact` stand in for iCloud
    /// transport elsewhere in this file.
    private func makeConflictVersionBundle(
        from base: AnglesitePackage, name: String, edit: @escaping (URL) throws -> Void
    ) async throws -> URL {
        let peer = try makeFreshPeerPackage(mirroring: base, name: name)
        let engine = SyncEngine()
        guard case .bootstrapped = await engine.pull(package: peer) else {
            throw FixtureFailure(message: "bootstrap of conflict-version peer \(name) failed")
        }
        try edit(peer.sourceURL)
        try await git(["add", "-A"], in: peer.sourceURL)
        try await git(["commit", "-m", "conflict-version edit"], in: peer.sourceURL)
        guard case .pushed = await engine.push(package: peer) else {
            throw FixtureFailure(message: "push of conflict-version peer \(name) failed")
        }
        return peer.syncBundleURL
    }

    // MARK: - push(): no-op

    @Test("push writes the artifact once, then is a no-op on an idle site")
    func noOpPushOnIdleSite() async throws {
        let pkg = try await makeGitPackage()
        let versionStore = FakeVersionStore()
        let engine = SyncEngine(versionStore: versionStore)

        let first = await engine.push(package: pkg)
        guard case .pushed(let refs) = first else {
            Issue.record("expected .pushed, got \(first)"); return
        }
        #expect(refs.contains { $0.name == "refs/heads/main" })
        #expect(FileManager.default.fileExists(atPath: pkg.syncBundleURL.path))

        let mtimeAfterFirst = try FileManager.default.attributesOfItem(atPath: pkg.syncBundleURL.path)[.modificationDate] as? Date

        let second = await engine.push(package: pkg)
        #expect(second == .unchanged)
        let mtimeAfterSecond = try FileManager.default.attributesOfItem(atPath: pkg.syncBundleURL.path)[.modificationDate] as? Date
        #expect(mtimeAfterFirst == mtimeAfterSecond, "an unchanged push must not rewrite the artifact file")
    }

    @Test("push on a repo with no commits fails instead of writing an empty artifact")
    func pushOnEmptyRepoFails() async throws {
        let root = try makeTempDir(prefix: "sync-engine-empty")
        let (empty, _) = try AnglesitePackage.createSkeleton(
            at: root.appendingPathComponent("Empty.anglesite"), displayName: "Empty")
        try await git(["init", "-b", "main"], in: empty.sourceURL)

        let engine = SyncEngine()
        let result = await engine.push(package: empty)
        guard case .failed = result else {
            Issue.record("expected .failed for a commit-less repo, got \(result)"); return
        }
    }

    // MARK: - pull(): fast-forward / up-to-date / local-ahead / diverged

    @Test("pull fast-forwards a strictly-behind branch to the artifact's head")
    func fastForwardPull() async throws {
        let a = try await makeGitPackage(name: "A", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        // B starts from the same history as A (simulate via fresh-peer bootstrap), then A adds a
        // second commit and pushes again.
        let b = try makeFreshPeerPackage(mirroring: a, name: "B")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap of B failed"); return
        }

        try "content 1".write(to: a.sourceURL.appendingPathComponent("file1.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "second"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture second push failed"); return
        }
        try copyArtifact(from: a, to: b)

        let aHead = try await headOID(in: a.sourceURL)
        let pullResult = await engineB.pull(package: b)
        guard case .fastForwarded(let branch, _, let to) = pullResult else {
            Issue.record("expected .fastForwarded, got \(pullResult)"); return
        }
        #expect(branch == "main")
        #expect(to == aHead)
        #expect(try await headOID(in: b.sourceURL) == aHead)
        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("file1.txt").path))
    }

    @Test("pull reports upToDate when local and artifact history already match")
    func upToDatePull() async throws {
        let a = try await makeGitPackage(name: "A2", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B2")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // Nothing changed on either side since the bootstrap — pulling again must be a no-op.
        let result = await engineB.pull(package: b)
        #expect(result == .upToDate)
    }

    @Test("pull reports localAhead when this Mac's branch is ahead of the artifact")
    func localAheadPull() async throws {
        let a = try await makeGitPackage(name: "A3", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B3")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // B moves ahead locally; A's artifact (still at the bootstrap point) hasn't changed.
        try "content 1".write(to: b.sourceURL.appendingPathComponent("file1.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "local work"], in: b.sourceURL)

        let result = await engineB.pull(package: b)
        guard case .localAhead(let branch) = result else {
            Issue.record("expected .localAhead, got \(result)"); return
        }
        #expect(branch == "main")
    }

    // MARK: - pull(): divergence reconciliation (#880)

    @Test("pull auto-merges non-overlapping divergent history and pushes the result")
    func divergedPullMergesNonOverlappingEdits() async throws {
        let a = try await makeGitPackage(name: "A4", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B4")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // A and B each commit independently from the same base, touching different files.
        try "a-edit".write(to: a.sourceURL.appendingPathComponent("a-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's work"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture A push failed"); return
        }
        try copyArtifact(from: a, to: b)

        try "b-edit".write(to: b.sourceURL.appendingPathComponent("b-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's work"], in: b.sourceURL)

        let result = await engineB.pull(package: b)
        guard case .merged(let branch, let mergedTips) = result else {
            Issue.record("expected .merged, got \(result)"); return
        }
        #expect(branch == "main")
        #expect(mergedTips == ["icloud"])

        // Both sides' edits survived — nothing lost.
        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("a-only.txt").path))
        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("b-only.txt").path))

        // Full convergence pushed the merged bundle back — a peer bootstrapping fresh now sees
        // both edits.
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL), case .success(let head) = repo.HEAD(),
              let headCommit = try? repo.commit(head.oid).get() else {
            Issue.record("couldn't read B's merged HEAD"); return
        }
        #expect(headCommit.parents.count == 2)
    }

    @Test("pull surfaces overlapping edits as a typed SyncConflict, rewinding nothing")
    func divergedPullReportsOverlappingConflict() async throws {
        let a = try await makeGitPackage(name: "A9", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B9")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // A and B both edit the SAME file from the same base — a genuine textual conflict.
        try "a-version".write(to: a.sourceURL.appendingPathComponent("file0.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's conflicting edit"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture A push failed"); return
        }
        try copyArtifact(from: a, to: b)
        let aHead = try await headOID(in: a.sourceURL)

        try "b-version".write(to: b.sourceURL.appendingPathComponent("file0.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's conflicting edit"], in: b.sourceURL)
        let bHeadBeforePull = try await headOID(in: b.sourceURL)

        let result = await engineB.pull(package: b)
        guard case .conflicted(let conflict) = result else {
            Issue.record("expected .conflicted, got \(result)"); return
        }
        #expect(conflict.branch == "main")
        #expect(conflict.conflictedPaths == ["file0.txt"])
        #expect(conflict.ourOID == bHeadBeforePull)
        #expect(conflict.theirOID == aHead)
        #expect(conflict.theirSource == "icloud")

        // Never auto-resolved, never rewound: B's local HEAD is exactly where it was.
        #expect(try await headOID(in: b.sourceURL) == bHeadBeforePull)
        // Both tips intact: A's edit is still fully reachable from the namespaced remote ref.
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL),
              case .success(let icloudMain) = repo.reference(named: "refs/remotes/icloud/main") else {
            Issue.record("expected refs/remotes/icloud/main to exist after a conflicted pull"); return
        }
        #expect(icloudMain.oid.description == aHead)
    }

    @Test("pull folds in multiple NSFileVersion conflict versions, fetching each into its own peer namespace")
    func pullFetchesMultipleConflictVersions() async throws {
        let a = try await makeGitPackage(name: "A10", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }
        let peerBundle = try await makeConflictVersionBundle(from: a, name: "Peer10") { sourceURL in
            try "peer-edit".write(to: sourceURL.appendingPathComponent("peer-only.txt"), atomically: true, encoding: .utf8)
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B10")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // A advances the icloud tip so B's own local edit below genuinely diverges from it
        // (rather than merely being ahead) — the manufactured conflict version is folded in
        // alongside that divergence.
        try "a-edit".write(to: a.sourceURL.appendingPathComponent("a-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's work"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture A push failed"); return
        }
        try copyArtifact(from: a, to: b)

        try "b-edit".write(to: b.sourceURL.appendingPathComponent("b-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's work"], in: b.sourceURL)

        let versionStore = FakeVersionStore()
        versionStore.conflictArtifactURLs = [peerBundle]
        let engine = SyncEngine(versionStore: versionStore)
        let result = await engine.pull(package: b)
        guard case .merged(let branch, let mergedTips) = result else {
            Issue.record("expected .merged, got \(result)"); return
        }
        #expect(branch == "main")
        #expect(mergedTips == ["icloud", "peer-0"])
        #expect(versionStore.resolvedIDs == ["peer-0"])

        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("a-only.txt").path))
        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("b-only.txt").path))
        #expect(FileManager.default.fileExists(atPath: b.sourceURL.appendingPathComponent("peer-only.txt").path))

        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL) else {
            Issue.record("Repository.at failed after reconciliation"); return
        }
        #expect((try? repo.reference(named: "refs/remotes/peer-0/main").get()) != nil)
    }

    @Test("both peers converge to the same history after independently running reconciliation")
    func bothPeersConverge() async throws {
        let a = try await makeGitPackage(name: "A11", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B11")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // A and B diverge with non-overlapping edits.
        try "a-edit".write(to: a.sourceURL.appendingPathComponent("a-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's work"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture A push failed"); return
        }
        try copyArtifact(from: a, to: b)

        try "b-edit".write(to: b.sourceURL.appendingPathComponent("b-only.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's work"], in: b.sourceURL)

        // B reconciles and pushes the merge first.
        guard case .merged = await engineB.pull(package: b) else {
            Issue.record("expected B to merge cleanly"); return
        }
        let bHead = try await headOID(in: b.sourceURL)

        // A pulls next: its own commit is already an ancestor of B's merge, so this is a plain
        // fast-forward — both Macs run the same procedure and land on the same history without
        // an arbiter.
        try copyArtifact(from: b, to: a)
        let result = await engineA.pull(package: a)
        guard case .fastForwarded(_, _, let to) = result else {
            Issue.record("expected A to fast-forward onto B's merge, got \(result)"); return
        }
        #expect(to == bHead)
        #expect(try await headOID(in: a.sourceURL) == bHead)
        #expect(FileManager.default.fileExists(atPath: a.sourceURL.appendingPathComponent("a-only.txt").path))
        #expect(FileManager.default.fileExists(atPath: a.sourceURL.appendingPathComponent("b-only.txt").path))
    }

    // MARK: - Conflicted state: pause + resolution acknowledgement

    @Test("push pauses while a conflict is pending, then proceeds once acknowledged")
    func pushPausesWhileConflicted() async throws {
        let a = try await makeGitPackage(name: "A12", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B12")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        try "a-version".write(to: a.sourceURL.appendingPathComponent("file0.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's conflicting edit"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture A push failed"); return
        }
        try copyArtifact(from: a, to: b)

        try "b-version".write(to: b.sourceURL.appendingPathComponent("file0.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's conflicting edit"], in: b.sourceURL)

        guard case .conflicted = await engineB.pull(package: b) else {
            Issue.record("expected fixture pull to conflict"); return
        }
        #expect(await engineB.pendingConflict(package: b) != nil)

        let pausedPush = await engineB.push(package: b)
        guard case .pausedForConflict(let branch) = pausedPush else {
            Issue.record("expected .pausedForConflict, got \(pausedPush)"); return
        }
        #expect(branch == "main")

        await engineB.acknowledgeConflictResolved(package: b)
        #expect(await engineB.pendingConflict(package: b) == nil)

        // No longer paused — an ordinary push attempt proceeds (whatever its outcome).
        let pushAfterAcknowledge = await engineB.push(package: b)
        if case .pausedForConflict = pushAfterAcknowledge {
            Issue.record("push should no longer be paused after acknowledging the conflict")
        }
    }

    // MARK: - Working-tree conflict-copy quarantine

    @Test("pull quarantines iCloud conflict-copy-named files in Source/ into Config/conflicts/")
    func pullQuarantinesConflictCopies() async throws {
        let pkg = try await makeGitPackage(name: "A13", commits: 1)
        let engine = SyncEngine()
        guard case .pushed = await engine.push(package: pkg) else {
            Issue.record("fixture push failed"); return
        }

        let numberedDuplicateName = "file0 2.txt" // sibling "file0.txt" already exists from the fixture
        let verboseConflictName = "notes (Some Mac's conflicted copy 2026-07-21).txt"
        try "dup".write(to: pkg.sourceURL.appendingPathComponent(numberedDuplicateName), atomically: true, encoding: .utf8)
        try "verbose-dup".write(to: pkg.sourceURL.appendingPathComponent(verboseConflictName), atomically: true, encoding: .utf8)
        // Not a conflict copy: no sibling "season.txt" exists, so this must survive the sweep.
        try "not-a-conflict".write(to: pkg.sourceURL.appendingPathComponent("season 2.txt"), atomically: true, encoding: .utf8)

        // The quarantined files were never committed, so removing them leaves no trace — but the
        // deliberately-surviving "season 2.txt" is still untracked afterward, so the snapshot step
        // commits it, putting local ahead of the (unchanged) artifact.
        let result = await engine.pull(package: pkg)
        guard case .localAhead(let branch) = result else {
            Issue.record("expected .localAhead, got \(result)"); return
        }
        #expect(branch == "main")

        let fm = FileManager.default
        #expect(!fm.fileExists(atPath: pkg.sourceURL.appendingPathComponent(numberedDuplicateName).path))
        #expect(!fm.fileExists(atPath: pkg.sourceURL.appendingPathComponent(verboseConflictName).path))
        #expect(fm.fileExists(atPath: pkg.sourceURL.appendingPathComponent("season 2.txt").path))

        let quarantineDirectory = pkg.configURL.appendingPathComponent("conflicts", isDirectory: true)
        let quarantined = (try? fm.contentsOfDirectory(at: quarantineDirectory, includingPropertiesForKeys: nil)) ?? []
        #expect(quarantined.contains { $0.lastPathComponent.hasSuffix(numberedDuplicateName) })
        #expect(quarantined.contains { $0.lastPathComponent.hasSuffix(verboseConflictName) })
    }

    // MARK: - Fresh peer / dangling-gitfile repair / corrupted-repo rebuild

    @Test("pull bootstraps a fresh peer from nothing but a synced Source/ tree and artifact")
    func freshPeerBootstraps() async throws {
        let a = try await makeGitPackage(name: "A5", commits: 2)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }
        let aHead = try await headOID(in: a.sourceURL)

        let b = try makeFreshPeerPackage(mirroring: a, name: "B5")
        let engineB = SyncEngine()

        let result = await engineB.pull(package: b)
        guard case .bootstrapped(let branch) = result else {
            Issue.record("expected .bootstrapped, got \(result)"); return
        }
        #expect(branch == "main")
        #expect(try await headOID(in: b.sourceURL) == aHead)
        #expect(FileManager.default.fileExists(atPath: b.liveRepositoryURL.appendingPathComponent("HEAD").path))

        // The gitfile follows the canonical RepoRelocator convention.
        let gitfile = try String(contentsOf: b.sourceURL.appendingPathComponent(".git"), encoding: .utf8)
        #expect(gitfile == "gitdir: ../Config/repo.nosync\n")
    }

    @Test("fresh peer bootstrap snapshots a synced working-tree edit newer than the artifact, never clobbering it")
    func freshPeerSnapshotsNewerSyncedEdit() async throws {
        let a = try await makeGitPackage(name: "A6", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B6")
        // Simulate iCloud having *also* synced a newer edit into Source/ that never made it into
        // the artifact (e.g. the edit happened offline before this Mac ever got a live repo).
        try "synced-ahead-of-history".write(
            to: b.sourceURL.appendingPathComponent("new-file.txt"), atomically: true, encoding: .utf8)

        let engineB = SyncEngine()
        let result = await engineB.pull(package: b)
        guard case .bootstrapped = result else {
            Issue.record("expected .bootstrapped, got \(result)"); return
        }

        // The synced edit survived (never clobbered by a checkout)...
        let content = try String(contentsOf: b.sourceURL.appendingPathComponent("new-file.txt"), encoding: .utf8)
        #expect(content == "synced-ahead-of-history")
        // ...and was captured as a real commit on top of the bootstrapped history, not left dirty.
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL) else {
            Issue.record("Repository.at failed after bootstrap"); return
        }
        #expect(repo.status().map { $0.isEmpty } == .success(true))
        guard case .success(let head) = repo.HEAD(), case .success(let commit) = repo.commit(head.oid) else {
            Issue.record("couldn't read bootstrapped HEAD commit"); return
        }
        #expect(commit.message.contains("Snapshot"))
        #expect(commit.parents.count == 1)
    }

    @Test("push repairs a dangling gitfile (bootstraps from the artifact) before writing")
    func pushRepairsDanglingGitfile() async throws {
        let a = try await makeGitPackage(name: "A7", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }

        let b = try makeFreshPeerPackage(mirroring: a, name: "B7")
        #expect(!FileManager.default.fileExists(atPath: b.liveRepositoryURL.path), "precondition: B has no live repo yet")

        let engineB = SyncEngine()
        let result = await engineB.push(package: b)
        // B's history now matches A's exactly (no newer synced edits in this fixture), so the
        // freshly-bootstrapped artifact should already match — a no-op push, not a failure.
        #expect(result == .unchanged)
        #expect(FileManager.default.fileExists(atPath: b.liveRepositoryURL.appendingPathComponent("HEAD").path),
                "the dangling gitfile must have been repaired (bootstrapped) as a side effect")
    }

    @Test("pull rebuilds a corrupted live repo from the artifact (integrity check on open)")
    func corruptedRepoRebuild() async throws {
        let pkg = try await makeGitPackage(name: "Corrupt", commits: 1)
        let engine = SyncEngine()
        // First push migrates Source/.git to Config/repo.nosync and writes the artifact — the
        // recovery point this test corrupts around.
        guard case .pushed = await engine.push(package: pkg) else {
            Issue.record("fixture push failed"); return
        }
        let headBeforeCorruption = try await headOID(in: pkg.sourceURL)

        // Corrupt the live repo directory so `Repository.at` fails to open it.
        try "not a valid git HEAD file".write(
            to: pkg.liveRepositoryURL.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try FileManager.default.removeItem(at: pkg.liveRepositoryURL.appendingPathComponent("refs"))

        let result = await engine.pull(package: pkg)
        guard case .bootstrapped(let branch) = result else {
            Issue.record("expected .bootstrapped (rebuilt from the artifact), got \(result)"); return
        }
        #expect(branch == "main")
        #expect(try await headOID(in: pkg.sourceURL) == headBeforeCorruption)
    }

    // MARK: - VersionStore: waiting for iCloud

    @Test("pull surfaces waitingForICloud when the artifact times out materializing")
    func pullWaitsForICloud() async throws {
        let a = try await makeGitPackage(name: "A8", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture push failed"); return
        }
        let b = try makeFreshPeerPackage(mirroring: a, name: "B8")
        let bootstrapEngine = SyncEngine()
        guard case .bootstrapped = await bootstrapEngine.pull(package: b) else {
            Issue.record("fixture bootstrap failed"); return
        }

        // A pushes again so there's genuinely something new for B to pull...
        try "content 1".write(to: a.sourceURL.appendingPathComponent("file1.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "second"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            Issue.record("fixture second push failed"); return
        }
        try copyArtifact(from: a, to: b)

        // ...but B's VersionStore reports the artifact never finishes materializing.
        let versionStore = FakeVersionStore()
        versionStore.outcome = .timedOut
        let engineB = SyncEngine(versionStore: versionStore)
        let result = await engineB.pull(package: b)
        #expect(result == .waitingForICloud)
        #expect(versionStore.materializedURLs.contains(b.syncBundleURL))
    }
}
#endif
