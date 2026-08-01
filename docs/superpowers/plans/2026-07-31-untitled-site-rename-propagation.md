# Untitled Site Rename Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a site still carrying its scaffold-time "Untitled" defaults is renamed via `SiteStore.setDisplayName`, propagate the new name into `.site-config`'s `SITE_NAME`/`CF_PROJECT_NAME` and `wrangler.toml`'s `name` line — so first publish lands under the renamed project slug instead of `untitled`.

**Architecture:** A new best-effort `AnglesiteCore` helper, `UntitledSitePropagation.propagateIfUntitled`, guarded to fire only when the site is still virgin (no `CF_WORKER_DEPLOYED`/`CF_WORKER_PROVISIONED`) and still carrying untouched "Untitled" defaults. `SiteStore.setDisplayName` calls it before its existing plist no-op check.

**Tech Stack:** Swift 6.4, Swift Testing (`import Testing`, `@testable import AnglesiteCore`), SwiftPM (`swift test --package-path .`).

## Global Constraints

- Conventional commit subjects, ≤72 characters, reference `#1182` (e.g. `feat(#1182): ...`).
- No new dependencies.
- All file writes in the new helper are best-effort (`try?`) — this must never throw or block a rename.
- Follow existing code style: `WorkerNameRename.swift` and `SiteConfigFile.swift` are the closest precedents: doc comments explain *why*, not *what*.

---

### Task 1: `UntitledSitePropagation` helper + unit tests

**Files:**
- Create: `Sources/AnglesiteCore/UntitledSitePropagation.swift`
- Test: `Tests/AnglesiteCoreTests/UntitledSitePropagationTests.swift`

**Interfaces:**
- Consumes: `SiteConfigFile.value(forKey:in:) -> String?`, `SiteConfigFile.upsert(_:into:) -> String` (`Sources/AnglesiteCore/SiteConfigFile.swift`); `SiteSlug.derive(from:) -> String` (`Sources/AnglesiteCore/NewSiteDraft.swift`); `WorkerComposition.isValidSiteName(_:) -> Bool` (`Sources/AnglesiteCore/WorkerComposition.swift`, internal, same module); `WebsiteAnalyticsAsset.configRelativePath` (`Sources/AnglesiteCore/WebsiteAnalyticsAsset.swift`, `= ".site-config"`).
- Produces: `public enum UntitledSitePropagation { public static func propagateIfUntitled(newDisplayName: String, siteDirectory: URL, fileManager: FileManager = .default) }` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/UntitledSitePropagationTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

struct UntitledSitePropagationTests {
    private func makeSiteDirectory(siteConfig: String, wranglerToml: String? = #"name = "untitled""#) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try! siteConfig.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        if let wranglerToml {
            try! wranglerToml.write(to: dir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        }
        return dir
    }

    @Test("Propagates SITE_NAME, CF_PROJECT_NAME, and wrangler.toml name for a virgin untitled site")
    func propagatesForVirginUntitledSite() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nTAGLINE=hi\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
        #expect(SiteConfigFile.value(forKey: "TAGLINE", in: config) == "hi", "unrelated keys must survive")
        let toml = try String(contentsOf: dir.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains(#"name = "acme-bakery""#))
    }

    @Test("Matches the 'Untitled N' pattern the chooser generates for repeat untitled sites")
    func propagatesForNumberedUntitledSite() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled 3\nCF_PROJECT_NAME=untitled-3\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "My Blog", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "My Blog")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "my-blog")
    }

    @Test("No-ops when CF_WORKER_DEPLOYED is already set")
    func noOpWhenDeployed() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_DEPLOYED=true\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "untitled")
    }

    @Test("No-ops when CF_WORKER_PROVISIONED is already set")
    func noOpWhenProvisioned() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_PROVISIONED=true\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
    }

    @Test("No-ops when SITE_NAME was already customized away from the Untitled pattern")
    func noOpWhenSiteNameCustomized() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=My Existing Site\nCF_PROJECT_NAME=my-existing-site\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "My Existing Site")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "my-existing-site")
    }

    @Test("No-ops when CF_PROJECT_NAME was hand-customized away from the derived slug")
    func noOpWhenProjectNameCustomized() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=custom-project-name\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "custom-project-name")
    }

    @Test("No-ops gracefully when .site-config is missing")
    func noOpWhenSiteConfigMissing() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // Must not throw or crash.
        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)
    }

    @Test("Still updates .site-config when wrangler.toml is missing")
    func updatesSiteConfigWhenWranglerMissing() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n", wranglerToml: nil)

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail with "cannot find 'UntitledSitePropagation' in scope"**

