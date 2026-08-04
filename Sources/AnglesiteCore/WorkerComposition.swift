import Foundation

/// Generates the wrangler.toml and entry-point configuration for a per-site Cloudflare Worker
/// that composes `@dwk/*` social endpoints behind the site's static assets.
///
/// Today's deploy is static-only (`wrangler deploy` with `[assets]`). The social layer (V-2+)
/// adds a Worker script that mounts `@dwk/indieauth`, `@dwk/webmention`, etc. under path
/// prefixes. This type generates the configuration; `SocialWorkerProvisionCommand` fills the
/// Cloudflare resource identifiers once provisioning has created the backing stores.
public enum WorkerComposition {

    /// Ways `generateWranglerToml` can refuse to generate — both exist to keep unvalidated input
    /// out of the generated file.
    public enum ConfigError: Error, Sendable {
        /// `siteName` contains characters outside `[A-Za-z0-9_-]` — it's interpolated into TOML
        /// and used as the Cloudflare project name, so anything else is rejected up front.
        case invalidSiteName(String)
        /// A route claim reached TOML generation without passing `WorkerRouteClaims` validation
        /// (callers derive claims via `WorkerRouteClaims.activeClaims`, which validates; this is
        /// the defense-in-depth backstop so an unvalidated path can never be interpolated into
        /// the generated file).
        case invalidRouteClaim(path: String, reason: String)
    }

    /// `@dwk/indieauth`'s catalog id — a magic string composition keys off directly (its binding
    /// name, `AUTH_DB`, is part of its public contract, unlike every other `@dwk/*` package which
    /// only needs generic `resources` flags), shared so a typo in one comparison site can't
    /// silently diverge from another.
    public static let indieauthWorkerID = "indieauth"

    /// `@dwk/webmention`'s catalog id — like `indieauthWorkerID`, composition keys off this
    /// directly for the receiver's three bespoke bindings (`WEBMENTION_INBOX`, the Queue,
    /// `SITE_URL`), since those binding names are part of `@dwk/webmention`'s public composition
    /// contract, not something a generic `resources` flag can express without a paired schema
    /// change in the external `davidwkeith/workers` catalog repo.
    public static let webmentionWorkerID = "webmention"

    /// `@dwk/micropub`'s catalog id — like `webmentionWorkerID`, composition keys off this
    /// directly for the create/update/delete endpoint's bespoke `MICROPUB_DB` binding, since that
    /// binding name is part of `@dwk/micropub`'s public composition contract, not something a
    /// generic `resources` flag can express. `MEDIA` (R2) is emitted by the `hasMicropub`-scoped
    /// block below (not the generic `needsR2` flag), because that flag can't distinguish binding
    /// names and would also fire for `solid-pod`/`webdav` (which also declare an `r2` resource).
    public static let micropubWorkerID = "micropub"

    /// `@dwk/activitypub`'s catalog id — like `webmentionWorkerID`/`micropubWorkerID`, composition
    /// keys off this directly for the actor's bespoke `ACTOR` Durable Object binding, since the
    /// binding name and class name (`ActivityPubObject`) are part of `@dwk/activitypub`'s public
    /// composition contract (its README documents the exact `durable_objects`/`migrations` shape),
    /// not something the generic `resources` flags (`needsD1`/`needsKV`/`needsR2`) can express.
    public static let activitypubWorkerID = "activitypub"

    /// `@dwk/websub`'s catalog id — like `webmentionWorkerID`, composition keys off this
    /// directly for the hub's bespoke bindings (`WEBSUB_DB`, its own Queue, `SITE_URL`), since
    /// those binding names are part of `@dwk/websub`'s public composition contract.
    public static let websubWorkerID = "websub"

