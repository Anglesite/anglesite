import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as ReceivedInteractionSyncTests: real `git` subprocesses via
// raw `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct AnnouncedPostSyncTests {
    private static func response(_ status: Int, url: String = "https://community.example/") -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: url)!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    private static func announceJSON(
        innerID: String = "https://member.example/posts/1",
        objectType: String = "Note",
        attributedTo: String? = "https://member.example/users/alice",
        content: String? = "Hello, community!",
        published: String? = "2026-07-01T00:00:00Z",
        announcedPublished: String? = "2026-07-01T00:00:05Z"
    ) -> [String: Any] {
        var object: [String: Any] = ["id": innerID, "type": objectType]
        if let attributedTo { object["attributedTo"] = attributedTo }
        if let content { object["content"] = content }
        if let published { object["published"] = published }
        var activity: [String: Any] = ["type": "Announce", "object": object]
        if let announcedPublished { activity["published"] = announcedPublished }
        return activity
    }

    private static func pageBody(items: [[String: Any]], next: String? = nil) -> Data {
        var page: [String: Any] = ["orderedItems": items]
        if let next { page["next"] = next }
        return try! JSONSerialization.data(withJSONObject: page)
    }

    private static func actorProfileBody(name: String, icon: String? = nil) -> Data {
        var doc: [String: Any] = ["preferredUsername": "alice", "name": name]
        if let icon { doc["icon"] = ["url": icon] }
        return try! JSONSerialization.data(withJSONObject: doc)
    }

    // MARK: - RawAnnounce mapping

    @Test("OutboxClient.announce unwraps an Announce into a RawAnnounce")
    func announceUnwrapsRawAnnounce() {
        let raw = AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON())
        #expect(raw?.id == "https://member.example/posts/1")
        #expect(raw?.objectType == .note)
        #expect(raw?.attributedTo?.absoluteString == "https://member.example/users/alice")
        #expect(raw?.content == "Hello, community!")
    }

    @Test("OutboxClient.announce skips non-Announce activities")
    func announceSkipsNonAnnounce() {
        let create: [String: Any] = ["type": "Create", "object": ["id": "x", "type": "Note"]]
        #expect(AnnouncedPostSync.OutboxClient.announce(from: create) == nil)
    }

    @Test("OutboxClient.announce skips a bare activity-id string")
    func announceSkipsBareString() {
        #expect(AnnouncedPostSync.OutboxClient.announce(from: "https://example.com/activities/1") == nil)
    }

    @Test("OutboxClient.announce defaults an unrecognized object type to note")
    func announceDefaultsUnknownObjectType() {
        let raw = AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON(objectType: "Tombstone"))
        #expect(raw?.objectType == .note)
    }

    @Test("OutboxClient.announce rejects a wrapped object whose id isn't http(s)")
    func announceRejectsNonWebSourceScheme() {
        let raw = AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON(innerID: "urn:uuid:not-a-web-url"))
        #expect(raw == nil)
    }

    @Test("fileID derives a stable, path-safe, 16-hex-char id from an object IRI")
    func fileIDIsStableAndPathSafe() {
        let url = URL(string: "https://member.example/posts/1")!
        let first = AnnouncedPostSync.fileID(for: url)
        let second = AnnouncedPostSync.fileID(for: url)
        #expect(first == second)
        #expect(first.range(of: #"^community-[0-9a-f]{16}$"#, options: .regularExpression) != nil)
        #expect(first != AnnouncedPostSync.fileID(for: URL(string: "https://member.example/posts/2")!))
    }

    // MARK: - makePost

    @Test("makePost resolves the author from a cache hit without calling the fetcher")
    func makePostUsesCacheHit() async throws {
        let raw = try #require(AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON()))
        let now = Date(timeIntervalSince1970: 1_753_400_000)
        var cache = ActorProfileCache()
        cache.store(ActorProfile(
            actor: URL(string: "https://member.example/users/alice")!, preferredUsername: "alice",
            name: "Alice", iconURL: URL(string: "https://member.example/alice.jpg"), fetchedAt: now))

        let fetcher = ActorProfileFetcher(transport: { _ in
            Issue.record("fetcher must not be called on a cache hit")
            struct Unexpected: Error {}
            throw Unexpected()
        })

        let post = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now)
        #expect(post?.author?.name == "Alice")
        #expect(post?.author?.photo?.absoluteString == "https://member.example/alice.jpg")
    }

    @Test("makePost fetches and caches the author on a cache miss")
    func makePostFetchesOnCacheMiss() async throws {
        let raw = try #require(AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON()))
        let now = Date(timeIntervalSince1970: 1_753_400_000)
        var cache = ActorProfileCache()
        let body = Self.actorProfileBody(name: "Alice", icon: "https://member.example/alice.jpg")
        let fetcher = ActorProfileFetcher(transport: { _ in (body, Self.response(200, url: "https://member.example/users/alice")) })

        let post = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now)
        #expect(post?.author?.name == "Alice")
        #expect(cache.profile(for: URL(string: "https://member.example/users/alice")!, now: now) != nil)
    }

    @Test("makePost falls back to a bare author (IRI only) when the fetch fails")
    func makePostFallsBackOnFetchFailure() async throws {
        let raw = try #require(AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON()))
        let now = Date(timeIntervalSince1970: 1_753_400_000)
        var cache = ActorProfileCache()
        let fetcher = ActorProfileFetcher(transport: { _ in (Data(), Self.response(500, url: "https://member.example/users/alice")) })

        let post = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now)
        #expect(post?.author?.name == nil)
        #expect(post?.author?.url?.absoluteString == "https://member.example/users/alice")
    }

    @Test("makePost returns a stable, path-safe id derived from the object IRI")
    func makePostDerivesStableID() async throws {
        let raw = try #require(AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON()))
        var cache = ActorProfileCache()
        let fetcher = ActorProfileFetcher(transport: { _ in (Data(), Self.response(500)) })
        let now = Date()

        let first = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now)
        let second = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: now)
        #expect(first?.id == second?.id)
        #expect(first?.id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil)
    }

    @Test("makePost has no author when the object carries no attributedTo")
    func makePostNoAttributedTo() async throws {
        let raw = try #require(AnnouncedPostSync.OutboxClient.announce(from: Self.announceJSON(attributedTo: nil)))
        var cache = ActorProfileCache()
        let fetcher = ActorProfileFetcher(transport: { _ in
            Issue.record("fetcher must not be called with no attributedTo")
            struct Unexpected: Error {}
            throw Unexpected()
        })
        let post = await AnnouncedPostSync.makePost(from: raw, cache: &cache, fetcher: fetcher, now: Date())
        #expect(post?.author == nil)
    }

    // MARK: - pullAndCommit

    @Test("pulls announced posts from the outbox and commits them")
    func pullsAndCommits() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/outbox?page=1"])
        let pageBody = Self.pageBody(items: [Self.announceJSON()])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await AnnouncedPostSync.pullAndCommit(
            outboxURL: URL(string: "https://community.example/users/birding/outbox")!,
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/outbox") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (pageBody, Self.response(200)) }
                if path.contains("/users/alice") { return (profileBody, Self.response(200)) }
                return (Data(), Self.response(404))
            })

        #expect(count == 1)
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: siteDirectory.appendingPathComponent("data/community-posts"), includingPropertiesForKeys: nil)) ?? []
        #expect(entries.count == 1)
        // Confirms the injected transport actually serves the author-profile fetch too (not the
        // real network) — asserts through the full sync path, not just `makePost` in isolation.
        let written = try #require(entries.first)
        let text = try String(contentsOf: written, encoding: .utf8)
        #expect(text.contains("Alice"))
    }

    @Test("returns 0 without touching git when the first-page fetch fails")
    func firstPageFailureIsNoOp() async throws {
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let count = await AnnouncedPostSync.pullAndCommit(
            outboxURL: URL(string: "https://community.example/users/birding/outbox")!,
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDirectory,
            transport: { _ in (Data(), Self.response(500)) })
        #expect(count == 0)
    }

    @Test("follows a multi-page next chain and collects posts from every page")
    func followsMultiPageChain() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/outbox?page=1"])
        let page1 = Self.pageBody(
            items: [Self.announceJSON(innerID: "https://member.example/posts/1")],
            next: "https://community.example/users/birding/outbox?page=2")
        let page2 = Self.pageBody(items: [Self.announceJSON(innerID: "https://member.example/posts/2")])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await AnnouncedPostSync.pullAndCommit(
            outboxURL: URL(string: "https://community.example/users/birding/outbox")!,
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/outbox") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (page1, Self.response(200)) }
                if path.contains("page=2") { return (page2, Self.response(200)) }
                return (profileBody, Self.response(200))
            })

        #expect(count == 2)
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: siteDirectory.appendingPathComponent("data/community-posts"), includingPropertiesForKeys: nil)) ?? []
        #expect(entries.count == 2)
    }

    @Test("reconciles away a snapshot whose post is no longer in the outbox (moderator removed it)")
    func reconcilesAwayRemovedPost() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let outboxURL = URL(string: "https://community.example/users/birding/outbox")!
        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/outbox?page=1"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        _ = await AnnouncedPostSync.pullAndCommit(
            outboxURL: outboxURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/outbox") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: [Self.announceJSON()]), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        let dir = siteDirectory.appendingPathComponent("data/community-posts")
        #expect((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?.count == 1)

        // Second sync: the outbox is now empty (moderator un-announced the only post).
        let count = await AnnouncedPostSync.pullAndCommit(
            outboxURL: outboxURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/outbox") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: []), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        #expect(count == 1)
        #expect(((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []).isEmpty)
    }

    // MARK: - pullAndCommitIfConfigured

    @Test("pullAndCommitIfConfigured no-ops when communityOutboxURL is unset")
    func noOpsWithoutCommunityOutboxURL() async throws {
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let count = await AnnouncedPostSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDirectory,
            transport: { _ in
                Issue.record("transport must not be called with no communityOutboxURL configured")
                struct Unexpected: Error {}
                throw Unexpected()
            })
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured reads communityOutboxURL and syncs when set")
    func syncsWhenConfigured() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }
        try await SiteConfigStore(configDirectory: configDirectory).save(
            SiteSettings(communityOutboxURL: URL(string: "https://community.example/users/birding/outbox")!))

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/outbox?page=1"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await AnnouncedPostSync.pullAndCommitIfConfigured(
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/outbox") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: [Self.announceJSON()]), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        #expect(count == 1)
    }

    private static func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
            "community-posts-sync-config-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Mirrors `ReceivedInteractionSyncTests.makeThrowawayGitRepo`.
    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("community-posts-sync-repo-\(UUID().uuidString)", isDirectory: true)
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