Run: `swift test --package-path . --filter UntitledSitePropagationTests 2>&1 | tail -30`
Expected: FAIL — compile error, `UntitledSitePropagation` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/UntitledSitePropagation.swift`:

```swift
import Foundation

/// Best-effort propagation of a site's display-name rename into its `.site-config` and
/// `wrangler.toml`, but only while the site is still carrying its scaffold-time "Untitled"
/// defaults and hasn't touched Cloudflare yet (#1182). Distinct from `WorkerNameRename`, which
/// handles the post-deploy, collision-triggered rename flow and deliberately leaves `SITE_NAME`
/// untouched — this is the pre-deploy counterpart that updates both `SITE_NAME` and
/// `CF_PROJECT_NAME`.
public enum UntitledSitePropagation {
    /// Propagates `newDisplayName` into `SITE_NAME`/`CF_PROJECT_NAME` (and `wrangler.toml`'s
    /// `name` line) when — and only when — the site at `siteDirectory` is still untouched since
    /// scaffold: neither `CF_WORKER_DEPLOYED` nor `CF_WORKER_PROVISIONED` is set, `SITE_NAME`
    /// still matches the scaffold-time "Untitled"/"Untitled N" pattern (`NewSiteWizardModel`'s
    /// `untitledName`), and `CF_PROJECT_NAME` still equals the slug derived from that name (i.e.
    /// nothing has hand-customized it). Silently does nothing otherwise, or if any file is
    /// missing/unreadable/unwritable, or if the derived slug is invalid — a display-name rename
    /// must never fail or throw because of this.
    public static func propagateIfUntitled(
        newDisplayName: String,
        siteDirectory: URL,
        fileManager: FileManager = .default
    ) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        guard let config = try? String(contentsOf: configURL, encoding: .utf8) else { return }

        guard SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == nil,
              SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == nil else { return }

        guard let currentSiteName = SiteConfigFile.value(forKey: "SITE_NAME", in: config),
              isUntitledPattern(currentSiteName) else { return }

