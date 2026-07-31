# Per-Page Language Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-page `lang` override — for every content-collection entry type, blog posts, and plain frontmatter pages — on top of the site-wide default language PR #1174 already merged (issue #956).

**Architecture:** #1174 already ships `SiteLanguageAsset` (`.site-config`'s `LANG` key), `siteLang()` (`Resources/Template/scripts/config.ts`), and a plain-`TextField` site-wide language setting in `PlistEditorView`'s Website tab — none of that is touched here. This plan adds: an optional `lang` prop to `BaseLayout.astro` (currently unconditional `<html lang={siteLang()}>`); an optional `lang` frontmatter field on every `ENTRY_COLLECTIONS` schema, threaded through each entry layout; a new `ContentTypeField.Kind.language` case + `ContentTypeRegistry` field additions; a shared `LanguagePicker` SwiftUI control (curated list + "Other…" + "Use site default") used by the typed-entry inspector and a new `LanguageSettingsSection` for blog/plain pages.

**Tech Stack:** Swift 6.4 (AnglesiteCore, AnglesiteApp/AnglesiteAppCore), SwiftUI, Astro/TypeScript (Resources/Template), Zod, Swift Testing, `node:test`.

## Global Constraints

- Issue #956 is CLOSED (merged via #1174). This is standalone follow-up work — do not reference `#956` in commit subjects; use no issue number, or open a fresh tracking issue if the repo convention wants one (check with the user before opening a new GH issue — do not do it unilaterally).
- Base branch for this work is `origin/main` as of commit `26bb903e`, which already includes #1174. **Do not** recreate `SiteLanguageAsset`, `siteLang()`/`resolveLang()`, or the Website tab's Language `TextField` — they already exist and must not be touched by this plan except where a task explicitly says to read (not modify) them.
- `SiteLanguageAsset`'s config key is `LANG` (not `SITE_LANG` — an earlier, now-abandoned parallel branch used that name; do not reintroduce it). `siteLang()`/`resolveLang()` live in `Resources/Template/scripts/config.ts` (not a new `localization.ts` file).
- Empty-string frontmatter values are **not** omitted by `TypedContentEditor.write`/`PageMetadataEditor.write` — both persist an explicit `field: ""` when the in-memory value is empty. Every per-page "inherit the site default" case therefore MUST be resolved with `||` (or an explicit blank check) on the Astro rendering side, never with `??`.
- `LanguagePicker`'s curated-list matching MUST match on the tag's primary BCP-47 subtag (the part before the first `-`), not the exact raw value — `SiteLanguageAsset.hostLanguageTag()` (already shipped) returns region-qualified tags like `en-US` for nearly every host, and a picker that only matches bare `en` would show "Other…" for the common case. This was a real bug found in the abandoned parallel branch's final review; bake the fix in from the start here, don't discover it again.
- `LanguagePicker` is used ONLY in "inherit the site default" contexts in this plan (typed-entry inspector, plain-page/blog inspector) — the already-shipped Website tab TextField is out of scope and stays as-is. Don't build a non-inherit mode; always show "Use site default (…)" as an option.
- `Sources/AnglesiteApp` model code (`PlistEditorModel`, `TypedEntryEditorModel`, `PageMetadataModel`) IS unit-testable via `@testable import AnglesiteAppCore` in `Tests/AnglesiteAppTests/` (confirmed by #1174's own `PlistEditorModelLangTests.swift` — do NOT assume this layer is untested-by-design). Every task touching `TypedEntryEditorModel`/`PageMetadataModel` must add real tests there, following `PlistEditorModelLangTests.swift`'s pattern (temp-directory fixture, `.site-config` seeding, load/save/dirty-tracking assertions).
- Commit subject ≤ 72 characters.
- Every commit that touches `Resources/Template/` must be followed by `swift test --filter` covering the template-asset guard suites (`IntegrationTemplateAssetsTests`, `BlogTemplateAssetsTests`) before moving on — some Swift tests couple to template markup.

---

## File Structure

New files:
- `Resources/Template/src/lib/localization.build.test.ts` — end-to-end `astro build` regression test (mirrors `licensing.build.test.ts`).
- `Sources/AnglesiteApp/LanguagePicker.swift` — the shared curated-list-plus-"Other…"-plus-"Use site default" control.
- `Sources/AnglesiteApp/LanguageSettingsSection.swift` — the shared per-page "Language" section (mirrors `RobotsSettingsSection`'s shape), composed into `PageMetadataForm`.

Modified files (grouped by task below):
- `Resources/Template/src/layouts/BaseLayout.astro`, `Hentry.astro`, `Hreview.astro`, `Hevent.astro`, `BlogPost.astro`
- `Resources/Template/src/pages/blog/[...slug].astro`
- `Resources/Template/src/content.config.ts`, `Resources/Template/src/lib/content-schemas.ts`
- `Sources/AnglesiteCore/ContentTypeRegistry.swift`
- `Sources/AnglesiteCore/TypedContentEditor.swift`
- `Sources/AnglesiteCore/ContentScaffold.swift`
- `Sources/AnglesiteCore/MicropubContentSync.swift`
- `Sources/AnglesiteCore/PageMetadataEditor.swift`
- `Sources/AnglesiteApp/TypedEntryEditorModel.swift`, `TypedEntryEditorView.swift`
- `Sources/AnglesiteApp/PageMetadataModel.swift`, `PageInspectorView.swift`
- `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`, `TypedContentEditorTests.swift`, `ContentScaffoldTests.swift`, `MicropubContentSyncTests.swift`, `PageMetadataEditorTests.swift`, `ContentConfigDriftTests.swift` (if the compiler/drift-guard forces it)
- `Tests/AnglesiteAppTests/` — new test files for `TypedEntryEditorModel`/`PageMetadataModel` lang behavior (exact filenames decided by the tasks below, following `PlistEditorModelLangTests.swift`'s naming convention)

---

### Task 1: `BaseLayout.astro` optional `lang` prop

**Files:**
- Modify: `Resources/Template/src/layouts/BaseLayout.astro`

**Interfaces:**
- Produces: `BaseLayout`'s `Props.lang?: string` — every later task threading a per-entry override passes this prop.

- [ ] **Step 1: Add the prop and compute the effective language**

`BaseLayout.astro` currently has:
```ts
import { readConfig, siteLang } from "../../scripts/config";
...
interface Props {
  title: string;
  description?: string;
  license?: LicenseRef | null;
}

const { title, description } = Astro.props;
```
```html
<html lang={siteLang()}>
```

Change to:
```ts
interface Props {
  title: string;
  description?: string;
  license?: LicenseRef | null;
  /**
   * The language this page declares via <html lang>. Omit to inherit the site default
   * (siteLang()); pass an explicit BCP-47 tag to override it. An empty string is treated the
   * same as omitted — per-page frontmatter can hold an explicit "" meaning "inherit," and that
   * must not render <html lang="">, so this uses `||`, never `??`.
   */
  lang?: string;
}

const { title, description, lang } = Astro.props;
const effectiveLang = lang || siteLang();
```
```html
<html lang={effectiveLang}>
```

- [ ] **Step 2: Verify nothing else broke**

Run: `cd Resources/Template && npx astro check && npm run build`
Expected: PASS. (Every existing call site omits `lang`, so `effectiveLang` still resolves to `siteLang()` everywhere — no rendered-output change yet.)

- [ ] **Step 3: Run the template's existing test suite**

Run: `cd Resources/Template && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add Resources/Template/src/layouts/BaseLayout.astro
git commit -m "feat: add optional lang prop to BaseLayout"
```

---

### Task 2: Per-page `lang` field in content schemas

**Files:**
- Modify: `Resources/Template/src/content.config.ts`
- Modify: `Resources/Template/src/lib/content-schemas.ts`

**Interfaces:**
- Produces: an optional `lang` frontmatter field on every collection in `ENTRY_COLLECTIONS` — Task 3 (layouts) and Task 7 (native inspector) both read/write it under this exact name.

- [ ] **Step 1: Add `lang: z.string().optional()` to every `ENTRY_COLLECTIONS` schema**

In `Resources/Template/src/content.config.ts`, add one line (`lang: z.string().optional(),`, placed right after the `...socialFields` spread) to the `z.object({...})` body of: `blog`, `photos`, `albums`, `bookmarks`, `replies`, `likes`, `announcements`, `events`, `reviews`.

In `Resources/Template/src/lib/content-schemas.ts`, add the same line to both `notesSchema` and `articlesSchema`.

Do **not** add `lang` to `members` — it isn't in `ENTRY_COLLECTIONS`.

**Note:** `content-schemas.ts` currently has a shared `socialFields` object spread into every schema. Add `lang` as its own literal line in each schema body, NOT by adding it to the `socialFields` object itself — `Sources/AnglesiteCore/FrontmatterSchemaReader.swift`'s text-scan (used by the AI style-guide feature) only recognizes literal `key: z....` lines directly inside a schema's `z.object({...})` body, not a spread's inner keys.

- [ ] **Step 2: Verify**

Run: `cd Resources/Template && npx astro check && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add Resources/Template/src/content.config.ts Resources/Template/src/lib/content-schemas.ts
git commit -m "feat: add optional lang field to entry content schemas"
```

---

### Task 3: Thread `lang` through the entry layouts + blog route

**Files:**
- Modify: `Resources/Template/src/layouts/Hentry.astro`
- Modify: `Resources/Template/src/layouts/Hreview.astro`
- Modify: `Resources/Template/src/layouts/Hevent.astro`
- Modify: `Resources/Template/src/layouts/BlogPost.astro`
- Modify: `Resources/Template/src/pages/blog/[...slug].astro`

**Interfaces:**
- Consumes: `BaseLayout`'s `Props.lang?: string` (Task 1); each collection's optional `lang` field (Task 2).

- [ ] **Step 1: `Hentry.astro`**

Add `lang?: string;` to the `HentryFields` interface (alongside `draft?: boolean;`), and pass it through to `BaseLayout` using `||`, not a bare pass-through:

```html
<BaseLayout title={title ?? "Post"} description={d.summary} license={license} lang={d.lang || undefined}>
```

- [ ] **Step 2: `Hreview.astro`**

```html
<BaseLayout title={reviewName} license={license} lang={d.lang || undefined}>
```

- [ ] **Step 3: `Hevent.astro`**

```html
<BaseLayout title={d.name ?? "Event"} description={d.location} license={license} lang={d.lang || undefined}>
```

- [ ] **Step 4: `BlogPost.astro`**

Add `lang?: string;` to its `Props` interface and destructuring, pass through:

```ts
interface Props {
  title: string;
  description?: string;
  pubDate?: Date;
  draft?: boolean;
  syndication?: string[];
  lang?: string;
}

const { title, description, pubDate, draft, syndication, lang } = Astro.props;
```

```html
<BaseLayout title={title} description={description} license={license} lang={lang}>
```

- [ ] **Step 5: `src/pages/blog/[...slug].astro`**

```html
<BlogPost
  title={post.data.title}
  description={post.data.description}
  pubDate={post.data.pubDate}
  draft={post.data.draft}
  syndication={post.data.syndication}
  lang={post.data.lang || undefined}
>
  <Content />
</BlogPost>
```

- [ ] **Step 6: Verify**

Run: `cd Resources/Template && npx astro check && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/src/layouts/Hentry.astro Resources/Template/src/layouts/Hreview.astro Resources/Template/src/layouts/Hevent.astro Resources/Template/src/layouts/BlogPost.astro Resources/Template/src/pages/blog/[...slug].astro
git commit -m "feat: thread per-entry lang override into every layout"
```

---

### Task 4: End-to-end build regression test

**Files:**
- Create: `Resources/Template/src/lib/localization.build.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-3. Mirrors `Resources/Template/src/lib/licensing.build.test.ts`'s role.

- [ ] **Step 1: Write the test**

Create `Resources/Template/src/lib/localization.build.test.ts`, following `licensing.build.test.ts`'s exact pattern (tmpdir copy, real `npm install` + `astro build`, `finally` cleanup):

```ts
// Resources/Template/src/lib/localization.build.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXCLUDED = /(^|\/)(node_modules|dist|\.astro|\.wrangler)(\/|$)/;

function htmlLangOf(html: string): string | undefined {
  return html.match(/<html lang="([^"]*)"/)?.[1];
}

test("site language: site default and per-entry override both reach <html lang>", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "anglesite-lang-fixture-"));
  try {
    await cp(TEMPLATE_ROOT, fixtureDir, {
      recursive: true,
      filter: (src) => !EXCLUDED.test(src.slice(TEMPLATE_ROOT.length)),
    });

    await writeFile(join(fixtureDir, ".site-config"), "LANG=fr-CA\n", "utf8");

    await writeFile(
      join(fixtureDir, "src/content/blog/lang-override.md"),
      '---\ntitle: "English post on a French site"\npubDate: 2026-01-01\nlang: en\n---\n\nBody.\n',
      "utf8",
    );
    await writeFile(
      join(fixtureDir, "src/content/notes/no-override.md"),
      "---\npublishDate: 2026-01-01\n---\n\nBody.\n",
      "utf8",
    );
    await writeFile(
      join(fixtureDir, "src/content/reviews/blank-override.md"),
      '---\nitemReviewed: "A Thing"\nrating: 5\npublishDate: 2026-01-01\nlang: ""\n---\n\nBody.\n',
      "utf8",
    );

    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execFileSync("npx", ["astro", "build"], { cwd: fixtureDir, stdio: "inherit" });

    {
      const html = await readFile(join(fixtureDir, "dist/index.html"), "utf8");
      assert.equal(htmlLangOf(html), "fr-CA", "the homepage must render the site default LANG");
    }
    {
      const html = await readFile(join(fixtureDir, "dist/blog/lang-override/index.html"), "utf8");
      assert.equal(htmlLangOf(html), "en", "a blog post with an explicit lang override must render that language");
    }
    {
      const html = await readFile(join(fixtureDir, "dist/notes/no-override/index.html"), "utf8");
      assert.equal(htmlLangOf(html), "fr-CA", "a note with no lang frontmatter key must inherit the site default");
    }
    {
      const html = await readFile(join(fixtureDir, "dist/reviews/blank-override/index.html"), "utf8");
      assert.equal(
        htmlLangOf(html), "fr-CA",
        'an explicit empty-string lang override must inherit the site default, not render lang=""',
      );
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
```

(No second "absent LANG key" fixture needed here — #1174's own `config.test.ts` already covers `siteLang()`'s fallback to `"en"`; this test's job is only the per-entry-override wiring this plan adds.)

- [ ] **Step 2: Run**

Run: `cd Resources/Template && npx tsx --test src/lib/localization.build.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full template suite**

Run: `cd Resources/Template && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add Resources/Template/src/lib/localization.build.test.ts
git commit -m "test: add end-to-end per-entry lang wiring regression test"
```

---

### Task 5: `ContentTypeField.Kind.language` + `TypedContentEditor` support

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (the `Kind` enum)
- Modify: `Sources/AnglesiteCore/TypedContentEditor.swift`
- Modify: `Sources/AnglesiteCore/ContentScaffold.swift`
- Modify: `Sources/AnglesiteCore/MicropubContentSync.swift`
- Modify: `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`

**Interfaces:**
- Produces: `ContentTypeField.Kind.language` — Task 6 (registry field additions) and Task 7 (inspector UI) both depend on this case existing.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`, read the file first to match its existing fixture/descriptor style, then add:

```swift
@Test("a .language field round-trips through defaultValue/decode/encode exactly like .string")
func languageFieldRoundTrips() {
    let descriptor = ContentTypeDescriptor(
        id: "test-lang",
        displayName: "Test",
        storage: .collection("test"),
        fields: [ContentTypeField("lang", .language)],
        projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil)
    )
    #expect(TypedContentEditor.defaultValue(for: .language) == .text(""))
    let read = TypedContentEditor.read("---\nlang: fr\n---\nBody.\n", descriptor: descriptor)
    #expect(read["lang"] == .text("fr"))
    let written = TypedContentEditor.write(.init(["lang": .text("es")]), into: "---\nlang: fr\n---\nBody.\n", descriptor: descriptor)
    #expect(written.contains("lang: es") || written.contains("lang: \"es\""))
}

@Test("a missing .language key decodes as an empty string, not a crash")
func languageFieldMissingKey() {
    let descriptor = ContentTypeDescriptor(
        id: "test-lang-missing",
        displayName: "Test",
        storage: .collection("test"),
        fields: [ContentTypeField("lang", .language)],
        projections: ContentTypeProjections(microformat: "h-entry", microformatProperties: [:], schemaType: nil)
    )
    let read = TypedContentEditor.read("---\ntitle: x\n---\nBody.\n", descriptor: descriptor)
    #expect(read["lang"] == .text(""))
}
```

- [ ] **Step 2: Confirm RED**

Run: `swift test --filter TypedContentEditorTests`
Expected: FAIL — "type 'ContentTypeField.Kind' has no member 'language'"

- [ ] **Step 3: Add the case**

In `ContentTypeRegistry.swift`'s `Kind` enum, add `case language` right after `case string`, with a doc comment noting it's a BCP-47 tag override, stored identically to `.string`.

- [ ] **Step 4: Fix every exhaustive switch the compiler flags**

Update `TypedContentEditor.defaultValue(for:)` and `.decode(_:kind:)` (group `.language` with `.string`), `ContentScaffold.renderEntry` and `.renderSingleton` (same grouping), `MicropubContentSync`'s field-decode switch (same grouping). **Do not stop at this named list** — run `swift build` after adding the case and fix every "switch must be exhaustive" error you actually get, including in `Sources/AnglesiteApp` if the compiler flags anything there (a temporary minimal arm — grouped with `.string`, no bespoke UI yet — is fine; Task 7 will replace it with the real `LanguagePicker`).

- [ ] **Step 5: Confirm GREEN**

Run: `swift test --filter TypedContentEditorTests`
Expected: PASS.

- [ ] **Step 6: Run the full AnglesiteCore + AnglesiteApp suites**

Run: `swift test --filter AnglesiteCoreTests` and `swift test --filter AnglesiteAppTests`
Expected: PASS (aside from any already-known, unrelated pre-existing flake — check `docs`/memory or ask if an unfamiliar failure shows up).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Sources/AnglesiteCore/TypedContentEditor.swift Sources/AnglesiteCore/ContentScaffold.swift Sources/AnglesiteCore/MicropubContentSync.swift Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
git commit -m "feat: add ContentTypeField.Kind.language"
```

(Include any `Sources/AnglesiteApp` file the compiler forced you to touch in Step 4 in this same commit, called out explicitly in the commit body.)

---

### Task 6: `lang` field on the built-in content-type descriptors

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift` (`note`, `article`, `photo`, `album`, `bookmark`, `reply`, `like`, `announcement`, `event`, `review` descriptors)
- Modify: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`
- Possibly modify: `Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift`, `Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` (see Step 3)

**Interfaces:**
- Consumes: `ContentTypeField.Kind.language` (Task 5).
- Produces: every `ENTRY_COLLECTIONS`-backed descriptor's `fields` array includes `ContentTypeField("lang", .language)` — Task 7's `TypedEntryForm` renders whatever `descriptor.fields` contains.

- [ ] **Step 1: Write the failing tests**

In `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`:

```swift
@Test("every ENTRY_COLLECTIONS-backed descriptor declares a lang field")
func entryCollectionDescriptorsHaveLang() {
    let idsExpectingLang = ["note", "article", "photo", "album", "bookmark", "reply", "like", "announcement", "event", "review"]
    let registry = ContentTypeRegistry()
    for id in idsExpectingLang {
        let descriptor = registry.descriptor(id: id)
        #expect(descriptor != nil, "expected a built-in descriptor for \(id)")
        #expect(
            descriptor?.fields.contains(where: { $0.name == "lang" && $0.kind == .language }) == true,
            "\(id) descriptor must declare a lang field of kind .language"
        )
    }
}

@Test("identity/directory descriptors do NOT get a lang field")
func nonEntryDescriptorsHaveNoLang() {
    let idsExpectingNoLang = ["businessProfile", "personalProfile", "resume", "member"]
    let registry = ContentTypeRegistry()
    for id in idsExpectingNoLang {
        let descriptor = registry.descriptor(id: id)
        #expect(descriptor != nil, "expected a built-in descriptor for \(id)")
        #expect(descriptor?.fields.contains(where: { $0.name == "lang" }) == false, "\(id) should not declare lang")
    }
}
```

- [ ] **Step 2: Confirm RED, then add the field**

Run: `swift test --filter ContentTypeRegistryTests` (expect FAIL), then add `ContentTypeField("lang", .language)` to the ten named descriptors' `fields:` arrays.

**Field position matters.** `Tests/AnglesiteCoreTests/ContentConfigDriftTests.swift` has a "content.config.ts drift guard" suite comparing registry-generated Zod-schema text against the real committed `content.config.ts`/`content-schemas.ts` verbatim, including field order. Task 2 put `lang` right after `...socialFields` (i.e. FIRST among the emitted fields, since `...socialFields` itself emits no line). Match that position in the Swift `fields` array — insert `ContentTypeField("lang", .language)` FIRST in each descriptor's array, not appended last, so the drift test's generated text lines up. Run `swift test --filter ContentConfigDriftTests` after adding the fields; if it still fails, the position is wrong — fix it, don't work around the test.

- [ ] **Step 3: Fix any exact-fixture test broken by the new first-field**

`Tests/AnglesiteCoreTests/ContentScaffoldTests.swift` may have an exact-heredoc `#expect(out == """...""")` assertion for a scaffolded note/article/etc. that now needs a `lang: ""` line inserted at the position matching Step 2 (scaffolding renders every `.string`/`.language`-family field as a live line, per `ContentScaffold.renderEntry`, Task 5). Fix the fixture's expected text minimally if so — don't weaken the assertion.

- [ ] **Step 4: Confirm GREEN**

Run: `swift test --filter ContentTypeRegistryTests` and `swift test --filter ContentConfigDriftTests` and `swift test --filter ContentScaffoldTests`
Expected: all PASS.

- [ ] **Step 5: Run the full AnglesiteCoreTests suite**

Run: `swift test --filter AnglesiteCoreTests`
Expected: PASS (aside from any already-known unrelated flake).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "feat: add lang field to entry content-type descriptors"
```

(Include `ContentScaffoldTests.swift` in this commit if Step 3 required a fixture update.)

---

### Task 7: `LanguagePicker` control + typed-entry inspector wiring

**Files:**
- Create: `Sources/AnglesiteApp/LanguagePicker.swift`
- Modify: `Sources/AnglesiteApp/TypedEntryEditorModel.swift`
- Modify: `Sources/AnglesiteApp/TypedEntryEditorView.swift`
- Create: `Tests/AnglesiteAppTests/TypedEntryEditorModelLangTests.swift` (or similar name — match `PlistEditorModelLangTests.swift`'s naming convention)

**Interfaces:**
- Consumes: `ContentTypeField.Kind.language` (Task 5), `SiteLanguageAsset.parseSettings(from:)` (already shipped by #1174).
- Produces: `LanguagePicker` SwiftUI view — `init(tag: Binding<String>, siteDefaultTag: String)`. Task 8 reuses this exact type and initializer.

- [ ] **Step 1: Create the shared `LanguagePicker` control**

Create `Sources/AnglesiteApp/LanguagePicker.swift`:

```swift
// Sources/AnglesiteApp/LanguagePicker.swift
import SwiftUI

/// A curated set of common web languages, keyed by BCP-47 subtag. "Other…" is the escape hatch
/// for anything not listed here.
enum CommonLanguage: String, CaseIterable, Identifiable {
    case en, es, fr, de, it, pt, ja, zh, ko, ar, ru, hi, nl, pl, sv
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .en: return "English"
        case .es: return "Spanish"
        case .fr: return "French"
        case .de: return "German"
        case .it: return "Italian"
        case .pt: return "Portuguese"
        case .ja: return "Japanese"
        case .zh: return "Chinese"
        case .ko: return "Korean"
        case .ar: return "Arabic"
        case .ru: return "Russian"
        case .hi: return "Hindi"
        case .nl: return "Dutch"
        case .pl: return "Polish"
        case .sv: return "Swedish"
        }
    }
}

