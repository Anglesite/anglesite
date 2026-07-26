# V-4.1 ActivityPub Actor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose `@dwk/activitypub` into the per-site Worker so a site becomes a followable Fediverse actor — a Mastodon user can follow it and see posts published through Micropub.

**Architecture:** Follows the exact composition precedent `indieauth`/`webmention`/`micropub` already established in `WorkerComposition.swift` (bespoke id-keyed binding blocks, since a package's binding names are part of its public contract) and `worker.ts` (a declarative `ROUTES` table dispatching to per-worker handlers). The one genuinely new piece is Durable Object binding generation (first DO-backed catalog worker) and app-generated secret material (an RSA keypair + a random publish token), provisioned once per site and persisted in Keychain, pushed to Cloudflare via a small in-guest shell script that reads them from the container exec's `environment` (never argv).

**Tech Stack:** Swift 6.4 (AnglesiteCore), TypeScript (Cloudflare Workers, `@dwk/activitypub` 0.1.0-beta.5+), Vitest + `@cloudflare/vitest-pool-workers` (miniflare), Swift Testing, `openssl` CLI (test-only PEM verification).

## Global Constraints

- Spec: [`docs/superpowers/specs/2026-07-23-activitypub-actor-design.md`](../specs/2026-07-23-activitypub-actor-design.md) — read it before starting; this plan implements it section by section.
- Fixed single actor per site: username `"site"`, no new Settings UI for identity or activation (the existing generic Workers-tab toggle already covers `settingsActivated` workers).
- `AP_PUBLISH_TOKEN` and the RSA keypair must be app-generated, random, per-site secrets — never hardcoded constants (a hardcoded token in the shipped open-source template would let anyone forge posts into any site's outbox).
- `@dwk/activitypub`'s shared inbox must be disabled (`sharedInbox: false`) — its default `/inbox` route collides with the existing inbox-capture feature (#587).
- Every new/changed Swift file needs `swift test --package-path .` passing; every `worker.ts`/`vitest.config.ts` change needs `npm test` (from `Resources/Template/`) passing. Run `xcodegen generate` first if `Anglesite.xcodeproj` is stale (gitignored, generated from `project.yml`).
- TDD: write the failing test before the implementation in every task below.
- Out of scope (do not implement): WebFinger (#364), follower management UI, Microsub reader, syncing pre-existing Astro content into the outbox (#926).

---

### Task 1: `WorkerCatalog` — lock in durable-object resource decoding

The `activitypub` catalog entry is the first published worker with a `durable-object` resource type. `WorkerDescriptor.Resources`'s decoder already silently ignores unknown types (only `d1`/`kv`/`r2` map to flags — see `Sources/AnglesiteCore/WorkerCatalog.swift:121-134`), so no source change is needed here — this task only locks in that behavior with an explicit test, so a future decoder change can't regress it unnoticed.

**Files:**
- Test: `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift`

**Interfaces:**
- Consumes: `WorkerCatalogReader.parse(_:)`, `WorkerDescriptor.Resources` (existing, `Sources/AnglesiteCore/WorkerCatalog.swift`).
- Produces: nothing new — test-only task.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift`, near the existing `"decodes the typed-array resources shape catalog.json now publishes"` test (around line 43):

```swift
@Test("a durable-object resource entry decodes without throwing and sets no D1/KV/R2 flag")
func decodesDurableObjectResourceEntry() throws {
    let json = """
    {
        "id": "activitypub",
        "displayName": "Fediverse",
        "description": "Make this site a Fediverse actor",
        "group": "social",
        "binding": { "kind": "settingsActivated" },
        "resources": [
            { "type": "durable-object", "binding": "ACTOR", "className": "ActivityPubObject", "sqlite": true }
        ]
    }
    """
    let workers = try WorkerCatalogReader.parse(Data("{\"workers\":[\(json)]}".utf8))
    let activitypub = try #require(workers.first)
    #expect(activitypub.resources.needsD1 == false)
    #expect(activitypub.resources.needsKV == false)
    #expect(activitypub.resources.needsR2 == false)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter WorkerCatalogTests/decodesDurableObjectResourceEntry`
Expected: this specific test should actually **pass already** (the decoder already ignores unknown types) — confirm with `-v` that it ran and passed, not skipped. If it fails, the decoder has a stricter mode than assumed; stop and re-read `WorkerCatalog.swift:121-141` before continuing.

- [ ] **Step 3: No implementation needed**

The decoder's existing `default: break` branch (`WorkerCatalog.swift:129`) already handles this. Nothing to write.

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter WorkerCatalogTests/decodesDurableObjectResourceEntry`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Tests/AnglesiteCoreTests/WorkerCatalogTests.swift
git commit -m "test(#363): lock in durable-object resource decoding"
```

---

### Task 2: `WorkerComposition` — Durable Object binding + migration, display-name var

**Files:**
- Modify: `Sources/AnglesiteCore/WorkerComposition.swift`
- Test: `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`

**Interfaces:**
- Consumes: `WorkerDescriptor` (Task 1's type, unchanged).
- Produces: `WorkerComposition.activitypubWorkerID: String` (constant `"activitypub"`), and a new `displayName: String? = nil` parameter on `WorkerComposition.generateWranglerToml(...)` — later tasks (5, 7) pass this through from `SiteSettings.displayName`.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift`, near the existing Micropub tests (around line 243-270):

```swift
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
        displayName: "Alice's Blog", siteURL: "https://example.com"
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: FAIL — `activitypubWorkerID` doesn't exist yet (compile error), and no `displayName` parameter exists on `generateWranglerToml`.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/WorkerComposition.swift`, add the new worker-id constant near `micropubWorkerID` (after line 40):

```swift
    /// `@dwk/activitypub`'s catalog id — like `webmentionWorkerID`/`micropubWorkerID`, composition
    /// keys off this directly for the actor's bespoke `ACTOR` Durable Object binding, since the
    /// binding name and class name (`ActivityPubObject`) are part of `@dwk/activitypub`'s public
    /// composition contract (its README documents the exact `durable_objects`/`migrations` shape),
    /// not something the generic `resources` flags (`needsD1`/`needsKV`/`needsR2`) can express.
    public static let activitypubWorkerID = "activitypub"
```

Update the function signature (around line 92-100) to add `displayName`:

```swift
    public static func generateWranglerToml(
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim] = [],
        resources: ProvisionedResources = .init(),
        inboxCaptureEnabled: Bool = false,
        inboxKVNamespaceID: String? = nil,
        siteURL: String? = nil,
        /// The site's display name (`SiteSettings.displayName`, already falling back to the site
        /// name by the time a caller passes it in — this function stays pure and does no
        /// fallback of its own), threaded into the ActivityPub actor's `AP_DISPLAY_NAME` var.
        /// `nil` when unknown; the composed Worker's actor document then falls back to a fixed
        /// generic name (`worker.ts`'s concern, not this function's).
        displayName: String? = nil
    ) throws -> String {
```

Add the `hasActivityPub` flag alongside `hasIndieauth`/`hasWebmentionReceive`/`hasMicropub` (around line 122-124):

```swift
        let hasIndieauth = workers.contains(where: { $0.id == indieauthWorkerID })
        let hasWebmentionReceive = workers.contains(where: { $0.id == webmentionWorkerID })
        let hasMicropub = workers.contains(where: { $0.id == micropubWorkerID })
        let hasActivityPub = workers.contains(where: { $0.id == activitypubWorkerID })
```

Add the Durable Object binding + migration block. Insert this right after the R2 block (after line 237, before the existing `inboxCaptureEnabled` block):

```swift
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
```

Replace the existing single-purpose `[vars]` block (lines 250-254: `if hasWebmentionReceive, let siteURL, ...`) with a generalized block that can carry more than one var:

```swift
        var varsLines: [String] = []
        if hasWebmentionReceive, let siteURL, !siteURL.isEmpty, isSafeTomlStringValue(siteURL) {
            varsLines.append("SITE_URL = \"\(siteURL)\"")
        }
        if hasActivityPub, let displayName, !displayName.isEmpty, isSafeTomlStringValue(displayName) {
            varsLines.append("AP_DISPLAY_NAME = \"\(displayName)\"")
        }
        if !varsLines.isEmpty {
            lines.append("")
            lines.append("[vars]")
            lines.append(contentsOf: varsLines)
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter WorkerCompositionTests`
Expected: PASS (all existing WorkerCompositionTests plus the six new ones)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/WorkerComposition.swift Tests/AnglesiteCoreTests/WorkerCompositionTests.swift
git commit -m "feat(#363): compose ActivityPub's Durable Object binding into wrangler.toml"
```

---

### Task 3: `SecretAccounts` — Keychain slots for the ActivityPub key material

**Files:**
- Modify: `Sources/AnglesiteCore/Platform/SecretStore.swift`
- Test: create `Tests/AnglesiteCoreTests/SecretStoreTests.swift` (confirmed not to exist yet — no test file currently covers `SecretAccounts` directly).

**Interfaces:**
- Consumes: nothing (pure string-building functions).
- Produces: `SecretAccounts.activityPubPrivateKeyPem(siteID: String) -> String`, `SecretAccounts.activityPubPublishToken(siteID: String) -> String` — Task 4 (`ActivityPubKeyProvisioning`) uses both.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/SecretStoreTests.swift`:

```swift
import Testing
@testable import AnglesiteCore

@Suite("SecretAccounts")
struct SecretAccountsTests {
    @Test("activityPubPrivateKeyPem is namespaced per site, matching the mastodonAccessToken pattern")
    func activityPubPrivateKeyPemIsPerSite() {
        let a = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-a")
        let b = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-b")
        #expect(a != b)
        #expect(a.contains("site-a"))
    }

    @Test("activityPubPublishToken is namespaced per site and distinct from the private key account")
    func activityPubPublishTokenIsPerSiteAndDistinct() {
        let token = SecretAccounts.activityPubPublishToken(siteID: "site-a")
        let key = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-a")
        #expect(token != key)
        #expect(token.contains("site-a"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter SecretAccountsTests`
Expected: FAIL — compile error, `activityPubPrivateKeyPem`/`activityPubPublishToken` don't exist.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/Platform/SecretStore.swift`, add next to `blueskyAppPassword(siteID:)` (after line 50):

```swift
    /// The ActivityPub actor's signing keypair (PKCS#8 PEM, private half only — the public half
    /// is re-derived on demand). App-generated once per site by `ActivityPubKeyProvisioning`
    /// (#363) and never regenerated: a rotated key breaks federation trust with existing
    /// followers, unlike the opaque tokens above which can be rotated freely.
    public static func activityPubPrivateKeyPem(siteID: String) -> String {
        "activitypub:\(siteID):private-key-pem"
    }

    /// Bearer token gating `@dwk/activitypub`'s owner-only publish endpoint
    /// (`POST <actor>/outbox`), which this app's Micropub-to-ActivityPub fan-out calls
    /// internally. App-generated random bytes, distinct from `activityPubPrivateKeyPem` — unlike
    /// the signing key, rotating this has no federation-trust consequence, but it still must
    /// never be a hardcoded constant (this endpoint's fan-out caller and target both live in the
    /// open-source template shipped to every site).
    public static func activityPubPublishToken(siteID: String) -> String {
        "activitypub:\(siteID):publish-token"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter SecretAccountsTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/Platform/SecretStore.swift Tests/AnglesiteCoreTests/SecretStoreTests.swift
git commit -m "feat(#363): add Keychain account slots for ActivityPub key material"
```

---

### Task 4: `ActivityPubKeyProvisioning` — RSA keypair generation + PEM wrapping

This is the one genuinely new cryptographic capability in the app. Security framework's `SecKeyCopyExternalRepresentation` returns raw PKCS#1 DER for RSA keys; `@dwk/activitypub` needs PKCS#8 (private) and SPKI (public) PEM — the standard WebCrypto-importable formats. Converting PKCS#1 → PKCS#8/SPKI for RSA is a fixed-prefix ASN.1 wrapping (the encoded key length varies with key size, but the wrapping header bytes for a given algorithm are constant), verified here by round-tripping through the `openssl` CLI rather than asserting exact byte sequences.

**Files:**
- Create: `Sources/AnglesiteCore/ActivityPubKeyProvisioning.swift`
- Test: create `Tests/AnglesiteCoreTests/ActivityPubKeyProvisioningTests.swift`

**Interfaces:**
- Consumes: `SecretStore` protocol, `SecretAccounts.activityPubPrivateKeyPem(siteID:)`/`activityPubPublishToken(siteID:)` (Task 3).
- Produces: `ActivityPubKeyProvisioning.secrets(siteID: String, secretStore: any SecretStore) throws -> ActivityPubKeyProvisioning.Secrets`, where:
  ```swift
  public struct Secrets: Sendable, Equatable {
      public let privateKeyPem: String   // PKCS#8 PEM
      public let publicKeyPem: String    // SPKI PEM
      public let publishToken: String    // random, base64url
  }
  ```
  Task 5 (`SocialWorkerProvisionCommand`) calls this.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/ActivityPubKeyProvisioningTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("ActivityPubKeyProvisioning")
struct ActivityPubKeyProvisioningTests {
    @Test("generates a PKCS#8 private key PEM that openssl accepts as valid")
    func generatesValidPKCS8PrivateKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        #expect(secrets.privateKeyPem.hasPrefix("-----BEGIN PRIVATE KEY-----"))
        try assertOpenSSLAccepts(pem: secrets.privateKeyPem, arguments: ["pkey", "-inform", "PEM", "-noout", "-check"])
    }

    @Test("generates an SPKI public key PEM that openssl accepts as valid")
    func generatesValidSPKIPublicKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        #expect(secrets.publicKeyPem.hasPrefix("-----BEGIN PUBLIC KEY-----"))
        try assertOpenSSLAccepts(pem: secrets.publicKeyPem, arguments: ["pkey", "-pubin", "-inform", "PEM", "-noout"])
    }

    @Test("the derived public key matches the private key (openssl pkey -pubout round-trip)")
    func publicKeyMatchesPrivateKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        let derivedPublicKeyPem = try runOpenSSL(
            arguments: ["pkey", "-inform", "PEM", "-pubout"], stdin: secrets.privateKeyPem
        )
        #expect(derivedPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines)
            == secrets.publicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    @Test("generates a non-empty, non-predictable publish token")
    func generatesPublishToken() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        #expect(secrets.publishToken.count >= 32)
    }

    @Test("is idempotent: a second call for the same site returns the same key material")
    func idempotentAcrossCalls() throws {
        let store = InMemorySecretStore()
        let first = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        let second = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        #expect(first == second)
    }

    @Test("two different sites get independent key material")
    func differentSitesGetIndependentKeys() throws {
        let store = InMemorySecretStore()
        let a = try ActivityPubKeyProvisioning.secrets(siteID: "site-a", secretStore: store)
        let b = try ActivityPubKeyProvisioning.secrets(siteID: "site-b", secretStore: store)
        #expect(a.privateKeyPem != b.privateKeyPem)
        #expect(a.publishToken != b.publishToken)
    }
}

/// In-memory `SecretStore` fake — same shape as any real conformer, just backed by a dictionary
/// instead of the Keychain, so these tests don't touch the real login keychain.
private final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]

    func read(account: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[account]
    }

    func write(_ value: String, account: String) throws {
        lock.lock(); defer { lock.unlock() }
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }

    func delete(account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: account)
    }
}

