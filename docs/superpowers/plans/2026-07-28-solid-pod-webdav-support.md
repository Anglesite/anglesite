# Solid Pod, Solid-OIDC, and WebDAV Worker Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose `@dwk/solid-oidc`, `@dwk/solid-pod`, and `@dwk/webdav` into the per-site Cloudflare Worker so activating `webdav` in Settings actually deploys and works, instead of hard-failing on an unknown-method validation error.

**Architecture:** Follow the exact pattern this codebase already uses for six other `@dwk/*` packages: a catalog-id constant in `WorkerComposition.swift` drives bespoke wrangler.toml binding blocks (Durable Object, R2, D1, secrets), `SocialWorkerProvisionCommand.swift` provisions the real Cloudflare resources and pushes secrets, and `worker.ts`'s declarative `ROUTES` table wires each claimed path to a config-builder + handler pair that degrades to `503` when unbound. Identity is the one new piece: `@dwk/solid-oidc` issues the DPoP-bound WebID tokens `@dwk/solid-pod` validates, with its consent step reusing the same `INDIEAUTH_OWNER_PASSWORD` check `@dwk/indieauth` already gates on — one owner, one password, two protocols.

**Tech Stack:** Swift 6.4 (AnglesiteCore, Swift Testing), TypeScript/Cloudflare Workers (`Resources/Template/worker/worker.ts`, Vitest + `cloudflare:test`).

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-28-solid-pod-webdav-support-design.md](../specs/2026-07-28-solid-pod-webdav-support-design.md) — every task below implements one of its sections.
- No paired PR against `Anglesite/anglesite-skills` — this doesn't touch the MCP message schema.
- `pre-deploy-check.ts` is untouched — this is Worker composition, not the template security gate.
- Every new/changed handler in `worker.ts` degrades to `503` when its bindings are absent, matching every existing handler in that file (never let an unconfigured feature throw at module load or mid-request).
- Conformance gating is advisory-only, never blocking (matches `WorkerActivation.conformanceAdvisory`'s existing contract for V-2/V-3/V-4).
- Run `swift test --package-path .` after every Swift task, and `npm run lint && npm run typecheck && npm test` (from `Resources/Template/`, per the template's own `package.json`) after every `worker.ts` task, before committing.

---

## Upstream dependency (blocks nothing in this plan, but note it)

This plan's `WorkerCompositionTests`/`WorkerRouteClaimsTests` fixtures use **prefix-only** route claims for `solid-pod` (`/pod/`) and `webdav` (`/dav/`), not the exact-plus-prefix shape the live `catalog.json` currently publishes for both. That's deliberate, not an oversight: `WorkerRouteClaims.activeClaims`'s duplicate-claim check groups by normalized path, and a worker declaring *both* an exact `/pod` claim and a prefix `/pod/` claim (which normalizes to the same `/pod`) trips `.duplicateClaim(path: "/pod", owners: ["solid-pod", "solid-pod"])` — confirmed by tracing `WorkerRouteClaims.swift`'s `activeClaims` against the actual catalog shape. The prefix claim alone already covers the bare path too (`runWorkerFirstPatterns` does `patterns.insert(claim.path)` unconditionally, then adds `path/*` for prefix claims), so the exact claim is redundant. **Upstream catalog fix needed** (yours, per the existing coordination pattern): drop the redundant exact `/pod` and `/dav` claims from `solid-pod`/`webdav`'s `catalog.json` entries, keeping only the prefix ones. Task 1 adds a regression test that documents this exact failure mode against the *current* (unfixed) catalog shape, so it's caught immediately if it resurfaces.

Also needed upstream (from the design doc, restated here for the implementer): `solid-oidc.requires: ["indieauth"]` and `solid-pod.requires: ["solid-oidc"]` data-only edits to `catalog.json`.

---

### Task 1: Widen `WorkerRouteClaims.allowedMethods` for WebDAV

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerRouteClaims.swift:52`
- Test: `Tests/AnglesiteCoreTests/WorkerRouteClaimsTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorkerRouteClaims.allowedMethods` now includes `PROPFIND`, `PROPPATCH`, `MKCOL`, `COPY`, `MOVE`, `LOCK`, `UNLOCK` — later tasks' fixtures rely on these being accepted.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/WorkerRouteClaimsTests.swift` (near the existing "rejects empty, unknown, lowercase, duplicate, and unpaired-HEAD method lists" test):

```swift
@Test("accepts the full WebDAV Class 2 method set")
func acceptsWebDavMethods() throws {
    let claim = WorkerRouteClaim(
        path: "/dav",
        match: .exact,
        methods: ["GET", "PUT", "DELETE", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "OPTIONS"],
        handler: "createSolidPodWebdav",
        specificationURL: URL(string: "https://www.rfc-editor.org/rfc/rfc4918")
    )
    try WorkerRouteClaims.validate(claim, owner: "webdav")
}

@Test("still rejects a genuinely unknown method after the WebDAV widening")
func stillRejectsUnknownMethod() {
    let claim = WorkerRouteClaim(path: "/dav", match: .exact, methods: ["TRACE"], handler: "createSolidPodWebdav")
    #expect(throws: WorkerRouteClaims.ValidationError.invalidMethods(
        owner: "webdav", path: "/dav", reason: "unknown or non-uppercase method \"TRACE\""
    )) {
        try WorkerRouteClaims.validate(claim, owner: "webdav")
    }
}

@Test("documents the upstream catalog bug: same-owner exact + prefix claims to the same base path collide as duplicates")
func sameOwnerExactPlusPrefixCollide() {
    // Mirrors the *current* (unfixed) catalog.json shape for solid-pod/webdav: an exact "/pod"
    // claim and a prefix "/pod/" claim from the same owner. The prefix claim alone already covers
    // the bare path (see WorkerRouteClaims.runWorkerFirstPatterns), so the exact claim is
    // redundant — but activeClaims doesn't know that, and both claims normalize to path "/pod".
    // This test exists so a future catalog fix (drop the redundant exact claim) has a red-to-green
    // signal, and so nobody "fixes" this by loosening duplicate detection instead.
    let exact = WorkerRouteClaim(path: "/pod", match: .exact, methods: ["GET"], handler: "createSolidPod")
    let prefix = WorkerRouteClaim(
        path: "/pod/", match: .prefix, methods: ["GET"], handler: "createSolidPod",
        specificationURL: URL(string: "https://solidproject.org/TR/protocol")
    )
    let catalog = [
        WorkerDescriptor(
            id: "solid-pod", displayName: "Solid Pod", description: "test fixture", group: "storage",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: true),
            routes: [exact, prefix]
        ),
    ]
    #expect(throws: WorkerRouteClaims.ValidationError.duplicateClaim(path: "/pod", owners: ["solid-pod", "solid-pod"])) {
        try WorkerRouteClaims.activeClaims(catalog: catalog, activeIDs: ["solid-pod"])
    }
}
```

- [ ] **Step 2: Run tests to verify the first two pass already-wrong and the third documents current behavior**

Run: `swift test --package-path . --filter WorkerRouteClaimsTests`
Expected: `acceptsWebDavMethods` FAILS (PROPFIND not yet allowed); `stillRejectsUnknownMethod` PASSES already; `sameOwnerExactPlusPrefixCollide` PASSES already (documents existing behavior, not a new one).

- [ ] **Step 3: Widen the allowed-methods set**

In `Sources/AnglesiteCore/WorkerRouteClaims.swift`, replace line 50-52:

```swift
    /// HTTP methods a claim may declare. A closed set: anything else in a catalog is a manifest
    /// error, not a forward-compatibility case — new methods need app-side dispatch support anyway.
    static let allowedMethods: Set<String> = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
```

with:

```swift
    /// HTTP methods a claim may declare. A closed set: anything else in a catalog is a manifest
    /// error, not a forward-compatibility case — new methods need app-side dispatch support
    /// anyway. The WebDAV Class 2 verbs (PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK/UNLOCK, RFC 4918)
    /// were added once that dispatch existed (`createSolidPodWebdav` in `worker.ts`).
    static let allowedMethods: Set<String> = [
        "GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS",
        "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK",
    ]
```

- [ ] **Step 4: Run tests to verify all three pass**

Run: `swift test --package-path . --filter WorkerRouteClaimsTests`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerRouteClaims.swift Tests/AnglesiteCoreTests/WorkerRouteClaimsTests.swift
git commit -m "feat: allow WebDAV Class 2 methods in worker route claims"
```

---

### Task 2: `WorkerComposition.swift` — solid-oidc/solid-pod/webdav bindings

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerComposition.swift`
- Test: `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`

**Interfaces:**
- Consumes: `WorkerRouteClaims.allowedMethods` (Task 1, indirectly — route claims for these workers now validate).
- Produces: `WorkerComposition.solidOidcWorkerID = "solid-oidc"`, `.solidPodWorkerID = "solid-pod"`, `.webdavWorkerID = "webdav"`; `ProvisionedResources.podBlobsR2BucketName: String?`. Task 4 (`SocialWorkerProvisionCommand.swift`) consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift` (the file already has a `worker(_:d1:kv:r2:)` fixture helper at the top — reuse it):

```swift
private let solidOidcWorker = worker(WorkerComposition.solidOidcWorkerID, d1: true, kv: false, r2: false)
private let solidPodWorker = worker(WorkerComposition.solidPodWorkerID, d1: false, kv: false, r2: true)
private let webdavWorker = worker(WorkerComposition.webdavWorkerID, d1: false, kv: false, r2: true)
```

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: FAIL — `solidOidcWorkerID`/`solidPodWorkerID`/`webdavWorkerID` don't exist yet (compile error).

- [ ] **Step 3: Add the worker-id constants and `ProvisionedResources` field**

In `Sources/AnglesiteCore/WorkerComposition.swift`, after the `microsubWorkerID` declaration (after line 59), add:

```swift
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
```

In `ProvisionedResources`, add a new field alongside `r2BucketName` (after line 82's `queueName` doc comment, add before `queueName` or right after `r2BucketName` for locality):

```swift
        /// The Cloudflare R2 bucket name backing `@dwk/solid-pod`'s blob storage (binding
        /// `BLOBS`) — deterministic (`\(siteName)-pod-blobs`), distinct from `r2BucketName`
        /// (Micropub's `MEDIA` bucket) since the two hold semantically different content.
        public var podBlobsR2BucketName: String?
```

Update `ProvisionedResources.init` to accept and assign it:

```swift
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
```

- [ ] **Step 4: Fix the MEDIA/BLOBS R2 collision and add the new binding blocks**

In `generateWranglerToml`, after the `hasMicrosub` declaration (line 180), add:

```swift
        let hasSolidOidc = workers.contains(where: { $0.id == solidOidcWorkerID })
        let hasSolidPod = workers.contains(where: { $0.id == solidPodWorkerID })
        let hasWebdav = workers.contains(where: { $0.id == webdavWorkerID })
```

Replace the generic R2 block (lines 362-367):

```swift
        if workers.contains(where: { $0.resources.needsR2 }) {
            lines.append("")
            lines.append("[[r2_buckets]]")
            lines.append("binding = \"MEDIA\"")
            lines.append("bucket_name = \"\(resources.r2BucketName ?? "\(siteName)-media")\"")
        }
```

with (scoped to Micropub specifically — `MEDIA` is its bespoke bucket, just like `ACTOR` is ActivityPub's bespoke Durable Object; the generic `needsR2` flag would also fire for `solid-pod`/`webdav`, which need their own distinctly-named bucket, added below):

```swift
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
```

After the `hasActivityPub` Durable Object block (after line 378), add solid-pod's, under its own migration tag so it never touches ActivityPub's already-applied `"v1"`:

```swift
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
```

Extend the cron trigger block. Replace the `hasMicrosub`-only trigger block (lines 345-349):

```swift
        if hasMicrosub {
            lines.append("")
            lines.append("[triggers]")
            lines.append("crons = [\"*/15 * * * *\"]")
        }
```

with:

```swift
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
```

Add the `OIDC_SIGNING_KEY`/`WEBDAV_PEPPER` secret comments alongside the existing IndieAuth one. Replace the `hasIndieauth` secrets-comment block (lines 408-416):

```swift
        if hasIndieauth {
            lines.append("")
            // Wrangler has no schema for declaring required secrets in wrangler.toml — secrets are
            // set with `wrangler secret put <NAME>` and are never read back out of this file. Emit
            // this as a comment (not a `[secrets]` table) so it can't be mistaken for a config key
            // wrangler validates or fail on.
            lines.append("# Secrets required for IndieAuth (set with `wrangler secret put <NAME>`):")
            lines.append("# TOKEN_SIGNING_KEY, INDIEAUTH_OWNER_PASSWORD")
        }
```

with:

```swift
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: PASS (all, including the pre-existing ones — check no regression on the Micropub-only-MEDIA and Microsub-only-cron cases).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/WorkerComposition.swift Tests/AnglesiteCoreTests/WorkerCompositionTests.swift
git commit -m "feat: compose solid-oidc, solid-pod, and webdav workers into wrangler.toml"
```

---

### Task 3: Solid-OIDC signing-key provisioning + WebDAV pepper secret

**Files:**
- Create: `Sources/AnglesiteCore/SolidOidcKeyProvisioning.swift`
- Modify: `Sources/AnglesiteCore/Platform/SecretStore.swift`
- Test: `Tests/AnglesiteCoreTests/SolidOidcKeyProvisioningTests.swift` (new)

**Interfaces:**
- Consumes: `SecretStore` protocol (existing), `P256.Signing.PrivateKey` (CryptoKit, already used by `DPoPKeyPair.swift` — mirror its JWK-serialization approach).
- Produces: `SolidOidcKeyProvisioning.signingKeyJWK(siteID:secretStore:) throws -> String` (a JSON-serialized private EC JWK) and `SolidOidcKeyProvisioning.webdavPepper(siteID:secretStore:) throws -> String` (a random secret). Task 4 (`SocialWorkerProvisionCommand.swift`) calls both.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/SolidOidcKeyProvisioningTests.swift`:

```swift
// Tests/AnglesiteCoreTests/SolidOidcKeyProvisioningTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

private final class FakeSecretStore: SecretStore, @unchecked Sendable {
    private var storage: [String: String] = [:]
    func read(account: String) throws -> String? { storage[account] }
    func write(_ value: String, account: String) throws {
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }
    func delete(account: String) throws { storage.removeValue(forKey: account) }
}

@Suite("SolidOidcKeyProvisioning")
struct SolidOidcKeyProvisioningTests {
    @Test("signingKeyJWK generates a private EC P-256 JWK with the expected members")
    func generatesJWK() throws {
        let store = FakeSecretStore()
        let jwk = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        let object = try #require(try JSONSerialization.jsonObject(with: Data(jwk.utf8)) as? [String: String])
        #expect(object["kty"] == "EC")
        #expect(object["crv"] == "P-256")
        #expect(object["x"]?.isEmpty == false)
        #expect(object["y"]?.isEmpty == false)
        #expect(object["d"]?.isEmpty == false)
    }

    @Test("signingKeyJWK returns the same key on a second call — never regenerated")
    func neverRegenerates() throws {
        let store = FakeSecretStore()
        let first = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        let second = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        #expect(first == second)
    }

    @Test("signingKeyJWK generates independent keys for different sites")
    func independentPerSite() throws {
        let store = FakeSecretStore()
        let siteA = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-a", secretStore: store)
        let siteB = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-b", secretStore: store)
        #expect(siteA != siteB)
    }

    @Test("webdavPepper generates a non-empty secret and never regenerates")
    func webdavPepperStable() throws {
        let store = FakeSecretStore()
        let first = try SolidOidcKeyProvisioning.webdavPepper(siteID: "site-1", secretStore: store)
        let second = try SolidOidcKeyProvisioning.webdavPepper(siteID: "site-1", secretStore: store)
        #expect(!first.isEmpty)
        #expect(first == second)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SolidOidcKeyProvisioningTests`
Expected: FAIL — `SolidOidcKeyProvisioning` doesn't exist yet (compile error).

- [ ] **Step 3: Add the account keys**

In `Sources/AnglesiteCore/Platform/SecretStore.swift`, after `activityPubPublishToken` (after line 68), add:

```swift
    /// The Solid-OIDC OP's ES256 signing key (a private JWK, RFC 7518 §6.2.2), generated once per
    /// site by `SolidOidcKeyProvisioning` and never regenerated: rotating it would invalidate
    /// every access token `@dwk/solid-pod` has already accepted the corresponding JWKS entry for.
    public static func solidOidcSigningKeyJWK(siteID: String) -> String {
        "solid-oidc:\(siteID):signing-key-jwk"
    }

    /// The pepper `@dwk/webdav` mixes into its app-password hashing (`WEBDAV_PEPPER`). App-
    /// generated random bytes; unlike the signing key above, rotating this only invalidates
    /// existing app passwords (the user re-mints them), not a federation-trust relationship, but
    /// it's still generated once and persisted rather than regenerated per deploy.
    public static func webdavPepper(siteID: String) -> String {
        "webdav:\(siteID):pepper"
    }
```

- [ ] **Step 4: Implement `SolidOidcKeyProvisioning`**

Create `Sources/AnglesiteCore/SolidOidcKeyProvisioning.swift`:

```swift
import Foundation
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Generates and persists the per-site secret material `@dwk/solid-oidc` and `@dwk/webdav` need:
/// an ES256 signing key (as a private JWK, RFC 7518 §6.2.2 — the shape `@dwk/solid-oidc`'s
/// `generateSigningJwk()` produces, generated app-side instead since this is exactly a standard
/// P-256 JWK and CryptoKit already builds one for `DPoPKeyPair`'s public-key case) and a random
/// pepper for WebDAV's app-password hashing. Generated exactly once per site, lazily, the first
/// time a caller asks — the signing key is never regenerated, since rotating it invalidates every
/// access token `@dwk/solid-pod` has already accepted the corresponding JWKS entry for (mirrors
/// `ActivityPubKeyProvisioning`'s "never regenerate" rationale for its own signing key).
public enum SolidOidcKeyProvisioning {
    public enum Error: Swift.Error {
        case keyGenerationFailed(String)
        case unsupportedPlatform
    }

    /// Returns this site's Solid-OIDC signing key as a JSON-serialized private EC P-256 JWK,
    /// generating and persisting it into `secretStore` on first call. Every subsequent call for
    /// the same `siteID` returns the same value.
    ///
    /// **Concurrency note:** not safe to call concurrently for the same `siteID` — same caveat as
    /// `ActivityPubKeyProvisioning.secrets(siteID:secretStore:)`, whose sole caller
    /// (`SocialWorkerProvisionCommand.provision()`) already serializes on this.
    public static func signingKeyJWK(siteID: String, secretStore: any SecretStore) throws -> String {
        let account = SecretAccounts.solidOidcSigningKeyJWK(siteID: siteID)
        if let existing = try secretStore.read(account: account) {
            return existing
        }
        let jwk = try generateSigningKeyJWK()
        try secretStore.write(jwk, account: account)
        return jwk
    }

    /// Returns this site's WebDAV app-password pepper, generating and persisting it into
    /// `secretStore` on first call. Every subsequent call for the same `siteID` returns the same
    /// value. Unlike the signing key above, rotating this only invalidates existing app
    /// passwords — but it's still generated once, not regenerated per deploy, so a redeploy
    /// doesn't silently lock out every existing WebDAV client.
    public static func webdavPepper(siteID: String, secretStore: any SecretStore) throws -> String {
        let account = SecretAccounts.webdavPepper(siteID: siteID)
        if let existing = try secretStore.read(account: account) {
            return existing
        }
        let pepper = try randomToken()
        try secretStore.write(pepper, account: account)
        return pepper
    }

    static func generateSigningKeyJWK() throws -> String {
        #if canImport(CryptoKit)
        let privateKey = P256.Signing.PrivateKey()
        // ANSI X9.63 uncompressed point: a leading 0x04 format byte, then X (32 bytes), then Y
        // (32 bytes) — same decomposition `DPoPKeyPair.publicJWK` uses for the public-key case.
        let raw = privateKey.publicKey.x963Representation
        let start = raw.index(after: raw.startIndex)
        let x = raw.subdata(in: start..<(start + 32))
        let y = raw.subdata(in: (start + 32)..<(start + 64))
        let d = privateKey.rawRepresentation
        let jwk: [String: String] = [
            "kty": "EC", "crv": "P-256",
            "x": base64url(x), "y": base64url(y), "d": base64url(d),
        ]
        let data = try JSONSerialization.data(withJSONObject: jwk, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
        #else
        throw Error.unsupportedPlatform
        #endif
    }

    static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        #if canImport(Security)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw Error.keyGenerationFailed("SecRandomCopyBytes failed with status \(status)")
        }
        #else
        throw Error.unsupportedPlatform
        #endif
        return base64url(Data(bytes))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path . --filter SolidOidcKeyProvisioningTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/SolidOidcKeyProvisioning.swift Sources/AnglesiteCore/Platform/SecretStore.swift Tests/AnglesiteCoreTests/SolidOidcKeyProvisioningTests.swift
git commit -m "feat: provision Solid-OIDC signing key and WebDAV pepper secrets"
```

---

### Task 4: Wire provisioning in `SocialWorkerProvisionCommand.swift`

**Files:**
- Modify: `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`
- Test: `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`

**Interfaces:**
- Consumes: `SolidOidcKeyProvisioning.signingKeyJWK(siteID:secretStore:)` / `.webdavPepper(siteID:secretStore:)` (Task 3), `WorkerComposition.solidPodWorkerID`/`.webdavWorkerID`/`.solidOidcWorkerID` (Task 2), `ProvisionedResources.podBlobsR2BucketName` (Task 2).
- Produces: two new injectable seams, `SolidOidcSigningKeySource`/`WebdavPepperSource` (mirroring the existing `KeyPairSource` seam exactly, for the same reason: tests must not touch the real Keychain, and must control returned values deterministically). A real deploy with `solid-pod`/`webdav`/`solid-oidc` active now provisions the `BLOBS` R2 bucket and pushes `OIDC_SIGNING_KEY`/`WEBDAV_PEPPER` secrets.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`, mirroring `provisionsActivityPub`'s exact fixture shape (fake `runner`, injected key/secret sources, `secretRunner` recording pushed values):

```swift
private let solidOidcWorker = worker(WorkerComposition.solidOidcWorkerID, d1: true, kv: false, r2: false)
private let solidPodWorker = worker(WorkerComposition.solidPodWorkerID, d1: false, kv: false, r2: true)
private let webdavWorker = worker(WorkerComposition.webdavWorkerID, d1: false, kv: false, r2: true)

@Test("provisions solid-pod's own BLOBS bucket, distinct from micropub's MEDIA bucket")
func provisionsSolidPodBlobsBucket() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([
        ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
        ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"id":"kv-id"}}"#, stderr: "", exitCode: 0),
        ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
        ["r2", "bucket", "create", "my-site-pod-blobs"]: .init(stdout: "Created bucket my-site-pod-blobs", stderr: "", exitCode: 0),
        ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
        ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
    ])
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
    )
    let micropubWorker = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
    let indieauthWorker = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
    let webmentionWorker = worker(WorkerComposition.webmentionWorkerID, d1: true, kv: false, r2: false)

    let result = await command.provision(
        siteID: "site-1", siteDirectory: site, siteName: "my-site",
        workers: [indieauthWorker, webmentionWorker, micropubWorker, solidPodWorker]
    )

    guard case .succeeded(_, let resources, _) = result else {
        Issue.record("expected success, got \(result)")
        return
    }
    #expect(resources.r2BucketName == "my-site-media")
    #expect(resources.podBlobsR2BucketName == "my-site-pod-blobs")
    #expect(await recorder.arguments.contains(["r2", "bucket", "create", "my-site-media"]))
    #expect(await recorder.arguments.contains(["r2", "bucket", "create", "my-site-pod-blobs"]))

    let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
    #expect(toml.contains("binding = \"MEDIA\""))
    #expect(toml.contains("binding = \"BLOBS\""))
}

