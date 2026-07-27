# Astro Animate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake `@astroanimate/core` into the Anglesite website template with a curated, CSP-safe component catalog, an app-side Animations gallery, and a sidecar skill/ADR update.

**Architecture:** Three workstreams matching three GitHub issues. WS1 (app repo) adds the pinned dependency, curation manifest `integrations/animations.json`, docs, prerendered demo snapshots, and template tests. WS2 (app repo, stacked on WS1) adds an `AnimationCatalog` model in AnglesiteCore and a gallery sheet in the app. WS3 (sidecar repo) extends ADR-0008's npm carve-out and adds an escalation section to the `/animate` skill. Spec: `docs/superpowers/specs/2026-07-27-astro-animate-design.md`.

**Tech Stack:** npm/Astro 7 (template), Vitest + Astro Container API (component rendering in tests), Swift 6.4 / SwiftUI / WKWebView (app), Markdown (sidecar).

## Global Constraints

- Dependency is `"@astroanimate/core": "0.1.2"` — **exact pin, no caret** — with npm override `"@astroanimate/core": { "astro": "$astro" }`.
- Curated components MUST emit **zero `<script>` tags** with their cataloged props (template CSP has no `'unsafe-inline'`/hashes; `enhance` must stay `false`) and MUST include a `prefers-reduced-motion` guard in their CSS.
- Import paths use the package export map: `import FadeInText from "@astroanimate/core/FadeInText";`.
- App repo work happens in a git worktree; run `xcodegen generate` before any Xcode build; `cd` to the worktree before every git command.
- Template edits require running the Swift guard suites: `swift test --filter IntegrationTemplateAssetsTests` and `swift test --filter ProjectValidator`.
- Conventional commits, subject ≤72 chars, issue number in subject. PR bodies use `.github/PULL_REQUEST_TEMPLATE.md` headings verbatim (Summary / Paired PR check / Test plan).
- Container image re-vendor needs `ANGLESITE_SIDECAR_SRC=$HOME/Developer/github.com/Anglesite/anglesite`.
- New user-visible strings in the app require the `xcrun xcstringstool sync … --skip-marking-strings-stale` recipe from CONTRIBUTING.md (scoped to this worktree's DerivedData) and committing the `.xcstrings` diff.

---

## Workstream 1 — Template capability (app repo, Issue A)

### Task 1: Add the pinned dependency with Astro-7 override

**Files:**
- Modify: `Resources/Template/package.json`
- Modify: `Resources/Template/package-lock.json` (regenerated)

**Interfaces:**
- Produces: `node_modules/@astroanimate/core` present in the template; export-map imports `@astroanimate/core/<Name>` resolve.

- [x] **Step 1: Edit `package.json`.** In `dependencies` (alphabetical, after `"@astrojs/rss"`): add `"@astroanimate/core": "0.1.2",`. At top level (after `"devDependencies"`), add:

```json
"overrides": {
  "@astroanimate/core": {
    "astro": "$astro"
  }
}
```

- [x] **Step 2: Install and verify resolution.**

Run: `cd Resources/Template && npm install`
Expected: exits 0, **no** `ERESOLVE` peer-dependency error; `ls node_modules/@astroanimate/core/dist/components | wc -l` prints ≥30.

- [x] **Step 3: Confirm existing template suites still pass.**

Run (from `Resources/Template/`): `npm run test:scripts`
Expected: PASS (no new failures).

- [x] **Step 4: Commit** (`package.json` + `package-lock.json` only):

```bash
git add Resources/Template/package.json Resources/Template/package-lock.json
git commit -m "feat(template): add @astroanimate/core 0.1.2 (#<ISSUE_A>)"
```

### Task 2: Curation manifest + rendering smoke tests (Vitest + Astro Container)

**Files:**
- Create: `Resources/Template/integrations/animations.json`
- Create: `Resources/Template/scripts/animations-catalog.ts` (manifest loader + types)
- Create: `Resources/Template/src/lib/animations-catalog.spec.ts` (Vitest; rendering tests)
- Modify: `Resources/Template/vitest.config.ts` — this config uses `@cloudflare/vitest-pool-workers` for `worker/` tests; do NOT touch it. Instead Create: `Resources/Template/vitest.astro.config.ts` and add script `"test:astro": "vitest run --config vitest.astro.config.ts"` to `Resources/Template/package.json`, and append `&& npm run test:astro` to the template `test` script.

**Interfaces:**
- Produces: `animations.json` schema (consumed by Task 3 docs test, Task 5 Swift decoding, Task 6 gallery):

```json
{
  "version": 1,
  "components": [
    {
      "component": "FadeInText",
      "title": "Fade-in text",
      "ownerDescription": "Text that fades in with a soft blur when the page loads.",
      "category": "text",
      "keyProps": { "duration": "seconds (default 0.6)", "delay": "seconds", "as": "wrapper tag, e.g. \"h1\"" },
      "props": {},
      "snippet": "---\nimport FadeInText from \"@astroanimate/core/FadeInText\";\n---\n<FadeInText as=\"h1\">Welcome</FadeInText>"
    }
  ]
}
```

  `props` is the exact prop object used for rendering in tests and demos (usually `{}` = defaults; MUST NOT contain `enhance: true`). `category` ∈ `text | cards | buttons | backgrounds | navigation`.
- Produces: `loadAnimationsCatalog(): AnimationsCatalog` from `scripts/animations-catalog.ts`.

- [x] **Step 1: Write the loader** `Resources/Template/scripts/animations-catalog.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface AnimationCatalogEntry {
  component: string;
  title: string;
  ownerDescription: string;
  category: "text" | "cards" | "buttons" | "backgrounds" | "navigation";
  keyProps: Record<string, string>;
  props: Record<string, unknown>;
  snippet: string;
}

export interface AnimationsCatalog {
  version: number;
  components: AnimationCatalogEntry[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function catalogPath(): string {
  return resolve(HERE, "../integrations/animations.json");
}

export function loadAnimationsCatalog(): AnimationsCatalog {
  return JSON.parse(readFileSync(catalogPath(), "utf8")) as AnimationsCatalog;
}
```

- [x] **Step 2: Write `vitest.astro.config.ts`** (Astro's Vite pipeline so `.astro` imports compile):

```ts
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    include: ["src/lib/animations-catalog.spec.ts"],
  },
});
```

- [x] **Step 3: Write the failing rendering test** `Resources/Template/src/lib/animations-catalog.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadAnimationsCatalog } from "../../scripts/animations-catalog";

const catalog = loadAnimationsCatalog();

describe("animations catalog", () => {
  it("has at least one curated component", () => {
    expect(catalog.components.length).toBeGreaterThan(0);
  });

  it("never catalogs enhance=true (CSP: no inline scripts)", () => {
    for (const entry of catalog.components) {
      expect(entry.props["enhance"], entry.component).not.toBe(true);
      expect(entry.snippet).not.toContain("enhance={true}");
      expect(entry.snippet).not.toContain('enhance="true"');
    }
  });

  for (const entry of catalog.components) {
    describe(entry.component, () => {
      it("renders, is script-free, and guards reduced motion", async () => {
        const container = await AstroContainer.create();
        const mod = await import(
          /* @vite-ignore */ `@astroanimate/core/${entry.component}`
        );
        const html = await container.renderToString(mod.default, {
          props: entry.props,
          slots: { default: "Sample content" },
        });
        expect(html.length).toBeGreaterThan(0);
        expect(html).not.toContain("<script");
        const source = readFileSync(
          `node_modules/@astroanimate/core/dist/components/${entry.component}/${entry.component}.astro`,
          "utf8",
        );
        expect(source).toContain("prefers-reduced-motion");
      });
    });
  }
});
```

- [x] **Step 4: Run it to make sure it fails** (no manifest yet).

Run (from `Resources/Template/`): `npx vitest run --config vitest.astro.config.ts`
Expected: FAIL — `ENOENT … integrations/animations.json`.

- [x] **Step 5: Write `integrations/animations.json`.** Start from this candidate list and **let the test decide membership** — drop any component that emits `<script>` with default props or lacks a reduced-motion guard; keep the survivors: `FadeInText`, `ScaleIn`, `RevealImage`, `HighlightText`, `TypewriterText` (category `text`); `AnimatedCard`, `GlassCard`, `CardStack`, `ArticleCard` (category `cards`); `AnimatedButton`, `FillHoverButton`, `ArrowCTAButton`, `SlidingOverlayButton` (category `buttons`); `GridDotsBackground`, `InfiniteMarquee` (category `backgrounds`); `Loader`, `ProgressBar` (category `navigation`). Every entry follows the schema in **Interfaces** above, `props: {}` unless a prop is required to render, and a `snippet` in the exact import style shown there.

  **Dropped: `GlassCard`.** Static inspection of `dist/components/GlassCard/GlassCard.astro` showed an unconditional `<script is:inline define:vars={{ cardId }}>` (tilt/glare JS) with no `enhance` gate at all — it always emits a script regardless of props, which fails the CSP zero-`<script>` rule. Excluded before writing the manifest rather than added-then-pruned. `CardStack` defaults `enhance` to `true` (unlike the other enhance-gated components); catalogued with `props: { enhance: false, ... }` and the snippet shows `enhance={false}` explicitly so copy-paste usage stays CSS-only. All other 15 candidates passed the rendering/script/reduced-motion test as originally proposed — final curated list is 16 components.

- [x] **Step 6: Run tests until green; prune failures.**

Run: `npx vitest run --config vitest.astro.config.ts`
Expected: PASS with the final curated list (document dropped components in the commit body).

  One test bug found and fixed along the way: the literal `expect(html).not.toContain("<script")` check false-failed on `FadeInText` — not because it emits a real `<script>` element, but because Astro preserves top-level template comments in compiled output, and `FadeInText`'s own comment ("Script emitted ONLY when enhance=true... Astro does NOT bundle `<script>` tags...") contains the literal substring `<script` inside an HTML comment. Fixed by stripping HTML comments (`html.replace(/<!--[\s\S]*?-->/g, "")`) before the containment check, so the assertion targets real `<script>` elements. All 16 curated components pass; no component was dropped by the render/script/reduced-motion assertion itself (only `GlassCard`, excluded up front per Step 5).

- [x] **Step 7: Wire the script into `package.json`** — add `"test:astro": "vitest run --config vitest.astro.config.ts"` to template scripts and extend the existing `"test"` script with ` && npm run test:astro`.

- [x] **Step 8: Commit:**

```bash
git add Resources/Template/integrations/animations.json Resources/Template/scripts/animations-catalog.ts \
  Resources/Template/src/lib/animations-catalog.spec.ts Resources/Template/vitest.astro.config.ts \
  Resources/Template/package.json
git commit -m "feat(template): curated Astro Animate catalog + smoke tests (#<ISSUE_A>)"
```

### Task 3: Prerendered demo snapshots + owner docs

**Files:**
- Create: `Resources/Template/integrations/animations-demos/<Component>.html` (one per curated component, via file snapshots)
- Create: `Resources/Template/integrations/docs/animations.md`
- Modify: `Resources/Template/src/lib/animations-catalog.spec.ts` (add demo + docs tests)

**Interfaces:**
- Produces: `integrations/animations-demos/<Component>.html` — self-contained (inline `<style>` only) demo pages, loaded by the WS2 gallery's WKWebView via file URL.

- [x] **Step 1: Add demo-snapshot and docs tests** to `animations-catalog.spec.ts` (inside the per-entry `describe`):

  Deviation from the plan's literal test body: `AstroContainer#renderToString` does not bundle a
  component's scoped `<style>` block (that extraction is normally a Vite/build-time asset step
  the container API doesn't run), so the demo page as originally specified rendered with zero
  CSS — no `@keyframes`, nothing — which would contradict the spec's "prerendered demos animate
  for real" goal. Fixed by reading the component's raw source and inlining its `<style>` block
  content (via `[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]`) into the demo page's
  `<head>`. Verified safe: every curated component's CSS selectors are plain classes or
  `[data-*]` attributes (not Astro's `:scope` hash), and each demo page renders exactly one
  instance, so there's no scoping collision. Visually verified in the browser: `FadeInText.html`
  renders the fade-in text visible after its animation completes, and `InfiniteMarquee.html`
  shows the marquee track actually scrolling with edge fade.

```ts
      it("demo snapshot is fresh", async () => {
        const container = await AstroContainer.create();
        const mod = await import(
          /* @vite-ignore */ `@astroanimate/core/${entry.component}`
        );
        const inner = await container.renderToString(mod.default, {
          props: entry.props,
          slots: { default: `${entry.title} demo` },
        });
        const page = [
          "<!doctype html>",
          `<html lang="en"><head><meta charset="utf-8"><title>${entry.title}</title>`,
          "<style>body{margin:0;display:grid;place-items:center;min-height:100vh;",
          "font-family:-apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText;color-scheme:light dark}</style>",
          "</head><body>",
          inner,
          "</body></html>",
          "",
        ].join("\n");
        await expect(page).toMatchFileSnapshot(
          `../../integrations/animations-demos/${entry.component}.html`,
        );
      });
```

  And once, outside the loop:

```ts
  it("every curated component is documented", () => {
    const docs = readFileSync("integrations/docs/animations.md", "utf8");
    for (const entry of catalog.components) {
      expect(docs, entry.component).toContain(`## ${entry.component}`);
    }
  });
