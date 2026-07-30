import Foundation

/// User-configurable app settings, backed by `UserDefaults`.
///
/// Defined here in AnglesiteCore so non-UI code (e.g. `TemplateRuntime`) can read settings without
/// pulling in SwiftUI. The Settings UI in AnglesiteApp uses SwiftUI's `@AppStorage` against the
/// same keys, so changes are reactive without `AppSettings` needing to be `@Observable`.
public final class AppSettings: @unchecked Sendable {
    /// Shared instance bound to `UserDefaults.standard`. App code should use this; tests should
    /// construct their own instance with a scratch `UserDefaults` suite.
    public static let shared = AppSettings(defaults: .standard)

    /// UserDefaults keys. Public so the SwiftUI side can use them with `@AppStorage`.
    public enum Key {
        public static let templatePathOverride = "anglesite.templatePathOverride"
        public static let sitesRootOverride    = "anglesite.sitesRootOverride"
        public static let lanRuntimeHost        = "anglesite.lanRuntimeHost"
        public static let lanRuntimePreviewPort = "anglesite.lanRuntimePreviewPort"
        public static let lanRuntimeMCPPort     = "anglesite.lanRuntimeMCPPort"
        public static let debugPaneEnabled   = "anglesite.debugPaneEnabled"
        public static let esiPreviewUnprocessed = "anglesite.esiPreviewUnprocessed"
        public static let lastOpenedSiteID   = "anglesite.lastOpenedSiteID"
        public static let sitesRootBookmark  = "anglesite.sitesRootBookmark"
        public static let autoGenerateAltText = "anglesite.autoGenerateAltText"
        public static let autoGeneratePageCopy = "anglesite.autoGeneratePageCopy"
        public static let announcesLiveUpdates = "anglesite.announcesLiveUpdates"
        public static let notifiesOnCompletion = "anglesite.notifiesOnCompletion"
        public static let playsDialupSoundEffect = "anglesite.playsDialupSoundEffect"
        public static let didCleanLegacyChatBackendDefaults = "anglesite.didCleanLegacyChatBackendDefaults"
        public static let gitHubAccountLogin = "anglesite.gitHubAccount.login"
        public static let gitHubAccountName = "anglesite.gitHubAccount.name"
        public static let gitHubAccountAvatarURL = "anglesite.gitHubAccount.avatarURL"
        public static let cloudflareAccountVerified = "anglesite.cloudflareAccount.verified"
        public static let cloudflareAccountName = "anglesite.cloudflareAccount.name"
        public static let cloudflareAccountEmail = "anglesite.cloudflareAccount.email"
        public static let activeAssistantBackend = "anglesite.activeAssistantBackend"
        public static let communitySearchInstance = "anglesite.communitySearchInstance"
    }

