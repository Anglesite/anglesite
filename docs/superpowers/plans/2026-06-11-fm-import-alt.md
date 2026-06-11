# On-device Alt Text for Imported Images (`ai-alt` pass) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `npm run ai-alt` pass that drafts on-device alt text for any image (including `.webp`) into `image-alt.json`, and wire `/anglesite:import` + `/anglesite:convert` to use it so imported images that lack alt get drafts — reusing slice 1's `fm.ts` + catalog.

**Architecture:** Extract slice 1's per-image alt block into a shared `draftAltForImage` helper in `fm.ts`; `optimize-images.ts` calls it (behavior-preserving DRY refactor); a new `draft-alt.ts` script walks `public/images/` including `.webp` and drafts via the same helper. Import/convert run `ai-alt` after downloading images and read drafts from the catalog when source alt is missing. Authoring-time only; falls back to today's behavior when `fm` is absent. Reuses ADR-0021 — no new ADR.

**Tech Stack:** TypeScript (strict, ESM), Node `node:fs`/`node:path`, Vitest 3, the existing `template/scripts/fm.ts` (`generateAltText`, catalog helpers, `isFmAvailable`, `shouldRunAltPass`, `FM_MODEL_ID`) and `template/scripts/config.ts` (`readConfig`).

**Spec:** `docs/superpowers/specs/2026-06-11-fm-import-alt-design.md`

---

## File Structure

- **Modify:** `template/scripts/fm.ts` — add `draftAltForImage` (extract the per-image alt block, in one place for both callers).
- **Modify:** `tests/fm.test.ts` — tests for `draftAltForImage`.
- **Modify:** `template/scripts/optimize-images.ts` — call `draftAltForImage`; trim now-unused imports.
- **Create:** `template/scripts/draft-alt.ts` — `getAltCandidateFiles` + `isAltCandidate` + `main()` for `npm run ai-alt`.
- **Create:** `tests/draft-alt.test.ts` — tests for `getAltCandidateFiles`/`isAltCandidate`.
- **Modify:** `template/package.json` — add the `ai-alt` script.
- **Modify:** `skills/import/SKILL.md`, `skills/convert/SKILL.md`, `skills/optimize-images/SKILL.md`, `template/docs/workflows/optimize-images.md`, `CLAUDE.md` (root) — documentation.

---

## Task 1: `draftAltForImage` shared helper

**Files:**
- Modify: `template/scripts/fm.ts`
- Test: `tests/fm.test.ts`

`fm.ts` already exports `generateAltText`, `catalogKeyFor`, `needsAltDraft`, `mergeAltEntry`, `FM_MODEL_ID`, `type AltCatalog`, `type CommandRunner`. This helper composes them. READ the end of `fm.ts` first to confirm those names.

- [ ] **Step 1: Write the failing tests**

In `tests/fm.test.ts`, add `draftAltForImage` and `type AltCatalog` (if not already) to the top import from `../template/scripts/fm.js`. Append:

