import Foundation

/// The deploy-orchestration business logic that used to live inside `DeployModel.runDeploy` — an
/// app-target `@MainActor` view model that can't be exercised by `swift test` on CI (only hosted
/// `xcodebuild test` can run it, and that doesn't work on CI's older runners; see this repo's
/// CLAUDE.md build notes). #825 pulls the pieces that are pure orchestration — no SwiftUI, no
/// observable state — out into this plain `AnglesiteCore` namespace so they get real
/// `AnglesiteCoreTests` coverage, mirroring how `TokenOnboarding` was extracted for the same reason.
///
/// `DeployModel` still owns: presenting the token/rename/blocked sheets, the log-line subscription
/// that drives the streaming drawer, phase transitions, and the failure-summary generation —
/// all of that is genuinely UI-state-shaped and stays app-side. The container-control threading
/// from #823 (`ContainerControlProvider`, resolved lazily at the moment a deploy actually runs)
/// also stays exactly where it is: this type has no opinion about how a deploy step gets executed,
/// only about the worker-composition inputs and the deploy-adjacent effects around it.
public enum DeployCoordinator {
    /// The effective active worker set for a deploy, plus the diff against the last-deployed
    /// baseline and the resolved `[WorkerDescriptor]`s `SocialWorkerProvisionCommand.provision`
    /// takes directly now that composition is descriptor-driven (#708).
    public struct WorkerActivationPlan: Sendable, Equatable {
        /// The worker ids that will actually deploy — explicit user activations plus
        /// content-triggered ones, per `WorkerActivation.effectiveActiveIDs`. The other three
        /// fields are all derived from this set; it's carried alongside them because it also
        /// becomes the *next* deploy's `lastDeployedWorkerIDs` baseline on success.
        public let effectiveActiveIDs: Set<String>
        /// Ids present in the previous deploy's baseline but not in `effectiveActiveIDs` — the
        /// caller decides whether/how to surface this (`DeployModel` logs it to the debug pane).
        public let removedIDs: Set<String>
        /// `effectiveActiveIDs` resolved against `catalog`, sorted by id — what
        /// `WorkerComposition.generateWranglerToml` and `SocialWorkerProvisionCommand.provision`
        /// need (#708).
        public let workers: [WorkerDescriptor]
        /// Active ids `workers` couldn't resolve against the catalog — the caller decides whether
        /// to surface `WorkerActivation.missingDescriptorWarning` for this (`DeployModel` logs it
        /// to the debug pane, mirroring `SiteOperations.deployWithWorkerComposition`).
        public let unresolvedIDs: Set<String>
        /// Where the settings-activated ids in `effectiveActiveIDs` were resolved from (#1172) —
        /// the caller decides whether to surface `activeWorkerIDsFallbackNotice` for this, the
        /// same way it already does for `unresolvedIDs`.
        public let activeWorkerIDsSource: ActiveWorkerIDsSource

        /// Memberwise initializer — plans are normally produced by
        /// ``DeployCoordinator/planWorkerActivation(siteID:siteDirectory:settings:catalog:contentGraph:)``;
        /// this exists so tests can construct one directly.
        public init(
            effectiveActiveIDs: Set<String>, removedIDs: Set<String>,
            workers: [WorkerDescriptor], unresolvedIDs: Set<String>,
            activeWorkerIDsSource: ActiveWorkerIDsSource = .declared
        ) {
            self.effectiveActiveIDs = effectiveActiveIDs
            self.removedIDs = removedIDs
            self.workers = workers
            self.unresolvedIDs = unresolvedIDs
            self.activeWorkerIDsSource = activeWorkerIDsSource
        }
    }

    /// Where `resolveActiveWorkerIDs` sourced the settings-activated worker-id set from (#1172).
    public enum ActiveWorkerIDsSource: Sendable, Equatable {
        /// `Source/anglesite.json`'s `workers.active` declaration — current and trusted.
        case declared
        /// `Config/settings.plist`'s `activeWorkerIDs` — used because the declaration couldn't be
        /// trusted, per `reason`.
        case configFallback(reason: FallbackReason)

