// Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct MicropubContentSyncTests {
    // MARK: - collectionAndSlug

    @Test("collectionAndSlug parses a two-segment collection URL")
    func collectionAndSlugParsesTwoSegments() {
        let result = MicropubContentSync.collectionAndSlug(from: "https://me.example/notes/hello-abc123")
        #expect(result?.collection == "notes")
        #expect(result?.slug == "hello-abc123")
    }

    @Test("collectionAndSlug returns nil for the flat one-segment fallback URL")
    func collectionAndSlugNilForFlatURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "https://me.example/hello-abc123") == nil)
    }

    @Test("collectionAndSlug returns nil for a malformed URL")
    func collectionAndSlugNilForMalformedURL() {
        #expect(MicropubContentSync.collectionAndSlug(from: "not a url") == nil)
    }

    // MARK: - plainText

    @Test("plainText reads a bare string value")
    func plainTextReadsBareString() {
        #expect(MicropubContentSync.plainText(from: .string("hello")) == "hello")
    }

    @Test("plainText reads a rich-text object's value key")
    func plainTextReadsRichTextValue() {
        let value = JSONValue.object(["html": .string("<p>hi</p>"), "value": .string("hi")])
        #expect(MicropubContentSync.plainText(from: value) == "hi")
    }

    @Test("plainText returns nil for an unsupported shape")
    func plainTextNilForUnsupportedShape() {
        #expect(MicropubContentSync.plainText(from: .bool(true)) == nil)
        #expect(MicropubContentSync.plainText(from: nil) == nil)
    }

    // MARK: - values(for:properties:)

    @Test("values builds a note's fields from raw mf2 properties")
    func valuesBuildsNoteFields() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello world")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "category": [.string("indieweb"), .string("test")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["body"] == .text("Hello world"))
        #expect(values["tags"] == .list(["indieweb", "test"]))
        guard case .date(let date) = values["publishDate"] else {
            Issue.record("expected publishDate to decode as a date")
            return
        }
        #expect(date?.timeIntervalSince1970 == 1_784_894_400)
    }

    @Test("values derives draft from the post-status extension property, not a raw field")
    func valuesDerivesDraftFromPostStatus() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
            "post-status": [.string("draft")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(true))
    }

    @Test("values defaults draft to false when post-status is absent (published)")
    func valuesDefaultsDraftToFalse() throws {
        let note = ContentTypeRegistry.note
        let properties: [String: [JSONValue]] = [
            "content": [.string("Hello")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        let values = try #require(MicropubContentSync.values(for: note, properties: properties))
        #expect(values["draft"] == .flag(false))
    }

    @Test("values returns nil when a required field has no matching mf2 property")
    func valuesNilWhenRequiredFieldMissing() {
        let note = ContentTypeRegistry.note
        // "body" (e-content, required) is missing.
        let properties: [String: [JSONValue]] = ["published": [.string("2026-07-24T12:00:00Z")]]
        #expect(MicropubContentSync.values(for: note, properties: properties) == nil)
    }

    @Test("values requires all photo values to resolve album's imageArray, or fails")
    func valuesRequiresAlbumImages() {
        let album = ContentTypeRegistry.album
        let properties: [String: [JSONValue]] = [
            "name": [.string("Trip")],
            "published": [.string("2026-07-24T12:00:00Z")],
        ]
        // "images" (u-photo, required imageArray) has no matching values at all.
        #expect(MicropubContentSync.values(for: album, properties: properties) == nil)
    }

    // MARK: - resolve

    @Test("resolve maps a post to its descriptor via the URL's collection segment")
    func resolveMapsPostToDescriptor() throws {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/notes/hello-abc123", type: "h-entry",
            properties: ["content": [.string("Hello")], "published": [.string("2026-07-24T12:00:00Z")]],
            deleted: false, updatedAt: 1_753_300_000)
        let resolved = try #require(MicropubContentSync.resolve(post: post))
        #expect(resolved.collection == "notes")
        #expect(resolved.descriptor.id == "note")
        #expect(resolved.url == post.url)
        #expect(resolved.updatedAt == 1_753_300_000)
    }

    @Test("resolve returns nil for the flat fallback URL (no collection segment)")
    func resolveNilForFlatURL() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/hello-abc123", type: "h-card",
            properties: ["name": [.string("Jane")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }

    @Test("resolve returns nil when the URL's collection has no registered content type")
    func resolveNilForUnknownCollection() {
        let post = MicropubPostD1Client.Post(
            url: "https://me.example/mystery/abc123", type: "h-entry",
            properties: ["content": [.string("hi")]], deleted: false, updatedAt: 1_753_300_000)
        #expect(MicropubContentSync.resolve(post: post) == nil)
    }
}

// MARK: - pullAndCommit / pullAndCommitIfConfigured
// Serialized for the same reason as ReceivedInteractionSyncTests: real `git` subprocesses trip a
// rare CI heap-corruption crash when run concurrently with the rest of the subprocess-heavy suite.
extension MicropubContentSyncTests {
    private static func response(_ status: Int) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://api.cloudflare.com/")!, statusCode: status,
                         httpVersion: nil, headerFields: nil)!
    }

    private static func d1Body(_ rowsJSON: String) -> Data {
        Data("""
        {"success": true, "result": [{"success": true, "results": [\(rowsJSON)]}]}
        """.utf8)
    }

    @Test("pullAndCommit resolves and commits every recognized live post")
    func pullAndCommitResolvesAndCommits() async throws {
        let (siteDirectory, _) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }
        let configDirectory = siteDirectory.deletingLastPathComponent().appendingPathComponent("Config")

        let body = Self.d1Body("""
        {"url": "https://me.example/notes/hello-abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (body, Self.response(200)) })

        let count = await MicropubContentSync.pullAndCommit(
            client: client, siteDirectory: siteDirectory, configDirectory: configDirectory)
        #expect(count == 1)
        #expect(FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md").path))
    }

    @Test("pullAndCommit returns 0 without touching git when the D1 query fails")
    func pullAndCommitD1FailureIsNoOp() async {
        let client = MicropubPostD1Client(
            accountID: "acct1", databaseID: "db1", apiToken: "token", transport: { _ in (Data(), Self.response(500)) })
        let count = await MicropubContentSync.pullAndCommit(
            client: client, siteDirectory: URL(fileURLWithPath: "/nonexistent"),
            configDirectory: URL(fileURLWithPath: "/nonexistent"))
        #expect(count == 0)
    }

    @Test("pullAndCommitIfConfigured no-ops when the site has no provisioned D1 database")
    func noOpsWithoutD1Database() async {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("micropub-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }

        let count = await MicropubContentSync.pullAndCommitIfConfigured(
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

    @Test("pullAndCommitIfConfigured resolves the account id, queries D1, and commits")
    func resolvesAccountAndCommits() async throws {
        let fm = FileManager.default
        let configDir = fm.temporaryDirectory.appendingPathComponent("micropub-sync-config-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: configDir) }
        try await SiteConfigStore(configDirectory: configDir).save(
            SiteSettings(provisionedWorkerResources: .init(d1DatabaseID: "db1")))

        let (siteDirectory, _) = try Self.makeThrowawaySite()
        defer { try? FileManager.default.removeItem(at: siteDirectory.deletingLastPathComponent()) }

        let accountsBody = Data("""
        {"success": true, "result": [{"id": "acct1"}]}
        """.utf8)
        let body = Self.d1Body("""
        {"url": "https://me.example/notes/hello-abc123", "type": "h-entry",
         "properties": "{\\"content\\":[\\"Hello\\"],\\"published\\":[\\"2026-07-24T12:00:00Z\\"]}",
         "deleted": 0, "updated_at": 1753300000}
        """)

        let count = await MicropubContentSync.pullAndCommitIfConfigured(
            siteDirectory: siteDirectory,
            configDirectory: configDir,
            secretStore: FakeSecretStore(token: "token"),
            transport: { request in
                if request.url!.path.hasSuffix("/accounts") { return (accountsBody, Self.response(200)) }
                if request.url!.path.contains("/d1/database/db1/query") { return (body, Self.response(200)) }
                return (Data(), Self.response(404))
            })
        #expect(count == 1)
        #expect(FileManager.default.fileExists(
            atPath: siteDirectory.appendingPathComponent("src/content/notes/hello-abc123.md").path))
    }

    /// A throwaway `.anglesite`-style package: `Source/` (a git repo) beside `Config/`. Mirrors
    /// `MicropubContentCommitterTests.makeThrowawaySite`.
    private static func makeThrowawaySite() throws -> (siteDirectory: URL, configDirectory: URL) {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("micropub-sync-test-\(UUID().uuidString)", isDirectory: true)
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

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { account == SecretAccounts.cloudflareToken ? token : nil }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}