```ts
describe("draftAltForImage", () => {
  it("drafts and merges a draft entry for a missing key", async () => {
    const catalog: AltCatalog = {};
    const run: CommandRunner = async () => ({ stdout: "A red barn", exitCode: 0 });
    const alt = await draftAltForImage(catalog, "/site/public", "/site/public/images/x.webp", run);
    expect(alt).toBe("A red barn");
    expect(catalog["/images/x.webp"]).toMatchObject({
      alt: "A red barn",
      model: "apple-fm-system",
      status: "draft",
    });
    expect(catalog["/images/x.webp"].generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("returns null and does not overwrite a reviewed entry", async () => {
    const catalog: AltCatalog = {
      "/images/x.webp": { alt: "kept", model: "m", generatedAt: "2026-01-01", status: "reviewed" },
    };
    const run: CommandRunner = async () => ({ stdout: "new", exitCode: 0 });
    const alt = await draftAltForImage(catalog, "/site/public", "/site/public/images/x.webp", run);
    expect(alt).toBeNull();
    expect(catalog["/images/x.webp"].alt).toBe("kept");
  });
  it("re-drafts when the existing entry is a draft", async () => {
    const catalog: AltCatalog = {
      "/images/x.webp": { alt: "old", model: "m", generatedAt: "2026-01-01", status: "draft" },
    };
    const run: CommandRunner = async () => ({ stdout: "fresh", exitCode: 0 });
    const alt = await draftAltForImage(catalog, "/site/public", "/site/public/images/x.webp", run);
    expect(alt).toBe("fresh");
    expect(catalog["/images/x.webp"].alt).toBe("fresh");
  });
  it("returns null when generateAltText yields nothing (non-zero exit)", async () => {
    const catalog: AltCatalog = {};
    const run: CommandRunner = async () => ({ stdout: "", exitCode: 1 });
    const alt = await draftAltForImage(catalog, "/site/public", "/site/public/images/x.webp", run);
    expect(alt).toBeNull();
    expect(catalog["/images/x.webp"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fm.test.ts -t "draftAltForImage"`
Expected: FAIL — `draftAltForImage` is not exported.

- [ ] **Step 3: Implement the helper**

In `template/scripts/fm.ts`, append after `generateAltText` (at the end of the file):

```ts
/**
 * Draft alt text for one image and merge it into the catalog as a `draft`,
 * unless the image already has a usable entry (draft or reviewed-protected).
 * Shared by `ai-optimize` (source images) and `ai-alt` (all images incl. webp).
 * Returns the drafted alt, or null if skipped or generation failed.
 */
export async function draftAltForImage(
  catalog: AltCatalog,
  publicDir: string,
  absImagePath: string,
  run?: CommandRunner,
): Promise<string | null> {
  const key = catalogKeyFor(publicDir, absImagePath);
  if (!needsAltDraft(catalog, key)) return null;
  const alt = await generateAltText(absImagePath, run);
  if (!alt) return null;
  mergeAltEntry(catalog, key, {
    alt,
    model: FM_MODEL_ID,
    generatedAt: new Date().toISOString().slice(0, 10),
    status: "draft",
  });
  return alt;
}
```

Note: passing `run` through to `generateAltText(absImagePath, run)` works even when `run` is `undefined` — `generateAltText`'s default parameter (`defaultRunner`) applies. `new Date()` is fine here (normal template script).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all prior `fm.test.ts` tests plus the 4 new `draftAltForImage` cases.

- [ ] **Step 5: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): draftAltForImage shared alt-drafting helper"
```

---

## Task 2: refactor `optimize-images.ts` to use the helper

**Files:**
- Modify: `template/scripts/optimize-images.ts`

Behavior-preserving DRY refactor. No new unit test (the helper is tested in Task 1; `optimize-images`'s own tests cover the pure helpers and stay green). READ the file's current fm import block (around line 13) and the alt block in `main()` first.

- [ ] **Step 1: Trim the fm import to what's still used**

Replace the existing `import { ... } from "./fm.js";` block (currently importing `isFmAvailable`, `generateAltText`, `catalogKeyFor`, `readCatalog`, `writeCatalog`, `needsAltDraft`, `mergeAltEntry`, `shouldRunAltPass`, `FM_MODEL_ID`, `type AltCatalog`) with:

```ts
import {
  isFmAvailable,
  readCatalog,
  writeCatalog,
  shouldRunAltPass,
  draftAltForImage,
  type AltCatalog,
} from "./fm.js";
```

(Removed `generateAltText`, `catalogKeyFor`, `needsAltDraft`, `mergeAltEntry`, `FM_MODEL_ID` — they're now only used inside `draftAltForImage`.)

- [ ] **Step 2: Replace the inline alt block in the loop**

In `main()`, find the per-image alt block inside the `for (const file of files)` loop. It currently reads:

```ts
    // Draft alt sequentially: `fm` drives a single on-device model, so
    // concurrent calls would contend on the same hardware, not speed up.
    if (fmReady) {
      const primaryAbs = join(dirname(file), result.primary);
      const key = catalogKeyFor(publicDir, primaryAbs);
      if (needsAltDraft(catalog, key)) {
        const alt = await generateAltText(primaryAbs);
        if (alt) {
          mergeAltEntry(catalog, key, {
            alt,
            model: FM_MODEL_ID,
            generatedAt: new Date().toISOString().slice(0, 10),
            status: "draft",
          });
          altDrafted++;
          console.log(`    alt draft: ${alt}`);
        }
      }
    }