@Test("solid-oidc and webdav push their secrets via the injected key/pepper sources")
func pushesSolidOidcAndWebdavSecrets() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([:])
    var pushedSecrets: [(name: String, value: String)] = []
    let secretRunnerLock = NSLock()
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        solidOidcSigningKeySource: { _ in #"{"kty":"EC","crv":"P-256","x":"X","y":"Y","d":"D"}"# },
        webdavPepperSource: { _ in "PEPPER-VALUE" },
        secretRunner: { _, name, value, _, _ in
            secretRunnerLock.lock()
            pushedSecrets.append((name, value))
            secretRunnerLock.unlock()
            return .init(stdout: "Success!", stderr: "", exitCode: 0)
        },
        deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
    )
    let indieauthWorker = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)

    let result = await command.provision(
        siteID: "site-1", siteDirectory: site, siteName: "my-site",
        workers: [indieauthWorker, solidOidcWorker, solidPodWorker, webdavWorker]
    )

    guard case .succeeded = result else {
        Issue.record("expected success, got \(result)")
        return
    }
    #expect(pushedSecrets.contains { $0.name == "OIDC_SIGNING_KEY" && $0.value.contains("P-256") })
    #expect(pushedSecrets.contains { $0.name == "WEBDAV_PEPPER" && $0.value == "PEPPER-VALUE" })
}