```

- [x] **Step 2: Generate snapshots.**

Run: `npx vitest run --config vitest.astro.config.ts -u`
Expected: PASS; one `.html` per curated component appears under `integrations/animations-demos/`. Open one in a browser and confirm the animation plays.

  Confirmed in the Browser pane: `FadeInText.html` and `InfiniteMarquee.html` both animate.

- [x] **Step 3: Write `integrations/docs/animations.md`.** Header explaining: baked-in `@astroanimate/core@0.1.2`, CSS-only policy (never `enhance={true}` — the site CSP blocks inline scripts), import style, and then one `## <Component>` section per curated entry containing the `ownerDescription`, key props table, and the manifest `snippet` in a fenced code block. The docs test from Step 1 enforces coverage.

- [x] **Step 4: Run the full template test script.**

Run (from `Resources/Template/`): `npm test`
Expected: PASS (tsx suites + worker vitest + astro vitest).

  `npm test` (tsx suites, 452 passed/2 skipped, + astro vitest, 35 passed) and `npm run test:worker` (115 passed) both ran green; `npm test` as wired doesn't itself invoke `test:worker` (see CI's `template-worker` job, which runs `npm test` and `npm run test:worker` as two separate steps) — ran it separately for full coverage since this task touches template files under test.

- [x] **Step 5: Commit:**

