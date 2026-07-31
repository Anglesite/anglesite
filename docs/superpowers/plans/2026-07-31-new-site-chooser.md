# New Site Template Chooser Implementation Plan (#1071)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the six-step New Site wizard to a single Pages-style template chooser: pick a theme card → site scaffolds as "Untitled" into the default location → preview opens. Spec: `docs/superpowers/specs/2026-07-31-new-site-chooser-design.md`.

**Architecture:** `NewSiteWizardModel` (AnglesiteCore) loses its step machine and validation, keeping only `chooser → building`; it derives an Untitled name at init. `SiteScaffolder` learns to skip the homepage write when the draft has no content and to omit `SITE_TYPE` for blank drafts. `NewSiteWizard` (AnglesiteApp) becomes a theme-card grid. `SitesLauncherView` supplies a name-availability closure (registry + disk).

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27+), XCTest (AnglesiteCoreTests is an XCTest holdout — do not convert to Swift Testing), XcodeGen.

## Global Constraints

- Worktree: run `xcodegen generate` before any app build; `Anglesite.xcodeproj` is gitignored (CLAUDE.md ▸ Worktrees).
- Build the app with `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`, never raw `xcodebuild`.
- `swift test` needs `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` (CommandLineTools swift is too old). `--filter` still compiles the whole package.
- Do **not** modify `Resources/Template/` — the template's existing placeholder content ("Welcome" hero, about/blog pages) is the post-chooser starting content. Placeholder copy improvements belong to the ported-themes follow-up epic.
- No new dependencies. Conventional commits, subject ≤72 chars, issue number in subject.
- User-visible strings changed in `Sources/AnglesiteApp` require the String Catalog sync (Task 5) per CONTRIBUTING.md — CLI builds don't merge `.xcstrings`.
- Serialize full `swift test` runs (never two concurrent — FoundationModels suites hang under contention).
- If the app build fails at "Check container resources", rsync `Resources/container-image`, `Resources/container-kernel`, `Resources/container-initfs` from the main checkout into the worktree.

---

### Task 1: Collapse `NewSiteWizardModel` to chooser → building

**Files:**
- Modify: `Sources/AnglesiteCore/NewSiteWizardModel.swift` (full rewrite below)
- Test: `Tests/AnglesiteCoreTests/NewSiteWizardModelTests.swift` (full rewrite below)

**Interfaces:**
- Consumes: `ThemeCatalog`, `NewSiteDraft`, `SiteScaffolder` (all unchanged in this task).
- Produces (Tasks 3–4 rely on these exact members): `init(catalog: ThemeCatalog, isNameTaken: (String) -> Bool)` (closure receives a candidate display name like `"Untitled 2"`, is **non-escaping**, used only during init); `step: Step` with `enum Step { case chooser, building }`; `draft: NewSiteDraft`; `canCreate: Bool`; `build(using:) async -> String?`; unchanged: `progress`, `fatal`, `completedSiteID`, `warnings`, `hasWarnings`, `didCompleteCleanly`, `catalog`.
- **Removed** (Task 3 must not reference them): `defaultSaveDirectory`, `slugTaken` param, `advance()`, `back()`, `canContinue`, `choose(type:)`, `detailsError`, `slugPreview`, `defaultSaveFileName`, `cloudflareDevPreview`, `isValidDomain`, `showingImagePlayground`, `heroImageConcepts`, `hasHeroImage`, `setHeroImage(_:)`.

- [ ] **Step 1: Rewrite the test file with the new expectations**

Replace the entire contents of `Tests/AnglesiteCoreTests/NewSiteWizardModelTests.swift` with:

