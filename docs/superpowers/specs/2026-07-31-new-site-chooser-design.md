# New Site window redesign: template chooser only (#1071)

**Status:** Approved design, not yet implemented.
**Issue:** [#1071](https://github.com/Anglesite/Anglesite/issues/1071)
**Supersedes the flow shipped from:** `docs/superpowers/specs/2026-05-29-new-site-onboarding-design.md`

## Problem

The current new-site wizard asks six steps' worth of questions before the owner
ever sees their site: name + domain (buy/transfer/later), site type, color
scheme, headline/blurb/hero image, and a save panel. Almost none of that is
needed to show a preview. The domain answer in particular is pure deploy-time
configuration — its only consumers (`CustomDomainAttachCommand`,
`DeployCoordinator`) run *after* a successful deploy and already treat
"set up later" as a clean skip.

The model to follow is iWork: Pages asks exactly one question — which template —
then opens the document untitled, auto-saved, full of editable placeholder
content. Everything else happens later, and publish-time concerns (DNS,
license, tokens) gate publish, not creation.

## Goals

- One pre-preview question: pick a template.
- Site opens in the live preview seconds after the choice, named "Untitled",
  saved to the default location without a panel.
- Deploy-time configuration (domain, tokens, license) stays where it already
  lives: at publish.

## Non-goals

- Porting third-party Astro themes into the chassis (follow-up epic; see
  Follow-ups).
- A category sidebar in the chooser (arrives with the ported-themes epic).
- A publish-time "connect a domain" step (follow-up issue).
- Changing the deploy path, token onboarding, pre-deploy gate, or licensing UI.

## Design

### 1. Flow

Add Site / File ▸ New ▸ Site / Dock menu all open a single **template
chooser** (Pages-style): a flat grid of the 8 built-in themes
(`Resources/Template/scripts/themes.json`) rendered as preview cards, with the
catalog's first theme pre-selected (deterministic — no site type exists to
drive the per-type default table). Double-click a card, or select + **Create** →
the chooser dismisses, scaffolding runs (existing Building progress UI —
feedback, not a question), and the site window opens on the live preview.

Removed entirely from onboarding: website name, domain choice, site type,
headline/blurb/hero-image, and the save panel.

### 2. Naming and save

- The package is created as `Untitled.anglesite` (collision-suffixed
  `Untitled 2.anglesite`, …) directly in the default save location — the
  iCloud Drive "Anglesite" folder (#865), `~/Sites` fallback.
- Rename later via the existing launcher/window affordances (Mac document
  convention). Slug and `CF_PROJECT_NAME` derive from the name as today;
  worker-name collisions at deploy are already handled by the
  rename-and-retry sheet (`WorkerNameRename`).

### 3. Content

No content questions. The template ships with good placeholder content — the
template *is* the content prompt — and the owner edits it in the live preview.
`HomepageWriter`'s wizard-driven customization is bypassed in this flow; it
remains available to intents/AI paths that supply real content.

### 4. Deferral to publish

- `.site-config` gets `DOMAIN_CHOICE=later` — the value the deploy path
  already treats as a no-op skip. No `SITE_TYPE` is written (the AI features
  that want a business type — design interview, brand voice — already handle
  its absence by asking when needed).
- First publish goes to `<slug>.workers.dev` exactly as today. Unchanged
  deferred gates: Cloudflare/GitHub token prompts at first deploy/publish,
  the un-bypassable `pre-deploy-check.ts` security gate, licensing in site
  settings.

### 5. Code shape

- `Sources/AnglesiteCore/NewSiteWizardModel.swift`: `Step` collapses to
  `chooser → building`. Details/Type/Content/Save steps, their validation,
  and their state go away.
- `Sources/AnglesiteCore/NewSiteDraft.swift`: `SiteType` stays (intents/AI
  still use it) but defaults to blank/none for this flow; domain and content
  fields are no longer populated by the wizard.
- `Sources/AnglesiteApp/NewSiteWizard.swift`: becomes the chooser view. Theme
  cards upgrade from color swatches to static rendered thumbnails generated
  from the theme palette (no dev server involved).
- Entry points (`SitesLauncherView`, `FocusedSite`, Dock menu,
  `WindowRouter`), the `SiteScaffolder` pipeline, and `.site-config` writing
  survive with fewer inputs. Untitled-name collision suffixing lands beside
  the existing slug-collision logic.

### 6. Testing

- Model tests: collapsed step machine, Untitled collision-suffix naming,
  `.site-config` output (`DOMAIN_CHOICE=later`, no `SITE_TYPE`).
- Update `docs/qa/e2e-acceptance-2-new-website.md` to the new flow.
- `swift test --package-path .` and the app build per `CONTRIBUTING.md`
  (template untouched, but wizard strings change — sync the String Catalog).

## Follow-ups (new issues, not in #1071)

1. **Ported-themes epic** — curate MIT-licensed Astro themes (from the
   astro.build catalog ecosystem) and port each into the existing template
   chassis as layout/component/style packs (one dependency tree, same
   scripts/`.site-config`/writer structure). Adds the category sidebar
   (Business, Personal, Blog, Portfolio, Organization, Blank) and records
   site type from category choice. Decision log: live-catalog scaffolding
   and sibling-template vendoring were rejected — unreviewed dependency
   trees and broken structural assumptions (`HomepageWriter`,
   `ThemeApplier`, edit overlay, template-coupled tests).
2. **Publish-time domain step** — a first-publish "connect a domain
   (buy/transfer/later)" affordance, replacing the question onboarding no
   longer asks.
3. **`ThemeApplyWizard` entry point** — the shipped freedesignmd/built-in
   theme wizard is currently unreachable from the UI; wire it into the
   Website menu so post-create restyling is discoverable.