```bash
git add Resources/Template/integrations/animations-demos Resources/Template/integrations/docs/animations.md \
  Resources/Template/src/lib/animations-catalog.spec.ts
git commit -m "feat(template): animation demos + owner docs (#<ISSUE_A>)"
```

### Task 4: Swift guards, container re-vendor, PR

**Files:**
- No new files; verification + PR.

- [x] **Step 1: Run the template-coupled Swift guards** (repo root; xcodegen not needed for SwiftPM tests):

Run: `swift test --filter IntegrationTemplateAssetsTests && swift test --filter ProjectValidator`
Expected: PASS. If a guard hard-codes template file lists, extend it to cover `integrations/animations.json` rather than deleting assertions.

  Both suites passed (10/10 and 6/6 tests). Neither guard enumerates `Resources/Template/` generically or hardcodes a template file inventory that would need extending for the new `integrations/animations.json`/`animations-demos/`/`docs/animations.md` files — `IntegrationTemplateAssetsTests` targets a specific, named subset of on-demand integration assets, and `ProjectValidator`'s sentinel set doesn't reference the animations catalog.

- [x] **Step 2: Full SwiftPM suite** (template changes can couple to Swift tests; capture full output to a file, never tail):

Run: `swift test --package-path . > /tmp/swift-test-astroanimate.log 2>&1; tail -5 /tmp/swift-test-astroanimate.log && grep -c " passed" /tmp/swift-test-astroanimate.log`
Expected: suite passes (known flakes: AstroDevServerTests port/ready-URL — rerun once before debugging; FM "tokens exceeds 8192" is a live-model flake).