```swift
import XCTest
@testable import AnglesiteCore

@MainActor
final class NewSiteWizardModelTests: XCTestCase {
    private func catalog() -> ThemeCatalog {
        ThemeCatalog(themes: [
            Theme(id: "classic", name: "Classic", blurb: "", swatch: [], cssVars: [:]),
            Theme(id: "warm", name: "Warm", blurb: "", swatch: [], cssVars: [:]),
        ])
    }

    // MARK: Chooser state (#1071)

    func testStartsOnChooserWithFirstThemeAndUntitledDraft() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        XCTAssertEqual(m.step, .chooser)
        XCTAssertEqual(m.draft.themeID, "classic")     // catalog order, not a per-type default
        XCTAssertEqual(m.draft.name, "Untitled")
        XCTAssertEqual(m.draft.saveFileName, "Untitled.anglesite")
        XCTAssertEqual(m.draft.siteType, .blank)
        XCTAssertEqual(m.draft.domainChoice, .later)   // deferred to publish (#1071)
        XCTAssertEqual(m.draft.headline, "")           // template placeholder stays
        XCTAssertTrue(m.canCreate)
    }

    func testUntitledNameSkipsTakenNames() {
        let m = NewSiteWizardModel(catalog: catalog(),
                                   isNameTaken: { ["Untitled", "Untitled 2"].contains($0) })
        XCTAssertEqual(m.draft.name, "Untitled 3")
        XCTAssertEqual(m.draft.saveFileName, "Untitled 3.anglesite")
    }

    func testCanCreateRequiresACatalogTheme() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        m.draft.themeID = "no-such-theme"
        XCTAssertFalse(m.canCreate)
        m.draft.themeID = "warm"
        XCTAssertTrue(m.canCreate)
    }

    func testEmptyCatalogCannotCreate() {
        let m = NewSiteWizardModel(catalog: ThemeCatalog(themes: []), isNameTaken: { _ in false })
        XCTAssertFalse(m.canCreate)
    }

    // MARK: Build warnings (#229)

    /// A scaffolder whose `scaffold.sh` writes the template files the appliers expect, then emits a
    /// non-fatal `git init` warning.
    private func warningScaffolder(root: URL) -> SiteScaffolder {
        SiteScaffolder(
            sitesRoot: root,
            templateURL: URL(fileURLWithPath: "/template"),
            catalog: catalog(),
            run: { _, args, cwd in
                if args.contains(where: { $0.hasSuffix("scaffold.sh") }), let cwd {
                    let css = cwd.appendingPathComponent("src/styles/global.css")
                    let astro = cwd.appendingPathComponent("src/pages/index.astro")
                    try? FileManager.default.createDirectory(at: css.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? FileManager.default.createDirectory(at: astro.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? ":root { --color-primary: #2563eb; }".write(to: css, atomically: true, encoding: .utf8)
                    try? "<h1>Welcome</h1>".write(to: astro, atomically: true, encoding: .utf8)
                    try? "ANGLESITE_VERSION=1.0.0".write(to: cwd.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
                }
                return ProcessSupervisor.RunResult(stdout: "", stderr: "", exitCode: 0)
            },
            gitInit: { _ in throw CocoaError(.fileWriteUnknown) },
            gitCommit: { _ in },
            register: { pkg in SiteStore.Site(id: pkg.url.path, name: pkg.url.lastPathComponent, packageURL: pkg.url, isValid: true, missingSentinels: []) }
        )
    }

    func testFreshModelHasNoWarningsAndIsNotCompletedCleanly() {
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        XCTAssertFalse(m.hasWarnings)
        XCTAssertTrue(m.warnings.isEmpty)
        XCTAssertFalse(m.didCompleteCleanly)
    }

    func testBuildEntersBuildingStepAndDisablesCreate() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })
        _ = await m.build(using: warningScaffolder(root: root))
        XCTAssertEqual(m.step, .building)
        XCTAssertFalse(m.canCreate)
    }

    func testBuildWithWarningSurfacesWarningAndBlocksCleanCompletion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let m = NewSiteWizardModel(catalog: catalog(), isNameTaken: { _ in false })

        let id = await m.build(using: warningScaffolder(root: root))

        XCTAssertNotNil(id)                       // the site was still registered
        XCTAssertTrue(m.hasWarnings)              // …but with a non-fatal warning
        // Assert on the stable step identifier, not the (rephrasable) message text.
        XCTAssertTrue(m.progress.contains {
            if case .warning(let step, _) = $0 { return step == "copyingTemplate" } else { return false }
        })
        XCTAssertFalse(m.didCompleteCleanly)      // so the wizard must NOT auto-open
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /path/to/worktree
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --package-path . --filter NewSiteWizardModelTests 2>&1 | tail -20
```

Expected: **compile failure** — `NewSiteWizardModel` has no `isNameTaken:` initializer, no `.chooser` case, no `canCreate`.

- [ ] **Step 3: Rewrite the model**

Replace the entire contents of `Sources/AnglesiteCore/NewSiteWizardModel.swift` with:

