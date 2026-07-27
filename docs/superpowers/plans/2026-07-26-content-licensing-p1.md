# Content Licensing — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an Anglesite site a per-content-type content license, and project it into the three licensing vocabularies that consumers actually read today — schema.org `license`, Microformats2 `u-license`, and `<link rel="license">`.

**Architecture:** A committed `src/data/licensing.json` holds a site default plus per-collection overrides. A pure resolver in `src/lib/licensing.ts` answers "what license applies to collection X," with a hardcoded set of collections that never assert a license by default (`bookmarks`, `replies`, `likes`, `reviews` — content that is by construction about other people's work). A thin `import.meta.glob` loader mirrors the existing `profile.ts` pattern. Three projections consume the resolver: `schema.ts` adds a `license` property, the four entry layouts emit `u-license`, and `BaseLayout.astro` emits `<link rel="license">` plus a footer rights statement.

**Tech Stack:** Astro 6, TypeScript (ES modules), `schema-dts`, `node:test` via `tsx`, Node 24.15.0.

**Source spec:** [`docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md`](../specs/2026-07-26-really-simple-licensing-spike.md) — this plan implements **Phase 1 only**.

## Scope

**In scope (spec Phase 1):** the licensing model, per-collection resolution, and the three projections with real consumers, plus a footer rights statement.

**Out of scope, deliberately:**
- **Phase 2** — folding `BLOCK_AI`/`CONTENT_SIGNALS` into this model and migrating the Website Settings crawler-policy facet. That is a behavior change to shipped settings and gets its own plan.
- **Phase 3** — the RSL projection (`rsl.xml`, robots `License:`, `Link:` header, feed `xmlns:rsl`). Nothing in this plan emits RSL.
- **Any Swift or app UI work.** Phase 1 is template-only; `licensing.json` is hand-editable and git-visible, consistent with "git is the source of truth for sites." The settings UI arrives in Phase 2 where it absorbs the crawler-policy facet.
- `<legal>` warranty/attestation elements — permanently excluded per spec §Q3.

## Global Constraints

- **ES modules only** — `import`/`export`, never CommonJS.
- **No new npm dependencies.** CONTRIBUTING requires issue approval for new deps. `tsx`, `schema-dts`, and `microformats-parser` are already in `Resources/Template/package.json`.
- **Node 24.15.0**, pinned by `scripts/node-version.txt` at the repo root (not under `Resources/Template/`).
- **Template changes require `swift test` too.** Swift tests string-match template markup; a layout edit can break them. Run `swift test --package-path .` before the final commit of any task that touches a `.astro` file.
- **Conventional commits, subject ≤72 characters.** Format `type(scope): summary`. Reference `#689`.
- **All work happens in `Resources/Template/`** unless a step says otherwise. Paths below are relative to the repo root.
- **Never assert a license on the user's behalf.** The scaffolded default is `null` (all rights reserved — the legal default). Emitting nothing is always the correct fallback.
- **`swift test` runs must be serialized across agents** — concurrent full-suite runs cause spurious FoundationModels failures.

---

### Task 1: Run the template's `node:test` suites in CI

The template has 11 `node:test` files that nothing executes. `vitest.config.ts` sets `include: ["worker/**/*.test.ts"]`, and the CI template lane runs only `npm run test:worker` and `npm run build`. Every later task in this plan is TDD, so this must land first or those tests never run.

**Files:**
- Modify: `Resources/Template/package.json` (the `scripts` block)
- Modify: `.github/workflows/ci.yml:141-143` (the `template-worker` job's run steps)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` in `Resources/Template/` runs every `node:test` suite. Later tasks rely on this command existing.

- [ ] **Step 1: Inventory what currently runs**

```bash
cd Resources/Template
ls scripts/*.test.ts src/lib/*.test.ts
```

Expected: 11 files — `scripts/{component-harness,config,csp,edge-artifacts,keystatic-gate,microformats,pre-deploy-check,redirects,themes}.test.ts` and `src/lib/{content-loader,feeds}.test.ts`.

- [ ] **Step 2: Add the `test` script**

In `Resources/Template/package.json`, add a `test` key to `scripts`, immediately before `test:worker`:

```json
    "test": "tsx --test \"scripts/**/*.test.ts\" \"src/lib/**/*.test.ts\"",
    "test:worker": "vitest run --config vitest.config.ts"
```

The glob is quoted so the runner expands it rather than the shell — this keeps behavior identical on a developer's zsh and on CI's bash. Node 24 supports glob patterns in `--test` natively, and `tsx` forwards them. If the runner reports zero tests found, the glob wasn't expanded; fall back to an explicit two-directory form rather than debugging shell quoting:

```json
    "test": "tsx --test scripts/*.test.ts src/lib/*.test.ts",
```

- [ ] **Step 3: Install and run it**

```bash
cd Resources/Template
npm ci --no-audit --no-fund
npm test
```

Expected: the runner executes and prints a `pass`/`fail` tally for all 11 suites.

**If any suite fails, fix it in this task.** These suites have been unexecuted for some time, so pre-existing breakage is plausible — that is exactly the information this task exists to surface. Do not skip, delete, or `--test-skip-pattern` a failing suite; a red suite here is a real defect in shipped template code. If a failure is genuinely unrelated to licensing and too large to fix inline, stop and report it rather than proceeding to Task 2 on a red baseline.

- [ ] **Step 4: Wire it into CI**

In `.github/workflows/ci.yml`, in the `template-worker` job, add a step between `npm ci` and `npm run test:worker`:

```yaml
      - run: npm ci --no-audit --no-fund
      - run: npm test
      - run: npm run test:worker
      - run: npm run build
```

The job already sets `defaults.run.working-directory: Resources/Template`, so no path prefix is needed.

- [ ] **Step 5: Rename the CI job to match what it now does**

Still in the `template-worker` job, change the display name:

```yaml
  template-worker:
    name: Template (build/test)
```

- [ ] **Step 6: Verify the workflow parses**

```bash
cd Resources/Template && npm test && npm run test:worker
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/package.json .github/workflows/ci.yml
git commit -m "ci(#689): run the template's node:test suites"
```

---

### Task 2: The licensing model

**Files:**
- Create: `Resources/Template/src/lib/licensing.ts` — pure types and resolution logic
- Create: `Resources/Template/src/lib/licensing.test.ts`
- Create: `Resources/Template/src/lib/licensing-data.ts` — `import.meta.glob` loader
- Create: `Resources/Template/src/data/licensing.json`

The split between `licensing.ts` and `licensing-data.ts` is load-bearing: `import.meta.glob` is a Vite/Astro construct that throws under plain `node:test`. Pure logic goes in `licensing.ts` (tested); the glob loader goes in `licensing-data.ts` (untested), exactly mirroring the existing `src/lib/profile.ts`.

`src/data/licensing.json` sits beside `src/data/profile.json` rather than at the template root like `redirects.json`, because it uses the same glob-loader mechanism as `profile.json` and is content metadata rather than a build artifact. (The spec said "a `licensing.json` in `Source/`" — `src/data/` satisfies that and is the more consistent home.)

**Interfaces:**
- Consumes: `EntryCollection` from `src/lib/collections.ts`.
- Produces:
  - `interface LicenseRef { url: string; name: string }`
  - `type LicensableCollection = EntryCollection | "blog"`
  - `interface LicensingPolicy { default: LicenseRef | null; collections: Partial<Record<LicensableCollection, LicenseRef | null>> }`
  - `const NON_ASSERTING_COLLECTIONS: readonly LicensableCollection[]`
  - `function normalizePolicy(raw: unknown): LicensingPolicy`
  - `function resolveLicense(policy: LicensingPolicy, collection: LicensableCollection): LicenseRef | null`
  - from `licensing-data.ts`: `licensingPolicy(): LicensingPolicy`, `licenseFor(collection: LicensableCollection): LicenseRef | null`, `siteLicense(): LicenseRef | null`

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/licensing.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  NON_ASSERTING_COLLECTIONS,
  normalizePolicy,
  resolveLicense,
  type LicensingPolicy,
} from "./licensing.ts";

const CC_BY: LicensingPolicy["default"] = {
  url: "https://creativecommons.org/licenses/by/4.0/",
  name: "CC BY 4.0",
};

test("resolveLicense: an asserting collection inherits the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {} };
  assert.deepEqual(resolveLicense(policy, "notes"), CC_BY);
  assert.deepEqual(resolveLicense(policy, "blog"), CC_BY);
});

