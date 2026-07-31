# Template Dependency Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `DependencySync` so a template package that's new (present in the template, absent from the site) can be offered and installed into an existing site, not just version-bumped.

**Architecture:** `DependencySync.diff` gains a second output — addition offers alongside today's update offers, bundled in a new `DependencySyncOffers` struct. `PackageJSONDependencies` gains a section-aware extractor and an `applyAdditions` writer. `DependencySyncChecker`/`DependencySyncApplier` and the app's dependency-update sheet thread the new type through; the sheet UI gains a second, visually distinct section for additions.

**Tech Stack:** Swift 6.4, Swift Testing (`@Suite`/`@Test`), SwiftUI.

## Global Constraints

- Swift/SwiftUI with Apple frameworks only — no new third-party dependencies (CONTRIBUTING.md ▸ "Code guidelines").
- Conventional commit subjects ≤72 characters, referencing `#1108` (CONTRIBUTING.md ▸ "Commits and pull requests").
- `DependencySync.diff` never removes a package name the template dropped — unchanged invariant, do not touch that behavior.
- This is an app-only change (no MCP message schema touched) — no paired sidecar PR needed.
- **Compilation is atomic across the whole SwiftPM package.** `Sources/AnglesiteApp` is built as the `AnglesiteAppCore` SwiftPM target (`Package.swift:232`, gated `#if compiler(>=6.4) && canImport(Darwin)`), so `swift test --package-path .` compiles `SiteWindowModel.swift`/`SiteWindow.swift`/`DependencyUpdateModel.swift` too, not just `AnglesiteCore`. `swift test --filter` only restricts what *runs*, not what *compiles* — a broken file anywhere in the package blocks every suite. Task boundaries below are drawn so each task's final commit leaves the whole package compiling; do not split a task further without re-checking this.
- Run `swift test --package-path .` before considering any task done; run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` before considering the whole plan done.
- Full design reference: [`docs/superpowers/specs/2026-07-30-template-dependency-additions-design.md`](../specs/2026-07-30-template-dependency-additions-design.md).

---

### Task 1: New offer types + `PackageJSONDependencies` additions

This task only *adds* new types and new functions — it does not change any existing function's signature or behavior, so it's safe to land on its own: nothing calls the new code yet, and everything that currently compiles keeps compiling.

**Files:**
- Modify: `Sources/AnglesiteCore/DependencySync.swift` (add types only — `diff` itself is untouched until Task 2)
- Modify: `Sources/AnglesiteCore/PackageJSONDependencies.swift`
- Test: `Tests/AnglesiteCoreTests/PackageJSONDependenciesTests.swift`

**Interfaces:**
- Produces: `public enum DependencySection: Sendable, Equatable { case dependencies, devDependencies }`
- Produces: `public struct DependencyAdditionOffer: Sendable, Equatable { public let name: String; public let offeredRange: String; public let section: DependencySection; public init(name:offeredRange:section:) }`
- Produces: `public struct DependencySyncOffers: Sendable, Equatable { public let updates: [DependencyUpdateOffer]; public let additions: [DependencyAdditionOffer]; public init(updates: [DependencyUpdateOffer] = [], additions: [DependencyAdditionOffer] = []); public var isEmpty: Bool }` (not consumed by `diff` until Task 2)
- Produces: `public static func extractSections(from text: String) throws -> (dependencies: [String: String], devDependencies: [String: String])`
- Produces: `public static func applyAdditions(_ offers: [DependencyAdditionOffer], to text: String) -> String`
- `public static func extract(from text: String) throws -> [String: String]` keeps its existing signature and behavior (devDependencies wins on name collision), reimplemented in terms of `extractSections`.

- [ ] **Step 1: Add the new offer types to `DependencySync.swift`**

In `Sources/AnglesiteCore/DependencySync.swift`, find:

```swift
/// One offered version-range bump for a single package.
public struct DependencyUpdateOffer: Sendable, Equatable {
    public let name: String
    public let currentRange: String
    public let offeredRange: String

    public init(name: String, currentRange: String, offeredRange: String) {
        self.name = name
        self.currentRange = currentRange
        self.offeredRange = offeredRange
    }
}

/// Three-way comparison between a site's dependencies, an optional scaffold-time
```

Replace it with (inserting the three new types between `DependencyUpdateOffer` and the doc comment on `DependencySync`):

```swift
/// One offered version-range bump for a single package.
public struct DependencyUpdateOffer: Sendable, Equatable {
    public let name: String
    public let currentRange: String
    public let offeredRange: String