/// A BCP-47 language tag picker for a per-page override: the curated `CommonLanguage` list, an
/// "Other…" freeform slot, and a leading "Use site default" entry mapping to an empty string
/// (the codebase's existing empty-string-means-unset idiom for optional overrides).
///
/// Matches an existing tag by its PRIMARY subtag (before the first "-"), not the exact raw value
/// — `SiteLanguageAsset.hostLanguageTag()` returns region-qualified tags like "en-US" for nearly
/// every host, and matching only bare "en" would show "Other…" for that common case.
struct LanguagePicker: View {
    @Binding var tag: String
    let siteDefaultTag: String

    private enum Selection: Hashable {
        case inherit
        case common(CommonLanguage)
        case other
    }

    @State private var manualOtherSelected = false

    private var selection: Selection {
        if manualOtherSelected { return .other }
        if tag.isEmpty { return .inherit }
        let primarySubtag = tag.split(separator: "-").first.map { String($0).lowercased() } ?? tag.lowercased()
        if let common = CommonLanguage(rawValue: primarySubtag) { return .common(common) }
        return .other
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Language", selection: pickerBinding) {
                Text("Use site default (\(siteDefaultTag))").tag(Selection.inherit)
                ForEach(CommonLanguage.allCases) { language in
                    Text(language.displayName).tag(Selection.common(language))
                }
                Text("Other…").tag(Selection.other)
            }
            .labelsHidden()
            if case .other = selection {
                TextField("BCP 47 tag, e.g. \"pt-BR\"", text: $tag)
                    .textFieldStyle(.roundedBorder)
                if let message = validationMessage {
                    Text(message).font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private var pickerBinding: Binding<Selection> {
        Binding(
            get: { selection },
            set: { newValue in
                switch newValue {
                case .inherit:
                    tag = ""
                    manualOtherSelected = false
                case .common(let language):
                    tag = language.rawValue
                    manualOtherSelected = false
                case .other:
                    manualOtherSelected = true
                    if CommonLanguage(rawValue: tag) != nil { tag = "" }
                }
            }
        )
    }

    private var validationMessage: String? {
        guard !tag.isEmpty else { return nil }
        let pattern = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
        let matches = tag.range(of: pattern, options: .regularExpression) != nil
        return matches ? nil : "This doesn't look like a BCP 47 language tag, e.g. \"en\" or \"pt-BR\"."
    }
}
```

- [ ] **Step 2: Give `TypedEntryEditorModel` the current site-default tag for display**

Add a stored property and populate it in `load()`:

```swift
private(set) var siteDefaultLangTag = "en"
```

```swift
if let config = try? String(contentsOf: sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8) {
    siteDefaultLangTag = SiteLanguageAsset.parseSettings(from: config).lang
}
```

- [ ] **Step 3: Write tests for the new model behavior**

Create `Tests/AnglesiteAppTests/TypedEntryEditorModelLangTests.swift`, following `PlistEditorModelLangTests.swift`'s exact fixture pattern (temp directory, seed `.site-config`, construct the model, `await model.load()`). Test that `siteDefaultLangTag` reflects a seeded `LANG` value, and defaults to `"en"` when `.site-config` is absent or has no `LANG` key. Read `TypedEntryEditorModel`'s actual `init` signature first (it needs a `descriptor`/`file`/`route`/`sourceDirectory` — check `PlistEditorModelLangTests.swift` and the model's own init for the exact construction pattern, and use a minimal built-in descriptor like `note` for the fixture).

- [ ] **Step 4: Render `.language` fields with `LanguagePicker`**

In `TypedEntryEditorView.swift`'s `control(for:)`, replace whatever Task 5 Step 4 left as a placeholder for `.language` (or add a new case if none exists) with:

```swift
case .language:
    VStack(alignment: .leading) {
        Text(label).font(.caption).foregroundStyle(.secondary)
        LanguagePicker(tag: model.textBinding(field.name), siteDefaultTag: model.siteDefaultLangTag)
    }
```

- [ ] **Step 5: Build and test**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

Run: `swift test --filter TypedEntryEditorModelLangTests` (or whatever you named the test file/suite)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/LanguagePicker.swift Sources/AnglesiteApp/TypedEntryEditorModel.swift Sources/AnglesiteApp/TypedEntryEditorView.swift Tests/AnglesiteAppTests/TypedEntryEditorModelLangTests.swift
git commit -m "feat: render lang fields with LanguagePicker in the inspector"
```

---

### Task 8: `PageMetadata`/`PageMetadataEditor` + `LanguageSettingsSection` for blog/plain pages

**Files:**
- Modify: `Sources/AnglesiteCore/PageMetadataEditor.swift`
- Modify: `Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift`
- Modify: `Sources/AnglesiteApp/PageMetadataModel.swift`
- Create: `Sources/AnglesiteApp/LanguageSettingsSection.swift`
- Modify: `Sources/AnglesiteApp/PageInspectorView.swift`
- Create: `Tests/AnglesiteAppTests/PageMetadataModelLangTests.swift` (or similar name)

**Interfaces:**
- Consumes: `LanguagePicker` (Task 7), `SiteLanguageAsset.parseSettings(from:)`.
- Produces: `PageMetadata.lang: String` (default `""`) — what `src/pages/blog/[...slug].astro`'s `post.data.lang` (Task 3) is populated from when a blog post is edited through the app.

- [ ] **Step 1: Write the failing Core tests**

In `Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift`:

```swift
@Test("reads lang from frontmatter, defaulting to empty when absent")
func readsLang() {
    let withLang = PageMetadataEditor.read("---\ntitle: \"T\"\nlang: fr\n---\nB\n")
    #expect(withLang.lang == "fr")
    let without = PageMetadataEditor.read("---\ntitle: \"T\"\n---\nB\n")
    #expect(without.lang == "")
}

@Test("write adds/updates the lang key like title/description")
func writesLang() {
    let out = PageMetadataEditor.write(
        PageMetadata(title: "T", description: "D", lang: "es"),
        into: "---\ntitle: \"T\"\ndescription: \"D\"\n---\nB\n"
    )
    #expect(out.contains("lang: \"es\""))
}

@Test("existing title/description-only call sites still compile with the default lang")
func defaultLangParameter() {
    let m = PageMetadata(title: "T", description: "D")
    #expect(m.lang == "")
}
```

- [ ] **Step 2: Confirm RED, then update `PageMetadata`/`PageMetadataEditor`**

```swift
public struct PageMetadata: Equatable, Sendable {
    public var title: String
    public var description: String
    /// A BCP-47 language override for this page. Empty means "inherit the site default" — an
    /// empty string is written to frontmatter as `lang: ""`, not omitted (matching
    /// TypedContentEditor's existing behavior for every other field).
    public var lang: String

    public init(title: String, description: String, lang: String = "") {
        self.title = title
        self.description = description
        self.lang = lang
    }
}

public enum PageMetadataEditor {
    public static func read(_ contents: String) -> PageMetadata {
        let doc = FrontmatterDocument.parse(contents)
        return PageMetadata(title: scalar(doc, "title"), description: scalar(doc, "description"), lang: scalar(doc, "lang"))
    }

    public static func write(_ metadata: PageMetadata, into contents: String) -> String {
        var doc = FrontmatterDocument.parse(contents)
        let current = read(contents)
        if metadata.title != current.title { doc.set(.string(metadata.title), for: "title") }
        if metadata.description != current.description {
            doc.set(.string(metadata.description), for: "description")
        }
        if metadata.lang != current.lang { doc.set(.string(metadata.lang), for: "lang") }
        return doc.serialized()
    }

    private static func scalar(_ doc: FrontmatterDocument, _ key: String) -> String {
        if case .string(let s)? = doc.value(for: key) { return s }
        return ""
    }
}
```

- [ ] **Step 3: Confirm GREEN**

Run: `swift test --filter PageMetadataEditorTests`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 4: Add `langBinding()` + `siteDefaultLangTag` to `PageMetadataModel`, mirroring Task 7 Step 2 exactly**

```swift
func langBinding() -> Binding<String> {
    Binding(get: { [weak self] in self?.metadata.lang ?? "" },
            set: { [weak self] in self?.metadata.lang = $0 })
}
```

```swift
private(set) var siteDefaultLangTag = "en"
```

```swift
if let config = try? String(contentsOf: sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8) {
    siteDefaultLangTag = SiteLanguageAsset.parseSettings(from: config).lang
}
```

(`isDirty` needs no change — `metadata != savedMetadata` already covers `lang` now that it's part of the struct.)

- [ ] **Step 5: Write tests for the new model behavior**

Create `Tests/AnglesiteAppTests/PageMetadataModelLangTests.swift`, following `PlistEditorModelLangTests.swift`'s pattern: seed a frontmatter file + `.site-config`, `load()`, assert `metadata.lang` and `siteDefaultLangTag`; assert a `lang` edit shows up as dirty and round-trips through `save()`.

- [ ] **Step 6: Create `LanguageSettingsSection` and compose it into `PageMetadataForm`**

Create `Sources/AnglesiteApp/LanguageSettingsSection.swift`:

```swift
// Sources/AnglesiteApp/LanguageSettingsSection.swift
import SwiftUI

/// Per-page language override for a plain frontmatter page or blog post — mirrors
/// `RobotsSettingsSection`'s shape (a small, reusable `Section` composed into `PageMetadataForm`).
struct LanguageSettingsSection: View {
    @Binding var tag: String
    let siteDefaultTag: String

    var body: some View {
        Section("Language") {
            LanguagePicker(tag: $tag, siteDefaultTag: siteDefaultTag)
        }
    }
}
```

In `PageInspectorView.swift`'s `PageMetadataForm`, add the section after the description field and before `RobotsSettingsSection`:

```swift
LanguageSettingsSection(tag: model.langBinding(), siteDefaultTag: model.siteDefaultLangTag)
```

- [ ] **Step 7: Build and test**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: BUILD SUCCEEDED.

Run: `swift test --filter PageMetadataModelLangTests` (or whatever you named it)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Sources/AnglesiteCore/PageMetadataEditor.swift Tests/AnglesiteCoreTests/PageMetadataEditorTests.swift Sources/AnglesiteApp/PageMetadataModel.swift Sources/AnglesiteApp/LanguageSettingsSection.swift Sources/AnglesiteApp/PageInspectorView.swift Tests/AnglesiteAppTests/PageMetadataModelLangTests.swift
git commit -m "feat: add lang override to plain pages and blog posts"
```

---

### Task 9: Full verification pass + PR

**Files:** none (verification only)

- [ ] **Step 1: Full Swift suite**

Run: `swift test --package-path .`
Expected: PASS (aside from any already-known unrelated flake).

- [ ] **Step 2: Full template suite**

Run: `cd Resources/Template && npm test`
Expected: PASS.

- [ ] **Step 3: Build the app**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: PASS.

- [ ] **Step 4: Report any check that couldn't be run**

If manual interactive GUI verification isn't possible in this environment, say so explicitly rather than claiming it passed.

- [ ] **Step 5: Prepare the PR**

Read `CONTRIBUTING.md` ▸ "Commits and pull requests" before opening, build the PR body from `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings. This PR does NOT close #956 (already closed by #1174) — reference it in prose ("part of the #956 follow-up") without a closing keyword, unless a fresh tracking issue was opened for this scope (confirm with the user first if that seems warranted).

```bash
git push -u origin <branch-name>
gh pr create --title "feat: add per-page language override" --body "..."
```

## Self-Review Notes

- **Spec coverage:** site-wide default is intentionally out of scope (already shipped by #1174) — this plan covers exactly the per-page override piece: schema (Task 2), rendering (Tasks 1/3/4), `Kind.language` (Task 5), registry (Task 6), typed-entry UI (Task 7), plain-page/blog UI (Task 8).
- **Corrected proactively vs. the abandoned parallel branch:** `LanguagePicker` bakes in primary-subtag matching from the start (a bug found only in that branch's final review), and every `Sources/AnglesiteApp` model task includes real `Tests/AnglesiteAppTests` coverage (that branch wrongly assumed this layer was untested-by-design).
- **Type consistency:** `LanguagePicker(tag:siteDefaultTag:)`'s signature (Task 7) is reused unchanged in Task 8. `ContentTypeField.Kind.language` (Task 5) is the exact case name used in Task 6's descriptor edits and Task 7's `switch`.
