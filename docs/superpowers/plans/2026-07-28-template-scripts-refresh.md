# scripts/ Template Refresh (#1053) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a scaffolded site's app-owned `scripts/` files (`pre-deploy-check.ts`, `edge-artifacts.ts`, etc.) in lockstep with the bundled template — silently for files the owner never touched, with a consequence-framed prompt for files they customized — so the security gate and other build machinery stop silently going stale.

**Architecture:** A new parallel mechanism mirroring the existing `DependencySyncChecker`/`Applier` pair: `TemplateScriptsSyncChecker` (pure detection, per-file content hash comparison) and `TemplateScriptsSyncApplier` (writes), backed by a new `Config/template-scripts-baseline.json` baseline file — deliberately independent of `DependencySyncChecker`'s `.site-config` `ANGLESITE_VERSION` stamp, since reusing that stamp would let this mechanism silently skip forever once a dependency-update offer bumps it. Wired into `SiteWindowModel.loadAndStart()` alongside the existing dependency-sync hook.

**Tech Stack:** Swift 6.4, Foundation, Swift Testing (`@Suite`/`@Test`/`#expect`). No new dependencies.

**Design doc:** [`docs/superpowers/specs/2026-07-28-template-scripts-refresh-design.md`](../specs/2026-07-28-template-scripts-refresh-design.md) — read this first for the *why* behind every decision below; this plan only covers the *how*.

## Global Constraints

- Swift/SwiftUI with Apple frameworks only — no new dependencies. Content hashing uses the existing `VectorMath.stableHash`/`stableHashValue` (FNV-1a, `Sources/AnglesiteCore/VectorMath.swift:19-29`), **not** `CryptoKit` — `AnglesiteCore` builds on Linux CI, where `CryptoKit` isn't available and this repo has no `swift-crypto` fallback.
- The app-owned `scripts/` file set is defined by `TemplateScriptsManifest` (Task 1) and must exactly match what `scripts/scaffold.sh`'s `rsync` copies today (`Resources/Template/scripts/scaffold.sh:39-47`) — including its exclude-anchoring quirk (`*.test.ts` only excluded at the top level of `scripts/`, not in subdirectories). Do not "fix" that quirk as a side effect of this plan.
- `Config/` files (the new `template-scripts-baseline.json`) are app-owned state, never written into `Source/`, never committed to the site's git repo — same rule as `Config/dependency-baseline.json`.
- `TemplateScriptsSyncChecker` never writes under `Source/` — only `TemplateScriptsSyncApplier` does. The checker may write `Config/`-only baseline bookkeeping (see design doc's "Note on checker purity").
- User-facing copy for the divergence sheet must describe consequences to the owner's site, not git/diff/merge terminology (design doc's guiding principle).
- Conventional commits, subject ≤72 characters, reference `#1053`.
- Keep `swift test --package-path .` and `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` green after every task — multiple agents work this repo concurrently, so an intermediate broken state is never acceptable to leave uncommitted-but-broken.
- Tasks 5–6 add new user-visible strings ("Keep My Version", "Update This File", "Site Scripts Customized", the row explanation text). Per `CONTRIBUTING.md`'s String Catalog step, these need an `xcrun xcstringstool sync` pass scoped to this worktree's own `BUILD_DIR` before the final commit — Task 8 covers this.

---

## Task 1: `TemplateScriptsManifest` — the app-owned file set

**Files:**
- Create: `Sources/AnglesiteCore/TemplateScriptsManifest.swift`
- Create: `Tests/AnglesiteCoreTests/TemplateScriptsManifestTests.swift`

**Interfaces:**
- Produces: `public enum TemplateScriptsManifest { public static func appOwnedRelativePaths(templateRoot: URL) -> [String] }` — relative paths like `"scripts/pre-deploy-check.ts"`, sorted.

- [ ] **Step 1: Write `TemplateScriptsManifest.swift`**

```swift
import Foundation

/// Enumerates the exact set of files `scripts/scaffold.sh`'s `rsync` copies from
/// `Resources/Template/scripts/` into a scaffolded site — the "app-owned" set this refresh
/// mechanism keeps current (design doc §Scope). Mirrors `scaffold.sh`'s own exclude list
/// (`Resources/Template/scripts/scaffold.sh:40-46`) rather than re-parsing the shell script; the
/// two lists are kept in sync by hand, the same way every other template-path consumer
/// (`TemplateRuntime`, `ThemeCatalog`) already duplicates path knowledge rather than sharing it
/// with the shell script.
public enum TemplateScriptsManifest {
    /// Names excluded only when they sit directly inside `scripts/` itself — matches rsync's own
    /// anchoring rules for a pattern containing a slash (`scripts/themes.ts` does not match
    /// `scripts/embeds/themes.ts`). The `.test.ts` suffix exclusion below is applied with the same
    /// top-level-only restriction, deliberately reproducing the anchoring quirk `scaffold.sh` has
    /// today (design doc §Scope) rather than silently fixing it as a side effect of this feature.
    private static let topLevelExcludedNames: Set<String> = ["scaffold.sh", "themes.ts", "themes.json"]

    /// Relative paths (e.g. `"scripts/pre-deploy-check.ts"`, `"scripts/embeds/adapters.ts"`),
    /// sorted for deterministic iteration order. Returns `[]` if `templateRoot/scripts` doesn't
    /// exist or can't be enumerated.
    public static func appOwnedRelativePaths(templateRoot: URL) -> [String] {
        let scriptsRoot = templateRoot.appendingPathComponent("scripts")
        guard let enumerator = FileManager.default.enumerator(
            at: scriptsRoot,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        let scriptsRootPath = scriptsRoot.standardizedFileURL.path
        var results: [String] = []
        for case let fileURL as URL in enumerator {
            let isDirectory = (try? fileURL.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory { continue }

            let standardizedPath = fileURL.standardizedFileURL.path
            guard standardizedPath.hasPrefix(scriptsRootPath + "/") else { continue }
            let relativeToScripts = String(standardizedPath.dropFirst(scriptsRootPath.count + 1))

            let isTopLevel = !relativeToScripts.contains("/")
            if isTopLevel && topLevelExcludedNames.contains(relativeToScripts) { continue }
            if isTopLevel && relativeToScripts.hasSuffix(".test.ts") { continue }

            results.append("scripts/" + relativeToScripts)
        }
        return results.sorted()
    }
}
```