    public init(name: String, currentRange: String, offeredRange: String) {
        self.name = name
        self.currentRange = currentRange
        self.offeredRange = offeredRange
    }
}

/// Which `package.json` section a dependency belongs (or would be added) to.
public enum DependencySection: Sendable, Equatable {
    case dependencies
    case devDependencies
}

/// One offered new package the template has that the site does not.
public struct DependencyAdditionOffer: Sendable, Equatable {
    public let name: String
    public let offeredRange: String
    public let section: DependencySection

    public init(name: String, offeredRange: String, section: DependencySection) {
        self.name = name
        self.offeredRange = offeredRange
        self.section = section
    }
}

/// The full result of a `DependencySync.diff` call: version bumps for packages
/// the site already has, and new packages the template has that the site
/// doesn't. `diff` itself doesn't return this yet (see #1108 Task 2) — this
/// type exists now so `PackageJSONDependencies.applyAdditions` can consume
/// `DependencyAdditionOffer` independently.
public struct DependencySyncOffers: Sendable, Equatable {
    public let updates: [DependencyUpdateOffer]
    public let additions: [DependencyAdditionOffer]

    public init(updates: [DependencyUpdateOffer] = [], additions: [DependencyAdditionOffer] = []) {
        self.updates = updates
        self.additions = additions
    }

    public var isEmpty: Bool { updates.isEmpty && additions.isEmpty }
}

/// Three-way comparison between a site's dependencies, an optional scaffold-time
```

Leave the rest of the file (the `DependencySync` enum and its `diff` function) completely unchanged for now.

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `swift test --package-path .`
Expected: PASS — every existing suite is green (these are pure additions; nothing references the new types yet).

- [ ] **Step 3: Write the failing tests for `PackageJSONDependencies`**

Add these test cases to the end of the `PackageJSONDependenciesTests` suite in `Tests/AnglesiteCoreTests/PackageJSONDependenciesTests.swift` (inside the closing `}` of the existing suite, after `applyUpdatesAPackageNamePresentInBothSections`):

```swift
    @Test func extractSectionsKeepsDependenciesAndDevDependenciesSeparate() throws {
        let sections = try PackageJSONDependencies.extractSections(from: Self.fixture)
        #expect(sections.dependencies == ["@astrojs/rss": "^4.0.0", "astro": "^5.0.0"])
        #expect(sections.devDependencies == ["typescript": "^5.9.3"])
    }

    @Test func extractSectionsThrowsOnInvalidJSON() {
        #expect(throws: PackageJSONDependencies.ExtractionError.self) {
            _ = try PackageJSONDependencies.extractSections(from: "not json")
        }
    }

    @Test func applyAdditionsInsertsANewEntryMatchingExistingIndentation() {
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: Self.fixture)
        #expect(updated.contains("\"dependencies\": {\n    \"astro-embed\": \"^0.13.0\",\n    \"@astrojs/rss\": \"^4.0.0\",\n    \"astro\": \"^5.0.0\"\n  }"))
    }

    @Test func applyAdditionsTargetsTheDevDependenciesSectionWhenSpecified() {
        let offers = [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: Self.fixture)
        #expect(updated.contains("\"devDependencies\": {\n    \"html-validate\": \"^11.6.0\",\n    \"typescript\": \"^5.9.3\"\n  }"))
        // dependencies section untouched
        #expect(updated.contains("\"dependencies\": {\n    \"@astrojs/rss\": \"^4.0.0\",\n    \"astro\": \"^5.0.0\"\n  }"))
    }

    @Test func applyAdditionsUsesADefaultIndentForAnEmptySection() {
        let text = """
        {
          "dependencies": {}
        }
        """
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: text)
        #expect(updated.contains("\"dependencies\": {\n  \"astro-embed\": \"^0.13.0\"\n}"))
    }

    @Test func applyAdditionsSkipsWhenTheTargetSectionIsAbsent() {
        let text = """
        {
          "name": "anglesite-site"
        }
        """
        let offers = [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)]
        #expect(PackageJSONDependencies.applyAdditions(offers, to: text) == text)
    }

    @Test func applyAdditionsHandlesMultipleOffersToTheSameSection() {
        let text = """
        {
          "dependencies": {
            "astro": "^5.0.0"
          }
        }
        """
        let offers = [
            DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies),
            DependencyAdditionOffer(name: "@tgwf/co2", offeredRange: "^0.19.0", section: .dependencies),
        ]
        let updated = PackageJSONDependencies.applyAdditions(offers, to: text)
        #expect(updated.contains("\"astro-embed\": \"^0.13.0\""))
        #expect(updated.contains("\"@tgwf/co2\": \"^0.19.0\""))
        #expect(updated.contains("\"astro\": \"^5.0.0\""))
    }

    @Test func applyAdditionsWithNoOffersReturnsTheTextUnchanged() {
        #expect(PackageJSONDependencies.applyAdditions([], to: Self.fixture) == Self.fixture)
    }
