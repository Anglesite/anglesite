# Theme Pack Mechanism (#1179 slices 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the curation shortlist doc (slice 1) and the pack mechanism (slice 2) from `docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md` — catalog schema fields, scaffold overlay, port-contract lint, and CI wiring. No real theme ports and no chooser UI changes (slice 3).

**Architecture:** A pack is a directory under `Resources/Template/packs/<id>/` whose `src/` tree overlays a freshly scaffolded site (file-replace copy, scaffold-time only). `scripts/themes.json` stays the single catalog; entries gain optional `category`/`pack`/`thumbnail`/`credit`. A new `PackApplier` in AnglesiteCore does the overlay inside `SiteScaffolder`'s `.applyingTheme` milestone; a template-side `check-pack.ts` lints every pack against the port contract; `build-packs.sh` astro-builds the chassis with each pack overlaid in CI.

**Tech Stack:** Swift 6.4 (XCTest, AnglesiteCore), TypeScript via `tsx --test` (node:test, Node 22+), zsh, rsync.

## Global Constraints

- Worktree: run everything from the repo root of the current worktree; **never** touch the main checkout.
- `swift test --package-path .` may need `DEVELOPER_DIR` pointing at Xcode 27 (`export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer` if the default toolchain fails). `--filter` still compiles the whole package. Don't run the full suite concurrently with other agents (FoundationModels contention).
- Template tests: `cd Resources/Template && npx tsx --test scripts/<file>.test.ts` (Node 22+). New `scripts/*.test.ts` files auto-enroll in `npm test` and CI's template lane.
- Conventional commits, subject ≤ 72 chars, referencing `#1179`.
- No new dependencies of any kind (Swift or npm).
- Existing behavior invariants: the 8 built-in themes stay category-less (they appear under Blank); `SITE_TYPE` behavior is untouched in this plan (chooser wires it in slice 3); `THEME` stays write-only.
- Allowed category values (everywhere): `business`, `personal`, `blog`, `portfolio`, `organization` — the `SiteType` raw values minus `blank`.
- The 12 base CSS custom properties a pack's `global.css` must declare in `:root`: `--color-primary`, `--color-accent`, `--color-background`, `--color-surface`, `--color-text`, `--color-text-muted`, `--font-heading`, `--font-body`, `--spacing-unit`, `--radius-sm`, `--radius-md`, `--radius-lg`.
- Marker anchors (from `IntegrationCatalog`/`MarkerInjector`): `// anglesite:imports`, `<!-- anglesite:head-end -->`, `<!-- anglesite:nav -->`, `<!-- anglesite:body-end -->` in `src/layouts/BaseLayout.astro`; `// anglesite:imports` + `<!-- anglesite:hero-cta -->` in `src/pages/index.astro`; `// anglesite:imports` in `src/layouts/BlogPost.astro`.
- HomepageWriter sentinels (byte-for-byte, from `Sources/AnglesiteCore/HomepageWriter.swift:16-22`):
  - `title="Welcome — Your New Anglesite Business Website"`
  - `description="Your business website is ready to set up in Anglesite."`
  - `<h1>Welcome</h1>`
  - `<p>This site is ready to customize in Anglesite. Open the app to edit your pages, add content, and publish when you're ready.</p>`

---

### Task 1: Curation criteria + shortlist doc (slice 1, docs-only)

**Files:**
- Create: `docs/theme-curation.md`

**Interfaces:**
- Consumes: nothing (research task).
- Produces: the approved shortlist later port issues cite. No code depends on it.

This is research + writing, not TDD. The deliverable is a doc the owner signs off on before any port starts.

- [ ] **Step 1: Survey candidates**