```swift
import Foundation
import Observation

/// Observable state behind the New Site template chooser (#1071): theme selection, Untitled
/// naming, and scaffold progress. All rules (when Create is enabled, what the site is named,
/// when the finished site may open) live here rather than in the views, so they can be
/// unit-tested without SwiftUI.
///
/// The chooser deliberately asks exactly one question — which template — the iWork model.
/// Name ("Untitled"), save location (the sites root), domain (deferred to publish), and
/// homepage content (the template's placeholder copy) are all defaulted, not asked.
@MainActor
@Observable
public final class NewSiteWizardModel {
    /// The chooser's two states; ``NewSiteWizardModel/build(using:)`` is the only transition.
    public enum Step: Int, CaseIterable {
        /// The template grid — the only step with user input.
        case chooser
        /// Terminal step while ``NewSiteWizardModel/build(using:)`` runs; ``canCreate`` is
        /// always `false` here.
        case building
    }

    /// The step currently shown. Mutated only by ``build(using:)``.
    public private(set) var step: Step = .chooser
    /// The answers handed to the scaffolder at build time. Only ``NewSiteDraft/themeID`` is
    /// user-set (via the grid); everything else keeps the Untitled defaults from init.
    public var draft: NewSiteDraft
    /// Every ``SiteScaffolder/ScaffoldStep`` emitted so far, in order — the Building step's
    /// live checklist. Append-only; never trimmed, so warnings stay visible after completion.
    public private(set) var progress: [SiteScaffolder.ScaffoldStep] = []
    /// The `.failed` step, if any — kept separately from ``progress`` so the UI can branch on
    /// "the build died" without re-scanning the whole stream.
    public private(set) var fatal: SiteScaffolder.ScaffoldStep?
    /// The new site's registered id once scaffolding reaches `.done`; `nil` until then (or on
    /// failure). Gate opening the site on ``didCompleteCleanly``, not just this being non-nil.
    public private(set) var completedSiteID: String?

    /// Themes shown in the grid; the first entry is pre-selected (no site type exists to drive
    /// the per-type default table).
    public let catalog: ThemeCatalog

    /// Creates the model with a fully-defaulted Untitled draft.
    ///
    /// - Parameters:
    ///   - catalog: Themes for the grid; its first entry seeds ``NewSiteDraft/themeID``.
    ///   - isNameTaken: Availability check for a candidate display name (e.g. "Untitled 2").
    ///     The caller decides what "taken" means — the launcher checks both the recents
    ///     registry and the sites root on disk. Non-escaping: consulted only here, at init.
    public init(catalog: ThemeCatalog, isNameTaken: (String) -> Bool) {
        self.catalog = catalog
        let name = Self.untitledName(isTaken: isNameTaken)
        // headline "" on purpose (overriding NewSiteDraft's default of `name`): the scaffolder
        // skips the homepage write for a contentless draft, leaving the template's placeholder
        // copy for the owner to edit in the preview (#1071).
        var draft = NewSiteDraft(siteType: .blank, name: name,
                                 saveFileName: "\(name).anglesite", headline: "")
        draft.themeID = catalog.themes.first?.id ?? ""
        self.draft = draft
    }

    /// First free name in "Untitled", "Untitled 2", "Untitled 3", … — the Mac document
    /// convention. Not localized: AnglesiteCore has no string catalog (app-target only).
    static func untitledName(isTaken: (String) -> Bool) -> String {
        for n in 1...9999 {
            let candidate = n == 1 ? "Untitled" : "Untitled \(n)"
            if !isTaken(candidate) { return candidate }
        }
        // 9999 collisions means something is systematically wrong; fall back to a unique name
        // rather than looping forever.
        return "Untitled \(UUID().uuidString.prefix(8))"
    }

    /// Gate for the chooser's Create button (and double-click): a real catalog theme is
    /// selected and no build is running.
    public var canCreate: Bool {
        step == .chooser && catalog.theme(id: draft.themeID) != nil
    }

    /// Non-fatal build warnings (e.g. a failed install), surfaced so a failure isn't hidden behind a dead-end preview (#229).
    public var warnings: [String] {
        progress.compactMap { if case .warning(_, let message) = $0 { return message } else { return nil } }
    }

    /// Convenience over ``warnings`` for the chooser's "finished with warnings" branch.
    public var hasWarnings: Bool { !warnings.isEmpty }

    /// Site registered with no warnings — only then may the chooser open it immediately (else it stays put so warnings are read) (#229).
    public var didCompleteCleanly: Bool { completedSiteID != nil && !hasWarnings }

    /// Runs the scaffolder, accumulating progress. Returns the new site id on success.
    public func build(using scaffolder: SiteScaffolder) async -> String? {
        step = .building
        for await s in scaffolder.scaffold(draft) {
            progress.append(s)
            if case .failed = s { fatal = s }
            if case .done(let id) = s { completedSiteID = id }
        }
        return completedSiteID
    }
}
```

Note `step` became `private(set)` — nothing outside the model sets it anymore. If the old tests' `m.step = .details` pattern sneaks back, that's a compile error, which is correct.

