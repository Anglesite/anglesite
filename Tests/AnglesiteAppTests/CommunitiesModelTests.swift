// Tests/AnglesiteAppTests/CommunitiesModelTests.swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@Suite("CommunitiesModel")
@MainActor
struct CommunitiesModelTests {
    /// In-memory `SecretStore` so `configure(site:)` can read a publish token without touching
    /// the Keychain — mirrors how `MicrosubReaderModel`'s own tests stub credential storage.
    final class InMemorySecretStore: SecretStore, @unchecked Sendable {
        var values: [String: String] = [:]
        func read(account: String) throws -> String? { values[account] }
        func write(_ value: String, account: String) throws { values[account] = value }
        func delete(account: String) throws { values.removeValue(forKey: account) }
    }

    /// Routes every request by exact URL to a canned (status, body). `CommunityActorResolver`,
    /// `CommunityMembershipClient`, and `GroupTimelineClient` all share the same `Transport`
    /// signature (`@Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)`), so this one
    /// fake — handed to all three init parameters — stands in for the whole network surface a
    /// test exercises: webfinger, the resolved actor document, this site's own outbox POST, and
    /// the joined community's outbox GET.
    actor FakeTransport {
        private var responses: [String: (status: Int, body: String)]
        private(set) var requestedURLs: [URL] = []

        init(_ responses: [String: (status: Int, body: String)] = [:]) {
            self.responses = responses
        }

        private func respond(to request: URLRequest) throws -> (Data, HTTPURLResponse) {
            let url = request.url!
            requestedURLs.append(url)
            let (status, body) = responses[url.absoluteString] ?? (404, "not found")
            let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse) {
            { request in try await self.respond(to: request) }
        }
    }

    private static func site(configDirectory: URL, sourceDirectory: URL) -> CurrentSite {
        CurrentSite(
            id: "site-1", name: "Test Site",
            packageURL: sourceDirectory.deletingLastPathComponent(),
            sourceDirectory: sourceDirectory, configDirectory: configDirectory)
    }

    /// A fixture site directory with a `.site-config` declaring a public URL, so
    /// `DeployCoordinator.resolveSiteURL` resolves without a real deploy.
    private static func makeSiteDirectories() throws -> (config: URL, source: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-model-test-\(UUID().uuidString)")
        let config = root.appendingPathComponent("Config")
        let source = root.appendingPathComponent("Source")
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "DOMAIN=example.com\n".write(
            to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return (config, source)
    }

    private static func model(secretStore: InMemorySecretStore, fake: FakeTransport) -> CommunitiesModel {
        CommunitiesModel(
            secretStore: secretStore,
            resolverTransport: fake.transport,
            membershipTransport: fake.transport,
            timelineTransport: fake.transport)
    }

    @Test("join resolves the handle, follows it, and records it in the ledger")
    func joinRecordsCommunity() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"
        let fake = FakeTransport([
            "https://lemmy.ml/c/birding": (200, """
                {"id":"https://lemmy.ml/c/birding","type":"Group","preferredUsername":"birding",
                 "name":"Birding","outbox":"https://lemmy.ml/c/birding/outbox"}
                """),
            "https://example.com/users/site/outbox":
                (202, #"{"id":"https://example.com/users/site/outbox/1"}"#),
        ])

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        model.joinHandleText = "https://lemmy.ml/c/birding"

        await model.join()

        #expect(model.joined.count == 1)
        #expect(model.joined.first?.actorID.absoluteString == "https://lemmy.ml/c/birding")
        #expect(model.joined.first?.followActivityID == "https://example.com/users/site/outbox/1")
        #expect(model.joinHandleText.isEmpty)
        #expect(model.errorMessage == nil)

        // Persisted, not just in memory.
        let reloaded = CommunitiesLedger.load(from: config)
        #expect(reloaded?.communities.count == 1)
    }

    @Test("a resolver failure surfaces errorMessage and records nothing")
    func joinResolveFailureSurfacesError() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"
        let fake = FakeTransport(["https://lemmy.ml/c/ghost": (404, "not found")])

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        model.joinHandleText = "https://lemmy.ml/c/ghost"

        await model.join()

        #expect(model.joined.isEmpty)
        #expect(model.errorMessage != nil)
    }

    @Test("confirmLeave unfollows and removes the community from the ledger")
    func confirmLeaveRemovesCommunity() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"

        var ledger = CommunitiesLedger()
        let community = JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: "@birding@lemmy.ml", displayName: "Birding", joinedAt: Date(),
            followActivityID: "https://example.com/users/site/outbox/1")
        ledger.record(community)
        try ledger.save(to: config)

        let fake = FakeTransport(["https://example.com/users/site/outbox": (202, "{}")])
        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        #expect(model.joined.count == 1)

        model.requestLeave(community)
        #expect(model.leaveConfirmation == community)

        await model.confirmLeave()

        #expect(model.joined.isEmpty)
        #expect(model.leaveConfirmation == nil)
        #expect(CommunitiesLedger.load(from: config)?.communities.isEmpty == true)
    }

    @Test("loadTimeline populates from the selected community's outbox")
    func loadTimelinePopulates() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"

        var ledger = CommunitiesLedger()
        let community = JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: "@birding@lemmy.ml", displayName: "Birding", joinedAt: Date(),
            followActivityID: nil)
        ledger.record(community)
        try ledger.save(to: config)

        let fake = FakeTransport([
            "https://lemmy.ml/c/birding/outbox": (200, """
                {"id":"https://lemmy.ml/c/birding/outbox","type":"OrderedCollection","totalItems":1,
                 "first":"https://lemmy.ml/c/birding/outbox?page=1"}
                """),
            "https://lemmy.ml/c/birding/outbox?page=1": (200, """
                {"id":"https://lemmy.ml/c/birding/outbox?page=1","type":"OrderedCollectionPage",
                 "orderedItems":[
                   {"id":"https://lemmy.ml/activities/1","type":"Create",
                    "object":{"id":"https://lemmy.ml/post/1","type":"Page","name":"Osprey sighting"}}
                 ]}
                """),
        ])
        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))

        // `selectCommunity` already fires `loadTimeline()` in a fire-and-forget `Task`; the
        // explicit `await` below is what the test actually waits on, so the redundant first load
        // is harmless (same fetch, same result) rather than a race.
        model.selectCommunity(community.id)
        await model.loadTimeline()

        #expect(model.timeline.count == 1)
        #expect(model.timeline.first?.title == "Osprey sighting")
        #expect(model.isLoadingTimeline == false)
    }
}