- [x] **Step 3: Re-vendor the container image** (it bakes template `node_modules`):

Run: `ANGLESITE_SIDECAR_SRC=$HOME/Developer/github.com/Anglesite/anglesite scripts/vendor-container-image.sh`
Expected: exits 0. If the environment can't build images, say so in the PR's Test plan rather than skipping silently.

  Exited 0. The `container` CLI (1.1.0) was available; the build staged the sidecar + template context, ran `npm ci` against the template's `package.json`/`package-lock.json` (786 packages, including `@astroanimate/core`), and exported the OCI layout to `Resources/container-image/` (gitignored — nothing to commit here).

- [x] **Step 4: Push branch, open PR A** targeting `main`, body built from `.github/PULL_REQUEST_TEMPLATE.md` headings (**Summary**, **Paired PR check** — note: template-only, app-only, no MCP schema change; sidecar PR is coordinated but independent — and **Test plan** listing the commands above). Then `gh issue edit <ISSUE_A> --remove-label "🛠️ In Progress"`.

---

## Workstream 2 — App gallery (app repo, Issue B; stacked on WS1)

### Task 5: `AnimationCatalog` model in AnglesiteCore (TDD)

**Files:**
- Create: `Sources/AnglesiteCore/AnimationCatalog.swift`
- Create: `Tests/AnglesiteCoreTests/AnimationCatalogTests.swift`

**Interfaces:**
- Consumes: `integrations/animations.json` schema from Task 2.
- Produces (used by Task 6):