- [ ] **Step 4: Run the model tests — expect the package build to fail in dependents, not the model**

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --package-path . --filter NewSiteWizardModelTests 2>&1 | tail -20
```

`Sources/AnglesiteApp` is **not** a SwiftPM target, so the package still compiles; only the app target (Tasks 3–4) references the removed members. Expected: PASS (all tests in `NewSiteWizardModelTests`).

If other package targets fail to compile (e.g. an intents file referencing a removed member), fix the call site in this task — grep first:

```bash
grep -rn "slugTaken\|canContinue\|choose(type:\|detailsError\|cloudflareDevPreview\|defaultSaveDirectory" Sources/AnglesiteCore Sources/AnglesiteIntents Sources/AnglesiteSiteModel Sources/AnglesiteBridge
```

Expected: no hits outside `NewSiteWizardModel.swift` (verified at planning time — the only consumers are `Sources/AnglesiteApp/NewSiteWizard.swift` and `SitesLauncherView.swift`, handled in Tasks 3–4).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/NewSiteWizardModel.swift Tests/AnglesiteCoreTests/NewSiteWizardModelTests.swift
git commit -m "feat(#1071): collapse NewSiteWizardModel to chooser step machine"
```

---

### Task 2: Scaffolder skips homepage write and SITE_TYPE for chooser drafts

**Files:**
- Modify: `Sources/AnglesiteCore/SiteScaffolder.swift:144-151` (homepage write) and `:211-235` (`appendSiteConfig`)
- Test: `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift` (add one test)

