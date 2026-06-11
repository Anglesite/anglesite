# Design — On-device alt text for imported images (standalone `ai-alt` pass)

**Date:** 2026-06-11
**Status:** Approved for planning
**Scope:** Third slice of the "use `fm` where it makes sense" effort. Adds a standalone on-device alt-drafting pass that works on any image (including `.webp`), and wires `/anglesite:import` and `/anglesite:convert` to use it so imported images that lack alt text get on-device drafts. Reuses slice 1's `fm.ts` + `image-alt.json` catalog and ADR-0021's pattern.

## Background

`/anglesite:import` (from a website URL) and `/anglesite:convert` (from an SSG project) are **agent-driven** skills: Claude reads the source HTML/Markdown, converts it, downloads images into `public/images/blog/`, and writes `.mdoc` files. They map `<img src alt="text">` → `![text](url)` and set blog `imageAlt` from source alt where present. Old sites frequently have empty or missing alt, so imported images often become `![](url)` / empty `imageAlt` — a real accessibility gap.

Slice 1 (ADR-0021) already drafts on-device alt text into a project-root `image-alt.json` catalog (`draft` → `reviewed` status), but **only for freshly-optimized source images** during `npm run ai-optimize` — its file walk skips `.webp` (`SKIP_EXTENSIONS`). Import converts images to `.webp` on download, so slice 1's pass would skip every imported image and draft nothing. The same `.webp` limitation is the deferred "backfill" enhancement noted in slice 1's review.

Therefore import-alt and the `.webp` backfill need the same missing capability: **draft alt for images already in `.webp`, decoupled from the optimize pass.** This slice builds that once.

Constraints inherited from ADR-0021: `fm` is Mac-only and authoring-time; every integration gates on `isFmAvailable()` and falls back to Claude/manual when absent; machine output is a reviewable draft that never clobbers a `reviewed` entry.

## Decisions (from brainstorming)

- **Alt only.** `fm` summaries are out — import principle #3 already generates descriptions via Claude (first 1–2 sentences, in-context), so Claude is already in the loop with the content; offloading summaries to the on-device model saves little and lowers quality. The image-vision pass is the genuine offload win.
- **Approach A — standalone pass.** Add `npm run ai-alt` over all images incl. `.webp`, reused by import/convert. Least invasive to import's tested, platform-specific image handling; also delivers the `.webp` backfill capability.
- **Reuse, no new ADR.** Third consumer of ADR-0021's pattern; reuses `generateAltText`, the catalog helpers, and the `ALT_TEXT_AI`/`--no-alt` controls.

## Architecture

```
import/convert downloads images → public/images/blog/ → npm run ai-alt (drafts → image-alt.json)
                                                              │
            writing ![alt](path) / imageAlt, source alt empty → catalog draft → flip to reviewed
```

Slice 1's optimize-coupled pass (source images only) and this standalone pass share ONE per-image helper, so the two never diverge. The deployed site has no dependency on `fm` or the catalog (authoring-time only); published alt lives in the Markdown/frontmatter exactly as today.

### Component 1 — `fm.ts`: extract `draftAltForImage`

Pull the per-image alt block currently inline in `optimize-images.ts` `main()` into a shared helper:

```ts
export async function draftAltForImage(
  catalog: AltCatalog,
  publicDir: string,
  absImagePath: string,
  run?: CommandRunner,
): Promise<string | null>;
```

Behavior: compute `catalogKeyFor(publicDir, absImagePath)`; if `needsAltDraft(catalog, key)` is false, return `null` (skip — already drafted or reviewed); else `generateAltText(absImagePath, run)`; on a non-null result, `mergeAltEntry(catalog, key, { alt, model: FM_MODEL_ID, generatedAt: <today>, status: "draft" })` and return the alt; on failure return `null`. The entry construction (model id, date stamp, `draft` status) lives here, in one place.

Slice 1's review explicitly deferred this extraction as "one caller / YAGNI." There are now two callers (`ai-optimize` and `ai-alt`), so the extraction is justified.

### Component 2 — `optimize-images.ts`: call the shared helper

Replace the inline alt block in `main()` with a `draftAltForImage(catalog, publicDir, join(dirname(file), result.primary))` call, preserving the `altDrafted` tally and the per-image log. Behavior is unchanged — still gated on `isFmAvailable()` + `shouldRunAltPass`, still source-images-only (its `getImageFiles` walk is untouched). This is a behavior-preserving DRY refactor; existing `optimize-images` tests must stay green.