@Test("no solid-oidc/webdav worker means their sources and secret pushes never run")
func noSolidOidcOrWebdavMeansNoSecretPush() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([:])
    var solidOidcSourceCalled = false
    var webdavSourceCalled = false
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        solidOidcSigningKeySource: { _ in
            solidOidcSourceCalled = true
            return "unused"
        },
        webdavPepperSource: { _ in
            webdavSourceCalled = true
            return "unused"
        },
        deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
    )

    _ = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

    #expect(!solidOidcSourceCalled)
    #expect(!webdavSourceCalled)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: FAIL — `solidOidcSigningKeySource`/`webdavPepperSource` init parameters don't exist yet (compile error).

- [ ] **Step 3: Add the two injectable seams**

In `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`, after the `KeyPairSource` typealias (after line 57), add:

```swift
    /// Produces (generating and persisting on first call, per site) the Solid-OIDC OP's ES256
    /// signing key as a JSON private JWK. Defaults to the real Keychain via
    /// `SolidOidcKeyProvisioning`; tests inject a fake to avoid touching the real login keychain
    /// and to control the returned value deterministically — mirrors `KeyPairSource` exactly.
    public typealias SolidOidcSigningKeySource = @Sendable (_ siteID: String) throws -> String
    /// Produces (generating and persisting on first call, per site) `@dwk/webdav`'s app-password
    /// hashing pepper. Defaults to the real Keychain via `SolidOidcKeyProvisioning`; tests inject
    /// a fake, mirroring `KeyPairSource`/`SolidOidcSigningKeySource`.
    public typealias WebdavPepperSource = @Sendable (_ siteID: String) throws -> String
```

