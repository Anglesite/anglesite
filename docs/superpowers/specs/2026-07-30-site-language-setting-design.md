# Site language setting — design

Issue: [#956](https://github.com/Anglesite/Anglesite/issues/956)
Status: implemented

## Problem statement

`Resources/Template/src/layouts/BaseLayout.astro` hardcodes `<html lang="en">`. There is no
language/locale key anywhere in site config, so every site Anglesite generates declares English
regardless of the content the owner actually writes. This fails WCAG 2.2 SC 3.1.1 ("Language of
Page", Level A) outright for any non-English site, mis-signals language to consumers of the
site's ActivityPub/mf2 content, and caps the product at English-language users.

## Goals

- A site-wide default language, auto-detected from the host's system locale at scaffold time, no
  wizard prompt required.
- Editable after scaffold from the app's existing per-site settings surface (`PlistEditorView`,
  the "Website" tab — internally named the "Plist Editor," user-facing as site "Settings").
- A per-page override for content-collection entries, blog posts, and plain frontmatter pages,
  so a multilingual site can mark individual entries as a different language than the site
  default.
- `<html lang>` (and any other layout that emits it) reflects the effective language: the page's
  own override if set, otherwise the site default.

## Non-goals

- True i18n routing (localized route trees, `hreflang` alternates, a language switcher). That is
  the `anglesite:i18n` skill's territory — a separate, larger feature. This design only fixes the
  single `<html lang>` attribute's correctness.
- Per-element language override UI. This already works today with zero new code: the generic
  attribute editor in `ComponentMetadataInspectorPane` (Sources/AnglesiteApp/ComponentMetadataInspectorPane.swift)
  lets an owner add any attribute — including `lang="fr"` — to any selected element. Noted here so
  it isn't rebuilt or forgotten.
- Deeper federation-format propagation (ActivityPub `Note`/mf2 `h-entry` consumers reading a
  per-entry language explicitly beyond what the rendered HTML already conveys). Follow-up
  candidate, not required to close #956.
- BCP 47 tag validation is soft (a warning), never a hard block — same posture as other
  free-text settings fields in this editor (e.g. custom analytics HTML).

## Architecture

```
SiteScaffolder.appendSiteConfig ──(scaffold, once)──► Source/.site-config: SITE_LANG=<bcp47>
                                                                │
PlistEditorView "Website" tab ◄──(read/write)──► SiteLanguageAsset (parseSettings/install)
                                                                │
                                                src/lib/localization.ts: siteLang()
                                                                │
                                        BaseLayout.astro: <html lang={lang ?? siteLang()}>
                                                                ▲
                                Hentry / Hreview / Hevent / BlogPost pass lang={d.lang} when set
                                                                ▲
                                content.config.ts schemas: lang (optional, per collection)
                                                                ▲
        TypedEntryForm (ContentTypeRegistry .language field) / PageMetadataForm (LanguageSettingsSection)
                            — per-page override UI in the app, both write frontmatter
```

### Config storage: `SITE_LANG`

`.site-config` (flat `KEY=value`, git-tracked, template-owned — see `Sources/AnglesiteCore/SiteConfigFile.swift`)
gets a new key, `SITE_LANG`, following the existing `SITE_NAME`/`SITE_TYPE`/`THEME` convention.
This is deliberately **not** `SiteConfigStore`/`Config/settings.plist` — that store is app-owned,
gitignored, machine-local state (chat history, provisioned Cloudflare resource ids). A page's
`<html lang>` is public site content: it must survive `git clone`, render correctly from a plain
`astro build` with Anglesite never installed, and be editable in VS Code. `.site-config` is where
every other piece of "public site metadata" (`SITE_NAME`, `TAGLINE`, `THEME`) already lives.

Absent `SITE_LANG` (a pre-existing site scaffolded before this feature, or a hand-authored one)
reads as `"en"` — the same value the hardcoded attribute already produced, so no existing site's
rendered output changes without an explicit edit.

### Scaffold-time default

`SiteScaffolder.appendSiteConfig` (Sources/AnglesiteCore/SiteScaffolder.swift) gains one more
entry in its `values` array: a BCP-47 tag derived from `Locale.current` (language + region where
available, e.g. `en-US`). `appendSiteConfigValues`'s existing idempotent-append guard
(`setKey` skips a key that's already present) means this is safe to call even if a future flow
re-runs scaffold-adjacent code — it never overwrites an owner's explicit choice. No new wizard
step; per the issue's own follow-up comment, the default is silent, and the owner changes it in
Settings if desired.

### `SiteLanguageAsset`

New type in `AnglesiteCore`, following the exact shape of `MTAStsPolicyAsset`/`SecurityReportingAsset`:

```swift
public enum SiteLanguageAsset {
    public struct Settings: Sendable, Codable, Equatable {
        public var lang: String  // BCP 47 tag; "en" default when absent from config
    }
    public static func parseSettings(from config: String) -> Settings
    public static func install(_ settings: Settings, siteDirectory: URL) throws
}
```

`parseSettings` reads `SITE_LANG` via `SiteConfigFile.value(forKey:in:)`; `install` upserts it via
`SiteConfigFile.upsert`, same as the existing assets.

### Astro: `siteLang()`

New `Resources/Template/src/lib/localization.ts`, mirroring `licensing-data.ts`'s `siteLicense()`:

```ts
export function siteLang(): string {
  return readConfig("SITE_LANG") ?? "en";
}
```

`BaseLayout.astro` gains an optional prop:

```ts
interface Props {
  // ...existing fields
  lang?: string;
}
```

```html
<html lang={Astro.props.lang ?? siteLang()}>
```

### Per-page override — content-collection entries

`lang: z.string().optional()` is added literally (not via the `...socialFields` spread — see
"Why a literal field, not a spread" below) to every collection in `ENTRY_COLLECTIONS`
(`Resources/Template/src/lib/collections.ts` — the eight `HENTRY_COLLECTIONS` sharing
`Hentry.astro` via the generic `[collection]/[...slug].astro` route, plus `events` and `reviews`,
which have their own layouts): `blog`, `photos`, `albums`, `bookmarks`, `replies`, `likes`,
`announcements` (in `content.config.ts`), `notesSchema`/`articlesSchema` (in
`src/lib/content-schemas.ts`), and `events`/`reviews`. Every member of `ENTRY_COLLECTIONS` renders
a full page with its own `<html>` through `Hentry.astro`, `Hreview.astro`, or `Hevent.astro`, so
every one gets the override field — including `likes`, whose content is as minimal as
`bookmarks`' (a URL) but is a real page like any other entry.

Each corresponding layout passes the override through:

- `Hentry.astro`: add `lang?: string` to `HentryFields`, pass `lang={d.lang}` to `<BaseLayout>`.
- `Hreview.astro`, `Hevent.astro`: same, reading `d.lang` directly (untyped `entry.data`).
- `BlogPost.astro`: add `lang?: string` to its `Props` (it takes named props, not `entry.data`
  directly), threaded from `src/pages/blog/[...slug].astro` where the entry is unpacked.

#### Why a literal field, not a spread

`socialFields` (`content-schemas.ts`) is spread into every schema (`...socialFields`), which is
where POSSE/syndication fields live. `lang` doesn't belong there semantically, and — concretely —
`Sources/AnglesiteCore/FrontmatterSchemaReader.swift`'s text-scan only recognizes literal
`key: z....` lines inside a schema's `z.object({...})` body; a spread's inner keys are invisible
to it. `FrontmatterSchemaReader` only feeds the AI style-guide feature today, not the native
inspector, but there's no reason to introduce that blind spot for a WCAG-motivated field. Writing
`lang: z.string().optional(),` directly in each schema (matching how `draft`/`audience` are
already repeated per-schema, not spread) keeps it visible to every current and future consumer of
the schema text.

### Per-page override — native inspector UI

The typed-entry inspector (`TypedEntryForm`) is driven by `Sources/AnglesiteCore/ContentTypeRegistry.swift`'s
hand-maintained `ContentTypeDescriptor.fields` — **not** dynamically derived from the Zod schema
(that would be `FrontmatterSchemaReader`, which is unrelated — see above). A new `Kind.language`
case is added to `ContentTypeField.Kind`, and a `ContentTypeField("lang", .language)` entry is
added to every descriptor whose `storage` is one of `ENTRY_COLLECTIONS`: `note`, `article`,
`photo`, `album`, `bookmark`, `reply`, `like`, `announcement`, `event`, and `review` — i.e. every
descriptor with a rendered `<html>`-producing layout. `businessProfile`/`personalProfile`/`resume`/
`member` are excluded — they aren't in `ENTRY_COLLECTIONS` and don't necessarily render their own
full page the same way.

`TypedEntryForm.control(for:)` renders `.language` fields with the same `LanguagePicker` component
described below, bound through the model's existing `textBinding(field.name)` (empty string =
unset = inherits the site default, the same idiom already used for
`analyticsSettings.cloudflareToken`/`cloudflareAnalyticsEnabled`).

Blog posts and plain frontmatter pages don't go through `ContentTypeRegistry` (`BlogPost.astro`
takes fixed props; there is no blog `ContentTypeDescriptor`). Both get a language override through
a new shared `LanguageSettingsSection` (Sources/AnglesiteApp/, mirroring the shape of the existing
`RobotsSettingsSection`) composed into `PageMetadataForm` next to the existing
"Search & Crawling" section, backed by `PageMetadataModel`'s frontmatter read/write. Blog posts
route through `PageMetadataModel` today (their frontmatter is title/description/pubDate/draft/
syndication, not a typed descriptor), so this one section change covers both.

