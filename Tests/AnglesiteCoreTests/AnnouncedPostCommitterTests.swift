import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as ReceivedInteractionCommitterTests: real `git` subprocesses
// via raw `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct AnnouncedPostCommitterTests {
    private static func post(id: String, content: String = "Hello, community!") -> AnnouncedPost {
        try! AnnouncedPost(
            id: id, objectType: .note,
            sourceURL: URL(string: "https://member.example/posts/42")!,
            author: .init(name: "Alice", url: URL(string: "https://member.example"), photo: nil),
            content: content,
            published: Date(timeIntervalSince1970: 1_753_299_000),
            announcedAt: Date(timeIntervalSince1970: 1_753_300_000))
    }

    @Test("commit writes each post to data/community-posts/{id}.json and returns their ids")
    func commitWritesAndReturnsIDs() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let ids = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123")], into: siteDirectory)
        #expect(ids == ["ap-abc123"])

        let written = siteDirectory.appendingPathComponent("data/community-posts/ap-abc123.json")
        #expect(FileManager.default.fileExists(atPath: written.path))
    }

    @Test("commit returns empty for an empty post list with no existing files, without touching git")
    func commitEmptyIsNoOp() async {
        let ids = await AnnouncedPostCommitter.commit(
            posts: [], into: URL(fileURLWithPath: "/nonexistent"))
        #expect(ids.isEmpty)
    }

    @Test("commit deletes post files whose id is no longer present in the current set")
    func commitDeletesStaleFiles() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        _ = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123"), Self.post(id: "ap-def456")],
            into: siteDirectory)
        let staleFile = siteDirectory.appendingPathComponent("data/community-posts/ap-def456.json")
        #expect(FileManager.default.fileExists(atPath: staleFile.path))

        // ap-def456 dropped out of the current set (moderator un-announced it, or the member
        // was banned) - the next reconcile should remove its snapshot file. ap-abc123's content
        // is unchanged, so it isn't rewritten - only the deletion shows up in the commit.
        let ids = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123")], into: siteDirectory)
        #expect(ids == ["ap-def456"])
        #expect(!FileManager.default.fileExists(atPath: staleFile.path))
    }

    @Test("commit is a no-op when every post already matches what's on disk and nothing needs deleting")
    func commitNoOpWhenNothingChanged() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let posts = [Self.post(id: "ap-abc123")]
        let firstIDs = await AnnouncedPostCommitter.commit(posts: posts, into: siteDirectory)
        #expect(firstIDs == ["ap-abc123"])

        let callCount = CallCounter()
        let secondIDs = await AnnouncedPostCommitter.commit(
            posts: posts, into: siteDirectory,
            gitCommitBatch: { _, _, _ in
                await callCount.increment()
                return "should-not-be-called"
            })
        #expect(secondIDs.isEmpty)
        #expect(await callCount.value == 0)
    }

    @Test("commit re-writes a post file whose content changed since the last snapshot")
    func commitRewritesChangedContent() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        _ = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123", content: "Hello, community!")], into: siteDirectory)

        let ids = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123", content: "Edited: even better hello!")],
            into: siteDirectory)
        #expect(ids == ["ap-abc123"])

        let written = siteDirectory.appendingPathComponent("data/community-posts/ap-abc123.json")
        let data = try Data(contentsOf: written)
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.contains("Edited: even better hello!"))
    }

    @Test("commit returns empty (not throw) when the git commit closure fails")
    func commitReturnsEmptyOnGitCommitFailure() async throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "community-posts-commit-fail-test-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        let ids = await AnnouncedPostCommitter.commit(
            posts: [Self.post(id: "ap-abc123")], into: dir,
            gitCommitBatch: { _, _, _ in nil })
        #expect(ids.isEmpty)
    }

    @Test("jsonData serializes with sorted keys and ISO 8601 dates")
    func jsonDataFormat() throws {
        let data = try AnnouncedPostCommitter.jsonData(for: Self.post(id: "ap-abc123"))
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.contains("\"id\" : \"ap-abc123\""))
        #expect(text.contains("\"objectType\" : \"note\""))
        // ISO 8601, not epoch seconds/millis - the Astro template's zod schema expects this shape.
        #expect(text.range(of: #""announcedAt" : "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z""#, options: .regularExpression) != nil)
    }

    /// Mirrors `ReceivedInteractionCommitterTests.makeThrowawayGitRepo`.
    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(
            "community-posts-commit-test-\(UUID().uuidString)", isDirectory: true)
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

private actor CallCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