```

Replace it with:

```ts
    // Draft alt sequentially: `fm` drives a single on-device model, so
    // concurrent calls would contend on the same hardware, not speed up.
    if (fmReady) {
      const primaryAbs = join(dirname(file), result.primary);
      const alt = await draftAltForImage(catalog, publicDir, primaryAbs);
      if (alt) {
        altDrafted++;
        console.log(`    alt draft: ${alt}`);
      }
    }
```

If the existing block differs slightly, preserve the real structure and make the equivalent substitution (replace the `catalogKeyFor`/`needsAltDraft`/`generateAltText`/`mergeAltEntry` sequence with the single `draftAltForImage` call, keeping the `altDrafted++` and log).

- [ ] **Step 3: Verify no behavior change and types check**

Run: `npx vitest run`
Expected: same 5 pre-existing `sharp`/mcp failures as baseline; `tests/optimize-images.test.ts` and `tests/fm.test.ts` green. No NEW failures.

Run: `npx tsc --noEmit -p template/tsconfig.json` (best-effort — if `template/node_modules` is absent and tsc can't run, note it and rely on vitest). Expected: no NEW errors in `optimize-images.ts` (no unused-import errors from the trimmed list).

- [ ] **Step 4: Commit**

```bash
git add template/scripts/optimize-images.ts
git commit -m "refactor(template): optimize-images uses draftAltForImage helper"
```

---

## Task 3: standalone `draft-alt.ts` + `ai-alt` script

**Files:**
- Create: `template/scripts/draft-alt.ts`
- Test: `tests/draft-alt.test.ts`
- Modify: `template/package.json`

- [ ] **Step 1: Write the failing tests for the file walk**

Create `tests/draft-alt.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAltCandidate, getAltCandidateFiles } from "../template/scripts/draft-alt.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isAltCandidate", () => {
  it("accepts raster and webp/avif", () => {
    expect(isAltCandidate("/x/photo.jpg")).toBe(true);
    expect(isAltCandidate("/x/photo.PNG")).toBe(true);
    expect(isAltCandidate("/x/photo.webp")).toBe(true);
    expect(isAltCandidate("/x/photo.avif")).toBe(true);
    expect(isAltCandidate("/x/photo.heic")).toBe(true);
  });
  it("rejects svg and generated filenames", () => {
    expect(isAltCandidate("/x/logo.svg")).toBe(false);
    expect(isAltCandidate("/x/favicon.svg")).toBe(false);
    expect(isAltCandidate("/x/og-image.png")).toBe(false);
    expect(isAltCandidate("/x/apple-touch-icon.png")).toBe(false);
  });
  it("rejects non-images", () => {
    expect(isAltCandidate("/x/readme.md")).toBe(false);
  });
});