**Interfaces:**
- Consumes: `NewSiteDraft` with `siteType == .blank`, empty `headline`/`blurb` (produced by Task 1's init).
- Produces: on-disk behavior only — `Source/src/pages/index.astro` untouched and no `SITE_TYPE=` line in `.site-config` for such drafts. No API changes.

- [ ] **Step 1: Add the failing test**

Append to `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift` (inside the class, after `testSiteConfigValuesAreSanitizedAndBlurbBackfillsTagline`):

```swift
    /// The chooser flow (#1071) hands over a fully-defaulted Untitled draft: blank type, no
    /// headline/blurb. The template's placeholder homepage must survive untouched, and
    /// `.site-config` must defer the domain (`later`) and omit `SITE_TYPE` entirely.
    func testChooserDraftKeepsTemplatePlaceholderAndOmitsSiteType() async throws {
        let root = tmpDir()
        let scaffolder = makeScaffolder(root: root)
        let draft = NewSiteDraft(siteType: .blank, name: "Untitled",
                                 saveFileName: "Untitled.anglesite",
                                 themeID: "classic", headline: "")
        for await _ in scaffolder.scaffold(draft) {}

        let pkgURL = root.appendingPathComponent("Untitled.anglesite")
        // Homepage untouched: exactly the placeholder the fake scaffold.sh wrote.
        let home = try String(contentsOf: pkgURL.appendingPathComponent("Source/src/pages/index.astro"), encoding: .utf8)
        XCTAssertEqual(home, "<section class=\"hero\">\n  <h1>Welcome</h1>\n</section>")

        let cfg = try String(contentsOf: pkgURL.appendingPathComponent("Source/.site-config"), encoding: .utf8)
        XCTAssertTrue(cfg.contains("SITE_NAME=Untitled"))
        XCTAssertTrue(cfg.contains("CF_PROJECT_NAME=untitled"))
        XCTAssertTrue(cfg.contains("DOMAIN_CHOICE=later"))
        XCTAssertFalse(cfg.contains("SITE_TYPE="))
        XCTAssertFalse(cfg.contains("TAGLINE="))
    }
```

- [ ] **Step 2: Run it to verify it fails**

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --package-path . --filter SiteScaffolderTests.testChooserDraftKeepsTemplatePlaceholderAndOmitsSiteType 2>&1 | tail -10
```

Expected: FAIL — `index.astro` was rewritten by `HomepageWriter` (empty `<h1></h1>`), and `cfg` contains `SITE_TYPE=blank`.

- [ ] **Step 3: Implement the two skips**

In `Sources/AnglesiteCore/SiteScaffolder.swift`, replace the homepage block (currently lines 144–151):

```swift
        // 4. Homepage (non-fatal). Skipped when the draft has no content at all — the chooser
        // flow (#1071) ships the template's placeholder copy for the owner to edit in the
        // preview; intents/AI paths that supply real words still get them written.
        emit(.writingContent)
        let metadataDescription = draft.tagline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? draft.blurb
            : draft.tagline
        let hasHomepageContent = !draft.headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !draft.blurb.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasHomepageContent {
            do { try HomepageWriter.write(headline: draft.headline, blurb: draft.blurb,
                                          tagline: metadataDescription, siteDirectory: siteDir, fileManager: fileManager) }
            catch { emit(.warning(step: "writingContent", message: humanize(error))) }
        }
```

And in `appendSiteConfig` (currently lines 211–235), replace the fixed `values` array head:

```swift
        var values: [(String, String)] = [("SITE_NAME", draft.name)]
        // `.blank` is the chooser flow's "no answer" (#1071) — nothing reads SITE_TYPE back,
        // so an unasked question writes no key rather than a fake answer.
        if draft.siteType != .blank { values.append(("SITE_TYPE", draft.siteType.rawValue)) }
        values.append(contentsOf: [
            ("DOMAIN_CHOICE", draft.domainChoice.rawValue),
            ("CF_PROJECT_NAME", cfProjectName),
            ("LANG", hostLanguage()),
        ])
```

(The rest of `appendSiteConfig` — DOMAIN, THEME/COLOR_*, TAGLINE, LOGO — is unchanged.)

- [ ] **Step 4: Run the scaffolder + wizard-model suites**

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --package-path . --filter "SiteScaffolderTests|SiteScaffolderPackageTests|NewSiteWizardModelTests|HomepageWriterTests" 2>&1 | tail -10
```

Expected: PASS. `testHappyPathEmitsStepsInOrderAndRegisters` still passes because `makeDraft()` uses `.business` with a headline — both skips are inert for it. A pre-existing site type `.blank` draft was never constructed by production code before, so no behavior regresses.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteScaffolder.swift Tests/AnglesiteCoreTests/SiteScaffolderTests.swift
git commit -m "feat(#1071): skip homepage write and SITE_TYPE for chooser drafts"
```

---

### Task 3: Rebuild the wizard UI as the template chooser

**Files:**
- Modify: `Sources/AnglesiteApp/NewSiteWizard.swift` (full rewrite below)
- Modify: `Sources/AnglesiteApp/SitesLauncherView.swift:441-446` (model construction)

There are no unit tests for the app target (it isn't hosted on CI — CLAUDE.md ▸ Build); verification is the Debug build compiling plus Task 6's manual smoke. Model logic was tested in Task 1.

**Interfaces:**
- Consumes: Task 1's `NewSiteWizardModel` surface (`init(catalog:isNameTaken:)`, `.chooser`/`.building`, `canCreate`, `build(using:)`, `progress`, `fatal`, `completedSiteID`, `hasWarnings`), `Theme` (`name`, `blurb`, `cssVars`), `SiteSlug.derive(from:)`.
- Produces: `NewSiteWizard(model:scaffolder:onComplete:onCancel:)` — the same view signature `SitesLauncherView`'s sheet already uses, so the sheet call site (lines 83–106) is untouched.

- [ ] **Step 1: Rewrite `NewSiteWizard.swift`**

Replace the entire contents of `Sources/AnglesiteApp/NewSiteWizard.swift` with:

```swift
import SwiftUI
import AppKit
import AnglesiteCore

/// The New Site template chooser (#1071) — the iWork model: one question (which template),
/// then the site scaffolds as "Untitled" into the default location and opens in the preview.
/// Presented from SitesLauncherView; calls `onComplete(siteID)` when the site is scaffolded
/// and registered.
struct NewSiteWizard: View {
    @Bindable var model: NewSiteWizardModel
    let scaffolder: SiteScaffolder
    let onComplete: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            content
            Divider()
            footer
        }
        .frame(width: 560, height: 460)
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .chooser:  chooserStep
        case .building: buildingStep
        }
    }

    private var chooserStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose a Template").font(.title2.bold())
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))], spacing: 12) {
                    ForEach(model.catalog.themes) { theme in
                        Button { model.draft.themeID = theme.id } label: {
                            ThemePreviewCard(theme: theme, isSelected: model.draft.themeID == theme.id)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        // Double-click = choose and create, the document-chooser convention.
                        .simultaneousGesture(TapGesture(count: 2).onEnded {
                            model.draft.themeID = theme.id
                            create()
                        })
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(theme.name). \(theme.blurb)")
                        .accessibilityValue(model.draft.themeID == theme.id ? "Selected" : "")
                    }
                }
            }
        }.padding(24)
    }

    private var buildingStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Building your website\u{2026}").font(.title2.bold())
            ForEach(Array(model.progress.enumerated()), id: \.offset) { _, s in
                Text(label(for: s)).font(.callout)
                    // The visible label leads with an emoji status glyph; give VoiceOver clean text.
                    .accessibilityLabel(accessibilityLabel(for: s))
            }
            if case .failed(_, let msg) = model.fatal {
                Text(msg).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                    .accessibilityLabel("Build failed")
                    .accessibilityValue(msg)
            }
            if model.completedSiteID != nil && model.hasWarnings {
                Text("Your website was created, but something above needs attention before it can preview. You can open it anyway and fix it from the website window.")
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    .accessibilityLabel("Your website was created with warnings. You can open it anyway and fix it from the website window.")
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func label(for step: SiteScaffolder.ScaffoldStep) -> String {
        switch step {
        case .creatingFolder: return "\u{2705} Created the website file"
        case .copyingTemplate: return "\u{2705} Copied the template"
        case .applyingTheme: return "\u{2705} Applied your theme"
        case .writingContent: return "\u{2705} Prepared the starter content"
        case .installing: return "\u{23F3} Installing\u{2026}"
        case .registering: return "\u{2705} Registering"
        case .warning(_, let m): return "\u{26A0}\u{FE0F} \(m)"
        case .failed(_, let m): return "\u{274C} \(m)"
        case .done: return "\u{2705} Done"
        }
    }

    /// Emoji-free version of `label(for:)` for VoiceOver, which would otherwise read the status
    /// glyph as "check mark", "hourglass", etc. before the actual message.
    private func accessibilityLabel(for step: SiteScaffolder.ScaffoldStep) -> String {
        switch step {
        case .creatingFolder:    return "Created the website file"
        case .copyingTemplate:   return "Copied the template"
        case .applyingTheme:     return "Applied your theme"
        case .writingContent:    return "Prepared the starter content"
        case .installing:        return "Installing…"
        case .registering:       return "Registering"
        case .warning(_, let m): return "Warning: \(m)"
        case .failed(_, let m):  return "Failed: \(m)"
        case .done:              return "Done"
        }
    }

    @ViewBuilder private var footer: some View {
        HStack {
            Spacer()
            // No Cancel once building starts: the scaffold pipeline isn't cancellable and
            // always reaches .done or .failed (failure shows Close below), so cancelling
            // mid-build would leak the in-flight work and the MAS security scope.
            if model.step == .chooser {
                Button("Cancel") { onCancel() }
                Button("Create") { create() }
                    .keyboardShortcut(.defaultAction).disabled(!model.canCreate)
            } else if let id = model.completedSiteID, model.hasWarnings {
                Button("Open Website Anyway") { onComplete(id) }.keyboardShortcut(.defaultAction)
            } else if model.completedSiteID == nil && model.fatal != nil {
                Button("Close") { onCancel() }
            }
        }.padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func create() {
        guard model.canCreate else { return }
        // Auto-open only on a clean build; with warnings, stay put so the owner sees them (#229).
        Task {
            _ = await model.build(using: scaffolder)
            if model.didCompleteCleanly, let id = model.completedSiteID { onComplete(id) }
        }
    }
}

/// One template card: a miniature page mock (nav bar, hero block, text lines) drawn from the
/// theme's own palette, so each card previews a page rather than a bare swatch strip (#1071).
private struct ThemePreviewCard: View {
    let theme: Theme
    let isSelected: Bool

    private var primary: Color { Color(hex: theme.cssVars["color-primary"] ?? "#333333") }
    private var accent: Color { Color(hex: theme.cssVars["color-accent"] ?? "#888888") }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Circle().fill(accent).frame(width: 6, height: 6)
                    Capsule().fill(Color.white.opacity(0.9)).frame(width: 34, height: 4)
                    Spacer()
                }
                .padding(6)
                .background(primary)
                RoundedRectangle(cornerRadius: 2).fill(accent.opacity(0.85)).frame(height: 22)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.5)).frame(width: 70, height: 4)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.25)).frame(height: 3)
                    .padding(.horizontal, 6)
                Capsule().fill(Color.primary.opacity(0.25)).frame(width: 90, height: 3)
                    .padding(.horizontal, 6).padding(.bottom, 8)
            }
            .background(Color(NSColor.textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.1)))
            .accessibilityHidden(true)
            Text(theme.name).font(.subheadline.bold())
            Text(theme.blurb).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
        .padding(8)
        .overlay(RoundedRectangle(cornerRadius: 8)
            .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2))
    }
}