Use web search against the astro.build themes catalog (https://astro.build/themes/ — filter Free) and the linked GitHub repos. For each candidate verify **in the repo itself**: LICENSE file says MIT; the homepage/layout structure uses semantic HTML (real `<nav>`, `<h1>`–`<h6>`, `<main>`); the design is expressible in vanilla CSS (Tailwind/React originals qualify — the *design* ports, the code doesn't); no content-model conflict with the chassis collections (blog/articles/notes/etc.). Seed candidates to evaluate (verify licenses at execution time, do not trust this list): AstroPaper (blog), Astro Cactus (personal/blog), AstroWind (business), Astroship (business/startup), Astrofy (portfolio), Dante (blog/personal), Odyssey (business). Target: one per category — business, personal, blog, portfolio, organization. Organization is the thin category; a business theme with strong adaptation notes may be proposed for it.

- [ ] **Step 2: Write `docs/theme-curation.md`**

Structure (fill the table from Step 1's verified findings; every row needs a working repo URL and the license verification commit/URL):

```markdown
# Theme curation for the template chooser (#1179)

Criteria and approved shortlist for porting third-party Astro themes into the
template chassis as packs. Spec:
`docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md`.

## Criteria

1. **MIT license**, verifiable in the source repository.
2. **Adaptation feasibility** — semantic HTML skeleton; layout expressible in
   vanilla CSS on the chassis's 12-token system. The original's dependencies
   (Tailwind, React, …) do not come along; the design does.
3. **Category fit** — clearly Business, Personal, Blog, Portfolio, or
   Organization, and visually distinct from the 8 built-in palettes.
4. **No content-model conflict** with the chassis collections.

## Shortlist (pending owner sign-off)

| Category | Theme | Repo | License verified | Adaptation notes |
|---|---|---|---|---|
| Business | … | … | MIT (link) | … |
| Personal | … | … | MIT (link) | … |
| Blog | … | … | MIT (link) | … |
| Portfolio | … | … | MIT (link) | … |
| Organization | … | … | MIT (link) | … |

## Rejected candidates

| Theme | Reason |
|---|---|
| … | … |
```

- [ ] **Step 3: Commit**

```bash
git add docs/theme-curation.md
git commit -m "docs(#1179): theme curation criteria and shortlist"
```

---

### Task 2: `Theme` schema fields (Swift)

**Files:**
- Modify: `Sources/AnglesiteCore/ThemeCatalog.swift`
- Test: `Tests/AnglesiteCoreTests/ThemeCatalogTests.swift`

**Interfaces:**
- Produces (used by Tasks 4–5 and slice 3):
  - `Theme.category: String?`, `Theme.pack: String?`, `Theme.thumbnail: String?`, `Theme.credit: Theme.Credit?`
  - `Theme.Credit: Sendable, Equatable, Decodable` with `name: String`, `url: String`, `license: String`
  - `Theme.init(id:name:blurb:swatch:cssVars:category:pack:thumbnail:credit:)` — the four new parameters default to `nil`, so every existing call site compiles unchanged.

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/ThemeCatalogTests.swift`:

```swift
func testParseDecodesPackFields() throws {
    let json = """
    [{"id": "paper", "displayName": "Paper", "description": "A ported blog theme",
      "bestFor": ["blog"], "category": "blog", "pack": "paper",
      "thumbnail": "packs/paper/thumbnail.png",
      "credit": {"name": "AstroPaper", "url": "https://example.com/astropaper", "license": "MIT"},
      "vars": {"color-primary": "#111111", "color-accent": "#ff5500"}},
     {"id": "classic", "displayName": "Classic", "description": "Built-in",
      "bestFor": ["legal"], "vars": {"color-primary": "#1e3a5f"}}]
    """
    let themes = try ThemeCatalog.parse(themesJSON: Data(json.utf8))
    XCTAssertEqual(themes[0].category, "blog")
    XCTAssertEqual(themes[0].pack, "paper")
    XCTAssertEqual(themes[0].thumbnail, "packs/paper/thumbnail.png")
    XCTAssertEqual(themes[0].credit, Theme.Credit(name: "AstroPaper", url: "https://example.com/astropaper", license: "MIT"))
    // Entries without the new fields (all 8 built-ins) decode with nils.
    XCTAssertNil(themes[1].category)
    XCTAssertNil(themes[1].pack)
    XCTAssertNil(themes[1].thumbnail)
    XCTAssertNil(themes[1].credit)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter ThemeCatalogTests`
Expected: compile FAILURE — `Theme` has no member `category` / no type `Theme.Credit`.

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/ThemeCatalog.swift`, extend `Theme` (keep existing properties/doc comments; new lines shown):

```swift
public struct Theme: Sendable, Identifiable, Equatable {
    // …existing id/name/blurb/swatch/cssVars…

    /// Attribution for a ported pack's original theme (spec §1); `nil` for built-ins.
    public struct Credit: Sendable, Equatable, Decodable {
        public let name: String
        public let url: String
        public let license: String
        public init(name: String, url: String, license: String) {
            self.name = name; self.url = url; self.license = license
        }
    }

    /// Chooser category (`business|personal|blog|portfolio|organization`); `nil` = Blank
    /// (the base chassis in different palettes — all 8 built-ins).
    public let category: String?
    /// Pack directory name under the template's `packs/`; `nil` = plain CSS-var theme.
    public let pack: String?
    /// Path (relative to the template root) of the committed thumbnail; pack entries only.
    public let thumbnail: String?
    /// Original-theme attribution; pack entries only.
    public let credit: Credit?

    public init(id: String, name: String, blurb: String, swatch: [String], cssVars: [String: String],
                category: String? = nil, pack: String? = nil, thumbnail: String? = nil, credit: Credit? = nil) {
        self.id = id; self.name = name; self.blurb = blurb; self.swatch = swatch; self.cssVars = cssVars
        self.category = category; self.pack = pack; self.thumbnail = thumbnail; self.credit = credit
    }
}
```

And in `parse(themesJSON:)`, extend `Record` and the mapping:

```swift
struct Record: Decodable {
    let id: String
    let displayName: String
    let description: String
    let bestFor: [String]
    let vars: [String: String]
    let category: String?
    let pack: String?
    let thumbnail: String?
    let credit: Theme.Credit?
}
return try JSONDecoder().decode([Record].self, from: data).map { record in
    Theme(
        id: record.id,
        name: record.displayName,
        blurb: record.description,
        swatch: ["color-primary", "color-accent"].compactMap { record.vars[$0] },
        cssVars: record.vars,
        category: record.category,
        pack: record.pack,
        thumbnail: record.thumbnail,
        credit: record.credit
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter ThemeCatalogTests`
Expected: PASS (all ThemeCatalogTests, including the real-JSON drift guard — the 8 built-ins have no new fields, so nils flow through).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ThemeCatalog.swift Tests/AnglesiteCoreTests/ThemeCatalogTests.swift
git commit -m "feat(#1179): decode pack fields in ThemeCatalog"
```

---

### Task 3: `Theme` schema fields (TypeScript) + catalog validation

**Files:**
- Modify: `Resources/Template/scripts/themes.ts`
- Test: `Resources/Template/scripts/themes.test.ts`

**Interfaces:**
- Produces (used by Task 6's `check-pack.ts`):
  - `export interface ThemeCredit { name: string; url: string; license: string }`
  - `export type ThemeCategory = "business" | "personal" | "blog" | "portfolio" | "organization"`
  - `Theme` gains `category?: ThemeCategory; pack?: string; thumbnail?: string; credit?: ThemeCredit`
  - `export type ThemeRecord = Theme & { id: string }`
  - `export const THEME_RECORDS: ThemeRecord[]` (ordered, from the JSON)

- [ ] **Step 1: Write the failing test**

Add to `Resources/Template/scripts/themes.test.ts` (below the existing tests):

```typescript
import { THEME_RECORDS } from "./themes";

const ALLOWED_CATEGORIES = ["business", "personal", "blog", "portfolio", "organization"];

test("pack entries are complete: category, thumbnail, and credit are all present", () => {
  for (const theme of THEME_RECORDS) {
    if (theme.category !== undefined) {
      assert.ok(ALLOWED_CATEGORIES.includes(theme.category),
        `${theme.id}: unknown category "${theme.category}"`);
    }
    if (theme.pack !== undefined) {
      assert.ok(theme.category, `${theme.id}: pack entry missing category`);
      assert.ok(theme.thumbnail, `${theme.id}: pack entry missing thumbnail`);
      assert.ok(theme.credit?.name && theme.credit?.url && theme.credit?.license,
        `${theme.id}: pack entry missing credit name/url/license`);
    }
  }
});
```

(Import goes at the top with the existing imports: `import { THEMES, THEME_RECORDS } from "./themes";` — merge into the existing import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Resources/Template && npx tsx --test scripts/themes.test.ts`
Expected: FAIL — `themes.ts` has no export `THEME_RECORDS`.

- [ ] **Step 3: Implement**

Replace the interface/export section of `Resources/Template/scripts/themes.ts` with:

```typescript
export interface ThemeCredit {
  name: string;
  url: string;
  license: string;
}

export type ThemeCategory = "business" | "personal" | "blog" | "portfolio" | "organization";

export interface Theme {
  displayName: string;
  description: string;
  bestFor: string[];
  vars: Record<string, string>;
  /** Chooser category; absent = Blank (base chassis). Pack entries must set one. */
  category?: ThemeCategory;
  /** Pack directory name under packs/; absent = plain CSS-var theme. */
  pack?: string;
  /** Template-root-relative path to the committed thumbnail (pack entries only). */
  thumbnail?: string;
  /** Original-theme attribution (pack entries only). */
  credit?: ThemeCredit;
}

export type ThemeRecord = Theme & { id: string };

/** The catalog in JSON order (order is load-bearing: first entry = fallback default). */
export const THEME_RECORDS: ThemeRecord[] = themesData;

export const THEMES: Record<string, Theme> = Object.fromEntries(
  THEME_RECORDS.map(({ id, ...theme }) => [id, theme]),
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Resources/Template && npx tsx --test scripts/themes.test.ts`
Expected: PASS (4 tests — the 3 existing plus the new one; no JSON entries have pack fields yet, so the new test validates vacuously but the types compile).

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/scripts/themes.ts Resources/Template/scripts/themes.test.ts
git commit -m "feat(#1179): pack fields in template theme types"
```

---

### Task 4: `PackApplier` (Swift overlay copy)

**Files:**
- Create: `Sources/AnglesiteCore/PackApplier.swift`
- Test: `Tests/AnglesiteCoreTests/PackApplierTests.swift`

**Interfaces:**
- Consumes: `Theme.pack` (Task 2) — only in the sense that callers pass its value.
- Produces (used by Task 5):
  - `PackApplier.apply(packNamed:templateURL:siteDirectory:fileManager:) throws`
  - `PackApplier.PackError.packNotFound(String)` (associated value = the checked path)
  - `PackApplier.licenseFileName == "THEME-LICENSE"`

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/PackApplierTests.swift`:

```swift
import XCTest
@testable import AnglesiteCore

final class PackApplierTests: XCTestCase {

    private var template: URL!
    private var site: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        template = base.appendingPathComponent("template")
        site = base.appendingPathComponent("site")
        // Minimal scaffolded site: base global.css + a page the pack does NOT override.
        try write("::root base", to: site.appendingPathComponent("src/styles/global.css"))
        try write("<h1>About</h1>", to: site.appendingPathComponent("src/pages/about.astro"))
        // Pack overlay: replaces global.css, adds a component in a nested dir, ships a LICENSE.
        let pack = template.appendingPathComponent("packs/paper")
        try write(":root { --pack: 1 }", to: pack.appendingPathComponent("src/styles/global.css"))
        try write("<nav/>", to: pack.appendingPathComponent("src/components/PaperNav.astro"))
        try write("MIT License — upstream", to: pack.appendingPathComponent("LICENSE"))
    }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    private func read(_ url: URL) throws -> String { try String(contentsOf: url, encoding: .utf8) }

    func testApplyOverlaysReplacesAndAddsFiles() throws {
        try PackApplier.apply(packNamed: "paper", templateURL: template, siteDirectory: site)
        XCTAssertEqual(try read(site.appendingPathComponent("src/styles/global.css")), ":root { --pack: 1 }")
        XCTAssertEqual(try read(site.appendingPathComponent("src/components/PaperNav.astro")), "<nav/>")
        // Files the pack doesn't override survive.
        XCTAssertEqual(try read(site.appendingPathComponent("src/pages/about.astro")), "<h1>About</h1>")
    }

    func testApplyCopiesLicenseToSiteRoot() throws {
        try PackApplier.apply(packNamed: "paper", templateURL: template, siteDirectory: site)
        XCTAssertEqual(try read(site.appendingPathComponent(PackApplier.licenseFileName)),
                       "MIT License — upstream")
    }

    func testApplyThrowsWhenPackMissing() {
        XCTAssertThrowsError(try PackApplier.apply(packNamed: "nope", templateURL: template, siteDirectory: site)) { error in
            guard case PackApplier.PackError.packNotFound = error else {
                return XCTFail("expected packNotFound, got \(error)")
            }
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter PackApplierTests`
Expected: compile FAILURE — no `PackApplier` type.

- [ ] **Step 3: Implement**

Create `Sources/AnglesiteCore/PackApplier.swift`:

```swift
import Foundation

/// Copies a theme pack's overlay (`packs/<id>/` in the template) over a freshly scaffolded
/// site. Scaffold-time only: after the copy the site is just "the chassis with different
/// files" — no pack concept remains in the site
/// (spec: docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §3).
public enum PackApplier {
    /// Failure cases for ``apply(packNamed:templateURL:siteDirectory:fileManager:)``.
    public enum PackError: Error, Sendable {
        /// `packs/<id>` isn't in the template — the associated value is the path checked.
        case packNotFound(String)
    }

    /// Site-root file the pack's `LICENSE` is copied to, so the MIT attribution travels
    /// with the site's git repo rather than staying behind in the app bundle.
    public static let licenseFileName = "THEME-LICENSE"

    /// Overlays `packs/<pack>/src/**` onto `<siteDirectory>/src/` (per-file replace, never
    /// deletes site files the pack doesn't override) and copies the pack's `LICENSE` to
    /// ``licenseFileName``. Throws ``PackError/packNotFound(_:)`` when the pack directory
    /// is absent; a pack without `src/` or `LICENSE` copies whatever it does have.
    public static func apply(packNamed pack: String, templateURL: URL, siteDirectory: URL,
                             fileManager: FileManager = .default) throws {
        let packDir = templateURL.appendingPathComponent("packs/\(pack)", isDirectory: true)
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: packDir.path, isDirectory: &isDir), isDir.boolValue else {
            throw PackError.packNotFound(packDir.path)
        }
        let srcRoot = packDir.appendingPathComponent("src", isDirectory: true)
        if fileManager.fileExists(atPath: srcRoot.path) {
            try copyTree(from: srcRoot,
                         to: siteDirectory.appendingPathComponent("src", isDirectory: true),
                         fileManager: fileManager)
        }
        let license = packDir.appendingPathComponent("LICENSE")
        if fileManager.fileExists(atPath: license.path) {
            try replaceFile(at: siteDirectory.appendingPathComponent(licenseFileName),
                            with: license, fileManager: fileManager)
        }
    }

    private static func copyTree(from source: URL, to destination: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        for name in try fileManager.contentsOfDirectory(atPath: source.path) where name != ".DS_Store" {
            let src = source.appendingPathComponent(name)
            let dst = destination.appendingPathComponent(name)
            var isDir: ObjCBool = false
            fileManager.fileExists(atPath: src.path, isDirectory: &isDir)
            if isDir.boolValue {
                try copyTree(from: src, to: dst, fileManager: fileManager)
            } else {
                try replaceFile(at: dst, with: src, fileManager: fileManager)
            }
        }
    }

    private static func replaceFile(at destination: URL, with source: URL, fileManager: FileManager) throws {
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: source, to: destination)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter PackApplierTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/PackApplier.swift Tests/AnglesiteCoreTests/PackApplierTests.swift
git commit -m "feat(#1179): PackApplier overlay copy"
```

---

### Task 5: Wire the overlay into `SiteScaffolder`

**Files:**
- Modify: `Sources/AnglesiteCore/SiteScaffolder.swift` (the `.applyingTheme` block, currently lines 135–142)
- Test: `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`

**Interfaces:**
- Consumes: `PackApplier.apply(packNamed:templateURL:siteDirectory:fileManager:)`, `PackApplier.licenseFileName` (Task 4); `Theme.pack` (Task 2).
- Produces: no new API — behavior only. The pack copy runs inside the existing `.applyingTheme` milestone (it *is* the step after `.copyingTemplate`; no new `ScaffoldStep` case, so no wizard progress-UI change in this slice). Overlay failure degrades to `.warning(step: "applyingTheme", …)` and the pipeline continues to `ThemeApplier`.

- [ ] **Step 1: Write the failing tests**

Add to `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`. These need a scaffolder whose `templateURL` is a real temp dir containing a pack (the existing `makeScaffolder` uses a fake `/template` path); add this helper beside `makeScaffolder`:

```swift
/// A scaffolder whose catalog carries a pack-bearing theme and whose templateURL
/// points at a real temp template containing packs/<packName>/.
private func makePackScaffolder(root: URL, packName: String = "paper",
                                includePackDir: Bool = true) throws -> SiteScaffolder {
    let templateDir = tmpDir()
    if includePackDir {
        let packSrc = templateDir.appendingPathComponent("packs/\(packName)/src/styles")
        try FileManager.default.createDirectory(at: packSrc, withIntermediateDirectories: true)
        try ":root { --pack-marker: 1; --color-primary: #101010; }"
            .write(to: packSrc.appendingPathComponent("global.css"), atomically: true, encoding: .utf8)
        try "MIT — upstream".write(
            to: templateDir.appendingPathComponent("packs/\(packName)/LICENSE"),
            atomically: true, encoding: .utf8)
    }
    let packTheme = Theme(id: "paper", name: "Paper", blurb: "", swatch: [],
                          cssVars: ["color-primary": "#101010"],
                          category: "blog", pack: packName)
    return SiteScaffolder(
        sitesRoot: root,
        templateURL: templateDir,
        catalog: ThemeCatalog(themes: [packTheme]),
        run: fakeRunner(calls: CallRecorder()),
        gitInit: { _ in },
        gitCommit: { _ in },
        register: { pkg in try SiteStore.Site.make(package: pkg) }
    )
}

func testPackThemeOverlaysFilesAndCopiesLicense() async throws {
    let root = tmpDir()
    let scaffolder = try makePackScaffolder(root: root)
    var draft = makeDraft()
    draft.themeID = "paper"
    var steps: [SiteScaffolder.ScaffoldStep] = []
    for await s in scaffolder.scaffold(draft) { steps.append(s) }

    guard case .done? = steps.last else { return XCTFail("expected .done, got \(String(describing: steps.last))") }
    let source = root.appendingPathComponent("acme-co.anglesite/Source")
    let css = try String(contentsOf: source.appendingPathComponent("src/styles/global.css"), encoding: .utf8)
    // The pack's css landed, then ThemeApplier reaffirmed the palette over it.
    XCTAssertTrue(css.contains("--pack-marker: 1"))
    XCTAssertTrue(css.contains("--color-primary: #101010;"))
    let license = try String(contentsOf: source.appendingPathComponent(PackApplier.licenseFileName), encoding: .utf8)
    XCTAssertEqual(license, "MIT — upstream")
}

func testMissingPackDirWarnsButStillScaffolds() async throws {
    let root = tmpDir()
    let scaffolder = try makePackScaffolder(root: root, includePackDir: false)
    var draft = makeDraft()
    draft.themeID = "paper"
    var steps: [SiteScaffolder.ScaffoldStep] = []
    for await s in scaffolder.scaffold(draft) { steps.append(s) }

    guard case .done? = steps.last else { return XCTFail("expected .done, got \(String(describing: steps.last))") }
    let sawPackWarning = steps.contains { step in
        if case .warning(let s, _) = step { return s == "applyingTheme" }
        return false
    }
    XCTAssertTrue(sawPackWarning, "expected a non-fatal applyingTheme warning for the missing pack")
    // ThemeApplier still ran on the base css the fake runner wrote.
    let css = try String(
        contentsOf: root.appendingPathComponent("acme-co.anglesite/Source/src/styles/global.css"),
        encoding: .utf8)
    XCTAssertTrue(css.contains("--color-primary: #101010;"))
}
```

Note: `makeDraft()` uses name "Acme Co" and the fake runner writes the base `global.css` — both tests lean on that. `draft.themeID = "paper"` requires `NewSiteDraft.themeID` to be `var` (it is — the wizard mutates it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SiteScaffolderTests`
Expected: `testPackThemeOverlaysFilesAndCopiesLicense` FAILS (no pack css, no THEME-LICENSE); `testMissingPackDirWarnsButStillScaffolds` FAILS (no warning emitted).

- [ ] **Step 3: Implement**

In `Sources/AnglesiteCore/SiteScaffolder.swift`, replace the step-3 theme block:

```swift
        // 3. Theme (non-fatal). Resolve the owner's chosen theme; fall back to the first available.
        // Pack overlay first (spec §3): a pack-bearing theme copies its layout/component/style
        // files over the scaffolded chassis, then ThemeApplier reaffirms the palette. Both
        // degrade to warnings — a failed overlay leaves a working base-chassis site.
        emit(.applyingTheme)
        if let theme = resolvedTheme(for: draft) {
            if let pack = theme.pack {
                do { try PackApplier.apply(packNamed: pack, templateURL: templateURL,
                                           siteDirectory: siteDir, fileManager: fileManager) }
                catch { emit(.warning(step: "applyingTheme", message: "Theme pack not applied: \(humanize(error))")) }
            }
            do { try ThemeApplier.apply(theme, siteDirectory: siteDir, fileManager: fileManager) }
            catch { emit(.warning(step: "applyingTheme", message: humanize(error))) }
        } else {
            emit(.warning(step: "applyingTheme", message: "No themes available; left default look."))
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SiteScaffolderTests`
Expected: PASS (all, including the existing chooser-draft and happy-path tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SiteScaffolder.swift Tests/AnglesiteCoreTests/SiteScaffolderTests.swift
git commit -m "feat(#1179): apply theme pack overlay in SiteScaffolder"
```

---

### Task 6: `scaffold.sh` excludes `packs/` (hermetic test)

**Files:**
- Modify: `Resources/Template/scripts/scaffold.sh` (the rsync exclude list, lines 39–47)
- Test: `Resources/Template/scripts/scaffold.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the guarantee Task 7's contract relies on — `packs/` never ships inside a scaffolded site (like `scripts/themes.json` already doesn't).

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/scaffold.test.ts`. It builds a mini-template in a temp dir (scaffold.sh resolves `TEMPLATE_ROOT` from its own location, so it must be copied in), and asserts the copy excludes pack/scaffold infrastructure:

```typescript
// Run: npx tsx --test scripts/scaffold.test.ts
//
// Hermetic guard for scaffold.sh's rsync exclude list: packs/ and scaffold
// infrastructure must never ship inside a scaffolded site.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const realScaffold = join(dirname(fileURLToPath(import.meta.url)), "scaffold.sh");

test("scaffold.sh copies the site tree but excludes packs/ and scaffold infrastructure", () => {
  const base = mkdtempSync(join(tmpdir(), "anglesite-scaffold-test-"));
  try {
    const template = join(base, "template");
    mkdirSync(join(template, "scripts"), { recursive: true });
    mkdirSync(join(template, "src", "pages"), { recursive: true });
    mkdirSync(join(template, "packs", "demo", "src"), { recursive: true });
    copyFileSync(realScaffold, join(template, "scripts", "scaffold.sh"));
    writeFileSync(join(template, "scripts", "themes.json"), "[]");
    writeFileSync(join(template, "src", "pages", "index.astro"), "<h1>Welcome</h1>");
    writeFileSync(join(template, "packs", "demo", "src", "x.css"), ":root {}");

    const target = join(base, "site");
    execFileSync("/bin/zsh", [join(template, "scripts", "scaffold.sh"), "--yes", target], { stdio: "pipe" });

    assert.ok(existsSync(join(target, "src", "pages", "index.astro")), "site tree copied");
    assert.ok(existsSync(join(target, ".site-config")), ".site-config written");
    assert.ok(!existsSync(join(target, "packs")), "packs/ must not ship in sites");
    assert.ok(!existsSync(join(target, "scripts", "scaffold.sh")), "scaffold.sh excluded");
    assert.ok(!existsSync(join(target, "scripts", "themes.json")), "themes.json excluded");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Resources/Template && npx tsx --test scripts/scaffold.test.ts`
Expected: FAIL on `packs/ must not ship in sites` (rsync copied it).

- [ ] **Step 3: Implement**

In `Resources/Template/scripts/scaffold.sh`, add one exclude to the rsync (after the `themes.json` line):

```sh
    --exclude='scripts/themes.json' \
    --exclude='packs/' \
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Resources/Template && npx tsx --test scripts/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/scripts/scaffold.sh Resources/Template/scripts/scaffold.test.ts
git commit -m "feat(#1179): exclude packs/ from scaffolded sites"
```

---

### Task 7: `check-pack.ts` port-contract lint

**Files:**
- Create: `Resources/Template/scripts/check-pack.ts`
- Test: `Resources/Template/scripts/check-pack.test.ts`
- Modify: `Resources/Template/package.json` (add `"check:packs": "tsx scripts/check-pack.ts"` to scripts)

**Interfaces:**
- Consumes: `THEME_RECORDS`, `ThemeRecord` from `./themes` (Task 3).
- Produces: `validatePack(packDir: string, entry: ThemeRecord | undefined): string[]` (empty = compliant) and a CLI (`tsx scripts/check-pack.ts`) that exits 1 with the error list when any `packs/*` dir violates the contract, exits 0 (with a note) when `packs/` is absent/empty. Task 8's CI wiring runs the CLI.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/check-pack.test.ts`:

```typescript
// Run: npx tsx --test scripts/check-pack.test.ts
//
// Port-contract lint (spec §2, docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md):
// markers, HomepageWriter sentinels, flat component dirs, the 12 base tokens, LICENSE,
// thumbnail, and a complete catalog entry.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePack, REQUIRED_ROOT_VARS } from "./check-pack";
import type { ThemeRecord } from "./themes";

const ENTRY: ThemeRecord = {
  id: "paper",
  displayName: "Paper",
  description: "Ported blog theme",
  bestFor: ["blog"],
  vars: { "color-primary": "#111111", "color-accent": "#ff5500" },
  category: "blog",
  pack: "paper",
  thumbnail: "packs/paper/thumbnail.png",
  credit: { name: "AstroPaper", url: "https://example.com", license: "MIT" },
};

const BASE_LAYOUT = `---
// anglesite:imports
---
<head><!-- anglesite:head-end --></head>
<body><!-- anglesite:nav --><main id="main"><slot /></main><!-- anglesite:body-end --></body>`;

const INDEX_PAGE = `---
// anglesite:imports
---
<BaseLayout title="Welcome — Your New Anglesite Business Website"
  description="Your business website is ready to set up in Anglesite.">
  <h1>Welcome</h1>
  <p>This site is ready to customize in Anglesite. Open the app to edit your pages, add content, and publish when you're ready.</p>
  <!-- anglesite:hero-cta -->
</BaseLayout>`;

const GLOBAL_CSS = `:root {
${REQUIRED_ROOT_VARS.map((name) => `  ${name}: initial;`).join("\n")}
}`;

function makePack(mutate?: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "anglesite-pack-"));
  mkdirSync(join(dir, "src", "layouts"), { recursive: true });
  mkdirSync(join(dir, "src", "pages"), { recursive: true });
  mkdirSync(join(dir, "src", "components"), { recursive: true });
  mkdirSync(join(dir, "src", "styles"), { recursive: true });
  writeFileSync(join(dir, "LICENSE"), "MIT License");
  writeFileSync(join(dir, "thumbnail.png"), "png");
  writeFileSync(join(dir, "src", "layouts", "BaseLayout.astro"), BASE_LAYOUT);
  writeFileSync(join(dir, "src", "pages", "index.astro"), INDEX_PAGE);
  writeFileSync(join(dir, "src", "styles", "global.css"), GLOBAL_CSS);
  writeFileSync(join(dir, "src", "components", "PaperNav.astro"), "<nav><slot /></nav>");
  mutate?.(dir);
  return dir;
}

test("a compliant pack passes", () => {
  const dir = makePack();
  try { assert.deepEqual(validatePack(dir, ENTRY), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing catalog entry is reported", () => {
  const dir = makePack();
  try { assert.ok(validatePack(dir, undefined).some((e) => e.includes("catalog"))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing marker in an overridden BaseLayout is reported", () => {
  const dir = makePack((d) =>
    writeFileSync(join(d, "src", "layouts", "BaseLayout.astro"),
      BASE_LAYOUT.replace("<!-- anglesite:nav -->", "")));
  try { assert.ok(validatePack(dir, ENTRY).some((e) => e.includes("anglesite:nav"))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing HomepageWriter sentinel in an overridden index is reported", () => {
  const dir = makePack((d) =>
    writeFileSync(join(d, "src", "pages", "index.astro"),
      INDEX_PAGE.replace("<h1>Welcome</h1>", "<h1>Hello</h1>")));
  try { assert.ok(validatePack(dir, ENTRY).some((e) => e.includes("<h1>Welcome</h1>"))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("nested component directories are reported", () => {
  const dir = makePack((d) => {
    mkdirSync(join(d, "src", "components", "hero"), { recursive: true });
    writeFileSync(join(d, "src", "components", "hero", "Hero.astro"), "<div/>");
  });
  try { assert.ok(validatePack(dir, ENTRY).some((e) => e.includes("subdirector"))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a global.css missing a base token is reported", () => {
  const dir = makePack((d) =>
    writeFileSync(join(d, "src", "styles", "global.css"),
      GLOBAL_CSS.replace("--radius-lg: initial;", "")));
  try { assert.ok(validatePack(dir, ENTRY).some((e) => e.includes("--radius-lg"))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing LICENSE and thumbnail are reported", () => {
  const dir = makePack((d) => {
    rmSync(join(d, "LICENSE"));
    rmSync(join(d, "thumbnail.png"));
  });
  try {
    const errors = validatePack(dir, ENTRY);
    assert.ok(errors.some((e) => e.includes("LICENSE")));
    assert.ok(errors.some((e) => e.includes("thumbnail")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a pack that overrides nothing structural still needs LICENSE + entry only", () => {
  // Styles-only pack: no layouts/pages overridden → no marker/sentinel requirements.
  const dir = mkdtempSync(join(tmpdir(), "anglesite-pack-"));
  mkdirSync(join(dir, "src", "styles"), { recursive: true });
  writeFileSync(join(dir, "LICENSE"), "MIT License");
  writeFileSync(join(dir, "thumbnail.png"), "png");
  writeFileSync(join(dir, "src", "styles", "global.css"), GLOBAL_CSS);
  try { assert.deepEqual(validatePack(dir, ENTRY), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Resources/Template && npx tsx --test scripts/check-pack.test.ts`
Expected: FAIL — cannot find module `./check-pack`.

- [ ] **Step 3: Implement**

Create `Resources/Template/scripts/check-pack.ts`:

```typescript
// Port-contract lint for theme packs (packs/<id>/), per
// docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §2.
//
// CLI: npx tsx scripts/check-pack.ts   (exit 1 on any violation; no packs = pass)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_RECORDS, type ThemeRecord } from "./themes";

/** The 12 base custom properties every pack's global.css must declare in :root. */
export const REQUIRED_ROOT_VARS = [
  "--color-primary", "--color-accent", "--color-background", "--color-surface",
  "--color-text", "--color-text-muted", "--font-heading", "--font-body",
  "--spacing-unit", "--radius-sm", "--radius-md", "--radius-lg",
] as const;

/** Marker anchors required per file, when the pack overrides that file. */
const REQUIRED_MARKERS: Record<string, string[]> = {
  "src/layouts/BaseLayout.astro": [
    "// anglesite:imports", "<!-- anglesite:head-end -->",
    "<!-- anglesite:nav -->", "<!-- anglesite:body-end -->",
  ],
  "src/pages/index.astro": ["// anglesite:imports", "<!-- anglesite:hero-cta -->"],
  "src/layouts/BlogPost.astro": ["// anglesite:imports"],
};

/** HomepageWriter's exact sentinels (Sources/AnglesiteCore/HomepageWriter.swift). */
const HOMEPAGE_SENTINELS = [
  'title="Welcome — Your New Anglesite Business Website"',
  'description="Your business website is ready to set up in Anglesite."',
  "<h1>Welcome</h1>",
  "<p>This site is ready to customize in Anglesite. Open the app to edit your pages, add content, and publish when you're ready.</p>",
];

/** Dirs that must stay flat (component-canvas resolver assumption). */
const FLAT_DIRS = ["src/components", "src/layouts"];

/** Validate one pack directory against the port contract. Empty array = compliant. */
export function validatePack(packDir: string, entry: ThemeRecord | undefined): string[] {
  const errors: string[] = [];

  if (!entry) {
    errors.push(`no catalog entry in themes.json has pack="${join(packDir).split("/").pop()}"`);
  } else {
    if (!entry.category) errors.push(`${entry.id}: catalog entry missing category`);
    if (!entry.thumbnail) errors.push(`${entry.id}: catalog entry missing thumbnail`);
    if (!entry.credit?.name || !entry.credit?.url || !entry.credit?.license) {
      errors.push(`${entry.id}: catalog entry missing credit name/url/license`);
    }
  }

  if (!existsSync(join(packDir, "LICENSE"))) errors.push("missing LICENSE");
  if (!existsSync(join(packDir, "thumbnail.png"))) errors.push("missing thumbnail.png");

  for (const [file, markers] of Object.entries(REQUIRED_MARKERS)) {
    const path = join(packDir, file);
    if (!existsSync(path)) continue; // not overridden — base chassis file survives
    const text = readFileSync(path, "utf8");
    for (const marker of markers) {
      if (!text.includes(marker)) errors.push(`${file}: missing marker ${marker}`);
    }
  }

  const indexPath = join(packDir, "src/pages/index.astro");
  if (existsSync(indexPath)) {
    const text = readFileSync(indexPath, "utf8");
    for (const sentinel of HOMEPAGE_SENTINELS) {
      if (!text.includes(sentinel)) {
        errors.push(`src/pages/index.astro: missing HomepageWriter sentinel ${sentinel}`);
      }
    }
  }

  for (const dir of FLAT_DIRS) {
    const path = join(packDir, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) {
      if (statSync(join(path, name)).isDirectory()) {
        errors.push(`${dir}/${name}: subdirectories not allowed (component-canvas resolver assumes flat dirs)`);
      }
    }
  }

  const cssPath = join(packDir, "src/styles/global.css");
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, "utf8");
    for (const name of REQUIRED_ROOT_VARS) {
      if (!css.includes(`${name}:`)) errors.push(`src/styles/global.css: missing ${name}`);
    }
  }

  return errors;
}

// CLI entry: validate every pack in the template's packs/ directory.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const packsRoot = join(templateRoot, "packs");
  if (!existsSync(packsRoot)) {
    console.log("check-pack: no packs/ directory — nothing to check.");
    process.exit(0);
  }
  const packs = readdirSync(packsRoot).filter((name) =>
    statSync(join(packsRoot, name)).isDirectory());
  let failed = false;
  for (const pack of packs) {
    const entry = THEME_RECORDS.find((theme) => theme.pack === pack);
    const errors = validatePack(join(packsRoot, pack), entry);
    if (errors.length > 0) {
      failed = true;
      console.error(`✗ ${pack}`);
      for (const error of errors) console.error(`    ${error}`);
    } else {
      console.log(`✓ ${pack}`);
    }
  }
  // Reverse check: catalog entries pointing at packs that don't exist.
  for (const theme of THEME_RECORDS) {
    if (theme.pack && !packs.includes(theme.pack)) {
      failed = true;
      console.error(`✗ ${theme.id}: catalog pack "${theme.pack}" has no packs/${theme.pack}/ directory`);
    }
  }
  process.exit(failed ? 1 : 0);
}
```

Add to `Resources/Template/package.json` scripts (after `"check"`):

```json
"check:packs": "tsx scripts/check-pack.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Resources/Template && npx tsx --test scripts/check-pack.test.ts && npx tsx scripts/check-pack.ts`
Expected: 8 tests PASS; CLI prints `check-pack: no packs/ directory — nothing to check.` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/scripts/check-pack.ts Resources/Template/scripts/check-pack.test.ts Resources/Template/package.json
git commit -m "feat(#1179): check-pack.ts port-contract lint"
```

---

### Task 8: Per-pack build loop + CI wiring

**Files:**
- Create: `Resources/Template/scripts/build-packs.sh`
- Modify: `Resources/Template/package.json` (add `"build:packs"`)
- Modify: `.github/workflows/ci.yml` (template lane, after `npm run build`)

**Interfaces:**
- Consumes: `scaffold.sh` (Task 6 exclusion), `check:packs` (Task 7).
- Produces: `npm run build:packs` — scaffolds a temp site, overlays each pack, runs the full `npm run build` against it. A broken port cannot land. No-op (exit 0) when `packs/` is absent or empty.

No node:test here — the script's happy path *is* an `astro build`, which is what CI exercises; a unit test would just re-test rsync. Verification is running it.

- [ ] **Step 1: Write the script**

Create `Resources/Template/scripts/build-packs.sh` (mark executable):

```zsh
#!/usr/bin/env zsh
#
# Build the chassis with each theme pack overlaid, so a pack that breaks
# `astro build` (or the pre/post-build checks) cannot land. Run from anywhere;
# requires the template's node_modules to be installed (npm ci/install first).
#
# Spec: docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §7.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${(%):-%x}")" && pwd)
TEMPLATE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PACKS_DIR="$TEMPLATE_ROOT/packs"