test("resolveLicense: non-asserting collections return null despite a site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {} };
  for (const collection of NON_ASSERTING_COLLECTIONS) {
    assert.equal(resolveLicense(policy, collection), null, `${collection} must not assert`);
  }
});

test("resolveLicense: an explicit override beats the non-asserting default", () => {
  const policy: LicensingPolicy = { default: null, collections: { likes: CC_BY } };
  assert.deepEqual(resolveLicense(policy, "likes"), CC_BY);
});

test("resolveLicense: an explicit null override beats the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: { notes: null } };
  assert.equal(resolveLicense(policy, "notes"), null);
});

test("resolveLicense: no site default and no override yields null", () => {
  assert.equal(resolveLicense({ default: null, collections: {} }, "articles"), null);
});

test("normalizePolicy: undefined input yields an empty policy", () => {
  assert.deepEqual(normalizePolicy(undefined), { default: null, collections: {} });
});

test("normalizePolicy: reads a well-formed document", () => {
  const raw = {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
  };
  assert.deepEqual(normalizePolicy(raw), {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
  });
});

test("normalizePolicy: preserves an explicit null collection override", () => {
  const out = normalizePolicy({ default: null, collections: { notes: null } });
  assert.equal(Object.hasOwn(out.collections, "notes"), true);
  assert.equal(out.collections.notes, null);
});

test("normalizePolicy: drops a license with a missing or non-string url", () => {
  assert.equal(normalizePolicy({ default: { name: "No URL" } }).default, null);
  assert.equal(normalizePolicy({ default: { url: 42, name: "Bad" } }).default, null);
});