### `LanguagePicker` — shared control

One SwiftUI view, used in three places (Website tab, typed-entry `.language` fields,
`LanguageSettingsSection`):

- A `Picker` over a curated list of common web languages: English, Spanish, French, German,
  Italian, Portuguese, Japanese, Chinese, Korean, Arabic, Russian, Hindi, Dutch, Polish, Swedish
  (their BCP-47 subtags: en, es, fr, de, it, pt, ja, zh, ko, ar, ru, hi, nl, pl, sv), plus
  "Other…".
- Selecting "Other…" reveals a freeform `TextField` for any BCP-47 tag, with a soft (non-blocking)
  validation message if it doesn't look like a plausible tag (basic shape check, not a full BCP-47
  grammar — mirrors how the custom-analytics-HTML field warns without blocking save).
- Two call-site variants: the Website tab always has a value (the site default itself, no
  "inherit" state). The per-page call sites (`TypedEntryForm`, `LanguageSettingsSection`) add a
  leading "Use site default (<current default>)" menu entry, which maps to an empty string in the
  bound frontmatter field (key omitted on save) — the same empty-string-means-unset idiom
  `PlistEditorModel` already uses elsewhere.

### Settings UI (Website tab)

`PlistEditorView`'s "Website" tab (`websiteTab`) gets a new "Language" `GridRow` in the existing
"Site Details" box, next to Title and Icons, using `LanguagePicker` bound to
`PlistEditorModel.langSettings.lang`.