```

- [ ] **Step 4: Run the tests to verify they fail to compile**

Run: `swift test --package-path . --filter PackageJSONDependenciesTests`
Expected: FAIL to build — `extractSections` and `applyAdditions` don't exist yet.

- [ ] **Step 5: Implement `extractSections` and `applyAdditions`**

In `Sources/AnglesiteCore/PackageJSONDependencies.swift`, replace the existing `extract(from:)` method with this pair (keeping everything else — `ExtractionError`, `apply`, `objectSpan` — unchanged):

```swift
    /// `dependencies` and `devDependencies`, kept separate (unlike `extract`,
    /// which merges them). Used where the caller needs to know which section a
    /// package belongs to, not just its version range.
    public static func extractSections(from text: String) throws -> (dependencies: [String: String], devDependencies: [String: String]) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data),
              let object = json as? [String: Any]
        else { throw ExtractionError.invalidJSON }
        let deps = object["dependencies"] as? [String: String] ?? [:]
        let devDeps = object["devDependencies"] as? [String: String] ?? [:]
        return (dependencies: deps, devDependencies: devDeps)
    }

    /// The union of `dependencies` and `devDependencies` (name -> version range).
    /// If a name appears in both sections, `devDependencies` wins (checked second).
    public static func extract(from text: String) throws -> [String: String] {
        let sections = try extractSections(from: text)
        var result = sections.dependencies
        result.merge(sections.devDependencies) { _, new in new }
        return result
    }