        public enum FallbackReason: Sendable, Equatable {
            /// `anglesite.json` exists but isn't valid JSON matching the schema.
            case unparsable
            /// `anglesite.json` is absent, or exists with no `workers.active` declared yet.
            case notDeclared
            /// `workers.active` is declared, but `Config/`'s current `activeWorkerIDs` no longer
            /// matches the snapshot recorded at the last successful sync — either the write-through
            /// failed partway, or something wrote `Config/` directly without going through it.
            case staleRelativeToConfig
        }
    }

    /// Resolves the settings-activated worker-id set for a deploy (#1172): prefers
    /// `Source/anglesite.json`'s `workers.active` declaration, falling back to `Config/`'s
    /// `activeWorkerIDs` whenever the declaration can't be trusted — absent, unparsable, or stale
    /// relative to `Config/`'s live state (owner decision: never fail or silently deploy a reduced
    /// worker set just because the migration hasn't caught up yet; see the timing investigation doc
    /// `docs/superpowers/specs/2026-07-31-worker-activation-timing-investigation.md` §7).
    ///
    /// "Stale" is a value comparison against `settings.activeWorkerIDsMigratedToAnglesiteJSON`, not
    /// a file-mtime one — `anglesite.json` also holds `domain`/`dns`/`edge`/`email` sections that
    /// change far more often than `workers.active`, so the whole-file mtime is a poor staleness
    /// proxy (see the investigation doc §5). This also self-heals: the next successful
    /// `syncWorkerActivationToAnglesiteJSON` call brings the recorded snapshot back in sync.
    public static func resolveActiveWorkerIDs(
        settings: SiteSettings, sourceDirectory: URL
    ) -> (ids: [String]?, source: ActiveWorkerIDsSource) {
        let domainConfig: DomainConfig
        do {
            domainConfig = try DomainConfigStore(sourceDirectory: sourceDirectory).load()
        } catch {
            return (settings.activeWorkerIDs, .configFallback(reason: .unparsable))
        }
        guard let declared = domainConfig.workers?.active else {
            return (settings.activeWorkerIDs, .configFallback(reason: .notDeclared))
        }
        guard settings.activeWorkerIDsMigratedToAnglesiteJSON == settings.activeWorkerIDs else {
            return (settings.activeWorkerIDs, .configFallback(reason: .staleRelativeToConfig))
        }
        return (declared, .declared)
    }

    /// The shared debug-pane notice text for a `configFallback` `ActiveWorkerIDsSource`, so the
    /// wording can't drift between `DeployModel.swift` and `SiteOperations.swift` — mirrors
    /// `WorkerActivation.missingDescriptorWarning`'s shared-text idiom (#708 review feedback).
    /// `nil` when `source` is `.declared` — nothing to report.
    public static func activeWorkerIDsFallbackNotice(source: ActiveWorkerIDsSource) -> String? {
        guard case .configFallback(let reason) = source else { return nil }
        let why: String
        switch reason {
        case .unparsable: why = "anglesite.json couldn't be parsed"
        case .notDeclared: why = "anglesite.json has no declared worker activation yet"
        case .staleRelativeToConfig: why = "anglesite.json's declared worker activation is behind Config/'s"
        }
        return "using Config/'s worker activation (\(why))"
    }