/// Shells out to the `openssl` CLI (present on every macOS dev/CI machine this test runs on) to
/// verify generated PEM material is actually well-formed PKCS#8/SPKI — round-tripping through a
/// real, independent ASN.1 parser is a much stronger check than asserting our own wrapping code
/// produced *some* bytes.
private func runOpenSSL(arguments: [String], stdin: String) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["openssl"] + arguments
    let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
    process.standardInput = inPipe
    process.standardOutput = outPipe
    process.standardError = errPipe
    try process.run()
    inPipe.fileHandleForWriting.write(Data(stdin.utf8))
    try inPipe.fileHandleForWriting.close()
    process.waitUntilExit()
    let output = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let errorOutput = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "openssl", code: Int(process.terminationStatus), userInfo: [
            NSLocalizedDescriptionKey: "openssl \(arguments.joined(separator: " ")) failed: \(errorOutput)"
        ])
    }
    return output
}

private func assertOpenSSLAccepts(pem: String, arguments: [String]) throws {
    _ = try runOpenSSL(arguments: arguments, stdin: pem)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter ActivityPubKeyProvisioningTests`
Expected: FAIL — compile error, `ActivityPubKeyProvisioning` doesn't exist.

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/ActivityPubKeyProvisioning.swift`:

```swift
import Foundation
#if canImport(Security)
import Security
#endif

/// Generates and persists the per-site secret material `@dwk/activitypub` needs: an RSA signing
/// keypair (PKCS#8 private / SPKI public PEM — the WebCrypto-importable formats the package
/// requires) and a random publish-fan-out token. Generated exactly once per site, lazily, the
/// first time a caller asks — never regenerated, since rotating the signing key breaks
/// federation trust with existing followers (#363 design doc, "Keypair generation & storage").
public enum ActivityPubKeyProvisioning {
    public struct Secrets: Sendable, Equatable {
        public let privateKeyPem: String
        public let publicKeyPem: String
        public let publishToken: String
    }

    public enum Error: Swift.Error {
        case keyGenerationFailed(String)
        case exportFailed(String)
        case unsupportedPlatform
    }

    /// Returns this site's ActivityPub secrets, generating and persisting them into `secretStore`
    /// on first call. Every subsequent call for the same `siteID` returns the same values.
    public static func secrets(siteID: String, secretStore: any SecretStore) throws -> Secrets {
        let privateKeyAccount = SecretAccounts.activityPubPrivateKeyPem(siteID: siteID)
        let publishTokenAccount = SecretAccounts.activityPubPublishToken(siteID: siteID)

        let privateKeyPem: String
        if let existing = try secretStore.read(account: privateKeyAccount) {
            privateKeyPem = existing
        } else {
            privateKeyPem = try generatePrivateKeyPem()
            try secretStore.write(privateKeyPem, account: privateKeyAccount)
        }

        let publishToken: String
        if let existing = try secretStore.read(account: publishTokenAccount) {
            publishToken = existing
        } else {
            publishToken = try generatePublishToken()
            try secretStore.write(publishToken, account: publishTokenAccount)
        }

        let publicKeyPem = try derivePublicKeyPem(fromPrivateKeyPem: privateKeyPem)
        return Secrets(privateKeyPem: privateKeyPem, publicKeyPem: publicKeyPem, publishToken: publishToken)
    }

    static func generatePublishToken() throws -> String {
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

    #if canImport(Security)
    static func generatePrivateKeyPem() throws -> String {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
        ]
        var cfError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &cfError) else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.keyGenerationFailed(message)
        }
        let pkcs1DER = try externalRepresentation(of: privateKey)
        let pkcs8DER = wrapRSAPrivateKeyAsPKCS8(pkcs1DER)
        return pem(der: pkcs8DER, label: "PRIVATE KEY")
    }

    static func derivePublicKeyPem(fromPrivateKeyPem privateKeyPem: String) throws -> String {
        let pkcs8DER = try derData(fromPEM: privateKeyPem)
        let pkcs1DER = try unwrapPKCS8ToRSAPrivateKey(pkcs8DER)
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        var cfError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateWithData(pkcs1DER as CFData, attributes as CFDictionary, &cfError) else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.exportFailed(message)
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw Error.exportFailed("SecKeyCopyPublicKey returned nil")
        }
        let publicPKCS1DER = try externalRepresentation(of: publicKey)
        let spkiDER = wrapRSAPublicKeyAsSPKI(publicPKCS1DER)
        return pem(der: spkiDER, label: "PUBLIC KEY")
    }

    private static func externalRepresentation(of key: SecKey) throws -> Data {
        var cfError: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(key, &cfError) as Data? else {
            let message = (cfError?.takeRetainedValue()).map { String(describing: $0) } ?? "unknown error"
            throw Error.exportFailed(message)
        }
        return data
    }
    #endif

    // MARK: - ASN.1 wrapping (RSA PKCS#1 <-> PKCS#8/SPKI)
    //
    // Security framework exports/imports RSA keys as raw PKCS#1 DER. WebCrypto (and therefore
    // @dwk/activitypub, which imports keys via crypto.subtle.importKey) requires PKCS#8
    // (private) and SPKI (public) instead. For RSA, both are the PKCS#1 DER wrapped in a fixed
    // ASN.1 envelope naming the rsaEncryption algorithm (OID 1.2.840.113549.1.1.1) — the envelope
    // bytes are constant regardless of key size, only the embedded PKCS#1 body's length varies,
    // so this is a deterministic prefix/suffix wrap, not a real ASN.1 encoder.

    /// PKCS#8 `PrivateKeyInfo` wrapper: `SEQUENCE { version INTEGER 0, algorithm AlgorithmIdentifier, privateKey OCTET STRING }`.
    static func wrapRSAPrivateKeyAsPKCS8(_ pkcs1DER: Data) -> Data {
        let algorithmIdentifier: [UInt8] = [
            0x30, 0x0D, // SEQUENCE (13 bytes)
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, // OID rsaEncryption
            0x05, 0x00, // NULL
        ]
        let version: [UInt8] = [0x02, 0x01, 0x00] // INTEGER 0
        let octetStringHeader = derLength(tag: 0x04, contentLength: pkcs1DER.count)
        let body = version + algorithmIdentifier + octetStringHeader + [UInt8](pkcs1DER)
        let sequenceHeader = derLength(tag: 0x30, contentLength: body.count)
        return Data(sequenceHeader + body)
    }

    /// Inverse of `wrapRSAPrivateKeyAsPKCS8` — strips the PKCS#8 envelope back to bare PKCS#1 DER
    /// so Security framework's `SecKeyCreateWithData` (which expects PKCS#1 for RSA) can import
    /// it. Only needs to handle DER this module itself produced (2048-bit RSA, short-form or
    /// single-byte long-form lengths), not arbitrary third-party PKCS#8.
    static func unwrapPKCS8ToRSAPrivateKey(_ pkcs8DER: Data) throws -> Data {
        var scanner = DERScanner(pkcs8DER)
        try scanner.expectSequence()
        try scanner.expectInteger(value: 0)
        try scanner.skipSequence() // AlgorithmIdentifier
        return try scanner.readOctetStringContents()
    }

    /// SPKI `SubjectPublicKeyInfo` wrapper: `SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }`.
    static func wrapRSAPublicKeyAsSPKI(_ pkcs1DER: Data) -> Data {
        let algorithmIdentifier: [UInt8] = [
            0x30, 0x0D,
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01,
            0x05, 0x00,
        ]
        // BIT STRING: a leading 0x00 "no unused bits" byte, then the DER contents.
        let bitStringContentLength = pkcs1DER.count + 1
        let bitStringHeader = derLength(tag: 0x03, contentLength: bitStringContentLength)
        let body = algorithmIdentifier + bitStringHeader + [0x00] + [UInt8](pkcs1DER)
        let sequenceHeader = derLength(tag: 0x30, contentLength: body.count)
        return Data(sequenceHeader + body)
    }

    /// Encodes a DER tag + length header for `contentLength` bytes of content (short-form for
    /// <128 bytes, single-byte long-form length for 128..<256 — sufficient for every length this
    /// module ever wraps: RSA-2048 PKCS#1 bodies are a few hundred bytes).
    private static func derLength(tag: UInt8, contentLength: Int) -> [UInt8] {
        if contentLength < 0x80 {
            return [tag, UInt8(contentLength)]
        }
        var length = contentLength
        var lengthBytes: [UInt8] = []
        while length > 0 {
            lengthBytes.insert(UInt8(length & 0xFF), at: 0)
            length >>= 8
        }
        return [tag, 0x80 | UInt8(lengthBytes.count)] + lengthBytes
    }

    private static func derData(fromPEM pem: String) throws -> Data {
        let lines = pem.split(separator: "\n").filter { !$0.hasPrefix("-----") }
        guard let data = Data(base64Encoded: lines.joined()) else {
            throw Error.exportFailed("malformed PEM: not valid base64")
        }
        return data
    }

    private static func pem(der: Data, label: String) -> String {
        let base64 = der.base64EncodedString()
        var lines: [String] = []
        var index = base64.startIndex
        while index < base64.endIndex {
            let end = base64.index(index, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
            lines.append(String(base64[index..<end]))
            index = end
        }
        return "-----BEGIN \(label)-----\n\(lines.joined(separator: "\n"))\n-----END \(label)-----\n"
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Minimal DER reader — just enough to unwrap the fixed PKCS#8 shape `wrapRSAPrivateKeyAsPKCS8`
/// itself produces (sequence, integer, nested sequence to skip, octet string). Not a general ASN.1
/// parser.
private struct DERScanner {
    private let data: Data
    private var offset: Int

    init(_ data: Data) {
        self.data = data
        self.offset = data.startIndex
    }

    private mutating func readTagAndLength(expectedTag: UInt8) throws -> Int {
        guard offset < data.endIndex, data[offset] == expectedTag else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: expected tag 0x\(String(expectedTag, radix: 16))")
        }
        offset += 1
        guard offset < data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated length")
        }
        let first = data[offset]
        offset += 1
        if first & 0x80 == 0 {
            return Int(first)
        }
        let byteCount = Int(first & 0x7F)
        guard byteCount > 0, offset + byteCount <= data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated long-form length")
        }
        var length = 0
        for _ in 0..<byteCount {
            length = (length << 8) | Int(data[offset])
            offset += 1
        }
        return length
    }

    mutating func expectSequence() throws {
        _ = try readTagAndLength(expectedTag: 0x30)
    }

    mutating func expectInteger(value: Int) throws {
        let length = try readTagAndLength(expectedTag: 0x02)
        guard length == 1, offset < data.endIndex, Int(data[offset]) == value else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: unexpected INTEGER value")
        }
        offset += length
    }

    mutating func skipSequence() throws {
        let length = try readTagAndLength(expectedTag: 0x30)
        offset += length
    }

    mutating func readOctetStringContents() throws -> Data {
        let length = try readTagAndLength(expectedTag: 0x04)
        guard offset + length <= data.endIndex else {
            throw ActivityPubKeyProvisioning.Error.exportFailed("DER: truncated OCTET STRING")
        }
        let contents = data[offset..<(offset + length)]
        offset += length
        return Data(contents)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ActivityPubKeyProvisioningTests`
