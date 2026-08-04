#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteSiteModel
import AnglesiteTestSupport
import SwiftGit2
@testable import AnglesiteCore

/// `SyncConflictResolver` (#881) commits the user's per-file keep-mine/keep-theirs choice as a
/// merge resolving a `SyncEngine.SyncConflict`. Fixtures mirror `SyncEngineTests`' own (real
/// repos, subprocess git, a fake iCloud transport via file copy) so a genuine textual conflict —
/// the same shape `SyncEngineTests.divergedPullReportsOverlappingConflict` produces — is available
/// to resolve against.
///
/// .serialized: libgit2 isn't safe for uncoordinated concurrent use in this codebase.
@Suite("SyncConflictResolver", .serialized) struct SyncConflictResolverTests {

    // MARK: - Fixtures (mirrors SyncEngineTests)

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

    private func makeGitPackage(name: String, commits: Int = 1) async throws -> AnglesitePackage {
        let root = try makeTempDir(prefix: "sync-conflict-resolver")
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

    private func copyArtifact(from source: AnglesitePackage, to destination: AnglesitePackage) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: destination.syncDirectoryURL, withIntermediateDirectories: true)
        if fm.fileExists(atPath: destination.syncBundleURL.path) {
            try fm.removeItem(at: destination.syncBundleURL)
        }
        try fm.copyItem(at: source.syncBundleURL, to: destination.syncBundleURL)
    }

    private func makeFreshPeerPackage(mirroring source: AnglesitePackage, name: String) throws -> AnglesitePackage {
        let fm = FileManager.default
        let root = try makeTempDir(prefix: "sync-conflict-resolver-peer")
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

    /// Produces a genuine `SyncConflict` on `b`, mirroring
    /// `SyncEngineTests.divergedPullReportsOverlappingConflict`: `a` and `b` both edit the same
    /// file from the same base, `a` pushes first, and `b`'s `pull()` hits the textual conflict.
    private func makeConflict(fileName: String = "file0.txt") async throws -> (a: AnglesitePackage, b: AnglesitePackage, conflict: SyncEngine.SyncConflict) {
        let a = try await makeGitPackage(name: "A", commits: 1)
        let engineA = SyncEngine()
        guard case .pushed = await engineA.push(package: a) else {
            throw TestFailure("fixture push failed")
        }
        let b = try makeFreshPeerPackage(mirroring: a, name: "B")
        let engineB = SyncEngine()
        guard case .bootstrapped = await engineB.pull(package: b) else {
            throw TestFailure("fixture bootstrap failed")
        }

        try "a-version".write(to: a.sourceURL.appendingPathComponent(fileName), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: a.sourceURL)
        try await git(["commit", "-m", "a's conflicting edit"], in: a.sourceURL)
        guard case .pushed = await engineA.push(package: a) else {
            throw TestFailure("fixture A push failed")
        }
        try copyArtifact(from: a, to: b)

        try "b-version".write(to: b.sourceURL.appendingPathComponent(fileName), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: b.sourceURL)
        try await git(["commit", "-m", "b's conflicting edit"], in: b.sourceURL)

        let result = await engineB.pull(package: b)
        guard case .conflicted(let conflict) = result else {
            throw TestFailure("expected .conflicted, got \(result)")
        }
        return (a, b, conflict)
    }

    private struct TestFailure: Error, CustomStringConvertible {
        let message: String
        init(_ message: String) { self.message = message }
        var description: String { message }
    }

    // MARK: - Tests

    @Test("loadConflictedFiles reads both sides' text content")
    func loadsBothSides() async throws {
        let (_, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()

        let files = await resolver.loadConflictedFiles(package: b, conflict: conflict)
        #expect(files.count == 1)
        #expect(files.first?.path == "file0.txt")
        #expect(files.first?.oursText == "b-version")
        #expect(files.first?.theirsText == "a-version")
    }

    @Test("resolve() with keepMine commits this Mac's content and clears the conflict")
    func resolveKeepMine() async throws {
        let (_, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()

        let outcome = await resolver.resolve(package: b, conflict: conflict, choices: ["file0.txt": .keepMine])
        guard case .success = outcome else {
            Issue.record("expected success, got \(outcome)"); return
        }
        let content = try String(contentsOf: b.sourceURL.appendingPathComponent("file0.txt"), encoding: .utf8)
        #expect(content == "b-version")

        SwiftGit2Bootstrap.ensureInitialized
        guard case .success(let repo) = Repository.at(b.sourceURL), case .success(let head) = repo.HEAD(),
              let branch = head as? Branch else {
            Issue.record("couldn't read HEAD after resolving"); return
        }
        guard case .success(let commit) = repo.commit(branch.oid) else {
            Issue.record("couldn't read the resolution commit"); return
        }
        #expect(commit.parents.count == 2)
    }

    @Test("resolve() with keepTheirs commits the other Mac's content")
    func resolveKeepTheirs() async throws {
        let (_, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()

        let outcome = await resolver.resolve(package: b, conflict: conflict, choices: ["file0.txt": .keepTheirs])
        guard case .success = outcome else {
            Issue.record("expected success, got \(outcome)"); return
        }
        let content = try String(contentsOf: b.sourceURL.appendingPathComponent("file0.txt"), encoding: .utf8)
        #expect(content == "a-version")
    }

    @Test("resolve() fails with missingChoices when a conflicted path has no choice")
    func resolveRequiresEveryPath() async throws {
        let (_, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()

        let outcome = await resolver.resolve(package: b, conflict: conflict, choices: [:])
        guard case .failure(.missingChoices(let paths)) = outcome else {
            Issue.record("expected .missingChoices, got \(outcome)"); return
        }
        #expect(paths == ["file0.txt"])
    }

    @Test("resolving lets the engine acknowledge the conflict and resume pushing")
    func resolutionUnblocksEnginePush() async throws {
        let (_, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()
        let engine = SyncEngine()

        // Before resolving, push() is paused.
        guard case .pausedForConflict = await engine.push(package: b) else {
            Issue.record("expected the pending conflict to pause push() before resolution"); return
        }

        let outcome = await resolver.resolve(package: b, conflict: conflict, choices: ["file0.txt": .keepMine])
        guard case .success = outcome else {
            Issue.record("expected success, got \(outcome)"); return
        }
        await engine.acknowledgeConflictResolved(package: b)

        let pushResult = await engine.push(package: b)
        guard case .pushed = pushResult else {
            Issue.record("expected push to succeed after acknowledging resolution, got \(pushResult)"); return
        }
    }

    // MARK: - Peer convergence after a resolution (QA §2.8)

    /// This Mac's current HEAD commit id, read through the same subprocess-git fixture channel the
    /// helpers above use. Declared here rather than beside them so this section stays additive.
    private func headOID(in dir: URL) async throws -> String {
        try await git(["rev-parse", "HEAD"], in: dir).stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// QA §2.8: "Open the site on the *other* Mac and pull … The other Mac converges to the same
    /// resolved content — no repeat conflict, no banner."
    ///
    /// The resolution commit has both tips as parents, so the peer's own tip is already an ancestor
    /// of it — the peer's pull is therefore a plain `.fastForwarded`, never a second `.conflicted`
    /// (which is what would put the banner back up on the Mac that didn't do the resolving).
    @Test("the peer Mac fast-forwards onto the resolution — no repeat conflict on either side")
    func peerConvergesAfterResolution() async throws {
        let (a, b, conflict) = try await makeConflict()
        let resolver = SyncConflictResolver()
        let engineA = SyncEngine()
        let engineB = SyncEngine()

        // QA §2.7: choose a side for every conflicted file, apply, and push the result.
        let outcome = await resolver.resolve(package: b, conflict: conflict, choices: ["file0.txt": .keepMine])
        guard case .success = outcome else {
            Issue.record("expected success, got \(outcome)"); return
        }
        await engineB.acknowledgeConflictResolved(package: b)
        let pushResult = await engineB.push(package: b)
        guard case .pushed = pushResult else {
            Issue.record("expected the resolution to push, got \(pushResult)"); return
        }
        let resolvedHead = try await headOID(in: b.sourceURL)

        // "iCloud" carries the resolved history to the other Mac.
        try copyArtifact(from: b, to: a)

        let pullResult = await engineA.pull(package: a)
        guard case .fastForwarded(let branch, _, let to) = pullResult else {
            Issue.record("expected the peer to fast-forward onto the resolution, got \(pullResult)"); return
        }
        #expect(branch == "main")
        #expect(to == resolvedHead)
        #expect(try await headOID(in: a.sourceURL) == resolvedHead)

        // No repeat conflict: neither Mac has a pending conflict left to surface as a banner.
        #expect(engineA.pendingConflict(package: a) == nil)
        #expect(engineB.pendingConflict(package: b) == nil)

        // Both Macs hold the identical chosen content (QA §2 pass criteria).
        //
        // KNOWN FAILURE — a real bug in `SyncEngine.fastForward`, not a wrong expectation. The peer's
        // ref and HEAD both reach the resolution commit (asserted above, and those pass), but its
        // *working tree* keeps the stale content: `fastForward` force-moves the branch ref and only
        // then calls `repo.checkout(strategy: [.safe, .recreateMissing])`, by which point HEAD is
        // already the target — so libgit2 diffs the target against itself, gets nothing, and updates
        // no files. `.recreateMissing` still restores files that are *absent*, which is why every
        // pre-existing fast-forward test passes: `fastForwardPull` and `bothPeersConverge` only ever
        // assert `fileExists` on newly-added paths. Overwriting an existing file's content is the
        // uncovered case, and it silently doesn't happen.
        //
        // Consequence for a site owner: edit an existing page on Mac A, pull on Mac B, and Mac B's
        // git history advances while `Source/` still serves the old content — QA §1.4's exact
        // scenario. The two sibling checkout call sites (`SyncEngine.swift:382`'s merge path and
        // `SyncConflictResolver.swift:164`) both use `.force`; this one is the outlier.
        //
        // Left as a known issue rather than deleted so it fails loudly the moment the engine is
        // fixed. The fix belongs in its own PR — this one changes no production code.
        let aContent = try String(contentsOf: a.sourceURL.appendingPathComponent("file0.txt"), encoding: .utf8)
        let bContent = try String(contentsOf: b.sourceURL.appendingPathComponent("file0.txt"), encoding: .utf8)
        #expect(bContent == "b-version") // the resolving Mac is correct
        withKnownIssue("SyncEngine.fastForward's .safe checkout never updates an existing file — see comment above") {
            #expect(aContent == "b-version")
            #expect(bContent == aContent)
        }
    }
}
#endif