    /// `@dwk/microsub`'s catalog id — like `webmentionWorkerID`, composition keys off this
    /// directly for the reader's bespoke bindings (`MICROSUB_DB`, its own Queue), since those
    /// binding names are part of `@dwk/microsub`'s public composition contract. The catalog
    /// declares `requires: ["indieauth"]`, so `WorkerActivation` always activates `indieauth`
    /// alongside this one — the `AUTH_DB`/`TOKEN_SIGNING_KEY` bindings below fall out for free.
    public static let microsubWorkerID = "microsub"

    /// `@dwk/solid-oidc`'s catalog id — its `AUTH_DB` binding name is hardcoded in its own
    /// public contract (its README's bindings table), identical to `@dwk/indieauth`'s. The
    /// catalog declares `requires: ["indieauth"]`, so `WorkerActivation` always activates
    /// indieauth alongside this one and the shared `AUTH_DB` block below satisfies both —
    /// solid-oidc's own `solid_oidc_codes` table coexists there under its own name, no second
    /// D1 database, no binding collision.
    public static let solidOidcWorkerID = "solid-oidc"

    /// `@dwk/solid-pod`'s catalog id — composition keys off this directly for its bespoke
    /// `POD` Durable Object (class `SolidPodObject`) and its own `BLOBS` R2 bucket, which is
    /// deliberately distinct from Micropub's `MEDIA` bucket even though solid-pod's catalog
    /// `resources` also declares an `r2` entry (the generic `needsR2` flag can't distinguish
    /// binding names — see the `hasMicropub`-scoped MEDIA block below).
    public static let solidPodWorkerID = "solid-pod"

    /// `@dwk/webdav`'s catalog id — reuses `solid-pod`'s `POD`/`BLOBS` bindings (its catalog
    /// `requires: ["solid-pod"]`) and adds only its own `WEBDAV_PEPPER` secret.
    public static let webdavWorkerID = "webdav"

    /// The bespoke app-side inbox-capture route (#587) — not a `@dwk/workers` catalog worker, so
    /// its claim lives here rather than in `catalog.json`. Appended automatically when
    /// `generateWranglerToml` is called with `inboxCaptureEnabled`.
    public static let inboxCaptureRouteClaim = WorkerRouteClaim(
        path: "/inbox",
        match: .exact,
        methods: ["POST"],
        handler: "inbox-capture"
    )

