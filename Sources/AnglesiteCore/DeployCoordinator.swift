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

        public init(
            effectiveActiveIDs: Set<String>, removedIDs: Set<String>,
            workers: [WorkerDescriptor], unresolvedIDs: Set<String>
        ) {
            self.effectiveActiveIDs = effectiveActiveIDs
            self.removedIDs = removedIDs
            self.workers = workers
            self.unresolvedIDs = unresolvedIDs
        }
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
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: snapshot)
        let removedIDs = WorkerActivation.removedIDs(previous: Set(settings.lastDeployedWorkerIDs ?? []), next: effectiveActiveIDs)
        let workers = WorkerActivation.activeDescriptors(catalog: catalog, activeIDs: effectiveActiveIDs)
        let unresolvedIDs = WorkerActivation.unresolvedActiveIDs(activeIDs: effectiveActiveIDs, resolved: workers)
        return WorkerActivationPlan(
            effectiveActiveIDs: effectiveActiveIDs, removedIDs: removedIDs,
            workers: workers, unresolvedIDs: unresolvedIDs
        )
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

    /// The site's best-known public URL for `WorkerComposition`'s `SITE_URL` var (#359): a
    /// custom domain (`DOMAIN`/`SITE_DOMAIN`, `WebsiteAnalyticsAsset.bestHost`'s own precedence)
    /// wins, given a scheme since those keys store a bare host; otherwise the workers.dev host
    /// `DeployCommand.persistSiteURL` writes after the site's first successful deploy. `nil`
    /// before any deploy has ever run and no custom domain is configured — the composed Worker
    /// degrades gracefully without it (worker.ts's queue consumer no-ops).
    public static func resolveSiteURL(siteDirectory: URL) -> String? {
        let config = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        if let domain = WebsiteAnalyticsAsset.configValue("DOMAIN", in: config)
            ?? WebsiteAnalyticsAsset.configValue("SITE_DOMAIN", in: config) {
            let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : "https://\(trimmed)"
        }
        return WebsiteAnalyticsAsset.configValue("SITE_URL", in: config)
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
        resources: WorkerComposition.ProvisionedResources
    ) async {
        var updated = settings
        updated.lastDeployedWorkerIDs = Array(effectiveActiveIDs).sorted()
        updated.provisionedWorkerResources = resources
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