/// Minimal hex -> Color for theme cards (#rrggbb). Also used by ThemeApplyWizard — keep it
/// here (module-internal) when refactoring this file.
extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self = Color(.sRGB,
                     red: Double((rgb >> 16) & 0xFF) / 255,
                     green: Double((rgb >> 8) & 0xFF) / 255,
                     blue: Double(rgb & 0xFF) / 255)
    }
}
```

Deliberately gone (removed, not moved): `ImagePlaygroundPresenter` and the `ImagePlayground` import, `detailsStep`, `typeStep`, `lookStep`, `contentStep`, `saveStep`, `customColorScheme`, `heroImageSection`, `isImagePlaygroundAvailable`, `saveWebsite()`, `chooseLogo()`, `colorBinding(_:)`, `cloudflareDomainsURL`, and the `Color.hexString` accessor (its only consumer was `colorBinding`; verified at planning time — `ThemeApplyWizard.swift` uses only `Color(hex:)`).

- [ ] **Step 2: Update the launcher's model construction**

In `Sources/AnglesiteApp/SitesLauncherView.swift`, replace (currently lines 441–446):

```swift
        // Load persisted registry to derive taken slugs; no scan needed (registry = source of truth).
        try? await SiteStore.shared.load()
        let knownSites = await SiteStore.shared.sites
        let takenSlugs = Set(knownSites.map { SiteSlug.derive(from: $0.name) })

        let model = NewSiteWizardModel(catalog: catalog, defaultSaveDirectory: sitesRoot, slugTaken: { takenSlugs.contains($0) })
