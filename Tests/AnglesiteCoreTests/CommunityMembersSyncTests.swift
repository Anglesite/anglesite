import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as AnnouncedPostSyncTests: real `git` subprocesses via raw
// `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct CommunityMembersSyncTests {
    private static func response(_ status: Int, url: String = "https://community.example/") -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: url)!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    private static func pageBody(items: [Any], next: String? = nil) -> Data {
        var page: [String: Any] = ["orderedItems": items]
        if let next { page["next"] = next }
        return try! JSONSerialization.data(withJSONObject: page)
    }

    private static func actorProfileBody(name: String, icon: String? = nil) -> Data {
        var doc: [String: Any] = ["preferredUsername": "alice", "name": name]
        if let icon { doc["icon"] = ["url": icon] }
        return try! JSONSerialization.data(withJSONObject: doc)
    }

    // MARK: - FollowersCollectionClient.actorURL

    @Test("actorURL accepts a bare actor IRI string")
    func actorURLAcceptsBareString() {
        let url = CommunityMembersSync.FollowersCollectionClient.actorURL(from: "https://member.example/actor")
        #expect(url?.absoluteString == "https://member.example/actor")
    }

    @Test("actorURL accepts a minimal {id} object")
    func actorURLAcceptsObjectShape() {
        let url = CommunityMembersSync.FollowersCollectionClient.actorURL(from: ["id": "https://member.example/actor"])
        #expect(url?.absoluteString == "https://member.example/actor")
    }

    @Test("actorURL rejects a non-http(s) scheme")
    func actorURLRejectsInsecureScheme() {
        #expect(CommunityMembersSync.FollowersCollectionClient.actorURL(from: "urn:uuid:not-a-web-url") == nil)
    }

    @Test("actorURL rejects an unparseable item")
    func actorURLRejectsUnparseable() {
        #expect(CommunityMembersSync.FollowersCollectionClient.actorURL(from: 42) == nil)
        #expect(CommunityMembersSync.FollowersCollectionClient.actorURL(from: ["type": "Note"]) == nil)
    }

    // MARK: - fileID

    @Test("fileID derives a stable, path-safe id from an actor IRI")
    func fileIDIsStableAndPathSafe() {
        let url = URL(string: "https://member.example/actor")!
        let first = CommunityMembersSync.fileID(for: url)
        let second = CommunityMembersSync.fileID(for: url)
        #expect(first == second)
        #expect(first.range(of: #"^member-[0-9a-f]{16}$"#, options: .regularExpression) != nil)
        #expect(first != CommunityMembersSync.fileID(for: URL(string: "https://member.example/actor2")!))
    }

    // MARK: - makeMember

    @Test("makeMember resolves the profile from a cache hit without calling the fetcher")
    func makeMemberUsesCacheHit() async throws {
        let actorURL = URL(string: "https://member.example/actor")!
        let now = Date(timeIntervalSince1970: 1_753_400_000)
        var cache = ActorProfileCache()
        cache.store(ActorProfile(
            actor: actorURL, preferredUsername: "alice",
            name: "Alice", iconURL: URL(string: "https://member.example/alice.jpg"), fetchedAt: now))

        let fetcher = ActorProfileFetcher(transport: { _ in
            Issue.record("fetcher must not be called on a cache hit")
            struct Unexpected: Error {}
            throw Unexpected()
        })

        let member = await CommunityMembersSync.makeMember(for: actorURL, cache: &cache, fetcher: fetcher, now: now)
        #expect(member?.name == "Alice")
        #expect(member?.photo?.absoluteString == "https://member.example/alice.jpg")
    }

    @Test("makeMember fetches and caches the profile on a cache miss")
    func makeMemberFetchesOnCacheMiss() async throws {
        let actorURL = URL(string: "https://member.example/actor")!
        let now = Date(timeIntervalSince1970: 1_753_400_000)
        var cache = ActorProfileCache()
        let body = Self.actorProfileBody(name: "Alice", icon: "https://member.example/alice.jpg")
        let fetcher = ActorProfileFetcher(transport: { _ in (body, Self.response(200, url: actorURL.absoluteString)) })

        let member = await CommunityMembersSync.makeMember(for: actorURL, cache: &cache, fetcher: fetcher, now: now)
        #expect(member?.name == "Alice")
        #expect(cache.profile(for: actorURL, now: now) != nil)
    }

    @Test("makeMember still produces a member (name/photo nil) when the profile fetch fails")
    func makeMemberFallsBackOnFetchFailure() async throws {
        let actorURL = URL(string: "https://member.example/actor")!
        var cache = ActorProfileCache()
        let fetcher = ActorProfileFetcher(transport: { _ in (Data(), Self.response(500, url: actorURL.absoluteString)) })

        let member = await CommunityMembersSync.makeMember(for: actorURL, cache: &cache, fetcher: fetcher, now: Date())
        #expect(member?.actorURL == actorURL)
        #expect(member?.name == nil)
    }

    @Test("makeMember returns a stable, path-safe id derived from the actor IRI")
    func makeMemberDerivesStableID() async throws {
        let actorURL = URL(string: "https://member.example/actor")!
        var cache = ActorProfileCache()
        let fetcher = ActorProfileFetcher(transport: { _ in (Data(), Self.response(500)) })
        let now = Date()

        let first = await CommunityMembersSync.makeMember(for: actorURL, cache: &cache, fetcher: fetcher, now: now)
        let second = await CommunityMembersSync.makeMember(for: actorURL, cache: &cache, fetcher: fetcher, now: now)
        #expect(first?.id == second?.id)
        #expect(first?.id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil)
    }

    // MARK: - pullAndCommit

    @Test("pulls members from the followers collection and commits them")
    func pullsAndCommits() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/followers?page=1"])
        let pageBody = Self.pageBody(items: ["https://member.example/actor"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await CommunityMembersSync.pullAndCommit(
            actorURL: URL(string: "https://community.example/users/birding")!,
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/followers") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (pageBody, Self.response(200)) }
                if path.contains("/actor") { return (profileBody, Self.response(200)) }
                return (Data(), Self.response(404))
            })

        #expect(count == 1)
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: siteDirectory.appendingPathComponent("data/community-members"), includingPropertiesForKeys: nil)) ?? []
        #expect(entries.count == 1)
        let written = try #require(entries.first)
        let text = try String(contentsOf: written, encoding: .utf8)
        #expect(text.contains("Alice"))
    }

    @Test("requests the collection at <actorURL>/followers")
    func requestsFollowersPath() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        var requestedURL: String?
        _ = await CommunityMembersSync.pullAndCommit(
            actorURL: URL(string: "https://community.example/users/birding")!,
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                if requestedURL == nil { requestedURL = request.url!.absoluteString }
                return (Data(), Self.response(500))
            })
        #expect(requestedURL == "https://community.example/users/birding/followers")
    }

    @Test("returns 0 without touching git when the first-page fetch fails")
    func firstPageFailureIsNoOp() async throws {
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let count = await CommunityMembersSync.pullAndCommit(
            actorURL: URL(string: "https://community.example/users/birding")!,
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDirectory,
            transport: { _ in (Data(), Self.response(500)) })
        #expect(count == 0)
    }

    @Test("follows a multi-page next chain and collects members from every page")
    func followsMultiPageChain() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/followers?page=1"])
        let page1 = Self.pageBody(items: ["https://member.example/actor1"], next: "https://community.example/users/birding/followers?page=2")
        let page2 = Self.pageBody(items: ["https://member.example/actor2"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await CommunityMembersSync.pullAndCommit(
            actorURL: URL(string: "https://community.example/users/birding")!,
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/followers") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (page1, Self.response(200)) }
                if path.contains("page=2") { return (page2, Self.response(200)) }
                return (profileBody, Self.response(200))
            })

        #expect(count == 2)
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: siteDirectory.appendingPathComponent("data/community-members"), includingPropertiesForKeys: nil)) ?? []
        #expect(entries.count == 2)
    }

    @Test("reconciles away a snapshot whose member is no longer in the followers collection (left or banned)")
    func reconcilesAwayRemovedMember() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let actorURL = URL(string: "https://community.example/users/birding")!
        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/followers?page=1"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        _ = await CommunityMembersSync.pullAndCommit(
            actorURL: actorURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/followers") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: ["https://member.example/actor"]), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        let dir = siteDirectory.appendingPathComponent("data/community-members")
        #expect((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?.count == 1)

        // Second sync: the followers collection is now empty (the member left, or was banned).
        let count = await CommunityMembersSync.pullAndCommit(
            actorURL: actorURL, siteDirectory: siteDirectory, configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/followers") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: []), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        #expect(count == 1)
        #expect(((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []).isEmpty)
    }

    // MARK: - pullAndCommitIfConfigured

    @Test("pullAndCommitIfConfigured no-ops when communityActorURL is unset")
    func noOpsWithoutCommunityActorURL() async throws {
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }

        let count = await CommunityMembersSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDirectory,
            transport: { _ in
                Issue.record("transport must not be called with no communityActorURL configured")
                struct Unexpected: Error {}
                throw Unexpected()
            })
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured reads communityActorURL and syncs when set")
    func syncsWhenConfigured() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let configDirectory = try Self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: configDirectory) }
        try await SiteConfigStore(configDirectory: configDirectory).save(
            SiteSettings(communityActorURL: URL(string: "https://community.example/users/birding")!))

        let collectionBody = try! JSONSerialization.data(withJSONObject: ["first": "https://community.example/users/birding/followers?page=1"])
        let profileBody = Self.actorProfileBody(name: "Alice")

        let count = await CommunityMembersSync.pullAndCommitIfConfigured(
            siteDirectory: siteDirectory,
            configDirectory: configDirectory,
            transport: { request in
                let path = request.url!.absoluteString
                if path.hasSuffix("/followers") { return (collectionBody, Self.response(200)) }
                if path.contains("page=1") { return (Self.pageBody(items: ["https://member.example/actor"]), Self.response(200)) }
                return (profileBody, Self.response(200))
            })
        #expect(count == 1)
    }

    private static func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
            "community-members-sync-config-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Mirrors `AnnouncedPostSyncTests.makeThrowawayGitRepo`.
    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("community-members-sync-repo-\(UUID().uuidString)", isDirectory: true)
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