```

Then add `applyAdditions` immediately after the existing `apply(_:to:)` method (before the private `objectSpan` helper):

```swift
    /// Inserts each offer's `"name": "range"` as a new first entry in its
    /// target `dependencies`/`devDependencies` section, copying the
    /// indentation of whatever currently comes first in that section. An
    /// offer whose target section doesn't exist in `text` at all is silently
    /// skipped — this mutates existing structure, it never fabricates a new
    /// top-level section.
    public static func applyAdditions(_ offers: [DependencyAdditionOffer], to text: String) -> String {
        var result = text
        for offer in offers {
            let key = offer.section == .devDependencies ? "devDependencies" : "dependencies"
            guard let span = objectSpan(forKey: key, in: result) else { continue }
            let openBrace = span.lowerBound
            let afterBrace = result.index(after: openBrace)
            var firstContent = afterBrace
            while firstContent < span.upperBound, result[firstContent].isWhitespace {
                firstContent = result.index(after: firstContent)
            }
            let escapedName = offer.name.replacingOccurrences(of: "\"", with: "\\\"")
            let escapedRange = offer.offeredRange.replacingOccurrences(of: "\"", with: "\\\"")
            let entry = "\"\(escapedName)\": \"\(escapedRange)\""
            if result[firstContent] != "}" {
                // Non-empty section: prepend as a new first entry, copying the
                // whitespace that currently precedes the existing first entry.
                let indent = String(result[afterBrace..<firstContent])
                result.insert(contentsOf: "\(entry),\(indent)", at: afterBrace)
            } else {
                // Empty section (`{}` or `{ }`): no existing indentation to copy.
                result.replaceSubrange(afterBrace..<firstContent, with: "\n  \(entry)\n")
            }
        }
        return result
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `swift test --package-path . --filter PackageJSONDependenciesTests`
Expected: PASS — all tests (existing + new) green.

- [ ] **Step 7: Run the full suite once more and commit**

Run: `swift test --package-path .`
Expected: PASS — whole package still compiles and passes.

```bash
git add Sources/AnglesiteCore/DependencySync.swift Sources/AnglesiteCore/PackageJSONDependencies.swift Tests/AnglesiteCoreTests/PackageJSONDependenciesTests.swift
git commit -m "feat(#1108): add addition-offer types and package.json writer"
```

---

### Task 2: Wire additions through diff → checker → applier → sheet UI

This is the atomic core of the feature. `DependencySync.diff`'s return type changes from `[DependencyUpdateOffer]` to `DependencySyncOffers`, and every one of its callers — `DependencySyncChecker`, `DependencySyncApplier`, `DependencyUpdateModel`, and the `SiteWindow.swift` sheet — depends on that change to keep compiling. They must land together in this one task; there is no smaller slice that leaves the package building (see the Global Constraints note above). `Sources/AnglesiteApp/SiteWindowModel.swift` needs **no changes** — its local `offers` variable's type follows automatically from `DependencySyncChecker.check`'s new return type, and it's passed straight through to `DependencyUpdateModel.init` and `DependencySyncApplier.apply` unchanged.

**Files:**
- Modify: `Sources/AnglesiteCore/DependencySync.swift` (the `diff` function body)
- Modify: `Sources/AnglesiteCore/DependencySyncChecker.swift`
- Modify: `Sources/AnglesiteCore/DependencySyncApplier.swift`
- Modify: `Sources/AnglesiteApp/DependencyUpdateModel.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (around line 645)
- Test: `Tests/AnglesiteCoreTests/DependencySyncTests.swift`
- Test: `Tests/AnglesiteCoreTests/DependencySyncCheckerTests.swift`
- Test: `Tests/AnglesiteCoreTests/DependencySyncApplierTests.swift`

**Interfaces:**
- Consumes: `DependencySection`, `DependencyAdditionOffer`, `DependencySyncOffers`, `PackageJSONDependencies.extractSections`/`applyAdditions` (Task 1)
- Produces: `public static func diff(site: [String: String], baseline: [String: String]?, template: [String: String], templateDevDependencyNames: Set<String> = []) -> DependencySyncOffers`
- Produces: `public static func check(sourceDirectory: URL, configDirectory: URL, templateDirectory: URL, runningAppVersion: String) -> DependencySyncOffers` (same name/parameters as today, new return type)
- Produces: `public static func apply(_ offers: DependencySyncOffers, sourceDirectory: URL, configDirectory: URL, runningAppVersion: String) throws` (same name/parameters as today except the first parameter's type)
- Produces: `DependencyUpdateModel.offers: DependencySyncOffers` (was `[DependencyUpdateOffer]`)

- [ ] **Step 1: Write the failing tests for `DependencySync.diff`**

Replace the entire contents of `Tests/AnglesiteCoreTests/DependencySyncTests.swift` with:

```swift
import Testing
@testable import AnglesiteCore

@Suite struct DependencySyncTests {
    @Test func offersABumpWhenSiteMatchesBaselineButTemplateMovedForward() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0"],
            baseline: ["astro": "^5.0.0"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func leavesAUserCustomizedPackageAlone() {
        // Site's range no longer matches the baseline -> the user edited it deliberately.
        let offers = DependencySync.diff(
            site: ["astro": "^5.1.0"],
            baseline: ["astro": "^5.0.0"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func doesNothingWhenSiteBaselineAndTemplateAllAgree() {
        let offers = DependencySync.diff(
            site: ["astro": "^6.4.8"],
            baseline: ["astro": "^6.4.8"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func legacySiteWithNoBaselineFallsBackToADirectDiff() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0"],
            baseline: nil,
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func neverOffersToRemoveAPackageTheTemplateNoLongerHas() {
        let offers = DependencySync.diff(
            site: ["some-deprecated-package": "^1.0.0"],
            baseline: ["some-deprecated-package": "^1.0.0"],
            template: [:]
        )
        #expect(offers.isEmpty)
    }

    @Test func skipsAnIncomparableVersionRatherThanGuessing() {
        let offers = DependencySync.diff(
            site: ["astro": "workspace:*"],
            baseline: ["astro": "workspace:*"],
            template: ["astro": "^6.4.8"]
        )
        #expect(offers.isEmpty)
    }

    @Test func handlesMultiplePackagesSortedByName() {
        let offers = DependencySync.diff(
            site: ["astro": "^5.0.0", "tsx": "^3.0.0"],
            baseline: ["astro": "^5.0.0", "tsx": "^3.0.0"],
            template: ["astro": "^6.4.8", "tsx": "^4.0.0"]
        )
        #expect(offers.updates == [
            DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8"),
            DependencyUpdateOffer(name: "tsx", currentRange: "^3.0.0", offeredRange: "^4.0.0"),
        ])
    }

    @Test func offersToAddANewPackageWhenBaselineHasNoRecordOfIt() {
        // Baseline present but never saw this name -> nothing of the owner's to
        // have deliberately removed, safe to offer (#1108).
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["astro-embed": "^0.13.0"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies)])
        #expect(offers.updates.isEmpty)
    }

    @Test func offersToAddANewPackageWhenThereIsNoBaselineAtAll() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: nil,
            template: ["html-validate": "^11.6.0"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .dependencies)])
    }

    @Test func withholdsAnAdditionForAPackageTheSiteDeliberatelyRemoved() {
        // Baseline shows the site had this package before (e.g. a prior accepted
        // addition offer) -> its current absence is the owner's own doing.
        let offers = DependencySync.diff(
            site: [:],
            baseline: ["astro-embed": "^0.13.0"],
            template: ["astro-embed": "^0.14.0"]
        )
        #expect(offers.additions.isEmpty)
    }

    @Test func tagsAnAdditionAsADevDependencyWhenTheTemplateHasItThere() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["html-validate": "^11.6.0"],
            templateDevDependencyNames: ["html-validate"]
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
    }

    @Test func handlesMultipleAdditionsSortedByName() {
        let offers = DependencySync.diff(
            site: [:],
            baseline: [:],
            template: ["html-validate": "^11.6.0", "astro-embed": "^0.13.0"]
        )
        #expect(offers.additions == [
            DependencyAdditionOffer(name: "astro-embed", offeredRange: "^0.13.0", section: .dependencies),
            DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .dependencies),
        ])
    }
}
```

- [ ] **Step 2: Write the failing tests for `DependencySyncChecker`**

In `Tests/AnglesiteCoreTests/DependencySyncCheckerTests.swift`, replace the four existing `@Test` methods (`fastPathSkipsEverythingWhenStampedVersionMatchesRunningVersion` through `returnsEmptyRatherThanThrowingWhenPackageJSONIsMissing`) and add a fifth, leaving the helpers (`tmpDir`, `writeFile`, `makeSite`, `makeTemplate`) and fixtures (`stalePackageJSON`, `currentTemplatePackageJSON`) unchanged:

```swift
    @Test func fastPathSkipsEverythingWhenStampedVersionMatchesRunningVersion() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.4.0\n",
            packageJSON: Self.stalePackageJSON,  // deliberately stale, to prove the fast path never looks
            baseline: nil
        )
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.isEmpty)
    }

    @Test func fallsThroughToTheRealDiffWhenStampedVersionDiffers() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.2.0\n",
            packageJSON: Self.stalePackageJSON,
            baseline: ["astro": "^5.0.0"]
        )
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func fallsThroughWhenThereIsNoSiteConfigAtAll() throws {
        let (source, config) = try makeSite(siteConfig: nil, packageJSON: Self.stalePackageJSON, baseline: nil)
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.updates == [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
    }

    @Test func returnsEmptyRatherThanThrowingWhenPackageJSONIsMissing() throws {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        let template = try makeTemplate(packageJSON: Self.currentTemplatePackageJSON)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.isEmpty)
    }

    @Test func surfacesANewTemplateDevDependencyAsAnAdditionOffer() throws {
        let (source, config) = try makeSite(
            siteConfig: "ANGLESITE_VERSION=1.2.0\n",
            packageJSON: """
            { "dependencies": { "astro": "^6.4.8" }, "devDependencies": {} }
            """,
            baseline: ["astro": "^6.4.8"]
        )
        let template = try makeTemplate(packageJSON: """
        { "dependencies": { "astro": "^6.4.8" }, "devDependencies": { "html-validate": "^11.6.0" } }
        """)
        let offers = DependencySyncChecker.check(
            sourceDirectory: source, configDirectory: config, templateDirectory: template,
            runningAppVersion: "1.4.0"
        )
        #expect(offers.additions == [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
    }
