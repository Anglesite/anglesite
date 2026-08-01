# Publish-time domain step (#1180) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner declare buy/transfer/later for their site's domain after creation — a one-time nudge on the site's first successful publish, plus a permanent `Website ▸ Connect a Domain…` menu item — feeding the existing `.site-config`/`Source/anglesite.json` fields `CustomDomainAttachCommand` and `DeployCommand` already consume.

**Architecture:** Two new `AnglesiteCore` command types do all the file I/O (`DomainIntentRecorder` for the shared `anglesite.json` write, `ConnectDomainCommand` for `.site-config` + that recorder); a new `AnglesiteApp` sub-model (`ConnectDomainModel`) and sheet (`ConnectDomainSheetView`) follow the existing `HardenModel`/`DomainModel` pattern exactly, owned by `SiteWindowModel`. `DeployModel` gains a `wasFirstDeploy` flag (read from `.site-config`'s `CF_WORKER_DEPLOYED` before the deploy runs) that `DeployDrawerView` consults to show the one-time nudge. No new network calls anywhere in this plan — the sheet only writes local files; the actual Workers Custom Domain attach stays entirely owned by the existing `CustomDomainAttachCommand`, unchanged.

**Tech Stack:** Swift 6.4, SwiftUI (`@Observable`/`@MainActor`), Swift Testing (`Testing` framework, not XCTest, for every new test file).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-publish-time-domain-step-design.md` — every task below implements one of its numbered design sections; re-read it if a step here seems ambiguous.
- No frameworks beyond Apple's; no new dependencies (CONTRIBUTING.md).
- Swift/SwiftUI + AnglesiteCore/AnglesiteApp module layering: file I/O and business logic live in `AnglesiteCore`; SwiftUI state/presentation lives in `AnglesiteApp` (compiled as the `AnglesiteAppCore` SwiftPM target — tests `@testable import AnglesiteAppCore`, not `AnglesiteApp`).
- Every new test file uses `Testing` (`import Testing`, `@Test`, `#expect`), matching every other file in `Tests/AnglesiteCoreTests`/`Tests/AnglesiteAppTests` touched by this plan — never XCTest.
- Conventional commits, subject ≤72 characters, reference `#1180` (CONTRIBUTING.md ▸ "Commits and pull requests").
- Run `swift test --package-path .` after every task; run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` after the UI-facing tasks (7–10) and once more at the end.
- New user-facing text (`"Connect a Domain…"` menu item, sheet copy) needs a String Catalog sync per CONTRIBUTING.md's `xcrun xcstringstool sync` recipe if built via CLI-only `xcodebuild` rather than the Xcode IDE — Task 11 covers this.
- Sheet copy is exact and deliberate (spec §2): "Keep it at your current registrar — you'll add it to Cloudflare and point its nameservers there. We'll connect it automatically on your next Publish once that's done." — `DOMAIN_CHOICE=transfer` means nameserver delegation, never registrar transfer; don't paraphrase this away.
- No hostname format validation beyond non-empty/trim (spec §2) — matches `DomainModel.resolveAndLoad`'s existing behavior. Do not add a regex/format validator.
- No network calls anywhere in `ConnectDomainCommand`/`ConnectDomainModel`/`ConnectDomainSheetView` — only local file writes and (in the view layer only) `NSWorkspace.shared.open` for the Cloudflare Domains link.

---

### Task 1: `DomainIntentRecorder` — shared `anglesite.json` domain-intent writer

**Files:**
- Create: `Sources/AnglesiteCore/DomainIntentRecorder.swift`
- Modify: `Sources/AnglesiteCore/CustomDomainAttachCommand.swift:89-96` (the `persistDomainIntent` method and its one call site at line 44)
- Test: `Tests/AnglesiteCoreTests/DomainIntentRecorderTests.swift`

**Interfaces:**
- Produces: `DomainIntentRecorder.recordTransferIntent(hostname: String, siteDirectory: URL)`, `DomainIntentRecorder.recordBuyIntent(siteDirectory: URL)` — both `public static func`, both used by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/DomainIntentRecorderTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct DomainIntentRecorderTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir() throws -> URL {
        let dir = tmpDir.appendingPathComponent("domain-intent-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("recordTransferIntent writes hostname/choice/attach into anglesite.json's domain section")
    func recordTransferIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordTransferIntent(hostname: "example.com", siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain == DomainConfig.Domain(hostname: "example.com", choice: "transfer", attach: true))
    }

    @Test("recordBuyIntent writes a nil-hostname buy declaration")
    func recordBuyIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain == DomainConfig.Domain(hostname: nil, choice: "buy", attach: false))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DomainIntentRecorderTests`
Expected: FAIL to build — `DomainIntentRecorder` doesn't exist yet.

- [ ] **Step 3: Create `DomainIntentRecorder`**

Create `Sources/AnglesiteCore/DomainIntentRecorder.swift`:

```swift
import Foundation

/// Writes a site's domain intent into `Source/anglesite.json`'s `domain` section (#1169/#1170) —
/// the single place `CustomDomainAttachCommand` (post-deploy, transfer-only) and
/// `ConnectDomainCommand` (the Connect a Domain sheet, #1180) both go through, so the two call
/// sites can't drift on what a "transfer" or "buy" declaration looks like on disk.
public enum DomainIntentRecorder {
    /// Declares an owned-domain (`transfer`) intent: `attach: true` records that the owner wants
    /// this hostname attached as a Workers Custom Domain once its zone is live on the connected
    /// Cloudflare account — the confirmed-live receipt itself is `.site-config`'s
    /// `CF_DOMAIN_ATTACHED`, written separately (`CustomDomainAttachCommand.persistAttached`) once
    /// attach actually succeeds. Best-effort — a write failure here must never surface as an
    /// error to the caller (matches `CustomDomainAttachCommand`'s existing posture).
    public static func recordTransferIntent(hostname: String, siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: hostname, choice: NewSiteDomainChoice.transfer.rawValue, attach: true)
        try? store.save(config)
    }

    /// Declares a buy-a-domain intent: no hostname exists yet, so `attach` is `false` — there is
    /// nothing to attach until the owner comes back with a real hostname (via the transfer path
    /// above, once they've bought one). Best-effort, matching `recordTransferIntent`.
    public static func recordBuyIntent(siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: nil, choice: NewSiteDomainChoice.buy.rawValue, attach: false)
        try? store.save(config)
    }
}
```

- [ ] **Step 4: Refactor `CustomDomainAttachCommand` to use it**

In `Sources/AnglesiteCore/CustomDomainAttachCommand.swift`, replace the call at line 44:

```swift
        persistDomainIntent(hostname: hostname, siteDirectory: siteDirectory)
```

with:

```swift
        DomainIntentRecorder.recordTransferIntent(hostname: hostname, siteDirectory: siteDirectory)
```

Then delete the now-unused private method (lines 89–96, the `persistDomainIntent` doc comment and body):

```swift
    /// Mirrors the `.site-config` `DOMAIN_CHOICE`/`DOMAIN` intent this method already read above
    /// into `Source/anglesite.json`'s `domain` section (#1170) — `attach: true` records the
    /// owner's intent, distinct from `CF_DOMAIN_ATTACHED` in `.site-config`, which stays the
    /// confirmed-live receipt (`persistAttached`, below). Runs on every `attach()` call that has
    /// a transfer intent to declare, not just a freshly-successful one, so the declaration exists
    /// even before the domain is confirmed on the Cloudflare account. Best-effort, matching this
    /// type's existing posture for `persistAttached`.
    private func persistDomainIntent(hostname: String, siteDirectory: URL) {
        let store = DomainConfigStore(sourceDirectory: siteDirectory)
        var config = (try? store.load()) ?? DomainConfig()
        config.domain = DomainConfig.Domain(
            hostname: hostname, choice: NewSiteDomainChoice.transfer.rawValue, attach: true)
        try? store.save(config)
    }

```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path . --filter DomainIntentRecorderTests`
Expected: PASS (2 tests)

Also run the existing suite to confirm the refactor didn't change behavior:

Run: `swift test --package-path . --filter CustomDomainAttachCommandTests`
Expected: PASS (all pre-existing tests, unchanged)

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/DomainIntentRecorder.swift Sources/AnglesiteCore/CustomDomainAttachCommand.swift Tests/AnglesiteCoreTests/DomainIntentRecorderTests.swift
git commit -m "refactor(#1180): extract DomainIntentRecorder from CustomDomainAttachCommand"
```

---

### Task 2: `ConnectDomainCommand` — `.site-config` write + shared intent recorder

**Files:**
- Create: `Sources/AnglesiteCore/ConnectDomainCommand.swift`
- Test: `Tests/AnglesiteCoreTests/ConnectDomainCommandTests.swift`

**Interfaces:**
- Consumes: `DomainIntentRecorder.recordTransferIntent`/`recordBuyIntent` (Task 1); `SiteConfigFile.upsert(_:into:)`, `SiteConfigFile.value(forKey:in:)`, `WebsiteAnalyticsAsset.configRelativePath`, `NewSiteDomainChoice` (all pre-existing).
- Produces: `ConnectDomainCommand.recordBuy(siteDirectory: URL)`, `ConnectDomainCommand.recordTransfer(hostname: String, siteDirectory: URL)` — both `public static func`, both used by Task 5 (`ConnectDomainModel`).

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/ConnectDomainCommandTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct ConnectDomainCommandTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir() throws -> URL {
        let dir = tmpDir.appendingPathComponent("connect-domain-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("recordBuy writes DOMAIN_CHOICE=buy to .site-config and a buy intent to anglesite.json")
    func recordBuyWritesBothFiles() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordBuy(siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=buy"))
        #expect(!config.contains("DOMAIN="))

        let domainConfig = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(domainConfig.domain == DomainConfig.Domain(hostname: nil, choice: "buy", attach: false))
    }

    @Test("recordTransfer writes DOMAIN_CHOICE/DOMAIN to .site-config and a transfer intent to anglesite.json")
    func recordTransferWritesBothFiles() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordTransfer(hostname: "example.com", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.com"))

        let domainConfig = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(domainConfig.domain == DomainConfig.Domain(hostname: "example.com", choice: "transfer", attach: true))
    }

    @Test("recordTransfer overwrites a previous hostname rather than duplicating the DOMAIN line")
    func recordTransferOverwritesPreviousHostname() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordTransfer(hostname: "old.example.com", siteDirectory: dir)
        ConnectDomainCommand.recordTransfer(hostname: "new.example.com", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN=new.example.com"))
        #expect(!config.contains("DOMAIN=old.example.com"))
        let domainLines = config.split(separator: "\n").filter { $0.hasPrefix("DOMAIN=") }
        #expect(domainLines.count == 1)
    }

    @Test("recordBuy preserves unrelated existing .site-config lines")
    func recordBuyPreservesUnrelatedLines() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try "SITE_NAME=My Site\n".write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        ConnectDomainCommand.recordBuy(siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SITE_NAME=My Site"))
        #expect(config.contains("DOMAIN_CHOICE=buy"))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter ConnectDomainCommandTests`
Expected: FAIL to build — `ConnectDomainCommand` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/ConnectDomainCommand.swift`:

```swift
import Foundation

/// Records the owner's buy/transfer choice from the "Connect a Domain" sheet (#1180) into both
/// `.site-config` (`DOMAIN_CHOICE`/`DOMAIN` — what `CustomDomainAttachCommand`/`DeployCommand`
/// already consume) and `Source/anglesite.json`'s `domain` section (via `DomainIntentRecorder`,
/// shared with `CustomDomainAttachCommand`'s own post-deploy write). No network calls — the
/// actual Workers Custom Domain attach stays entirely owned by `CustomDomainAttachCommand`, which
/// already runs on every deploy and will pick up a freshly-written `DOMAIN_CHOICE=transfer` on
/// the owner's next Publish.
public enum ConnectDomainCommand {
    /// "Buy a domain" — no hostname exists yet. Writes `DOMAIN_CHOICE=buy` as an intent marker;
    /// nothing currently reads it back except as bookkeeping (the sheet itself opens the
    /// Cloudflare Domains link separately, in the view layer).
    public static func recordBuy(siteDirectory: URL) {
        writeSiteConfigChoice(.buy, hostname: nil, siteDirectory: siteDirectory)
        DomainIntentRecorder.recordBuyIntent(siteDirectory: siteDirectory)
    }

    /// "I already own a domain" — `hostname` is the owner's typed-in domain (trimmed, non-empty;
    /// callers validate before calling this). Writes `DOMAIN_CHOICE=transfer` + `DOMAIN=hostname`
    /// so the existing `CustomDomainAttachCommand` step in the deploy pipeline attaches it on the
    /// owner's next Publish — this command performs no attach itself.
    public static func recordTransfer(hostname: String, siteDirectory: URL) {
        writeSiteConfigChoice(.transfer, hostname: hostname, siteDirectory: siteDirectory)
        DomainIntentRecorder.recordTransferIntent(hostname: hostname, siteDirectory: siteDirectory)
    }

    private static func writeSiteConfigChoice(
        _ choice: NewSiteDomainChoice, hostname: String?, siteDirectory: URL
    ) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        var entries: [(key: String, value: String)] = [("DOMAIN_CHOICE", choice.rawValue)]
        if let hostname { entries.append(("DOMAIN", hostname)) }
        let updated = SiteConfigFile.upsert(entries, into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ConnectDomainCommandTests`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ConnectDomainCommand.swift Tests/AnglesiteCoreTests/ConnectDomainCommandTests.swift
git commit -m "feat(#1180): add ConnectDomainCommand for buy/transfer intent writes"
```

---

### Task 3: `DeployCommand.hasDeployedBefore` — first-deploy detection

**Files:**
- Modify: `Sources/AnglesiteCore/DeployCommand.swift:471-477` (insert after `persistWorkerDeployed`)
- Test: `Tests/AnglesiteCoreTests/DeployCommandTests.swift`

**Interfaces:**
- Produces: `DeployCommand.hasDeployedBefore(siteDirectory: URL) -> Bool` — `public static func`, used by Task 4 (`DeployModel`).

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/DeployCommandTests.swift` (inside the existing test struct — check the file's existing `@Suite`/`struct` name and add these as new `@Test` methods, matching its existing temp-directory fixture helper if one exists; otherwise use this self-contained form):

```swift
    @Test("hasDeployedBefore is false when CF_WORKER_DEPLOYED is absent")
    func hasDeployedBeforeFalseWhenAbsent() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(!DeployCommand.hasDeployedBefore(siteDirectory: dir))
    }

    @Test("hasDeployedBefore is true when CF_WORKER_DEPLOYED is set")
    func hasDeployedBeforeTrueWhenSet() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try "CF_WORKER_DEPLOYED=true\n".write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCommand.hasDeployedBefore(siteDirectory: dir))
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DeployCommandTests`
Expected: FAIL to build — `hasDeployedBefore` doesn't exist yet.

- [ ] **Step 3: Add the implementation**

In `Sources/AnglesiteCore/DeployCommand.swift`, insert immediately after `persistWorkerDeployed` (after line 477, before `persistWorkerProvisioned`):

```swift

    /// Whether this site has already completed at least one successful deploy — the same
    /// `.site-config` `CF_WORKER_DEPLOYED` signal `persistWorkerDeployed` writes and
    /// `checkWorkerNameConflict` reads. A read-only counterpart for callers (`DeployModel`) that
    /// need to know, *before* a deploy runs, whether this one would be the site's first — without
    /// duplicating the file read `checkWorkerNameConflict` already does inline. Public (unlike its
    /// siblings) because `DeployModel` lives in a different module.
    public static func hasDeployedBefore(siteDirectory: URL) -> Bool {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        return SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) != nil
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DeployCommandTests`
Expected: PASS (all `DeployCommandTests`, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DeployCommand.swift Tests/AnglesiteCoreTests/DeployCommandTests.swift
git commit -m "feat(#1180): add DeployCommand.hasDeployedBefore for first-deploy detection"
```

---

### Task 4: `DeployModel.wasFirstDeploy`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployModel.swift:54` (new property, alongside `domainAttachStatus`), `Sources/AnglesiteApp/DeployModel.swift:466` (capture at the start of `runDeploy`)
- Test: `Tests/AnglesiteAppTests/DeployModelTests.swift`

**Interfaces:**
- Consumes: `DeployCommand.hasDeployedBefore(siteDirectory:)` (Task 3).
- Produces: `DeployModel.wasFirstDeploy: Bool` (`private(set) var`, default `false`) — read by `DeployDrawerView` in Task 10.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteAppTests/DeployModelTests.swift`, inside the `DeployModelTests` struct (it already has `import Foundation`, `import Testing`, `import AnglesiteCore`, `@testable import AnglesiteAppCore`, and the `GatedDeployExecutor` fake this test reuses):

```swift
    @Test("wasFirstDeploy is true only when CF_WORKER_DEPLOYED was absent before this deploy")
    func wasFirstDeployReflectsPriorDeployHistory() async {
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }
        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded on first deploy, got \(model.phase)"); return
        }
        #expect(model.wasFirstDeploy)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }
        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded on second deploy, got \(model.phase)"); return
        }
        #expect(!model.wasFirstDeploy)
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter DeployModelTests/wasFirstDeployReflectsPriorDeployHistory`
Expected: FAIL to build — `wasFirstDeploy` doesn't exist yet.

- [ ] **Step 3: Add the property**

In `Sources/AnglesiteApp/DeployModel.swift`, immediately after line 54 (`private(set) var domainAttachStatus: CustomDomainAttachCommand.Result?`), add:

```swift
    /// Whether the deploy currently in flight (or most recently completed) is this site's first
    /// successful publish — captured from `.site-config`'s `CF_WORKER_DEPLOYED` *before* the
    /// deploy pipeline runs (#1180), so it reflects the site's history going into this attempt,
    /// not the flag `DeployCommand` writes as a side effect of this same deploy succeeding.
    /// `DeployDrawerView` reads this on `.succeeded` to show the one-time "connect a domain?"
    /// nudge — it can structurally never be true again for a site after its first successful
    /// deploy, since that deploy is what sets `CF_WORKER_DEPLOYED`.
    private(set) var wasFirstDeploy: Bool = false
```

- [ ] **Step 4: Capture it at the start of `runDeploy`**

In `Sources/AnglesiteApp/DeployModel.swift`, in `runDeploy` immediately after line 466 (`transition(siteID: siteID, to: .running(siteID: siteID, since: Date()))`), add:

```swift
        wasFirstDeploy = !DeployCommand.hasDeployedBefore(siteDirectory: siteDirectory)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `swift test --package-path . --filter DeployModelTests/wasFirstDeployReflectsPriorDeployHistory`
Expected: PASS

Also run the full `DeployModelTests` suite to confirm nothing else regressed:

Run: `swift test --package-path . --filter DeployModelTests`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/DeployModel.swift Tests/AnglesiteAppTests/DeployModelTests.swift
git commit -m "feat(#1180): capture DeployModel.wasFirstDeploy for the connect-domain nudge"
```

---

### Task 5: `ConnectDomainModel`

**Files:**
- Create: `Sources/AnglesiteApp/ConnectDomainModel.swift`
- Test: `Tests/AnglesiteAppTests/ConnectDomainModelTests.swift`

**Interfaces:**
- Consumes: `ConnectDomainCommand.recordBuy`/`recordTransfer` (Task 2); `CurrentSite` (existing, `Sources/AnglesiteApp/CurrentSite.swift`).
- Produces: `ConnectDomainModel` class with `phase: Phase` (`.choosing`/`.enteringHostname`/`.connected(hostname: String)`), `sheetPresented: Bool`, `hostnameInput: String`, `configure(site: CurrentSite)`, `openSheet()`, `dismissSheet()`, `notNow()`, `chooseBuy()`, `beginTransfer()`, `submitTransfer()`, and `static let cloudflareDomainsURL: URL` — all used by Task 6 (`ConnectDomainSheetView`), Task 7 (`SiteWindowModel`), and Task 10 (`DeployDrawerView`'s caller).

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/ConnectDomainModelTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@MainActor
@Suite struct ConnectDomainModelTests {
    private func makeSite() throws -> (site: CurrentSite, dir: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return (CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp), tmp)
    }

    @Test func openSheetResetsToChoosingPhase() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)

        model.hostnameInput = "stale.example.com"
        model.openSheet()

        #expect(model.phase == .choosing)
        #expect(model.hostnameInput.isEmpty)
        #expect(model.sheetPresented)
    }

    @Test func notNowDismissesWithoutWritingSiteConfig() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.notNow()

        #expect(!model.sheetPresented)
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }

    @Test func chooseBuyRecordsIntentAndDismisses() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.chooseBuy()

        #expect(!model.sheetPresented)
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=buy"))
    }

    @Test func beginTransferThenSubmitRecordsHostnameAndTransitionsToConnected() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.beginTransfer()
        #expect(model.phase == .enteringHostname)

        model.hostnameInput = "  Example.com  "
        model.submitTransfer()

        #expect(model.phase == .connected(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.com"))
    }

    @Test func submitTransferWithEmptyHostnameIsANoOp() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.beginTransfer()

        model.hostnameInput = "   "
        model.submitTransfer()

        #expect(model.phase == .enteringHostname)
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter ConnectDomainModelTests`
Expected: FAIL to build — `ConnectDomainModel` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteApp/ConnectDomainModel.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// Drives the "Connect a Domain" sheet (#1180): buy/transfer/later, reachable from the
/// first-publish nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
/// Every action is a synchronous local file write via `ConnectDomainCommand` — no network calls,
/// unlike `HardenModel`/`DomainModel`. The actual Workers Custom Domain attach stays owned by
/// `CustomDomainAttachCommand`, which already runs on every deploy.
@MainActor
@Observable
final class ConnectDomainModel {
    enum Phase: Equatable {
        case choosing
        case enteringHostname
        case connected(hostname: String)
    }

    private(set) var phase: Phase = .choosing
    var sheetPresented: Bool = false
    var hostnameInput: String = ""

    private var currentSite: CurrentSite?

    /// The Cloudflare Domains marketing page — opened by the view layer's "Buy a domain" button,
    /// not by `chooseBuy()` itself, so this model stays free of `NSWorkspace`/AppKit side effects
    /// and is fully testable (matches `WebsiteCommands`'s "View on GitHub" convention of keeping
    /// `NSWorkspace.shared.open` out of the model layer).
    static let cloudflareDomainsURL = URL(string: "https://www.cloudflare.com/products/registrar/")!

    /// Threaded from `SiteWindowModel.loadAndStart`, mirroring `DomainModel.configure(site:)`.
    func configure(site: CurrentSite) {
        currentSite = site
    }

    func openSheet() {
        phase = .choosing
        hostnameInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        sheetPresented = false
    }

    /// "Not now" — dismisses without writing anything. `DOMAIN_CHOICE` stays whatever it already
    /// was (`later` by default), so this is a true no-op.
    func notNow() {
        dismissSheet()
    }

    /// "Buy a domain" — records the buy intent and dismisses. Opening Cloudflare Domains in the
    /// browser is the view's job (see `cloudflareDomainsURL`'s doc comment).
    func chooseBuy() {
        guard let site = currentSite else { return }
        ConnectDomainCommand.recordBuy(siteDirectory: site.sourceDirectory)
        dismissSheet()
    }

    /// "I already own a domain" — reveals the hostname field.
    func beginTransfer() {
        phase = .enteringHostname
    }

    /// Submits the typed hostname. No format validation beyond non-empty/trim, matching
    /// `DomainModel.resolveAndLoad` — a malformed hostname simply won't resolve a Cloudflare zone
    /// on the next deploy, surfaced there exactly like today's `.notConnected` outcome.
    func submitTransfer() {
        guard case .enteringHostname = phase, let site = currentSite else { return }
        let hostname = hostnameInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !hostname.isEmpty else { return }
        ConnectDomainCommand.recordTransfer(hostname: hostname, siteDirectory: site.sourceDirectory)
        phase = .connected(hostname: hostname)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ConnectDomainModelTests`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/ConnectDomainModel.swift Tests/AnglesiteAppTests/ConnectDomainModelTests.swift
git commit -m "feat(#1180): add ConnectDomainModel"
```

---

### Task 6: `ConnectDomainSheetView`

**Files:**
- Create: `Sources/AnglesiteApp/ConnectDomainSheetView.swift`

**Interfaces:**
- Consumes: `ConnectDomainModel` (Task 5) — `phase`, `hostnameInput`, `sheetPresented`, `openSheet()`/`dismissSheet()`/`notNow()`/`chooseBuy()`/`beginTransfer()`/`submitTransfer()`, `ConnectDomainModel.cloudflareDomainsURL`.
- Produces: `ConnectDomainSheetView(model: ConnectDomainModel)` — a SwiftUI `View`, used by Task 9 (`SiteWindow.swift` sheet registration).

No automated test — this codebase doesn't unit-test SwiftUI views (confirmed: `HardenSheetView`/`DomainSheetView`/`BlockedDeploySheetView` have no corresponding test files; only their backing models do). Verified by the build in Step 2 and manually in Task 11.

- [ ] **Step 1: Write the view**

Create `Sources/AnglesiteApp/ConnectDomainSheetView.swift`:

```swift
import SwiftUI
import AppKit

/// The "Connect a Domain" sheet (#1180) — buy/transfer/later, reachable from the first-publish
/// nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
struct ConnectDomainSheetView: View {
    @Bindable var model: ConnectDomainModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            footer
        }
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "globe")
                .font(.title)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Connect a Domain").font(.title3).fontWeight(.semibold)
                Text("Replace the workers.dev address with your own.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .choosing:
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    NSWorkspace.shared.open(ConnectDomainModel.cloudflareDomainsURL)
                    model.chooseBuy()
                } label: {
                    Label("Buy a domain", systemImage: "cart")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)

                Button {
                    model.beginTransfer()
                } label: {
                    Label("I already own a domain", systemImage: "checkmark.seal")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            }

        case .enteringHostname:
            VStack(alignment: .leading, spacing: 8) {
                TextField("example.com", text: $model.hostnameInput)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { model.submitTransfer() }
                Text("Keep it at your current registrar — you'll add it to Cloudflare and point its nameservers there. We'll connect it automatically on your next Publish once that's done.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Connect") { model.submitTransfer() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.hostnameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

        case .connected(let hostname):
            Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
    }

    @ViewBuilder
    private var footer: some View {
        HStack {
            if case .connected = model.phase {
                Spacer()
                Button("Done") { model.dismissSheet() }
                    .keyboardShortcut(.defaultAction)
            } else {
                Button("Not now") { model.notNow() }
                Spacer()
            }
        }
        .padding(16)
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED (the view isn't wired into `SiteWindow.swift` yet, so it isn't reachable, but it must still compile standalone)

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/ConnectDomainSheetView.swift
git commit -m "feat(#1180): add ConnectDomainSheetView"
```

---

### Task 7: Wire `ConnectDomainModel` into `SiteWindowModel`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:156` (new property, alongside `domain`), `Sources/AnglesiteApp/SiteWindowModel.swift:1924` (configure call, alongside `domain.configure`)

**Interfaces:**
- Consumes: `ConnectDomainModel` (Task 5).
- Produces: `SiteWindowModel.connectDomain: ConnectDomainModel` — used by Task 8 (`WebsiteCommands.swift`), Task 9 (`SiteWindow.swift` sheet), and Task 10 (`DeployDrawerView`'s caller).

No new automated test — this is pure plumbing between two already-tested models; covered by the existing `SiteWindowModel` test suite continuing to pass and by manual verification in Task 11.

- [ ] **Step 1: Add the property**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, immediately after line 156 (`var domain = DomainModel()`), add:

```swift
    var connectDomain = ConnectDomainModel()
```

- [ ] **Step 2: Configure it on site load**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, immediately after line 1924 (`domain.configure(site: currentSite)`), add:

```swift
        connectDomain.configure(site: currentSite)
```

- [ ] **Step 3: Build and run the existing SiteWindowModel test suite**

Run: `swift test --package-path . --filter SiteWindowModelTests`
Expected: PASS (unchanged — this task adds no new behavior an existing test could regress)

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift
git commit -m "feat(#1180): wire ConnectDomainModel into SiteWindowModel"
```

---

### Task 8: `Website ▸ Connect a Domain…` menu item

**Files:**
- Modify: `Sources/AnglesiteApp/WebsiteCommands.swift:76-77` (insert after the existing `Button("Domain…")`)

**Interfaces:**
- Consumes: `SiteWindowModel.connectDomain` (Task 7).

- [ ] **Step 1: Add the menu item**

In `Sources/AnglesiteApp/WebsiteCommands.swift`, immediately after the existing:

```swift
            Button("Domain…") { model?.domain.openSheet() }
                .disabled(model?.canOpenDomain != true)
```

add:

```swift

            Button("Connect a Domain…") { model?.connectDomain.openSheet() }
                .disabled(model == nil)
```

(Enabled whenever a site window is focused — unlike `Domain…`'s `canOpenDomain` gate, this must work *before* a domain exists, since declaring intent is the whole point.)

> **Implementation note (final-review fix, #1202):** shipped as `.disabled(model?.site == nil)` rather than `model == nil` as drafted above. A `SiteWindowModel` can exist before its `site` property is populated, so gating on `model == nil` let the menu item enable itself in that window before there was a site to attach a domain to, silently no-oping on an early click. Gating on `model?.site == nil` disables it until a site is actually loaded, which is what "enabled whenever a site window is focused" was meant to guarantee.

- [ ] **Step 2: Build to verify it compiles**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/WebsiteCommands.swift
git commit -m "feat(#1180): add Website > Connect a Domain… menu item"
```

---

### Task 9: Register the sheet in `SiteWindow.swift`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:635-637` (insert a new `.sheet` modifier alongside the `domain.sheetPresented` one)

**Interfaces:**
- Consumes: `SiteWindowModel.connectDomain` (Task 7), `ConnectDomainSheetView` (Task 6).

- [ ] **Step 1: Add the sheet modifier**

In `Sources/AnglesiteApp/SiteWindow.swift`, immediately after the existing:

```swift
        .sheet(isPresented: $bindableModel.domain.sheetPresented) {
            DomainSheetView(model: model.domain)
        }
```

add:

```swift
        .sheet(isPresented: $bindableModel.connectDomain.sheetPresented) {
            ConnectDomainSheetView(model: model.connectDomain)
        }
```

- [ ] **Step 2: Build and manually verify the menu path**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

Launch the built app, open (or create) a site, choose **Website ▸ Connect a Domain…**, and confirm the sheet opens showing "Buy a domain" / "I already own a domain". Click "I already own a domain", type a hostname, click Connect, confirm it shows "We'll connect `<hostname>` on your next Publish." and that `.site-config` in the site's `Source/` directory now contains `DOMAIN_CHOICE=transfer` and `DOMAIN=<hostname>`.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1180): register the Connect a Domain sheet in SiteWindow"
```

---

### Task 10: First-publish nudge in `DeployDrawerView`

**Files:**
- Modify: `Sources/AnglesiteApp/DeployDrawerView.swift:15-18` (new `onConnectDomain` stored property), `Sources/AnglesiteApp/DeployDrawerView.swift:41-74` (new conditional line in `header`)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:269` (pass the new closure at the `DeployDrawerView(...)` call site)

**Interfaces:**
- Consumes: `DeployModel.wasFirstDeploy` (Task 4), `SiteWindowModel.connectDomain.openSheet()` (Task 7).

No new automated test — `wasFirstDeploy`'s value is already covered by Task 4's `DeployModelTests`; this task only wires that value into a view, which this codebase doesn't unit-test (see Task 6). Covered by manual verification in Step 3 below and in Task 11.

- [ ] **Step 1: Add the `onConnectDomain` property and banner**

In `Sources/AnglesiteApp/DeployDrawerView.swift`, add a new stored property alongside `let siteName: String` (line 17):

```swift
    let siteName: String
    /// Opens the Connect a Domain sheet (#1180) — wired to `SiteWindowModel.connectDomain.openSheet()`
    /// by `SiteWindow`. Threaded as a closure (matching `AuditSheetView`'s `onRunAgain`) rather than
    /// reaching into `SiteWindowModel` directly, since this view is only ever handed `DeployModel`.
    let onConnectDomain: () -> Void
```

Then, inside `header`'s inner `VStack` (immediately after the existing `.conflict` caption block, i.e. right after the closing brace of the `if case .succeeded = model.phase, case .conflict(let hostname, let ownedBy) = model.domainAttachStatus { ... }` block and before that `VStack`'s own closing brace), add:

```swift
                // First-publish nudge (#1180): shown exactly once, on the deploy that flips
                // `.site-config`'s CF_WORKER_DEPLOYED from unset to set. `wasFirstDeploy`
                // structurally cannot be true again for this site afterward, so this line cannot
                // reappear on a later deploy — no separate "already prompted" flag is needed.
                if case .succeeded = model.phase, model.wasFirstDeploy {
                    HStack(spacing: 4) {
                        Text("Your site is live. Connect a domain?")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button("Connect a domain…", action: onConnectDomain)
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                }
```

- [ ] **Step 2: Update the call site**

In `Sources/AnglesiteApp/SiteWindow.swift`, replace:

```swift
                    DeployDrawerView(model: model.deploy, siteName: site.name)
```

with:

```swift
                    DeployDrawerView(
                        model: model.deploy, siteName: site.name,
                        onConnectDomain: { model.connectDomain.openSheet() }
                    )
```

- [ ] **Step 3: Build and manually verify**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

Launch the app, create a brand-new site, publish it for the first time, and confirm the deploy drawer's success state shows "Your site is live. Connect a domain?" with a working "Connect a domain…" link that opens the sheet from Task 9. Publish again (a second deploy) and confirm the banner does **not** reappear.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/DeployDrawerView.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1180): show a one-time connect-a-domain nudge on first publish"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift test suite**

Run: `swift test --package-path .`
Expected: PASS — all suites, including every new/modified test from Tasks 1–4.

- [ ] **Step 2: Full app build**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Sync the String Catalog**

This plan added user-facing text ("Connect a Domain…", "Buy a domain", "I already own a domain", the sheet's body copy, "Your site is live. Connect a domain?") via CLI-only builds, which per CONTRIBUTING.md never merges into `Sources/AnglesiteApp/Localizable.xcstrings` on its own. Run:

```bash
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

Review the resulting `git diff` on `Localizable.xcstrings` — it should contain only the new keys this plan introduced, not entries from unrelated sibling worktrees (CONTRIBUTING.md's known failure mode). If it looks wrong, re-run a clean build (`xcodebuild ... clean build`) scoped to this worktree first.

- [ ] **Step 4: Manual QA pass**

Using the running app:
1. Create a new site, publish it. Confirm the first-publish nudge appears in the deploy drawer.
2. Click "Connect a domain…" from the nudge, choose "Buy a domain". Confirm Cloudflare Domains opens in the browser and the sheet dismisses. Confirm `.site-config` has `DOMAIN_CHOICE=buy`.
3. Open `Website ▸ Connect a Domain…` again on the same site, choose "I already own a domain", enter a hostname, click Connect. Confirm the confirmation text and `.site-config`/`Source/anglesite.json` updates.
4. Publish again. Confirm the first-publish nudge does not reappear.
5. On a *different*, never-published site, confirm `Website ▸ Connect a Domain…` is enabled even though `Website ▸ Domain…` may not be (or is, but manages a different concern).

- [ ] **Step 5: Commit the String Catalog sync (if it produced a diff)**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(#1180): sync string catalog for Connect a Domain UI"
```