    /// The full active-worker-id set after applying one Settings-tab toggle (#1172 review
    /// follow-up), for `syncWorkerActivationToAnglesiteJSON` to write through unconditionally.
    ///
    /// Toggles from the *resolved* set (`resolveActiveWorkerIDs`), not `settings.activeWorkerIDs`
    /// directly: `resolveActiveWorkerIDs` trusts a hand-edited `anglesite.json` declaration
    /// whenever `Config/` hasn't drifted since the last sync, and `syncWorkerActivationToAnglesiteJSON`
    /// overwrites `workers.active` wholesale with whatever it's given — so toggling from
    /// `Config/`'s raw (narrower) value would silently drop any hand-added id the declaration was
    /// trusted to deploy on the very next toggle. Deliberately NOT a union of the two sets: a
    /// union can only add ids, so it would make deactivating an already-declared worker
    /// impossible — every toggle-off would be immediately re-added by the id still sitting in the
    /// declaration. Resolving to one base set and applying exactly one add/remove on top of it is
    /// what makes both directions (a hand-added id survives; an explicit deactivation sticks) work
    /// simultaneously.
    public static func toggledActiveWorkerIDs(
        workerID: String, isOn: Bool, settings: SiteSettings, sourceDirectory: URL
    ) -> [String] {
        let (resolved, _) = resolveActiveWorkerIDs(settings: settings, sourceDirectory: sourceDirectory)
        var ids = Set(resolved ?? [])
        if isOn { ids.insert(workerID) } else { ids.remove(workerID) }
        return ids.sorted()
    }

    /// Write-through for the Workers Settings tab toggle (#1172): mirrors `settings.activeWorkerIDs`
    /// into `Source/anglesite.json`'s `workers.active` declaration, then records the synced value
    /// back into `Config/settings.plist` so `resolveActiveWorkerIDs` can tell a successful sync
    /// apart from a `Config/`-only write. Best-effort, like every other write-through call site
    /// (`CustomDomainAttachCommand`, `HardenExecutor`, `EmailSetupExecutor`): a git-tracked-file
    /// write failure must never block the Settings tab toggle the caller already committed to
    /// `Config/` — it just leaves `resolveActiveWorkerIDs` on the `Config/` fallback until the next
    /// successful call. Returns `settings` unchanged if the `anglesite.json` write fails.
    public static func syncWorkerActivationToAnglesiteJSON(
        configStore: SiteConfigStore, sourceDirectory: URL, settings: SiteSettings
    ) async -> SiteSettings {
        let saved = DomainConfigStore.update(sourceDirectory: sourceDirectory) { config in
            config.workers = DomainConfig.Workers(active: settings.activeWorkerIDs)
        }
        guard saved else { return settings }
        var updated = settings
        updated.activeWorkerIDsMigratedToAnglesiteJSON = settings.activeWorkerIDs
        try? await configStore.save(updated)
        return updated
    }