```swift
public struct AnimationCatalogEntry: Sendable, Codable, Identifiable, Hashable {
    public var id: String { component }
    public let component: String
    public let title: String
    public let ownerDescription: String
    public let category: AnimationCategory
    public let keyProps: [String: String]
    public let snippet: String
}
public enum AnimationCategory: String, Sendable, Codable, CaseIterable, Hashable {
    case text, cards, buttons, backgrounds, navigation
}
public struct AnimationCatalog: Sendable {
    public let entries: [AnimationCatalogEntry]
    public static func load(templateDirectory: URL) throws -> AnimationCatalog
    public func entries(in category: AnimationCategory) -> [AnimationCatalogEntry]
    /// integrations/animations-demos/<component>.html under the same template root.
    public static func demoURL(templateDirectory: URL, component: String) -> URL
}
```

  Keep it Foundation-only (the Linux CI lane builds AnglesiteCore — no Darwin-only APIs).

- [ ] **Step 1: Write the failing tests** `Tests/AnglesiteCoreTests/AnimationCatalogTests.swift` (Swift Testing, resolve the real template via `AnglesiteTestSupport.templateRoot()` like `IntegrationTemplateAssetsTests`):

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct AnimationCatalogTests {
    @Test func loadsRealTemplateCatalog() throws {
        let catalog = try AnimationCatalog.load(templateDirectory: try templateRoot())
        #expect(!catalog.entries.isEmpty)
        for entry in catalog.entries {
            #expect(!entry.snippet.contains("enhance={true}"))
            let demo = AnimationCatalog.demoURL(
                templateDirectory: try templateRoot(), component: entry.component)
            #expect(FileManager.default.fileExists(atPath: demo.path), "\(entry.component)")
        }
    }

    @Test func groupsByCategory() throws {
        let catalog = try AnimationCatalog.load(templateDirectory: try templateRoot())
        let grouped = AnimationCategory.allCases.flatMap { catalog.entries(in: $0) }
        #expect(grouped.count == catalog.entries.count)
    }
}
```

- [x] **Step 2: Run to verify failure.** `swift test --filter AnimationCatalogTests` → FAIL (type not defined).
- [x] **Step 3: Implement `AnimationCatalog.swift`** — decode a private `ManifestFile { version: Int; components: [AnimationCatalogEntry] }` from `templateDirectory/integrations/animations.json`; `demoURL` appends `integrations/animations-demos/\(component).html`.
- [x] **Step 4: Run to verify pass.** `swift test --filter AnimationCatalogTests` → PASS.
- [x] **Step 5: Commit** — `feat(core): AnimationCatalog model for template catalog (#<ISSUE_B>)`.

### Task 6: Gallery sheet + Website menu item

**Files:**
- Create: `Sources/AnglesiteApp/AnimationsGalleryView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (add `animationsPresented` state + `presentAnimations()` + `canOpenAnimations`, following the `presentReader()` pattern near line 289)
- Modify: `Sources/AnglesiteApp/SiteWindow.swift` (add `.sheet(isPresented: $bindableModel.animationsPresented)` beside the existing sheets ~line 541)
- Modify: `Sources/AnglesiteApp/WebsiteCommands.swift` (add `Button("Animations…") { model?.presentAnimations() }` next to `"Add Integration…"`, line ~76)

**Interfaces:**
- Consumes: `AnimationCatalog.load(templateDirectory:)`, `entries(in:)`, `demoURL(templateDirectory:component:)`, `TemplateRuntime` (existing) for resolving the bundled template root.

- [ ] **Step 1: Implement `AnimationsGalleryView`** — `NavigationSplitView` (sidebar: sections per `AnimationCategory` with entry titles; detail: `ownerDescription`, key-props table, `WKWebView` via `NSViewRepresentable` loading `demoURL` with `loadFileURL(_:allowingReadAccessTo: templateRoot)`, and a **Copy Snippet** button writing `entry.snippet` to `NSPasteboard.general`). Model state (selected entry, catalog load-or-error) in a small `@Observable AnimationsGalleryModel` in the same file; catalog load errors render as a plain error view, never a crash.
- [ ] **Step 2: Wire model + sheet + menu** per the Files list; the menu button is `.disabled` when no site window is active (`canOpenAnimations`, same shape as `canOpenSocialPlan`).
- [ ] **Step 3: Build the app** — `xcodegen generate && xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` → succeeds.
- [ ] **Step 4: Sync the String Catalog** (new user-visible strings) with the CONTRIBUTING.md recipe, scoped to this worktree's DerivedData (match `WorkspacePath`); review + include the `.xcstrings` diff.
- [ ] **Step 5: Verify in the running app** — launch the built app, open a site, Website ▸ Animations…, confirm a demo animates and Copy Snippet fills the pasteboard (beware duplicate installed-copy instances per repo memory).
- [ ] **Step 6: Full test + commit + PR B** — `swift test --package-path .`; commit `feat(app): Animations gallery for template components (#<ISSUE_B>)`; open PR B **based on the WS1 branch** (stacked; note in body: retarget to `main` after PR A merges — a bare retarget doesn't trigger CI, push a real commit or rebase+force-push per repo memory). PR body from the template's exact headings; note "Add with assistant" follow-up. Remove the In Progress label from Issue B.

---

## Workstream 3 — Sidecar skill + ADR (sidecar repo, Issue C)

### Task 7: Extend ADR-0008's npm carve-out

**Files:**
- Modify: `docs/decisions/0008-no-third-party-javascript.md` (sidecar checkout `~/Developer/github.com/Anglesite/anglesite`, in a fresh worktree/branch)

- [x] **Step 1: Append to the "Creative coding libraries (not third-party)" section:** *(done in Anglesite/anglesite#427)*

```markdown
The same reasoning covers npm-installed **animation component libraries**. The
Anglesite site template ships `@astroanimate/core` (exact-pinned) as a default
dependency: its components are CSS-first, rendered at build time, and served
first-party under `script-src 'self'`. One constraint applies: the library's
`enhance` prop emits inline `<script>` tags, which the template CSP blocks
(no `'unsafe-inline'`, no hashes) — so only CSS-only usage (`enhance` unset or
`false`) is supported. The curated list lives in the site's
`integrations/docs/animations.md`.
```

- [x] **Step 2: Commit** — `docs(adr): cover animation component libraries in ADR-0008 (#<ISSUE_C>)`. *(done in Anglesite/anglesite#427)*

### Task 8: `/animate` skill escalation section

**Files:**
- Modify: `skills/animate/SKILL.md`
- Modify: `agent-skills/animate/…` — inspect this directory first; if it duplicates the same rule text, apply the same edit there.

- [x] **Step 1: Replace the absolute prohibition.** *(done in Anglesite/anglesite#427)* The current text: "**Never use JavaScript for animation.**" and the ADR list entry "no JavaScript animation libraries" stay, but gain the escalation carve-out. After the "Your CSS toolkit" section, add:

```markdown
## Escalation: the baked-in component library

The site template ships `@astroanimate/core` (see `integrations/docs/animations.md`
in the site for the curated list). Vanilla CSS remains your default craft. Reach for
a library component only when it beats hand-written CSS for the request — marquees,
typewriter/staggered text, card-stack effects, loaders — and then:

- Use only components listed in `integrations/docs/animations.md`, with the exact
  import style shown there (`import X from "@astroanimate/core/X"`).
- **Never set `enhance={true}`** — it emits inline scripts the site's CSP blocks in
  production. CSS-only mode is the supported mode.
- The reduced-motion rule still applies: library components carry their own
  `prefers-reduced-motion` guard; your surrounding CSS keeps its own.
- Preview-before-apply still applies. For library components, preview on a draft
  page via the dev server (the static `_animation-preview.html` flow can't render
  `.astro` components).
```

- [x] **Step 2: Reconcile the ADR reference list** in the same file: change "no JavaScript animation libraries" to "no JavaScript animation *runtimes*; the baked-in CSS-first component library is the recorded exception (ADR-0008)".
- [x] **Step 3: Commit + PR C** in the sidecar repo *(Anglesite/anglesite#427)* — `feat(animate): escalate to baked-in @astroanimate components (#<ISSUE_C>)`. The sidecar has no PR template; use Summary / Test plan and link the app-repo spec. Note ordering: merge after app PR A.

---

## Self-review notes

- Spec coverage: dependency+override (T1), manifest+curation gate (T2), demos+docs (T3), guards+re-vendor (T4), Swift model (T5), gallery+menu (T6), ADR (T7), skill (T8). "Add with assistant" is spec-deferred (follow-up in Issue B). Sub-package adoption is a spec non-goal.
- The Astro Container API import of catalog entries uses the package export map verified against the published tarball (0.1.2).
- Type names consistent: `AnimationCatalog`, `AnimationCatalogEntry`, `AnimationCategory` across T5/T6.