```

- [ ] **Step 3: Write the failing tests for `DependencySyncApplier`**

Replace the entire contents of `Tests/AnglesiteCoreTests/DependencySyncApplierTests.swift` with:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct DependencySyncApplierTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static let packageJSON = """
    { "dependencies": { "astro": "^5.0.0" }, "devDependencies": {} }
    """

    private func makeSourceAndConfig() throws -> (source: URL, config: URL) {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        try Self.packageJSON.write(to: source.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "old lockfile contents".write(to: source.appendingPathComponent("package-lock.json"), atomically: true, encoding: .utf8)
        try "ANGLESITE_VERSION=1.2.0\n".write(to: source.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return (source, config)
    }

    @Test func rewritesPackageJSONWithTheAcceptedRange() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(updated.contains("\"astro\": \"^6.4.8\""))
    }

    @Test func writesAnAcceptedAdditionIntoTheCorrectSection() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(additions: [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let updated = try String(contentsOf: source.appendingPathComponent("package.json"), encoding: .utf8)
        #expect(updated.contains("\"html-validate\": \"^11.6.0\""))
    }

    @Test func deletesTheStaleLockfile() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        #expect(!FileManager.default.fileExists(atPath: source.appendingPathComponent("package-lock.json").path))
    }

    @Test func savesTheNewBaselineWithBothAcceptedUpdatesAndAdditions() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(
            updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")],
            additions: [DependencyAdditionOffer(name: "html-validate", offeredRange: "^11.6.0", section: .devDependencies)]
        )
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        #expect(DependencyBaseline.load(from: config) == ["astro": "^6.4.8", "html-validate": "^11.6.0"])
    }

    @Test func bumpsTheAnglesiteVersionStamp() throws {
        let (source, config) = try makeSourceAndConfig()
        let offers = DependencySyncOffers(updates: [DependencyUpdateOffer(name: "astro", currentRange: "^5.0.0", offeredRange: "^6.4.8")])
        try DependencySyncApplier.apply(offers, sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        let siteConfig = try String(contentsOf: source.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: siteConfig) == "1.4.0")
    }

    @Test func throwsReadFailedWhenPackageJSONIsMissing() throws {
        let root = tmpDir()
        let source = root.appendingPathComponent("Source")
        let config = root.appendingPathComponent("Config")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        #expect(throws: DependencySyncApplier.ApplyError.readFailed) {
            try DependencySyncApplier.apply(DependencySyncOffers(), sourceDirectory: source, configDirectory: config, runningAppVersion: "1.4.0")
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail to build**

Run: `swift test --package-path .`
Expected: FAIL to build. `DependencySync.diff` still returns `[DependencyUpdateOffer]`, `DependencySyncChecker.check`/`DependencySyncApplier.apply` haven't changed, so none of the `.updates`/`.additions` accessors or the new `DependencySyncOffers`-typed calls compile. (A plain `swift test`, not `--filter`, is deliberate here — the goal is to see the whole package fail together, matching how it will need to succeed together in Step 6.)

- [ ] **Step 5: Implement the four source files together**

In `Sources/AnglesiteCore/DependencySync.swift`, replace the `diff` function's body (leave the doc comment above `DependencySync` and everything from Task 1 alone):

```swift
public enum DependencySync {
    public static func diff(
        site: [String: String],
        baseline: [String: String]?,
        template: [String: String],
        templateDevDependencyNames: Set<String> = []
    ) -> DependencySyncOffers {
        var updates: [DependencyUpdateOffer] = []
        var additions: [DependencyAdditionOffer] = []
        for (name, templateRange) in template.sorted(by: { $0.key < $1.key }) {
            guard let siteRange = site[name] else {
                // Not in the site at all: a candidate for an addition offer,
                // gated by whether the site is known to have deliberately
                // removed it before (#1108).
                if let baseline {
                    guard baseline[name] == nil else { continue }
                }
                // else: no baseline at all -> legacy direct-diff fallback, same
                // risk tolerance as the bump path below.
                let section: DependencySection = templateDevDependencyNames.contains(name) ? .devDependencies : .dependencies
                additions.append(DependencyAdditionOffer(name: name, offeredRange: templateRange, section: section))
                continue
            }
            guard DependencyVersionComparator.isNewer(templateRange, than: siteRange) == true else { continue }
            if let baseline {
                // 3-way case: only offer when the site never touched this package
                // since it was scaffolded (its range still matches the baseline).
                guard let baselineRange = baseline[name], baselineRange == siteRange else { continue }
            }
            // else: no baseline at all -> legacy direct-diff fallback (spec §3).
            updates.append(DependencyUpdateOffer(name: name, currentRange: siteRange, offeredRange: templateRange))
        }
        return DependencySyncOffers(updates: updates, additions: additions)
    }
}
```

Replace the entire contents of `Sources/AnglesiteCore/DependencySyncChecker.swift`:

```swift
import Foundation

