import Foundation

/// App-owned, per-site settings persisted inside the package's `Config/` directory (spec §4).
/// Deliberately minimal today — it exists so per-site state attaches to the package rather than
/// app-global `UserDefaults`. Add fields as features need them (YAGNI).
///
/// **Forward-compat rule:** every field MUST stay `Optional` (or carry a default-on-decode). The
/// plist on disk may have been written by an older build that lacked a field; a non-optional field
/// would make `PropertyListDecoder` throw on those files. Optional fields decode missing keys as
/// `nil`, so old and new configs both load. `SiteConfigStore.load()` also falls back to defaults
/// if a decode fails outright, but keeping fields optional is the primary guarantee.
public struct SiteSettings: Sendable, Codable, Equatable {
    /// Owner-facing display name override. `nil` falls back to the package marker's displayName.
    public var displayName: String?

    /// Mastodon server origin used for POSSE, for example `https://mastodon.social`.
    /// The access token is stored separately in the platform secret store.
    public var mastodonBaseURL: String?

    /// Bluesky handle or DID used to create a session for POSSE. The app password is secret-store only.
    public var blueskyIdentifier: String?

    /// Bluesky PDS origin. `nil` uses the public `https://bsky.social` service.
    public var blueskyPDSURL: String?

    /// Explicit opt-in/opt-out for `StandardSitePublishCommand`'s post-deploy Atmosphere pass
    /// (#1233). `nil` means "no explicit choice yet" — the app defaults this **on** once a
    /// Bluesky account is connected (the design's "the app advises; connecting the account is
    /// the owner's intent" call), so callers should read this as `publishToAtmosphere ?? true`
    /// rather than treating `nil` as off. An explicit `false` always wins, even with a Bluesky
    /// credential configured.
    public var publishToAtmosphere: Bool?

    /// Git commit SHA of `Source/`'s `HEAD` at the time of the last successful deployed-source
    /// bundle upload to R2 (#799, spec §C.4 — the code side of a future Worker-triggered bake).
    /// `nil` until the first successful upload. Compared against the current `HEAD` (via
    /// `InProcessGit`) by `SourceBundleStatus` to surface "code changes not yet deployed."
    public var deployedSourceBundleCommit: String?

    /// `@dwk/workers` catalog ids the user has manually toggled on. Component-tied workers are
    /// never stored here — their active state is always recomputed live from Site Graph
    /// Explorer / `ImpactAnalysis` (`WorkerActivation`, #709), so it can't drift from site
    /// content.
    public var activeWorkerIDs: [String]?

    /// The `activeWorkerIDs` snapshot that was last successfully written into `Source/anglesite.json`'s
    /// `workers.active` declaration by `DeployCoordinator.syncWorkerActivationToAnglesiteJSON` (#1172).
    /// `DeployCoordinator.resolveActiveWorkerIDs` compares this against the current `activeWorkerIDs`
    /// above to tell "the declaration is current" apart from "`Config/` has moved on since the last
    /// successful sync" (a failed write-through, or a write that bypassed it) — in the latter case it
    /// falls back to `activeWorkerIDs` rather than trusting a declaration that may be behind.
    public var activeWorkerIDsMigratedToAnglesiteJSON: [String]?

    /// The full effective active worker-id set (component-tied + settings-activated) as of the
    /// last successful deploy — the diff baseline `WorkerActivation.removedIDs` reports removals
    /// against (#709).
    public var lastDeployedWorkerIDs: [String]?

    /// Already-provisioned Cloudflare D1/KV/R2 resource ids for this site's composed Worker,
    /// durable across a worker being deactivated and later reactivated — deactivating a worker
    /// drops its binding block from `wrangler.toml`, so this is the source of truth instead of
    /// re-scraping the file (#709).
    public var provisionedWorkerResources: WorkerComposition.ProvisionedResources?

    /// Explicit opt-in: the user has acknowledged that enabling inbound Webmention requires the
    /// Cloudflare Workers **Paid** plan (Cloudflare Queues aren't available on Free). `nil`/`false`
    /// means `SocialWorkerProvisionCommand.provision` must not attempt to create the Queue —
    /// see `DeployModel.webmentionPaidPlanConfirmationPresented`.
    public var webmentionReceivePaidPlanAcknowledged: Bool?

    /// This site's own hosted-community outbox URL (V-5.2b, #908) — set once #907's provisioning
    /// flow creates a "Community" site kind and its Group actor Worker. `nil` on every other
    /// site: `AnnouncedPostSync` no-ops without it, so this field is inert until #907 ships.
    public var communityOutboxURL: URL?

    /// This site's own hosted-community actor URL (V-5.1b, #907) — set alongside
    /// ``communityOutboxURL`` once a provisioning flow creates this site's Group actor Worker.
    /// `nil` on every other site: `CommunityMembersSync` no-ops without it, so this field is
    /// inert until that provisioning flow ships and sets it.
    public var communityActorURL: URL?

