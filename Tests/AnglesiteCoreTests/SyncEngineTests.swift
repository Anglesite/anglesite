#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteSiteModel
import AnglesiteTestSupport
import SwiftGit2
@testable import AnglesiteCore

/// `SyncEngine` pushes/pulls a `.anglesite` package's git history through its single-file iCloud
/// sync artifact (#879, design doc `2026-07-21-icloud-git-sync-design.md` §2/§4). Fixtures build
/// real repos with subprocess git (tests run unsandboxed, matching `BundleArtifactTests`'/
/// `RepoRelocatorTests`' convention); "iCloud" is faked by literally copying the bundle file
/// between two package trees, and `VersionStore` is faked so no real iCloud materialization is
/// exercised.
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

        func materialize(at url: URL, timeout: TimeInterval) async -> VersionMaterialization {
            materializedURLs.append(url)
            return outcome
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

    @Test("pull reports diverged, without merging, when local and artifact history disagree")
    func divergedPullIsReportedNotMerged() async throws {
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
        let commonAncestor = try await headOID(in: b.sourceURL)

        // A and B each commit independently from the same base.
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
        let bHeadBeforePull = try await headOID(in: b.sourceURL)

        let result = await engineB.pull(package: b)
        guard case .diverged(let branch) = result else {
            Issue.record("expected .diverged, got \(result)"); return
        }
        #expect(branch == "main")
        // Not merged: B's checked-out HEAD is untouched by the diverged pull.
        #expect(try await headOID(in: b.sourceURL) == bHeadBeforePull)
        // But the fetch happened — A's history is sitting in the namespaced remote ref, ready for
        // P4's three-way merge to pick up without re-fetching.
        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL),
              case .success(let icloudMain) = repo.reference(named: "refs/remotes/icloud/main") else {
            Issue.record("expected refs/remotes/icloud/main to exist after a diverged pull"); return
        }
        #expect(icloudMain.oid.description != commonAncestor)
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