    private static let validNameCharacters = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    )

    /// The Cloudflare resource identifiers/names provisioning has created for a site. Every field
    /// is optional: `nil` means "not provisioned yet", and TOML generation emits a placeholder (or
    /// deterministic name) instead of failing — so config can be generated before, during, and
    /// after provisioning without a separate schema per phase.
    public struct ProvisionedResources: Sendable, Equatable, Codable {
        /// The shared per-site D1 database's Cloudflare id — an *id* (unlike the queue/R2 names)
        /// because wrangler.toml's `[[d1_databases]]` blocks reference databases by id.
        public var d1DatabaseID: String?
        /// The `SOCIAL_KV` namespace's Cloudflare id — an id for the same reason as
        /// `d1DatabaseID`.
        public var kvNamespaceID: String?
        /// The R2 bucket name backing Micropub's `MEDIA` binding — a deterministic name
        /// (`\(siteName)-media`), not an id: wrangler references buckets by name.
        public var r2BucketName: String?
        /// The Cloudflare Queue name backing `@dwk/webmention`'s async verify step. Like
        /// `r2BucketName`, this is a deterministic name (`\(siteName)-webmention`), not an id —
        /// wrangler.toml's `[[queues.*]]` blocks reference queues by name.
        public var queueName: String?
        /// The Cloudflare Queue name backing `@dwk/websub`'s intent verification and
        /// per-subscriber delivery fan-out — deterministic (`\(siteName)-websub`), separate from
        /// `queueName` so the composed Worker's `queue()` handler can dispatch on the name
        /// suffix. Optional like every other field: `nil` decodes cleanly from settings
        /// persisted before this field existed.
        public var websubQueueName: String?
        /// The Cloudflare Queue name backing `@dwk/microsub`'s feed-poll fan-out and retries —
        /// deterministic (`\(siteName)-microsub`), separate from `queueName`/`websubQueueName` so
        /// the composed Worker's `queue()` handler can dispatch on the name suffix. Optional like
        /// every other field: `nil` decodes cleanly from settings persisted before this field
        /// existed.
        public var microsubQueueName: String?
        /// The Cloudflare R2 bucket name backing `@dwk/solid-pod`'s blob storage (binding
        /// `BLOBS`) — deterministic (`\(siteName)-pod-blobs`), distinct from `r2BucketName`
        /// (Micropub's `MEDIA` bucket) since the two hold semantically different content.
        public var podBlobsR2BucketName: String?

        /// Memberwise creation; the all-`nil` default is the pre-provisioning state.
        public init(
            d1DatabaseID: String? = nil, kvNamespaceID: String? = nil, r2BucketName: String? = nil,
            queueName: String? = nil, websubQueueName: String? = nil, microsubQueueName: String? = nil,
            podBlobsR2BucketName: String? = nil
        ) {
            self.d1DatabaseID = d1DatabaseID
            self.kvNamespaceID = kvNamespaceID
            self.r2BucketName = r2BucketName
            self.queueName = queueName
            self.websubQueueName = websubQueueName
            self.microsubQueueName = microsubQueueName
            self.podBlobsR2BucketName = podBlobsR2BucketName
        }
    }

    /// Generates a wrangler.toml for a site with the given workers enabled.
    ///
    /// - Parameters:
    ///   - siteName: The Worker name (used as the Cloudflare Workers project name).
    ///     Must match `[A-Za-z0-9_-]+`.
    ///   - workers: The effective active `@dwk/workers` catalog descriptors. Empty = static-only
    ///     deploy.
    ///   - routeClaims: The effective active dynamic-route claims (#746), already validated by
    ///     `WorkerRouteClaims.activeClaims`. Emitted as selective `[assets].run_worker_first`
    ///     patterns so *only* claimed routes bypass asset-first serving — a static asset can no
    ///     longer shadow an active dynamic route, while every unclaimed path keeps Cloudflare's
    ///     asset-first fallback. Omitted entirely when there are no active dynamic routes.
    ///   - resources: The site's provisioned Cloudflare resource identifiers and names — D1 and KV
    ///     are ids (``ProvisionedResources/d1DatabaseID``, ``ProvisionedResources/kvNamespaceID``),
    ///     while R2 and the queues are deterministic names, not ids (see
    ///     ``ProvisionedResources`` for the per-field rationale).
    ///   - inboxCaptureEnabled: Whether inbox-capture support is composed in: appends the
    ///     inbox-capture route claim to `routeClaims`, and always gates the emitted
    ///     `[[kv_namespaces]]` block. The Worker's `main` entry point, the `[assets]` binding,
    ///     and `[observability]` are each gated on this flag *or* `hasSocialFeatures` (any
    ///     active `workers`) — either one alone is enough to emit them.
    ///   - inboxKVNamespaceID: The inbox KV namespace ID. Optional even when
    ///     `inboxCaptureEnabled` is `true` — if `nil` or empty, the emitted
    ///     `[[kv_namespaces]]` block gets a placeholder empty `id` for provisioning to fill in
    ///     later, rather than throwing.
    ///   - siteURL: The site's public URL, threaded into the composed Worker's config.
    ///   - displayName: The site's display name (`SiteSettings.displayName`, already falling back
    ///     to the site name by the time a caller passes it in — this function stays pure and does
    ///     no fallback of its own), threaded into the ActivityPub actor's `AP_DISPLAY_NAME` var.
    ///     `nil` when unknown; the composed Worker's actor document then falls back to a fixed
    ///     generic name (`worker.ts`'s concern, not this function's).
    ///   - activityPubActorType: The ActivityPub actor's AS2 type (V-5.1b, #907;
    ///     `SiteSettings.communityActorURL`'s sibling concept) — `"Group"` for a hosted community,
    ///     `nil`/anything else for an ordinary Person actor. Only `"Group"` ever emits a var; the
    ///     composed Worker's actor document otherwise defaults to Person (`worker.ts`'s concern).
    ///   - moderators: Actor IRIs authorized to moderate this site's Group actor
    ///     (`SiteSettings.moderators`) — ignored for a Person actor. Emitted as a comma-joined
    ///     `AP_MODERATORS` var (Wrangler has no native list-valued var type); each IRI is filtered
    ///     through ``isSafeTomlStringValue`` individually, same as `siteURL`/`displayName`.
    /// - Returns: A complete wrangler.toml string.
    /// - Throws: ``ConfigError/invalidSiteName(_:)`` if `siteName` contains
    ///   characters outside `[A-Za-z0-9_-]`, or ``ConfigError/invalidRouteClaim(path:reason:)``
    ///   for a claim that never passed `WorkerRouteClaims` validation.
    public static func generateWranglerToml(
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim] = [],
        resources: ProvisionedResources = .init(),
        inboxCaptureEnabled: Bool = false,
        inboxKVNamespaceID: String? = nil,
        siteURL: String? = nil,
        displayName: String? = nil,
        activityPubActorType: String? = nil,
        moderators: [String]? = nil
    ) throws -> String {
        guard isValidSiteName(siteName) else {
            throw ConfigError.invalidSiteName(siteName)
        }
        var effectiveClaims = routeClaims
        if inboxCaptureEnabled {
            effectiveClaims.append(inboxCaptureRouteClaim)
        }
        // Full single-claim validation (not just path syntax), so a future caller that skips
        // `WorkerRouteClaims.activeClaims` still can't emit an invalid claim into TOML. Cross-
        // claim overlap detection remains `activeClaims`'s job — it needs owner attribution
        // this signature doesn't carry.
        for claim in effectiveClaims {
            do {
                try WorkerRouteClaims.validate(claim, owner: "composition")
            } catch {
                throw ConfigError.invalidRouteClaim(path: claim.path, reason: "\(error)")
            }
        }
        // @dwk/indieauth's binding name is part of its public composition contract (see the
        // AUTH_DB block below) — the one place composition keys off a specific catalog id rather
        // than generic resource flags.
        let hasIndieauth = workers.contains(where: { $0.id == indieauthWorkerID })
        let hasWebmentionReceive = workers.contains(where: { $0.id == webmentionWorkerID })
        let hasMicropub = workers.contains(where: { $0.id == micropubWorkerID })
        let hasActivityPub = workers.contains(where: { $0.id == activitypubWorkerID })
        let hasWebSub = workers.contains(where: { $0.id == websubWorkerID })
        let hasMicrosub = workers.contains(where: { $0.id == microsubWorkerID })
        let hasSolidOidc = workers.contains(where: { $0.id == solidOidcWorkerID })
        let hasSolidPod = workers.contains(where: { $0.id == solidPodWorkerID })
        let hasWebdav = workers.contains(where: { $0.id == webdavWorkerID })

        var lines: [String] = []
        lines.append("name = \"\(siteName)\"")
        lines.append("compatibility_date = \"2026-07-15\"")
        lines.append("compatibility_flags = [\"nodejs_compat\"]")

        let hasSocialFeatures = !workers.isEmpty
        if hasSocialFeatures || inboxCaptureEnabled {
            lines.append("main = \"worker/worker.ts\"")
        }
        lines.append("")
        lines.append("[assets]")
        lines.append("directory = \"dist\"")
        if hasSocialFeatures || inboxCaptureEnabled {
            lines.append("binding = \"ASSETS\"")
            let patterns = WorkerRouteClaims.runWorkerFirstPatterns(effectiveClaims)
            if !patterns.isEmpty {
                let list = patterns.map { "\"\($0)\"" }.joined(separator: ", ")
                lines.append("run_worker_first = [\(list)]")
            }
        }

        if workers.contains(where: { $0.resources.needsD1 }) {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Keep the generic DB binding above for the other @dwk packages, while binding the same
        // per-site D1 database under AUTH_DB for authorization codes and issued-token state.
        if hasIndieauth {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"AUTH_DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            lines.append("migrations_dir = \"worker/migrations\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Same shared per-site D1 database as DB/AUTH_DB, bound a third time under
        // WEBMENTION_INBOX — @dwk/webmention's createD1Inbox creates its own `webmentions`
        // table on first use, so no separate database or migration is needed here.
        if hasWebmentionReceive {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"WEBMENTION_INBOX\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Same shared per-site D1 database as DB/AUTH_DB/WEBMENTION_INBOX, bound a fourth time
        // under MICROPUB_DB — @dwk/micropub creates its own tables on first use, so no separate
        // database or migration is needed here (matches the WEBMENTION_INBOX comment above).
        if hasMicropub {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"MICROPUB_DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Cloudflare Queue backing @dwk/webmention's async verify step. Queues are referenced by
        // name (not id), so — like r2BucketName — this falls back to a deterministic
        // `\(siteName)-webmention` placeholder before provisioning assigns the real one.
        if hasWebmentionReceive {
            lines.append("")
            let queueName = resources.queueName ?? "\(siteName)-webmention"
            lines.append("[[queues.producers]]")
            lines.append("queue = \"\(queueName)\"")
            lines.append("binding = \"WEBMENTION_QUEUE\"")
            lines.append("")
            lines.append("[[queues.consumers]]")
            lines.append("queue = \"\(queueName)\"")
            lines.append("max_batch_size = 10")
            lines.append("max_batch_timeout = 30")
            lines.append("max_retries = 3")
        }

        // Same shared per-site D1 database, bound under WEBSUB_DB — @dwk/websub's
        // createD1SubscriptionStore creates its own `websub_subscriptions` table on first use,
        // so no separate database or migration is needed here.
        if hasWebSub {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"WEBSUB_DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Dedicated Cloudflare Queue for @dwk/websub's intent verification and per-subscriber
        // delivery fan-out. Deliberately separate from the Webmention queue: the composed
        // Worker's queue() handler dispatches on the queue-name suffix (`-websub`), and each
        // feature's retry traffic stays isolated from the other's.
        if hasWebSub {
            lines.append("")
            let websubQueueName = resources.websubQueueName ?? "\(siteName)-websub"
            lines.append("[[queues.producers]]")
            lines.append("queue = \"\(websubQueueName)\"")
            lines.append("binding = \"WEBSUB_QUEUE\"")
            lines.append("")
            lines.append("[[queues.consumers]]")
            lines.append("queue = \"\(websubQueueName)\"")
            lines.append("max_batch_size = 10")
            lines.append("max_batch_timeout = 30")
            lines.append("max_retries = 3")
        }

        // Same shared per-site D1 database, bound under MICROSUB_DB — @dwk/microsub creates its
        // own channels/follows/timeline-item tables on first use, so no separate database or
        // migration is needed here (matches the WEBSUB_DB comment above).
        if hasMicrosub {
            lines.append("")
            lines.append("[[d1_databases]]")
            lines.append("binding = \"MICROSUB_DB\"")
            lines.append("database_name = \"\(siteName)-social\"")
            if let id = resources.d1DatabaseID, !id.isEmpty {
                lines.append("database_id = \"\(id)\"")
            } else {
                lines.append("database_id = \"\"  # filled by provisioning")
            }
        }

        // Dedicated Cloudflare Queue for @dwk/microsub's feed-poll fan-out and retries.
        // Deliberately separate from the Webmention/WebSub queues: the composed Worker's
        // queue() handler dispatches on the queue-name suffix (`-microsub`).
        if hasMicrosub {
            lines.append("")
            let microsubQueueName = resources.microsubQueueName ?? "\(siteName)-microsub"
            lines.append("[[queues.producers]]")
            lines.append("queue = \"\(microsubQueueName)\"")
            lines.append("binding = \"MICROSUB_QUEUE\"")
            lines.append("")
            lines.append("[[queues.consumers]]")
            lines.append("queue = \"\(microsubQueueName)\"")
            lines.append("max_batch_size = 10")
            lines.append("max_batch_timeout = 30")
            lines.append("max_retries = 3")
        }

        // @dwk/microsub's poller runs off the read path on a Cron Trigger, enqueuing one poll job
        // per followed feed (see `createMicrosubPoller` in the package README) — the read path
        // itself only ever serves stored entries.
        // @dwk/microsub's poller (feed-poll fan-out) and @dwk/solid-pod's GC (orphaned R2 blob
        // reclamation) each run off their own Cron Trigger schedule; `worker.ts`'s `scheduled()`
        // dispatches on `controller.cron` to tell them apart, mirroring how `queue()` dispatches
        // on the queue-name suffix.
        var cronSchedules: [String] = []
        if hasMicrosub { cronSchedules.append("*/15 * * * *") }
        if hasSolidPod { cronSchedules.append("*/5 * * * *") }
        if !cronSchedules.isEmpty {
            lines.append("")
            lines.append("[triggers]")
            let list = cronSchedules.map { "\"\($0)\"" }.joined(separator: ", ")
            lines.append("crons = [\(list)]")
        }

        if workers.contains(where: { $0.resources.needsKV }) {
            lines.append("")
            lines.append("[[kv_namespaces]]")
            lines.append("binding = \"SOCIAL_KV\"")
            if let id = resources.kvNamespaceID, !id.isEmpty {
                lines.append("id = \"\(id)\"")
            } else {
                lines.append("id = \"\"  # filled by provisioning")
            }
        }

        if hasMicropub {
            lines.append("")
            lines.append("[[r2_buckets]]")
            lines.append("binding = \"MEDIA\"")
            lines.append("bucket_name = \"\(resources.r2BucketName ?? "\(siteName)-media")\"")
        }

        // @dwk/solid-pod's own R2 bucket for blob bodies (binding BLOBS) — a distinct bucket
        // from Micropub's MEDIA, since they hold semantically different content. @dwk/webdav
        // reuses this same bucket (its catalog requires solid-pod), so it's gated on either.
        if hasSolidPod || hasWebdav {
            lines.append("")
            lines.append("[[r2_buckets]]")
            lines.append("binding = \"BLOBS\"")
            lines.append("bucket_name = \"\(resources.podBlobsR2BucketName ?? "\(siteName)-pod-blobs")\"")
        }

        if hasActivityPub {
            lines.append("")
            lines.append("[[durable_objects.bindings]]")
            lines.append("name = \"ACTOR\"")
            lines.append("class_name = \"ActivityPubObject\"")
            lines.append("")
            lines.append("[[migrations]]")
            lines.append("tag = \"v1\"")
            lines.append("new_sqlite_classes = [\"ActivityPubObject\"]")
        }

        // @dwk/solid-pod's per-pod Durable Object. @dwk/webdav reuses this same object (its
        // catalog requires solid-pod), so it's gated on either. A separate migration tag ("v2")
        // from ActivityPub's ("v1") — Cloudflare migration tags are immutable once applied to a
        // deployed Worker, so a site that already deployed ActivityPub under "v1" must never see
        // that tag's class list change; SolidPodObject is a new tag, not an edit to an old one.
        if hasSolidPod || hasWebdav {
            lines.append("")
            lines.append("[[durable_objects.bindings]]")
            lines.append("name = \"POD\"")
            lines.append("class_name = \"SolidPodObject\"")
            lines.append("")
            lines.append("[[migrations]]")
            lines.append("tag = \"v2\"")
            lines.append("new_sqlite_classes = [\"SolidPodObject\"]")
        }

        if inboxCaptureEnabled {
            lines.append("")
            lines.append("[[kv_namespaces]]")
            lines.append("binding = \"INBOX_KV\"")
            if let id = inboxKVNamespaceID, !id.isEmpty {
                lines.append("id = \"\(id)\"")
            } else {
                lines.append("id = \"\"  # filled by provisioning")
            }
        }

        var varsLines: [String] = []
        // SITE_URL: the canonical origin the queue consumers key on — Webmention's verifier
        // scopes accepted targets with it, WebSub's consumer derives its topic URLs from it, and
        // Microsub's poller/queue consumer use it as their `baseUrl`/`me` (none of the three has
        // a request to derive an origin from).
        if hasWebmentionReceive || hasWebSub || hasMicrosub, let siteURL, !siteURL.isEmpty, isSafeTomlStringValue(siteURL) {
            varsLines.append("SITE_URL = \"\(siteURL)\"")
        }
        if hasActivityPub, let displayName, !displayName.isEmpty, isSafeTomlStringValue(displayName) {
            varsLines.append("AP_DISPLAY_NAME = \"\(displayName)\"")
        }
        // Group actor config (V-5.1b, #907, design doc §4.1 D3): only "Group" ever emits a var —
        // an ordinary Person actor (the overwhelming common case) leaves both vars out entirely,
        // matching AP_DISPLAY_NAME's "only emit when there's something to say" convention.
        if hasActivityPub, activityPubActorType == "Group" {
            varsLines.append("AP_ACTOR_TYPE = \"Group\"")
            let safeModerators = (moderators ?? []).filter { !$0.isEmpty && isSafeTomlStringValue($0) }
            if !safeModerators.isEmpty {
                varsLines.append("AP_MODERATORS = \"\(safeModerators.joined(separator: ","))\"")
            }
        }
        if !varsLines.isEmpty {
            lines.append("")
            lines.append("[vars]")
            lines.append(contentsOf: varsLines)
        }

        if hasIndieauth {
            lines.append("")
            // Wrangler has no schema for declaring required secrets in wrangler.toml — secrets are
            // set with `wrangler secret put <NAME>` and are never read back out of this file. Emit
            // this as a comment (not a `[secrets]` table) so it can't be mistaken for a config key
            // wrangler validates or fail on.
            lines.append("# Secrets required for IndieAuth (set with `wrangler secret put <NAME>`):")
            lines.append("# TOKEN_SIGNING_KEY, INDIEAUTH_OWNER_PASSWORD")
        }
        if hasSolidOidc {
            lines.append("")
            lines.append("# Secrets required for Solid-OIDC (set with `wrangler secret put <NAME>`):")
            lines.append("# OIDC_SIGNING_KEY")
        }
        if hasWebdav {
            lines.append("")
            lines.append("# Secrets required for WebDAV (set with `wrangler secret put <NAME>`):")
            lines.append("# WEBDAV_PEPPER")
        }

        if hasSocialFeatures || inboxCaptureEnabled {
            lines.append("")
            lines.append("[observability]")
            lines.append("enabled = true")
            lines.append("head_sampling_rate = 1")
        }

        lines.append("")
        return lines.joined(separator: "\n")
    }

    static func isValidSiteName(_ siteName: String) -> Bool {
        guard !siteName.isEmpty else { return false }
        return siteName.unicodeScalars.allSatisfy { validNameCharacters.contains($0) }
    }

    /// Whether `value` is safe to interpolate as-is into a TOML basic string (`"..."`) — no
    /// double quote, backslash, or control character that could break out of the string literal
    /// or corrupt the generated file. `siteURL` is sourced from `.site-config`, which lives in
    /// the site's git-tracked `Source/` — externally clonable/editable content (CLAUDE.md's "Git
    /// is the source of truth"), so it must be treated the same as any other untrusted input
    /// before being interpolated into generated infrastructure config.
    static func isSafeTomlStringValue(_ value: String) -> Bool {
        !value.contains("\"") && !value.contains("\\")
            && !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F })
    }
}