    private enum LegacyKey {
        static let preferFoundationModels = "anglesite.preferFoundationModels"
        static let didMigrateAssistantDefault = "anglesite.didMigrateAssistantDefault"
        static let foundationModelTier = "anglesite.foundationModelTier"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// Optional override for the bundled website template path. Lets template authors iterate
    /// on `Resources/Template/` content without rebuilding the app.
    public var templatePathOverride: URL? {
        get {
            guard let path = defaults.string(forKey: Key.templatePathOverride), !path.isEmpty else { return nil }
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        set {
            if let url = newValue {
                defaults.set(url.path, forKey: Key.templatePathOverride)
            } else {
                defaults.removeObject(forKey: Key.templatePathOverride)
            }
        }
    }

    /// Optional override for `~/Sites/`. Useful in development and tests so the app doesn't have
    /// to scribble into the user's real home directory.
    public var sitesRootOverride: URL? {
        get {
            guard let path = defaults.string(forKey: Key.sitesRootOverride), !path.isEmpty else { return nil }
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        set {
            if let url = newValue {
                defaults.set(url.path, forKey: Key.sitesRootOverride)
            } else {
                defaults.removeObject(forKey: Key.sitesRootOverride)
            }
        }
    }

    /// Optional dev/test override pointing preview + MCP at a LAN-hosted runtime (#589/#601):
    /// `nil` (the default) unless a host is configured, so runtime selection is untouched for
    /// real users. Ports fall back to the container-guest convention when blank or invalid.
    /// See `LANRuntimeConfiguration` and `docs/specs/2026-07-09-lan-site-runtime-design.md`.
    public var lanRuntimeConfiguration: LANRuntimeConfiguration? {
        guard let host = defaults.string(forKey: Key.lanRuntimeHost)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty else { return nil }
        return LANRuntimeConfiguration(
            host: host,
            previewPort: port(forKey: Key.lanRuntimePreviewPort, default: LANRuntimeConfiguration.defaultPreviewPort),
            mcpPort: port(forKey: Key.lanRuntimeMCPPort, default: LANRuntimeConfiguration.defaultMCPPort))
    }

    /// Ports are stored as strings (the Settings UI uses plain text fields whose empty state
    /// means "default"); `UserDefaults.string(forKey:)` also coerces a number if one was stored.
    private func port(forKey key: String, default defaultPort: Int) -> Int {
        guard let raw = defaults.string(forKey: key)?.trimmingCharacters(in: .whitespaces),
              let port = Int(raw), (1...65535).contains(port) else { return defaultPort }
        return port
    }

    /// Effective root for site discovery. Returns the override when set, otherwise `~/Sites/`.
    public var sitesRoot: URL {
        sitesRootOverride
            ?? FileManager.default.portableHomeDirectory.appendingPathComponent("Sites", isDirectory: true)
    }

    /// Opt-in toggle (Settings → Advanced) that surfaces the Debug pane menu item in Release
    /// builds. Defaults to `false`; Debug builds always show the menu regardless. See
    /// `DebugPaneVisibility`.
    public var debugPaneEnabled: Bool {
        get { defaults.bool(forKey: Key.debugPaneEnabled) }
        set { defaults.set(newValue, forKey: Key.debugPaneEnabled) }
    }

    /// Forces local preview to skip `EsiInclude`'s dev-only fetch shim, so `EsiRemove`'s fallback
    /// content can be previewed on demand instead of only by sabotaging the fragment URL
    /// (docs/superpowers/specs/2026-07-13-esi-astro-component-design.md §4a). Global rather than
    /// per-site: the Debug Pane this control lives in has no per-site scoping today. Defaults to
    /// `false` (live/resolved preview, today's existing behavior).
    public var esiPreviewUnprocessed: Bool {
        get { defaults.bool(forKey: Key.esiPreviewUnprocessed) }
        set { defaults.set(newValue, forKey: Key.esiPreviewUnprocessed) }
    }

    /// Which backend answers chat/content-help requests: `"foundationModels"` (default) or
    /// `"acp:<ACPAgentConnection.id>"`. Global, not per-site (#602 design decision). An unresolvable
    /// value (agent removed, malformed) is handled by `AssistantBackendResolver`, which falls back
    /// to Foundation Models rather than this property validating its own contents.
    public var activeAssistantBackend: String {
        get { defaults.string(forKey: Key.activeAssistantBackend) ?? "foundationModels" }
        set { defaults.set(newValue, forKey: Key.activeAssistantBackend) }
    }

    /// Which instance's own `/api/v3/search` the Communities join flow's Discovery step
    /// (`CommunitySearchClient`, V-5.4 #371) queries. Global, user-editable in the join sheet — not
    /// a fixed Anglesite-run directory, so the query only ever goes to a source the owner chose.
    /// Falls back to `CommunitySearchClient.defaultInstance` for both an absent *and* a
    /// blanked-out override, so clearing the field in the sheet can't leave search silently
    /// broken — mirrors `activeAssistantBackend`'s string-with-fallback shape.
    public var communitySearchInstance: String {
        get {
            let stored = defaults.string(forKey: Key.communitySearchInstance)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return (stored?.isEmpty == false ? stored : nil) ?? CommunitySearchClient.defaultInstance
        }
        set { defaults.set(newValue, forKey: Key.communitySearchInstance) }
    }

    /// Security-scoped bookmark for the sites root, persisted so the sandboxed (MAS) build only
    /// has to prompt once for permission to create new site folders. `nil` until granted.
    public var sitesRootBookmark: Data? {
        get { defaults.data(forKey: Key.sitesRootBookmark) }
        set {
            if let newValue { defaults.set(newValue, forKey: Key.sitesRootBookmark) }
            else { defaults.removeObject(forKey: Key.sitesRootBookmark) }
        }
    }

    /// When on (the default), dropping an image onto the preview auto-generates alt text with the
    /// on-device vision model and applies it to the `<img>` (C.7, #157). Both targets. No-ops
    /// gracefully when Apple Intelligence is unavailable. Stored inverted-from-absent so an
    /// untouched install defaults to `true`.
    public var autoGenerateAltText: Bool {
        get {
            // Absent → on by default; an explicit stored value wins.
            guard defaults.object(forKey: Key.autoGenerateAltText) != nil else { return true }
            return defaults.bool(forKey: Key.autoGenerateAltText)
        }
        set { defaults.set(newValue, forKey: Key.autoGenerateAltText) }
    }

    /// When on (the default), creating a page/post auto-suggests a short SEO meta description
    /// with the on-device model (Slice 2 of the Claude Code removal roadmap). No-ops gracefully
    /// when Apple Intelligence is unavailable — the scaffold falls back to a title-derived
    /// default. Stored inverted-from-absent so an untouched install defaults to `true`.
    public var autoGeneratePageCopy: Bool {
        get {
            guard defaults.object(forKey: Key.autoGeneratePageCopy) != nil else { return true }
            return defaults.bool(forKey: Key.autoGeneratePageCopy)
        }
        set { defaults.set(newValue, forKey: Key.autoGeneratePageCopy) }
    }

    /// Whether the app posts VoiceOver live-region announcements for streaming chat and deploy
    /// state (`LiveRegionAnnouncer`). On by default; an assistive-technology user who finds the
    /// spoken cues noisy can switch them off. Stored inverted-from-absent so an untouched install
    /// defaults to `true`.
    public var announcesLiveUpdates: Bool {
        get {
            guard defaults.object(forKey: Key.announcesLiveUpdates) != nil else { return true }
            return defaults.bool(forKey: Key.announcesLiveUpdates)
        }
        set { defaults.set(newValue, forKey: Key.announcesLiveUpdates) }
    }

    /// Whether the app posts a completion notification (Notification Center) when a
    /// long-running site operation — Deploy, Backup, Audit — finishes while the app is in the
    /// background (#526). On by default; delivery starts quietly via provisional authorization,
    /// so the user manages prominence from System Settings. Stored inverted-from-absent so an
    /// untouched install defaults to `true`.
    public var notifiesOnCompletion: Bool {
        get {
            guard defaults.object(forKey: Key.notifiesOnCompletion) != nil else { return true }
            return defaults.bool(forKey: Key.notifiesOnCompletion)
        }
        set { defaults.set(newValue, forKey: Key.notifiesOnCompletion) }
    }

    /// Whether Anglesite plays a synthesized dial-up modem handshake sound while the dev server
    /// starts up (`StartupProgressModel`) or a deploy runs (`DeployModel`). Purely decorative —
    /// off by default, so `false` when absent needs no inversion trick.
    public var playsDialupSoundEffect: Bool {
        get { defaults.bool(forKey: Key.playsDialupSoundEffect) }
        set { defaults.set(newValue, forKey: Key.playsDialupSoundEffect) }
    }

    /// The site that was most-recently focused. Used by the Sites launcher to auto-open
    /// the user's last working window on a fresh launch instead of showing the picker.
    /// Cleared when the site disappears from `SiteStore`.
    public var lastOpenedSiteID: String? {
        get {
            guard let id = defaults.string(forKey: Key.lastOpenedSiteID), !id.isEmpty else { return nil }
            return id
        }
        set {
            if let id = newValue {
                defaults.set(id, forKey: Key.lastOpenedSiteID)
            } else {
                defaults.removeObject(forKey: Key.lastOpenedSiteID)
            }
        }
    }

    /// Best-effort GitHub identity from the last successful token verification, shown in Settings
    /// instead of a bare "token stored" — the same "who am I signed in as" surfacing Xcode's
    /// Accounts pane does. Non-secret display fields only; the token itself lives in the Keychain,
    /// never here. `nil` until a token verifies at least once (see `GitHubAPITokenVerifier`).
    public var gitHubAccount: GitHubAccount? {
        get {
            guard let login = defaults.string(forKey: Key.gitHubAccountLogin), !login.isEmpty else { return nil }
            let name = defaults.string(forKey: Key.gitHubAccountName)
            let avatarURL = defaults.string(forKey: Key.gitHubAccountAvatarURL).flatMap(URL.init(string:))
            return GitHubAccount(login: login, name: name, avatarURL: avatarURL)
        }
        set {
            guard let account = newValue else {
                defaults.removeObject(forKey: Key.gitHubAccountLogin)
                defaults.removeObject(forKey: Key.gitHubAccountName)
                defaults.removeObject(forKey: Key.gitHubAccountAvatarURL)
                return
            }
            defaults.set(account.login, forKey: Key.gitHubAccountLogin)
            setOptionalString(account.name, forKey: Key.gitHubAccountName)
            setOptionalString(account.avatarURL?.absoluteString, forKey: Key.gitHubAccountAvatarURL)
        }
    }

    /// Best-effort Cloudflare identity from the last successful token verification. A dedicated
    /// "verified" flag (rather than inferring presence from `name`/`email`) distinguishes a
    /// verified-but-uninformative token — a scoped token lacking `account:read` still verifies,
    /// just with nothing to show — from a token that's never been checked at all.
    public var cloudflareAccount: CloudflareAccount? {
        get {
            guard defaults.bool(forKey: Key.cloudflareAccountVerified) else { return nil }
            return CloudflareAccount(
                name: defaults.string(forKey: Key.cloudflareAccountName),
                email: defaults.string(forKey: Key.cloudflareAccountEmail)
            )
        }
        set {
            guard let account = newValue else {
                defaults.removeObject(forKey: Key.cloudflareAccountVerified)
                defaults.removeObject(forKey: Key.cloudflareAccountName)
                defaults.removeObject(forKey: Key.cloudflareAccountEmail)
                return
            }
            defaults.set(true, forKey: Key.cloudflareAccountVerified)
            setOptionalString(account.name, forKey: Key.cloudflareAccountName)
            setOptionalString(account.email, forKey: Key.cloudflareAccountEmail)
        }
    }

    private func setOptionalString(_ value: String?, forKey key: String) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }

    /// One-time cleanup for settings removed when chat became Foundation Models-only.
    public func removeLegacyChatBackendDefaultsIfNeeded() {
        guard !defaults.bool(forKey: Key.didCleanLegacyChatBackendDefaults) else { return }
        defaults.removeObject(forKey: LegacyKey.preferFoundationModels)
        defaults.removeObject(forKey: LegacyKey.didMigrateAssistantDefault)
        defaults.removeObject(forKey: LegacyKey.foundationModelTier)
        defaults.set(true, forKey: Key.didCleanLegacyChatBackendDefaults)
    }
}

/// Decides whether the "Show Debug Pane" menu item is present.
///
/// The pane streams every subprocess line and is the first thing a weird bug report needs — so it
/// is *always* available in Debug builds. In Release it stays hidden unless the user opts in
/// (Settings → Advanced) or holds ⌥ while launching the app.
public enum DebugPaneVisibility {
    public static func menuItemVisible(isDebugBuild: Bool, settingEnabled: Bool, optionHeldAtLaunch: Bool) -> Bool {
        isDebugBuild || settingEnabled || optionHeldAtLaunch
    }
}