/// Top-level entry point for the dependency-sync feature: the fast-path gate
/// (spec §3.1) plus the full 3-way diff, wired together. Never throws — any
/// unreadable/malformed input degrades to "nothing to offer" (spec §7), since
/// this is a diagnostic convenience feature that must never block a site opening.
public enum DependencySyncChecker {
    public static func check(
        sourceDirectory: URL,
        configDirectory: URL,
        templateDirectory: URL,
        runningAppVersion: String
    ) -> DependencySyncOffers {
        let siteConfigURL = sourceDirectory.appendingPathComponent(".site-config")
        if let siteConfigContents = try? String(contentsOf: siteConfigURL, encoding: .utf8),
           let stampedVersion = SiteConfigFile.value(forKey: "ANGLESITE_VERSION", in: siteConfigContents),
           stampedVersion == runningAppVersion {
            return DependencySyncOffers()
        }

        guard let sitePackageText = try? String(
                contentsOf: sourceDirectory.appendingPathComponent("package.json"), encoding: .utf8),
              let siteDeps = try? PackageJSONDependencies.extract(from: sitePackageText),
              let templatePackageText = try? String(
                contentsOf: templateDirectory.appendingPathComponent("package.json"), encoding: .utf8),
              let templateSections = try? PackageJSONDependencies.extractSections(from: templatePackageText)
        else { return DependencySyncOffers() }

        var templateDeps = templateSections.dependencies
        templateDeps.merge(templateSections.devDependencies) { _, new in new }

        let baseline = DependencyBaseline.load(from: configDirectory)
        return DependencySync.diff(
            site: siteDeps,
            baseline: baseline,
            template: templateDeps,
            templateDevDependencyNames: Set(templateSections.devDependencies.keys)
        )
    }
}
```

Replace the entire contents of `Sources/AnglesiteCore/DependencySyncApplier.swift`:

```swift
import Foundation