Expected: PASS. If `publicKeyMatchesPrivateKey` or the `openssl pkey -check` tests fail, the ASN.1 wrapping has a bug — check the OID bytes (`2A 86 48 86 F7 0D 01 01 01` is `1.2.840.113549.1.1.1`, rsaEncryption) and the length-encoding logic first; do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ActivityPubKeyProvisioning.swift Tests/AnglesiteCoreTests/ActivityPubKeyProvisioningTests.swift
git commit -m "feat(#363): generate and persist the ActivityPub actor's signing keypair"
```

---

### Task 5: `ContainerCommandRunner` — push secrets into the guest without stdin

`SocialWorkerProvisionCommand`'s wrangler calls run inside the container via `LocalContainerControl.exec` (one-shot, no stdin). `wrangler secret put <NAME>` reads its value from stdin, so this task adds a small in-guest shell script that pipes the value from an environment variable instead — mirroring exactly how `CLOUDFLARE_API_TOKEN` already crosses into the guest (`ContainerCommandRunner.guestEnvAllowlist`).

**Files:**
- Modify: `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`
- Modify: `Sources/AnglesiteCore/ContainerCommandRunner.swift`
- Test: `Tests/AnglesiteCoreTests/ContainerCommandRunnerTests.swift`

**Interfaces:**
- Consumes: `LocalContainerControl.exec(siteID:argv:environment:workingDirectory:onOutput:)` (existing, unchanged).
- Produces: `SocialWorkerProvisionCommand.SecretRunner` typealias (`@Sendable (_ siteDirectory: URL, _ name: String, _ value: String, _ environment: [String: String], _ source: String) async throws -> ProcessSupervisor.RunResult`), `SocialWorkerProvisionCommand.defaultSecretRunner` static, and `ContainerCommandRunner.secretRunner: SocialWorkerProvisionCommand.SecretRunner` computed property — Task 6 injects this into `provision()`; Task 7 wires the production instance into `DeployModel`.

- [ ] **Step 1: Write the failing test**

Add a test to `Tests/AnglesiteCoreTests/ContainerCommandRunnerTests.swift`, using the existing `FakeLocalContainerControl` double (`Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift:4-115` — a canned `execResult` returned from every `exec` call, with each call's `siteID`/`argv`/`env`/`cwd` recorded into `execCalls`, exactly like this file's existing `argvIsPrefixedWithWrangler` test at line 15):

```swift
@Test("secretRunner pipes the value through an environment variable, never through argv")
func secretRunnerPipesValueThroughEnvironment() async throws {
    let fake = FakeLocalContainerControl(
        startResult: .failure(.virtualizationUnavailable),
        execResult: ContainerExecResult(exitCode: 0, stdout: "Success! Uploaded secret AP_PRIVATE_KEY", stderr: "")
    )
    let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())
    let privateKeyPem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"

    let result = try await runner.secretRunner(
        URL(fileURLWithPath: "/host/irrelevant"), "AP_PRIVATE_KEY", privateKeyPem,
        ["CLOUDFLARE_API_TOKEN": "token"], "test-source"
    )

    #expect(result.exitCode == 0)
    let calls = await fake.execCalls
    #expect(calls.count == 1)
    // The secret value must never appear as a literal argv element — only the shell script text
    // (which references it by variable name) and the environment dict (checked below) do.
    #expect(!calls[0].argv.contains(where: { $0.contains("BEGIN PRIVATE KEY") }))
    #expect(calls[0].argv == [
        "sh", "-c",
        "printf '%s' \"$WRANGLER_SECRET_VALUE\" | npx wrangler secret put \"$WRANGLER_SECRET_NAME\"",
    ])
    #expect(calls[0].env["WRANGLER_SECRET_NAME"] == "AP_PRIVATE_KEY")
    #expect(calls[0].env["WRANGLER_SECRET_VALUE"] == privateKeyPem)
    #expect(calls[0].env["CLOUDFLARE_API_TOKEN"] == "token")
    #expect(calls[0].cwd == "/workspace/site")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter ContainerCommandRunnerTests/secretRunnerPipesValueThroughEnvironment`
