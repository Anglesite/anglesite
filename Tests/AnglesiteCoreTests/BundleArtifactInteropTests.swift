#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// Proves `BundleArtifact` interoperates with real git in both directions — the acceptance bar
/// from issue #878: "stock `git clone our.bundle` succeeds; we can read a bundle produced by
/// stock `git bundle create`." `.enabled(if:)` skips cleanly wherever system git is unavailable
/// (matching `RepoRelocatorInteropTests`), so this still runs in CI where git is present.
///
/// .serialized: libgit2 isn't safe for uncoordinated concurrent use in this codebase.
@Suite("BundleArtifact system-git interop", .serialized) struct BundleArtifactInteropTests {
    static var gitAvailable: Bool { FileManager.default.isExecutableFile(atPath: "/usr/bin/git") }

    @discardableResult
    private func git(_ arguments: [String], in dir: URL) async throws -> String {
        let result = try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["git"] + arguments,
            currentDirectoryURL: dir
        )
        guard result.exitCode == 0 else {
            Issue.record("fixture git \(arguments.joined(separator: " ")) exited \(result.exitCode): \(result.stderr)")
            throw FixtureError.gitFailed
        }
        return result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private enum FixtureError: Error { case gitFailed }

    private func makeRepo() async throws -> URL {
        let dir = try makeTempDir(prefix: "bundleartifact-interop-work")
        try await git(["init", "-b", "main"], in: dir)
        try await git(["config", "user.name", "Test"], in: dir)
        try await git(["config", "user.email", "test@example.com"], in: dir)
        try "hello".write(to: dir.appendingPathComponent("hello.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: dir)
        try await git(["commit", "-m", "first"], in: dir)
        try "world".write(to: dir.appendingPathComponent("world.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: dir)
        try await git(["commit", "-m", "second"], in: dir)
        try await git(["tag", "-a", "v1", "-m", "release"], in: dir)
        return dir
    }

    @Test(
        "stock `git clone` succeeds against a bundle BundleArtifact wrote",
        .enabled(if: BundleArtifactInteropTests.gitAvailable, "requires /usr/bin/git")
    )
    func stockGitClonesOurBundle() async throws {
        let source = try await makeRepo()
        let bundleURL = try makeTempDir(prefix: "bundleartifact-interop-out").appendingPathComponent("source.bundle")
        try BundleArtifact().write(from: source, to: bundleURL)

        let cloneDest = try makeTempDir(prefix: "bundleartifact-interop-clone").appendingPathComponent("clone")
        let clone = try await ProcessSupervisor.shared.run(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["git", "clone", bundleURL.path, cloneDest.path],
            currentDirectoryURL: bundleURL.deletingLastPathComponent()
        )
        #expect(clone.exitCode == 0)
        #expect(FileManager.default.fileExists(atPath: cloneDest.appendingPathComponent("world.txt").path))
        let log = try await git(["log", "--oneline"], in: cloneDest)
        #expect(log.contains("second"))
        let expectedHead = try await git(["rev-parse", "HEAD"], in: source)
        let clonedHead = try await git(["rev-parse", "HEAD"], in: cloneDest)
        #expect(clonedHead == expectedHead)
    }

    @Test(
        "BundleArtifact reads a bundle produced by stock `git bundle create`",
        .enabled(if: BundleArtifactInteropTests.gitAvailable, "requires /usr/bin/git")
    )
    func readsStockGitBundle() async throws {
        let source = try await makeRepo()
        let bundleURL = try makeTempDir(prefix: "bundleartifact-interop-stock").appendingPathComponent("stock.bundle")
        try await git(["bundle", "create", bundleURL.path, "--branches", "--tags", "HEAD"], in: source)

        let artifact = BundleArtifact()
        let refs = try artifact.refs(of: bundleURL)
        let expectedHead = try await git(["rev-parse", "HEAD"], in: source)
        #expect(refs.first { $0.name == "refs/heads/main" }?.oid == expectedHead)
        #expect(refs.first { $0.name == "HEAD" }?.oid == expectedHead)

        let target = try makeTempDir(prefix: "bundleartifact-interop-stock-target")
        try await git(["init", "-b", "placeholder"], in: target)
        let landed = try artifact.fetch(into: target, namespace: "icloud", from: bundleURL)
        #expect(landed.first { $0.name == "refs/remotes/icloud/main" }?.oid == expectedHead)

        let show = try await git(["show", "\(expectedHead):world.txt"], in: target)
        #expect(show == "world")
    }
}
#endif