    /// Actor IRIs authorized to moderate this site's Group actor (V-5.1b, #907; design doc §4.1
    /// D3) — ban a member or un-announce a member post, enforced Worker-side. `nil`/`[]` on every
    /// site: this field only has an effect once a provisioning/redeploy flow threads it into the
    /// composed Worker's config (`WorkerComposition.generateWranglerToml`'s `moderators`
    /// parameter), which is inert until that wiring lands.
    public var moderators: [String]?

    /// Whether inbox capture's `/inbox` route should be live in the composed Worker (#764).
    /// Kept separate from `provisionedWorkerResources` (resource existence) so "provisioned but
    /// paused" and "never provisioned" are distinguishable — mirrors how `activeWorkerIDs`
    /// (routing) is kept separate from `provisionedWorkerResources` for the `@dwk/workers`
    /// catalog. `nil`/`false` = off; `provisionedWorkerResources`'s inbox fields are left
    /// populated when paused so re-enabling reuses the same namespace instead of creating a new
    /// one.
    public var inboxCaptureEnabled: Bool?

    /// The ActivityPub handle (`DeployCoordinator.resolveEffectiveActivityPubUsername`'s value —
    /// the resolved `AP_USERNAME` override, or the hostname-derived default) as of the last
    /// successful deploy (#1239, design doc §"Owner-chosen username") — the baseline
    /// `DeployCoordinator.activityPubHandleRenameNeedsConfirmation` compares the *next* deploy's
    /// resolved handle against, so a change made after the actor has already federated surfaces
    /// a consequence-phrased confirmation instead of silently stranding followers. `nil` until
    /// the first successful deploy with ActivityPub active.
    public var lastDeployedAPUsername: String?

    /// The specific ActivityPub handle the owner has explicitly confirmed switching to (#1239,
    /// `DeployModel.useNewActivityPubHandleAndRetry`'s "switch to `@new@…`" choice on the
    /// consequence-phrased rename-confirmation sheet). Compared by `DeployCoordinator
    /// .activityPubHandleRenameNeedsConfirmation` against the *current* resolved handle — set to
    /// exactly the handle just acknowledged, so a retried deploy under that handle doesn't
    /// re-prompt, but a *different* subsequent change still does. `nil` outside that flow.
    public var activityPubHandleRenameAcknowledged: String?

    /// Owner opt-out from Markdown for Agents (#1247) — the Cloudflare zone setting that serves
    /// an HTML→Markdown-converted response to requests carrying `Accept: text/markdown`, cutting
    /// AI-agent token usage. `nil`/`false` (the default) means enabled: `DeployCommand` turns the
    /// zone setting on for every site with a confirmed custom domain, matching the issue's
    /// default-on ask. `true` means the owner explicitly opted out in Site Settings.
    public var markdownForAgentsDisabled: Bool?

    /// Memberwise creation. Every parameter defaults to `nil`, matching the type-level
    /// forward-compat rule that all fields stay optional — `SiteSettings()` is the canonical
    /// "no settings yet" value ``SiteConfigStore/load()`` falls back to.
    public init(
        displayName: String? = nil,
        mastodonBaseURL: String? = nil,
        blueskyIdentifier: String? = nil,
        blueskyPDSURL: String? = nil,
        publishToAtmosphere: Bool? = nil,
        deployedSourceBundleCommit: String? = nil,
        activeWorkerIDs: [String]? = nil,
        activeWorkerIDsMigratedToAnglesiteJSON: [String]? = nil,
        lastDeployedWorkerIDs: [String]? = nil,
        provisionedWorkerResources: WorkerComposition.ProvisionedResources? = nil,
        webmentionReceivePaidPlanAcknowledged: Bool? = nil,
        communityOutboxURL: URL? = nil,
        communityActorURL: URL? = nil,
        moderators: [String]? = nil,
        inboxCaptureEnabled: Bool? = nil,
        lastDeployedAPUsername: String? = nil,
        activityPubHandleRenameAcknowledged: String? = nil,
        markdownForAgentsDisabled: Bool? = nil
    ) {
        self.displayName = displayName
        self.mastodonBaseURL = mastodonBaseURL
        self.blueskyIdentifier = blueskyIdentifier
        self.blueskyPDSURL = blueskyPDSURL
        self.publishToAtmosphere = publishToAtmosphere
        self.deployedSourceBundleCommit = deployedSourceBundleCommit
        self.activeWorkerIDs = activeWorkerIDs
        self.activeWorkerIDsMigratedToAnglesiteJSON = activeWorkerIDsMigratedToAnglesiteJSON
        self.lastDeployedWorkerIDs = lastDeployedWorkerIDs
        self.provisionedWorkerResources = provisionedWorkerResources
        self.webmentionReceivePaidPlanAcknowledged = webmentionReceivePaidPlanAcknowledged
        self.communityOutboxURL = communityOutboxURL
        self.communityActorURL = communityActorURL
        self.moderators = moderators
        self.inboxCaptureEnabled = inboxCaptureEnabled
        self.lastDeployedAPUsername = lastDeployedAPUsername
        self.activityPubHandleRenameAcknowledged = activityPubHandleRenameAcknowledged
        self.markdownForAgentsDisabled = markdownForAgentsDisabled
    }
}