Expected: FAIL — compile error, `secretRunner` doesn't exist.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`, add the new typealias next to `CommandRunner` (after line 36):

```swift
    /// Pushes one Cloudflare Worker secret whose value can't travel as a plain CLI argument
    /// (`wrangler secret put <NAME>` reads its value from stdin). Unlike `CommandRunner`, which
    /// always shapes a bare `wrangler <args>` call, this closure's production conformer
    /// (`ContainerCommandRunner.secretRunner`) runs a small in-guest shell script that reads
    /// `value` from an environment variable rather than stdin — the container-exec seam
    /// (`LocalContainerControl.exec`) is one-shot with no stdin plumbing.
    public typealias SecretRunner = @Sendable (
        _ siteDirectory: URL,
        _ name: String,
        _ value: String,
        _ environment: [String: String],
        _ source: String
    ) async throws -> ProcessSupervisor.RunResult
```

Add a `secretRunner` property, constructor parameter, and default stub, mirroring `runner` (near lines 43-55):

```swift
    public nonisolated let tokenSource: TokenSource
    private let runner: CommandRunner
    private let secretRunner: SecretRunner
    private let deployer: Deployer

    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        runner: @escaping CommandRunner = SocialWorkerProvisionCommand.defaultRunner,
        secretRunner: @escaping SecretRunner = SocialWorkerProvisionCommand.defaultSecretRunner,
        deployer: @escaping Deployer = SocialWorkerProvisionCommand.defaultDeployer
    ) {
        self.tokenSource = tokenSource
        self.runner = runner
        self.secretRunner = secretRunner
        self.deployer = deployer
    }
```

Add the default stub next to `defaultRunner` (near line 383-387):

```swift
    public static let defaultSecretRunner: SecretRunner = { siteDirectory, name, value, environment, source in
        let reason = HostNodeRetirement.reason("social worker secret provisioning")
        await LogCenter.shared.append(source: source, stream: .stderr, text: reason)
        return ProcessSupervisor.RunResult(stdout: reason, stderr: "", exitCode: 127)
    }
```

In `Sources/AnglesiteCore/ContainerCommandRunner.swift`, add a `secretRunner` computed property and its implementation, next to the existing `runner` property (after line 25):

```swift
    /// Bind this instance's secret-push as a `SocialWorkerProvisionCommand.SecretRunner` closure.
    public var secretRunner: SocialWorkerProvisionCommand.SecretRunner {
        { [self] siteDirectory, name, value, environment, source in
            try await self.runSecret(siteDirectory: siteDirectory, name: name, value: value, environment: environment, source: source)
        }
    }
```

Add the implementation after `run(...)` (after line 65):

```swift
    /// Pushes `value` as the named Cloudflare Worker secret. `wrangler secret put <NAME>` reads
    /// its value from stdin, which `exec` (one-shot, no stdin plumbing) can't supply directly —
    /// instead this runs a tiny in-guest shell script that reads the value from an environment
    /// variable and pipes it in itself, so the secret's actual bytes never appear in `argv` or in
    /// the script text (only the two fixed variable *names* do). `name` and `value` are passed
    /// via the same `environment` allowlist mechanism `CLOUDFLARE_API_TOKEN` already uses — this
    /// call's environment additions are scoped to this one invocation, never merged into the
    /// broader `guestEnvAllowlist` set other wrangler calls share.
    private func runSecret(
        siteDirectory: URL,
        name: String,
        value: String,
        environment: [String: String],
        source: String
    ) async throws -> ProcessSupervisor.RunResult {
        var guestEnvironment = environment.filter { Self.guestEnvAllowlist.contains($0.key) }
        guestEnvironment["WRANGLER_SECRET_NAME"] = name
        guestEnvironment["WRANGLER_SECRET_VALUE"] = value
        let argv = [
            "sh", "-c",
            "printf '%s' \"$WRANGLER_SECRET_VALUE\" | npx wrangler secret put \"$WRANGLER_SECRET_NAME\"",
        ]

        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        let logCenter = self.logCenter
        let drain = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }

        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: argv,
                environment: guestEnvironment,
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch {
            continuation.finish()
            _ = await drain.value
            throw error
        }
        continuation.finish()
        _ = await drain.value
        return ProcessSupervisor.RunResult(stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter ContainerCommandRunnerTests`
Expected: PASS (existing tests plus the new one)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift Sources/AnglesiteCore/ContainerCommandRunner.swift Tests/AnglesiteCoreTests/ContainerCommandRunnerTests.swift
git commit -m "feat(#363): push wrangler secrets via guest env vars, not stdin"
```

---

### Task 6: `SocialWorkerProvisionCommand.provision()` — wire keypair generation + secret push

**Files:**
- Modify: `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`
- Test: `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`

**Interfaces:**
- Consumes: `ActivityPubKeyProvisioning.secrets(siteID:secretStore:)` (Task 4), `SocialWorkerProvisionCommand.SecretRunner` (Task 5), `WorkerComposition.activitypubWorkerID` (Task 2).
- Produces: a new `keyPairSource: KeyPairSource` constructor parameter on `SocialWorkerProvisionCommand` (`public typealias KeyPairSource = @Sendable (_ siteID: String) throws -> ActivityPubKeyProvisioning.Secrets`), defaulting to a production closure that reads/writes the real Keychain. Task 7 (`DeployModel`) doesn't need to inject this explicitly (the default is already correct there) but does inject `secretRunner`.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift`, near the Micropub test (around line 98-131):