Add the corresponding private properties after `private let keyPairSource: KeyPairSource` (line 67):

```swift
    private let solidOidcSigningKeySource: SolidOidcSigningKeySource
    private let webdavPepperSource: WebdavPepperSource
```

Update `init` to accept both (after the `keyPairSource` parameter, line 74):

```swift
    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        runner: @escaping CommandRunner = SocialWorkerProvisionCommand.defaultRunner,
        keyPairSource: @escaping KeyPairSource = SocialWorkerProvisionCommand.defaultKeyPairSource,
        solidOidcSigningKeySource: @escaping SolidOidcSigningKeySource = SocialWorkerProvisionCommand.defaultSolidOidcSigningKeySource,
        webdavPepperSource: @escaping WebdavPepperSource = SocialWorkerProvisionCommand.defaultWebdavPepperSource,
        secretRunner: @escaping SecretRunner = SocialWorkerProvisionCommand.defaultSecretRunner,
        deployer: @escaping Deployer = SocialWorkerProvisionCommand.defaultDeployer
    ) {
        self.tokenSource = tokenSource
        self.runner = runner
        self.keyPairSource = keyPairSource
        self.solidOidcSigningKeySource = solidOidcSigningKeySource
        self.webdavPepperSource = webdavPepperSource
        self.secretRunner = secretRunner
        self.deployer = deployer
    }
```

Add the defaults right after `defaultKeyPairSource` (after line 557):

```swift
    public static let defaultSolidOidcSigningKeySource: SolidOidcSigningKeySource = { siteID in
        try SolidOidcKeyProvisioning.signingKeyJWK(siteID: siteID, secretStore: PlatformSecretStore.make())
    }

    public static let defaultWebdavPepperSource: WebdavPepperSource = { siteID in
        try SolidOidcKeyProvisioning.webdavPepper(siteID: siteID, secretStore: PlatformSecretStore.make())
    }
```

- [ ] **Step 4: Fix the generic R2 provisioning condition and add solid-pod's dedicated bucket**

Replace the generic R2 provisioning block (around line 202-220):

```swift
        if workers.contains(where: { $0.resources.needsR2 }) {
            if resources.r2BucketName == nil {
                let name = "\(siteName)-media"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["r2", "bucket", "create", name],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                if case .failure(let failure) = result {
                    return failure
                }
                resources.r2BucketName = name
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }
```