test("normalizePolicy: drops an unknown collection key", () => {
  const out = normalizePolicy({
    collections: { nonsense: { url: "https://example.com/x", name: "X" } },
  });
  assert.deepEqual(out.collections, {});
});

test("normalizePolicy: falls back to the url when name is absent", () => {
  const out = normalizePolicy({ default: { url: "https://example.com/l" } });
  assert.deepEqual(out.default, { url: "https://example.com/l", name: "https://example.com/l" });
});

test("normalizePolicy: a non-object document yields an empty policy", () => {
  assert.deepEqual(normalizePolicy("nope"), { default: null, collections: {} });
  assert.deepEqual(normalizePolicy(null), { default: null, collections: {} });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd Resources/Template && npx tsx --test src/lib/licensing.test.ts
```

Expected: FAIL — `Cannot find module './licensing.ts'`.

- [ ] **Step 3: Write the implementation**

Create `Resources/Template/src/lib/licensing.ts`:

```ts
/**
 * Per-content-type content licensing (#689 phase 1).
 *
 * A site declares one default license plus per-collection overrides in
 * `src/data/licensing.json`. This module is the pure resolver; `licensing-data.ts`
 * loads the document. Three projections consume the result — schema.org `license`
 * (schema.ts), Microformats2 `u-license` (the entry layouts), and `<link rel="license">`
 * (BaseLayout.astro).
 *
 * Design rule, per docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md §Q3:
 * never assert a license on the user's behalf. Collections that are by construction
 * *about someone else's work* assert nothing unless the user explicitly overrides them,
 * and the absence of any policy resolves to null (all rights reserved — the legal default),
 * never to a permissive license.
 */
import { ENTRY_COLLECTIONS, type EntryCollection } from "./collections.ts";

/** A license the site can point at: a canonical URL plus a human-readable label. */
export interface LicenseRef {
  url: string;
  name: string;
}

/** Every collection that can carry a license — the routed collections plus `blog`. */
export type LicensableCollection = EntryCollection | "blog";

export interface LicensingPolicy {
  /** Site-wide default, or null for "assert nothing". */
  default: LicenseRef | null;
  /**
   * Per-collection overrides. A key present with a null value means "assert nothing here"
   * and beats the site default; a key that is absent falls through to the default rules.
   */
  collections: Partial<Record<LicensableCollection, LicenseRef | null>>;
}

/**
 * Collections whose entries are responses to, or quotations of, third-party work. A site
 * owner cannot license someone else's article by bookmarking it, so these assert nothing
 * unless explicitly overridden.
 */
export const NON_ASSERTING_COLLECTIONS: readonly LicensableCollection[] = [
  "bookmarks",
  "replies",
  "likes",
  "reviews",
];

const LICENSABLE_COLLECTIONS: readonly LicensableCollection[] = [...ENTRY_COLLECTIONS, "blog"];

function isLicensable(key: string): key is LicensableCollection {
  return (LICENSABLE_COLLECTIONS as readonly string[]).includes(key);
}

/**
 * Coerce one raw JSON value into a LicenseRef, or null when it can't be trusted.
 * `url` is mandatory — a license reference with no URL points nowhere and would emit an
 * empty href. `name` falls back to the URL so there is always something to render.
 */
function toLicenseRef(raw: unknown): LicenseRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { url, name } = raw as { url?: unknown; name?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;
  return { url, name: typeof name === "string" && name.length > 0 ? name : url };
}

/**
 * Parse a hand-edited `licensing.json` defensively. Unrecognized collection keys and
 * malformed license refs are dropped rather than passed through, matching how
 * `edge-artifacts.ts`'s `normalizeContentSignal` treats a typo'd config value.
 */
export function normalizePolicy(raw: unknown): LicensingPolicy {
  const policy: LicensingPolicy = { default: null, collections: {} };
  if (!raw || typeof raw !== "object") return policy;

  const { default: rawDefault, collections: rawCollections } = raw as {
    default?: unknown;
    collections?: unknown;
  };

  policy.default = toLicenseRef(rawDefault);

  if (rawCollections && typeof rawCollections === "object") {
    for (const [key, value] of Object.entries(rawCollections as Record<string, unknown>)) {
      if (!isLicensable(key)) continue;
      // An explicit null is meaningful ("assert nothing here"), so it is recorded as a
      // present key rather than dropped — that is what distinguishes it from an absent key.
      policy.collections[key] = value === null ? null : toLicenseRef(value);
    }
  }

  return policy;
}

/**
 * The license that applies to `collection`, or null when nothing should be asserted.
 *
 * Precedence: an explicit per-collection entry (including null) wins; then the
 * non-asserting rule; then the site default.
 */
export function resolveLicense(
  policy: LicensingPolicy,
  collection: LicensableCollection,
): LicenseRef | null {
  if (Object.hasOwn(policy.collections, collection)) {
    return policy.collections[collection] ?? null;
  }
  if (NON_ASSERTING_COLLECTIONS.includes(collection)) return null;
  return policy.default;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd Resources/Template && npx tsx --test src/lib/licensing.test.ts
```

Expected: PASS — 12 tests, 0 failures.

- [ ] **Step 5: Create the scaffolded policy document**

Create `Resources/Template/src/data/licensing.json`:

```json
{
  "default": null,
  "collections": {}
}
```

`null` means all rights reserved — the legal default. Anglesite must not choose a permissive license for the user.

- [ ] **Step 6: Create the loader**

Create `Resources/Template/src/lib/licensing-data.ts`:

```ts
/**
 * Loads `src/data/licensing.json` for the Astro layouts, mirroring `profile.ts`. The glob
 * returns `{}` when the file is absent, so a site with no policy simply asserts nothing.
 *
 * Split from `licensing.ts` because `import.meta.glob` is a Vite construct that is
 * unavailable under plain `node:test` — the pure logic stays importable by the test suite.
 */
import {
  normalizePolicy,
  resolveLicense,
  type LicensableCollection,
  type LicenseRef,
  type LicensingPolicy,
} from "./licensing.ts";

const mods = import.meta.glob<{ default: unknown }>("../data/licensing.json", { eager: true });

export function licensingPolicy(): LicensingPolicy {
  return normalizePolicy(Object.values(mods)[0]?.default);
}

/** The license applying to one collection's entries, or null to assert nothing. */
export function licenseFor(collection: LicensableCollection): LicenseRef | null {
  return resolveLicense(licensingPolicy(), collection);
}

/** The site-wide default, used for pages that aren't a collection entry. */
export function siteLicense(): LicenseRef | null {
  return licensingPolicy().default;
}
```

- [ ] **Step 7: Confirm the whole suite and the build are green**

```bash
cd Resources/Template && npm test && npm run build
```

Expected: all suites pass; `astro check` reports no type errors.

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/src/lib/licensing.ts \
        Resources/Template/src/lib/licensing.test.ts \
        Resources/Template/src/lib/licensing-data.ts \
        Resources/Template/src/data/licensing.json
git commit -m "feat(#689): per-collection content licensing model"
```

---

### Task 3: Project the license into schema.org JSON-LD

**Files:**
- Modify: `Resources/Template/src/lib/schema.ts`
- Create: `Resources/Template/src/lib/schema.test.ts`
- Modify: `Resources/Template/src/layouts/Hentry.astro` (pass `license` into the context)
- Modify: `Resources/Template/src/layouts/BlogPost.astro` (same)

`license` is a property of schema.org **CreativeWork**. `Event` is not a CreativeWork, so `eventSchema` gets no license and `schema-dts` would reject one. Events still carry `u-license` and `rel="license"` from Tasks 4 and 5 — only the JSON-LD projection skips them.

**Interfaces:**
- Consumes: `LicenseRef` from `licensing.ts`; `licenseFor` from `licensing-data.ts`.
- Produces: `SchemaContext` gains `license?: string` (the license **URL**, not the ref — JSON-LD wants a bare URL).

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { blogPostingSchema, entrySchema, type SchemaContext } from "./schema.ts";

const LICENSE = "https://creativecommons.org/licenses/by/4.0/";

function ctx(overrides: Partial<SchemaContext> = {}): SchemaContext {
  return { url: "https://example.com/notes/hi/", site: new URL("https://example.com"), ...overrides };
}

test("entrySchema: notes carry the license URL when one is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx({ license: LICENSE }));
  assert.equal((out as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: articles carry the license URL", () => {
  const out = entrySchema("articles", { title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: omits license entirely when none is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx());
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: events emit no license (Event is not a CreativeWork)", () => {
  const out = entrySchema("events", { name: "Meetup" }, ctx({ license: LICENSE }));
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: likes still project nothing at all", () => {
  assert.equal(entrySchema("likes", {}, ctx({ license: LICENSE })), null);
});

test("blogPostingSchema: carries the license URL", () => {
  const out = blogPostingSchema({ title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd Resources/Template && npx tsx --test src/lib/schema.test.ts
```

Expected: FAIL — `license` is `undefined` on the notes and articles cases.

- [ ] **Step 3: Add `license` to the context type**

In `Resources/Template/src/lib/schema.ts`, extend `SchemaContext`:

```ts
/** Page-level context the projection needs that isn't in the entry's frontmatter. */
export interface SchemaContext {
  /** Canonical absolute URL of the page being rendered (`Astro.url`). */
  url: string;
  /** Site origin (`Astro.site`), used to resolve root-relative asset paths to absolute URLs. */
  site?: URL;
  /** Site owner's name (from `src/data/profile.json`), used as the `author` of Article/BlogPosting. */
  authorName?: string;
  /**
   * Canonical URL of the license applying to this entry (#689), from `licenseFor()`.
   * Undefined means assert nothing — `clean()` drops the property entirely.
   * Only set on CreativeWork types; `Event` has no `license` property in schema.org.
   */
  license?: string;
}
```

- [ ] **Step 4: Set `license` on every CreativeWork branch**

Still in `schema.ts`, add `license: ctx.license,` to each object literal in `hentrySchema` and to `reviewSchema` and `blogPostingSchema`. The nine edits are:

- `case "articles"` — after `keywords,`
- `case "announcements"` — after `datePublished,`
- `case "notes"` — after `keywords,`
- `case "photos"` — after `keywords,`
- `case "albums"` — after `keywords,`
- `case "bookmarks"` — after `keywords,`
- `case "replies"` — after `datePublished,`
- `blogPostingSchema` — after `datePublished: iso(d.pubDate),`
- `reviewSchema` — after `datePublished: iso(d.publishDate),`

For example, the `notes` branch becomes:

```ts
    case "notes":
      return clean<WithContext<SocialMediaPosting>>({
        "@context": CONTEXT,
        "@type": "SocialMediaPosting",
        datePublished,
        keywords,
        license: ctx.license,
        url: ctx.url,
      });
```

Do **not** add `license` to `eventSchema` — `Event` is not a `CreativeWork` and `schema-dts` will fail the `astro check` build.

`clean()` already drops `undefined` values recursively, so an unlicensed entry emits no `license` key.

- [ ] **Step 5: Run the schema tests to confirm they pass**

```bash
cd Resources/Template && npx tsx --test src/lib/schema.test.ts
```

Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 6: Feed the resolved license in from the layouts**

In `Resources/Template/src/layouts/Hentry.astro`, add the import beside the existing `profile.ts` import:

```ts
import { licenseFor } from "../lib/licensing-data.ts";
```

Then, in the frontmatter, resolve it once and pass it into the schema context. Replace the existing `jsonLd` block with:

```ts
const license = licenseFor(entry.collection);
const jsonLd = entrySchema(entry.collection, entry.data as HentryData, {
  url: canonical,
  site: Astro.site,
  authorName: ownerName(),
  license: license?.url,
});
```

`license` is also consumed by Task 4's markup, which is why it is bound to a local rather than inlined.

In `Resources/Template/src/layouts/BlogPost.astro`, add the same import and replace the `jsonLd` block with:

```ts
const license = licenseFor("blog");
const jsonLd = blogPostingSchema(
  { title, description, pubDate },
  { url: canonical, site: Astro.site, authorName: ownerName(), license: license?.url },
);
```

- [ ] **Step 7: Verify the build type-checks**

```bash
cd Resources/Template && npm test && npm run build
```

Expected: all suites pass; `astro check` reports no errors. If `astro check` complains that `license` is not assignable, you added it to `eventSchema` — remove it there.

- [ ] **Step 8: Run the Swift suite**

Template markup changed, so the Swift string-match tests must be checked. Serialize this with any other agent's full-suite run.

```bash
swift test --package-path .
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add Resources/Template/src/lib/schema.ts \
        Resources/Template/src/lib/schema.test.ts \
        Resources/Template/src/layouts/Hentry.astro \
        Resources/Template/src/layouts/BlogPost.astro
git commit -m "feat(#689): project content license into schema.org JSON-LD"
```

---

### Task 4: Emit Microformats2 `u-license`

**Files:**
- Create: `Resources/Template/src/components/LicenseLink.astro`
- Modify: `Resources/Template/src/layouts/Hentry.astro`
- Modify: `Resources/Template/src/layouts/BlogPost.astro`
- Modify: `Resources/Template/src/layouts/Hevent.astro`
- Modify: `Resources/Template/src/layouts/Hreview.astro`
- Modify: `Resources/Template/scripts/microformats.test.ts`

The anchor lives in a component rather than being pasted into four layouts, matching the existing `SyndicationLinks.astro` and `DraftBadge.astro` convention for small repeated entry markup.

`scripts/microformats.ts` needs **no change**: its validator reports missing required properties and does not gate on an allowlist, so an extra `u-license` inside an entry root parses as valid mf2 automatically. Don't go looking for a registration step.

**Interfaces:**
- Consumes: `licenseFor` from `licensing-data.ts`; the `license` local bound in Task 3 for `Hentry.astro`/`BlogPost.astro`.
- Produces: entry pages carry `<a class="u-license" href="…">` inside their entry root.

- [ ] **Step 1: Write the failing test**

Append to `Resources/Template/scripts/microformats.test.ts`:

```ts
test("findRoots: a u-license inside an h-entry parses as the entry's license property", () => {
  const html = `
    <article class="h-entry">
      <a class="u-url" href="/notes/hi/"><time class="dt-published" datetime="2026-01-02">Jan 2</time></a>
      <div class="e-content">Hi</div>
      <a class="u-license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
    </article>`;
  const roots = findRoots(html);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].properties.license, ["https://creativecommons.org/licenses/by/4.0/"]);
});

test("validateEntryHtml: a u-license does not make an otherwise valid entry invalid", () => {
  const html = `
    <article class="h-entry">
      <a class="u-url" href="/notes/hi/"><time class="dt-published" datetime="2026-01-02">Jan 2</time></a>
      <div class="e-content">Hi</div>
      <a class="u-license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
    </article>`;
  assert.deepEqual(validateEntryHtml(html, "notes/hi"), []);
});
```

Check the file's existing import line and extend it if `findRoots` or `validateEntryHtml` is not already imported:

```ts
import { findRoots, validateEntryHtml } from "./microformats.ts";
```

- [ ] **Step 2: Run it**

```bash
cd Resources/Template && npx tsx --test scripts/microformats.test.ts
```

Expected: PASS. These tests characterize parser behavior the markup relies on — they should pass before the layouts change, and their job is to fail loudly if a future validator change starts rejecting `u-license`. If `validateEntryHtml` reports a problem, stop: the validator is stricter than assumed and needs a fix before the layouts emit anything.

- [ ] **Step 3: Create the LicenseLink component**

Create `Resources/Template/src/components/LicenseLink.astro`:

```astro
---
// The entry's license, as Microformats2 `u-license` (#689). Rendered by the four entry
// layouts; a null license renders nothing, which is how a non-asserting collection stays
// silent. `rel="license"` is deliberate — it makes the anchor meaningful to plain HTML
// consumers as well as to mf2 parsers.
import type { LicenseRef } from "../lib/licensing.ts";

interface Props {
  license: LicenseRef | null;
}

const { license } = Astro.props;
---

{license && <a class="u-license" href={license.url} rel="license">{license.name}</a>}
```

- [ ] **Step 4: Render it from `Hentry.astro` and `BlogPost.astro`**

`license` is already bound in both from Task 3. In each, add the import beside the existing `SyndicationLinks` import:

```ts
import LicenseLink from "../components/LicenseLink.astro";
```

In `Hentry.astro`, add the element immediately before `<SyndicationLinks …>` inside `<article class="h-entry">`:

```astro
    <LicenseLink license={license} />
    <SyndicationLinks urls={d.syndication} />
```

In `BlogPost.astro`, the same, before its `<SyndicationLinks urls={syndication} />`:

```astro
    <LicenseLink license={license} />
    <SyndicationLinks urls={syndication} />
```

- [ ] **Step 5: Add the import, binding, and element to `Hevent.astro`**

Add both imports:

```ts
import { licenseFor } from "../lib/licensing-data.ts";
import LicenseLink from "../components/LicenseLink.astro";
```

Add the binding after the existing `jsonLd` line:

```ts
const license = licenseFor("events");
```

Add the element before `<SyndicationLinks …>` inside `<article class="h-event">`:

```astro
    <LicenseLink license={license} />
    <SyndicationLinks urls={d.syndication} />
```

- [ ] **Step 6: Add the import, binding, and element to `Hreview.astro`**

Same two imports:

```ts
import { licenseFor } from "../lib/licensing-data.ts";
import LicenseLink from "../components/LicenseLink.astro";
```

Binding after the existing `jsonLd` line:

```ts
const license = licenseFor("reviews");
```

Element before `<SyndicationLinks …>` inside `<article class="h-review">`:

```astro
    <LicenseLink license={license} />
    <SyndicationLinks urls={d.syndication} />
```

`reviews` is in `NON_ASSERTING_COLLECTIONS`, so this renders nothing unless the site owner explicitly overrides it. That is intended — the wiring exists so the override works.

- [ ] **Step 7: Verify end to end with a real license configured**

Temporarily set a site default so the markup actually renders:

```bash
cd Resources/Template
cat > src/data/licensing.json <<'JSON'
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": {}
}
JSON
npm run build
grep -rc 'u-license' dist/notes dist/blog 2>/dev/null
grep -rc 'u-license' dist/likes dist/bookmarks 2>/dev/null
```

Expected: the first `grep` reports a non-zero count for at least one file under `dist/notes` and `dist/blog`; the second reports `0` for every file under `dist/likes` and `dist/bookmarks` (they are non-asserting). `npm run build` runs `check-microformats.ts` over `dist`, so a passing build also proves the markup is valid mf2.

- [ ] **Step 8: Restore the scaffolded default**

```bash
cd Resources/Template
cat > src/data/licensing.json <<'JSON'
{
  "default": null,
  "collections": {}
}
JSON
npm run build
```

Expected: build passes, and no `u-license` appears anywhere in `dist`.

- [ ] **Step 9: Run both suites**

```bash
cd Resources/Template && npm test
swift test --package-path .
```

Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add Resources/Template/src/components/LicenseLink.astro \
        Resources/Template/src/layouts/Hentry.astro \
        Resources/Template/src/layouts/BlogPost.astro \
        Resources/Template/src/layouts/Hevent.astro \
        Resources/Template/src/layouts/Hreview.astro \
        Resources/Template/scripts/microformats.test.ts
git commit -m "feat(#689): emit u-license on entry layouts"
```

---

### Task 5: `<link rel="license">` and the footer rights statement

**Files:**
- Modify: `Resources/Template/src/layouts/BaseLayout.astro`
- Modify: `Resources/Template/src/layouts/Hentry.astro`, `BlogPost.astro`, `Hevent.astro`, `Hreview.astro` (pass the entry license through)
- Create: `Resources/Template/src/components/Rights.astro`
- Modify: `Resources/Template/scripts/config.test.ts`
- Modify: `Resources/Template/README.md`

The head link falls back to the **site default** on ordinary pages (index, about, 404) and is **overridden per entry** on collection pages, so a page never advertises a license that contradicts its own `u-license`. Astro's destructuring default fires only for `undefined`, which gives exactly the right three-way behavior: prop absent → site default; prop `null` → no link; prop set → that license.

**Interfaces:**
- Consumes: `siteLicense` from `licensing-data.ts`; `LicenseRef` from `licensing.ts`; `readConfig` from `scripts/config.ts`.
- Produces: `BaseLayout` `Props` gains `license?: LicenseRef | null`.

- [ ] **Step 1: Write the failing test for the copyright-holder config key**

Append to `Resources/Template/scripts/config.test.ts`:

```ts
test("readConfigFromString: reads COPYRIGHT_HOLDER", () => {
  assert.equal(
    readConfigFromString("SITE_NAME=Acme\nCOPYRIGHT_HOLDER=Ada Lovelace\n", "COPYRIGHT_HOLDER"),
    "Ada Lovelace",
  );
});

test("readConfigFromString: COPYRIGHT_HOLDER is undefined when absent", () => {
  assert.equal(readConfigFromString("SITE_NAME=Acme\n", "COPYRIGHT_HOLDER"), undefined);
});
```

- [ ] **Step 2: Run it**

```bash
cd Resources/Template && npx tsx --test scripts/config.test.ts
```

Expected: PASS. `readConfig` is generic over keys, so no `config.ts` change is needed — these tests pin `COPYRIGHT_HOLDER` as a documented key so a future refactor can't silently drop it.

- [ ] **Step 3: Create the Rights component**

Create `Resources/Template/src/components/Rights.astro`:

```astro
---
// Footer rights statement (#689). Renders the copyright holder and, when a license applies to
// this page, a link to it. The holder falls back to the h-card profile name so a site that has
// filled in its profile gets a correct notice without a second setting.
//
// The license arrives as a prop from BaseLayout — the *page's* resolved license, not the site
// default. A collection that overrides the default would otherwise make the footer contradict
// the page's own <link rel="license"> and u-license.
//
// No `u-license` class here: this anchor sits outside every microformat root, where the class
// would parse as nothing. `rel="license"` is the meaningful attribute at this position.
//
// Absent both a holder and a license this renders nothing at all — an empty <footer> would be
// worse than no footer, and asserting rights on a user's behalf is exactly what §Q3 of the
// design forbids.
import { readConfig } from "../../scripts/config";
import { ownerName } from "../lib/profile.ts";
import type { LicenseRef } from "../lib/licensing.ts";

interface Props {
  license: LicenseRef | null;
}

const { license } = Astro.props;
const holder = readConfig("COPYRIGHT_HOLDER") ?? ownerName();
const year = new Date().getFullYear();
---

{(holder || license) && (
  <footer class="site-rights">
    {holder && <span>© {year} {holder}</span>}
    {license && (
      <span>
        {holder && " · "}
        Licensed <a href={license.url} rel="license">{license.name}</a>
      </span>
    )}
  </footer>
)}
```

- [ ] **Step 4: Wire the head link and footer into BaseLayout**

In `Resources/Template/src/layouts/BaseLayout.astro`, extend the imports:

```ts
import "../styles/global.css";
import Hcard from "../components/Hcard.astro";
import Rights from "../components/Rights.astro";
import { readConfig } from "../../scripts/config";
import { siteLicense } from "../lib/licensing-data.ts";
import type { LicenseRef } from "../lib/licensing.ts";
```

> **Superseded during execution.** The Task 5 review found this destructuring-default form
> correct but untested — a later "simplification" to `license ?? siteLicense()` would silently
> collapse the `null`-vs-absent distinction. The shipped code instead calls a named, tested
> `headLicense(prop, siteDefault)` from `licensing.ts` (commit `53c17347`). The behavior is
> identical; the invariant is now explicit and guarded by tests.

Extend `Props` and the destructuring:

```ts
interface Props {
  title: string;
  description?: string;
  /**
   * The license this page advertises in <head>. Omit the prop to inherit the site default
   * (ordinary pages); pass null to advertise nothing (an entry in a non-asserting collection);
   * pass a ref to override (an entry with its own license).
   */
  license?: LicenseRef | null;
}

const { title, description, license = siteLicense() } = Astro.props;
```

Add the head link after the existing `indieauth-metadata` link:

```astro
    <link rel="indieauth-metadata" href="/.well-known/oauth-authorization-server" />
    {license && <link rel="license" href={license.url} title={license.name} />}
```

Add the footer in the body, after `<Hcard />`, passing the same resolved `license` the head link uses so the two can never disagree:

```astro
    <Hcard />
    <Rights license={license} />
    <!-- anglesite:body-end -->
```

- [ ] **Step 5: Pass the entry license through from the four entry layouts**

In each of the four layouts, add `license={license}` to the `<BaseLayout …>` opening tag. The `license` local already exists in all four from Tasks 3 and 4.

`Hentry.astro`:

```astro
<BaseLayout title={title ?? "Post"} description={d.summary} license={license}>
```

`BlogPost.astro`:

```astro
<BaseLayout title={title} description={description} license={license}>
```

`Hevent.astro`:

```astro
<BaseLayout title={d.name ?? "Event"} description={d.location} license={license}>
```

`Hreview.astro`:

```astro
<BaseLayout title={reviewName} license={license}>
```

Because `licenseFor` returns `LicenseRef | null` (never `undefined`), a non-asserting entry passes an explicit `null` and correctly suppresses the head link rather than falling back to the site default.

- [ ] **Step 6: Verify the three-way behavior end to end**

```bash
cd Resources/Template
cat > src/data/licensing.json <<'JSON'
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": {}
}
JSON
npm run build
grep -l 'rel="license"' dist/index.html
grep -c 'rel="license"' dist/likes/*/index.html
```

Expected: `dist/index.html` is listed (ordinary page inherits the site default), and the `likes` page reports `0` (non-asserting entry suppresses it). If `dist/likes/` has no entries in the scaffolded content, substitute `dist/bookmarks/`; if neither has content, add a throwaway entry under `src/content/likes/` for the check and delete it afterward.

- [ ] **Step 7: Restore the scaffolded default and rebuild**

```bash
cd Resources/Template
cat > src/data/licensing.json <<'JSON'
{
  "default": null,
  "collections": {}
}
JSON
npm run build
grep -rc 'rel="license"' dist/index.html
```

Expected: `0` — an unconfigured site advertises nothing.

- [ ] **Step 8: Document the feature**

Append to `Resources/Template/README.md`, as a new top-level section:

```markdown
## Content licensing

`src/data/licensing.json` declares the license applied to your content. It holds a site-wide
default plus optional per-collection overrides:

```json
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": {
    "photos": { "url": "https://creativecommons.org/licenses/by-nc/4.0/", "name": "CC BY-NC 4.0" },
    "notes": null
  }
}
```

- `"default": null` (the scaffolded value) means **all rights reserved** — nothing is emitted.
- A collection set to `null` asserts nothing, overriding the site default.
- `bookmarks`, `replies`, `likes`, and `reviews` assert nothing **by default**, because those
  entries are about someone else's work. Set an explicit override if you want a license on them.

The resolved license is emitted three ways: `license` in the page's schema.org JSON-LD,
`u-license` in the entry's Microformats2 markup, and `<link rel="license">` in `<head>`.
Set `COPYRIGHT_HOLDER` in `.site-config` to name the rights holder in the footer; it falls back
to your profile name.
```

- [ ] **Step 9: Run everything**

```bash
cd Resources/Template && npm test && npm run test:worker && npm run build
swift test --package-path .
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add Resources/Template/src/layouts/BaseLayout.astro \
        Resources/Template/src/layouts/Hentry.astro \
        Resources/Template/src/layouts/BlogPost.astro \
        Resources/Template/src/layouts/Hevent.astro \
        Resources/Template/src/layouts/Hreview.astro \
        Resources/Template/src/components/Rights.astro \
        Resources/Template/scripts/config.test.ts \
        Resources/Template/README.md
git commit -m "feat(#689): rel=license head link and footer rights"
```

---

## Verification before opening the PR

- [ ] `cd Resources/Template && npm test` — all `node:test` suites pass
- [ ] `cd Resources/Template && npm run test:worker` — worker suite passes
- [ ] `cd Resources/Template && npm run build` — `astro check`, build, and microformats validation pass
- [ ] `swift test --package-path .` — no template-coupled Swift test broke
- [ ] `git diff main --stat` — no file outside `Resources/Template/`, `.github/workflows/ci.yml`, and `docs/` changed
- [ ] `src/data/licensing.json` is committed with `"default": null` — the verification steps' temporary CC BY value must not ship
- [ ] Nothing in the diff emits RSL, `<legal>`, `<permits>`, or a `License:` robots directive — those are Phases 2 and 3
- [ ] PR body uses `.github/PULL_REQUEST_TEMPLATE.md`'s own headings — **Summary**, **Paired PR check**, **Test plan**. Paired PR check: none needed; this touches no MCP message schema.
- [ ] Remove the `🛠️ In Progress` label from #689 once the PR is open

## Spec coverage

| Spec requirement (Phase 1) | Task |
|---|---|
| `licensing.json` policy document | 2 |
| Per-collection resolution | 2 |
| Non-asserting collections default to no assertion | 2 |
| Never assert a license on the user's behalf (§Q3) | 2 (scaffolded `null`), 5 (footer renders nothing when unset) |
| schema.org `license` | 3 |
| mf2 `u-license` | 4 |
| `<link rel="license">` | 5 |
| Footer rights statement | 5 |
| Defensive parsing of hand-edited config | 2 (`normalizePolicy`) |

Phase 1 items with **no** task, by design: none. Phase 2 (`BLOCK_AI`/`CONTENT_SIGNALS` unification, settings UI) and Phase 3 (RSL) are separate plans.