if [[ ! -d "$PACKS_DIR" ]] || [[ -z "$(ls -A "$PACKS_DIR" 2>/dev/null)" ]]; then
    echo "build-packs: no packs to build."
    exit 0
fi

if [[ ! -d "$TEMPLATE_ROOT/node_modules" ]]; then
    echo "build-packs: run npm install in $TEMPLATE_ROOT first." >&2
    exit 1
fi

for pack_dir in "$PACKS_DIR"/*(/); do
    pack=$(basename "$pack_dir")
    target=$(mktemp -d)
    echo "==> Building chassis with pack: $pack"
    "$SCRIPT_DIR/scaffold.sh" --yes "$target"
    rsync -a "$pack_dir/src/" "$target/src/"
    [[ -f "$pack_dir/LICENSE" ]] && cp "$pack_dir/LICENSE" "$target/THEME-LICENSE"
    ln -s "$TEMPLATE_ROOT/node_modules" "$target/node_modules"
    (cd "$target" && npm run build)
    rm -rf "$target"
done

echo "==> All packs built."
```

```bash
chmod +x Resources/Template/scripts/build-packs.sh
```

Add to `Resources/Template/package.json` scripts (after `"check:packs"`):

```json
"build:packs": "zsh scripts/build-packs.sh",
```

- [ ] **Step 2: Run it to verify the no-pack fast path**

Run: `cd Resources/Template && npm run build:packs`
Expected: `build-packs: no packs to build.` exit 0.

- [ ] **Step 3: Wire into CI**

In `.github/workflows/ci.yml`, template lane (`template-worker` job), make two edits.

First, immediately after the `- run: npm ci --no-audit --no-fund` step, add (Task 6's `scaffold.test.ts` executes `/bin/zsh` inside `npm test`, and ubuntu-latest doesn't preinstall zsh — the scripts stay zsh because `scaffold.sh` must remain zsh for the app's macOS use; CI adapts to the scripts):

```yaml
      # scaffold.sh, build-packs.sh, and scaffold.test.ts run zsh (#1179);
      # ubuntu-latest doesn't ship it.
      - run: sudo apt-get update && sudo apt-get install -y zsh
```

Second, after `- run: npm run build`, add:

```yaml
      # Port-contract lint + per-pack chassis builds (#1179). Both are fast no-ops
      # until packs/ gains entries; once ports land, a pack that violates the
      # contract or breaks astro build fails this lane.
      - run: npm run check:packs
      - run: npm run build:packs
```

- [ ] **Step 4: Verify the workflow parses and the loop works with a fixture**

```bash
# YAML sanity:
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
# Exercise the real loop once locally with a throwaway pack:
mkdir -p Resources/Template/packs/_smoke/src/styles
cp Resources/Template/src/styles/global.css Resources/Template/packs/_smoke/src/styles/global.css
printf 'MIT' > Resources/Template/packs/_smoke/LICENSE
cd Resources/Template && npm run build:packs; cd ../..
rm -rf Resources/Template/packs
```

Expected: the `_smoke` pack scaffolds, overlays, and completes `npm run build` (requires `npm install` in `Resources/Template` first); then the packs dir is removed — **slice 2 ships no committed packs**.

- [ ] **Step 5: Run the full test suites per CONTRIBUTING**

```bash
swift test --package-path .
cd Resources/Template && npm test; cd ../..
```

Expected: all PASS (template markup untouched, so the template-coupled Swift suites hold).

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/scripts/build-packs.sh Resources/Template/package.json .github/workflows/ci.yml
git commit -m "ci(#1179): lint and build theme packs in template lane"
```

---

## PR strategy

- **Docs PR** (current branch `claude/issue-1179-55725c`): the spec, this plan, and Task 1's curation doc. Body per `.github/PULL_REQUEST_TEMPLATE.md` (Summary / Paired PR check / Test plan); references #1179 **without** a closing keyword (the epic stays open).
- **Slice-2 PR** (fresh worktree branch off main after the docs PR merges): Tasks 2–8. Also references #1179 without closing it. Template changes are app-only — no paired sidecar PR (Paired PR check: not needed).
- Sub-issues for slices 3 (chooser sidebar) and the per-theme ports get filed against the epic once the shortlist is approved; ports cite `docs/theme-curation.md`.
