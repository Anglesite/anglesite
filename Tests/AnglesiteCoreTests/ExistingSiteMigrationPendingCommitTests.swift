import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct ExistingSiteMigrationPendingCommitTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test func loadReturnsEmptyWhenFileIsAbsent() {
        let config = tmpDir()
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == ExistingSiteMigrationPendingCommit())
    }

    @Test func saveThenLoadRoundTrips() throws {
        let config = tmpDir()
        let record = ExistingSiteMigrationPendingCommit(pendingPaths: ["scripts/edge-artifacts.ts", ".gitignore"])
        try record.save(to: config)
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == record)
    }

    @Test func loadReturnsEmptyWhenFileIsCorrupt() throws {
        let config = tmpDir()
        try Data("not json".utf8).write(to: config.appendingPathComponent(ExistingSiteMigrationPendingCommit.filename))
        #expect(ExistingSiteMigrationPendingCommit.load(from: config) == ExistingSiteMigrationPendingCommit())
    }
}