```swift
@Test("provisions ActivityPub: generates keys once, pushes secrets, writes the DO binding")
func provisionsActivityPub() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([:])
    var pushedSecrets: [(name: String, value: String)] = []
    let secretRunnerLock = NSLock()
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        keyPairSource: { _ in
            .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE")
        },
        secretRunner: { _, name, value, _, _ in
            secretRunnerLock.lock()
            pushedSecrets.append((name, value))
            secretRunnerLock.unlock()
            return .init(stdout: "Success!", stderr: "", exitCode: 0)
        },
        deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
    )
    let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

    let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub])

    guard case .succeeded = result else {
        Issue.record("expected success, got \(result)")
        return
    }
    #expect(pushedSecrets.contains { $0.name == "AP_PRIVATE_KEY" && $0.value == "PRIVATE-PEM" })
    #expect(pushedSecrets.contains { $0.name == "AP_PUBLIC_KEY" && $0.value == "PUBLIC-PEM" })
    #expect(pushedSecrets.contains { $0.name == "AP_PUBLISH_TOKEN" && $0.value == "TOKEN-VALUE" })

    let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
    #expect(toml.contains("[[durable_objects.bindings]]"))
}

@Test("no activitypub worker means keyPairSource and the ActivityPub secretRunner calls never run")
func noActivitypubSkipsKeyGeneration() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([:])
    var keyPairSourceCalled = false
    var secretRunnerCalled = false
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        keyPairSource: { _ in
            keyPairSourceCalled = true
            return .init(privateKeyPem: "x", publicKeyPem: "y", publishToken: "z")
        },
        secretRunner: { _, _, _, _, _ in
            secretRunnerCalled = true
            return .init(stdout: "", stderr: "", exitCode: 0)
        },
        deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
    )

    _ = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

    #expect(!keyPairSourceCalled)
    #expect(!secretRunnerCalled)
}

@Test("a secretRunner failure fails provisioning before deploy")
func secretPushFailureFailsProvisioning() async throws {
    let site = try temporaryDirectory()
    let recorder = WranglerRecorder([:])
    let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
    let command = SocialWorkerProvisionCommand(
        tokenSource: { "token" },
        runner: recorder.runner,
        keyPairSource: { _ in .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE") },
        secretRunner: { _, name, _, _, _ in
            if name == "AP_PUBLIC_KEY" {
                return .init(stdout: "", stderr: "authentication error", exitCode: 1)
            }
            return .init(stdout: "Success!", stderr: "", exitCode: 0)
        },
        deployer: deployer.deployer
    )
    let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

    let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub])

    guard case .failed = result else {
        Issue.record("expected failure, got \(result)")
        return
    }
    #expect(await deployer.calls.isEmpty)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: FAIL — compile error, no `keyPairSource` parameter yet.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`, add the new typealias next to `SecretRunner` (Task 5's addition):

```swift
    /// Produces (generating and persisting on first call, per site) the ActivityPub actor's
    /// signing keypair and publish token. Defaults to the real Keychain via
    /// `ActivityPubKeyProvisioning`; tests inject a fake to avoid touching the real login
    /// keychain and to control the returned values deterministically.
    public typealias KeyPairSource = @Sendable (_ siteID: String) throws -> ActivityPubKeyProvisioning.Secrets
```

Add the property/parameter/default, extending the constructor from Task 5:

```swift
    public nonisolated let tokenSource: TokenSource
    private let runner: CommandRunner
    private let secretRunner: SecretRunner
    private let keyPairSource: KeyPairSource
    private let deployer: Deployer

    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        runner: @escaping CommandRunner = SocialWorkerProvisionCommand.defaultRunner,
        secretRunner: @escaping SecretRunner = SocialWorkerProvisionCommand.defaultSecretRunner,
        keyPairSource: @escaping KeyPairSource = SocialWorkerProvisionCommand.defaultKeyPairSource,
        deployer: @escaping Deployer = SocialWorkerProvisionCommand.defaultDeployer
    ) {
        self.tokenSource = tokenSource
        self.runner = runner
        self.secretRunner = secretRunner
        self.keyPairSource = keyPairSource
        self.deployer = deployer
    }
```

Add the production default next to `defaultSecretRunner`:

```swift
    public static let defaultKeyPairSource: KeyPairSource = { siteID in
        try ActivityPubKeyProvisioning.secrets(siteID: siteID, secretStore: PlatformSecretStore.make())
    }
```

Add the ActivityPub provisioning step in `provision()`, after the R2 block and before the webmention-queue block (after line 180, before line 182's `hasWebmentionReceive` check):

```swift
        let hasActivityPub = workers.contains(where: { $0.id == WorkerComposition.activitypubWorkerID })
        if hasActivityPub {
            let keys: ActivityPubKeyProvisioning.Secrets
            do {
                keys = try keyPairSource(siteID)
            } catch {
                return .failed(reason: "couldn't prepare ActivityPub signing key: \(error)", exitCode: nil, resources: resources)
            }
            for (name, value) in [
                ("AP_PRIVATE_KEY", keys.privateKeyPem),
                ("AP_PUBLIC_KEY", keys.publicKeyPem),
                ("AP_PUBLISH_TOKEN", keys.publishToken),
            ] {
                do {
                    let secretResult = try await secretRunner(siteDirectory, name, value, environment, source)
                    guard secretResult.exitCode == 0 else {
                        let output = secretResult.stdout.isEmpty ? secretResult.stderr : secretResult.stdout
                        return .failed(reason: "couldn't push \(name): \(output)", exitCode: secretResult.exitCode, resources: resources)
                    }
                } catch {
                    return .failed(reason: "couldn't push \(name): \(error)", exitCode: nil, resources: resources)
                }
            }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SocialWorkerProvisionCommandTests`
Expected: PASS (all existing tests plus the three new ones)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift
git commit -m "feat(#363): provision the ActivityPub actor's keys and secrets on deploy"
```

---

### Task 7: `DeployModel` — wire the production `secretRunner`, thread `displayName`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift`

**Interfaces:**
- Consumes: `ContainerCommandRunner.secretRunner` (Task 5), `WorkerComposition.generateWranglerToml`'s `displayName` parameter (Task 2), `SiteSettings.displayName` (existing, `SiteConfigStore.swift:14`).
- Produces: nothing new for later tasks — this is the production wiring endpoint.

- [ ] **Step 1: No new automated test** — `DeployModel`'s existing test coverage (if any) is `@MainActor` UI-model level and largely exercised through higher-level flows already covered by `SocialWorkerProvisionCommandTests`. This task is a small, mechanical wiring change; verify it with a build, not a new unit test.

Run first to see current state:

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -40
```

Expected: builds clean before this task's edit (confirms the baseline).

- [ ] **Step 2: Thread `displayName` through `SocialWorkerProvisionCommand`**

In `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift`, add `displayName` to `provision(...)`'s parameter list, right after `siteURL` (currently `siteURL: String? = nil,` followed by the `acknowledgesPaidPlan` doc comment and parameter):

```swift
        siteURL: String? = nil,
        /// The site's display name (`SiteSettings.displayName`), threaded into the ActivityPub
        /// actor's `AP_DISPLAY_NAME` var via `WorkerComposition.generateWranglerToml`. `nil` when
        /// unknown — the composed Worker's actor document then falls back to a fixed generic
        /// name (`worker.ts`'s concern, not this function's).
        displayName: String? = nil,
```

Add the same parameter to `persistConfig(...)`'s signature (currently ending `resources: WorkerComposition.ProvisionedResources, siteURL: String? = nil`):

```swift
    private func persistConfig(
        siteDirectory: URL,
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim],
        resources: WorkerComposition.ProvisionedResources,
        siteURL: String? = nil,
        displayName: String? = nil
    ) -> Result? {
```

and pass it through to `generateWranglerToml` inside `persistConfig`'s body:

```swift
            let toml = try WorkerComposition.generateWranglerToml(
                siteName: siteName,
                workers: workers,
                routeClaims: routeClaims,
                resources: resources,
                siteURL: siteURL,
                displayName: displayName
            )
```

Every call to `persistConfig(...)` inside `provision` passes `siteURL: siteURL` as its last argument (five call sites: after the D1 block, the KV block, the R2 block, the webmention-queue block, and the final unconditional call at the end of `provision`). Change `siteURL: siteURL)` to `siteURL: siteURL, displayName: displayName)` at all five:

```bash
sed -i '' 's/resources: resources, siteURL: siteURL)/resources: resources, siteURL: siteURL, displayName: displayName)/g' Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift
```

Verify it changed exactly 5 occurrences:

```bash
grep -c "siteURL: siteURL, displayName: displayName)" Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift
```

Expected: `5`

- [ ] **Step 3: Wire the production `secretRunner` and `displayName` in `DeployModel`**

In `Sources/AnglesiteApp/DeployModel.swift`, replace the existing container-runner selection block (lines 455-470, shown below as it exists today):

```swift
        let activeCommand: DeployCommand
        let containerRunner: SocialWorkerProvisionCommand.CommandRunner?
        if let cc = containerControl {
            activeCommand = DeployCommand(
                tokenSource: command.tokenSource,
                executor: ContainerDeployExecutor(
                    control: cc.control,
                    siteID: cc.siteID,
                    logCenter: logCenter
                )
            )
            containerRunner = ContainerCommandRunner(control: cc.control, siteID: cc.siteID, logCenter: logCenter).runner
        } else {
            activeCommand = command
            containerRunner = nil
        }