describe("getAltCandidateFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alt-cand-"));
    mkdirSync(join(dir, "sub"), { recursive: true });
    mkdirSync(join(dir, "originals"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("includes webp and recurses subdirs, excludes svg/generated/originals", () => {
    writeFileSync(join(dir, "a.webp"), "");
    writeFileSync(join(dir, "b.png"), "");
    writeFileSync(join(dir, "logo.svg"), "");
    writeFileSync(join(dir, "og-image.png"), "");
    writeFileSync(join(dir, "sub", "c.jpg"), "");
    writeFileSync(join(dir, "originals", "d.jpg"), "");
    const files = getAltCandidateFiles(dir).map((f) => f.replace(dir + "/", "")).sort();
    expect(files).toEqual(["a.webp", "b.png", "sub/c.jpg"]);
  });
  it("returns [] for a missing directory", () => {
    expect(getAltCandidateFiles(join(dir, "nope"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/draft-alt.test.ts`
Expected: FAIL — `Cannot find module '../template/scripts/draft-alt.js'`.

- [ ] **Step 3: Create `template/scripts/draft-alt.ts`**

```ts
/**
 * Standalone on-device alt-text pass. Walks public/images/ — INCLUDING already
 * optimized .webp — and drafts alt text into image-alt.json for any image
 * lacking a catalog entry. Complements `ai-optimize` (which only drafts for
 * freshly-optimized source images), and serves imported images + backfill.
 * Run via `npm run ai-alt`. Authoring-time only; falls back silently when `fm`
 * is unavailable. See docs/decisions/0021-on-device-ai-accelerator.md.
 *
 * @module
 */

import { existsSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { readConfig } from "./config.js";
import {
  isFmAvailable,
  readCatalog,
  writeCatalog,
  shouldRunAltPass,
  draftAltForImage,
} from "./fm.js";

const ALT_CANDIDATE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".tiff", ".tif", ".heif", ".heic", ".webp", ".avif",
]);
const SKIP_FILENAMES = new Set([
  "apple-touch-icon.png",
  "og-image.png",
  "favicon.svg",
]);

export function isAltCandidate(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!ALT_CANDIDATE_EXTENSIONS.has(ext)) return false;
  if (SKIP_FILENAMES.has(basename(filePath))) return false;
  return true;
}

export function getAltCandidateFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "originals") continue;
      out.push(...getAltCandidateFiles(full));
    } else if (entry.isFile() && isAltCandidate(full)) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const publicDir = join(cwd, "public");
  const imagesDir = join(publicDir, "images");
  if (!existsSync(imagesDir)) {
    console.log("No public/images/ — nothing to draft alt for.");
    return;
  }
  const noAltFlag = process.argv.includes("--no-alt");
  if (!shouldRunAltPass({ noAltFlag, altTextAiConfig: readConfig("ALT_TEXT_AI") })) {
    console.log("Alt-text drafting is disabled (ALT_TEXT_AI=off or --no-alt).");
    return;
  }
  if (!(await isFmAvailable())) {
    console.log("On-device alt drafting unavailable (fm not present). Skipping.");
    return;
  }
  const files = getAltCandidateFiles(imagesDir);
  const catalogPath = join(cwd, "image-alt.json");
  const catalog = readCatalog(catalogPath);
  let drafted = 0;
  for (const file of files) {
    const alt = await draftAltForImage(catalog, publicDir, file);
    if (alt) {
      drafted++;
      console.log(`  ${file.replace(cwd + "/", "")}: ${alt}`);
    }
  }
  if (drafted > 0) {
    writeCatalog(catalogPath, catalog);
    console.log(
      `Drafted alt text for ${drafted} image(s) → image-alt.json (review before publishing).`,
    );
  } else {
    console.log("No new images needed alt text.");
  }
}

if (process.argv[1]?.endsWith("draft-alt.ts")) {
  await main();
}
```

- [ ] **Step 4: Add the npm script**

In `template/package.json`, add to `scripts` (next to `"ai-optimize"`):

```json
    "ai-alt": "tsx scripts/draft-alt.ts",
```

(Ensure valid JSON — trailing comma only if another entry follows.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/draft-alt.test.ts`
Expected: PASS — `isAltCandidate` and `getAltCandidateFiles` cases green.

Run: `npx vitest run`
Expected: only the 5 pre-existing `sharp`/mcp failures, no new ones.

- [ ] **Step 6: Manual real-`fm` smoke (Mac only, best-effort)**

```bash
rm -rf /tmp/alt-smoke && mkdir -p /tmp/alt-smoke/public/images
# write a small real webp via sharp from the repo, or a precomputed one:
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
const b64='UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==';
writeFileSync('/tmp/alt-smoke/public/images/x.webp', Buffer.from(b64,'base64'));
"
cd /tmp/alt-smoke && npx tsx /Users/dwk/Developer/github.com/Anglesite/anglesite/template/scripts/draft-alt.ts
echo '--- catalog ---'; cat /tmp/alt-smoke/image-alt.json 2>/dev/null || echo '(none written)'
rm -rf /tmp/alt-smoke
```
Expected on a capable Mac: `image-alt.json` has an entry keyed `/images/x.webp` with `"status": "draft"` and a non-empty alt — proving the `.webp` path drafts (which `ai-optimize` would have skipped). Report the actual output. On non-Mac: the script prints the "fm not present" notice and writes nothing — note it.

- [ ] **Step 7: Commit**

```bash
git add template/scripts/draft-alt.ts tests/draft-alt.test.ts template/package.json
git commit -m "feat(template): ai-alt standalone on-device alt pass (incl. webp)"
```

---

## Task 4: documentation — import/convert/optimize skills + CLAUDE.md

**Files:**
- Modify: `skills/import/SKILL.md`
- Modify: `skills/convert/SKILL.md`
- Modify: `skills/optimize-images/SKILL.md`
- Modify: `template/docs/workflows/optimize-images.md`
- Modify: `CLAUDE.md` (root)

READ each file before editing.

- [ ] **Step 1: Wire `ai-alt` into the import skill**

First, grant the permission to run it. In `skills/import/SKILL.md`, the `allowed-tools` frontmatter lists specific Bash commands (e.g. `"Bash(npm run build)"`, `"Bash(npm install)"`) with no `npm run *` wildcard. Add `"Bash(npm run ai-alt)"` to that array (next to the other `npm run` entries). Do the same in Task 4 Step 2 for the convert skill.

Then, in `skills/import/SKILL.md`, find "### 2c — Download and optimize images". At the END of that section (after the inline-images paragraph, before "### 2d"), add:

```markdown
**Draft missing alt text (on-device).** After the images for this import are
downloaded, run `npm run ai-alt` once. On an Apple-Silicon Mac with Apple
Intelligence enabled, it drafts alt text **on-device** (nothing is uploaded)
for every image lacking one — including the `.webp` files just created — into
`image-alt.json`. On any other machine it's a no-op and nothing breaks.
```

Then in "### 2d — Assemble frontmatter and write the .mdoc file", add a bullet to the "Additionally, set:" list:

```markdown
- Image alt text: where the **source HTML provides alt** (`<img alt="...">`),
  keep it. Where alt is **missing or empty**, look up the image's draft in
  `image-alt.json` (keyed by its `/images/...` path) and use it for the Markdown
  `![alt](path)` and the blog `imageAlt` frontmatter, then set that catalog
  entry's `status` to `reviewed`. Never override real authored alt with a draft.
  If there's no draft (no `fm`), leave alt as the source provided (or empty).
```

- [ ] **Step 2: Wire `ai-alt` into the convert skill**

First, add `"Bash(npm run ai-alt)"` to the `allowed-tools` frontmatter array in `skills/convert/SKILL.md` (it has specific `Bash(npm run build)` / `Bash(npm install)` entries, no wildcard — same as import).

Then, in `skills/convert/SKILL.md`, find the image step (step 3 in the conversion procedure: "Copy and optimize images per the shared procedures", around line 497). Immediately after that item, add:

```markdown
   After copying the images, run `npm run ai-alt` once. On a capable Mac it
   drafts on-device alt text for any image lacking it (including `.webp`) into
   `image-alt.json`; elsewhere it's a no-op. When writing each post, where the
   source frontmatter/Markdown has **no alt** for an image, use the draft from
   `image-alt.json` for the `![alt](path)` / `imageAlt` and flip that entry to
   `reviewed`. Keep any alt the source already provided.
```

- [ ] **Step 3: Note the standalone pass in the optimize-images skill + workflow**

In `skills/optimize-images/SKILL.md`, in the "## Step 4 — AI-drafted alt text (when available)" section, add a short paragraph (after the existing catalog explanation):

```markdown
Images that arrived **already optimized** (`.webp`) — e.g. from `/anglesite:import`
— are skipped by `npm run ai-optimize`. To draft alt for those, run
`npm run ai-alt`, the standalone pass that walks every image in `public/images/`
(including `.webp`) and drafts alt for anything missing from `image-alt.json`.
Same catalog, same review flow.
```

In `template/docs/workflows/optimize-images.md`, add a short owner-facing note after the AI-alt section:

```markdown
If you imported a site or already have web-ready images, run `npm run ai-alt` to
draft alt text for those too (the regular optimize step only covers images it
converts). It works the same way — drafts you review before publishing.
```

- [ ] **Step 4: Update root CLAUDE.md**

In `CLAUDE.md` (root), find the on-device `fm` key-decisions row (it currently mentions "alt text and inbox triage"). Update its "Why" cell to add imported images:

```
| On-device `fm` as optional authoring accelerator | Free/private/offline drafts — alt text (incl. imported images via `ai-alt`) and inbox triage; never in the deployed site, always falls back to Claude (ADR-0021) |
```

If the exact wording differs, preserve the rest of the cell and add the `ai-alt`/imported-images mention alongside the existing alt-text reference. Report what you found.

- [ ] **Step 5: Verify no regression**

Run: `npx vitest run`
Expected: only the 5 pre-existing `sharp`/mcp failures, no new ones.

Manually confirm the docs reference `npm run ai-alt`, `image-alt.json`, and the "keep authored alt / fill only missing" rule consistently with `template/scripts/draft-alt.ts`.

- [ ] **Step 6: Commit**

```bash
git add skills/import/SKILL.md skills/convert/SKILL.md skills/optimize-images/SKILL.md template/docs/workflows/optimize-images.md CLAUDE.md
git commit -m "docs: wire ai-alt into import/convert + note webp backfill"
```

---

## Self-Review

**Spec coverage:**
- `draftAltForImage` shared helper → Task 1.
- `optimize-images.ts` calls the helper (behavior-preserving) → Task 2.
- Standalone `draft-alt.ts` / `ai-alt` over all images incl. `.webp`, gated on `shouldRunAltPass` + `isFmAvailable`, reports a count → Task 3.
- `getAltCandidateFiles` includes `.webp`/`.avif`, excludes `.svg`/generated/`originals/` → Task 3.
- `ai-alt` npm script → Task 3.
- Import/convert run `ai-alt` + consult the catalog for missing alt, keep authored alt, flip to reviewed → Task 4 Steps 1-2.
- `.webp` backfill documented in optimize skill/workflow → Task 4 Step 3.
- Root CLAUDE.md ADR-0021 row updated → Task 4 Step 4.
- Fallback (no fm → no-op, alt as today) → Task 3 `main()` gate + Task 4 doc wording.
- Reuse ADR-0021, no new ADR → Task 4 (CLAUDE.md row); spec states it.
- Testing split (pure helpers in CI + manual fm smoke) → Tasks 1, 3.

No gaps found.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `draftAltForImage(catalog, publicDir, absImagePath, run?)` defined in Task 1, called identically in Task 2 (`optimize-images.ts`) and Task 3 (`draft-alt.ts`). `getAltCandidateFiles`/`isAltCandidate` defined and tested in Task 3. `AltCatalog`/`CommandRunner`/`FM_MODEL_ID`/`shouldRunAltPass`/`readCatalog`/`writeCatalog`/`isFmAvailable`/`generateAltText` are existing `fm.ts` exports (slice 1), used consistently. The catalog key format (`/images/...`) produced by `catalogKeyFor` inside `draftAltForImage` matches the `/images/...` lookup the import/convert docs describe.