/// Applies an accepted dependency-sync decision (spec §6, #1108): rewrites
/// `package.json`'s version ranges and inserts any accepted new-dependency
/// entries, deletes the now-stale `package-lock.json` (so the next preview
/// boot's existing `hydrate.sh` regenerates one via its normal `npm install`
/// path — no new container-exec machinery), refreshes the baseline for both
/// updates and additions, and bumps the `ANGLESITE_VERSION` stamp. The
/// lockfile delete, baseline save, and version bump are best-effort (`try?`)
/// once the package.json rewrite itself has succeeded — none of them are
/// things the user's file-open flow should hard-fail on.
public enum DependencySyncApplier {
    public enum ApplyError: Error, Equatable {
        case readFailed
        case writeFailed
    }

    public static func apply(
        _ offers: DependencySyncOffers,
        sourceDirectory: URL,
        configDirectory: URL,
        runningAppVersion: String
    ) throws {
        let packageJSONURL = sourceDirectory.appendingPathComponent("package.json")
        guard let originalText = try? String(contentsOf: packageJSONURL, encoding: .utf8) else {
            throw ApplyError.readFailed
        }
        var updatedText = PackageJSONDependencies.apply(offers.updates, to: originalText)
        updatedText = PackageJSONDependencies.applyAdditions(offers.additions, to: updatedText)
        do {
            try updatedText.write(to: packageJSONURL, atomically: true, encoding: .utf8)
        } catch {
            throw ApplyError.writeFailed
        }

        try? FileManager.default.removeItem(at: sourceDirectory.appendingPathComponent("package-lock.json"))

        var newBaseline = DependencyBaseline.load(from: configDirectory) ?? [:]
        for offer in offers.updates { newBaseline[offer.name] = offer.offeredRange }
        for offer in offers.additions { newBaseline[offer.name] = offer.offeredRange }
        try? DependencyBaseline.save(newBaseline, to: configDirectory)

        let siteConfigURL = sourceDirectory.appendingPathComponent(".site-config")
        let existingConfig = (try? String(contentsOf: siteConfigURL, encoding: .utf8)) ?? ""
        let updatedConfig = SiteConfigFile.upsert([("ANGLESITE_VERSION", runningAppVersion)], into: existingConfig)
        try? updatedConfig.write(to: siteConfigURL, atomically: true, encoding: .utf8)
    }
}
```

Replace the entire contents of `Sources/AnglesiteApp/DependencyUpdateModel.swift`:

```swift
import Foundation
import AnglesiteCore

/// Thin, `Identifiable` model driving the dependency-update-offer sheet
/// (spec §5, #1108). Holds the already-computed offers (bumps and new-package
/// additions) and forwards the user's decision — no comparison/diff logic
/// lives here, that's all in `AnglesiteCore`
/// (`DependencySyncChecker`/`DependencySyncApplier`).
@MainActor
final class DependencyUpdateModel: Identifiable {
    nonisolated let id = UUID()
    let offers: DependencySyncOffers
    private let onDecision: (_ accepted: Bool) -> Void