```

with (constructing one shared `ContainerCommandRunner` so both closures talk to the same running container instead of two separately-constructed instances):

```swift
        let activeCommand: DeployCommand
        let containerRunner: SocialWorkerProvisionCommand.CommandRunner?
        let containerSecretRunner: SocialWorkerProvisionCommand.SecretRunner?
        if let cc = containerControl {
            activeCommand = DeployCommand(
                tokenSource: command.tokenSource,
                executor: ContainerDeployExecutor(
                    control: cc.control,
                    siteID: cc.siteID,
                    logCenter: logCenter
                )
            )
            let containerCommandRunner = ContainerCommandRunner(control: cc.control, siteID: cc.siteID, logCenter: logCenter)
            containerRunner = containerCommandRunner.runner
            containerSecretRunner = containerCommandRunner.secretRunner
        } else {
            activeCommand = command
            containerRunner = nil
            containerSecretRunner = nil
        }
```

Update the `SocialWorkerProvisionCommand(...)` construction (currently at lines 533-548) to add `secretRunner:` right after `runner:`:

```swift
        let socialCommand = SocialWorkerProvisionCommand(
            tokenSource: { [weak self] in try await self?.command.tokenSource() },
            runner: containerRunner ?? SocialWorkerProvisionCommand.defaultRunner,
            secretRunner: containerSecretRunner ?? SocialWorkerProvisionCommand.defaultSecretRunner,
            deployer: { [weak self] _, deploySiteID, deploySiteDirectory in
```

(the `deployer:` closure body itself, lines 536-547, is unchanged — only the new `secretRunner:` argument is inserted before it).

Update the `socialCommand.provision(...)` call (currently at lines 560-575) to add `displayName: settings.displayName` after `siteURL: siteURL`:

```swift
        let provisionResult = await socialCommand.provision(
            siteID: siteID,
            siteDirectory: siteDirectory,
            siteName: workerSiteName,
            workers: workers,
            routeClaims: routeClaims.map(\.claim),
            knownResources: settings.provisionedWorkerResources ?? .init(),
            siteURL: siteURL,
            displayName: settings.displayName,
            acknowledgesPaidPlan: acknowledgesPaidPlan
        )
```

(`settings` is already in scope here — loaded at line 476 as `let settings = (try? await configStore.load()) ?? SiteSettings()`.)

- [ ] **Step 4: Run the build**

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60
```

Expected: builds clean (no errors about missing parameters/mismatched closures).

- [ ] **Step 5: Run the full Swift test suite**

```bash
swift test --package-path . 2>&1 | tail -80
```

Expected: PASS, no regressions in `SocialWorkerProvisionCommandTests` from the new `displayName` parameter (it's optional/defaulted everywhere, so existing calls without it keep compiling).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift
git commit -m "feat(#363): wire ActivityPub secret provisioning and display name into deploy"
```

---

### Task 8: `worker.ts` — compose `@dwk/activitypub`

**Files:**
- Modify: `Resources/Template/worker/worker.ts`
- Modify: `Resources/Template/worker/worker.test.ts`
- Modify: `Resources/Template/vitest.config.ts`
- Modify: `Resources/Template/package.json` (add `@dwk/activitypub` dependency)

**Interfaces:**
- Consumes: `@dwk/activitypub`'s `createActivityPub`, `ActivityPubObject` (published package, confirmed API from its README/`.d.ts`).
- Produces: `handleActivityPub(request, env, ctx)`, exported `ActivityPubObject` class, new `WorkerEnv` fields (`ACTOR`, `AP_PRIVATE_KEY`, `AP_PUBLIC_KEY`, `AP_PUBLISH_TOKEN`, `AP_DISPLAY_NAME`).

- [ ] **Step 1: Add the `@dwk/activitypub` dependency**

`Resources/Template/package.json`'s existing `@dwk/*` dependencies are exact-pinned, no caret (`"@dwk/indieauth": "0.1.0-beta.3"`, `"@dwk/micropub": "0.1.0-beta.4"`, `"@dwk/webmention": "0.1.0-beta.3"`). Add a fourth entry in the same style, right after `"@dwk/webmention"`:

```json
    "@dwk/activitypub": "0.1.0-beta.5",
```

Then:

```bash
cd Resources/Template && npm install && cd -
```

- [ ] **Step 2: Add Durable Object and secret test bindings**

`worker.test.ts`'s new tests (Step 3 below) need miniflare's `ACTOR` Durable Object binding and the `AP_*` secrets declared before they can run at all — this is test infrastructure the coming test file needs, not a behavior under test itself, so it's done as prep within this task rather than its own separate task. Replace `Resources/Template/vitest.config.ts` in full with:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const AP_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD18uMeTkt8hY4N
4Axh7wtOR6ETfoEQDSjrzyb0bVjqxHm35IgCDie7o0lUAAnDC3GVCuffcWbnUoVS
d9xhuBs7GjAD//FkVtg4lj482ubsl5UGM0iPr5Wf5KYKBUx0U9Z4lTrZAl4BfvUn
CHOgzQ8O723iK6APvbRHu2AQd9OY9RErvofYkxXDC2XTpvTWBHM0u6zmcfqMPZn7
481Sun9rPEJEDRd0qhRmNMo98fgLvK96RO38VahW5nDYa5vJ9tm2MHFIr+hSjSrB
3kXfYYyf71wQgjx/h47mnUWqLuREyv+3vBlNmTiH7liJsZ/cDgjM9DfjjXb5LiG3
JOSFmEs5AgMBAAECggEAIGs0GbYLSC4Yg+aw6yXFsTtK1ZV6sKFzb+W9xkE1k7hz
LNSgQtkXzqlezIY2wzFaduFZn//EJyCe9zhaYb0RRdCVXKmbaXTzCj5vlLjr8Gqo
l4kh+uKTj+BlLHP3WGwGnJ1bBOjFeGACM3NvPlZZMkhIDSRf9EM2pK/joTgSOZpt
0tYpPYQT+118la9yNZBBYIDpPRyHe7ocxRABnc6ijCipbeFQG2Z7IjREv+p5EtQo
IZdKc5YvzlUr7QqBjpxX/QENJB5PMGEarRhULqpNtmCVRTtNKJK99Dh/KuLQeTfl
q5jVBl6uij71ygo7AKUw5ZaCuVxpNX5tgrAWcgHIKQKBgQD8MoNlPiJm6RDi2y9p
soDc/M+O8UfyIkQ2KdumuZLosSCpNzijH2JGN7JPR6kWWsEPcxEit2xq2P5tqX0X
zzAjXGK3IdCq5YbpkRZiWnEWrl8LMmRkN6FQQbtakjCaTHJzJ6SUU3WHUad2WSYO
nrRhoPm/X8PPtujCUJ1vx5x0pQKBgQD5qEEiSXBbapyssPUUXL1kJI/yGPhJwESP
Aggwns60HbBzYhEw94sH55yEDfEDysIihHxS6ULu2vmXz2u8ACw1XrT+HTo1p+3/
N7cXqW9YezVgkJM3dOcackDAv8Vovq4yZjP640y5aH417DTxkjftaap6LZsUijhc
5JexIo60BQKBgAOxubsB7f8T6utnyooB02FpUqEFZ8hkOBuTAWSv0zcVYSUZafr5
urbMmhAPPKrXKXzQcq/PgAcQpql0kiCHKG1cLRYBqMzYD+Hb/jfymzV52GqRkmbl
abeDPvtUqOGZvRNywTZrAo245HsXUzdjm8DSWtYy0Ot6Am7WP3gjtGcBAoGAMYHQ
CMCPa1Fk6EnfD76kP+uQL+4LrnRWJBW/EgUr8EPC7d6QkilEhLjFLNqm5J2cicPD
850WDM+Xlycmsg1Gtv6k3Y9mL6WxaF7gC+0pi15DY3bH+sNP4MqvVImy1+aYHJ5v
yFyypkG2ZXMFvLHGLWo6yCerDROrwaADBLlZmxECgYEA9FTK7mggOaH7jaGsK2PG
smeTYugX3NbKM6+2aaO4bIFBcQHyrQIamW4vOQidveLqQYiv6A4owZOg1UG9jSYZ
tq3/5vfcjAV/VIKNXzYbwIlObiRinRZllCr6SIDaJHNl/zsoN0JqBM+b7KrwPR29
y6slCXSVdtvk6tLd27zrYfk=
-----END PRIVATE KEY-----
`;

const AP_TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9fLjHk5LfIWODeAMYe8L
TkehE36BEA0o688m9G1Y6sR5t+SIAg4nu6NJVAAJwwtxlQrn33Fm51KFUnfcYbgb
OxowA//xZFbYOJY+PNrm7JeVBjNIj6+Vn+SmCgVMdFPWeJU62QJeAX71JwhzoM0P
Du9t4iugD720R7tgEHfTmPURK76H2JMVwwtl06b01gRzNLus5nH6jD2Z++PNUrp/
azxCRA0XdKoUZjTKPfH4C7yvekTt/FWoVuZw2GubyfbZtjBxSK/oUo0qwd5F32GM
n+9cEII8f4eO5p1Fqi7kRMr/t7wZTZk4h+5YibGf3A4IzPQ34412+S4htyTkhZhL
OQIDAQAB
-----END PUBLIC KEY-----
`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/worker.ts",
      miniflare: {
        compatibilityDate: "2026-07-15",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["AUTH_DB", "WEBMENTION_INBOX", "MICROPUB_DB"],
        kvNamespaces: ["INBOX_KV", "SOCIAL_KV"],
        r2Buckets: ["MEDIA"],
        queueProducers: { WEBMENTION_QUEUE: "site-webmentions" },
        queueConsumers: ["site-webmentions"],
        durableObjects: { ACTOR: "ActivityPubObject" },
        bindings: {
          TOKEN_SIGNING_KEY: "test-token-signing-key-with-at-least-32-bytes",
          INDIEAUTH_OWNER_PASSWORD: "correct horse battery staple",
          SITE_URL: "https://test.example",
          AP_PRIVATE_KEY: AP_TEST_PRIVATE_KEY,
          AP_PUBLIC_KEY: AP_TEST_PUBLIC_KEY,
          AP_PUBLISH_TOKEN: "test-activitypub-publish-token",
        },
      },
    }),
  ],
  test: {
    include: ["worker/**/*.test.ts"],
  },
});
```

This is a one-time, checked-in test-fixture RSA keypair (not the real per-site generated key) — same idea as `TOKEN_SIGNING_KEY: "test-token-signing-key-with-at-least-32-bytes"` already being a literal test string in this file. It was generated with `openssl genrsa -out private.pem 2048 && openssl pkcs8 -topk8 -nocrypt -in private.pem -out private-pkcs8.pem && openssl rsa -in private.pem -pubout -out public.pem`.

Run to confirm miniflare accepts the new config before writing any tests against it:

```bash
cd Resources/Template && npm test 2>&1 | head -60 && cd -
```

Expected: the existing suite still runs and passes (no new tests reference `ACTOR`/`AP_*` yet). If miniflare rejects the `durableObjects: { ACTOR: "ActivityPubObject" }` shape, check `@cloudflare/vitest-pool-workers`' current documented option name in `node_modules/@cloudflare/vitest-pool-workers` (it may need `durableObjects: { ACTOR: { className: "ActivityPubObject" } }` or similar) before continuing.

- [ ] **Step 3: Write the failing tests**

Add near the end of `Resources/Template/worker/worker.test.ts`, after the existing Micropub tests (the last `test("micropub: ...")` block). Reuse the file's existing `fetchWorker`/`testEnv`/`mintAccessToken`/`dpopProof` helpers as-is (defined earlier in the file for the Micropub tests) — don't redefine them:

```ts
// --- ActivityPub actor (V-4.1, #363) --------------------------------------------------------
// Composition of @dwk/activitypub's actor document, collections, and signed inbox. These run
// through worker.fetch in the workerd pool with ACTOR/AP_PRIVATE_KEY/AP_PUBLIC_KEY/
// AP_PUBLISH_TOKEN bound (see vitest.config.ts). The library's own signature/delivery internals
// are its own concern, not re-tested here.