### Component 3 — new `template/scripts/draft-alt.ts` (`npm run ai-alt`)

- `getAltCandidateFiles(dir: string): string[]` (pure) — recursively walk `public/images/`, INCLUDING `.webp`, returning raster + webp images. Excludes: `.svg` (vector, nothing to caption), the generated filenames (`favicon.svg`, `og-image.png`, `apple-touch-icon.png`), and the `originals/` directory. Alt-candidate extensions: `.jpg .jpeg .png .gif .tiff .tif .heif .heic .webp .avif`.
- `main()` — gate once on `shouldRunAltPass({ noAltFlag: process.argv.includes("--no-alt"), altTextAiConfig: readConfig("ALT_TEXT_AI") })` AND `isFmAvailable()`; if disabled/unavailable, print a short notice and exit 0 (no error). Otherwise: `publicDir = join(cwd, "public")`, `imagesDir = join(publicDir, "images")`, read `image-alt.json`, loop `getAltCandidateFiles(imagesDir)` calling `draftAltForImage` (sequential — single on-device model), tally drafts, write the catalog if any drafted, and report a count (`Drafted alt text for N image(s) → image-alt.json (review before publishing).`).
- `package.json`: add `"ai-alt": "tsx scripts/draft-alt.ts"`.

This standalone pass IS the `.webp` backfill: run it any time to draft alt for images the optimize pass skipped.

### Component 4 — import / convert wiring (skill docs)

- **After image download** (import Step 2c "Download and optimize images"; the analogous convert image step): run `npm run ai-alt` once, after all images for the import are on disk. Tell the owner plainly ("drafting alt text for your images on-device").
- **When writing content** (import Step 2d / convert): for each image reference whose **source alt is empty or missing**, look up the `image-alt.json` draft by its public-relative key and use it for the Markdown `![alt](path)` and the blog `imageAlt` frontmatter; then flip that catalog entry's `status` to `reviewed`. Where the source provided real alt, KEEP it — never override authored alt with a machine draft.
- **Fallback:** no `fm` (non-Mac / AI off / `ALT_TEXT_AI=off`) → `ai-alt` writes nothing → alt stays preserved-or-empty exactly as today; Claude may still draft from context. Identical end state; `fm` only fills the gaps for free.

### Component 5 — docs

- `skills/import/SKILL.md` and `skills/convert/SKILL.md` — the wiring above (run `ai-alt`, consult the catalog for missing alt, keep authored alt, fallback).
- `skills/optimize-images/SKILL.md` and `template/docs/workflows/optimize-images.md` — note the standalone `npm run ai-alt` / `.webp` backfill (draft alt for images the optimize pass skipped or that arrived already optimized).
- `CLAUDE.md` (root) — extend the ADR-0021 key-decisions row to add "imported images" alongside alt text and inbox triage.

## Fallback contract

| Environment | Behavior |
|---|---|
| Mac + Apple Intelligence on | `ai-alt` drafts alt for images lacking a catalog entry (incl. `.webp`); import/convert fill missing alt from the catalog. |
| No `fm`, or `ALT_TEXT_AI=off` | `ai-alt` is a no-op; imported alt stays preserved-or-empty as today. |

## Testing

- **Unit (CI, no `fm`):** `getAltCandidateFiles` (includes `.webp`/`.avif`, excludes `.svg`, the generated filenames, and `originals/`; recurses subdirs); `draftAltForImage` with a fake `CommandRunner` (drafts when `needsAltDraft`, returns null + skips when entry is `reviewed`, merges a `draft` entry with the right shape, returns null when `generateAltText` yields null).
- **Regression:** existing `tests/optimize-images.test.ts` and `tests/fm.test.ts` stay green (the `draftAltForImage` extraction is behavior-preserving for `ai-optimize`).
- **Integration (manual, Mac):** `npm run ai-alt` over a folder with a `.webp` drafts an entry; verified real `fm` already proven in slice 1.
- Import/convert changes are skill-doc (agent-driven; no unit tests).

## Out of scope

- `fm` summaries / descriptions (Claude generates these in-context).
- Rerouting import through `ai-optimize` (Approach B — invasive to import's image handling).
- Non-English alt (system model is English-centric).
- Captioning `.svg` (vector; no raster to read).
- Auto-detecting decorative images (owner/Claude decides `alt=""`).

## Open questions

None blocking.