    init(offers: DependencySyncOffers, onDecision: @escaping (_ accepted: Bool) -> Void) {
        self.offers = offers
        self.onDecision = onDecision
    }

    func update() { onDecision(true) }
    func skip() { onDecision(false) }
}
```

In `Sources/AnglesiteApp/SiteWindow.swift`, find this block (around line 645):

```swift
        .sheet(item: $bindableModel.dependencyUpdateModel) { updateModel in
            NavigationStack {
                List(updateModel.offers, id: \.name) { offer in
                    LabeledContent(offer.name) {
                        Text("\(offer.currentRange) → \(offer.offeredRange)")
                            .font(.system(.body, design: .monospaced))
                    }
                }
                .navigationTitle("Dependency Updates Available")
```

Replace it with:

```swift
        .sheet(item: $bindableModel.dependencyUpdateModel) { updateModel in
            NavigationStack {
                List {
                    if !updateModel.offers.updates.isEmpty {
                        Section("Dependency Updates") {
                            ForEach(updateModel.offers.updates, id: \.name) { offer in
                                LabeledContent(offer.name) {
                                    Text("\(offer.currentRange) → \(offer.offeredRange)")
                                        .font(.system(.body, design: .monospaced))
                                }
                            }
                        }
                    }
                    if !updateModel.offers.additions.isEmpty {
                        Section("New Dependencies") {
                            ForEach(updateModel.offers.additions, id: \.name) { offer in
                                LabeledContent {
                                    Text(offer.offeredRange)
                                        .font(.system(.body, design: .monospaced))
                                } label: {
                                    Label(offer.name, systemImage: "plus.circle")
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Dependency Updates Available")
```

The rest of the `.sheet` block (the `.toolbar` with Skip/Update, `.frame`, `.interactiveDismissDisabled()`) is unchanged — leave it exactly as-is. Do not touch `Sources/AnglesiteApp/SiteWindowModel.swift` at all in this task.

- [ ] **Step 6: Run the full test suite to verify everything passes**

Run: `swift test --package-path .`
Expected: PASS — every suite green, including `AnglesiteAppTests` (compiling `AnglesiteAppCore`, which now includes the updated `SiteWindow.swift`/`DependencyUpdateModel.swift`).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/DependencySync.swift Sources/AnglesiteCore/DependencySyncChecker.swift Sources/AnglesiteCore/DependencySyncApplier.swift Sources/AnglesiteApp/DependencyUpdateModel.swift Sources/AnglesiteApp/SiteWindow.swift Tests/AnglesiteCoreTests/DependencySyncTests.swift Tests/AnglesiteCoreTests/DependencySyncCheckerTests.swift Tests/AnglesiteCoreTests/DependencySyncApplierTests.swift
git commit -m "feat(#1108): offer and apply new template dependencies"
```

---

### Task 3: Full verification and String Catalog sync

**Files:**
- Modify (conditionally): `Sources/AnglesiteApp/Localizable.xcstrings`

This task adds two new user-visible strings ("Dependency Updates" and "New Dependencies" section headers) via a CLI-only build, which per CONTRIBUTING.md does not auto-merge into the String Catalog. This step performs that merge manually and runs the full verification suite CONTRIBUTING.md requires before a PR.

- [ ] **Step 1: Run the full Swift test suite**

Run: `swift test --package-path .`
Expected: All suites pass.

- [ ] **Step 2: Build the app and sync the String Catalog**

```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

Expected: `** BUILD SUCCEEDED **`, then the sync command completes without error.

- [ ] **Step 3: Review the catalog diff**

Run: `git diff Sources/AnglesiteApp/Localizable.xcstrings`
Expected: Only new entries for "Dependency Updates" and "New Dependencies". If the diff contains keys you didn't add or touch, re-derive `BUILD_DIR` (it must be scoped to this worktree, not a glob across `~/Library/Developer/Xcode/DerivedData/Anglesite-*` — see CONTRIBUTING.md's warning) and re-run Step 2 rather than committing it.

- [ ] **Step 4: Commit the catalog update (only if the diff is clean)**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(#1108): sync string catalog for dependency-sync UI"
```

- [ ] **Step 5: Run the localization CI backstop locally**

Run: `scripts/check-localization-catalog.sh`
Expected: Passes (no unmatched literals reported for the new strings).