test("activitypub: actor document is served as activity+json", async () => {
  const response = await fetchWorker(new Request("https://owner.example/users/site"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/activity+json");
  const body = await response.json() as { type: string; preferredUsername: string };
  expect(body.type).toBe("Person");
  expect(body.preferredUsername).toBe("site");
});

test("activitypub: outbox collection is served", async () => {
  const response = await fetchWorker(new Request("https://owner.example/users/site/outbox"));
  expect(response.status).toBe(200);
});

test("activitypub: nodeinfo discovery document is served", async () => {
  const response = await fetchWorker(new Request("https://owner.example/.well-known/nodeinfo"));
  expect(response.status).toBe(200);
});

test("activitypub: 503 when ACTOR isn't bound", async () => {
  const { ACTOR: _unusedActor, ...envWithoutActor } = testEnv;
  const response = await worker.fetch!(
    new Request("https://owner.example/users/site"),
    envWithoutActor as WorkerEnv,
    createExecutionContext(),
  );
  expect(response.status).toBe(503);
});

test("activitypub: /inbox still serves inbox-capture, not the ActivityPub shared inbox", async () => {
  // Regression guard for the route collision documented in worker.ts's activityPubConfig
  // (sharedInbox: false) — POST /inbox must keep going to the bespoke inbox-capture handler.
  const response = await fetchWorker(new Request("https://owner.example/inbox", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "subject=Hi&from=a%40example.com&message=hello",
  }));
  expect(response.status).toBe(202);
});

test("micropub-to-activitypub fan-out: a successful create lands a Note in the outbox", async () => {
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const createResponse = await fetchWorker(new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({
      type: ["h-entry"],
      properties: { content: ["Hello, fediverse"] },
    }),
  }));
  expect(createResponse.status).toBe(201);

  // waitUntil-scheduled work runs synchronously to completion in the workerd test pool once the
  // handler returns, so the outbox should already reflect the fan-out by the time we check it.
  const outboxResponse = await fetchWorker(new Request("https://owner.example/users/site/outbox"));
  const outbox = await outboxResponse.json() as { orderedItems?: Array<{ object?: { content?: string } }> };
  expect(outbox.orderedItems?.some((item) => item.object?.content?.includes("Hello, fediverse"))).toBe(true);
});

