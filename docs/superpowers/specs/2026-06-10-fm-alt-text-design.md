# Design — On-device alt text via Apple Foundation Models (`fm`)

**Date:** 2026-06-10
**Status:** Approved for planning
**Scope:** First slice of a broader "use Apple's Foundation Model where it makes sense" effort. This slice covers **image alt text** only, plus the shared foundation (`fm.ts` + ADR-0021) that later `fm` integrations (inbox triage, bulk import captions, copy rewrites) will reuse.

## Background

`fm` is Apple's Foundation Models CLI (`/usr/bin/fm`). It runs the on-device `system` model on an Apple-Silicon Mac with Apple Intelligence enabled. Relevant capabilities:

- `fm respond --image <path>` — on-device vision (no network).
- `--use-case content-tagging`, `--guardrails`, `--schema`, `-i/--instructions`, `-g/--greedy`, `--[no-]stream`, stdin.
- `fm available` — prints model availability; exits 0 when the system model is ready.

Two hard constraints drive the whole design:

1. **Mac-only, authoring-only.** `fm` exists only on a capable Mac and cannot run inside a deployed Cloudflare Worker. It is an **authoring/build-time** accelerator, never a runtime dependency.
2. **Availability is not guaranteed.** Cowork users on Windows, devs on Linux/CI, or a Mac with Apple Intelligence off will not have it. Therefore `fm` must always be optional, with a graceful fallback to Claude.

Anglesite's existing alt-text surface:

- Alt text lives as `imageAlt` frontmatter (blog/services/team/menu/gallery — see `template/src/content.config.ts`) and as `alt=` attributes in `.astro` files.
- `template/scripts/a11y-audit.ts` already flags `img-alt-missing` and `img-alt-placeholder`.
- `template/scripts/optimize-images.ts` (`npm run ai-optimize`) walks `public/images/` through a sharp pipeline (resize/WebP/EXIF-strip) but never touches alt text.

**Placement mismatch.** The optimizer is placement-blind (operates on files in `public/images/`); good alt text is placement-dependent (a hero vs. a gallery thumbnail of the same photo need different alt). A build-time pass can therefore only produce a **context-free draft** — valuable as a starting point, but explicitly a draft to be reviewed in context, never a finished a11y claim.

## Decisions (from brainstorming)

- **Value of `fm`:** bulk/batch offload, privacy (on-device), build-time without an agent, and cost/offline — all four.
- **Fallback:** when `fm` is unavailable, fall back to Claude. Same outcome everywhere; `fm` is a silent accelerator.
- **Approach: Hybrid (C).** Bulk context-free drafts into a catalog at optimize time (no agent), then contextual refinement when an image is placed or when `a11y-audit` flags it.
- **Foundation included now:** a reusable `fm.ts` module and ADR-0021, so later integrations follow a documented pattern.

## Architecture

```
npm run ai-optimize ──► fm.ts: isFmAvailable()? ──► fm respond --image ──► image-alt.json (drafts)
                                                                              │
placement / a11y-audit ──► read draft ──► Claude refines w/ context ──► imageAlt / alt=  (+ mark reviewed)
```

The deployed site has **zero** dependency on `fm` or the catalog. Both are authoring-time only. The published site reads alt from `imageAlt` frontmatter and `alt=` attributes exactly as it does today.

### Component 1 — `template/scripts/fm.ts` (shared foundation)

The single module that owns all Foundation-Model interaction. Kept small and focused so it can be unit-tested and reused.

- `isFmAvailable(): Promise<boolean>`
  - True only when `fm` is on `PATH` **and** `fm available` exits 0 (stdout indicates the system model is available).
  - Time-boxed (a few seconds); any error/timeout/non-zero/missing-binary → `false`. Never throws.
  - This is the one piece every future `fm` integration reuses.
- `generateAltText(imagePath: string): Promise<string | null>`
  - Runs: `fm respond --image <path> --use-case content-tagging -g --no-stream -i "<instructions>"`.
  - Instructions: write concise screen-reader alt text, roughly under 125 characters, describe what is shown plainly, no "image of"/"photo of" prefix, output only the alt text.
  - Trims/normalizes output (strip whitespace and any stray ANSI). Returns `null` on failure (so callers fall back).
  - Runs against the **optimized WebP** (smaller, faster for the model, and the asset the site actually references).

Pure, testable helpers live alongside the shell-outs (mirroring how `optimize-images.ts` already separates pure helpers from the sharp pipeline):
- output normalization,
- catalog merge logic (see Component 2),
- key normalization (filesystem path → public-relative key),
- `--no-alt` / `ALT_TEXT_AI` flag parsing.

