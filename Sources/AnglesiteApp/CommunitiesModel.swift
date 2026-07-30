// Sources/AnglesiteApp/CommunitiesModel.swift
import Foundation
import Observation
import AnglesiteCore

/// Drives the main-pane Communities view (Website ▸ Communities…, V-5.1a #368): resolve a handle
/// or URL, join/leave a fediverse `Group`, and read its public timeline. App glue only — protocol
/// logic lives in `AnglesiteCore` (`CommunityActorResolver`, `CommunityMembershipClient`,
/// `GroupTimelineClient`, `CommunitiesLedger`).
///
/// The three transports are injected at init — matching `FollowersModel.followersTransport`'s
/// constructor-injection convention, not a per-call-site closure — because each client
/// (`CommunityActorResolver`/`CommunityMembershipClient`/`GroupTimelineClient`) is still built
/// fresh per call around the *current* `ownActorURL`/`publishToken` (those can change if the site
/// is republished mid-session), but the transport underneath it stays fixed for the model's
/// lifetime, exactly like `followersTransport` does for `FollowersModel`'s client.
@MainActor
@Observable
final class CommunitiesModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        /// No public URL — the site has never been published. The only failure mode this model
        /// can genuinely observe: `configure(site:)`/`resolveSite()` do no network I/O, they only
        /// read the ledger and the site's local `.site-config`, so there's no HTTP status to
        /// classify the way `FollowersModel.State` classifies a Worker response into
        /// `.notActivated`/`.unreachable`. Those two cases were copied from that sibling type but
        /// never had a trigger here, so they aren't carried over.
        case noSiteURL
    }

    private(set) var state: State = .idle
    private(set) var joined: [JoinedCommunity] = []
    private(set) var selectedCommunityID: String?
    private(set) var timeline: [GroupPost] = []
    private(set) var isLoadingTimeline = false
    /// Guards against a fast double-tap of Join firing two concurrent `follow()` POSTs for the
    /// same target before the first call's result lands in `joined`.
    private(set) var isJoining = false
    var joinHandleText = ""
    var errorMessage: String?
    /// Drives the Discovery sheet (V-5.4, #371) — the join flow's "Find a community" browse/search
    /// step, opened from a button beside the existing handle/URL join bar.
    var discoveryPresented = false
    var discoveryQuery = ""
    private(set) var discoveryResults: [CommunitySearchResult] = []
    private(set) var isSearchingDiscovery = false
    /// Separate from `errorMessage`: a failed search is a recoverable, in-panel state (try a
    /// different query or instance), not the alert-worthy failure `errorMessage`'s `.alert` binds
    /// to — the owner is still mid-search, not stuck on a blocking dialog.
    var discoveryErrorMessage: String?
    /// Non-nil ⟺ the "Leave this community?" confirmation is showing — mirrors
    /// `SiteWindowModel.deleteConfirmation`'s item-based-confirmation pattern.
    var leaveConfirmation: JoinedCommunity?

    private var siteID: String?
    private var configDirectory: URL?
    private var sourceDirectory: URL?
    private var siteURL: URL?
    private var ownActorURL: URL?
    /// Bumped by every `selectCommunity(_:)`. `loadTimeline()` captures it as a `token` at entry
    /// and checks it after each `await`, so a slower load for a community the owner already
    /// clicked away from can't overwrite the newer selection's timeline (or stomp its
    /// `isLoadingTimeline`) once it finally lands — mirrors `FollowersModel.generation`.
    private var timelineGeneration = 0
    /// Bumped at the top of every `searchDiscovery()` call, checked before writing
    /// `discoveryResults`/`discoveryErrorMessage`/`isSearchingDiscovery` — otherwise a search for
    /// an earlier, now-stale query (or a slower response from an earlier request) could land after
    /// a newer one and silently overwrite its results. Mirrors `timelineGeneration`.
    private var discoveryGeneration = 0
    private let secretStore: any SecretStore
    /// Injected (default `.shared`) purely so `searchDiscovery()` is testable without touching the
    /// real `UserDefaults.standard` — every other read/write in this file talks to `.shared`
    /// directly (matching `ChatView`/`EsiPreviewMode`'s convention), but nothing else in this class
    /// needed a settings value a test would want to control, so this is the first seam of its kind
    /// here. The join sheet's own `@AppStorage(AppSettings.Key.communitySearchInstance)` field
    /// still targets `.standard` unconditionally (SwiftUI's property wrapper has no injection
    /// point), which is fine in production since `AppSettings.shared` wraps that same store.
    private let appSettings: AppSettings
    private let resolverTransport: CommunityActorResolver.Transport
    private let membershipTransport: CommunityMembershipClient.Transport
    private let timelineTransport: GroupTimelineClient.Transport
    private let searchTransport: CommunitySearchClient.Transport

    init(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        appSettings: AppSettings = .shared,
        resolverTransport: @escaping CommunityActorResolver.Transport
            = CommunityActorResolver.defaultTransport,
        membershipTransport: @escaping CommunityMembershipClient.Transport
            = CommunityMembershipClient.defaultTransport,
        timelineTransport: @escaping GroupTimelineClient.Transport
            = GroupTimelineClient.defaultTransport,
        searchTransport: @escaping CommunitySearchClient.Transport
            = CommunitySearchClient.defaultTransport
    ) {
        self.secretStore = secretStore
        self.appSettings = appSettings
        self.resolverTransport = resolverTransport
        self.membershipTransport = membershipTransport
        self.timelineTransport = timelineTransport
        self.searchTransport = searchTransport
    }

    /// Records which site this pane talks to and loads the joined-communities ledger from disk.
    /// No network I/O. Called once per site open from `SiteWindowModel.loadAndStart()`, mirroring
    /// `FollowersModel.configure(site:)`.
    func configure(site: CurrentSite) {
        siteID = site.id
        configDirectory = site.configDirectory
        sourceDirectory = site.sourceDirectory
        joined = CommunitiesLedger.load(from: site.configDirectory)?.communities ?? []
        resolveSite()
    }

    /// Re-reads the site's public URL from its `.site-config`.
    ///
    /// Split out of ``configure(site:)`` — which runs once per site open, from
    /// `SiteWindowModel.loadAndStart()` — so ``retry()`` can run it again without needing a
    /// `CurrentSite`. Without that, `.noSiteURL` would be a dead end: it tells the owner to
    /// publish the site, and the pane could never notice that they did, until the window is
    /// closed and reopened. Still no network I/O — this reads one local config file, exactly as
    /// `configure` always did. Mirrors `FollowersModel.resolveSite()`.
    private func resolveSite() {
        guard let sourceDirectory else { return }
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: sourceDirectory).flatMap { URL(string: $0) }
        guard let siteURL else {
            ownActorURL = nil
            state = .noSiteURL
            return
        }
        ownActorURL = ActivityPubActor.actorURL(siteURL: siteURL)
        state = joined.isEmpty ? .idle : .loaded
    }

    /// The `.noSiteURL` state's Try Again: re-resolves the site URL, which is what makes
    /// `.noSiteURL` genuinely recoverable from inside the pane once the owner publishes.
    func retry() async {
        resolveSite()
    }

    private var publishToken: String? {
        guard let siteID else { return nil }
        return try? secretStore.read(account: SecretAccounts.activityPubPublishToken(siteID: siteID))
    }

    // MARK: - Join

    /// Every failure path here must set `errorMessage` — `joinFromDiscovery(_:)` below has no
    /// other way to tell a failed join from a successful one, since it reuses this method rather
    /// than getting its own return value. A future early-return added here without setting
    /// `errorMessage` would silently make Discovery report success for a join that didn't happen.
    func join() async {
        let input = joinHandleText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        // Without this, a fast double-tap of the Join button before `joined` reflects the first
        // call's result races two `follow()` POSTs for the same target: the already-joined check
        // below only catches a *second* call once the *first* has actually landed in `joined`.
        guard !isJoining else { return }
        isJoining = true
        defer { isJoining = false }
        guard let ownActorURL, let publishToken else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            return
        }
        errorMessage = nil
        do {
            let resolved = try await CommunityActorResolver(transport: resolverTransport).resolve(input)
            // Already joined: `CommunitiesLedger.record(_:)` would no-op on the duplicate
            // `actorID` anyway, but skipping here avoids a needless `Follow` POST to the remote
            // server and discarding its (unused) freshly-returned activity id.
            if let existing = joined.first(where: { $0.actorID == resolved.actorID }) {
                joinHandleText = ""
                selectCommunity(existing.id)
                return
            }
            let membership = CommunityMembershipClient(
                ownActorURL: ownActorURL, publishToken: publishToken, transport: membershipTransport)
            let activityID = try await membership.follow(target: resolved.actorID)
            let community = JoinedCommunity(
                actorID: resolved.actorID, outboxURL: resolved.outboxURL,
                handle: resolved.handle, displayName: resolved.name ?? resolved.preferredUsername,
                joinedAt: Date(), followActivityID: activityID)
            var ledger = CommunitiesLedger(communities: joined)
            ledger.record(community)
            joined = ledger.communities
            do {
                try persist(ledger)
            } catch {
                errorMessage =
                    "Joined \(community.displayName ?? input), but couldn't save it locally: "
                    + "\(error). It may not appear after restarting the app."
            }
            joinHandleText = ""
            state = .loaded
        } catch {
            errorMessage = "Couldn't join \(input): \(error)"
        }
    }

    // MARK: - Discovery (V-5.4, #371)

    /// Reads `appSettings.communitySearchInstance` directly rather than caching it in model state
    /// — the join sheet's instance field binds to the same `UserDefaults` key via `@AppStorage`,
    /// so (in production, where `appSettings` is `.shared`) a change there is visible here on the
    /// very next search with no extra plumbing.
    var discoveryInstance: String { appSettings.communitySearchInstance }

    func searchDiscovery() async {
        discoveryGeneration &+= 1
        let token = discoveryGeneration
        let query = discoveryQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            discoveryResults = []
            discoveryErrorMessage = nil
            isSearchingDiscovery = false
            return
        }
        isSearchingDiscovery = true
        discoveryErrorMessage = nil
        do {
            let client = CommunitySearchClient(transport: searchTransport)
            let results = try await client.search(query: query, instance: discoveryInstance)
            // A newer `searchDiscovery()` call landed while this one was in flight — its own
            // search owns `discoveryResults`/`isSearchingDiscovery` now, so this stale call must
            // touch neither.
            guard token == discoveryGeneration else { return }
            discoveryResults = results
            isSearchingDiscovery = false
        } catch {
            guard token == discoveryGeneration else { return }
            discoveryResults = []
            discoveryErrorMessage = "Couldn't search \(discoveryInstance): \(error)"
            isSearchingDiscovery = false
        }
    }

    /// One-tap join from a search result — routes through the exact same `join()` (and therefore
    /// `CommunityActorResolver`/`CommunityMembershipClient.follow(target:)`) path #368 already
    /// ships for a typed handle, just pre-filled from the result's `actorID` instead. Re-resolving
    /// through `join()` (rather than constructing a `JoinedCommunity` straight from the search
    /// result) keeps this on the one code path that enforces HTTPS and re-fetches the actor
    /// document as ground truth, instead of trusting a second, independent copy of that logic.
    func joinFromDiscovery(_ result: CommunitySearchResult) async {
        joinHandleText = result.actorID.absoluteString
        await join()
        guard errorMessage == nil else { return }
        discoveryPresented = false
        discoveryQuery = ""
        discoveryResults = []
    }

    // MARK: - Leave

    func requestLeave(_ community: JoinedCommunity) {
        leaveConfirmation = community
    }

    func cancelLeave() {
        leaveConfirmation = nil
    }

    func confirmLeave() async {
        guard let community = leaveConfirmation else { return }
        // Cleared synchronously, before any `await` — matching `SiteWindowModel.confirmDelete()`
        // (#968/#969). `CommunitiesView`'s leave-confirmation alert now uses a no-op `isPresented`
        // setter, so its getter (`leaveConfirmation != nil`) drives visibility directly: leaving
        // this set for the duration of the network round-trip below let SwiftUI re-present the
        // same alert and fire a second `unfollow` before the first completed.
        leaveConfirmation = nil
        errorMessage = nil
        guard let ownActorURL, let publishToken else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            return
        }
        do {
            let membership = CommunityMembershipClient(
                ownActorURL: ownActorURL, publishToken: publishToken, transport: membershipTransport)
            try await membership.unfollow(
                target: community.actorID, followActivityID: community.followActivityID)
            var ledger = CommunitiesLedger(communities: joined)
            ledger.remove(actorID: community.actorID)
            joined = ledger.communities
            do {
                try persist(ledger)
            } catch {
                errorMessage =
                    "Left \(community.displayName ?? community.id), but couldn't update the local "
                    + "record: \(error). It may still appear after restarting the app."
            }
            if selectedCommunityID == community.id {
                selectedCommunityID = nil
                timeline = []
                // Invalidates any in-flight loadTimeline() for the community just left, so it
                // can't repopulate `timeline` after the selection has already moved on — same
                // staleness guard `selectCommunity(_:)` uses.
                timelineGeneration &+= 1
            }
        } catch {
            errorMessage = "Couldn't leave \(community.displayName ?? community.id): \(error)"
        }
    }

    private func persist(_ ledger: CommunitiesLedger) throws {
        guard let configDirectory else { return }
        try ledger.save(to: configDirectory)
    }

    // MARK: - Timeline

    func selectCommunity(_ id: String) {
        guard id != selectedCommunityID else { return }
        selectedCommunityID = id
        timeline = []
        timelineGeneration &+= 1
        Task { await loadTimeline() }
    }

    func loadTimeline() async {
        guard let selectedCommunityID,
              let community = joined.first(where: { $0.id == selectedCommunityID }),
              let outboxURL = community.outboxURL
        else {
            // A prior call may have left `isLoadingTimeline` set (e.g. still in flight for a
            // community just switched away from); this call owns the current selection now, and
            // it has nothing to load, so the spinner must not be left stuck on.
            isLoadingTimeline = false
            return
        }
        let token = timelineGeneration
        errorMessage = nil
        isLoadingTimeline = true
        let client = GroupTimelineClient(transport: timelineTransport)
        do {
            let head = try await client.collection(at: outboxURL)
            // A newer `selectCommunity(_:)` landed while this was in flight — its own load owns
            // `timeline`/`isLoadingTimeline` now, so this stale call must touch neither.
            guard token == timelineGeneration else { return }
            guard let firstPage = head.firstPage else {
                timeline = []
                isLoadingTimeline = false
                return
            }
            let page = try await client.page(at: firstPage)
            guard token == timelineGeneration else { return }
            timeline = page.items
            isLoadingTimeline = false
        } catch {
            guard token == timelineGeneration else { return }
            errorMessage = "Couldn't load \(community.displayName ?? community.id)'s timeline: \(error)"
            isLoadingTimeline = false
        }
    }
}