    /// Builds a `SiteGraphExplorerSnapshot` for `siteID` only when `contentGraph` has actually
    /// been populated for it (a headless/never-opened site contributes nothing there, matching
    /// `ImpactAnalysis`'s "never invents, may under-report" bias — see `WorkerActivation`'s own
    /// doc comment), then computes the effective active worker-id set and its diff against
    /// `settings.lastDeployedWorkerIDs` (#709 design §4-5). These two steps are combined here
    /// because the snapshot only exists to feed `WorkerActivation.effectiveActiveIDs` — no other
    /// caller needs it standalone.
    public static func planWorkerActivation(
        siteID: String,
        siteDirectory: URL,
        settings: SiteSettings,
        catalog: [WorkerDescriptor],
        contentGraph: SiteContentGraph
    ) async -> WorkerActivationPlan {
        let snapshot: SiteGraphExplorerSnapshot?
        if await contentGraph.isPopulated(siteID: siteID) {
            snapshot = SiteGraphExplorer.build(
                projectRoot: siteDirectory,
                siteID: siteID,
                pages: await contentGraph.pages(for: siteID),
                posts: await contentGraph.posts(for: siteID),
                images: await contentGraph.images(for: siteID)
            )
        } else {
            snapshot = nil
        }
        let (resolvedActiveWorkerIDs, activeWorkerIDsSource) = resolveActiveWorkerIDs(
            settings: settings, sourceDirectory: siteDirectory
        )
        var effectiveSettings = settings
        effectiveSettings.activeWorkerIDs = resolvedActiveWorkerIDs
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: effectiveSettings, catalog: catalog, graph: snapshot)
        let removedIDs = WorkerActivation.removedIDs(previous: Set(settings.lastDeployedWorkerIDs ?? []), next: effectiveActiveIDs)
        let workers = WorkerActivation.activeDescriptors(catalog: catalog, activeIDs: effectiveActiveIDs)
        let unresolvedIDs = WorkerActivation.unresolvedActiveIDs(activeIDs: effectiveActiveIDs, resolved: workers)
        return WorkerActivationPlan(
            effectiveActiveIDs: effectiveActiveIDs, removedIDs: removedIDs,
            workers: workers, unresolvedIDs: unresolvedIDs,
            activeWorkerIDsSource: activeWorkerIDsSource
        )
    }

    /// The `LogCenter` source tags whose lines feed the Deploy drawer's visible/copyable log
    /// (`DeployModel.logLines`, filtered from the shared subscription by `sources.contains`).
    /// Must list every source a deploy-time subprocess can log under, or its output is silently
    /// dropped from the debug pane — a `LogCenter.append` call still happens, it just never
    /// reaches this filtered view, which reads as "nothing was logged" (CLAUDE.md's "every
    /// spawned subprocess streams stdout+stderr into the debug pane" rule, violated by omission
    /// rather than a missing `append` call). `"worker-provision:<siteID>"` is
    /// `SocialWorkerProvisionCommand.provision`'s own `source` local — distinct from
    /// `DeployCommand`'s `"deploy:<siteID>"` family — tagging every wrangler call it makes (D1/KV/
    /// R2/Queue create, `d1 migrations apply`, ActivityPub secret pushes). Before this was added
    /// here, a D1/KV/R2/Queue provisioning failure's real wrangler stderr never appeared in the
    /// drawer even though `ContainerCommandRunner`/`defaultRunner` both already stream it into
    /// `LogCenter` correctly — only unrelated `"deploy:<siteID>"`-tagged lines (e.g. the
    /// conformance advisory) were visible.
    public static func deployLogSources(siteID: String) -> Set<String> {
        ["deploy:\(siteID)", "deploy:\(siteID):build", "worker-provision:\(siteID)"]
    }

    /// Worker-name resolution precedence (#740): prefer the site's already-established Worker name
    /// (`.site-config`'s `CF_PROJECT_NAME`, set at the first successful deploy or by a
    /// worker-name-conflict rename) over re-deriving one from the site's display name. Falling back
    /// to re-derivation on every deploy would silently regenerate `wrangler.toml` under the
    /// original (still-taken) name basis after a rename-and-retry, defeating the rename. Only a
    /// genuinely first-ever deploy (no candidate name recorded yet) falls through to the derived
    /// slug of `siteName ?? siteID`.
    public static func resolveWorkerSiteName(siteDirectory: URL, siteID: String, siteName: String?) -> String {
        let existingConfig = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        return SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: existingConfig)
            ?? SiteSlug.derive(from: siteName ?? siteID)
    }

    /// The site's best-known public URL for `WorkerComposition`'s `SITE_URL` var (#359) — the
    /// address the composed Worker uses for its own outbound requests, e.g. `CommunityMembershipClient`'s
    /// ActivityPub actor ID and outbox (#1085). The workers.dev host `DeployCommand.persistSiteURL`
    /// records after every successful deploy wins whenever it's present: nothing in the deploy
    /// pipeline actually attaches a custom domain yet (#1077), so a configured `DOMAIN`/
    /// `SITE_DOMAIN` is never verified to be live, and trusting it unconditionally over a
    /// known-working host silently breaks federation the moment the custom domain doesn't resolve.
    /// A custom domain is used only as a last resort, before any deploy has ever persisted
    /// `SITE_URL` — the best guess available at that point. `nil` before any deploy has ever run
    /// and no custom domain is configured — the composed Worker degrades gracefully without it
    /// (worker.ts's queue consumer no-ops).
    public static func resolveSiteURL(siteDirectory: URL) -> String? {
        let config = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        if let siteURL = WebsiteAnalyticsAsset.configValue("SITE_URL", in: config) {
            return siteURL
        }
        if let domain = WebsiteAnalyticsAsset.configValue("DOMAIN", in: config)
            ?? WebsiteAnalyticsAsset.configValue("SITE_DOMAIN", in: config) {
            let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : "https://\(trimmed)"
        }
        return nil
    }

    /// The site's ActivityPub handle override (`.site-config`'s `AP_USERNAME`, #1239, design doc
    /// `2026-08-04-fediverse-handle-design.md`) — git-visible, unlike `SiteSettings.displayName`,
    /// so the owner (or a hand edit outside the app) is the source of truth. `nil` when unset;
    /// `WorkerComposition.generateWranglerToml` then omits the `AP_USERNAME` var entirely and the
    /// composed Worker derives the handle from the serving hostname (`worker.ts`'s concern, not
    /// this function's). Read-through, unvalidated: a syntactically invalid value is threaded
    /// into `wrangler.toml` as-is and degrades to the hostname default at *request* time
    /// (`worker.ts`'s `resolvePreferredUsername`) — the same defense-in-depth posture
    /// `resolveSiteURL` and every other hand-editable `.site-config` value already follows here.
    public static func resolveActivityPubUsername(siteDirectory: URL) -> String? {
        let config = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        guard let value = WebsiteAnalyticsAsset.configValue("AP_USERNAME", in: config) else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// RFC 7565 `acct:` userpart ∩ Mastodon remote-username grammar (#1239, design doc
    /// §"Owner-chosen username") — the same rule `worker.ts`'s `isValidApUsername` re-checks at
    /// request time. Exposed here so the app's handle-entry field (Workers tab / first-deploy
    /// confirmation) can validate at entry, per the design doc, without duplicating the regex.
    public static func isValidActivityPubUsername(_ value: String) -> Bool {
        guard let regex = try? Regex("^[a-zA-Z0-9_]([a-zA-Z0-9_.-]*[a-zA-Z0-9_])?$") else { return false }
        return value.wholeMatch(of: regex) != nil
    }

    /// The default ActivityPub handle: the site's best-known serving hostname
    /// (``DeployCoordinator/resolveSiteURL(siteDirectory:)``) with a leading `www.` stripped —
    /// mirrors `worker.ts`'s `defaultApUsername` exactly, so the app's pre-filled handle field
    /// and rename-detection agree with what the composed Worker will actually serve. `nil`
    /// before any deploy has ever run and no custom domain is configured, same as
    /// ``DeployCoordinator/resolveSiteURL(siteDirectory:)``.
    public static func defaultActivityPubUsername(siteDirectory: URL) -> String? {
        guard let siteURL = resolveSiteURL(siteDirectory: siteDirectory), let host = URL(string: siteURL)?.host else {
            return nil
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// The ActivityPub handle the composed Worker will actually serve for this site right now:
    /// ``DeployCoordinator/resolveActivityPubUsername(siteDirectory:)``'s override when set *and*
    /// syntactically valid, else ``DeployCoordinator/defaultActivityPubUsername(siteDirectory:)``
    /// — mirrors `worker.ts`'s `resolvePreferredUsername` exactly
    /// (including falling back on an invalid override and lowercasing a valid one — the grammar
    /// is case-insensitive, but WebFinger's local-part lookup is exact-match case-sensitive per
    /// RFC 7565, so a mixed-case override would otherwise only resolve at that exact casing), so
    /// the app's handle field default and rename-detection compare apples to apples with what a
    /// peer would actually see after the next deploy. `nil` only when neither a usable override
    /// nor a resolvable site URL exists yet (a site that has never deployed).
    public static func resolveEffectiveActivityPubUsername(siteDirectory: URL) -> String? {
        let fallback = defaultActivityPubUsername(siteDirectory: siteDirectory)
        guard let override = resolveActivityPubUsername(siteDirectory: siteDirectory),
            isValidActivityPubUsername(override)
        else {
            return fallback
        }
        return override.lowercased()
    }

    /// Whether this site's ActivityPub actor has already federated — the design doc's "lock
    /// signal" (#1239): a non-empty followers collection or a non-empty outbox ledger. Advisory
    /// only, like every other check derived from `Source/`'s hand-editable state (see CLAUDE.md
    /// "Git is the source of truth") —
    /// ``DeployCoordinator/activityPubHandleRenameNeedsConfirmation(lastDeployedUsername:resolvedUsername:isLocked:acknowledgedUsername:)``
    /// is the consumer, not an enforcement gate.
    ///
    /// `siteURL` is optional so the local, always-available outbox-ledger check still runs (and
    /// can still report `true`) even when the caller has no resolvable site URL yet — a caller
    /// with `lastDeployedAPUsername` set (the only way this function's result reaches the rename
    /// check at all) has necessarily deployed successfully before, so a `nil`/unparseable URL at
    /// *this* moment is a transient config gap, not evidence the actor never federated; treating
    /// it as an automatic "not locked" would silently skip the one signal (a populated ledger)
    /// that doesn't need a network round trip to answer. The network-only followers check is
    /// still best-effort: skipped entirely without a URL, and a transport failure reads as "not
    /// locked" rather than blocking the deploy flow on it.
    public static func isActivityPubHandleLocked(siteURL: URL?, configDirectory: URL) async -> Bool {
        let ledger = ActivityPubOutboxLedger.load(from: configDirectory) ?? ActivityPubOutboxLedger()
        if !ledger.entries.isEmpty { return true }
        guard let siteURL, let followers = try? await ActivityPubFollowersClient(siteURL: siteURL).collection() else {
            return false
        }
        return followers.totalItems > 0
    }

    /// Whether this deploy's resolved ActivityPub handle differs from the last-deployed baseline
    /// AND the actor has already federated (#1239, design doc §"Owner-chosen username" — the
    /// lock signal from ``DeployCoordinator/isActivityPubHandleLocked(siteURL:configDirectory:)``).
    /// A pre-federation handle change, or a first-ever deploy (`lastDeployedUsername` still
    /// `nil`), never triggers this — only a change that would actually strand existing followers
    /// does. `acknowledgedUsername` is the specific handle the owner already confirmed switching
    /// to (`DeployModel`'s "switch to `@new@…`" retry) — once set to exactly `resolvedUsername`,
    /// that one handle stops re-prompting, but a *different* subsequent change still does. Pure
    /// so it unit-tests without the network/disk calls
    /// ``DeployCoordinator/isActivityPubHandleLocked(siteURL:configDirectory:)`` needs; the caller
    /// (`DeployModel`) decides how to surface a `true` result — presenting the
    /// consequence-phrased confirmation sheet before proceeding, per the house rule on advisory
    /// questions.
    public static func activityPubHandleRenameNeedsConfirmation(
        lastDeployedUsername: String?, resolvedUsername: String?, isLocked: Bool, acknowledgedUsername: String? = nil
    ) -> Bool {
        guard isLocked, let lastDeployedUsername, let resolvedUsername else { return false }
        guard resolvedUsername != acknowledgedUsername else { return false }
        return lastDeployedUsername != resolvedUsername
    }

    /// Persists the newly-provisioned Cloudflare resources and advances the `lastDeployedWorkerIDs`
    /// baseline to `effectiveActiveIDs` (#709) after a successful provision — the diff baseline
    /// `WorkerActivation.removedIDs` compares the *next* deploy's plan against. Best-effort, like
    /// the rest of the deploy pipeline's post-success persistence (`DeployCommand.persistSiteURL`
    /// et al.): a settings-write failure must never turn an already-successful deploy into a
    /// failed one, so this never throws.
    public static func persistProvisionedResources(
        configStore: SiteConfigStore,
        settings: SiteSettings,
        effectiveActiveIDs: Set<String>,
        resources: WorkerComposition.ProvisionedResources,
        /// This deploy's resolved ActivityPub handle
        /// (``DeployCoordinator/resolveEffectiveActivityPubUsername(siteDirectory:)``, #1239) —
        /// advances `settings.lastDeployedAPUsername`, the baseline
        /// ``DeployCoordinator/activityPubHandleRenameNeedsConfirmation(lastDeployedUsername:resolvedUsername:isLocked:acknowledgedUsername:)``
        /// compares the *next* deploy against.
        /// `nil` when ActivityPub isn't active this deploy; leaves the baseline unchanged so a
        /// deactivated-then-reactivated actor is still compared against its real last-served
        /// handle rather than losing the baseline.
        apUsername: String? = nil
    ) async {
        var updated = settings
        updated.lastDeployedWorkerIDs = Array(effectiveActiveIDs).sorted()
        updated.provisionedWorkerResources = resources
        if let apUsername {
            updated.lastDeployedAPUsername = apUsername
        }
        try? await configStore.save(updated)
    }

    /// Runs the four post-deploy passes — webmention-send, POSSE-syndication, WebSub publish-ping,
    /// and ActivityPub outbox backfill (`sendWebmentions`, `syndicate`, `notifySubscribers`, and
    /// `backfillActivityPubOutbox` below) — in the fixed order the deploy pipeline has always used:
    /// Astro's build (already complete by the time this runs) regenerates the site's RSS/Atom/JSON
    /// feeds, so webmention discovery is ordered after the deployed canonical pages exist, and each
    /// subsequent pass is ordered after the ones before it (see each parameter's own doc comment for
    /// why). `onMilestone` fires immediately before each pass so a UI caller can surface progress
    /// (`DeployModel` wires it to the Dock-tile progress bar, #526) — the milestone always fires even
    /// if the caller-supplied closure for that pass turns out to be a no-op (e.g. no pending
    /// webmention targets). All four passes are awaited sequentially, never concurrently, matching
    /// the historical behavior; none of the four closures is expected to throw (the real commands
    /// they wrap are documented best-effort and never throw).
    public static func runPostDeploySequencing(
        onMilestone: (OperationProgress) -> Void,
        sendWebmentions: () async -> Void,
        syndicate: () async -> Void,
        /// WebSub publish pings (#361): tells the site's own hub the feeds changed so it fans
        /// the update out to subscribers. Ordered before the ActivityPub backfill below — the
        /// deployed feeds must exist before the hub fetches them, and (like the other passes)
        /// it's best-effort and never throws. Callers without the hub provisioned pass a no-op.
        notifySubscribers: () async -> Void = {},
        /// ActivityPub outbox backfill (#926): syncs existing content into the site's actor's
        /// outbox. Ordered last — after `syndicate()`, since POSSE write-back can change post
        /// frontmatter a backfill pass might otherwise read stale. Best-effort and never throws,
        /// like every other step here. Callers without ActivityPub provisioned pass a no-op.
        backfillActivityPubOutbox: () async -> Void = {}
    ) async {
        onMilestone(.deployWebmentions)
        await sendWebmentions()
        onMilestone(.deploySyndicating)
        await syndicate()
        onMilestone(.deployNotifyingSubscribers)
        await notifySubscribers()
        onMilestone(.deployBackfillingActivityPub)
        await backfillActivityPubOutbox()
    }
}