- [ ] **Step 2: Write `TemplateScriptsManifestTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsManifestTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    @Test func excludesScaffoldInfraAndTopLevelTestFilesOnly() throws {
        let root = tmpDir()
        let scripts = root.appendingPathComponent("scripts")
        try writeFile("keep", to: scripts.appendingPathComponent("keep.ts"))
        try writeFile("scaffold", to: scripts.appendingPathComponent("scaffold.sh"))
        try writeFile("themes", to: scripts.appendingPathComponent("themes.ts"))
        try writeFile("themesjson", to: scripts.appendingPathComponent("themes.json"))
        try writeFile("drop", to: scripts.appendingPathComponent("drop.test.ts"))
        try writeFile("adapter", to: scripts.appendingPathComponent("embeds/adapter.ts"))
        try writeFile("adapterTest", to: scripts.appendingPathComponent("embeds/adapter.test.ts"))
        try writeFile("fixture", to: scripts.appendingPathComponent("embeds/fixtures/data.json"))

        let result = TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: root)

        #expect(result == [
            "scripts/embeds/adapter.test.ts",
            "scripts/embeds/adapter.ts",
            "scripts/embeds/fixtures/data.json",
            "scripts/keep.ts",
        ])
    }

    @Test func returnsEmptyWhenScriptsDirectoryIsMissing() {
        let root = tmpDir()
        #expect(TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: root).isEmpty)
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TemplateScriptsManifestTests`
Expected: PASS (2 tests). This file has no dependency on anything not yet written, so it should pass on the first run — if it fails, fix `TemplateScriptsManifest` before moving on rather than adjusting the test's expected sort order to match a bug.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/TemplateScriptsManifest.swift Tests/AnglesiteCoreTests/TemplateScriptsManifestTests.swift
git commit -m "feat(#1053): enumerate the app-owned scripts/ file set"
```

---

## Task 2: `TemplateScriptsBaseline` — the `Config/` persistence layer

**Files:**
- Create: `Sources/AnglesiteCore/TemplateScriptsBaseline.swift`
- Create: `Tests/AnglesiteCoreTests/TemplateScriptsBaselineTests.swift`

**Interfaces:**
- Produces: `public struct TemplateScriptsBaseline: Codable, Equatable, Sendable { public struct Entry: Codable, Equatable, Sendable { public var baselineHash: String; public var acknowledgedTemplateHash: String?; public init(baselineHash: String, acknowledgedTemplateHash: String? = nil) }; public static let filename: String; public var files: [String: Entry]; public init(files: [String: Entry] = [:]); public static func load(from configDirectory: URL) -> TemplateScriptsBaseline; public func save(to configDirectory: URL) throws }`

- [ ] **Step 1: Write `TemplateScriptsBaseline.swift`**

```swift
import Foundation

