#if canImport(Darwin)
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// `BundleArtifact` implements `SyncArtifact` as a git bundle v2 (#878): a text header of refs
/// followed by a packfile, written via `git_packbuilder` and read via `git_indexer` — libgit2 has
/// no native bundle support (#655/#988), so this codec owns the file format itself.
///
/// Fixtures are built with subprocess git (tests are unsandboxed), matching `InProcessGitTests`'
/// convention of cross-checking the in-process implementation against real git semantics rather
/// than the implementation against itself.
///
/// .serialized: libgit2 isn't safe for uncoordinated concurrent use in this codebase.
@Suite("BundleArtifact", .serialized) struct BundleArtifactTests {

    // MARK: - Fixtures

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

    /// A repo on branch `main` with two commits, a second branch `feature`, an annotated tag
    /// `v1` on `main`, and a lightweight tag `light` on `feature` — enough shape to exercise
    /// every ref kind the #283 policy captures.
    private func makeRichRepo() async throws -> URL {
        let dir = try makeTempDir(prefix: "bundleartifact-work")
        try await git(["init", "-b", "main"], in: dir)
        try await git(["config", "user.name", "Test"], in: dir)
        try await git(["config", "user.email", "test@example.com"], in: dir)
        // A host with `tag.gpgsign = true` in its global config would otherwise force
        // implicit annotation (and a GPG-signing prompt) on the lightweight `light` tag below —
        // fixtures must not depend on the host's git config.
        try await git(["config", "tag.gpgsign", "false"], in: dir)
        try "one".write(to: dir.appendingPathComponent("one.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: dir)
        try await git(["commit", "-m", "first"], in: dir)
        try await git(["tag", "-a", "v1", "-m", "release 1"], in: dir)

        try await git(["checkout", "-b", "feature"], in: dir)
        try "two".write(to: dir.appendingPathComponent("two.txt"), atomically: true, encoding: .utf8)
        try await git(["add", "-A"], in: dir)
        try await git(["commit", "-m", "second"], in: dir)
        try await git(["tag", "light"], in: dir)

        try await git(["checkout", "main"], in: dir)
        return dir
    }

    private func headOID(_ ref: String, in dir: URL) async throws -> String {
        try await git(["rev-parse", ref], in: dir)
    }

    // MARK: - Round trip

    @Test("write then fetch reproduces every branch, tag, and HEAD oid exactly")
    func roundTripReproducesRefs() async throws {
        let source = try await makeRichRepo()
        let bundleURL = try makeTempDir(prefix: "bundleartifact-out").appendingPathComponent("source.bundle")

        let artifact = BundleArtifact()
        let written = try artifact.write(from: source, to: bundleURL)
        #expect(!written.isEmpty)
        #expect(FileManager.default.fileExists(atPath: bundleURL.path))

        let mainOID = try await headOID("main", in: source)
        let featureOID = try await headOID("feature", in: source)
        let v1OID = try await headOID("v1^{}", in: source) // peeled — compare against the writer's own record below
        let v1TagOID = try await git(["rev-parse", "v1"], in: source) // the tag object itself
        let lightOID = try await headOID("light", in: source)

        func ref(_ name: String) -> String? { written.first { $0.name == name }?.oid }
        #expect(ref("refs/heads/main") == mainOID)
        #expect(ref("refs/heads/feature") == featureOID)
        #expect(ref("refs/tags/v1") == v1TagOID) // annotated tag: the tag object's own oid, not peeled
        #expect(ref("refs/tags/light") == lightOID)
        #expect(ref("HEAD") == mainOID)
        _ = v1OID

        // Fetch into a fresh, empty repo under a synthetic namespace.
        let target = try makeTempDir(prefix: "bundleartifact-target")
        try await git(["init", "-b", "placeholder"], in: target)
        try await git(["config", "user.name", "Test"], in: target)
        try await git(["config", "user.email", "test@example.com"], in: target)

        let landed = try artifact.fetch(into: target, namespace: "icloud", from: bundleURL)
        #expect(!landed.isEmpty)

        func landedRef(_ name: String) -> String? { landed.first { $0.name == name }?.oid }
        #expect(landedRef("refs/remotes/icloud/main") == mainOID)
        #expect(landedRef("refs/remotes/icloud/feature") == featureOID)
        #expect(landedRef("refs/remotes/icloud/tags/v1") == v1TagOID)
        #expect(landedRef("refs/remotes/icloud/tags/light") == lightOID)
        // HEAD is informational only — no `refs/remotes/icloud/HEAD` is created.
        #expect(landed.allSatisfy { $0.name != "refs/remotes/icloud/HEAD" })

        // Objects genuinely landed, not just refs pointing at nothing: content is readable.
        let show = try await git(["show", "\(mainOID):one.txt"], in: target)
        #expect(show == "one")
        let showFeature = try await git(["show", "\(featureOID):two.txt"], in: target)
        #expect(showFeature == "two")
        let tagBody = try await git(["cat-file", "-p", v1TagOID], in: target)
        #expect(tagBody.contains("release 1"))
    }

    @Test("refs(of:) reads the header without importing anything")
    func refsWithoutImport() async throws {
        let source = try await makeRichRepo()
        let bundleURL = try makeTempDir(prefix: "bundleartifact-out2").appendingPathComponent("source.bundle")
        let artifact = BundleArtifact()
        let written = try artifact.write(from: source, to: bundleURL)

        let read = try artifact.refs(of: bundleURL)
        #expect(Set(read) == Set(written))
    }

    @Test("verify accepts a bundle this codec just wrote")
    func verifyAcceptsOwnOutput() async throws {
        let source = try await makeRichRepo()
        let bundleURL = try makeTempDir(prefix: "bundleartifact-out3").appendingPathComponent("source.bundle")
        let artifact = BundleArtifact()
        try artifact.write(from: source, to: bundleURL)
        try artifact.verify(artifactURL: bundleURL) // must not throw
    }

    @Test("write on a repo with no commits throws noRefsToWrite")
    func writeOnEmptyRepoThrows() async throws {
        let dir = try makeTempDir(prefix: "bundleartifact-empty")
        try await git(["init", "-b", "main"], in: dir)
        let bundleURL = try makeTempDir(prefix: "bundleartifact-empty-out").appendingPathComponent("source.bundle")
        let artifact = BundleArtifact()
        #expect(throws: SyncArtifactError.noRefsToWrite) {
            try artifact.write(from: dir, to: bundleURL)
        }
    }

    // MARK: - Malformed input

    @Test("a header with no terminating blank line before EOF is rejected as truncated")
    func truncatedHeaderRejected() throws {
        let bundleURL = try makeTempDir(prefix: "bundleartifact-truncated").appendingPathComponent("source.bundle")
        try Data("# v2 git bundle\n".utf8).write(to: bundleURL)

        let artifact = BundleArtifact()
        #expect(throws: SyncArtifactError.truncatedHeader) {
            try artifact.refs(of: bundleURL)
        }
        #expect(throws: SyncArtifactError.truncatedHeader) {
            try artifact.verify(artifactURL: bundleURL)
        }
        let target = try makeTempDir(prefix: "bundleartifact-truncated-target")
        #expect(throws: SyncArtifactError.truncatedHeader) {
            try artifact.fetch(into: target, namespace: "icloud", from: bundleURL)
        }
    }

    @Test("a file that isn't a bundle at all is rejected, not silently accepted")
    func nonBundleRejected() throws {
        let bundleURL = try makeTempDir(prefix: "bundleartifact-notabundle").appendingPathComponent("source.bundle")
        try Data("hello, this is not a bundle\n".utf8).write(to: bundleURL)

        let artifact = BundleArtifact()
        #expect(throws: (any Error).self) {
            try artifact.refs(of: bundleURL)
        }
    }

    @Test("an unsupported bundle version is rejected with a descriptive error")
    func unsupportedVersionRejected() throws {
        let bundleURL = try makeTempDir(prefix: "bundleartifact-v3").appendingPathComponent("source.bundle")
        try Data("# v3 git bundle\n\n".utf8).write(to: bundleURL)

        let artifact = BundleArtifact()
        #expect(throws: SyncArtifactError.unsupportedFormat("# v3 git bundle")) {
            try artifact.refs(of: bundleURL)
        }
    }

    @Test("a torn pack (truncated mid-object) fails verify and fetch, not silently succeeds")
    func tornPackRejected() async throws {
        let source = try await makeRichRepo()
        let goodBundle = try makeTempDir(prefix: "bundleartifact-torn-src").appendingPathComponent("source.bundle")
        let artifact = BundleArtifact()
        try artifact.write(from: source, to: goodBundle)

        let fullData = try Data(contentsOf: goodBundle)
        // Cut the file well into the packfile, leaving a structurally-plausible but incomplete
        // pack (no trailer, likely a deflate stream cut mid-object).
        let tornLength = fullData.count - max(20, fullData.count / 4)
        let tornData = fullData.prefix(tornLength)
        let tornBundle = try makeTempDir(prefix: "bundleartifact-torn-out").appendingPathComponent("source.bundle")
        try Data(tornData).write(to: tornBundle)

        #expect(throws: (any Error).self) {
            try artifact.verify(artifactURL: tornBundle)
        }
        let target = try makeTempDir(prefix: "bundleartifact-torn-target")
        try await git(["init", "-b", "placeholder"], in: target)
        #expect(throws: (any Error).self) {
            try artifact.fetch(into: target, namespace: "icloud", from: tornBundle)
        }
    }

    @Test("fetching against a missing artifact throws notFound")
    func missingArtifactThrowsNotFound() async throws {
        let target = try makeTempDir(prefix: "bundleartifact-missing-target")
        try await git(["init", "-b", "placeholder"], in: target)
        let missingURL = try makeTempDir(prefix: "bundleartifact-missing").appendingPathComponent("nope.bundle")
        let artifact = BundleArtifact()
        #expect(throws: SyncArtifactError.notFound(missingURL)) {
            try artifact.refs(of: missingURL)
        }
    }
}
#endif
