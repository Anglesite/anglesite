import XCTest
@testable import AnglesiteCore

/// Regression coverage for #548's review follow-up: the fail-fast `.git` guard added to
/// `ContainerizationControl.start()` lived in the `AnglesiteContainer` module, whose test target
/// (`AnglesiteContainerLocalTests`) is excluded from CI's `swift test` entirely unless
/// `ANGLESITE_CONTAINER_TESTS=1` — which CI never sets. So the guard had no coverage CI actually
/// runs. Extracting it into `SourceRepoPrecondition` (AnglesiteCore, always built/tested in CI)
/// gives the check real regression coverage.
///
/// #903 extended the guard into `cloneSource(for:)`: it now also resolves the split-repo layout
/// (#888, `Source/.git` is a gitfile pointing at `Config/repo.nosync/`) to the directory a
/// container runtime must actually share and clone.
final class SourceRepoPreconditionTests: XCTestCase {

    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func testThrowsCloneFailedWhenNoGitDirectory() {
        let dir = tmpDir()
        XCTAssertThrowsError(try SourceRepoPrecondition.cloneSource(for: dir)) { error in
            guard case LocalContainerError.cloneFailed(let message) = error else {
                return XCTFail("expected .cloneFailed, got \(error)")
            }
            XCTAssertTrue(message.contains("no git repository"), "unexpected message: \(message)")
        }
    }

    func testEmbeddedGitDirectoryResolvesToSourceItself() throws {
        let dir = tmpDir()
        try FileManager.default.createDirectory(at: dir.appendingPathComponent(".git"), withIntermediateDirectories: true)
        XCTAssertEqual(try SourceRepoPrecondition.cloneSource(for: dir), dir)
    }

    func testSplitLayoutGitfileResolvesToLiveRepository() throws {
        // Package shape from RepoRelocator (#888): Source/.git is a gitfile whose relative
        // target is Config/repo.nosync/ — a real git dir (HEAD present) beside Source/.
        let pkg = tmpDir()
        let source = pkg.appendingPathComponent("Source", isDirectory: true)
        let live = pkg.appendingPathComponent("Config/repo.nosync", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: live, withIntermediateDirectories: true)
        try "ref: refs/heads/main\n".write(to: live.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try "gitdir: ../Config/repo.nosync\n".write(to: source.appendingPathComponent(".git"), atomically: true, encoding: .utf8)

        XCTAssertEqual(
            try SourceRepoPrecondition.cloneSource(for: source).standardizedFileURL.path,
            live.standardizedFileURL.path)
    }

    func testDanglingGitfileThrowsLegibleError() throws {
        // The #879 "fresh peer" shape: gitfile present, its target never synced to this machine.
        let pkg = tmpDir()
        let source = pkg.appendingPathComponent("Source", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "gitdir: ../Config/repo.nosync\n".write(to: source.appendingPathComponent(".git"), atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try SourceRepoPrecondition.cloneSource(for: source)) { error in
            guard case LocalContainerError.cloneFailed(let message) = error else {
                return XCTFail("expected .cloneFailed, got \(error)")
            }
            XCTAssertTrue(message.contains("repo.nosync"), "should name the missing gitdir: \(message)")
        }
    }

    func testMalformedGitfileThrowsLegibleError() throws {
        let dir = tmpDir()
        try "not a gitdir pointer\n".write(to: dir.appendingPathComponent(".git"), atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try SourceRepoPrecondition.cloneSource(for: dir)) { error in
            guard case LocalContainerError.cloneFailed(let message) = error else {
                return XCTFail("expected .cloneFailed, got \(error)")
            }
            XCTAssertTrue(message.contains("gitdir pointer"), "unexpected message: \(message)")
        }
    }
}
