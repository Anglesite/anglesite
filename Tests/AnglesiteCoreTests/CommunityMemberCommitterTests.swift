import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as AnnouncedPostCommitterTests: real `git` subprocesses via raw
// `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct CommunityMemberCommitterTests {
    private static func member(id: String, name: String = "Alice") -> CommunityMember {
        try! CommunityMember(
            id: id, actorURL: URL(string: "https://member.example/actor")!,
            name: name, photo: nil)
    }

    @Test("commit writes each member to data/community-members/{id}.json and returns their ids")
    func commitWritesAndReturnsIDs() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let ids = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123")], into: siteDirectory)
        #expect(ids == ["member-abc123"])

        let written = siteDirectory.appendingPathComponent("data/community-members/member-abc123.json")
        #expect(FileManager.default.fileExists(atPath: written.path))
    }

    @Test("commit returns empty for an empty member list with no existing files, without touching git")
    func commitEmptyIsNoOp() async {
        let ids = await CommunityMemberCommitter.commit(
            members: [], into: URL(fileURLWithPath: "/nonexistent"))
        #expect(ids.isEmpty)
    }

    @Test("commit deletes member files whose id is no longer present in the current set")
    func commitDeletesStaleFiles() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        _ = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123"), Self.member(id: "member-def456")],
            into: siteDirectory)
        let staleFile = siteDirectory.appendingPathComponent("data/community-members/member-def456.json")
        #expect(FileManager.default.fileExists(atPath: staleFile.path))

        // member-def456 dropped out of the current set (left, or was banned) - the next
        // reconcile should remove its snapshot file. member-abc123 is unchanged, so it isn't
        // rewritten - only the deletion shows up in the commit.
        let ids = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123")], into: siteDirectory)
        #expect(ids == ["member-def456"])
        #expect(!FileManager.default.fileExists(atPath: staleFile.path))
    }

    @Test("commit is a no-op when every member already matches what's on disk and nothing needs deleting")
    func commitNoOpWhenNothingChanged() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let members = [Self.member(id: "member-abc123")]
        let firstIDs = await CommunityMemberCommitter.commit(members: members, into: siteDirectory)
        #expect(firstIDs == ["member-abc123"])

        let callCount = CommunityMemberCommitterCallCounter()
        let secondIDs = await CommunityMemberCommitter.commit(
            members: members, into: siteDirectory,
            gitCommitBatch: { _, _, _ in
                await callCount.increment()
                return "should-not-be-called"
            })
        #expect(secondIDs.isEmpty)
        #expect(await callCount.value == 0)
    }

    @Test("commit re-writes a member file whose profile changed since the last snapshot")
    func commitRewritesChangedProfile() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        _ = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123", name: "Alice")], into: siteDirectory)

        let ids = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123", name: "Alice Updated")],
            into: siteDirectory)
        #expect(ids == ["member-abc123"])

        let written = siteDirectory.appendingPathComponent("data/community-members/member-abc123.json")
        let data = try Data(contentsOf: written)
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.contains("Alice Updated"))
    }

    @Test("commit returns empty (not throw) when the git commit closure fails")
    func commitReturnsEmptyOnGitCommitFailure() async throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "community-members-commit-fail-test-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        let ids = await CommunityMemberCommitter.commit(
            members: [Self.member(id: "member-abc123")], into: dir,
            gitCommitBatch: { _, _, _ in nil })
        #expect(ids.isEmpty)
    }

    @Test("jsonData serializes with sorted keys")
    func jsonDataFormat() throws {
        let data = try CommunityMemberCommitter.jsonData(for: Self.member(id: "member-abc123"))
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.contains("\"id\" : \"member-abc123\""))
        #expect(text.contains("\"name\" : \"Alice\""))
    }

    /// Mirrors `AnnouncedPostCommitterTests.makeThrowawayGitRepo`.
    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "community-members-commit-test-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try "placeholder\n".write(to: dir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = dir
            p.environment = ProcessInfo.processInfo.environment.merging([
                "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@anglesite.test",
                "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@anglesite.test",
            ]) { _, new in new }
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else {
                struct GitFailed: Error {}
                throw GitFailed()
            }
        }
        try git(["init", "-q"])
        try git(["config", "user.email", "test@anglesite.test"])
        try git(["config", "user.name", "test"])
        try git(["add", "-A"])
        try git(["commit", "-q", "-m", "initial"])
        return dir
    }
}

private actor CommunityMemberCommitterCallCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
