import Foundation
import Observation
import AnglesiteCore

/// One row in the Followers pane. `profile` is `nil` until enrichment lands (or forever, if the
/// follower's instance is unreachable) — `displayName` degrades gracefully either way.
struct FollowerRow: Identifiable, Equatable {
    let actor: URL
    var profile: ActorProfile?

    var id: String { actor.absoluteString }

    /// `@alice@mastodon.social`, or `nil` for an IRI shape `ActorHandle` doesn't recognize.
    var handle: String? { ActorHandle.derive(from: actor) }

    /// Never empty: the fetched display name, else the fetched username, else the derived
    /// handle, else the raw IRI. This chain is why a failed profile fetch needs no error state.
    var displayName: String {
        if let name = profile?.name, !name.isEmpty { return name }
        if let username = profile?.preferredUsername, !username.isEmpty { return "@\(username)" }
        return handle ?? actor.absoluteString
    }
}

/// Drives the Followers pane (Website ▸ Followers…, V-4.2 #364): reads the site's own public
/// ActivityPub followers collection and enriches rows with each follower's display identity.
/// App glue only — protocol logic, parsing, and the security guards live in `AnglesiteCore`.
@MainActor
@Observable
final class FollowersModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        /// No public URL — the site has never been published.
        case noSiteURL
        /// The Worker answered 503: ActivityPub isn't activated for this site.
        case notActivated
        /// 404 or a transport failure: unreachable, or the Worker isn't deployed.
        case unreachable(String)
    }

    /// Bounded so a site with thousands of followers doesn't fan out thousands of sockets.
    private static let maxConcurrentEnrichments = 4

    private(set) var state: State = .idle
    private(set) var rows: [FollowerRow] = []
    private(set) var totalItems = 0
    /// The actor URL to paste into Mastodon search — shown in the empty state, since WebFinger
    /// (#366) hasn't shipped and this is the only way to find the site.
    private(set) var actorURL: URL?
    /// A "Load More" failure, surfaced *beside* the list rather than replacing it. Paging is an
    /// additive operation: flipping `state` to an error the way `load()` does would hide every
    /// row already fetched, with nothing left on screen to get them back.
    private(set) var loadMoreFailure: String?
    /// Disables "Load More" while a page is in flight. Two rapid clicks would otherwise both pass
    /// the guard (`state` doesn't change during paging), fetch the same `nextPage`, and append the
    /// same items — and `FollowerRow.id` is the actor IRI, so `ForEach` would see duplicate IDs,
    /// which SwiftUI documents as undefined behavior.
    private(set) var isLoadingMore = false

    private var siteURL: URL?
    private var sourceDirectory: URL?
    private var configDirectory: URL?
    private var client: ActivityPubFollowersClient?
    private var nextPage: URL?
    /// Bumped by every `load()`. An in-flight page checks it after each `await` and discards
    /// itself if it no longer matches, so a request that started before a `refresh()` can't append
    /// its stale items to the freshly-reset `rows`.
    private var generation = 0

    private let fetcher: ActorProfileFetcher
    /// The client is rebuilt whenever the site URL is re-resolved, so the transport — not a
    /// prebuilt client — is what gets injected.
    private let followersTransport: ActivityPubFollowersClient.Transport
    /// Avatars go through `AnglesiteCore`'s capped loader rather than `AsyncImage` — see
    /// `AvatarLoader`. Held here (not built per row) so tests and previews can inject one.
    let avatarLoader: AvatarLoader
    private var cache = ActorProfileCache()
    private var inFlight: Set<String> = []
    private var queued: Set<String> = []
    /// Actor keys whose enrichment already failed this session. Without this, a row that scrolls
    /// out of the `List` and back in re-triggers its `.task` and re-enqueues a fetch — so an
    /// unreachable (or hostile, or merely slow) follower instance would get re-pinged every time
    /// its row is realized, for the life of the window. That's an unbounded retry storm against
    /// exactly the servers the concurrency cap and 7-day cache exist to protect. Session-scoped
    /// (never persisted): `refresh()` clears it, since that's the user's deliberate escape hatch
    /// for "try again" once a flaky instance comes back up.
    private var unreachableActors: Set<String> = []
    private var pendingQueue: [URL] = []
    private var saveTask: Task<Void, Never>?

    init(
        fetcher: ActorProfileFetcher = ActorProfileFetcher(),
        avatarLoader: AvatarLoader = AvatarLoader(),
        followersTransport: @escaping ActivityPubFollowersClient.Transport
            = ActivityPubFollowersClient.defaultTransport
    ) {
        self.fetcher = fetcher
        self.avatarLoader = avatarLoader
        self.followersTransport = followersTransport
    }

    var canLoadMore: Bool { nextPage != nil && state == .loaded }

    /// Records which site this pane reads and warms the profile cache from disk. No network I/O.
    /// Called once per site open from `SiteWindowModel.loadAndStart()`, like `reader.configure`.
    func configure(site: CurrentSite) {
        configDirectory = site.configDirectory
        sourceDirectory = site.sourceDirectory
        cache = ActorProfileCache.load(from: site.configDirectory) ?? ActorProfileCache()
        resolveSite()
    }

    /// Re-reads the site's public URL from its `.site-config` and rebuilds the client around it.
    ///
    /// Split out of ``configure(site:)`` — which runs once per site open, from
    /// `SiteWindowModel.loadAndStart()` — so ``retry()`` can run it again without needing a
    /// `CurrentSite`. Without that, the `.noSiteURL` state is a dead end: it tells the owner to
    /// publish the site, and then can never notice that they did, because nothing re-resolves the
    /// URL until the window is closed and reopened. Still no network I/O — this reads one local
    /// config file, exactly as `configure` always did.
    private func resolveSite() {
        guard let sourceDirectory else { return }
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: sourceDirectory)
            .flatMap { URL(string: $0) }
        guard let siteURL else {
            client = nil
            actorURL = nil
            return
        }
        client = ActivityPubFollowersClient(siteURL: siteURL, transport: followersTransport)
        actorURL = ActivityPubActor.actorURL(siteURL: siteURL)
    }

    /// The error states' Try Again. Re-resolves the site before reloading, so publishing the site
    /// (`.noSiteURL`) or turning ActivityPub on and republishing (`.notActivated`) is recoverable
    /// from within the pane.
    func retry() async {
        resolveSite()
        await refresh()
    }

    /// Loads the collection head and its first page. Safe to call repeatedly; it no-ops while
    /// already loading.
    func load() async {
        guard state != .loading else { return }
        guard let client else { state = .noSiteURL; return }

        generation &+= 1
        let token = generation
        state = .loading
        rows = []
        nextPage = nil
        totalItems = 0
        loadMoreFailure = nil
        do {
            let collection = try await client.collection()
            guard token == generation else { return }
            totalItems = collection.totalItems
            guard let firstPage = collection.firstPage else {
                // No `first` link means an empty collection — the genuine zero-followers state.
                state = .loaded
                return
            }
            let page = try await client.page(at: firstPage)
            guard token == generation else { return }
            rows = page.items.map { FollowerRow(actor: $0, profile: cache.profile(for: $0)) }
            nextPage = page.next
            state = .loaded
        } catch {
            guard token == generation else { return }
            state = Self.failureState(for: error)
        }
    }

    /// Appends the next page. Unlike ``load()`` this never changes `state`: a paging failure is
    /// reported through ``loadMoreFailure`` so the rows already on screen stay on screen.
    func loadMore() async {
        guard let client, let page = nextPage, state == .loaded, !isLoadingMore else { return }
        isLoadingMore = true
        loadMoreFailure = nil
        let token = generation
        defer { isLoadingMore = false }
        do {
            let next = try await client.page(at: page)
            // A `refresh()` may have landed while this page was in flight; appending now would
            // duplicate IDs into the reset list.
            guard token == generation else { return }
            rows.append(contentsOf: next.items.map {
                FollowerRow(actor: $0, profile: cache.profile(for: $0))
            })
            nextPage = next.next
        } catch {
            guard token == generation else { return }
            loadMoreFailure = Self.failureMessage(for: error)
        }
    }

    func refresh() async {
        state = .idle
        // The user's explicit escape hatch for a flaky follower instance: give every previously
        // failed actor a fresh attempt instead of honoring the session-scoped failure memory.
        unreachableActors.removeAll()
        await load()
    }

    private static func failureState(for error: Error) -> State {
        guard case let ActivityPubFollowersError.requestFailed(status, body) = error else {
            return .unreachable("\(error)")
        }
        switch status {
        case 503: return .notActivated
        default: return .unreachable(body.isEmpty ? "HTTP \(status)" : body)
        }
    }

    /// The paging equivalent of ``failureState(for:)``: paging can't meaningfully re-diagnose the
    /// site (the collection head already loaded), so every failure is one line of detail.
    /// `ActivityPubFollowersClient` bounds `body` before it gets here.
    private static func failureMessage(for error: Error) -> String {
        guard case let ActivityPubFollowersError.requestFailed(status, body) = error else {
            return "\(error)"
        }
        return body.isEmpty ? "HTTP \(status)" : body
    }

    // MARK: - Enrichment

    /// Requests this row's display identity if it isn't already known or in flight. Called from
    /// each visible row's `.task`, so only rows the owner actually scrolls to cost a request.
    func enrichIfNeeded(_ actor: URL) {
        let key = actor.absoluteString
        guard rows.first(where: { $0.actor == actor })?.profile == nil,
              !inFlight.contains(key), !queued.contains(key), !unreachableActors.contains(key)
        else { return }
        queued.insert(key)
        pendingQueue.append(actor)
        pumpQueue()
    }

    private func pumpQueue() {
        while inFlight.count < Self.maxConcurrentEnrichments, !pendingQueue.isEmpty {
            let actor = pendingQueue.removeFirst()
            queued.remove(actor.absoluteString)
            inFlight.insert(actor.absoluteString)
            Task { [fetcher] in
                // Every failure mode — unreachable instance, 404, oversize body, insecure
                // redirect — is non-fatal: the row keeps its derived handle.
                let profile = try? await fetcher.profile(for: actor)
                self.finishEnrichment(actor, profile: profile)
            }
        }
    }

    private func finishEnrichment(_ actor: URL, profile: ActorProfile?) {
        let key = actor.absoluteString
        inFlight.remove(key)
        if let profile {
            cache.store(profile)
            if let index = rows.firstIndex(where: { $0.actor == actor }) {
                rows[index].profile = profile
            }
            scheduleCacheSave()
        } else {
            unreachableActors.insert(key)
        }
        pumpQueue()
    }

    // MARK: - Cache persistence

    /// Debounced rather than save-on-close so a quit, crash, or window close that never runs the
    /// disappear hook still leaves a warm cache — the enrichment work is wasted otherwise.
    ///
    /// `Task.detached`, not `Task`: a plain `Task` created inside a `@MainActor` type *inherits*
    /// MainActor isolation, which would put `createDirectory` plus a full pretty-printed,
    /// sorted-keys encode and atomic write on the main thread every two seconds for as long as
    /// enrichment keeps streaming in. Detaching is safe here precisely because the closure
    /// captures a *value copy* of the cache — `ActorProfileCache` is a `Sendable` struct, so the
    /// snapshot can't be mutated out from under the write.
    private func scheduleCacheSave() {
        saveTask?.cancel()
        saveTask = Task.detached(priority: .utility) { [cache, configDirectory] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let configDirectory else { return }
            try? cache.save(to: configDirectory)
        }
    }

    func saveCacheNow() {
        saveTask?.cancel()
        guard let configDirectory else { return }
        try? cache.save(to: configDirectory)
    }
}
