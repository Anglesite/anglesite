# Audience Field on Typed Content (#369, V-5.2a Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, federation-only `audience` field (a Group actor IRI) to the `note` and `article` typed-content types — template schema, content-type registry, and a locked (but unwired) projection to the future outbox `PostInput` shape — landing feature-inert until the V-4 outbox (#363) exists.

**Architecture:** `audience` is a third "no mf2/schema.org projection" field, following the exact precedent `draft` already sets on every post-family descriptor (present in `fields`, absent from `microformatProperties`). It threads through three existing layers with **zero new UI code**: the template's zod schema (build-time validation), `ContentTypeRegistry`'s declarative field list (drives the generic SwiftUI editor for free), and `TypedContentEditor`'s frontmatter round-trip (already generic per `Kind`). A new, currently-uncalled TypeScript mapping function (`postInputFor`) locks the future outbox contract with a unit test, per the issue's explicit ask to "record the contract ... now."

**Tech Stack:** Astro/Zod (`Resources/Template/`, tested via `node:test` + `npx tsx --test`), Swift 6.4 / Swift Testing (`AnglesiteCore`, `AnglesiteApp`).

## Global Constraints

- `notes` and `articles` collection schemas in `Resources/Template/src/content.config.ts` are `.strict()` — an unlisted key fails validation, so `audience` must be added as an explicit schema key, not inferred.
- `audience` carries **no mf2 or schema.org projection** — it must never appear in a `ContentTypeProjections.microformatProperties` map (mirrors the existing `draft` field, which the test `postFamilyHasDraft` in `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift` already locks as mf2-absent).
- `draft` must remain the **last** field in `note.fields` / `article.fields` — `postFamilyHasDraft` (same file) asserts `descriptor.fields.last?.name == "draft"` for both. Insert `audience` immediately **before** `draft`, not after.
- Template `*.test.ts` files are **not run by CI** (confirmed: no `test`/`test:template` script in `Resources/Template/package.json`, only `test:worker` which runs vitest against `worker/`). Run them explicitly with `npx tsx --test <file>` from `Resources/Template/` — this is a real gap, not a shortcut; state it plainly when reporting results rather than implying CI covers it.
- `content.config.ts` cannot be imported directly by a plain Node/`tsx` test — it imports `astro:content`, a Vite-only virtual module (confirmed by direct probe: `Error [ERR_UNSUPPORTED_ESM_URL_SCHEME] ... protocol 'astro:'`). `astro/zod` alone resolves fine outside Astro. Task 1 below extracts the two schemas being touched into a plain module for exactly this reason — this is a required consequence of the issue's own "zod round-trip via `npx tsx --test`" test strategy, not unrelated refactoring.
- Baseline `npx astro check` (from `Resources/Template/`) currently reports **1 pre-existing, unrelated error** (`worker/worker.ts:12` — `Cannot find module '@dwk/webmention'`) plus 13 hints and a handful of warnings about deprecated `z.string().url()` params (already present on `syndication`, `bookmarkOf`, `inReplyTo`, `likeOf`). Verification must confirm the error count/target stays exactly the same — do not treat that pre-existing error as something this change broke, and do not attempt to fix it (out of scope).
- Per `CONTRIBUTING.md` ▸ Testing: "If you touch `Resources/Template/`, run `swift test` too — some Swift tests couple to the template markup." Run the full `swift test --package-path .` after the template edits, not just a filtered subset.
- Per project memory, `swift test` alone does not prove the `.app` target links — run `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` too before calling this done.
- **No outbox wiring, no Worker calls, no new dependency.** `postInputFor` in Task 4 is a pure function that is not called from anywhere yet — it exists solely to lock the contract with a unit test, per the issue text. Do not add a call site.
- **Design decision — no new URL-validation UI.** The issue text says the editor field ships "with validation," but there is **no existing URL-format validation anywhere in the Swift editor stack** — `TypedEntryEditorModel.textBinding` is a pure passthrough, and `TypedContentEditor.decode`/`encode` treat `.url` identically to `.string`/`.text` (confirmed: `businessProfile.url` and `personalProfile.url` are today's only optional-URL fields, and both render as a plain, unvalidated `TextField`). Building bespoke validation UI from scratch is out of scope for this Stage-1/inert sub-issue — it would be new, unreviewed UI surface for a field nothing calls yet. This plan reuses the existing generic `.url`-kind `TextField` (zero new SwiftUI code), matching every other optional URL field in the app; the zod `.url()` schema is the actual validation backstop, at build time, exactly as it is for every other URL field in `content.config.ts` today. If real-time in-editor validation is wanted later, it should land as its own follow-up applying to all `.url` fields at once, not a one-off for `audience`.
- Conventional commit subjects, ≤72 chars, reference `#369` (see `CONTRIBUTING.md` ▸ "Commits and pull requests").

---

### Task 1: Template schema — extract + add `audience` to notes/articles

**Files:**
- Create: `Resources/Template/src/lib/content-schemas.ts`
- Create: `Resources/Template/src/lib/content-schemas.test.ts`
- Modify: `Resources/Template/src/content.config.ts:1-63`

**Interfaces:**
- Produces: `socialFields` (the existing shared social-metadata field map, relocated verbatim), `notesSchema: ZodObject`, `articlesSchema: ZodObject` — all exported from `content-schemas.ts`. `content.config.ts` consumes these three names.

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/content-schemas.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { notesSchema, articlesSchema } from "./content-schemas.ts";

test("notes: audience is optional — omitting it parses exactly as before", () => {
  const parsed = notesSchema.parse({ publishDate: "2026-01-01" });
  assert.equal(parsed.audience, undefined);
});

test("notes: a valid audience URL round-trips", () => {
  const parsed = notesSchema.parse({
    publishDate: "2026-01-01",
    audience: "https://community.example/c/local",
  });
  assert.equal(parsed.audience, "https://community.example/c/local");
});

test("notes: a non-URL audience value fails validation", () => {
  assert.throws(() => notesSchema.parse({ publishDate: "2026-01-01", audience: "not-a-url" }));
});

test("notes: an unrelated unknown key still fails under .strict()", () => {
  assert.throws(() => notesSchema.parse({ publishDate: "2026-01-01", bogus: "x" }));
});

test("articles: a valid audience URL round-trips alongside required fields", () => {
  const parsed = articlesSchema.parse({
    title: "Hello",
    publishDate: "2026-01-01",
    audience: "https://community.example/c/local",
  });
  assert.equal(parsed.audience, "https://community.example/c/local");
});

test("articles: audience is optional — omitting it parses exactly as before", () => {
  const parsed = articlesSchema.parse({ title: "Hello", publishDate: "2026-01-01" });
  assert.equal(parsed.audience, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `Resources/Template/`): `npx tsx --test src/lib/content-schemas.test.ts`
Expected: FAIL — `Cannot find module './content-schemas.ts'` (module doesn't exist yet).

- [ ] **Step 3: Create `content-schemas.ts`**

Create `Resources/Template/src/lib/content-schemas.ts`:

```ts
import { z } from "astro/zod";

/**
 * Schemas that need to be unit-testable with plain `npx tsx --test`, which can't resolve the
 * `astro:content` virtual module `content.config.ts` otherwise depends on (confirmed: importing
 * `astro:content` outside Astro's Vite pipeline throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`). Kept
 * deliberately narrow to `notes`/`articles` — the two collections V-5.2a (#369) touches — rather
 * than relocating every collection schema.
 */

// Shared outbound-social metadata. POSSE is explicit per entry; `syndication` is written back by
// Anglesite after the remote APIs return and is projected as u-syndication by the layouts.
export const socialFields = {
  posse: z.array(z.string()).optional(),
  syndicateTo: z.array(z.string()).optional(),
  "syndicate-to": z.array(z.string()).optional(),
  posseText: z.string().optional(),
  socialText: z.string().optional(),
  syndication: z.array(z.string().url()).optional(),
};

/**
 * `audience` (a Group actor IRI) is optional and carries no mf2/schema.org projection — it only
 * affects federation once the V-4 outbox (#363) exists (V-5, #339, Stage 1: #369). A site built
 * outside Anglesite renders identically with or without it.
 */
export const notesSchema = z.object({
  ...socialFields,
  publishDate: z.coerce.date(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();

export const articlesSchema = z.object({
  ...socialFields,
  title: z.string(),
  summary: z.string().optional(),
  publishDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/content-schemas.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire `content.config.ts` to the extracted schemas**

In `Resources/Template/src/content.config.ts`, replace the local `socialFields` const (lines 17–26) and the `notes`/`articles` blocks (lines 42–63) as follows.

Delete the local `socialFields` const block (lines 17–26) entirely:
```ts
// Shared outbound-social metadata. POSSE is explicit per entry; `syndication` is written back by
// Anglesite after the remote APIs return and is projected as u-syndication by the layouts.
const socialFields = {
  posse: z.array(z.string()).optional(),
  syndicateTo: z.array(z.string()).optional(),
  "syndicate-to": z.array(z.string()).optional(),
  posseText: z.string().optional(),
  socialText: z.string().optional(),
  syndication: z.array(z.string().url()).optional(),
};
```
and add a new import next to the existing imports at the top of the file (see the full resulting top-of-file below).

Replace:
```ts
const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
  schema: z.object({
    ...socialFields,
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }).strict(),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: z.object({
    ...socialFields,
    title: z.string(),
    summary: z.string().optional(),
    publishDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }).strict(),
});
```
with:
```ts
const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
  schema: notesSchema,
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: articlesSchema,
});
```

The resulting top of `content.config.ts` (lines 1–16) should read:
```ts
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { readConfig } from "../scripts/config.ts";
import { createContentAPILoader } from "./lib/content-loader";
import { socialFields, notesSchema, articlesSchema } from "./lib/content-schemas.ts";

/**
 * Picks the CMS content-API loader when `.site-config`'s `CMS_CONTENT_API_URL` is set (CMS mode,
 * slice 4), otherwise the existing `glob()` loader (today's behavior, unchanged for every
 * un-provisioned site). Same zod schema validates entries from either loader (#799 §C.4).
 */
function collectionLoader(name: string) {
  const apiURL = readConfig("CMS_CONTENT_API_URL");
  return apiURL ? createContentAPILoader(name, { apiURL }) : glob({ pattern: "**/*.md", base: `./src/content/${name}` });
}
```
`z` is still used later in the file (`blog`, `photos`, `albums`, etc.), so keep that import. `socialFields` is still used by every other collection's inline schema (`blog`, `photos`, `albums`, `bookmarks`, `replies`, `likes`, `announcements`, `events`, `reviews`, `members`) — only its *declaration* moved, every other usage site is unchanged.

- [ ] **Step 6: Verify the template still typechecks**

Run (from `Resources/Template/`): `npx astro check`
Expected: same baseline as today — **1 error** (`worker/worker.ts:12`, `Cannot find module '@dwk/webmention'`, pre-existing and unrelated), 13 hints, and one additional deprecated-`.url()`-params warning on the new `audience` line (consistent with the 4 that already exist on `syndication`/`bookmarkOf`/`inReplyTo`/`likeOf` — not a regression). No new **errors**, and no errors at all in `content.config.ts` or `content-schemas.ts`.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/src/content.config.ts Resources/Template/src/lib/content-schemas.ts Resources/Template/src/lib/content-schemas.test.ts
git commit -m "feat(template): add audience field to notes/articles (#369)"
```

---

### Task 2: Content-type registry — `audience` on Note/Article descriptors

**Files:**
- Modify: `Sources/AnglesiteCore/ContentTypeRegistry.swift:204-250`
- Test: `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`

**Interfaces:**
- Consumes: `ContentTypeField(_ name: String, _ kind: Kind, required: Bool = false)`, `Kind.url` — both already defined in this file (lines 21–43).
- Produces: `ContentTypeRegistry.note` and `.article` each gain a `ContentTypeField("audience", .url)` entry, positioned immediately before `draft`; `ContentTypeProjections.microformatProperties` for both is unchanged (no `"audience"` key).

- [ ] **Step 1: Write the failing test**

Add to `Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift`, immediately after the existing `postFamilyHasDraft` test (after line 182, still inside the `struct ContentTypeRegistryTests`):

```swift
    @Test("note and article carry an optional, mf2-inert audience field (V-5.2a, #369)")
    func audienceFieldIsInert() {
        let registry = ContentTypeRegistry()
        for id in ["note", "article"] {
            let descriptor = try! #require(registry.descriptor(id: id))
            let audience = try! #require(descriptor.fields.first { $0.name == "audience" },
                                          "\(id): missing audience field")
            #expect(audience.kind == .url, "\(id): audience should be .url")
            #expect(!audience.required, "\(id): audience should be optional")
            #expect(descriptor.projections.microformatProperties["audience"] == nil,
                    "\(id): audience has no mf2 projection — federation only, per #369")
            #expect(descriptor.fields.last?.name == "draft",
                    "\(id): draft must stay the trailing field")
        }
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: FAIL — `audienceFieldIsInert` fails `#require` (no field named "audience" on either descriptor).

- [ ] **Step 3: Add the field to `note` and `article`**

In `Sources/AnglesiteCore/ContentTypeRegistry.swift`, in the `note` descriptor (lines 204–223), change the `fields:` array:

```swift
        fields: [
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("audience", .url),
            ContentTypeField("draft", .bool),
        ],
```

In the `article` descriptor (lines 225–250), change the `fields:` array:

```swift
        fields: [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("summary", .text),
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("updated", .datetime),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("audience", .url),
            ContentTypeField("draft", .bool),
        ],
```

Leave both `projections:` blocks (mf2/schema.org) exactly as they are — no key for `audience`.

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter ContentTypeRegistryTests`
Expected: PASS, including `audienceFieldIsInert`, `postFamilyHasDraft` (unaffected — `draft` is still last), and `builtInInvariants` (unaffected — `audience` isn't in any mf2 map, so the "every mapped field exists" check has nothing new to fail on).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/ContentTypeRegistry.swift Tests/AnglesiteCoreTests/ContentTypeRegistryTests.swift
git commit -m "feat(content-types): add audience field to note/article (#369)"
```

---

### Task 3: `TypedContentEditor` round-trip coverage for `audience`

**Files:**
- Test: `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`

**Interfaces:**
- Consumes: `TypedContentEditor.read(_:descriptor:) -> Values`, `TypedContentEditor.write(_:into:descriptor:) -> String`, `TypedContentEditor.FieldValue.text(String)` — all already defined in `Sources/AnglesiteCore/TypedContentEditor.swift`; no production code changes in this task (`.url` already decodes/encodes identically to `.string`/`.text`, confirmed at `TypedContentEditor.swift` lines ~90 and ~113). This task's test locks that already-generic behavior explicitly for `audience`, satisfying the issue's "round-trips through its editor" acceptance line.

- [ ] **Step 1: Write the test**

Add to `Tests/AnglesiteCoreTests/TypedContentEditorTests.swift`, inside `struct TypedContentEditorTests` (e.g. after the `reads()` test):

```swift
    @Test("audience round-trips through the editor like any other optional url field")
    func audienceRoundTrips() {
        let src = "---\npublishDate: 2026-01-02T03:04:05.000Z\n---\n\nHello.\n"

        // absent in the source -> empty default, same as every other optional scalar
        let read = TypedContentEditor.read(src, descriptor: note)
        #expect(read["audience"] == .text(""))

        // editing it writes a quoted scalar and round-trips back to the same value
        var v = read
        v["audience"] = .text("https://community.example/c/local")
        let out = TypedContentEditor.write(v, into: src, descriptor: note)
        #expect(out.contains("audience: \"https://community.example/c/local\""))
        #expect(TypedContentEditor.read(out, descriptor: note)["audience"]
                == .text("https://community.example/c/local"))

        // leaving it untouched writes nothing new for it
        var unchanged = read
        unchanged["publishDate"] = read["publishDate"]!
        let out2 = TypedContentEditor.write(unchanged, into: src, descriptor: note)
        #expect(!out2.contains("audience:"))
    }
```

- [ ] **Step 2: Run test to verify it passes**

Run: `swift test --package-path . --filter TypedContentEditorTests`
Expected: PASS immediately — this locks existing generic `.url`-kind behavior, no implementation step needed. If it fails, stop and re-examine `TypedContentEditor.decode`/`encode`'s `.url` case (Task 2's field addition would be the only thing that could newly affect this, and it shouldn't).

- [ ] **Step 3: Commit**

```bash
git add Tests/AnglesiteCoreTests/TypedContentEditorTests.swift
git commit -m "test(content-types): lock audience field editor round-trip (#369)"
```

---

### Task 4: `PostInput` projection contract (mapping function + unit test)

**Files:**
- Create: `Resources/Template/src/lib/post-input.ts`
- Create: `Resources/Template/src/lib/post-input.test.ts`

**Interfaces:**
- Produces: `interface PostInput { audience: string; kind: "note" | "page"; name?: string; content: string }`, `interface AudiencePostEntry { audience?: string; title?: string; body: string }`, `function postInputFor(entry: AudiencePostEntry): PostInput | null`. Not imported or called anywhere yet — deliberately unwired until #363 lands (see Global Constraints).

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/src/lib/post-input.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { postInputFor } from "./post-input.ts";

test("an entry with no audience projects to null (federation-inert, the default today)", () => {
  assert.equal(postInputFor({ body: "hello" }), null);
});

test("a note (no title) with audience projects to kind: note", () => {
  const result = postInputFor({ audience: "https://community.example/c/local", body: "hello" });
  assert.deepEqual(result, {
    audience: "https://community.example/c/local",
    kind: "note",
    content: "hello",
  });
});

test("an article (has a title) with audience projects to kind: page + name, for Lemmy-style targets", () => {
  const result = postInputFor({
    audience: "https://community.example/c/local",
    title: "Hello World",
    body: "hello",
  });
  assert.deepEqual(result, {
    audience: "https://community.example/c/local",
    kind: "page",
    name: "Hello World",
    content: "hello",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `Resources/Template/`): `npx tsx --test src/lib/post-input.test.ts`
Expected: FAIL — `Cannot find module './post-input.ts'`.

- [ ] **Step 3: Write the mapping function**

Create `Resources/Template/src/lib/post-input.ts`:

```ts
/**
 * Maps a note/article entry's `audience` field (a Group actor IRI) to the shape the V-4 outbox
 * Worker's `PostInput` expects for community federation (V-5.2a, #369 — Stage 1, inert until the
 * V-4 outbox lands, #363).
 *
 * `PostInput` itself is defined in the sibling `davidwkeith/workers` repo, gated behind a
 * conformant `@dwk/workers` release (AGENTS.md "Personal Publishing OS pivot"). Nothing here
 * calls a Worker — this only locks the mapping contract from the design spike
 * (docs/superpowers/specs/2026-07-22-v5-communities-design.md §3): "audience set, Group in `to`,
 * and `kind: 'page'` + title for Lemmy-style targets that require a `name`."
 */

/** The subset of the Worker's `PostInput` this projection populates. */
export interface PostInput {
  audience: string;
  kind: "note" | "page";
  name?: string;
  content: string;
}

/** The fields of a note/article entry this projection reads. */
export interface AudiencePostEntry {
  audience?: string;
  title?: string;
  body: string;
}

/**
 * `null` when the entry has no `audience` — the common case until a member actually posts to a
 * community. Title-bearing entries (articles) map to `kind: "page"` + `name` so Lemmy-style
 * targets requiring a title accept the post; untitled entries (notes) stay `kind: "note"`.
 */
export function postInputFor(entry: AudiencePostEntry): PostInput | null {
  if (!entry.audience) return null;
  if (entry.title) {
    return { audience: entry.audience, kind: "page", name: entry.title, content: entry.body };
  }
  return { audience: entry.audience, kind: "note", content: entry.body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/post-input.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the template still typechecks**

Run: `npx astro check`
Expected: same as Task 1 Step 6 — 1 pre-existing unrelated error, no new errors.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/src/lib/post-input.ts Resources/Template/src/lib/post-input.test.ts
git commit -m "feat(template): lock PostInput projection contract for audience (#369)"
```

---

### Task 5: Full verification sweep

No new files or code in this task — it confirms Tasks 1–4 together satisfy the issue's acceptance line ("a note with `audience` builds unchanged, round-trips through its editor, and the `PostInput` mapping test locks the projection") and that nothing else broke.

- [ ] **Step 1: Template tests (not covered by CI — run explicitly)**

From `Resources/Template/`:
```bash
npx tsx --test src/lib/content-schemas.test.ts src/lib/post-input.test.ts
npx astro check
```
Expected: both test files pass in full; `astro check` shows the same 1 pre-existing `@dwk/webmention` error and no new errors.

- [ ] **Step 2: Full Swift test suite**

From the repo root:
```bash
swift test --package-path .
```
Expected: full pass, including `AnglesiteCoreTests` (both the registry and editor changes) and every template-markup-coupled suite (Task 1 touched `Resources/Template/`).

- [ ] **Step 3: App target build**

From the repo root:
```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```
Expected: `BUILD SUCCEEDED`. This proves `TypedEntryEditorView`'s generic `.url`-kind renderer compiles and links against the new `audience` field with zero code changes to that file (see Global Constraints — no new UI code was written).

- [ ] **Step 4: Report results**

Summarize pass/fail for each command above. If anything fails, stop and diagnose per `superpowers:systematic-debugging` rather than proceeding to PR — do not silently skip a failing check.

No commit for this task (verification only).
