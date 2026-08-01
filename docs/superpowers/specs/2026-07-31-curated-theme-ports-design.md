# Curated Astro theme ports for the template chooser (#1179)

**Status:** Approved design, not yet implemented.
**Issue:** [#1179](https://github.com/Anglesite/Anglesite/issues/1179) (epic)
**Builds on:** `2026-07-31-new-site-chooser-design.md` (#1071, shipped in PR #1183)

## Problem

The template chooser shipped by #1071 offers eight built-in themes that are
pure CSS-variable palettes over one chassis — every choice is the same site in
different colors. Owners choosing a template expect genuinely different
*designs*: different layouts, typography, and personality, organized by what
kind of site they're making.

The #1071 decision log already rejected the two easy ways to get variety:

- **Live astro.build catalog scaffolding** — unreviewed third-party dependency
  trees executing at create time.
- **Sibling-template vendoring** — whole foreign templates break every
  structural assumption the app relies on (`HomepageWriter` sentinels, marker
  anchors, `ThemeApplier`, the edit overlay, template-coupled tests).

## Goals

- Curate MIT-licensed Astro themes and port each into the existing template
  chassis as a **layout/component/style pack**: one dependency tree, same
  `scripts/`/`.site-config`/writer structure.
- Add the chooser's **category sidebar** (Business, Personal, Blog, Portfolio,
  Organization, Blank) and record site type from the category choice.
- Ports are **adaptations, not replicas**: capture the original's layout,
  typography, and personality rebuilt on the chassis's vanilla-CSS token
  system, credited as inspiration. No upstream tracking.

## Non-goals

- Switching packs on an existing site (create-time only; color themes remain
  switchable via the existing CSS-var machinery). The pack format doesn't
  preclude a later re-apply feature, but nothing in this epic builds it.
- New runtime dependencies (Tailwind, React, webfont pipelines). Packs ride
  the chassis's existing dependency tree.
- Extending packs to the intents/AI surface (`ApplyThemeIntent`,
  `SetupThemeTool` keep operating on CSS-var themes).
- Wiring up `ThemeApplyWizard` (separate follow-up from #1071).

## Design

### 1. Pack format

A pack lives at `Resources/Template/packs/<id>/` and mirrors the site `src/`
tree, containing only the files it overrides or adds:

```
packs/<id>/
  LICENSE              # original theme's MIT license text
  thumbnail.png        # rendered preview, committed at port time
  src/
    styles/global.css  # full replacement, all 12 base vars declared
    layouts/BaseLayout.astro
    components/…       # flat, no subdirectories
    pages/index.astro  # keeps HomepageWriter sentinels
    …
```

`scripts/themes.json` remains the single catalog. Entries gain optional
fields; entries without `pack` are the existing CSS-var themes:

- `category` — `business | personal | blog | portfolio | organization`.
  Optional: entries without one (the existing eight CSS-var themes) appear
  under **Blank**, which is the base chassis in different palettes. Pack
  entries must declare a category. `bestFor` is unchanged.
- `pack` — pack directory name under `packs/`.
- `thumbnail` — path to the committed PNG (pack entries only).
- `credit` — `{ "name", "url", "license" }` for attribution.

Swift's `ThemeCatalog` decodes the new fields into `Theme` (and finally stops
dropping `bestFor`'s sibling metadata on the floor).

### 2. The port contract

What makes an adaptation safe inside the chassis. Enforced by a template lint
script (`scripts/check-pack.ts`, run in template tests/CI) plus the existing
Swift drift guards extended over each pack:

1. **Marker anchors** — all five present in the three exactly-named files:
   `// anglesite:imports`, `<!-- anglesite:head-end -->`,
   `<!-- anglesite:nav -->`, `<!-- anglesite:body-end -->` in
   `src/layouts/BaseLayout.astro`; `// anglesite:imports`,
   `<!-- anglesite:hero-cta -->` in `src/pages/index.astro`;
   `// anglesite:imports` in `src/layouts/BlogPost.astro` (when overridden).
   ~20 integration injection sites depend on these.
2. **HomepageWriter sentinels** — the four literal strings (title,
   description, `<h1>Welcome</h1>`, intro `<p>`) byte-for-byte in
   `src/pages/index.astro`. Placeholder-copy freedom lives elsewhere on the
   page. (Making `HomepageWriter` marker-based instead of sentinel-based is a
   candidate future cleanup, not part of this epic.)
3. **Flat component dirs** — components in `src/components/`, layouts in
   `src/layouts/`, no subdirectories (component-canvas resolver assumption in
   `scripts/component-harness.ts`).
4. **Semantic HTML** — navigation inside `<nav>`, real heading/paragraph tags;
   the edit overlay is tag- and role-based.
5. **Token system** — `global.css` declares all 12 base custom properties in
   `:root`; pack-specific extras are allowed (prefixed freely, they're
   pack-internal).
6. **License** — original is MIT; `LICENSE` committed in the pack dir and
   `credit` recorded in the catalog entry.

### 3. Scaffold pipeline

New `SiteScaffolder` step after `.copyingTemplate`: when the chosen theme has
a `pack`, copy the pack's `src/` overlay over the scaffolded `Source/`
(FileManager, file-by-file replace). Non-fatal on failure — degrades to a
`.warning` like the theme step, leaving a working base-chassis site.

`ThemeApplier` still runs afterward: pack entries carry `cssVars` matching
their baked-in palette, so the rewrite is a no-op reaffirmation and the
swatch/intents surfaces stay uniform.

`.site-config` changes: `SITE_TYPE=<category>` is recorded from the chooser's
category selection (Blank records none, preserving current behavior). The
`SiteScaffolderTests` guard asserting `SITE_TYPE` is absent in the chooser
flow is deliberately inverted. `THEME=<id>` stays write-only; `packs/` is
excluded from the scaffold copy the same way `scripts/themes.json` already is.

### 4. Chooser UI

- **Sidebar** — the six categories, sourced from the existing `SiteType` enum
  (labels + SF Symbols already defined, currently unwired). Blank shows the
  base chassis with its eight CSS-var themes.
- **Filtering** — the grid shows themes whose `category` matches (no
  `category` = Blank); selecting a category records the corresponding
  `SiteType` on the draft.
- **Pre-selection** — the chooser opens on Blank with the catalog's first
  theme pre-selected (today's behavior). Switching categories pre-selects
  via `ThemeCatalog.defaultThemeID(for:)`, updated to point at each
  category's flagship pack as ports land, falling back to the first theme
  in the filtered list.
- **Cards** — pack entries render their committed `thumbnail.png` (layout is
  the point of a port; the synthesized two-color mock can't show it).
  CSS-var themes keep the synthesized card.

### 5. Curation

First slice produces `docs/theme-curation.md`: criteria plus a surveyed
shortlist from the astro.build catalog ecosystem for owner sign-off, roughly
one theme per category (Blank is the existing chassis). Criteria:

- MIT license (verifiable in the source repo).
- Adaptation feasibility: semantic HTML skeleton, layout expressible in
  vanilla CSS without its framework (Tailwind/React originals qualify if the
  *design* ports cleanly; the code doesn't come along).
- Category fit and distinctiveness from the existing eight palettes.
- No content-model conflicts with the chassis's collections.

### 6. Slices (sub-issues under the epic)

1. **Curation criteria + shortlist** — docs-only; owner approves the
   shortlist before any port starts.
2. **Pack mechanism** — catalog schema fields, scaffolder overlay step,
   `check-pack.ts` lint + Swift tests, `SITE_TYPE` recording. Proven with a
   test fixture pack; ships no real ports.
3. **Chooser sidebar** — category filter, `SiteType` recording, thumbnail
   cards, per-category pre-selection.
4. **Theme ports** — one issue per approved theme (~5): adaptation,
   thumbnail, contract lint green, template-coupled `swift test` green.
5. **QA/docs mop-up** — `docs/qa/e2e-acceptance-2-new-website.md`,
   build-plan snapshot.

Slices 2 and 3 are independent after 1 and can run in parallel; port issues
fan out once 2 and 3 land.

### 7. Testing

- **Swift** — catalog decode of new fields; overlay copy (fixture pack);
  `SITE_TYPE` written from category / absent for Blank (inverting the #1183
  guard); chooser-model category filtering and pre-selection.
- **Template** — `check-pack.ts` validates every pack against the port
  contract (markers, sentinels, flat dirs, 12 vars, LICENSE); update
  `themes.test.ts`'s hardcoded `EXPECTED_IDS`; a test loop that runs
  `astro build` on the chassis with each pack overlaid, so a broken port
  cannot land.
- **Per CONTRIBUTING** — template edits require `swift test --package-path .`
  (template-coupled suites), the app build, and String Catalog sync for any
  chooser string changes.

## Decision log

- **Scaffold-time overlay** over runtime-switchable packs: `THEME` stays
  write-only, no new read path into scaffolded sites, no pack bloat in every
  site tree. Post-create pack switching is out of scope (rejected: shipping
  all packs in every site; deferred: re-apply via `ThemeApplyWizard`).
- **Adaptation over faithful port / vanilla-only curation**: per-theme cost
  stays bounded, the port contract stays enforceable, and the candidate pool
  stays large.
- **Committed thumbnails** over synthesized cards for packs: a two-color mock
  cannot represent layout, which is the differentiator being added.
- Reaffirmed from #1071: no live-catalog scaffolding, no sibling-template
  vendoring.
