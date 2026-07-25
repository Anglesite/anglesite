// Tests/AnglesiteCoreTests/MicropubContentCommitterTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as ReceivedInteractionCommitterTests: real `git` subprocesses
// via raw `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct MicropubContentCommitterTests {
    private static func post(
        url: String, collection: String = "notes", body: String = "Hello world",
        updatedAt: Int = 1_753_300_000
    ) -> MicropubContentSync.ResolvedPost {
        let descriptor = ContentTypeRegistry.default.descriptor(forCollection: collection)!
        var values = TypedContentEditor.Values()
        values["body"] = .text(body)
        values["publishDate"] = .date(Date(timeIntervalSince1970: 1_753_358_400))
        values["tags"] = .list([])
        values["draft"] = .flag(false)
        return MicropubContentSync.ResolvedPost(
            url: url, collection: collection, descriptor: descriptor, values: values, updatedAt: updatedAt)
    }

    @Test("commit writes a new post to src/content/<collection>/<slug>.md and records it in micropubSync.json")
    func commitWritesNewPost() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let count = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123")],
            into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)

        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        #expect(FileManager.default.fileExists(atPath: written.path))
        let contents = try String(contentsOf: written, encoding: .utf8)
        #expect(contents.contains("Hello world"))

        let stateURL = configDirectory.appendingPathComponent("micropubSync.json")
        let stateData = try Data(contentsOf: stateURL)
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        #expect(state["https://me.example/notes/hello-abc123"] == "src/content/notes/hello-abc123.md")
    }

    @Test("a second sync of the same post updates the same file without re-suffixing")
    func secondSyncUpdatesInPlace() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "First version")],
            into: siteDirectory, configDirectory: configDirectory)

        let count = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "Edited version")],
            into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)

        // Still exactly the original path — no "-2" suffix from a spurious collision.
        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        let contents = try String(contentsOf: written, encoding: .utf8)
        #expect(contents.contains("Edited version"))
        #expect(!FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123-2.md").path))
    }

    @Test("a slug colliding with an existing hand-authored file is suffixed, never overwritten")
    func collisionWithHandAuthoredFileIsSuffixed() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let notesDir = siteDirectory.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: notesDir, withIntermediateDirectories: true)
        try "---\nbody: \"hand-authored\"\n---\n".write(
            to: notesDir.appendingPathComponent("hello-abc123.md"), atomically: true, encoding: .utf8)

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123", body: "From Micropub")],
            into: siteDirectory, configDirectory: configDirectory)

        let original = try String(contentsOf: notesDir.appendingPathComponent("hello-abc123.md"), encoding: .utf8)
        #expect(original.contains("hand-authored"))
        let suffixed = try String(contentsOf: notesDir.appendingPathComponent("hello-abc123-2.md"), encoding: .utf8)
        #expect(suffixed.contains("From Micropub"))
    }

    @Test("a second, unrelated post whose natural slug matches an earlier post's suffixed path gets its own file")
    func distinctPostsWithCollidingNaturalSlugsGetDistinctFiles() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        // A hand-authored file already occupies the slug "hello" — post A (slug "hello") collides
        // with it and gets suffixed to "hello-2.md".
        let notesDir = siteDirectory.appendingPathComponent("src/content/notes", isDirectory: true)
        try FileManager.default.createDirectory(at: notesDir, withIntermediateDirectories: true)
        try "---\nbody: \"hand-authored\"\n---\n".write(
            to: notesDir.appendingPathComponent("hello.md"), atomically: true, encoding: .utf8)
        let postA = Self.post(url: "https://me.example/notes/hello", body: "Post A")

        // Post B is a completely distinct, later-created URL (e.g. an explicit `mp-slug=hello-2`)
        // whose OWN natural slug happens to be "hello-2" — the exact path A was just suffixed
        // onto. `@dwk/micropub`'s URL-uniqueness check is per-URL, not per-eventual-filename, so
        // this is a legitimate, distinct post. Before the fix, `ownedPaths.contains(relPath)`
        // treated A's own suffixed path as "free real estate" for any post, so B silently
        // collapsed onto A's file instead of suffixing past it.
        let postB = Self.post(url: "https://me.example/notes/hello-2", body: "Post B")

        _ = await MicropubContentCommitter.commit(
            posts: [postA, postB], into: siteDirectory, configDirectory: configDirectory)

        let stateData = try Data(contentsOf: configDirectory.appendingPathComponent("micropubSync.json"))
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        let pathA = try #require(state["https://me.example/notes/hello"])
        let pathB = try #require(state["https://me.example/notes/hello-2"])
        #expect(pathA == "src/content/notes/hello-2.md")
        #expect(pathA != pathB, "distinct Micropub posts must never collapse onto the same file")

        let contentsA = try String(contentsOf: siteDirectory.appendingPathComponent(pathA), encoding: .utf8)
        let contentsB = try String(contentsOf: siteDirectory.appendingPathComponent(pathB), encoding: .utf8)
        #expect(contentsA.contains("Post A"))
        #expect(contentsB.contains("Post B"))
    }

    @Test("commit deletes the file and state entry for a post no longer in the resolved set")
    func commitDeletesStalePost() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123")],
            into: siteDirectory, configDirectory: configDirectory)
        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")
        #expect(FileManager.default.fileExists(atPath: written.path))

        // The post is now absent from the resolved set (soft-deleted in D1, or fell out of scope).
        let count = await MicropubContentCommitter.commit(
            posts: [], into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)
        #expect(!FileManager.default.fileExists(atPath: written.path))

        let stateData = try Data(contentsOf: configDirectory.appendingPathComponent("micropubSync.json"))
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        #expect(state.isEmpty)
    }

    @Test("a stale state entry for an already hand-deleted file is still dropped, not retried forever")
    func staleStateEntryForAlreadyDeletedFileIsDropped() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        _ = await MicropubContentCommitter.commit(
            posts: [Self.post(url: "https://me.example/notes/hello-abc123")],
            into: siteDirectory, configDirectory: configDirectory)
        let written = siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md")

        // Simulate the file having already been removed by hand, outside the app, before the
        // post falls out of the resolved set.
        try FileManager.default.removeItem(at: written)

        let count = await MicropubContentCommitter.commit(
            posts: [], into: siteDirectory, configDirectory: configDirectory)
        #expect(count == 0)  // nothing was actually removed by this call — it was already gone

        let stateData = try Data(contentsOf: configDirectory.appendingPathComponent("micropubSync.json"))
        let state = try JSONDecoder().decode([String: String].self, from: stateData)
        #expect(state.isEmpty, "the stale entry must be dropped even though removeItem had nothing to remove")
    }

    @Test("commit is a no-op when nothing changed")
    func commitNoOpWhenNothingChanged() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let posts = [Self.post(url: "https://me.example/notes/hello-abc123")]
        _ = await MicropubContentCommitter.commit(posts: posts, into: siteDirectory, configDirectory: configDirectory)

        let callCount = CallCounter()
        let count = await MicropubContentCommitter.commit(
            posts: posts, into: siteDirectory, configDirectory: configDirectory,
            gitCommitBatch: { _, _, _ in
                await callCount.increment()
                return "should-not-be-called"
            })
        #expect(count == 0)
        #expect(await callCount.value == 0)
    }

    @Test("a git-commit failure still records state, so a retry doesn't duplicate the file with a suffixed slug")
    func gitFailureStillRecordsStateToAvoidDuplication() async throws {
        let (siteDirectory, configDirectory) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let posts = [Self.post(url: "https://me.example/notes/hello-abc123")]
        let firstCount = await MicropubContentCommitter.commit(
            posts: posts, into: siteDirectory, configDirectory: configDirectory,
            gitCommitBatch: { _, _, _ in nil })
        #expect(firstCount == 0)

        // The file is on disk (uncommitted) and state.json already points at it — a retry must
        // reuse that exact path rather than treating the leftover file as a foreign collision.
        let retryCount = await MicropubContentCommitter.commit(posts: posts, into: siteDirectory, configDirectory: configDirectory)
        #expect(retryCount == 0) // content unchanged since the failed attempt — nothing to (re-)commit
        #expect(!FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123-2.md").path))
    }

    @Test("commitMessage describes write-only, delete-only, and mixed reconciles")
    func commitMessageVariants() {
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 1, deletedCount: 0) == "micropub: sync 1 post")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 2, deletedCount: 0) == "micropub: sync 2 posts")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 0, deletedCount: 1) == "micropub: remove 1 post")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 0, deletedCount: 2) == "micropub: remove 2 posts")
        #expect(MicropubContentCommitter.commitMessage(writtenCount: 1, deletedCount: 1) == "micropub: sync 1 post, remove 1")
    }

    /// A throwaway `.anglesite`-style package: `Source/` (a git repo) beside `Config/`.
    private static func makeThrowawaySite() throws -> (siteDirectory: URL, configDirectory: URL) {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("micropub-commit-test-\(UUID().uuidString)", isDirectory: true)
        let siteDirectory = root.appendingPathComponent("Source", isDirectory: true)
        let configDirectory = root.appendingPathComponent("Config", isDirectory: true)
        try fm.createDirectory(at: siteDirectory, withIntermediateDirectories: true)
        try fm.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        try "placeholder\n".write(to: siteDirectory.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        func git(_ args: [String]) throws {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            p.arguments = args
            p.currentDirectoryURL = siteDirectory
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
        return (siteDirectory, configDirectory)
    }
}

private actor CallCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
