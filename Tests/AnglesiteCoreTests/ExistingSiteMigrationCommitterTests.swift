import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationCommitterTests {
    private func tmpDirs() -> (source: URL, config: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try? FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        return (source, config)
    }

    @Test func emptyTouchedPathsIsANoOpThatReturnsTrue() async throws {
        let (source, config) = tmpDirs()
        var callCount = 0
        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: [], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in callCount += 1; return "deadbeef" }
        )
        #expect(result == true)
        #expect(callCount == 0)
    }

    @Test func successfulCommitClearsThePendingRecord() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)

        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["file.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in "deadbeef" }
        )

        #expect(result == true)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths.isEmpty)
    }

    @Test func failedCommitLeavesThePendingRecordSet() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)

        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["file.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in nil }
        )

        #expect(result == false)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths == ["file.txt"])
    }

    @Test func pathsThatDoNotExistOnDiskAreExcludedFromTheCommit() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("real.txt"), atomically: true, encoding: .utf8)

        var committedPaths: [String] = []
        let result = await ExistingSiteMigrationCommitter.commit(
            touchedPaths: ["real.txt", "never-written.txt"], sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, paths, _ in committedPaths = paths; return "deadbeef" }
        )

        #expect(result == true)
        #expect(committedPaths == ["real.txt"])
    }

    @Test func retryPendingCommitIsANoOpWhenNothingIsPending() async throws {
        let (source, config) = tmpDirs()
        var callCount = 0
        let result = await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in callCount += 1; return "deadbeef" }
        )
        #expect(result == true)
        #expect(callCount == 0)
    }

    @Test func retryPendingCommitRetriesAndClearsAPriorFailure() async throws {
        let (source, config) = tmpDirs()
        try "content".write(to: source.appendingPathComponent("file.txt"), atomically: true, encoding: .utf8)
        try ExistingSiteMigrationPendingCommit(pendingPaths: ["file.txt"]).save(to: config)

        let result = await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in "deadbeef" }
        )

        #expect(result == true)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths.isEmpty)
    }

    @Test func retryPendingCommitClearsStaleRecordWhenAllPathsHaveDisappeared() async throws {
        let (source, config) = tmpDirs()
        try ExistingSiteMigrationPendingCommit(pendingPaths: ["vanished.txt"]).save(to: config)

        let result = await ExistingSiteMigrationCommitter.retryPendingCommit(
            sourceDirectory: source, configDirectory: config, message: "test",
            gitCommitBatch: { _, _, _ in "deadbeef" }
        )

        #expect(result == true)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config).pendingPaths.isEmpty)
    }
}