/// Reads/writes `Config/settings.plist` for one package. Per-window; owned by the site window.
///
/// Forward infrastructure established by #242 P4 alongside the chat-history relocation into
/// `Config/`. Its first consumer — applying `SiteSettings.displayName` to the displayed site name —
/// is tracked in #266; until then `Config/` holds chat history and this settings file.
public actor SiteConfigStore {
    private let fileURL: URL
    private let fileManager: FileManager

    /// Points the store at `<configDirectory>/settings.plist` — the package's app-owned
    /// `Config/` directory, never the git-tracked `Source/`. `fileManager` is injectable for
    /// tests.
    public init(configDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = configDirectory.appendingPathComponent("settings.plist")
        self.fileManager = fileManager
    }

    /// Load settings, or a default (empty) `SiteSettings` when the file is absent or unreadable.
    ///
    /// A decode failure falls back to defaults rather than throwing: settings are non-critical
    /// (every field is optional with a sensible default), so a config written by a newer build, or
    /// a corrupt one, must never block opening a site — the next `save` rewrites it cleanly. I/O
    /// errors reading an existing file still throw.
    public func load() throws -> SiteSettings {
        try Self.read(from: fileURL.deletingLastPathComponent(), fileManager: fileManager)
    }

    /// Synchronous, actor-independent read of a package's `settings.plist`. Same contract as
    /// `load()` — absent or undecodable file → default `SiteSettings`; an I/O error reading an
    /// existing file throws. Exists so synchronous call sites (e.g. `SiteStore.Site.make`, which
    /// resolves the `displayName` override at construction, #266) can read settings without
    /// hopping onto the actor.
    ///
    /// - Important: Performs synchronous, blocking file I/O on the calling executor. Today's only
    ///   callers reach it via `Site.make` from `SiteStore` actor methods (off the main thread).
    ///   Do not call it — or `Site.make` — from a `@MainActor` context, or it will block the main
    ///   thread on disk.
    public nonisolated static func read(
        from configDirectory: URL,
        fileManager: FileManager = .default
    ) throws -> SiteSettings {
        let fileURL = configDirectory.appendingPathComponent("settings.plist")
        guard fileManager.fileExists(atPath: fileURL.path) else { return SiteSettings() }
        let data = try Data(contentsOf: fileURL)
        guard var settings = try? PropertyListDecoder().decode(SiteSettings.self, from: data) else {
            return SiteSettings()
        }
        migrateLegacyInboxCaptureFields(into: &settings, from: data)
        return settings
    }

    /// One-time, read-only migration for `inboxCaptureAccountID`/`inboxCaptureKVNamespaceID`
    /// (#587) — top-level `SiteSettings` fields that `Resources/Template/integrations/docs/
    /// inbox-setup.md` shipped instructions to hand-set before #764 folded inbox-capture ids into
    /// `provisionedWorkerResources` instead. `PropertyListDecoder` silently drops unknown keys, so
    /// without this, a `settings.plist` written by that old manual-setup step would lose its ids
    /// on the next load. Only fills `provisionedWorkerResources` when it doesn't already carry
    /// inbox ids of its own — a value the new Settings UI wrote always wins over a stale legacy
    /// one. Not persisted here; the next `save()` naturally rewrites the file in the new shape.
    private nonisolated static func migrateLegacyInboxCaptureFields(into settings: inout SiteSettings, from data: Data) {
        guard settings.provisionedWorkerResources?.inboxAccountID == nil,
              settings.provisionedWorkerResources?.inboxKVNamespaceID == nil,
              let legacy = try? PropertyListDecoder().decode(LegacyInboxCaptureFields.self, from: data),
              legacy.inboxCaptureAccountID != nil || legacy.inboxCaptureKVNamespaceID != nil
        else { return }
        var resources = settings.provisionedWorkerResources ?? .init()
        resources.inboxAccountID = legacy.inboxCaptureAccountID
        resources.inboxKVNamespaceID = legacy.inboxCaptureKVNamespaceID
        settings.provisionedWorkerResources = resources
    }

    private struct LegacyInboxCaptureFields: Decodable {
        var inboxCaptureAccountID: String?
        var inboxCaptureKVNamespaceID: String?
    }

    /// Persist settings to `settings.plist` (XML plist, atomic), creating `Config/` if needed.
    public func save(_ settings: SiteSettings) throws {
        try fileManager.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .xml
        let data = try encoder.encode(settings)
        try data.write(to: fileURL, options: [.atomic])
    }
}