```

with:

```swift
        // Load persisted registry to derive taken slugs; no scan needed (registry = source of truth).
        try? await SiteStore.shared.load()
        let knownSites = await SiteStore.shared.sites
        let takenSlugs = Set(knownSites.map { SiteSlug.derive(from: $0.name) })

        // "Untitled N" availability (#1071): taken if it collides with a registered site's slug
        // OR a package already on disk in the sites root (registered or not) — silent save must
        // never clobber an existing folder.
        let model = NewSiteWizardModel(catalog: catalog, isNameTaken: { name in
            takenSlugs.contains(SiteSlug.derive(from: name))
                || FileManager.default.fileExists(atPath: sitesRoot.appendingPathComponent("\(name).anglesite").path)
        })
```

- [ ] **Step 3: Build the app**

```bash
cd /path/to/worktree
xcodegen generate
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build 2>&1 | tail -5
```

Expected: `BUILD SUCCEEDED`. Any "cannot find … in scope" error here means a leftover reference to a removed model member — fix the reference, don't re-add the member.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/NewSiteWizard.swift Sources/AnglesiteApp/SitesLauncherView.swift
git commit -m "feat(#1071): replace new-site wizard with template chooser"
```

---

### Task 4: Full package test run

**Files:** none (verification gate).

- [ ] **Step 1: Run the whole SwiftPM suite** (serialize — no concurrent `swift test` on this machine)

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --package-path . 2>&1 | tail -15
```

Expected: all suites pass. Known trap: if it hangs with no output, check `pgrep -fl swift-test` for an orphan holding the `.build` lock. If `AnglesiteIntentsTests` or FoundationModels suites fail flakily, re-run once alone before investigating (see memory: FM contention).

- [ ] **Step 2: No commit** — this task produces no changes; failures route back to the task that broke them.

---

### Task 5: String Catalog sync

**Files:**
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (generated sync — review, don't hand-edit)

New user-visible strings ("Choose a Template", "Create", "Prepared the starter content") were added and many removed; CLI builds don't merge the catalog (CONTRIBUTING.md ▸ "Commit String Catalog updates").

- [ ] **Step 1: Build, then sync scoped to THIS worktree's BUILD_DIR**

```bash
cd /path/to/worktree
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
  --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
  --skip-marking-strings-stale
```

Never glob `~/Library/Developer/Xcode/DerivedData/Anglesite-*` — sibling worktrees pollute it. Always `--skip-marking-strings-stale`.

- [ ] **Step 2: Review the diff**

```bash
git diff --stat Sources/AnglesiteApp/Localizable.xcstrings
git diff Sources/AnglesiteApp/Localizable.xcstrings | head -80
```

Expected: **added** keys only from this change ("Choose a Template", "Create", "Prepared the starter content", the combined accessibility strings). Removed wizard strings ("Website name", "Pick a color scheme", …) will *remain* in the catalog (the `--skip-marking-strings-stale` trade-off) — that's expected; do not hand-delete them. If the diff contains keys from unrelated in-flight branches, discard and re-run scoped to this worktree's `BUILD_DIR`.

- [ ] **Step 3: Commit**

```bash
git add Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "chore(#1071): sync string catalog for template chooser"
```

---

### Task 6: Update the QA acceptance doc + manual smoke

**Files:**
- Modify: `docs/qa/e2e-acceptance-2-new-website.md`

- [ ] **Step 1: Rewrite the wizard-specific sections**

Apply these edits (leave cases 5–12's container/git/runtime content intact except where noted):

1. **Scope line (line 4):** replace with
   `**Scope:** File ▸ New ▸ Site through a live previewing site window: template chooser, scaffold on disk, container boot, first render.`
2. **Purpose (line 8):** replace the first clause with
   `Verify a user can create a \`.anglesite\` package end-to-end: the chooser asks exactly one question (which template), the scaffold lands a complete git-initialized \`Source/\` **with a real initial commit** (#697) named "Untitled" in the sites root, …` (keep the rest).
3. **Preconditions test inputs (line 13):** replace with
   `- Test inputs used throughout: a non-default built-in theme picked in the chooser. There is no name/type/content/domain input — the site is created as **"Untitled"** (#1071).`
4. **Case 2** (retitle "Chooser, labels, selection"): replace the six-step walk with:

   ```markdown
   ### 2. Chooser, labels, selection

   One screen (fixed ~560×460 sheet; footer **Cancel / Create**):

   - Title **"Choose a Template"**; a grid of theme cards, each a miniature page mock in the
     theme's colors with name + description. The first catalog theme is pre-selected.
   - Single click selects (accent ring); **double-click creates immediately**.
   - **Create** is the default button (Return). No name field, no domain question, no site-type
     step, no content step, no save panel (#1071).
   - Cancel must dismiss with nothing on disk.
   ```
