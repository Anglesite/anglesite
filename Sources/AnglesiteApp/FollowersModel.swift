import AppKit
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

    private var siteURL: URL?
    private var configDirectory: URL?
    private var client: ActivityPubFollowersClient?
    private var nextPage: URL?

    private let fetcher: ActorProfileFetcher
    private var cache = ActorProfileCache()
    private var inFlight: Set<String> = []
    private var queued: Set<String> = []
    private var pendingQueue: [URL] = []
    private var saveTask: Task<Void, Never>?

    init(fetcher: ActorProfileFetcher = ActorProfileFetcher()) {
        self.fetcher = fetcher
    }

    var canLoadMore: Bool { nextPage != nil && state == .loaded }

    /// Records which site this pane reads and warms the profile cache from disk. No network I/O.
    /// Called once per site open from `SiteWindowModel.loadAndStart()`, like `reader.configure`.
    func configure(site: CurrentSite) {
        configDirectory = site.configDirectory
        cache = ActorProfileCache.load(from: site.configDirectory) ?? ActorProfileCache()
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: site.sourceDirectory)
            .flatMap { URL(string: $0) }
        if let siteURL {
            client = ActivityPubFollowersClient(siteURL: siteURL)
            actorURL = ActivityPubActor.actorURL(siteURL: siteURL)
        }
    }

    /// Loads the collection head and its first page. Safe to call repeatedly; it no-ops while
    /// already loading.
    func load() async {
        guard state != .loading else { return }
        guard let client else { state = .noSiteURL; return }

        state = .loading
        rows = []
        nextPage = nil
        do {
            let collection = try await client.collection()
            totalItems = collection.totalItems
            guard let firstPage = collection.firstPage else {
                // No `first` link means an empty collection — the genuine zero-followers state.
                state = .loaded
                return
            }
            let page = try await client.page(at: firstPage)
            rows = page.items.map { FollowerRow(actor: $0, profile: cache.profile(for: $0)) }
            nextPage = page.next
            state = .loaded
        } catch {
            state = Self.failureState(for: error)
        }
    }

    func loadMore() async {
        guard let client, let page = nextPage, state == .loaded else { return }
        do {
            let next = try await client.page(at: page)
            rows.append(contentsOf: next.items.map {
                FollowerRow(actor: $0, profile: cache.profile(for: $0))
            })
            nextPage = next.next
        } catch {
            state = Self.failureState(for: error)
        }
    }

    func refresh() async {
        state = .idle
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

    // MARK: - Enrichment

    /// Requests this row's display identity if it isn't already known or in flight. Called from
    /// each visible row's `.task`, so only rows the owner actually scrolls to cost a request.
    func enrichIfNeeded(_ actor: URL) {
        let key = actor.absoluteString
        guard rows.first(where: { $0.actor == actor })?.profile == nil,
              !inFlight.contains(key), !queued.contains(key)
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
        inFlight.remove(actor.absoluteString)
        if let profile {
            cache.store(profile)
            if let index = rows.firstIndex(where: { $0.actor == actor }) {
                rows[index].profile = profile
            }
            scheduleCacheSave()
        }
        pumpQueue()
    }

    // MARK: - Cache persistence

    /// Debounced rather than save-on-close so a quit, crash, or window close that never runs the
    /// disappear hook still leaves a warm cache — the enrichment work is wasted otherwise.
    private func scheduleCacheSave() {
        saveTask?.cancel()
        saveTask = Task { [cache, configDirectory] in
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