test("micropub-to-activitypub fan-out: never fires when ActivityPub isn't provisioned", async () => {
  const { AP_PUBLISH_TOKEN: _unusedToken, ...envWithoutToken } = testEnv;
  const { token, keyPair } = await mintAccessToken("create");
  const url = "https://owner.example/micropub";
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${token}`,
      DPoP: await dpopProof(url, "POST", keyPair, token),
    },
    body: JSON.stringify({ type: ["h-entry"], properties: { content: ["No federation here"] } }),
  });
  const response = await worker.fetch!(request, envWithoutToken as WorkerEnv, createExecutionContext());
  // Must still succeed as a plain Micropub create — the fan-out being skipped is silent, not a failure.
  expect(response.status).toBe(201);
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd Resources/Template && npm test && cd -
```

Expected: FAIL — `createActivityPub`/`ActivityPubObject` aren't imported, `handleActivityPub` doesn't exist, `/users/site` isn't routed.

- [ ] **Step 5: Implement — imports and `WorkerEnv`**

In `Resources/Template/worker/worker.ts`, add to the import block (after line 16):

```ts
import {
  createActivityPub,
  ActivityPubObject,
  type ActivityPubConfig,
} from "@dwk/activitypub";
```

Add to `WorkerEnv` (after the Micropub bindings, around line 76):

```ts
  /**
   * ActivityPub actor bindings (V-4.1, #363). All optional: a site that hasn't provisioned
   * ActivityPub has none of them bound, and every actor route degrades to 503 rather than
   * letting @dwk/activitypub throw its own loud startup error. `ACTOR` is the per-actor Durable
   * Object namespace the package ships (`ActivityPubObject`, re-exported below so wrangler can
   * bind it). `AP_PRIVATE_KEY`/`AP_PUBLIC_KEY` are the actor's signing keypair (PKCS#8/SPKI PEM,
   * app-generated — see `ActivityPubKeyProvisioning.swift`). `AP_PUBLISH_TOKEN` gates the
   * owner-only publish endpoint the Micropub fan-out below calls internally.
   * `AP_DISPLAY_NAME` is the actor's `Person.name`, threaded from `SiteSettings.displayName`;
   * falls back to a generic name when unset. See `WorkerComposition.generateWranglerToml`
   * (Swift) for the binding generation.
   */
  ACTOR?: DurableObjectNamespace;
  AP_PRIVATE_KEY?: string;
  AP_PUBLIC_KEY?: string;
  AP_PUBLISH_TOKEN?: string;
  AP_DISPLAY_NAME?: string;
```

Export the Durable Object class at module scope, near the top-level exports (not inside `export default`):

```ts
export { ActivityPubObject };
```

- [ ] **Step 6: Implement — `handleActivityPub` and the actor factory**

Add after `handleMicropub` (after line 457):

```ts
/**
 * Fixed identity for this app's single-actor-per-site model (V-4.1, #363) — no per-site
 * Settings field for a custom handle; see the design doc §"Actor identity source". WebFinger
 * (`.well-known/webfinger`, so `@site@domain` search resolves) is a separate feature (#364);
 * Mastodon can still follow this actor by pasting its URL directly into search.
 */
const ACTIVITYPUB_USERNAME = "site";

function activityPubConfig(request: Request, env: WorkerEnv): ActivityPubConfig | null {
  if (!env.ACTOR || !env.AP_PRIVATE_KEY || !env.AP_PUBLIC_KEY) return null;
  const baseUrl = new URL(request.url).origin;
  return {
    baseUrl,
    actor: {
      username: ACTIVITYPUB_USERNAME,
      name: env.AP_DISPLAY_NAME ?? new URL(baseUrl).hostname,
      summary: `Posts from ${new URL(baseUrl).hostname}`,
    },
    publicKeyPem: env.AP_PUBLIC_KEY,
    privateKeyPem: env.AP_PRIVATE_KEY,
    publishToken: env.AP_PUBLISH_TOKEN,
    // The package's shared-inbox route (POST /inbox at the origin root) collides with this
    // app's existing inbox-capture feature (#587, a public "visitor sends a message" form —
    // an unrelated concept already serving that exact path). Disabling it means inbound
    // federated deliveries go to the actor-specific /users/site/inbox instead, which is
    // equally valid ActivityPub — just without an optional batching optimization for
    // high-volume peers, irrelevant for a single-actor personal site.
    sharedInbox: false,
  };
}

/**
 * ActivityPub actor (V-4.1, #363).
 *
 * Composes `@dwk/activitypub`'s actor document, follower/following/outbox collections, and
 * signed server-to-server inbox — the Fediverse-facing half of this site. Returns 503 when
 * ActivityPub isn't fully provisioned (`ACTOR`/`AP_PRIVATE_KEY`/`AP_PUBLIC_KEY` unbound) rather
 * than letting `@dwk/activitypub` throw its own loud startup error, matching every other
 * composed handler in this file.
 */
function handleActivityPub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = activityPubConfig(request, env);
  if (!config) {
    return Promise.resolve(new Response("ActivityPub is not configured", { status: 503 }));
  }
  const activitypub = createActivityPub(config);
  return activitypub(request, env as unknown as { ACTOR: DurableObjectNamespace }, ctx);
}
```

- [ ] **Step 7: Implement — Micropub fan-out**

Modify `handleMicropub` (lines 440-457) to fan out a successful create as an ActivityPub `Note`:

```ts
function handleMicropub(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.MICROPUB_DB || !env.MEDIA || !env.AUTH_DB || !env.TOKEN_SIGNING_KEY) {
    return Promise.resolve(new Response("Micropub is not configured", { status: 503 }));
  }
  const baseUrl = new URL(request.url).origin;
  const micropub = createMicropub({ baseUrl, me: `${baseUrl}/` });
  const micropubEnv: MicropubEnv = {
    MEDIA: env.MEDIA,
    MICROPUB_DB: env.MICROPUB_DB,
    AUTH_DB: env.AUTH_DB,
    TOKEN_SIGNING_KEY: env.TOKEN_SIGNING_KEY,
  };
  return micropub(request, micropubEnv, ctx).then((response) => {
    if (request.method === "POST" && response.status === 201) {
      ctx.waitUntil(fanOutMicropubCreateToActivityPub(request, response, env, ctx));
    }
    return response;
  });
}

/**
 * Micropub-to-ActivityPub fan-out (V-4.1, #363): a successful Micropub create becomes a `Note`
 * activity, published through `@dwk/activitypub`'s owner-only publish endpoint
 * (`POST <actor>/outbox`) so it lands in the outbox and fans out to followers. In-process —
 * same Worker script, same invocation this request is already inside, no real network
 * round-trip. Only runs when ActivityPub is provisioned (`AP_PUBLISH_TOKEN` set); activating
 * Micropub alone never attempts to federate. Failure here must never fail the Micropub create
 * response (the post is already saved) — logged and swallowed.
 */
async function fanOutMicropubCreateToActivityPub(
  originalRequest: Request,
  micropubResponse: Response,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!env.AP_PUBLISH_TOKEN) return;
  const location = micropubResponse.headers.get("location");
  if (!location) return;

  let content = "";
  try {
    const contentType = originalRequest.headers.get("content-type") ?? "";
    const cloned = originalRequest.clone();
    if (contentType.includes("application/json")) {
      const body = (await cloned.json()) as { properties?: { content?: unknown[] } };
      content = String(body.properties?.content?.[0] ?? "");
    } else {
      const form = await cloned.formData();
      content = String(form.get("content") ?? form.get("properties[content]") ?? "");
    }
  } catch {
    return; // Can't recover the post content — skip the fan-out rather than publish an empty Note.
  }
  if (!content) return;

  const baseUrl = new URL(originalRequest.url).origin;
  const actorIRI = `${baseUrl}/users/${ACTIVITYPUB_USERNAME}`;
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    attributedTo: actorIRI,
    content,
    url: location,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
  const publishRequest = new Request(`${actorIRI}/outbox`, {
    method: "POST",
    headers: {
      "content-type": "application/activity+json",
      authorization: `Bearer ${env.AP_PUBLISH_TOKEN}`,
    },
    body: JSON.stringify(note),
  });
  try {
    await handleActivityPub(publishRequest, env, ctx);
  } catch {
    // Swallow: the Micropub post is already saved; a federation hiccup must not surface as a
    // failure to the Micropub client.
  }
}
```

- [ ] **Step 8: Implement — `ROUTES` entries**

Add to the `ROUTES` array (after the Micropub media entries, before the closing `];` around line 636):

```ts
  {
    // Actor document + outbox/followers/following collections (V-4.1, #363).
    path: "/users/",
    match: "prefix",
    methods: ["GET", "POST", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
  {
    path: "/.well-known/nodeinfo",
    match: "exact",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
  {
    path: "/nodeinfo/",
    match: "prefix",
    methods: ["GET", "HEAD"],
    handler: (request, env, ctx) => handleActivityPub(request, env, ctx),
  },
```

Note: deliberately no `/inbox` entry here — see Step 6's comment on `sharedInbox: false`. The existing `/inbox → handleInbox` entry (inbox-capture, #587) is untouched.

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd Resources/Template && npm test && cd -
```

Expected: PASS (full file green — all existing tests plus the new ones from Step 3)

- [ ] **Step 10: Run the full JS check suite**

```bash
cd Resources/Template && npm run lint && npm run typecheck && npm test && cd -
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
git add Resources/Template/worker/worker.ts Resources/Template/worker/worker.test.ts Resources/Template/vitest.config.ts Resources/Template/package.json Resources/Template/package-lock.json
git commit -m "feat(#363): compose the ActivityPub actor and Micropub fan-out into worker.ts"
```

---

### Task 9: Full-suite verification and template asset sync

Per this repo's `AGENTS.md`/`CLAUDE.md`: touching `Resources/Template/` requires running the Swift suite too (some Swift tests couple to the template markup), and any worktree needs `xcodegen generate` before building if the project file is stale.

**Files:** none (verification only).

- [ ] **Step 1: Regenerate the Xcode project if needed**

```bash
xcodegen generate
```

- [ ] **Step 2: Full Swift test suite**

```bash
swift test --package-path . 2>&1 | tail -100
```

Expected: PASS, no regressions anywhere (not just the files this plan touched — `IntegrationTemplateAssetsTests` and similar template-coupled suites must still pass).

- [ ] **Step 3: Full app build**

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -60
```

Expected: BUILD SUCCEEDED

- [ ] **Step 4: Full JS suite**

```bash
cd Resources/Template && npm run lint && npm run typecheck && npm test && cd -
```

Expected: all PASS

- [ ] **Step 5: Confirm the `activitypub` conformance advisory fires with no new code**

Sanity-check that `WorkersConformanceStatus.phaseRequirements[.v4]` already includes `@dwk/activitypub` (it does — `Sources/AnglesiteCore/WorkersConformance.swift:50`), so `WorkerActivation.conformanceAdvisory` needs no change for this issue:

```bash
swift test --package-path . --filter WorkerActivationTests 2>&1 | tail -30
```

Expected: PASS (no changes needed; this just confirms nothing broke).

- [ ] **Step 6: No commit for this task** — it's verification-only. If anything failed, fix it in the relevant earlier task's files and create a NEW commit for the fix — never amend an earlier task's commit (see `CLAUDE.md`: "Always create NEW commits rather than amending").

---

## Follow-ups explicitly out of scope

- [#364](https://github.com/Anglesite/Anglesite-app/issues/364) — WebFinger.
- Epic #338 sub-task 4.2 — follower management UI.
- Epic #338 sub-task 4.3 — Microsub reader.
- [#926](https://github.com/Anglesite/Anglesite-app/issues/926) — sync pre-existing Astro content into the outbox.