with (scoped to Micropub specifically, matching `WorkerComposition.swift`'s Task 2 fix — the generic `needsR2` flag also fires for `solid-pod`/`webdav`, which get their own bucket below):

```swift
        if workers.contains(where: { $0.id == WorkerComposition.micropubWorkerID }) {
            if resources.r2BucketName == nil {
                let name = "\(siteName)-media"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["r2", "bucket", "create", name],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                if case .failure(let failure) = result {
                    return failure
                }
                resources.r2BucketName = name
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }

        let hasSolidPodOrWebdav = workers.contains(where: {
            $0.id == WorkerComposition.solidPodWorkerID || $0.id == WorkerComposition.webdavWorkerID
        })
        if hasSolidPodOrWebdav {
            if resources.podBlobsR2BucketName == nil {
                let name = "\(siteName)-pod-blobs"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["r2", "bucket", "create", name],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                if case .failure(let failure) = result {
                    return failure
                }
                resources.podBlobsR2BucketName = name
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }
```

- [ ] **Step 5: Push the Solid-OIDC and WebDAV secrets**

After the `hasActivityPub` key-push block (after line 254, before the `hasWebmentionReceive` section), add:

```swift
        let hasSolidOidc = workers.contains(where: { $0.id == WorkerComposition.solidOidcWorkerID })
        if hasSolidOidc {
            let signingKeyJWK: String
            do {
                signingKeyJWK = try solidOidcSigningKeySource(siteID)
            } catch {
                return .failed(reason: "couldn't prepare Solid-OIDC signing key: \(error)", exitCode: nil, resources: resources)
            }
            do {
                let secretResult = try await secretRunner(siteDirectory, "OIDC_SIGNING_KEY", signingKeyJWK, environment, source)
                guard secretResult.exitCode == 0 else {
                    let output = secretResult.stdout.isEmpty ? secretResult.stderr : secretResult.stdout
                    return .failed(reason: "couldn't push OIDC_SIGNING_KEY: \(output)", exitCode: secretResult.exitCode, resources: resources)
                }
            } catch {
                return .failed(reason: "couldn't push OIDC_SIGNING_KEY: \(error)", exitCode: nil, resources: resources)
            }
        }

        let hasWebdav = workers.contains(where: { $0.id == WorkerComposition.webdavWorkerID })
        if hasWebdav {
            let pepper: String
            do {
                pepper = try webdavPepperSource(siteID)
            } catch {
                return .failed(reason: "couldn't prepare WebDAV pepper: \(error)", exitCode: nil, resources: resources)
            }
            do {
                let secretResult = try await secretRunner(siteDirectory, "WEBDAV_PEPPER", pepper, environment, source)
                guard secretResult.exitCode == 0 else {
                    let output = secretResult.stdout.isEmpty ? secretResult.stderr : secretResult.stdout
                    return .failed(reason: "couldn't push WEBDAV_PEPPER: \(output)", exitCode: secretResult.exitCode, resources: resources)
                }
            } catch {
                return .failed(reason: "couldn't push WEBDAV_PEPPER: \(error)", exitCode: nil, resources: resources)
            }
        }
```

This mirrors the `hasActivityPub`/`keyPairSource` block immediately above it exactly, using the two seams added in Step 3 instead of calling `SolidOidcKeyProvisioning` (or any concrete secret store) directly.

- [ ] **Step 6: Run tests to verify they pass**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: PASS. Also run the full suite once to check nothing else regressed:

Run: `swift test --package-path .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift
git commit -m "feat: provision solid-pod's R2 bucket and push solid-oidc/webdav secrets"
```

---

### Task 5: `worker.ts` — Solid-OIDC identity endpoint + consent bridge

**Files:**
- Modify: `Resources/Template/worker/worker.ts`
- Test: `Resources/Template/worker/worker.test.ts`

**Interfaces:**
- Consumes: `INDIEAUTH_OWNER_PASSWORD`/`TOKEN_SIGNING_KEY` (existing `WorkerEnv` fields), `deriveKey`/`base64url`/`decodeBase64url` (existing private helpers in this file — reuse, don't duplicate).
- Produces: `WorkerEnv.OIDC_SIGNING_KEY?: string`; `handleSolidOidc`, `handleSolidOidcConsent`, `createSolidOidcConsentToken`, `verifySolidOidcConsentToken` (exported for the test file); four new `ROUTES` entries. Task 6 imports nothing from this task directly (solid-pod's config independently needs `${baseUrl}/oidc/jwks` as a URL string, not a function call).

- [ ] **Step 1: Write the failing tests**

Add to `Resources/Template/worker/worker.test.ts` (near the existing IndieAuth consent tests — read that section first to match its exact fixture-env-building helper before writing these):

```typescript
import { createSolidOidcConsentToken, verifySolidOidcConsentToken, handleSolidOidc, handleSolidOidcConsent } from "./worker";

test("createSolidOidcConsentToken / verifySolidOidcConsentToken: round-trips a webid within the TTL", async () => {
  const token = await createSolidOidcConsentToken("https://example.com/profile/card#me", "signing-key", 1000);
  const webid = await verifySolidOidcConsentToken(token, "signing-key", 1050);
  expect(webid).toBe("https://example.com/profile/card#me");
});

test("verifySolidOidcConsentToken: rejects an expired token", async () => {
  const token = await createSolidOidcConsentToken("https://example.com/profile/card#me", "signing-key", 1000);
  const webid = await verifySolidOidcConsentToken(token, "signing-key", 10_000);
  expect(webid).toBeNull();
});

test("verifySolidOidcConsentToken: rejects a token signed with a different key", async () => {
  const token = await createSolidOidcConsentToken("https://example.com/profile/card#me", "signing-key", 1000);
  const webid = await verifySolidOidcConsentToken(token, "wrong-key", 1050);
  expect(webid).toBeNull();
});

test("handleSolidOidc: 503s when OIDC_SIGNING_KEY is unbound", async () => {
  const request = new Request("https://example.com/oidc/jwks");
  const response = await handleSolidOidc(request, { ...testEnv, OIDC_SIGNING_KEY: undefined }, createExecutionContext());
  expect(response.status).toBe(503);
});

test("handleSolidOidcConsent: rejects the wrong owner password", async () => {
  const body = new URLSearchParams({ password: "wrong", webid: "https://example.com/profile/card#me" });
  const request = new Request("https://example.com/oidc/consent", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const response = await handleSolidOidcConsent(request, testEnv);
  expect(response.status).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `Resources/Template/`): `npm test -- worker.test.ts`
Expected: FAIL — `createSolidOidcConsentToken`/`verifySolidOidcConsentToken`/`handleSolidOidc`/`handleSolidOidcConsent` aren't exported yet.

- [ ] **Step 3: Add the `OIDC_SIGNING_KEY` env field**

In `Resources/Template/worker/worker.ts`, in the `WorkerEnv` interface, after the ActivityPub fields block (after `AP_DISPLAY_NAME?: string;`), add:

```typescript
  /**
   * Solid-OIDC signing key (V-storage, identity layer for `@dwk/solid-pod`). Optional: a site
   * that hasn't provisioned Solid-OIDC has none of it bound, and every `/oidc/*` route degrades
   * to 503 rather than letting `@dwk/solid-oidc` throw its own loud startup error. A JSON-
   * serialized private EC P-256 JWK (RFC 7518 §6.2.2) — see
   * `SolidOidcKeyProvisioning.signingKeyJWK` (Swift) for generation, and
   * `WorkerComposition.generateWranglerToml` for the binding.
   */
  OIDC_SIGNING_KEY?: string;
```

Add the import at the top of the file, alongside the other `@dwk/*` imports:

```typescript
import {
  createSolidOidc,
  type SolidOidcEnv,
} from "@dwk/solid-oidc";
```

- [ ] **Step 4: Implement the consent-token bridge**

`@dwk/indieauth`'s existing consent bridge (`createConsentToken`/`verifyConsentToken`/`deriveKey`, defined earlier in this file) is typed to indieauth's own `AuthorizationRequest` shape and can't be reused directly for Solid-OIDC's differently-shaped authorization request. Add a parallel, smaller pair right after `verifyConsentToken`'s definition, reusing the same `deriveKey`/`base64url`/`decodeBase64url` helpers already in this file:

```typescript
interface SolidOidcConsentGrant {
  v: 1;
  exp: number;
  webid: string;
}

function isSolidOidcConsentGrant(value: unknown): value is SolidOidcConsentGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  return grant.v === 1 && typeof grant.exp === "number" && typeof grant.webid === "string";
}

/**
 * Signs a short-lived proof that the site owner approved a Solid-OIDC authorization request for
 * `webid` — the same "owner password gates this" bridge `@dwk/indieauth`'s consent flow uses,
 * adapted for Solid-OIDC's own (differently-shaped) `approveAuthorization` hook. Reuses this
 * file's `deriveKey`/HKDF pattern with its own purpose string so the two consent tokens' derived
 * keys are independent even though both start from `TOKEN_SIGNING_KEY`.
 */
export async function createSolidOidcConsentToken(
  webid: string,
  signingKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const grant: SolidOidcConsentGrant = { v: 1, exp: now + CONSENT_TTL_SECONDS, webid };
  const payload = new TextEncoder().encode(JSON.stringify(grant));
  const signature = await crypto.subtle.sign("HMAC", await deriveKey(signingKey, "solid-oidc-consent-token"), payload);
  return `${base64url(payload)}.${base64url(new Uint8Array(signature))}`;
}

/** Verifies a token from `createSolidOidcConsentToken`, returning the approved `webid` or `null`. */
export async function verifySolidOidcConsentToken(
  token: string,
  signingKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (token.length > 8_192) return null;
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) return null;
  const payloadBytes = decodeBase64url(payloadSegment);
  const signatureBytes = decodeBase64url(signatureSegment);
  if (!payloadBytes || !signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await deriveKey(signingKey, "solid-oidc-consent-token"),
    signatureBytes,
    payloadBytes,
  );
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isSolidOidcConsentGrant(parsed) || parsed.exp < now) return null;
  return parsed.webid;
}
```

- [ ] **Step 5: Implement `handleSolidOidcConsent`, the config builder, and `handleSolidOidc`**

Right after the new consent-token functions, add:

```typescript
/**
 * Solid-OIDC's login/consent bridge — reuses the exact same owner-password check
 * `handleIndieAuthConsent` gates on (`secretsMatch` against `INDIEAUTH_OWNER_PASSWORD`), so the
 * pod's owner authenticates with the same one credential IndieAuth already uses. On success,
 * redirects back to `/oidc/authorize` with a signed consent token `approveAuthorization` (below)
 * verifies — mirroring `handleIndieAuthConsent`'s redirect-with-a-signed-token shape, adapted for
 * Solid-OIDC's simpler (webid-only) grant.
 */
export async function handleSolidOidcConsent(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  if (!env.INDIEAUTH_OWNER_PASSWORD || !env.TOKEN_SIGNING_KEY) {
    return new Response("Solid-OIDC secrets are not configured", { status: 503 });
  }
  if (await isConsentRateLimited(request, env)) return new Response("Too Many Requests", { status: 429 });
  const form = await readBoundedForm(request);
  if (!form) return new Response("Invalid consent form", { status: 400 });
  if (!(await secretsMatch(form.get("password") ?? "", env.INDIEAUTH_OWNER_PASSWORD, env.TOKEN_SIGNING_KEY))) {
    console.warn(JSON.stringify({ event: "solid_oidc.consent_rejected", reason: "password_invalid" }));
    return new Response("Invalid site owner password", { status: 401 });
  }
  const webid = form.get("webid") ?? "";
  const origin = new URL(request.url).origin;
  const authorize = new URL("/oidc/authorize", origin);
  for (const name of ["client_id", "redirect_uri", "state", "response_type", "code_challenge", "code_challenge_method", "scope"]) {
    const value = form.get(name);
    if (value !== null) authorize.searchParams.set(name, value);
  }
  authorize.searchParams.set("consent", await createSolidOidcConsentToken(webid, env.TOKEN_SIGNING_KEY));
  return Response.redirect(authorize.toString(), 303);
}

function solidOidcConfig(request: Request, env: WorkerEnv) {
  if (!env.OIDC_SIGNING_KEY || !env.INDIEAUTH_OWNER_PASSWORD || !env.TOKEN_SIGNING_KEY) return null;
  let signingKey: object;
  try {
    signingKey = JSON.parse(env.OIDC_SIGNING_KEY);
  } catch {
    return null;
  }
  const baseUrl = new URL(request.url).origin;
  const webid = `${baseUrl}/profile/card#me`;
  return {
    issuer: baseUrl,
    signingKey,
    mountPath: "/oidc",
    audience: ["solid", baseUrl],
    async approveAuthorization(_req: unknown, httpRequest: Request) {
      const consent = new URL(httpRequest.url).searchParams.get("consent");
      if (consent) {
        const approvedWebid = await verifySolidOidcConsentToken(consent, env.TOKEN_SIGNING_KEY!);
        if (approvedWebid === webid) {
          return { webid };
        }
      }
      // No (or invalid/expired) consent proof yet — render the same owner-password prompt
      // `handleIndieAuthConsent`'s form posts to, targeting `/oidc/consent` instead.
      const params = new URLSearchParams(new URL(httpRequest.url).search);
      const fields = ["client_id", "redirect_uri", "state", "response_type", "code_challenge", "code_challenge_method", "scope"]
        .map((name) => {
          const value = params.get(name);
          return value !== null ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}">` : "";
        })
        .join("");
      return new Response(
        `<!doctype html><form method="post" action="/oidc/consent">${fields}` +
          `<input type="hidden" name="webid" value="${escapeHtml(webid)}">` +
          `<input type="password" name="password" placeholder="Site owner password" required>` +
          `<button type="submit">Approve</button></form>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  };
}

/**
 * Solid-OIDC OpenID Provider (identity layer for `@dwk/solid-pod`). Returns 503 when it isn't
 * fully provisioned (`OIDC_SIGNING_KEY` unbound, or the shared `INDIEAUTH_OWNER_PASSWORD`/
 * `TOKEN_SIGNING_KEY` secrets absent) rather than letting `@dwk/solid-oidc` throw its own loud
 * startup error, matching every other composed handler in this file.
 */
export function handleSolidOidc(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = solidOidcConfig(request, env);
  if (!config) {
    return Promise.resolve(new Response("Solid-OIDC is not configured", { status: 503 }));
  }
  const solidOidc = createSolidOidc(config as Parameters<typeof createSolidOidc>[0]);
  return Promise.resolve(solidOidc(request, env as unknown as SolidOidcEnv, ctx));
}
```

Add a small `escapeHtml` helper near the other small string helpers (`base64url`, `decodeBase64url`) if this file doesn't already have one — search first (`grep -n "escapeHtml" worker.ts`); if absent, add:

```typescript
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

- [ ] **Step 6: Add the four `ROUTES` entries**

In the `ROUTES` array, add (near the other `.well-known` and IndieAuth entries):

```typescript
  {
    path: "/.well-known/openid-configuration",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleSolidOidc(request, env, ctx),
  },
  {
    path: "/oidc/jwks",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleSolidOidc(request, env, ctx),
  },
  {
    path: "/oidc/authorize",
    match: "exact",
    methods: ["GET"],
    handler: (request, env, ctx) => handleSolidOidc(request, env, ctx),
  },
  {
    path: "/oidc/token",
    match: "exact",
    methods: ["POST"],
    handler: (request, env, ctx) => handleSolidOidc(request, env, ctx),
  },
  {
    path: "/oidc/consent",
    match: "exact",
    methods: ["POST"],
    handler: (request, env) => handleSolidOidcConsent(request, env),
  },
```

- [ ] **Step 7: Run tests, lint, and typecheck**

Run (from `Resources/Template/`): `npm run lint && npm run typecheck && npm test -- worker.test.ts`
Expected: PASS. Fix any type mismatch against the actual `@dwk/solid-oidc` exported types (`SolidOidcEnv`, `createSolidOidc`'s config parameter shape) surfaced by `typecheck` — the config shape above is built from the package's published README, so a real signature difference here is expected friction, not a plan defect; adjust field names/types to match what `tsc` reports.

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/worker/worker.ts Resources/Template/worker/worker.test.ts
git commit -m "feat: compose Solid-OIDC identity endpoint into the site Worker"
```

---

### Task 6: `worker.ts` — Solid Pod + WebDAV dispatch

**Files:**
- Modify: `Resources/Template/worker/worker.ts`
- Test: `Resources/Template/worker/worker.test.ts`

**Interfaces:**
- Consumes: `handleSolidOidc`'s `/oidc/jwks` route (Task 5, indirectly — solid-pod's config trusts this same origin's issuer/JWKS, no direct function call needed since it's just a URL).
- Produces: `WorkerEnv.POD?`, `.BLOBS?`, `.WEBDAV_PEPPER?`; `handleSolidPod`, `handleWebdav`, `handleWebdavCredentials`, `handleSolidPodGcScheduled`; `SolidPodObject` re-export; five new `ROUTES` entries; extended `scheduled()` dispatch.

- [ ] **Step 1: Write the failing tests**

Add to `Resources/Template/worker/worker.test.ts`:

```typescript
import { handleSolidPod, handleWebdav, handleWebdavCredentials } from "./worker";

test("handleSolidPod: 503s when POD/BLOBS are unbound", async () => {
  const request = new Request("https://example.com/pod/");
  const response = await handleSolidPod(request, { ...testEnv, POD: undefined, BLOBS: undefined }, createExecutionContext());
  expect(response.status).toBe(503);
});

test("handleWebdav: 503s when WEBDAV_PEPPER is unbound", async () => {
  const request = new Request("https://example.com/dav/");
  const response = await handleWebdav(request, { ...testEnv, WEBDAV_PEPPER: undefined }, createExecutionContext());
  expect(response.status).toBe(503);
});

test("handleWebdavCredentials: 503s when WEBDAV_PEPPER is unbound", async () => {
  const request = new Request("https://example.com/dav-credentials", { method: "GET" });
  const response = await handleWebdavCredentials(request, { ...testEnv, WEBDAV_PEPPER: undefined }, createExecutionContext());
  expect(response.status).toBe(503);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `Resources/Template/`): `npm test -- worker.test.ts`
Expected: FAIL — `handleSolidPod`/`handleWebdav`/`handleWebdavCredentials` aren't exported yet.

- [ ] **Step 3: Add the env fields and imports**

In the `WorkerEnv` interface, after `OIDC_SIGNING_KEY?: string;` (added in Task 5), add:

```typescript
  /**
   * Solid Pod bindings (V-storage). All optional: a site that hasn't provisioned solid-pod has
   * none of them bound, and every `/pod`/`/dav`/`/dav-credentials` route degrades to 503 rather
   * than letting `@dwk/solid-pod` throw its own loud startup error. `POD` is the per-pod Durable
   * Object namespace the package ships (`SolidPodObject`, re-exported below so wrangler can bind
   * it); `BLOBS` is its R2 bucket for oversized/binary bodies. See
   * `WorkerComposition.generateWranglerToml` (Swift) for the binding generation.
   */
  POD?: DurableObjectNamespace<SolidPodObject>;
  BLOBS?: R2Bucket;
  /**
   * `@dwk/webdav`'s app-password hashing pepper. Optional: a site with solid-pod active but not
   * webdav has this unbound, and `/dav`/`/dav-credentials` degrade to 503.
   */
  WEBDAV_PEPPER?: string;
```

Extend the `@dwk/solid-pod` import (introduced conceptually alongside solid-oidc's, but solid-pod is a separate package):

```typescript
import {
  createSolidPod,
  createSolidPodGc,
  createSolidPodWebdav,
  createSolidPodWebdavCredentials,
  SolidPodObject,
  type SolidPodEnv,
} from "@dwk/solid-pod";
```

Re-export the Durable Object class, alongside the existing `ActivityPubObject` re-export:

```typescript
export { SolidPodObject };
```

- [ ] **Step 4: Implement the config builder and handlers**

Add, near `activityPubConfig`/`handleActivityPub`:

```typescript
function solidPodConfig(request: Request, env: WorkerEnv) {
  if (!env.POD || !env.BLOBS) return null;
  const baseUrl = new URL(request.url).origin;
  return {
    baseUrl,
    issuer: baseUrl,
    jwksUri: `${baseUrl}/oidc/jwks`,
    owner: `${baseUrl}/profile/card#me`,
  };
}

/**
 * Solid Pod (identity storage layer). Returns 503 when it isn't fully provisioned (`POD`/`BLOBS`
 * unbound) rather than letting `@dwk/solid-pod` throw its own loud startup error, matching every
 * other composed handler in this file.
 */
export function handleSolidPod(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = solidPodConfig(request, env);
  if (!config) {
    return Promise.resolve(new Response("Solid Pod is not configured", { status: 503 }));
  }
  const pod = createSolidPod(config);
  return Promise.resolve(pod(request, env as unknown as SolidPodEnv, ctx));
}

/**
 * WebDAV façade over the same Solid Pod (RFC 4918 Class 2 — mount as a network drive). Returns
 * 503 when solid-pod isn't provisioned or `WEBDAV_PEPPER` is unbound, matching every other
 * composed handler in this file.
 */
export function handleWebdav(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = solidPodConfig(request, env);
  if (!config || !env.WEBDAV_PEPPER) {
    return Promise.resolve(new Response("WebDAV is not configured", { status: 503 }));
  }
  const webdav = createSolidPodWebdav({ ...config, pepper: env.WEBDAV_PEPPER });
  return Promise.resolve(webdav(request, env as unknown as SolidPodEnv, ctx));
}

/** Owner-gated WebDAV app-password mint/list/revoke endpoint (`/dav-credentials`). */
export function handleWebdavCredentials(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = solidPodConfig(request, env);
  if (!config || !env.WEBDAV_PEPPER) {
    return Promise.resolve(new Response("WebDAV is not configured", { status: 503 }));
  }
  const credentials = createSolidPodWebdavCredentials({ ...config, pepper: env.WEBDAV_PEPPER });
  return Promise.resolve(credentials(request, env as unknown as SolidPodEnv, ctx));
}

/** Solid Pod's R2 garbage-collection Cron Trigger — reclaims blobs orphaned by copy-on-write. */
function handleSolidPodGcScheduled(
  controller: ScheduledController,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const baseUrl = env.SITE_URL ?? "https://example.invalid";
  if (!env.BLOBS) return Promise.resolve();
  const gc = createSolidPodGc({ baseUrl, gcSafetyWindowMs: 300_000 });
  return Promise.resolve(gc(controller, env as unknown as SolidPodEnv, ctx));
}
```

(Field names on the `config`/`createSolidPodWebdav`/`createSolidPodWebdavCredentials` config objects — `pepper`, `gcSafetyWindowMs`, etc. — are drawn from the packages' published READMEs; Step 6's `typecheck` run is what catches any real drift from those docs, same posture as Task 5 Step 7.)

- [ ] **Step 5: Add the `ROUTES` entries and extend `scheduled()`**

In the `ROUTES` array:

```typescript
  {
    path: "/pod",
    match: "prefix",
    methods: ["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    handler: (request, env, ctx) => handleSolidPod(request, env, ctx),
  },
  {
    path: "/dav",
    match: "prefix",
    methods: ["GET", "PUT", "DELETE", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "OPTIONS", "HEAD"],
    handler: (request, env, ctx) => handleWebdav(request, env, ctx),
  },
  {
    path: "/dav-credentials",
    match: "exact",
    methods: ["GET", "POST", "DELETE"],
    handler: (request, env, ctx) => handleWebdavCredentials(request, env, ctx),
  },
```

(No separate exact `/pod` or `/dav` entries — a single `prefix` entry already matches the bare path too, per `matchRoute`'s `pathname === route.path` check; this mirrors the fix this plan is asking upstream to make to `catalog.json` itself, see "Upstream dependency" above.)

Replace the `scheduled()` handler's body:

```typescript
  async scheduled(
    controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    return handleMicrosubScheduled(controller, env, ctx);
  },
```

with (dispatch by `controller.cron`, mirroring how `queue()` dispatches on the queue-name suffix):

```typescript
  async scheduled(
    controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === "*/5 * * * *") {
      return handleSolidPodGcScheduled(controller, env, ctx);
    }
    return handleMicrosubScheduled(controller, env, ctx);
  },
```

- [ ] **Step 6: Run tests, lint, and typecheck**

Run (from `Resources/Template/`): `npm run lint && npm run typecheck && npm test`
Expected: PASS. As in Task 5 Step 7, fix any real type/field-name drift from `@dwk/solid-pod`'s/`@dwk/webdav`'s actual exported signatures that `tsc` surfaces.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/worker/worker.ts Resources/Template/worker/worker.test.ts
git commit -m "feat: compose Solid Pod and WebDAV dispatch into the site Worker"
```

---

### Task 7: Conformance advisory — add the `.storage` phase

**Files:**
- Modify: `Sources/AnglesiteCore/WorkersConformance.swift`
- Modify: `Sources/AnglesiteCore/WorkerActivation.swift`
- Modify: `Tests/AnglesiteCoreTests/WorkerActivationTests.swift:175` (existing test needs a fixture fix — see Step 1)
- Test: `Tests/AnglesiteCoreTests/WorkersConformanceTests.swift`, `Tests/AnglesiteCoreTests/WorkerActivationTests.swift`

**Interfaces:**
- Consumes: `WorkersConformanceStatus.gateStatus(for:)` (existing).
- Produces: `WorkersConformanceStatus.Phase.storage` case; `WorkerActivation.conformanceAdvisory` now also reports on it.

- [ ] **Step 1: Fix the now-stale existing test first**

`Tests/AnglesiteCoreTests/WorkerActivationTests.swift:175` currently asserts `conformanceAdvisory(activeIDs: ["solid-pod"], ...) == nil` specifically *because* `"solid-pod"` isn't in any phase's requirements yet. Once `.storage` is added (Step 3), that stops being true, and this test would start failing for the wrong reason. Fix it now, before adding the phase:

Change:

```swift
    @Test("conformanceAdvisory is nil when nothing phase-gated is active")
    func advisoryNilWithoutRelevantWorkers() {
        let status = WorkersConformanceStatus(packages: [:])
        #expect(WorkerActivation.conformanceAdvisory(activeIDs: ["solid-pod"], conformance: status) == nil)
    }
```

to:

```swift
    @Test("conformanceAdvisory is nil when nothing phase-gated is active")
    func advisoryNilWithoutRelevantWorkers() {
        let status = WorkersConformanceStatus(packages: [:])
        // "solid-pod" is deliberately not used here anymore — it's phase-gated (.storage) as of
        // this test file's own change; "remotestorage" is a real catalog id with no phase mapping.
        #expect(WorkerActivation.conformanceAdvisory(activeIDs: ["remotestorage"], conformance: status) == nil)
    }
```

Run: `swift test --package-path . --filter WorkerActivationTests`
Expected: PASS (this fix alone doesn't depend on Step 3 yet — `"remotestorage"` isn't phase-gated either before or after).

- [ ] **Step 2: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/WorkersConformanceTests.swift`:

```swift
    @Test("gateStatus reports storage blocked when webdav is pending, unblocked when both pass")
    func storagePhaseGate() throws {
        let pendingJSON = """
        {
          "packages": {
            "@dwk/webdav": {
              "standard": "WebDAV", "suites": { "litmus": { "status": "failing" } },
              "integration": { "status": "pending", "cases": [] }
            },
            "@dwk/solid-pod": {
              "standard": "Solid Protocol", "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let pendingStatus = try WorkersConformanceReader.parse(pendingJSON)
        let blockedGate = pendingStatus.gateStatus(for: .storage)
        #expect(blockedGate.blocked.contains("@dwk/webdav"))
        #expect(blockedGate.ready.contains("@dwk/solid-pod"))
        #expect(!blockedGate.isUnblocked)

        let passingJSON = """
        {
          "packages": {
            "@dwk/webdav": {
              "standard": "WebDAV", "suites": { "litmus": { "status": "passing" } },
              "integration": { "status": "passing", "cases": [] }
            },
            "@dwk/solid-pod": {
              "standard": "Solid Protocol", "suites": {},
              "integration": { "status": "passing", "cases": [] }
            }
          }
        }
        """.data(using: .utf8)!
        let passingStatus = try WorkersConformanceReader.parse(passingJSON)
        #expect(passingStatus.gateStatus(for: .storage).isUnblocked)
    }
```

Add to `Tests/AnglesiteCoreTests/WorkerActivationTests.swift`:

```swift
    @Test("conformanceAdvisory reports blocked storage packages when webdav is active and pending")
    func advisoryReportsStorageBlocked() {
        let status = try! WorkersConformanceReader.parse("""
        { "packages": { "@dwk/webdav": { "standard": "WebDAV", "suites": {}, "integration": { "status": "pending" } } } }
        """.data(using: .utf8)!)
        let advisory = WorkerActivation.conformanceAdvisory(activeIDs: ["webdav"], conformance: status)
        #expect(advisory != nil)
        #expect(advisory!.contains("@dwk/webdav"))
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `swift test --package-path . --filter WorkersConformanceTests --filter WorkerActivationTests`
Expected: FAIL — `.storage` case doesn't exist yet (compile error).

- [ ] **Step 4: Add the `.storage` phase**

In `Sources/AnglesiteCore/WorkersConformance.swift`, in `WorkersConformanceStatus.Phase`, add after `.v4`:

```swift
        /// Storage: Solid Pod + its WebDAV façade (not part of the V-2/V-3/V-4 social-phase
        /// numbering — a separate "storage" vertical, gated the same way).
        case storage
```

In `phaseRequirements`, add:

```swift
        .storage: ["@dwk/solid-pod", "@dwk/webdav"],
```

- [ ] **Step 5: Extend `conformanceAdvisory`'s phase loop**

In `Sources/AnglesiteCore/WorkerActivation.swift`, change:

```swift
        for phase in [WorkersConformanceStatus.Phase.v2, .v3, .v4] {
```

to:

```swift
        for phase in [WorkersConformanceStatus.Phase.v2, .v3, .v4, .storage] {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `swift test --package-path .`
Expected: PASS (full suite — this touches a shared enum other tests may switch over exhaustively; a non-exhaustive `switch` elsewhere would fail to compile, which is exactly what a full-suite run catches).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/WorkersConformance.swift Sources/AnglesiteCore/WorkerActivation.swift Tests/AnglesiteCoreTests/WorkersConformanceTests.swift Tests/AnglesiteCoreTests/WorkerActivationTests.swift
git commit -m "feat: add a storage conformance phase for solid-pod/webdav"
```

---

### Task 8: Design doc addendum (documentation only)

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-solid-pod-webdav-support-design.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Record the duplicate-claim finding and finalize the catalog coordination list**

In the design doc's "§1. Identity & consent" catalog-data paragraph, after the existing `solid-oidc.requires`/`solid-pod.requires` note, append:

```markdown
A third catalog fix is needed, found during implementation: `solid-pod`/`webdav`'s current
`catalog.json` entries each declare both an exact claim (`/pod`, `/dav`) and a prefix claim
(`/pod/`, `/dav/`) for the same base path. `WorkerRouteClaims.activeClaims`'s duplicate-claim
check groups by normalized path, and both entries normalize to the same path from the same
owner — this throws `duplicateClaim`, not a validation pass. The prefix claim alone already
covers the bare path (`runWorkerFirstPatterns` inserts `claim.path` unconditionally, prefix or
not), so the fix is to drop the redundant exact claims, keeping only the prefix ones. See
`WorkerRouteClaimsTests.sameOwnerExactPlusPrefixCollide` for a regression test against the
current (unfixed) shape.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-solid-pod-webdav-support-design.md
git commit -m "docs: record the duplicate-claim catalog finding in the solid-pod/webdav spec"
```

---

## Final verification

- [ ] Run the full Swift suite: `swift test --package-path .` — expect PASS.
- [ ] Run the full template suite (from `Resources/Template/`): `npm run lint && npm run typecheck && npm test` — expect PASS.
- [ ] Run `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` — expect a clean build (per CONTRIBUTING.md's testing section).
- [ ] Confirm the three upstream `catalog.json` edits are tracked somewhere reachable at PR time (an issue, or a note in the PR body per CONTRIBUTING.md's "@dwk/workers catalog coordination" precedent): `solid-oidc.requires: ["indieauth"]`, `solid-pod.requires: ["solid-oidc"]`, and dropping the redundant exact `/pod`/`/dav` claims.
- [ ] When opening the PR, follow CONTRIBUTING.md's "Commits and pull requests" section exactly — the `.github/PULL_REQUEST_TEMPLATE.md` headings (Summary, Paired PR check, Test plan), noting in "Paired PR check" that this consumes already-published npm packages (no paired sidecar PR needed) but *does* depend on the three `davidwkeith/workers` catalog.json data edits above landing before this feature is fully activatable end-to-end.