`PlistEditorModel` gains: `langSettings`/`savedLangSettings: SiteLanguageAsset.Settings`,
`isLangDirty`, `saveLang()` (loads/writes via `SiteLanguageAsset`), and a new entry in the private
`dirtyFacets` array — the existing aggregate save-on-tab-switch/⌘S mechanism (#741) picks it up
automatically, no other model/view changes needed.

## Data flow walkthrough

1. Owner creates a new site on a French-locale Mac. `SiteScaffolder` writes `SITE_LANG=fr` (or
   `fr-FR`) into `.site-config` alongside `SITE_NAME`/`THEME`. Every page's `<html lang="fr">`
   from the first build, no owner action required.
2. Owner opens Settings ▸ Website, sees Language set to French, leaves it — or changes it to
   English via the picker, clicks away (auto-save via the existing dirty-facet flow), which
   rewrites `SITE_LANG=en`.
3. Owner writes one blog post in English on their otherwise-French site. In the post's inspector,
   they set Language to "English," which writes `lang: en` into that post's frontmatter. That
   post's `<html lang="en">`; every other page still reads the site default.
4. Owner selects a specific `<span>` inside a component and wants a `de` override on just that
   element — no site feature needed; they add a `lang` attribute directly via the existing
   component attribute editor.

## Error handling

- `SiteLanguageAsset.parseSettings` never throws — a missing/malformed `SITE_LANG` value (or key)
  yields the `"en"` default, matching the tolerance every other `.site-config`-backed asset in
  this file already has (`parseSettings(from:)` reading absent keys as sane defaults).
- The picker's "Other…" validation is advisory only (a warning banner, non-blocking), consistent
  with `customAnalyticsValidationMessage`'s posture elsewhere in the same editor — an owner who
  knows a valid tag the curated regex doesn't recognize is never blocked from saving it.
- A save failure (disk/permission error) surfaces through each model's existing error-string path
  (`PlistEditorModel.loadError`/`analyticsError`-style fields; `PageMetadataModel`'s existing save
  error handling) — no new error UI.

## Testing plan

- `SiteLanguageAssetTests` (Swift): `parseSettings` tolerance (missing key, malformed file),
  `install` upsert round-trip, idempotent re-install.
- `SiteScaffolder` tests: scaffolding a new site writes a `SITE_LANG` value; re-running
  scaffold-adjacent config append never overwrites an existing value.
- `PlistEditorModel` tests: loading reflects existing `SITE_LANG`; `isLangDirty` reacts to picker
  changes; save writes back through `SiteLanguageAsset`.
- `ContentTypeRegistry`/`TypedEntryEditorModel` tests: `.language` field round-trips through
  `textBinding`; empty string omits the frontmatter key on save.
- TS unit tests (`localization.test.ts`, mirroring `licensing.test.ts`): `siteLang()` default and
  override-from-config behavior.
- Template-level: per `CONTRIBUTING.md`, run `swift test --filter` after touching
  `BaseLayout.astro` — this repo's Swift tests couple to template markup.
- Manual/E2E: scaffold a site on a non-English-locale test account (or force the derived tag),
  confirm `<html lang>` on the homepage; set a per-page override, confirm that page's `<html lang>`
  differs from the homepage's; confirm an untouched pre-existing fixture site (no `SITE_LANG` key)
  still renders `<html lang="en">` exactly as before.

## Known limitations / follow-ups

- **No BCP-47 grammar validation.** The soft check is a shape heuristic, not a real BCP-47
  parser/validator. An owner can save a nonsensical tag; browsers/screen readers degrade
  gracefully (treat it as unrecognized), same as any hand-authored `lang` attribute on the web
  today.
- **Curated language list is a fixed, hardcoded set of 15.** No mechanism to extend it besides a
  code change; "Other…" is the escape hatch. Revisit if usage data suggests the list is wrong.
- **No i18n routing.** This design only makes the `lang` attribute correct; it does not localize
  URLs, add `hreflang` alternates, or provide a language switcher. That's the separate,
  larger `anglesite:i18n` skill/feature.
- **`businessProfile`/`personalProfile`/`resume`/`member` get no override field.** They aren't
  routed through `ENTRY_COLLECTIONS`'s per-entry-page layouts the same way, so this design doesn't
  give them a `lang` override; revisit if one of them turns out to render its own full page.
