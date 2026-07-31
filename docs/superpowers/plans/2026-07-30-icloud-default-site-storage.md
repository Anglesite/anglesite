# iCloud default site storage (Mac) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the default save location for new/imported `.anglesite` packages on Mac from
`~/Sites/` to an iCloud Drive ubiquity container ("Anglesite" folder), and add the entitlements
that make that container available to the sandboxed app — issue
[#865](https://github.com/Anglesite/Anglesite/issues/865).

**Architecture:** `AppSettings.sitesRoot` (`Sources/AnglesiteCore/AppSettings.swift`) is the single
choke point every save/import flow already reads (`SitesLauncherView.presentNewSite`,
`SiteActions.importPackage`, `SiteScaffolder`). This plan changes only that resolver's priority
order — dev override, then the app's iCloud ubiquity container, then `~/Sites/` as a fallback when
iCloud is unavailable — behind a small injectable seam so both branches are unit-testable without
depending on the real iCloud account state of the machine running `swift test`. It also fixes a
second-order consequence: under the sandboxed (MAS) build, `presentNewSite()` unconditionally shows
an `NSOpenPanel` to grant access to `sitesRoot` today, because `~/Sites/` sits outside the sandbox.
The app's own iCloud container needs no such grant (the entitlement itself is the grant), so that
panel must only appear when the resolved root actually turns out to be the `~/Sites/` fallback.

**Tech Stack:** Swift 6.4, Swift Testing (`AnglesiteCoreTests`), XcodeGen (`project.yml`), Apple
`FileManager.url(forUbiquityContainerIdentifier:)` / iCloud Drive Documents entitlements.

## Global Constraints

- Bundle ID is `io.dwk.anglesite` (`project.yml:93`) — the iCloud container identifier this plan
  wires up everywhere is `iCloud.io.dwk.anglesite`.
- No migration path for existing `~/Sites/` packages — pre-1.0, no real user base there yet (owner
  confirmation, 2026-07-21, per the issue and
  `docs/superpowers/specs/2026-07-21-ios-micropub-posting-client-design.md` §4). Do not write any
  migration/move-existing-packages code.
- `Source/.git` syncing via iCloud Drive's corruption risk is a knowingly accepted risk (owner
  decision, 2026-07-21) — do not add `.git` sync exclusion or any mitigation for it as part of this
  plan.
- Out of scope (per the issue): retroactively moving any existing package; excluding `.git` from
  sync; the iOS side of site discovery (a sibling issue) — this plan is Mac-only.
- Swift/SwiftUI + Apple frameworks only, no new third-party dependencies.
- Commit subject ≤72 characters; conventional-commit format (`feat(scope): …`), issue number in the
  subject where natural.