        guard let currentProjectName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config),
              currentProjectName == SiteSlug.derive(from: currentSiteName) else { return }

        let newSlug = SiteSlug.derive(from: newDisplayName)
        guard WorkerComposition.isValidSiteName(newSlug) else { return }

        let wranglerURL = siteDirectory.appendingPathComponent("wrangler.toml")
        if let toml = try? String(contentsOf: wranglerURL, encoding: .utf8) {
            var lines = toml.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            if let nameLineIndex = lines.firstIndex(where: { $0.hasPrefix("name = \"") }) {
                lines[nameLineIndex] = "name = \"\(newSlug)\""
                try? lines.joined(separator: "\n").write(to: wranglerURL, atomically: true, encoding: .utf8)
            }
        }

        let updatedConfig = SiteConfigFile.upsert(
            [("SITE_NAME", newDisplayName), ("CF_PROJECT_NAME", newSlug)],
            into: config
        )
        try? updatedConfig.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Matches exactly the pattern `NewSiteWizardModel.untitledName` generates: `"Untitled"` or
    /// `"Untitled "` followed by an integer.
    private static func isUntitledPattern(_ name: String) -> Bool {
        if name == "Untitled" { return true }
        guard name.hasPrefix("Untitled ") else { return false }
        let suffix = name.dropFirst("Untitled ".count)
        return !suffix.isEmpty && suffix.allSatisfy(\.isNumber)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter UntitledSitePropagationTests 2>&1 | tail -30`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/UntitledSitePropagation.swift Tests/AnglesiteCoreTests/UntitledSitePropagationTests.swift
git commit -m "feat(#1182): add UntitledSitePropagation helper"
```

---

### Task 2: Wire into `SiteStore.setDisplayName` + end-to-end test

**Files:**
- Modify: `Sources/AnglesiteCore/SiteStore.swift:341-364`
- Test: `Tests/AnglesiteCoreTests/SiteStoreTests.swift` (append near the existing `setDisplayName` tests, after `setDisplayNameNoOpWhenUnchanged` around line 320)

**Interfaces:**
- Consumes: `UntitledSitePropagation.propagateIfUntitled(newDisplayName:siteDirectory:fileManager:)` from Task 1; `AnglesitePackage.sourceURL` (`Sources/AnglesiteSiteModel/AnglesitePackage.swift:33`).
- Produces: no new public API — behavioral change to existing `SiteStore.setDisplayName`.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/SiteStoreTests.swift`, directly after the existing `setDisplayNameNoOpWhenUnchanged` test (around line 320, before the `setDisplayNameUnknownIDNoOp` test):

```swift
    @Test("setDisplayName propagates SITE_NAME/CF_PROJECT_NAME into an untitled site's .site-config and wrangler.toml")
    func setDisplayNamePropagatesUntitledSiteConfig() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n".write(
            to: pkg.sourceURL.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        try #"name = "untitled""#.write(
            to: pkg.sourceURL.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        _ = try await store.setDisplayName("Acme Bakery", for: site.id)

        let config = try String(contentsOf: pkg.sourceURL.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
        let toml = try String(contentsOf: pkg.sourceURL.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains(#"name = "acme-bakery""#))
    }

    @Test("setDisplayName does not propagate into .site-config once the site has deployed")
    func setDisplayNameSkipsPropagationAfterDeploy() async throws {
        let pkg = try makeValidPackage(named: "alpha")
        try "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_DEPLOYED=true\n".write(
            to: pkg.sourceURL.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let store = SiteStore(persistenceURL: persistenceURL)
        let site = try await store.record(pkg)

        _ = try await store.setDisplayName("Acme Bakery", for: site.id)

        let config = try String(contentsOf: pkg.sourceURL.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "untitled")
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteStoreTests 2>&1 | tail -40`
Expected: FAIL — `setDisplayNamePropagatesUntitledSiteConfig` fails because `.site-config` still has `SITE_NAME=Untitled` (propagation not wired up yet). `setDisplayNameSkipsPropagationAfterDeploy` passes trivially (nothing to skip yet), which is fine — it will still guard the behavior once Step 3 lands.

- [ ] **Step 3: Wire the call into `setDisplayName`**

In `Sources/AnglesiteCore/SiteStore.swift`, replace the `setDisplayName` method (currently lines 341-364):

```swift
    @discardableResult
    public func setDisplayName(_ name: String?, for id: String) async throws -> Site? {
        guard let index = sites.firstIndex(where: { $0.id == id }) else { return nil }
        let existing = sites[index]
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let override = (trimmed?.isEmpty == false) ? trimmed : nil

        let package = AnglesitePackage(url: existing.packageURL)

        // Best-effort, and run before the no-op guard below so a retry always re-attempts it —
        // propagateIfUntitled is itself cheap and idempotent (#1182).
        if let override {
            UntitledSitePropagation.propagateIfUntitled(
                newDisplayName: override,
                siteDirectory: package.sourceURL,
                fileManager: fileManager
            )
        }

        let config = SiteConfigStore(configDirectory: package.configURL, fileManager: fileManager)
        var settings = try await config.load()
        // Renaming to the current value (or clearing an already-empty override) changes nothing —
        // skip the disk write, the re-make, and the change broadcast.
        guard settings.displayName != override else { return existing }
        settings.displayName = override
        try await config.save(settings)

        var updated = try Site.make(package: package, fileManager: fileManager)
        updated.lastSeen = existing.lastSeen
        updated.bookmarkData = existing.bookmarkData
        sites[index] = updated
        try persist()
        await emitChange()
        return updated
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteStoreTests 2>&1 | tail -40`
Expected: PASS — all `SiteStoreTests` tests green, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteStore.swift Tests/AnglesiteCoreTests/SiteStoreTests.swift
git commit -m "feat(#1182): propagate rename into untitled site's .site-config"
```

---

### Task 3: Full test suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full AnglesiteCore + AnglesiteSiteModel + AnglesiteBridge test suite**

Run: `swift test --package-path . 2>&1 | tail -60`
Expected: All tests pass, including pre-existing `WorkerNameRenameTests`, `SiteScaffolderTests`, `DeployCoordinatorTests`, `SiteOperationsTests` (none of these touch the new code path, but confirm nothing regressed).

- [ ] **Step 2: If `swift test` hangs with no output**

A stale SwiftPM process may be holding the `.build` lock. Check with `pgrep -fl swift-test` and kill the orphan process, then re-run Step 1.

- [ ] **Step 3: Confirm no unrelated files changed**

Run: `git status`
Expected: only `Sources/AnglesiteCore/UntitledSitePropagation.swift`, `Sources/AnglesiteCore/SiteStore.swift`, `Tests/AnglesiteCoreTests/UntitledSitePropagationTests.swift`, `Tests/AnglesiteCoreTests/SiteStoreTests.swift`, and the design doc/plan doc already committed earlier in this session.
