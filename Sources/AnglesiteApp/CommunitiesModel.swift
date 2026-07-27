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
    var joinHandleText = ""
    var errorMessage: String?
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
    private let secretStore: any SecretStore
    private let resolverTransport: CommunityActorResolver.Transport
    private let membershipTransport: CommunityMembershipClient.Transport
    private let timelineTransport: GroupTimelineClient.Transport

    init(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        resolverTransport: @escaping CommunityActorResolver.Transport
            = CommunityActorResolver.defaultTransport,
        membershipTransport: @escaping CommunityMembershipClient.Transport
            = CommunityMembershipClient.defaultTransport,
        timelineTransport: @escaping GroupTimelineClient.Transport
            = GroupTimelineClient.defaultTransport
    ) {
        self.secretStore = secretStore
        self.resolverTransport = resolverTransport
        self.membershipTransport = membershipTransport
        self.timelineTransport = timelineTransport
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

    func join() async {
        let input = joinHandleText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
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
        else { return }
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
