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
        /// URLs whose response is held back until `release(_:)` is called — lets a test hold one
        /// request open while it observes or triggers other model behavior (Findings 3/4).
        private var gatedURLs: Set<String> = []
        private var gateContinuations: [String: CheckedContinuation<Void, Never>] = [:]
        private var arrivedURLs: Set<String> = []
        private var arrivalContinuations: [String: CheckedContinuation<Void, Never>] = [:]

        init(_ responses: [String: (status: Int, body: String)] = [:]) {
            self.responses = responses
        }

        func gate(_ url: String) { gatedURLs.insert(url) }

        /// Releases a gated URL, letting its held-open request return.
        func release(_ url: String) {
            gatedURLs.remove(url)
            gateContinuations.removeValue(forKey: url)?.resume()
        }

        /// Suspends until `url` has been requested at least once — so a test can synchronize on
        /// "the gated request is now in flight" without racing the `Task` that issues it.
        func waitUntilRequested(_ url: String) async {
            if arrivedURLs.contains(url) { return }
            await withCheckedContinuation { continuation in
                arrivalContinuations[url] = continuation
            }
        }

        private func waitIfGated(_ url: String) async {
            guard gatedURLs.contains(url) else { return }
            await withCheckedContinuation { continuation in
                gateContinuations[url] = continuation
            }
        }

        private func respond(to request: URLRequest) async -> (Data, HTTPURLResponse) {
            let url = request.url!
            requestedURLs.append(url)
            arrivedURLs.insert(url.absoluteString)
            arrivalContinuations.removeValue(forKey: url.absoluteString)?.resume()
            await waitIfGated(url.absoluteString)
            let (status, body) = responses[url.absoluteString] ?? (404, "not found")
            let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), http)
        }

        nonisolated var transport: @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse) {
            { request in await self.respond(to: request) }
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
        try makeSiteDirectories(domain: "example.com")
    }

    /// `domain: nil` models a site that has never been published (no `.site-config` at all) — the
    /// `.noSiteURL` state.
    private static func makeSiteDirectories(domain: String?) throws -> (config: URL, source: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-model-test-\(UUID().uuidString)")
        let config = root.appendingPathComponent("Config")
        let source = root.appendingPathComponent("Source")
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        if let domain {
            try "DOMAIN=\(domain)\n".write(
                to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        }
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

    @Test("a ledger-persistence failure after a successful join surfaces errorMessage without losing the join")
    func joinSurfacesErrorWhenLedgerPersistFails() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-model-test-\(UUID().uuidString)")
        let source = root.appendingPathComponent("Source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "DOMAIN=example.com\n".write(
            to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        // `configDirectory` itself is a plain FILE, not a directory, so `CommunitiesLedger.save`'s
        // `createDirectory(at:)` throws — simulating a local disk-write failure after the remote
        // Follow has already succeeded.
        let config = root.appendingPathComponent("Config")
        try Data().write(to: config)
        defer { try? FileManager.default.removeItem(at: root) }

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

        // The remote Follow succeeded and in-memory state reflects it...
        #expect(model.joined.count == 1)
        #expect(model.joinHandleText.isEmpty)
        // ...but the local write failed, and that must not be silent.
        #expect(model.errorMessage != nil)
    }

    @Test("a ledger-persistence failure after a successful leave surfaces errorMessage without losing the leave")
    func confirmLeaveSurfacesErrorWhenLedgerPersistFails() async throws {
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

        // Simulate the local disk becoming unwritable between `configure()` and `confirmLeave()`:
        // replace the config directory with a plain file, so `CommunitiesLedger.save`'s
        // `createDirectory` throws even though the remote Undo will still succeed.
        try FileManager.default.removeItem(at: config)
        try Data().write(to: config)

        model.requestLeave(community)
        await model.confirmLeave()

        // The remote Undo succeeded and in-memory state reflects it...
        #expect(model.joined.isEmpty)
        #expect(model.leaveConfirmation == nil)
        // ...but the local write failed, and that must not be silent.
        #expect(model.errorMessage != nil)
    }

    @Test("confirmLeave clears a stale errorMessage on success")
    func confirmLeaveClearsStaleError() async throws {
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
        model.errorMessage = "stale error from an earlier failure"

        model.requestLeave(community)
        await model.confirmLeave()

        #expect(model.errorMessage == nil)
    }

    @Test("loadTimeline clears a stale errorMessage on success")
    func loadTimelineClearsStaleError() async throws {
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
                 "orderedItems":[]}
                """),
        ])
        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))

        // `selectCommunity` already fires `loadTimeline()` in a fire-and-forget `Task`; the
        // explicit `await` below is what the test actually waits on, so the redundant first load
        // is harmless (same fetch, same result) rather than a race — same pattern as
        // `loadTimelinePopulates` above.
        model.selectCommunity(community.id)
        model.errorMessage = "stale error from an earlier failure"
        await model.loadTimeline()

        #expect(model.errorMessage == nil)
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

    // MARK: - Finding 3: confirmLeave clears leaveConfirmation before the network round-trip

    /// Before the fix, `leaveConfirmation = nil` ran *after* `await membership.unfollow(...)`
    /// completed — so `CommunitiesView`'s alert (whose `isPresented` getter is
    /// `leaveConfirmation != nil`) stayed presentable for the whole in-flight duration, and a
    /// second tap could re-enter `confirmLeave()` and fire a second `unfollow`. Proven here by
    /// holding the unfollow request open and asserting `leaveConfirmation` is already nil while
    /// it's still in flight — mirroring `SiteWindowModel.confirmDelete()`'s synchronous clear.
    @Test("confirmLeave clears leaveConfirmation synchronously, before the unfollow completes")
    func confirmLeaveClearsConfirmationBeforeNetworkCompletes() async throws {
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

        let unfollowURL = "https://example.com/users/site/outbox"
        let fake = FakeTransport([unfollowURL: (202, "{}")])
        await fake.gate(unfollowURL)

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        model.requestLeave(community)
        #expect(model.leaveConfirmation == community)

        let leaveTask = Task { await model.confirmLeave() }
        // Wait for the unfollow request to actually be in flight (held open by the gate) before
        // asserting — otherwise this races the Task's own scheduling.
        await fake.waitUntilRequested(unfollowURL)

        #expect(model.leaveConfirmation == nil)

        await fake.release(unfollowURL)
        await leaveTask.value

        #expect(model.joined.isEmpty)
    }

    // MARK: - Finding 4: loadTimeline discards a stale, slower-than-newer-selection load

    /// Selects community A (whose outbox fetch is held open), then quickly selects community B
    /// (whose outbox answers immediately). Before the fix, A's slower response — once released —
    /// would land after B's and overwrite `timeline` with A's stale posts. The generation/token
    /// guard should make A's late-arriving load a no-op: B's page is never even fetched... no,
    /// A's page fetch is what should never happen, since `loadTimeline` returns right after the
    /// stale collection-head check.
    @Test("selecting a new community discards a still-in-flight load for the previous one")
    func selectCommunityDiscardsStaleTimeline() async throws {
        let (config, source) = try Self.makeSiteDirectories()
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        secretStore.values[SecretAccounts.activityPubPublishToken(siteID: "site-1")] = "token"

        var ledger = CommunitiesLedger()
        let communityA = JoinedCommunity(
            actorID: URL(string: "https://a.example/actor")!,
            outboxURL: URL(string: "https://a.example/outbox")!,
            handle: "@a@a.example", displayName: "A", joinedAt: Date(), followActivityID: nil)
        let communityB = JoinedCommunity(
            actorID: URL(string: "https://b.example/actor")!,
            outboxURL: URL(string: "https://b.example/outbox")!,
            handle: "@b@b.example", displayName: "B", joinedAt: Date(), followActivityID: nil)
        ledger.record(communityA)
        ledger.record(communityB)
        try ledger.save(to: config)

        let aOutbox = "https://a.example/outbox"
        let aPage = "https://a.example/outbox?page=1"
        let bOutbox = "https://b.example/outbox"
        let bPage = "https://b.example/outbox?page=1"
        let fake = FakeTransport([
            aOutbox: (200, """
                {"id":"\(aOutbox)","type":"OrderedCollection","totalItems":1,"first":"\(aPage)"}
                """),
            aPage: (200, """
                {"id":"\(aPage)","type":"OrderedCollectionPage","orderedItems":[
                  {"id":"https://a.example/post/1","type":"Create",
                   "object":{"id":"https://a.example/post/1","type":"Page","name":"A post"}}
                ]}
                """),
            bOutbox: (200, """
                {"id":"\(bOutbox)","type":"OrderedCollection","totalItems":1,"first":"\(bPage)"}
                """),
            bPage: (200, """
                {"id":"\(bPage)","type":"OrderedCollectionPage","orderedItems":[
                  {"id":"https://b.example/post/1","type":"Create",
                   "object":{"id":"https://b.example/post/1","type":"Page","name":"B post"}}
                ]}
                """),
        ])
        await fake.gate(aOutbox)

        let model = Self.model(secretStore: secretStore, fake: fake)
        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))

        // Select A: fires a fire-and-forget load that immediately blocks on the gated outbox
        // fetch.
        model.selectCommunity(communityA.id)
        await fake.waitUntilRequested(aOutbox)

        // Select B before A's load has finished — bumps the generation counter. Explicitly await
        // the load (redundant with `selectCommunity`'s own fire-and-forget `Task`, but this is
        // what the test actually synchronizes on, same pattern as the other `loadTimeline` tests
        // above).
        model.selectCommunity(communityB.id)
        await model.loadTimeline()

        #expect(model.timeline.count == 1)
        #expect(model.timeline.first?.title == "B post")
        #expect(model.isLoadingTimeline == false)

        // Release A's gate and let its stale load resume. It should discover its token is stale
        // right after the collection-head fetch and return without ever requesting A's page or
        // touching `timeline`/`isLoadingTimeline`.
        await fake.release(aOutbox)
        try await Task.sleep(for: .milliseconds(100))

        #expect(model.timeline.first?.title == "B post")
        #expect(model.isLoadingTimeline == false)
        let requested = await fake.requestedURLs.map(\.absoluteString)
        #expect(!requested.contains(aPage))
    }

    // MARK: - Finding 7: joining an already-joined community doesn't re-POST a Follow

    @Test("join is a no-op if the resolved actor is already joined")
    func joinSkipsNetworkForAlreadyJoinedCommunity() async throws {
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
        let followRequestsAfterFirstJoin = await fake.requestedURLs.count

        model.joinHandleText = "https://lemmy.ml/c/birding"
        await model.join()

        #expect(model.joined.count == 1)
        #expect(model.joinHandleText.isEmpty)
        // Re-resolving the actor is fine (needed to know it's the same one), but no new POST to
        // the outbox (the Follow) should have happened.
        let requestedAfterSecondJoin = await fake.requestedURLs
        let followPOSTCount = requestedAfterSecondJoin.filter {
            $0.absoluteString == "https://example.com/users/site/outbox"
        }.count
        #expect(followPOSTCount == 1)
        #expect(followRequestsAfterFirstJoin >= 1)
    }

    // MARK: - Finding 5: .noSiteURL is real and retry() recovers it

    @Test("configure sets state to .noSiteURL when the site has never been published")
    func configureSetsNoSiteURLForUnpublishedSite() async throws {
        let (config, source) = try Self.makeSiteDirectories(domain: nil)
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        let model = Self.model(secretStore: secretStore, fake: FakeTransport())

        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))

        #expect(model.state == .noSiteURL)
    }

    /// Before the fix, `.noSiteURL` was dead code — nothing ever set it, and there was no way to
    /// notice a site had been published after the pane opened short of closing and reopening the
    /// window. `retry()` re-reads the site's `.site-config`, so publishing the site becomes
    /// recoverable from inside the pane, mirroring `FollowersModel.retry()`.
    @Test("retry re-resolves the site URL, so publishing recovers .noSiteURL")
    func retryRecoversNoSiteURL() async throws {
        let (config, source) = try Self.makeSiteDirectories(domain: nil)
        defer { try? FileManager.default.removeItem(at: config.deletingLastPathComponent()) }
        let secretStore = InMemorySecretStore()
        let model = Self.model(secretStore: secretStore, fake: FakeTransport())

        model.configure(site: Self.site(configDirectory: config, sourceDirectory: source))
        #expect(model.state == .noSiteURL)

        // The owner goes and publishes, exactly as the message asks.
        try "DOMAIN=example.com\n".write(
            to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        await model.retry()

        #expect(model.state == .idle)
    }
}