### Component 2 — `image-alt.json` catalog (project root, committed)

- **Location:** project root, **not** under `public/` — so it never deploys and is never publicly fetchable. Committed to git so drafts are reviewable in PRs and shared across machines.
- **Key:** public-relative path, matching how `image:` frontmatter references assets (e.g. `/images/blog/harvest.webp`).
- **Entry shape:**
  ```json
  {
    "/images/blog/harvest.webp": {
      "alt": "Crates of ripe tomatoes stacked at a farm stand",
      "model": "apple-fm-system",
      "generatedAt": "2026-06-10",
      "status": "draft"
    }
  }
  ```
- **`status` is the safety valve.** Values: `"draft"` (machine-generated, unreviewed) and `"reviewed"` (a human/Claude has refined and approved it). The optimizer writes an entry **only when it is missing or `draft`**; it never overwrites a `reviewed` entry. Re-running `ai-optimize` is therefore incremental and safe.

### Component 3 — optimizer pass (`optimize-images.ts`)

In `main()`, after each image is optimized:

1. Compute the catalog key for the optimized WebP.
2. If `ALT_TEXT_AI` is not `off` and `--no-alt` was not passed and `isFmAvailable()` and the catalog has no entry (or only a `draft`) for that key → call `generateAltText()` and merge a `draft` entry into `image-alt.json`.
3. Emit a progress line per image; write the catalog once at the end.
4. If `fm` is unavailable, skip the entire alt pass silently (no catalog written, no error).

`isFmAvailable()` is checked once per run (not per image).

### Component 4 — consumer / refinement path (the hybrid half)

Documentation-and-skill changes (no new runtime code). When Claude places an image (new-page, blog, menu, gallery) or remediates an `a11y-audit` `img-alt-missing` / `img-alt-placeholder` finding:

1. Look up the catalog draft for that image.
2. Refine it using the on-page context Claude has (surrounding copy, the image's role).
3. Write the result to the real `imageAlt` frontmatter / `alt=` attribute.
4. Flip that catalog entry to `status: "reviewed"`.

Rules:
- Every draft is surfaced to the owner as "review before publishing."
- Purely decorative images get `alt=""` (the model cannot detect decorative intent; Claude/owner decides).
- If no catalog draft exists (no `fm`), Claude drafts alt inline from context exactly as today.

## Fallback contract

| Environment | Behavior |
|---|---|
| Mac + Apple Intelligence on | `ai-optimize` writes draft catalog; Claude refines in context. |
| No `fm` (Windows/Linux/CI/AI off) | No catalog written; Claude drafts alt inline from context. |

Outcome is identical everywhere — published alt text on every page. `fm` only changes *who drafts first*.

## Testing

- **Unit (no `fm`, run in CI):** catalog merge (skip-`reviewed`, fill-missing, overwrite-`draft`), key normalization, output normalization, flag parsing (`--no-alt`, `ALT_TEXT_AI=off`).
- **Availability:** `isFmAvailable()` tested with a mocked/stubbed command runner for the missing-binary, non-zero-exit, and available cases.
- **Integration (skipped in CI):** `generateAltText()` against a real `fm` on a developer Mac.
- Follows the existing split in `optimize-images.ts` (pure helpers importable without triggering the heavy dependency).

## Documentation

- **New ADR `docs/decisions/0021-on-device-ai-accelerator.md`** — records the decision: on-device `fm` is an *optional authoring-time accelerator*, never in the deployed site, always falling back to Claude. Establishes the pattern (`fm.ts` + availability gate + draft/reviewed catalog) for future integrations.
- **`skills/optimize-images/SKILL.md`** — document the alt pass, the catalog, refinement-on-placement, and the fallback. Add any new `allowed-tools` needed (`Bash(fm *)` is **not** added to a skill that doesn't shell out directly; the optimizer runs `fm` via `npm run ai-optimize`, which is already allowed).
- **`template/docs/workflows/optimize-images.md`** — owner-facing explanation of AI-drafted alt and the review step.
- **Root `CLAUDE.md`** — one-line note that the plugin uses on-device `fm` as an optional accelerator (alt text first).
- **`.site-config`** — optional `ALT_TEXT_AI=off` to disable the pass even where `fm` is available.

## Out of scope (this slice)

- Other `fm` integrations (inbox triage, import captions, copy rewrites/summaries) — future slices reusing `fm.ts`.
- Non-English alt text. The system model is English-centric; i18n sites get an English draft that the owner translates. Noted, not solved here.
- `pcc` (Private Cloud Compute) model — `system` only for now.
- Automatic decorative-image detection.

## Open questions

None blocking. Language handling and additional integrations are explicitly deferred above.