- **`AnglesiteCore` builds and tests on Linux too** (CI's Linux lane; `FileManager
  .url(forUbiquityContainerIdentifier:)` doesn't exist in swift-corelibs-foundation — it's a
  Darwin-only API, unlike everything else `AppSettings` currently touches). Every new symbol that
  touches it (`UbiquityContainerResolving`, `AppSettings`'s resolver property/init/tests) must be
  wrapped in `#if canImport(Darwin)`, mirroring the existing pattern in
  `Sources/AnglesiteCore/ICloudSyncEligibility.swift`. On Linux, `sitesRoot` must keep exactly its
  pre-#865 behavior (override, else `~/Sites/`) — no Linux behavior change is in scope here.

---

## File Structure

| File | Responsibility |
|---|---|
| `Resources/Anglesite.entitlements`, `Resources/Anglesite-Debug.entitlements` | Declare the iCloud container + service capability so the sandboxed app can resolve it at all. |
| `Resources/Info.plist` | Marks the container's `Documents` folder document-scope-public so it shows up as a browsable "Anglesite" folder in Finder/Files, not just an API-reachable path. |
| `Sources/AnglesiteCore/UbiquityContainerResolving.swift` *(new)* | Thin protocol seam over `FileManager.url(forUbiquityContainerIdentifier:)` so `AppSettings` is testable without real iCloud state. |
| `Sources/AnglesiteCore/AppSettings.swift` | `sitesRoot`'s resolution order changes: override → iCloud container → `~/Sites/` fallback. |
| `Tests/AnglesiteCoreTests/AppSettingsTests.swift` | Covers all three branches deterministically via a fake resolver. |
| `Sources/AnglesiteApp/SitesLauncherView.swift` | MAS "New Site" flow: only show the security-scope grant panel when direct write to `sitesRoot` actually fails (the fallback case), not for the normal iCloud-container case. |
| `CLAUDE.md` (symlinked as `AGENTS.md`) | "Site identity" section's default-location sentence updated to match. |
| `docs/qa/e2e-acceptance-1-initial-launch.md`, `docs/qa/e2e-acceptance-2-new-website.md`, `docs/qa/e2e-acceptance-overview.md` | Manual QA checklists that currently assert `~/Sites/` as the default — would file false QA failures unchanged. |

---

### Task 1: iCloud entitlements + Info.plist

**Files:**
- Modify: `Resources/Anglesite.entitlements`
- Modify: `Resources/Anglesite-Debug.entitlements`
- Modify: `Resources/Info.plist`

**Interfaces:**
- Produces: the container identifier string `iCloud.io.dwk.anglesite`, which Task 3's
  `AppSettings.sitesRoot` must use verbatim when calling
  `url(forUbiquityContainerIdentifier:)`.

No test cycle for plist edits (Swift Testing doesn't parse entitlements) — verified with `plutil
-lint` and a full app build, both in the Step commands below.

- [ ] **Step 1: Add the iCloud container + service keys to both entitlements files**

Add this block to `Resources/Anglesite.entitlements`, inside the existing top-level `<dict>` (after
the `com.apple.security.virtualization` entry):

```xml
	<!-- iCloud Drive default site storage (#865): the "Anglesite" folder new/imported .anglesite
	     packages save into by default. Container identifier must match AppSettings.sitesRoot's
	     ubiquityContainerIdentifier and Info.plist's NSUbiquitousContainers key below. -->
	<key>com.apple.developer.icloud-container-identifiers</key>
	<array>
		<string>iCloud.io.dwk.anglesite</string>
	</array>
	<key>com.apple.developer.icloud-services</key>
	<array>
		<string>CloudDocuments</string>
	</array>
```

Add the identical block to `Resources/Anglesite-Debug.entitlements` (it's a full standalone file,
not an overlay — insert it in the same place, before the existing `#775` mach-lookup exception
comment block).

- [ ] **Step 2: Mark the container's Documents folder document-scope-public in Info.plist**

Add this to `Resources/Info.plist`'s top-level `<dict>`, after the existing
`NSAppTransportSecurity` block:

```xml
	<!-- iCloud Drive default site storage (#865): makes the container's Documents/ folder show up
	     as a browsable "Anglesite" folder in Finder's iCloud Drive sidebar and the Files app,
	     matching the container identifier declared in the entitlements files above. -->
	<key>NSUbiquitousContainers</key>
	<dict>
		<key>iCloud.io.dwk.anglesite</key>
		<dict>
			<key>NSUbiquitousContainerIsDocumentScopePublic</key>
			<true/>
			<key>NSUbiquitousContainerSupportedFolderLevels</key>
			<string>Any</string>
			<key>NSUbiquitousContainerName</key>
			<string>Anglesite</string>
		</dict>
	</dict>
```

- [ ] **Step 3: Lint the plists**

Run:
```bash
plutil -lint Resources/Anglesite.entitlements Resources/Anglesite-Debug.entitlements Resources/Info.plist
```
Expected: `OK` for all three.

- [ ] **Step 4: Commit**

```bash
git add Resources/Anglesite.entitlements Resources/Anglesite-Debug.entitlements Resources/Info.plist
git commit -m "feat(#865): add iCloud container entitlements to Mac target"
```

---

### Task 2: `UbiquityContainerResolving` seam

**Files:**
- Create: `Sources/AnglesiteCore/UbiquityContainerResolving.swift`
- Test: `Tests/AnglesiteCoreTests/UbiquityContainerResolvingTests.swift`

**Interfaces:**
- Produces: `public protocol UbiquityContainerResolving { func url(forUbiquityContainerIdentifier
  containerIdentifier: String?) -> URL? }`, and `extension FileManager: UbiquityContainerResolving
  {}` — Task 3's `AppSettings` consumes both by name. Both are wrapped in `#if canImport(Darwin)`
  (see Global Constraints) — the type simply doesn't exist on Linux, same as `ICloudSyncEligibility`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/UbiquityContainerResolvingTests.swift`:

```swift
#if canImport(Darwin)
import Testing
import Foundation
@testable import AnglesiteCore

@Test("FileManager conforms to UbiquityContainerResolving")
func fileManagerConformsToUbiquityContainerResolving() {
    let resolver: UbiquityContainerResolving = FileManager.default
    // No real iCloud entitlement in the test bundle, so this must return nil rather than throw
    // or hang — the whole point of the seam is that AppSettings can treat "no entitlement" and
    // "not signed into iCloud" identically, as an ordinary nil result.
    #expect(resolver.url(forUbiquityContainerIdentifier: "iCloud.io.dwk.anglesite") == nil)
}
#endif
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter UbiquityContainerResolvingTests`
Expected: FAIL — `cannot find type 'UbiquityContainerResolving' in scope` (the protocol doesn't
exist yet).

- [ ] **Step 3: Write the protocol**

Create `Sources/AnglesiteCore/UbiquityContainerResolving.swift`:

```swift
#if canImport(Darwin)
import Foundation

/// Resolves an iCloud ubiquity container URL. A thin seam over
/// `FileManager.url(forUbiquityContainerIdentifier:)` (#865) so callers — `AppSettings.sitesRoot`
/// today — can be tested against both "iCloud available" and "iCloud unavailable" (not signed in,
/// iCloud Drive off, or the container's entitlement/provisioning isn't present — true of every
/// ad-hoc-signed Debug build, which has no Team ID) deterministically, without depending on the
/// real iCloud account state of the machine running the test. Darwin-only: this `FileManager`
/// method doesn't exist in swift-corelibs-foundation, and `AnglesiteCore` also builds on Linux.
public protocol UbiquityContainerResolving {
    /// Mirrors `FileManager`'s method of the same name: returns the container's root URL, or
    /// `nil` when the container isn't available for any reason. `containerIdentifier: nil` means
    /// "the app's first `com.apple.developer.icloud-container-identifiers` entry".
    func url(forUbiquityContainerIdentifier containerIdentifier: String?) -> URL?
}

extension FileManager: UbiquityContainerResolving {}
#endif
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter UbiquityContainerResolvingTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/UbiquityContainerResolving.swift Tests/AnglesiteCoreTests/UbiquityContainerResolvingTests.swift
git commit -m "feat(#865): add UbiquityContainerResolving seam"
```

---

### Task 3: `AppSettings.sitesRoot` resolves the iCloud container

**Files:**
- Modify: `Sources/AnglesiteCore/AppSettings.swift:8-11` (class + `shared`), `:48-50` (`init`),
  `:105-109` (`sitesRoot`)
- Modify: `Tests/AnglesiteCoreTests/AppSettingsTests.swift:1-33`

**Interfaces:**
- Consumes: `UbiquityContainerResolving` (Task 2, Darwin-only).
- Produces: `AppSettings.init(defaults:ubiquityContainerResolver:)` on Darwin (new defaulted
  parameter — every existing `AppSettings(defaults:)` call site across the app stays
  source-compatible on both platforms) and the unchanged public signature `AppSettings.sitesRoot:
  URL`, whose *behavior* every later task (`SitesLauncherView`, docs) must describe correctly.

- [ ] **Step 1: Write the failing tests**

Replace `Tests/AnglesiteCoreTests/AppSettingsTests.swift:21-33` (the two existing `sitesRoot`
tests) with:

```swift
#if canImport(Darwin)
    /// Deterministic stand-in for `FileManager` so these tests don't depend on the real iCloud
    /// account state of the machine running `swift test` (which never has the app's entitlement
    /// anyway, but should never be the thing making the test pass or fail).
    private struct FakeUbiquityContainerResolver: UbiquityContainerResolving {
        let result: URL?
        func url(forUbiquityContainerIdentifier containerIdentifier: String?) -> URL? { result }
    }

    @Test("Sites root uses the iCloud container's Documents folder when iCloud is available")
    func sitesRootUsesICloudContainerWhenAvailable() {
        let container = URL(fileURLWithPath: "/tmp/fake-ubiquity-container", isDirectory: true)
        let settings = AppSettings(
            defaults: defaults,
            ubiquityContainerResolver: FakeUbiquityContainerResolver(result: container))
        let expected = container.appendingPathComponent("Documents", isDirectory: true)
        #expect(settings.sitesRoot.path == expected.path)
    }

    @Test("Sites root falls back to home Sites when iCloud is unavailable")
    func sitesRootFallsBackToHomeSitesWhenICloudUnavailable() {
        let settings = AppSettings(
            defaults: defaults,
            ubiquityContainerResolver: FakeUbiquityContainerResolver(result: nil))
        let expected = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Sites", isDirectory: true)
        #expect(settings.sitesRoot.path == expected.path)
    }

    @Test("Sites root honors override even when iCloud is available")
    func sitesRootHonorsOverride() {
        let container = URL(fileURLWithPath: "/tmp/fake-ubiquity-container", isDirectory: true)
        let settings = AppSettings(
            defaults: defaults,
            ubiquityContainerResolver: FakeUbiquityContainerResolver(result: container))
        let url = URL(fileURLWithPath: "/tmp/anglesite-sites", isDirectory: true)
        settings.sitesRootOverride = url
        #expect(settings.sitesRoot.path == url.path)
    }
#else
    @Test("Sites root falls back to home Sites (no iCloud API on this platform)")
    func sitesRootFallsBackToHomeSitesWhenICloudUnavailable() {
        let settings = AppSettings(defaults: defaults)
        let expected = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Sites", isDirectory: true)
        #expect(settings.sitesRoot.path == expected.path)
    }

    @Test("Sites root honors override") func sitesRootHonorsOverride() {
        let settings = AppSettings(defaults: defaults)
        let url = URL(fileURLWithPath: "/tmp/anglesite-sites", isDirectory: true)
        settings.sitesRootOverride = url
        #expect(settings.sitesRoot.path == url.path)
    }
#endif
```

The `#else` branch keeps this file compiling on Linux, where `UbiquityContainerResolving` doesn't
exist (Global Constraints) — it's the same two assertions the file already had before this task,
just re-homed under the non-Darwin branch.

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter AppSettingsTests`
Expected: FAIL — `extra argument 'ubiquityContainerResolver' in call` (the initializer doesn't
accept it yet) and `sitesRootUsesICloudContainerWhenAvailable` failing on path mismatch once that
compiles.

- [ ] **Step 3: Add the resolver to `AppSettings` and change `sitesRoot`**

In `Sources/AnglesiteCore/AppSettings.swift`, change the `private let defaults: UserDefaults` /
`init` block (currently lines 46-50) to:

```swift
    private let defaults: UserDefaults
    #if canImport(Darwin)
    private let ubiquityContainerResolver: UbiquityContainerResolving

    /// Must match the `com.apple.developer.icloud-container-identifiers` entry in
    /// `Resources/Anglesite.entitlements` / `Resources/Anglesite-Debug.entitlements`, and the
    /// `NSUbiquitousContainers` key in `Resources/Info.plist`.
    static let ubiquityContainerIdentifier = "iCloud.io.dwk.anglesite"

    public init(defaults: UserDefaults, ubiquityContainerResolver: UbiquityContainerResolving = FileManager.default) {
        self.defaults = defaults
        self.ubiquityContainerResolver = ubiquityContainerResolver
    }
    #else
    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }
    #endif
```

`AppSettings.shared = AppSettings(defaults: .standard)` (unchanged, a few lines above) compiles
identically on both platforms since the Darwin initializer's second parameter is defaulted.

Then replace `sitesRoot` (currently lines 105-109):

```swift
    /// Effective root for site discovery (#865): `sitesRootOverride` when set (dev/test escape
    /// hatch), otherwise the "Anglesite" folder inside this app's iCloud ubiquity container —
    /// falling back to `~/Sites/` only when iCloud is unavailable (not signed in, iCloud Drive
    /// off, or the container isn't provisioned, which is true of every ad-hoc-signed Debug build
    /// since it has no Team ID) or on a platform with no iCloud API at all (Linux). No migration
    /// path for existing `~/Sites/` packages: the app is pre-1.0 with no real user base there yet
    /// (owner confirmation, 2026-07-21).
    public var sitesRoot: URL {
        if let sitesRootOverride { return sitesRootOverride }
        #if canImport(Darwin)
        if let container = ubiquityContainerResolver.url(forUbiquityContainerIdentifier: Self.ubiquityContainerIdentifier) {
            return container.appendingPathComponent("Documents", isDirectory: true)
        }
        #endif
        return FileManager.default.portableHomeDirectory.appendingPathComponent("Sites", isDirectory: true)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter AppSettingsTests`
Expected: PASS (all `AppSettingsTests`, including the three above and every pre-existing test in
the file, unaffected by this change).

- [ ] **Step 5: Run the full AnglesiteCoreTests suite**

Run: `swift test --package-path . --filter AnglesiteCoreTests`
Expected: PASS — confirms no other test in the target read `AppSettings.init` positionally in a
way the new defaulted parameter would break (it doesn't; Swift default parameters are
source-compatible).

- [ ] **Step 6: Statically verify the Linux (non-Darwin) branch**

This Mac can't run the Linux CI lane locally, so double-check the guard by inspection instead of
by running it:

Run:
```bash
grep -n 'canImport(Darwin)' Sources/AnglesiteCore/AppSettings.swift Sources/AnglesiteCore/UbiquityContainerResolving.swift Tests/AnglesiteCoreTests/AppSettingsTests.swift Tests/AnglesiteCoreTests/UbiquityContainerResolvingTests.swift
```
Expected: every reference to `UbiquityContainerResolving`, `ubiquityContainerResolver`, and
`FakeUbiquityContainerResolver` across these four files sits inside one of these `#if
canImport(Darwin)` blocks (or the file is wrapped whole). Read each file's `#if`/`#else`/`#endif`
nesting by eye and confirm the non-Darwin branch has no dangling reference to the Darwin-only type.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/AppSettings.swift Tests/AnglesiteCoreTests/AppSettingsTests.swift
git commit -m "feat(#865): default sitesRoot to the iCloud container"
```

---

### Task 4: Fix the MAS "New Site" security-scope flow

**Files:**
- Modify: `Sources/AnglesiteApp/SitesLauncherView.swift:420-427`

**Interfaces:**
- Consumes: `AppSettings.shared.sitesRoot` (Task 3) — no signature change, only its returned value
  now usually points inside the app's own iCloud container instead of `~/Sites/`.

No automated test: this is `#if ANGLESITE_MAS`-gated AppKit code (`NSOpenPanel`) inside the app
target, which per this repo's testing conventions (`CLAUDE.md` "Build" section) isn't covered by
`swift test` — hosted-app tests don't run in CI here. Verified by a full app build (Step 2) and
called out for manual QA in Task 6.

- [ ] **Step 1: Guard the grant panel on an actual write failure**

In `Sources/AnglesiteApp/SitesLauncherView.swift`, replace the existing block at lines 423-427:

```swift
        #if ANGLESITE_MAS
        guard let rootScope = await ensureSitesRootAccess(sitesRoot) else { return }  // user cancelled
        sitesRootScopedURL = rootScope
        #endif
        try? FileManager.default.createDirectory(at: sitesRoot, withIntermediateDirectories: true)
```

with:

```swift
        #if ANGLESITE_MAS
        // The app's own iCloud container (the default since #865) needs no security-scoped grant
        // — the icloud-container-identifiers entitlement itself is the grant. Only a location
        // outside the sandbox (the `~/Sites/` fallback used when iCloud is unavailable, or an
        // explicit sitesRootOverride) does. Try the direct write first and only fall back to the
        // open-panel/bookmark dance when the sandbox actually denies it, instead of prompting
        // every time regardless of where sitesRoot resolved to.
        if (try? FileManager.default.createDirectory(at: sitesRoot, withIntermediateDirectories: true)) == nil {
            guard let rootScope = await ensureSitesRootAccess(sitesRoot) else { return }  // user cancelled
            sitesRootScopedURL = rootScope
            try? FileManager.default.createDirectory(at: sitesRoot, withIntermediateDirectories: true)
        }
        #else
        try? FileManager.default.createDirectory(at: sitesRoot, withIntermediateDirectories: true)
        #endif
```

- [ ] **Step 2: Build the app target**

Run:
```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/SitesLauncherView.swift
git commit -m "fix(#865): skip MAS grant panel for the iCloud sites root"
```

---

### Task 5: Update docs

**Files:**
- Modify: `CLAUDE.md` (symlinked as `AGENTS.md` — one edit covers both)
- Modify: `docs/qa/e2e-acceptance-1-initial-launch.md:85`
- Modify: `docs/qa/e2e-acceptance-2-new-website.md:61,72,85,86`
- Modify: `docs/qa/e2e-acceptance-overview.md:30`

No test cycle — documentation only, verified by re-reading the diff in Step 3.

- [ ] **Step 1: Update `CLAUDE.md`'s "Site identity" paragraph**

Find this sentence (currently the last sentence of the "Site identity" section, ending "...so Import
is the upgrade path for pre-package sites)."):

```
`~/Sites/` is now just the default save location for new/imported packages — not a discovery root (there is no legacy `sites.json` migration, so Import is the upgrade path for pre-package sites).
```

Replace it with:

```
The iCloud Drive "Anglesite" folder (the app's ubiquity container) is the default save location for new/imported packages (#865) — not a discovery root. `~/Sites/` is now only a fallback used when iCloud is unavailable (not signed in, iCloud Drive off, or an ad-hoc-signed Debug build with no provisioning for the container); there is no migration of existing `~/Sites/` packages into iCloud (pre-1.0 owner decision, 2026-07-21) and no legacy `sites.json` migration, so Import remains the upgrade path for pre-package sites.
```

- [ ] **Step 2: Update the QA checklists**

In `docs/qa/e2e-acceptance-1-initial-launch.md:85`, change:
```
- **Advanced**: plugin path override empty (placeholder "(use bundled plugin)"); Sites root empty (placeholder `~/Sites/`); ...
```
to:
```
- **Advanced**: plugin path override empty (placeholder "(use bundled plugin)"); Sites root empty (placeholder for the iCloud "Anglesite" folder, or `~/Sites/` if iCloud is unavailable on the test machine); ...
```

In `docs/qa/e2e-acceptance-2-new-website.md:61`, change:
```
- The save panel ("Save Your Website", prompt "Save") defaults to the Sites root (`~/Sites/` unless overridden) with filename **`qa-bakery.anglesite`**, and creates the directory if missing.
```
to:
```
- The save panel ("Save Your Website", prompt "Save") defaults to the Sites root (the iCloud "Anglesite" folder, or `~/Sites/` if iCloud is unavailable, unless overridden) with filename **`qa-bakery.anglesite`**, and creates the directory if missing.
```
Leave lines 72/85/86's `~/Sites/qa-bakery.anglesite/` example paths as-is if the machine running
this checklist doesn't have iCloud signed in during manual QA (the fallback path is real and worth
keeping as the documented example); otherwise substitute the tester's actual iCloud container path
for those three inspection commands when running the checklist. No literal text change required
here beyond a one-line note — add this above line 72:
```
(Substitute your iCloud "Anglesite" folder for `~/Sites/` below if iCloud is available on the test machine.)
```

In `docs/qa/e2e-acceptance-overview.md:30`, change:
```
4. Move aside any existing `~/Sites/*.anglesite` packages (or use a Sites-root override pointed at an empty directory).
```
to:
```
4. Move aside any existing packages in the default Sites root (the iCloud "Anglesite" folder, or `~/Sites/*.anglesite` if iCloud is unavailable) — or use a Sites-root override pointed at an empty directory.
```

- [ ] **Step 3: Re-read the diff**

Run: `git diff CLAUDE.md docs/qa/`
Expected: only the sentences above changed; no unrelated edits.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/qa/e2e-acceptance-1-initial-launch.md docs/qa/e2e-acceptance-2-new-website.md docs/qa/e2e-acceptance-overview.md
git commit -m "docs(#865): reflect iCloud default sites root"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift package test suite**

Run: `swift test --package-path .`
Expected: PASS (all targets, including `AnglesiteCoreTests`, `AnglesiteBridgeTests`, and — on
Swift 6.4+/Xcode 27 — `AnglesiteIntentsTests`).

- [ ] **Step 2: Build the app target**

Run:
```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```
Expected: `BUILD SUCCEEDED`.

- [ ] **Step 3: Note the manual-QA gap in the PR body**

The MAS grant-flow fix (Task 4) and the actual "does the New Site panel skip the grant dialog and
land the package in the real iCloud Drive folder" behavior can't be verified by `swift test` or a
plain Debug build — Debug is ad-hoc signed with no Team ID (`xcconfig/Signing-Debug.xcconfig`), so
the iCloud entitlement won't actually provision locally without a real Team ID override and, most
likely, registering the `iCloud.io.dwk.anglesite` container against that Team ID in the Apple
Developer portal first (outside this plan's reach). State this explicitly as an unverified/pending
manual-QA item in the PR's Test plan section, per `CONTRIBUTING.md`.
