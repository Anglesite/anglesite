import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

import Testing
@testable import AnglesiteCore

private final class RequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return _requests
    }
    func record(_ request: URLRequest) {
        lock.lock(); _requests.append(request); lock.unlock()
    }
}

private struct FakeSecretStore: SecretStore {
    let token: String?
    func read(account: String) throws -> String? { token }
    func write(_ value: String, account: String) throws {}
    func delete(account: String) throws {}
}

@Suite("ActivityPubOutboxBackfill")
struct ActivityPubOutboxBackfillTests {
    func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func writeBlogPost(in siteDirectory: URL, slug: String, title: String, pubDate: String, body: String) throws {
        let dir = siteDirectory.appendingPathComponent("src/content/blog", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let content = "---\ntitle: \(title)\npubDate: \(pubDate)\n---\n\(body)\n"
        try content.write(to: dir.appendingPathComponent("\(slug).md"), atomically: true, encoding: .utf8)
    }

    @Test("posts pending entries oldest-first and records them in the ledger")
    func postsOldestFirstAndRecords() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "newer", title: "Newer", pubDate: "2026-02-01", body: "Second post.")
        try writeBlogPost(in: siteDirectory, slug: "older", title: "Older", pubDate: "2026-01-01", body: "First post.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let body = "{\"id\":\"https://owner.example/users/site/outbox/\(UUID().uuidString)\"}"
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token"),
            referenceDate: ISO8601DateFormatter().date(from: "2026-07-24T00:00:00Z")!
        )

        #expect(outcomes.count == 2)
        #expect(outcomes.allSatisfy { $0.accepted })
        #expect(recorder.requests.count == 2)

        // Oldest ("older", Jan 1) must be posted before "newer" (Feb 1).
        let firstBody = try #require(recorder.requests.first?.httpBody)
        let firstJSON = try #require(JSONSerialization.jsonObject(with: firstBody) as? [String: Any])
        #expect(firstJSON["content"] as? String == "First post.")

        let ledger = try #require(ActivityPubOutboxLedger.load(from: configDirectory))
        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/older/"))
        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/newer/"))
    }

    @Test("skips entries already in the ledger")
    func skipsAlreadyLedgeredEntries() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "already-synced", title: "Already Synced", pubDate: "2026-01-01", body: "Old news.")

        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(
            canonicalURL: "https://owner.example/blog/already-synced/", activityID: "existing-id", syncedAt: Date()
        ))
        try ledger.save(to: configDirectory)

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        #expect(outcomes.isEmpty)
        #expect(recorder.requests.isEmpty)
    }

    @Test("no token provisioned yields no outcomes and no requests")
    func noTokenSkipsEntirely() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "hello", title: "Hello", pubDate: "2026-01-01", body: "Hi.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: nil)
        )

        #expect(outcomes.isEmpty)
        #expect(recorder.requests.isEmpty)
    }

    @Test("a failed entry is recorded as not accepted and is not added to the ledger")
    func failedEntryNotLedgered() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "will-fail", title: "Will Fail", pubDate: "2026-01-01", body: "Oops.")

        let backfill = ActivityPubOutboxBackfill { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
            return (Data("server error".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        #expect(outcomes.count == 1)
        #expect(outcomes.first?.accepted == false)
        #expect(outcomes.first?.detail?.contains("500") == true)

        let ledger = ActivityPubOutboxLedger.load(from: configDirectory)
        #expect(ledger == nil || !ledger!.contains(canonicalURL: "https://owner.example/blog/will-fail/"))
    }

    @Test("the outgoing request sends the Bearer token and quiet-insert flag")
    func requestShape() async throws {
        let siteDirectory = try makeTempDir()
        let configDirectory = try makeTempDir()
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "hello", title: "Hello", pubDate: "2026-01-01", body: "Hi.")

        let recorder = RequestRecorder()
        let backfill = ActivityPubOutboxBackfill { request in
            recorder.record(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        _ = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        let request = try #require(recorder.requests.first)
        #expect(request.url?.absoluteString == "https://owner.example/users/site/outbox?skipDelivery=1")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/activity+json")

        let body = try #require(request.httpBody)
        let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["type"] as? String == "Article")
        #expect(json["skipDelivery"] == nil)
        #expect(json["published"] as? String != nil)
    }

    @Test("a ledger save failure is surfaced as an accepted-but-unledgered outcome, not swallowed")
    func ledgerSaveFailureIsSurfaced() async throws {
        let siteDirectory = try makeTempDir()
        // `configDirectory` points at a plain file, not a directory, so
        // `ActivityPubOutboxLedger.save(to:)`'s `FileManager.createDirectory` call throws.
        let configDirectory = try makeTempDir().appendingPathComponent("not-a-directory")
        try Data("blocked".utf8).write(to: configDirectory)
        defer {
            try? FileManager.default.removeItem(at: siteDirectory)
            try? FileManager.default.removeItem(at: configDirectory)
        }
        try writeBlogPost(in: siteDirectory, slug: "hello", title: "Hello", pubDate: "2026-01-01", body: "Hi.")

        let backfill = ActivityPubOutboxBackfill { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data("{}".utf8), response)
        }

        let outcomes = await backfill.backfill(
            siteID: "site-1", siteDirectory: siteDirectory, configDirectory: configDirectory,
            siteBase: URL(string: "https://owner.example")!, secretStore: FakeSecretStore(token: "test-token")
        )

        #expect(outcomes.count == 1)
        #expect(outcomes.first?.accepted == true)
        let detail = try #require(outcomes.first?.detail)
        #expect(detail.contains("ledger") || detail.contains("write"))
    }
}
