import Testing
import Foundation
@testable import AnglesiteCore

// Serialized for the same reason as InboxSubmissionSyncTests: real `git` subprocesses via raw
// `Process()` in `makeThrowawayGitRepo()` trip a rare CI heap-corruption crash when run
// concurrently with the rest of the subprocess-heavy suite.
@Suite(.serialized)
struct ReceivedInteractionSyncTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    private static func d1Body(_ rowsJSON: String) -> Data {
        Data("""
        {"success": true, "result": [{"success": true, "results": [\(rowsJSON)]}]}
        """.utf8)
    }

    // MARK: - makeInteraction mapping

    @Test("makeInteraction maps a fully-enriched mention")
    func makeInteractionMapsFullMention() throws {
        let mention = WebmentionInboxD1Client.Mention(
            id: "wm-abc123", source: "https://alice.example/post", target: "https://me.example/blog/hi",
            verifiedAt: 1_753_300_000_000, interactionType: "reply", authorName: "Alice",
            authorURL: "https://alice.example", authorPhoto: "https://alice.example/photo.jpg",
            content: "Great post!", publishedAt: 1_753_299_000_000)

        let interaction = try #require(ReceivedInteractionSync.makeInteraction(from: mention))
        #expect(interaction.id == "wm-abc123")
        #expect(interaction.type == .webmention)
        #expect(interaction.interactionType == .reply)
        #expect(interaction.author?.name == "Alice")
        #expect(interaction.author?.url?.absoluteString == "https://alice.example")
        #expect(interaction.content == "Great post!")
        #expect(interaction.verificationStatus == .verified)
        #expect(interaction.published.timeIntervalSince1970 == 1_753_299_000)
        #expect(interaction.verified.timeIntervalSince1970 == 1_753_300_000)
    }

    @Test("makeInteraction defaults a legacy (pre-enrichment) mention to a plain mention with no author/content")
    func makeInteractionDefaultsLegacyMention() throws {
        let mention = WebmentionInboxD1Client.Mention(
            id: "wm-def456", source: "https://bob.example/post", target: "https://me.example/blog/hi",
            verifiedAt: 1_753_300_000_000, interactionType: nil, authorName: nil,
            authorURL: nil, authorPhoto: nil, content: nil, publishedAt: nil)

        let interaction = try #require(ReceivedInteractionSync.makeInteraction(from: mention))
        #expect(interaction.interactionType == .mention)
        #expect(interaction.author == nil)
        #expect(interaction.content == nil)
        // publishedAt falls back to verifiedAt, matching the Worker's own list() fallback.
        #expect(interaction.published == interaction.verified)
    }

    @Test("makeInteraction returns nil for an unparseable source URL")
    func makeInteractionSkipsInvalidSourceURL() {
        let mention = WebmentionInboxD1Client.Mention(
            id: "wm-bad", source: "", target: "https://me.example/blog/hi",
            verifiedAt: 1_753_300_000_000, interactionType: nil, authorName: nil,
            authorURL: nil, authorPhoto: nil, content: nil, publishedAt: nil)
        #expect(ReceivedInteractionSync.makeInteraction(from: mention) == nil)
    }

    // MARK: - pullAndCommit

    @Test("pulls verified mentions from D1 and commits them")
    func pullsAndCommits() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let body = Self.d1Body("""
        {"id": "wm-abc123", "source": "https://alice.example/post", "target": "https://me.example/blog/hi",
         "verified_at": 1753300000000, "interaction_type": "reply", "author_name": "Alice",
         "author_url": null, "author_photo": null, "content": "Great post!", "published_at": 1753299000000}
        """)
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (body, Self.response(200)) })

        let count = await ReceivedInteractionSync.pullAndCommit(client: client, siteDirectory: siteDirectory)
        #expect(count == 1)
        let written = siteDirectory.appendingPathComponent("data/interactions/wm-abc123.json")
        #expect(FileManager.default.fileExists(atPath: written.path))
    }

    @Test("returns 0 without touching git when D1 has nothing and no local snapshot files exist")
    func emptyInboxIsNoOp() async throws {
        let body = Self.d1Body("")
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (body, Self.response(200)) })

        let count = await ReceivedInteractionSync.pullAndCommit(
            client: client, siteDirectory: URL(fileURLWithPath: "/nonexistent"))
        #expect(count == 0)
    }

    @Test("reconciles away stale local snapshot files when D1 no longer has that mention")
    func reconcilesAwayStaleFiles() async throws {
        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let interactionsDir = siteDirectory.appendingPathComponent("data/interactions", isDirectory: true)
        try FileManager.default.createDirectory(at: interactionsDir, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: interactionsDir.appendingPathComponent("wm-stale.json"))

        let body = Self.d1Body("")
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (body, Self.response(200)) })

        let count = await ReceivedInteractionSync.pullAndCommit(client: client, siteDirectory: siteDirectory)
        #expect(count == 1)
        #expect(!FileManager.default.fileExists(
            atPath: interactionsDir.appendingPathComponent("wm-stale.json").path))
    }

    @Test("returns 0 without touching git when the D1 query fails")
    func d1FailureIsNoOp() async throws {
        let client = WebmentionInboxD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (Data(), Self.response(500)) })

        let count = await ReceivedInteractionSync.pullAndCommit(
            client: client, siteDirectory: URL(fileURLWithPath: "/nonexistent"))
        #expect(count == 0)
    }

    // MARK: - pullAndCommitIfConfigured

    @Test("pullAndCommitIfConfigured no-ops when the site has no provisioned D1 database")
    func noOpsWithoutD1Database() async {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("interactions-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }

        let count = await ReceivedInteractionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "unused"),
            transport: { _ in
                Issue.record("transport must not be called with no provisioned D1 database")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops (with no network call) when a D1 database is provisioned but no token is stored")
    func noOpsWithNoToken() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("interactions-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(d1DatabaseID: "db1")))

        let count = await ReceivedInteractionSync.pullAndCommitIfConfigured(
            siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: nil),
            transport: { _ in
                Issue.record("transport must not be called when no Cloudflare token is available")
                struct UnexpectedNetworkCall: Error {}
                throw UnexpectedNetworkCall()
            })
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured resolves the account id, queries D1, and commits")
    func resolvesAccountAndCommits() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("interactions-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(d1DatabaseID: "db1")))

        let siteDirectory = try Self.makeThrowawayGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }

        let accountsBody = Data("""
        {"success": true, "result": [{"id": "acct1"}]}
        """.utf8)
        let d1Body = Self.d1Body("""
        {"id": "wm-abc123", "source": "https://alice.example/post", "target": "https://me.example/blog/hi",
         "verified_at": 1753300000000, "interaction_type": "reply", "author_name": "Alice",
         "author_url": null, "author_photo": null, "content": "Great post!", "published_at": 1753299000000}
        """)

        let count = await ReceivedInteractionSync.pullAndCommitIfConfigured(
            siteDirectory: siteDirectory,
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "token"),
            transport: { request in
                if request.url!.path.hasSuffix("/accounts") { return (accountsBody, Self.response(200)) }
                if request.url!.path.contains("/d1/database/db1/query") { return (d1Body, Self.response(200)) }
                return (Data(), Self.response(404))
            })
        #expect(count == 1)
        let written = siteDirectory.appendingPathComponent("data/interactions/wm-abc123.json")
        #expect(FileManager.default.fileExists(atPath: written.path))
    }

    private static func makeThrowawayGitRepo() throws -> URL {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("interactions-sync-repo-\(UUID().uuidString)", isDirectory: true)
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

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { account == SecretAccounts.cloudflareToken ? token : nil }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}