5. **Case 3** (retitle "Sandbox grant + silent save location"): drop the save-panel paragraph; keep the grant expectations and state the package lands at `Untitled.anglesite` in the sites root with no panel shown; a second run in the same session lands `Untitled 2.anglesite`.
6. **Case 4:** update the checklist copy: `created the website file → copied the template → applied your theme → prepared the starter content → installing → registering → done`.
7. **Case 5:** substitute `Untitled.anglesite` for `qa-bakery.anglesite`; display name "Untitled"; `.site-config` line becomes: contains `SITE_NAME=Untitled`, `DOMAIN_CHOICE=later`, `THEME`, `CF_PROJECT_NAME=untitled`, and the real `ANGLESITE_VERSION`; **must not contain** `SITE_TYPE` or `TAGLINE`.
8. **Case 6/7/8/9/10/12:** substitute "Untitled" / `Untitled.anglesite` for "QA Bakery" / `qa-bakery.anglesite` throughout. Case 8's homepage expectation becomes: homepage shows the **template placeholder** ("Welcome" hero — the owner edits it in the preview); the chosen theme's colors are visibly applied; `/about`, `/blog/`, `/rss.xml` expectations unchanged.
9. **Case 11:** replace the duplicate-name bullet with:
   `- Create two sites in a row without renaming → the second lands as **Untitled 2** (\`Untitled 2.anglesite\`), no clobber, no error. Also verify an *unregistered* \`Untitled.anglesite\` folder already sitting in the sites root is skipped the same way.`
   (keep the cancelled-grant bullet).
10. **Exit state:** `"Untitled" open with a ready preview; git log shows the single initial commit.`

- [ ] **Step 2: Manual smoke (app already built in Task 5)**

Launch the built app, then: Add Site → Create new site… → chooser appears → double-click a non-first theme → Building checklist runs → site window opens with the template placeholder homepage in the chosen theme's colors. Then create a second site → it lands as "Untitled 2". Record both results in the PR body's test plan. If a live run isn't possible in the execution environment, state that explicitly in the PR body instead of claiming it.

- [ ] **Step 3: Commit**

```bash
git add docs/qa/e2e-acceptance-2-new-website.md
git commit -m "docs(#1071): update new-website QA doc for template chooser"
```

---

### Task 7: File the three follow-up issues

**Files:** none (gh only). The spec's Follow-ups section promises these; file them so the PR body can reference real numbers.

- [ ] **Step 1: Create the issues**

```bash
gh issue create --title "Epic: curated Astro theme ports for the template chooser" --body "Follow-up to #1071 (see docs/superpowers/specs/2026-07-31-new-site-chooser-design.md ▸ Follow-ups). Curate MIT-licensed Astro themes and port each into the existing template chassis (Resources/Template) as layout/component/style packs — one dependency tree, same scripts/.site-config/writer structure. Adds the chooser's category sidebar (Business, Personal, Blog, Portfolio, Organization, Blank) and records site type from category choice. Rejected alternatives (decision log): live astro.build catalog scaffolding and sibling-template vendoring — unreviewed dependency trees and broken structural assumptions (HomepageWriter, ThemeApplier, edit overlay, template-coupled tests)."

gh issue create --title "Publish-time domain setup step (buy/transfer/later)" --body "Follow-up to #1071: onboarding no longer asks the domain question (DOMAIN_CHOICE=later is always written). Add a first-publish affordance to buy/transfer/defer a domain, feeding the existing CustomDomainAttachCommand path. See docs/superpowers/specs/2026-07-31-new-site-chooser-design.md ▸ Follow-ups."

gh issue create --title "Give ThemeApplyWizard a UI entry point (Website menu)" --body "Follow-up to #1071: ThemeApplyWizard (built-in + freedesignmd theme apply, Sources/AnglesiteApp/ThemeApplyWizard.swift) shipped with no UI entry point — reachable only via App Intent and the FM chat tool. Wire it into the Website menu so post-create restyling is discoverable; with the chooser now the only onboarding question, this is the owner's path to richer restyling. See docs/superpowers/specs/2026-07-31-new-site-chooser-design.md ▸ Follow-ups."
```

- [ ] **Step 2: Record the created issue numbers** for the PR body (the PR should mention them under Design notes).

---

## Completion

After all tasks: re-check changed files against `CONTRIBUTING.md` (subject lengths, PR template with **Summary / Paired PR check / Test plan** — this change is app-only, no paired sidecar PR), then use superpowers:finishing-a-development-branch. The PR body must include `Closes #1071`.
