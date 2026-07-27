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
        case noSiteURL
        case notActivated
        case unreachable(String)
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
    private var siteURL: URL?
    private var ownActorURL: URL?
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
        joined = CommunitiesLedger.load(from: site.configDirectory)?.communities ?? []
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: site.sourceDirectory).flatMap { URL(string: $0) }
        ownActorURL = siteURL.map { ActivityPubActor.actorURL(siteURL: $0) }
        state = joined.isEmpty ? .idle : .loaded
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
        errorMessage = nil
        guard let ownActorURL, let publishToken else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            leaveConfirmation = nil
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
            leaveConfirmation = nil
        } catch {
            errorMessage = "Couldn't leave \(community.displayName ?? community.id): \(error)"
            leaveConfirmation = nil
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
        Task { await loadTimeline() }
    }

    func loadTimeline() async {
        guard let selectedCommunityID,
              let community = joined.first(where: { $0.id == selectedCommunityID }),
              let outboxURL = community.outboxURL
        else { return }
        errorMessage = nil
        isLoadingTimeline = true
        defer { isLoadingTimeline = false }
        let client = GroupTimelineClient(transport: timelineTransport)
        do {
            let head = try await client.collection(at: outboxURL)
            guard let firstPage = head.firstPage else {
                timeline = []
                return
            }
            let page = try await client.page(at: firstPage)
            timeline = page.items
        } catch {
            errorMessage = "Couldn't load \(community.displayName ?? community.id)'s timeline: \(error)"
        }
    }
}
