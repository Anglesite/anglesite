import AppKit
import Foundation
import Observation
import AnglesiteCore

/// Drives the Reader pane (Website ▸ Reader…, V-4.3 #365): sign in to the site's own deployed
/// IndieAuth server, follow a feed, and render the resulting Microsub timeline. App glue only —
/// protocol logic lives in `AnglesiteCore` (`SiteIndieAuthClient`, `MicrosubClient`, `DPoPKeyPair`).
@MainActor
@Observable
final class MicrosubReaderModel {
    enum SignInState: Equatable {
        case signedOut
        /// The authorize URL is open in the system browser; waiting on the user to paste back the
        /// callback URL from the address bar (see `SiteIndieAuthLoopback`'s doc comment for why
        /// there's no automatic capture).
        case awaitingCallback
        case signedIn(me: String)
    }

    private(set) var signInState: SignInState = .signedOut
    private(set) var channels: [MicrosubChannel] = []
    private(set) var selectedChannelID: String?
    private(set) var timeline: [MicrosubTimelineEntry] = []
    private(set) var isLoading = false
    var errorMessage: String?
    var followURLText = ""
    var pastedCallbackText = ""

    private var siteID: String?
    private var siteURL: URL?
    private let secretStore: any SecretStore
    private let indieAuthClient: SiteIndieAuthClient
    private var pendingAuthRequest: SiteIndieAuthRequest?
    private var microsubClient: MicrosubClient?

    init(
        secretStore: any SecretStore = PlatformSecretStore.make(),
        indieAuthClient: SiteIndieAuthClient = SiteIndieAuthClient()
    ) {
        self.secretStore = secretStore
        self.indieAuthClient = indieAuthClient
    }

    /// Records which site this reader talks to and restores an already-signed-in session from the
    /// Keychain, if any. No network I/O. Called once per site open from
    /// `SiteWindowModel.loadAndStart()`, mirroring `ProjectCleanupModel.configure(site:)`.
    func configure(site: CurrentSite) {
        siteID = site.id
        siteURL = DeployCoordinator.resolveSiteURL(siteDirectory: site.sourceDirectory).flatMap { URL(string: $0) }
        restoreSession()
    }

    private func restoreSession() {
        guard let siteID, let siteURL,
              let token = try? secretStore.readIndieAuthAccessToken(siteID: siteID), !token.isEmpty,
              let keyPair = try? secretStore.readIndieAuthDPoPKeyPair(siteID: siteID)
        else { return }
        // The exact `me` claim isn't persisted separately from the token — the site's own origin
        // is what it always canonicalizes to for a single-owner endpoint, so it's a fine display
        // value without a second Keychain round-trip.
        signInState = .signedIn(me: siteURL.absoluteString)
        microsubClient = MicrosubClient(
            endpoint: siteURL.appendingPathComponent("microsub"), accessToken: token, dpopKeyPair: keyPair
        )
    }

    var canStartSignIn: Bool { siteURL != nil && signInState == .signedOut }

    /// Starts sign-in: builds the authorize URL against the site's own IndieAuth server and opens
    /// it in the system browser. The server redirects the browser to a loopback URL nothing is
    /// listening on; the user copies that final URL from the address bar into `pastedCallbackText`
    /// and calls `completeSignIn()`.
    func startSignIn() {
        guard let siteURL else {
            errorMessage = "This site has no known public URL yet — deploy it at least once first."
            return
        }
        errorMessage = nil
        Task {
            do {
                let request = try await indieAuthClient.makeAuthorizationRequest(
                    siteURL: siteURL,
                    scope: SiteIndieAuthLoopback.microsubScope,
                    clientID: SiteIndieAuthLoopback.clientID,
                    redirectURI: SiteIndieAuthLoopback.redirectURI
                )
                pendingAuthRequest = request
                signInState = .awaitingCallback
                NSWorkspace.shared.open(request.authorizeURL)
            } catch {
                errorMessage = "Couldn't start sign-in: \(error)"
            }
        }
    }

    /// Completes sign-in from the callback URL the user pasted into `pastedCallbackText`.
    func completeSignIn() {
        guard let request = pendingAuthRequest, let siteID, let siteURL else { return }
        let trimmed = pastedCallbackText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let callbackURL = URL(string: trimmed), !trimmed.isEmpty else {
            errorMessage = "That doesn't look like a URL."
            return
        }
        errorMessage = nil
        Task {
            do {
                let code = try SiteIndieAuthClient.authorizationCode(from: callbackURL, matching: request)
                let keyPair = DPoPKeyPair()
                let token = try await indieAuthClient.exchange(code: code, for: request, dpopKeyPair: keyPair)
                try secretStore.writeIndieAuthAccessToken(token.accessToken, siteID: siteID)
                try secretStore.writeIndieAuthDPoPKeyPair(keyPair, siteID: siteID)
                pendingAuthRequest = nil
                pastedCallbackText = ""
                signInState = .signedIn(me: token.me)
                microsubClient = MicrosubClient(
                    endpoint: siteURL.appendingPathComponent("microsub"),
                    accessToken: token.accessToken, dpopKeyPair: keyPair
                )
                await loadChannels()
            } catch {
                errorMessage = "Sign-in failed: \(error)"
            }
        }
    }

    func cancelSignIn() {
        pendingAuthRequest = nil
        pastedCallbackText = ""
        signInState = .signedOut
    }

    func signOut() {
        if let siteID { try? secretStore.clearIndieAuthSession(siteID: siteID) }
        signInState = .signedOut
        microsubClient = nil
        channels = []
        timeline = []
        selectedChannelID = nil
        pendingAuthRequest = nil
    }

    /// Loads the channel list, creating a default "Following" channel on first use (a brand-new
    /// Microsub reader has none — a reserved `notifications` channel exists server-side but is not
    /// meant to hold followed feeds), then loads the selected channel's timeline.
    func loadChannels() async {
        guard let microsubClient else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var list = try await microsubClient.listChannels().filter { $0.uid != "notifications" }
            if list.isEmpty {
                let created = try await microsubClient.createChannel(name: "Following")
                list = [created]
            }
            channels = list
            if selectedChannelID == nil || !list.contains(where: { $0.id == selectedChannelID }) {
                selectedChannelID = list.first?.id
            }
            await loadTimeline()
        } catch {
            errorMessage = "Couldn't load channels: \(error)"
        }
    }

    func selectChannel(_ channelID: String) {
        guard channelID != selectedChannelID else { return }
        selectedChannelID = channelID
        Task { await loadTimeline() }
    }

    func loadTimeline() async {
        guard let microsubClient, let selectedChannelID else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await microsubClient.timeline(channel: selectedChannelID)
            timeline = page.items
        } catch {
            errorMessage = "Couldn't load the timeline: \(error)"
        }
    }

    /// Follows `followURLText` into the selected channel (creating a default one first if none
    /// exists yet), then refreshes the timeline.
    func follow() {
        let url = followURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty, let microsubClient else { return }
        errorMessage = nil
        Task {
            if channels.isEmpty { await loadChannels() }
            guard let channel = selectedChannelID ?? channels.first?.id else {
                errorMessage = "No channel to follow into."
                return
            }
            do {
                try await microsubClient.follow(url: url, channel: channel)
                followURLText = ""
                await loadTimeline()
            } catch {
                errorMessage = "Couldn't follow \(url): \(error)"
            }
        }
    }
}