/// Reads/writes `Config/template-scripts-baseline.json` — a per-file content-hash snapshot the
/// scripts/ refresh mechanism (design doc, #1053) uses to tell "stale" apart from "the owner
/// edited this." App-owned state, never committed to the site's git repo (`Config/` sits outside
/// `Source/` — see the `.anglesite` package model), mirroring `Config/dependency-baseline.json`'s
/// placement rationale.
public struct TemplateScriptsBaseline: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        /// Hash (`VectorMath.stableHash`) of the template content this file was last
        /// successfully reconciled against — at scaffold time, at a prior silent refresh, or
        /// backfilled from the site's own content the first time this mechanism inspected it.
        public var baselineHash: String
        /// Set only after the owner picks "keep my version" for a divergent file — the template
        /// hash they declined, so the same divergence isn't re-asked until the template file
        /// changes again past this point.
        public var acknowledgedTemplateHash: String?

        public init(baselineHash: String, acknowledgedTemplateHash: String? = nil) {
            self.baselineHash = baselineHash
            self.acknowledgedTemplateHash = acknowledgedTemplateHash
        }
    }

    public static let filename = "template-scripts-baseline.json"

    public var files: [String: Entry]

    public init(files: [String: Entry] = [:]) {
        self.files = files
    }

    /// Never fails — an absent or corrupt baseline file reads as "no baseline recorded for any
    /// file yet," which is exactly the legacy-site case the checker already handles explicitly.
    public static func load(from configDirectory: URL) -> TemplateScriptsBaseline {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(TemplateScriptsBaseline.self, from: data)
        else { return TemplateScriptsBaseline() }
        return decoded
    }

    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }
}
```

- [ ] **Step 2: Write `TemplateScriptsBaselineTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsBaselineTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test func loadReturnsEmptyWhenFileIsAbsent() {
        let config = tmpDir()
        #expect(TemplateScriptsBaseline.load(from: config) == TemplateScriptsBaseline())
    }

    @Test func saveThenLoadRoundTripsEntriesIncludingAcknowledgedHash() throws {
        let config = tmpDir()
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: "abc")
        baseline.files["scripts/edge-artifacts.ts"] = .init(baselineHash: "def", acknowledgedTemplateHash: "ghi")
        try baseline.save(to: config)

        #expect(TemplateScriptsBaseline.load(from: config) == baseline)
    }

    @Test func loadReturnsEmptyWhenFileIsCorrupt() throws {
        let config = tmpDir()
        try Data("not json".utf8).write(to: config.appendingPathComponent(TemplateScriptsBaseline.filename))
        #expect(TemplateScriptsBaseline.load(from: config) == TemplateScriptsBaseline())
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TemplateScriptsBaselineTests`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/TemplateScriptsBaseline.swift Tests/AnglesiteCoreTests/TemplateScriptsBaselineTests.swift
git commit -m "feat(#1053): add Config/template-scripts-baseline.json store"
```

---

## Task 3: `TemplateScriptsSync` value types + `TemplateScriptsSyncChecker`

**Files:**
- Create: `Sources/AnglesiteCore/TemplateScriptsSync.swift`
- Create: `Sources/AnglesiteCore/TemplateScriptsSyncChecker.swift`
- Create: `Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift`

**Interfaces:**
- Consumes: `TemplateScriptsManifest.appOwnedRelativePaths(templateRoot:)` (Task 1), `TemplateScriptsBaseline`/`.Entry`/`.load`/`.save` (Task 2), `VectorMath.stableHash(_:)` (existing, `Sources/AnglesiteCore/VectorMath.swift`).
- Produces: `public enum TemplateScriptsSyncAction: Sendable, Equatable { case create(relativePath: String); case refresh(relativePath: String); var relativePath: String { get } }`; `public struct TemplateScriptsDivergence: Sendable, Equatable, Identifiable { public let relativePath: String; public let templateHash: String; public init(relativePath: String, templateHash: String) }`; `public struct TemplateScriptsSyncPlan: Sendable, Equatable { public let toApply: [TemplateScriptsSyncAction]; public let divergences: [TemplateScriptsDivergence] }`; `public enum TemplateScriptsSyncChecker { public static func check(sourceDirectory: URL, configDirectory: URL, templateDirectory: URL) -> TemplateScriptsSyncPlan }`.

This task combines the value types with the checker that produces them — the types have no independent behavior to test on their own (the same way `DependencyUpdateOffer` has no dedicated test file, only equality assertions inside `DependencySyncCheckerTests`).

- [ ] **Step 1: Write `TemplateScriptsSync.swift`**

```swift
/// One silently-appliable action from `TemplateScriptsSyncChecker` — no owner consent needed for
/// either case (design doc §Detection steps 1 and 4).
public enum TemplateScriptsSyncAction: Sendable, Equatable {
    /// The template has a file the site doesn't have yet (added since this site scaffolded).
    case create(relativePath: String)
    /// The site's file is unmodified since its last known-good baseline, and the template moved on.
    case refresh(relativePath: String)

    public var relativePath: String {
        switch self {
        case .create(let path), .refresh(let path): return path
        }
    }
}

/// A `scripts/` file the owner has customized, where the template has also moved on past the
/// content the owner customized from — the one case this mechanism can't silently resolve
/// (design doc §Divergence UX).
public struct TemplateScriptsDivergence: Sendable, Equatable, Identifiable {
    public var id: String { relativePath }
    public let relativePath: String
    public let templateHash: String

    public init(relativePath: String, templateHash: String) {
        self.relativePath = relativePath
        self.templateHash = templateHash
    }
}

/// The full result of one `TemplateScriptsSyncChecker.check` pass.
public struct TemplateScriptsSyncPlan: Sendable, Equatable {
    public let toApply: [TemplateScriptsSyncAction]
    public let divergences: [TemplateScriptsDivergence]

    public init(toApply: [TemplateScriptsSyncAction] = [], divergences: [TemplateScriptsDivergence] = []) {
        self.toApply = toApply
        self.divergences = divergences
    }
}
```

- [ ] **Step 2: Write `TemplateScriptsSyncChecker.swift`**

```swift
import Foundation

/// Detects which app-owned `scripts/` files a site needs refreshed, and which have been
/// customized in a way the app can't silently resolve (design doc, #1053). Unlike
/// `DependencySyncChecker`, this type performs its own `Config/`-only baseline bookkeeping
/// (backfilling a missing entry, initializing a first-encounter baseline) as it goes — see the
/// design doc's "Note on checker purity." It never writes anything under `Source/`; only
/// `TemplateScriptsSyncApplier` does that.
public enum TemplateScriptsSyncChecker {
    public static func check(
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) -> TemplateScriptsSyncPlan {
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        var baselineChanged = false
        var toApply: [TemplateScriptsSyncAction] = []
        var divergences: [TemplateScriptsDivergence] = []

        for relativePath in TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: templateDirectory) {
            guard let templateContent = try? String(
                contentsOf: templateDirectory.appendingPathComponent(relativePath), encoding: .utf8
            ) else { continue }
            let templateHash = VectorMath.stableHash(templateContent)

            let siteURL = sourceDirectory.appendingPathComponent(relativePath)
            guard let siteContent = try? String(contentsOf: siteURL, encoding: .utf8) else {
                toApply.append(.create(relativePath: relativePath))
                continue
            }
            let siteHash = VectorMath.stableHash(siteContent)

            if templateHash == siteHash {
                if baseline.files[relativePath]?.baselineHash != siteHash {
                    baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                    baselineChanged = true
                }
                continue
            }

            if baseline.files[relativePath] == nil {
                // First encounter for this site: its current content becomes the assumed-untouched
                // baseline (design doc's legacy-site trade-off).
                baseline.files[relativePath] = TemplateScriptsBaseline.Entry(baselineHash: siteHash)
                baselineChanged = true
            }
            let entry = baseline.files[relativePath]!

            if entry.baselineHash == siteHash {
                toApply.append(.refresh(relativePath: relativePath))
            } else if entry.acknowledgedTemplateHash == templateHash {
                continue
            } else {
                divergences.append(TemplateScriptsDivergence(relativePath: relativePath, templateHash: templateHash))
            }
        }

        if baselineChanged {
            try? baseline.save(to: configDirectory)
        }
        return TemplateScriptsSyncPlan(toApply: toApply, divergences: divergences)
    }
}
```

- [ ] **Step 3: Write `TemplateScriptsSyncCheckerTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsSyncCheckerTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeTemplate(_ contents: String) throws -> URL {
        let root = tmpDir()
        try writeFile(contents, to: root.appendingPathComponent("scripts/pre-deploy-check.ts"))
        return root
    }

    private func makeSite() -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try? FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        return (source, config)
    }

    @Test func newTemplateFileNotOnSiteIsQueuedForSilentCreate() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.create(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)
    }

    @Test func matchingContentIsANoOpAndBackfillsMissingBaseline() throws {
        let template = try makeTemplate("same content")
        let (source, config) = makeSite()
        try writeFile("same content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)

        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("same content"))
    }

    @Test func legacySiteWithNoBaselineSilentlyRefreshesOnFirstEncounter() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("old site content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        // No baseline file at all — a pre-existing site from before this mechanism shipped.

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.refresh(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)

        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("old site content"))
    }

    @Test func unmodifiedSiteFileWithExistingBaselineIsQueuedForRefreshWithoutRewritingBaseline() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("scaffolded content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: VectorMath.stableHash("scaffolded content"))
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply == [.refresh(relativePath: "scripts/pre-deploy-check.ts")])
        #expect(plan.divergences.isEmpty)
        // The checker never bumps the baseline for a queued refresh — only the applier does,
        // once the file is actually written.
        #expect(TemplateScriptsBaseline.load(from: config) == baseline)
    }

    @Test func ownerEditedFileIsQueuedAsADivergence() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: VectorMath.stableHash("scaffolded content"))
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("new template content")
            )
        ])
    }

    @Test func acknowledgedDivergenceAtTheSameTemplateHashIsSkipped() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(
            baselineHash: VectorMath.stableHash("scaffolded content"),
            acknowledgedTemplateHash: VectorMath.stableHash("new template content")
        )
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences.isEmpty)
    }

    @Test func divergenceIsRequeuedWhenTemplateChangesAgainAfterAnAcknowledgement() throws {
        let template = try makeTemplate("yet another template revision")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(
            baselineHash: VectorMath.stableHash("scaffolded content"),
            acknowledgedTemplateHash: VectorMath.stableHash("new template content")  // an older revision
        )
        try baseline.save(to: config)

        let plan = TemplateScriptsSyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )
        #expect(plan.toApply.isEmpty)
        #expect(plan.divergences == [
            TemplateScriptsDivergence(
                relativePath: "scripts/pre-deploy-check.ts",
                templateHash: VectorMath.stableHash("yet another template revision")
            )
        ])
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TemplateScriptsSyncCheckerTests`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/TemplateScriptsSync.swift Sources/AnglesiteCore/TemplateScriptsSyncChecker.swift Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift
git commit -m "feat(#1053): add TemplateScriptsSyncChecker"
```

---

## Task 4: `TemplateScriptsSyncApplier`

**Files:**
- Create: `Sources/AnglesiteCore/TemplateScriptsSyncApplier.swift`
- Create: `Tests/AnglesiteCoreTests/TemplateScriptsSyncApplierTests.swift`

**Interfaces:**
- Consumes: `TemplateScriptsSyncAction`, `TemplateScriptsDivergence`, `TemplateScriptsBaseline`/`.Entry` (Task 3/2), `VectorMath.stableHash(_:)`.
- Produces: `public enum TemplateScriptsSyncApplier { public enum ApplyError: Error, Equatable { case templateReadFailed(relativePath: String); case writeFailed(relativePath: String) }; public enum DivergenceDecision: Sendable, Equatable { case update; case keepMine }; public static func applyQueued(_ actions: [TemplateScriptsSyncAction], sourceDirectory: URL, configDirectory: URL, templateDirectory: URL) throws; public static func resolve(_ divergence: TemplateScriptsDivergence, decision: DivergenceDecision, sourceDirectory: URL, configDirectory: URL, templateDirectory: URL) throws }`. `DivergenceDecision` is what Task 5's `ScriptSyncModel` and Task 6's wiring code both reference by this exact name.

- [ ] **Step 1: Write `TemplateScriptsSyncApplier.swift`**

```swift
import Foundation

/// Applies what `TemplateScriptsSyncChecker` found (design doc §Apply/§Divergence UX). Two entry
/// points: `applyQueued` for the silent create/refresh actions (no owner consent needed — safe to
/// call unconditionally and immediately), and `resolve` for a single divergence the owner has made
/// a decision about.
public enum TemplateScriptsSyncApplier {
    public enum ApplyError: Error, Equatable {
        case templateReadFailed(relativePath: String)
        case writeFailed(relativePath: String)
    }

    public enum DivergenceDecision: Sendable, Equatable {
        /// Overwrite the owner's version with the template's (git-recoverable; design doc's
        /// resolution that `Source/` being a real git repo is sufficient recovery — no extra
        /// sibling backup file).
        case update
        /// Leave the file untouched; remember the template hash they declined.
        case keepMine
    }

    public static func applyQueued(
        _ actions: [TemplateScriptsSyncAction],
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) throws {
        guard !actions.isEmpty else { return }
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        for action in actions {
            let relativePath = action.relativePath
            let templateURL = templateDirectory.appendingPathComponent(relativePath)
            guard let templateContent = try? String(contentsOf: templateURL, encoding: .utf8) else {
                throw ApplyError.templateReadFailed(relativePath: relativePath)
            }
            let siteURL = sourceDirectory.appendingPathComponent(relativePath)
            try? FileManager.default.createDirectory(
                at: siteURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            do {
                try templateContent.write(to: siteURL, atomically: true, encoding: .utf8)
            } catch {
                throw ApplyError.writeFailed(relativePath: relativePath)
            }
            baseline.files[relativePath] = TemplateScriptsBaseline.Entry(
                baselineHash: VectorMath.stableHash(templateContent)
            )
        }
        try? baseline.save(to: configDirectory)
    }

    public static func resolve(
        _ divergence: TemplateScriptsDivergence,
        decision: DivergenceDecision,
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL
    ) throws {
        var baseline = TemplateScriptsBaseline.load(from: configDirectory)
        switch decision {
        case .update:
            let templateURL = templateDirectory.appendingPathComponent(divergence.relativePath)
            guard let templateContent = try? String(contentsOf: templateURL, encoding: .utf8) else {
                throw ApplyError.templateReadFailed(relativePath: divergence.relativePath)
            }
            let siteURL = sourceDirectory.appendingPathComponent(divergence.relativePath)
            do {
                try templateContent.write(to: siteURL, atomically: true, encoding: .utf8)
            } catch {
                throw ApplyError.writeFailed(relativePath: divergence.relativePath)
            }
            baseline.files[divergence.relativePath] = TemplateScriptsBaseline.Entry(
                baselineHash: VectorMath.stableHash(templateContent)
            )
        case .keepMine:
            // The checker always records a baseline entry before ever flagging a divergence
            // (design doc §Detection step 5), so this entry exists in every real call path.
            var entry = baseline.files[divergence.relativePath]
                ?? TemplateScriptsBaseline.Entry(baselineHash: divergence.templateHash)
            entry.acknowledgedTemplateHash = divergence.templateHash
            baseline.files[divergence.relativePath] = entry
        }
        try? baseline.save(to: configDirectory)
    }
}
```

- [ ] **Step 2: Write `TemplateScriptsSyncApplierTests.swift`**

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsSyncApplierTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func makeTemplate(_ contents: String) throws -> URL {
        let root = tmpDir()
        try writeFile(contents, to: root.appendingPathComponent("scripts/pre-deploy-check.ts"))
        return root
    }

    private func makeSite() -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try? FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        return (source, config)
    }

    @Test func applyQueuedCreatesAMissingFileAndRecordsItsBaseline() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        try TemplateScriptsSyncApplier.applyQueued(
            [.create(relativePath: "scripts/pre-deploy-check.ts")],
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("template content"))
    }

    @Test func applyQueuedRefreshesAnExistingFileAndBumpsItsBaseline() throws {
        let template = try makeTemplate("new template content")
        let (source, config) = makeSite()
        try writeFile("stale content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))

        try TemplateScriptsSyncApplier.applyQueued(
            [.refresh(relativePath: "scripts/pre-deploy-check.ts")],
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "new template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("new template content"))
    }

    @Test func applyQueuedWithNoActionsTouchesNothing() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()

        try TemplateScriptsSyncApplier.applyQueued(
            [], sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        #expect(!FileManager.default.fileExists(
            atPath: config.appendingPathComponent(TemplateScriptsBaseline.filename).path))
    }

    @Test func applyQueuedThrowsWhenTheTemplateFileIsUnreadable() throws {
        let template = tmpDir()  // no scripts/ directory at all
        let (source, config) = makeSite()

        #expect(throws: TemplateScriptsSyncApplier.ApplyError.templateReadFailed(
            relativePath: "scripts/pre-deploy-check.ts")
        ) {
            try TemplateScriptsSyncApplier.applyQueued(
                [.create(relativePath: "scripts/pre-deploy-check.ts")],
                sourceDirectory: source, configDirectory: config, templateDirectory: template
            )
        }
    }

    @Test func resolveUpdateOverwritesTheOwnersVersion() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        let divergence = TemplateScriptsDivergence(
            relativePath: "scripts/pre-deploy-check.ts", templateHash: VectorMath.stableHash("template content")
        )

        try TemplateScriptsSyncApplier.resolve(
            divergence, decision: .update,
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let written = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(written == "template content")
        let baseline = TemplateScriptsBaseline.load(from: config)
        #expect(baseline.files["scripts/pre-deploy-check.ts"]?.baselineHash == VectorMath.stableHash("template content"))
    }

    @Test func resolveKeepMineLeavesTheFileUntouchedAndRecordsAcknowledgement() throws {
        let template = try makeTemplate("template content")
        let (source, config) = makeSite()
        try writeFile("owner's customized content", to: source.appendingPathComponent("scripts/pre-deploy-check.ts"))
        var baseline = TemplateScriptsBaseline()
        baseline.files["scripts/pre-deploy-check.ts"] = .init(baselineHash: "original-baseline-hash")
        try baseline.save(to: config)
        let divergence = TemplateScriptsDivergence(
            relativePath: "scripts/pre-deploy-check.ts", templateHash: VectorMath.stableHash("template content")
        )

        try TemplateScriptsSyncApplier.resolve(
            divergence, decision: .keepMine,
            sourceDirectory: source, configDirectory: config, templateDirectory: template
        )

        let unchanged = try String(contentsOf: source.appendingPathComponent("scripts/pre-deploy-check.ts"), encoding: .utf8)
        #expect(unchanged == "owner's customized content")
        let saved = TemplateScriptsBaseline.load(from: config)
        #expect(saved.files["scripts/pre-deploy-check.ts"]?.baselineHash == "original-baseline-hash")
        #expect(saved.files["scripts/pre-deploy-check.ts"]?.acknowledgedTemplateHash == VectorMath.stableHash("template content"))
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TemplateScriptsSyncApplierTests`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteCore/TemplateScriptsSyncApplier.swift Tests/AnglesiteCoreTests/TemplateScriptsSyncApplierTests.swift
git commit -m "feat(#1053): add TemplateScriptsSyncApplier"
```

---

## Task 5: `ScriptSyncModel` (AnglesiteApp presentation layer)

**Files:**
- Create: `Sources/AnglesiteApp/ScriptSyncModel.swift`
- Create: `Tests/AnglesiteAppTests/ScriptSyncModelTests.swift`

**Interfaces:**
- Consumes: `TemplateScriptsDivergence`, `TemplateScriptsSyncApplier.DivergenceDecision` (Tasks 3/4, `AnglesiteCore`).
- Produces: `@MainActor final class ScriptSyncModel: Identifiable { nonisolated let id: UUID; private(set) var pending: [TemplateScriptsDivergence]; init(divergences: [TemplateScriptsDivergence], onResolve: @escaping (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Void, onFinished: @escaping () -> Void); func update(_ divergence: TemplateScriptsDivergence); func keepMine(_ divergence: TemplateScriptsDivergence) }` — Task 6's `SiteWindowModel`/`SiteWindow.swift` wiring uses `pending`, `update(_:)`, and `keepMine(_:)` by these exact names.

- [ ] **Step 1: Write `ScriptSyncModel.swift`**

```swift
import Foundation
import AnglesiteCore

/// Thin, `Identifiable` model driving the scripts/-divergence sheet (design doc §Divergence UX).
/// Holds the queued divergences and forwards each row's decision — no diffing/hashing logic lives
/// here, that's all in `AnglesiteCore` (`TemplateScriptsSyncChecker`/`Applier`). Unlike
/// `DependencyUpdateModel` (one accept-or-skip decision for the whole list), this model tracks a
/// per-row decision and only signals completion once every row has been resolved.
@MainActor
final class ScriptSyncModel: Identifiable {
    nonisolated let id = UUID()
    private(set) var pending: [TemplateScriptsDivergence]
    private let onResolve: (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Void
    private let onFinished: () -> Void

    init(
        divergences: [TemplateScriptsDivergence],
        onResolve: @escaping (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.pending = divergences
        self.onResolve = onResolve
        self.onFinished = onFinished
    }

    func update(_ divergence: TemplateScriptsDivergence) {
        onResolve(divergence, .update)
        remove(divergence)
    }

    func keepMine(_ divergence: TemplateScriptsDivergence) {
        onResolve(divergence, .keepMine)
        remove(divergence)
    }

    private func remove(_ divergence: TemplateScriptsDivergence) {
        pending.removeAll { $0.id == divergence.id }
        if pending.isEmpty { onFinished() }
    }
}
```

- [ ] **Step 2: Write `ScriptSyncModelTests.swift`**

```swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

@MainActor
@Suite struct ScriptSyncModelTests {
    private let fileA = TemplateScriptsDivergence(relativePath: "scripts/a.ts", templateHash: "hash-a")
    private let fileB = TemplateScriptsDivergence(relativePath: "scripts/b.ts", templateHash: "hash-b")

    @Test func resolvingOneOfTwoRowsRemovesItWithoutFinishing() {
        var resolved: [(TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision)] = []
        var finished = false
        let model = ScriptSyncModel(
            divergences: [fileA, fileB],
            onResolve: { resolved.append(($0, $1)) },
            onFinished: { finished = true }
        )

        model.update(fileA)

        #expect(resolved.count == 1)
        #expect(resolved[0].0 == fileA)
        #expect(resolved[0].1 == .update)
        #expect(model.pending == [fileB])
        #expect(finished == false)
    }

    @Test func resolvingEveryRowFiresOnFinishedExactlyOnce() {
        var finishedCount = 0
        let model = ScriptSyncModel(
            divergences: [fileA, fileB],
            onResolve: { _, _ in },
            onFinished: { finishedCount += 1 }
        )

        model.keepMine(fileA)
        #expect(finishedCount == 0)
        model.update(fileB)
        #expect(finishedCount == 1)
        #expect(model.pending.isEmpty)
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `swift test --package-path . --filter ScriptSyncModelTests`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/ScriptSyncModel.swift Tests/AnglesiteAppTests/ScriptSyncModelTests.swift
git commit -m "feat(#1053): add ScriptSyncModel"
```

---

## Task 6: Wire into `SiteWindowModel` and `SiteWindow`

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:167` (new property), `:1491-1524` (new wiring block, inserted right before `styleGuide = ProjectConventionsModel(`)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift:612-636` (new sheet, inserted right after the existing `dependencyUpdateModel` sheet)

**Interfaces:**
- Consumes: `TemplateScriptsSyncChecker.check(sourceDirectory:configDirectory:templateDirectory:)` (Task 3), `TemplateScriptsSyncApplier.applyQueued(_:sourceDirectory:configDirectory:templateDirectory:)`/`.resolve(_:decision:sourceDirectory:configDirectory:templateDirectory:)` (Task 4), `ScriptSyncModel` (Task 5).
- Produces: `SiteWindowModel.scriptSyncModel: ScriptSyncModel?` — a `.sheet(item:)`-driven property other tasks don't need, but this is the last task, so nothing downstream consumes it.

No new automated test for this task (see design doc §Testing — the analogous `DependencySyncChecker` wiring in the same method has never had one either, confirmed at `Tests/AnglesiteAppTests/SiteWindowModelTests.swift:114`, and building a first-of-its-kind `loadAndStart()` harness just for this hook isn't worth the weight when the checker/applier/model are each already fully covered). Verify this task by building and by the manual QA steps below.

- [ ] **Step 1: Add the `scriptSyncModel` property**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, right after the existing `dependencyUpdateModel` property (line 167):

```swift
    /// Non-nil ⟺ the dependency-update-offer sheet is presented (`.sheet(item:)`), set by the
    /// detection hook in `loadAndStart()` when `DependencySyncChecker` finds offers to show.
    var dependencyUpdateModel: DependencyUpdateModel?
    /// Non-nil ⟺ the scripts/-divergence sheet is presented (`.sheet(item:)`), set by the
    /// detection hook in `loadAndStart()` when `TemplateScriptsSyncChecker` finds files the owner
    /// customized that the template has also moved on past (#1053).
    var scriptSyncModel: ScriptSyncModel?
```

- [ ] **Step 2: Add the wiring block in `loadAndStart()`**

In the same file, right after the existing dependency-sync block's closing `}` (line 1523) and before `styleGuide = ProjectConventionsModel(` (line 1524):

```swift
        if let templateURL = TemplateRuntime.bundledURL() {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL
            )
            if !plan.toApply.isEmpty {
                try? TemplateScriptsSyncApplier.applyQueued(
                    plan.toApply,
                    sourceDirectory: resolved.sourceDirectory,
                    configDirectory: resolved.configDirectory,
                    templateDirectory: templateURL
                )
            }
            if !plan.divergences.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    scriptSyncModel = ScriptSyncModel(
                        divergences: plan.divergences,
                        onResolve: { [weak self] divergence, decision in
                            guard let self else { return }
                            try? TemplateScriptsSyncApplier.resolve(
                                divergence,
                                decision: decision,
                                sourceDirectory: resolved.sourceDirectory,
                                configDirectory: resolved.configDirectory,
                                templateDirectory: templateURL
                            )
                        },
                        onFinished: { [weak self] in
                            self?.scriptSyncModel = nil
                            continuation.resume()
                        }
                    )
                }
            }
        }
```

Note this guard is `TemplateRuntime.bundledURL()` only — unlike the dependency-sync block just above it, this mechanism has no use for `AppVersion.current()` (it deliberately doesn't key off the app-version stamp; see design doc §Data model).

- [ ] **Step 3: Add the sheet in `SiteWindow.swift`**

In `Sources/AnglesiteApp/SiteWindow.swift`, right after the existing `.sheet(item: $bindableModel.dependencyUpdateModel)` block's closing `}` (line 636) and before `.sheet(item: $bindableModel.copyEditModel)`:

```swift
        .sheet(item: $bindableModel.scriptSyncModel) { syncModel in
            NavigationStack {
                List(syncModel.pending) { divergence in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(divergence.relativePath)
                            .font(.system(.body, design: .monospaced))
                        Text("This file has been customized. An update is available with changes it doesn't include yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack {
                            Button("Keep My Version") { syncModel.keepMine(divergence) }
                            Spacer()
                            Button("Update This File") { syncModel.update(divergence) }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .navigationTitle("Site Scripts Customized")
            }
            .frame(minWidth: 420, minHeight: 260)
            // Mirrors the dependency-update sheet immediately above: `loadAndStart()` suspends on
            // a `CheckedContinuation` that only resumes once every row is resolved (see
            // `ScriptSyncModel.remove`/`SiteWindowModel.loadAndStart`). Block outside-tap/swipe
            // dismissal so per-row buttons are structurally the only way out.
            .interactiveDismissDisabled()
        }
```

- [ ] **Step 4: Build to confirm it compiles**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`. If `Anglesite.xcodeproj` doesn't exist yet in this worktree, run `xcodegen generate` first (`AGENTS.md` ▸ "Worktrees").

- [ ] **Step 5: Run the full Swift package test suite**

Run: `swift test --package-path .`
Expected: PASS — every test from Tasks 1–5 plus the existing suite, none broken by the new wiring.

- [ ] **Step 6: Manual QA**

Open (or scaffold) a site, hand-edit its `Source/scripts/pre-deploy-check.ts` (append a comment line), then point `Config/template-scripts-baseline.json` at a `baselineHash` that does **not** match that edited content (simulating "template also moved on") — or simpler: temporarily edit the app-bundled template's `Resources/Template/scripts/pre-deploy-check.ts` and reopen the site. Confirm:
- The sheet titled "Site Scripts Customized" appears with the edited file listed.
- "Keep My Version" dismisses that row without touching the file; reopening the site does not re-show it.
- "Update This File" (on a fresh divergence) overwrites the file with the template's content.
- A site with no `scripts/` customizations at all opens with no sheet, and its stale (but unmodified) scripts silently pick up the template's current content.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#1053): wire scripts/ refresh into site-open flow"
```

---

## Task 7: Document "the app advises; it does not delegate" in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (`AGENTS.md` is a symlink to this file, so one edit covers both)

**Interfaces:** None — documentation only, no code.

- [ ] **Step 1: Add the principle under "Editing guidelines"**

In `CLAUDE.md`, in the `## Editing guidelines` bulleted list, right after the existing "**The app cannot bypass the pre-deploy security gate**" bullet, add:

```markdown
- **The app advises; it does not delegate the decision.** Anglesite's users are not people who will adjudicate a three-way merge or a conflict marker — they came here to publish a website. Where the app knows the right answer (e.g. app-owned build/security machinery under `scripts/` — see #1053), it applies it without asking. Where it genuinely doesn't, ask a question phrased about consequences to the owner's site, never about git, diffs, or file layout.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(#1053): app advises, doesn't delegate — CLAUDE.md principle"
```

---

## Task 8: Final verification and String Catalog sync

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (String Catalog sync output, if the CLI recipe below finds new keys)

**Interfaces:** None.

- [ ] **Step 1: Run the full Swift package test suite one more time**

Run: `swift test --package-path .`
Expected: PASS, no regressions.

- [ ] **Step 2: Build the app target**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Sync the new user-visible strings into the String Catalog**

Task 6 introduced four new literals ("Keep My Version", "Update This File", "Site Scripts Customized", the row explanation text). Per `CONTRIBUTING.md`'s String Catalog step, a CLI-only build emits `.stringsdata` but never merges it into `Localizable.xcstrings`. Run, scoped to this worktree's own build:

```bash
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

- [ ] **Step 4: Review the resulting diff**

Run: `git diff Sources/AnglesiteApp/Localizable.xcstrings`
Expected: only the four new keys from Task 6 added, no unrelated keys touched or removed. If the diff contains anything else (keys from other in-flight branches, or the catalog emptied out), do **not** commit it — re-run Step 3 after a clean build (`xcodebuild ... clean build`) instead, per `CONTRIBUTING.md`'s caveat.

- [ ] **Step 5: Commit the catalog update, if any**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(#1053): sync String Catalog for scripts/ refresh sheet"
```

If Step 4 found no diff (e.g. an interactive Xcode session already merged these strings during Task 6's build), skip this commit — there's nothing to add.
