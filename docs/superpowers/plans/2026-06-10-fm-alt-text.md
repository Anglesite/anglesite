# On-device Alt Text via Apple Foundation Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-draft image alt text on-device with Apple's `fm` CLI during `npm run ai-optimize`, storing reviewable drafts in a catalog that Claude refines in context — with a clean Claude fallback when `fm` is unavailable.

**Architecture:** A new focused `template/scripts/fm.ts` module owns all Foundation-Model interaction (availability check + alt generation) behind an injectable command runner so it is unit-testable without a Mac. The optimizer calls it to populate a project-root `image-alt.json` draft catalog (never deployed). Consumer skills and a11y remediation read drafts from the catalog and refine them before writing real `imageAlt` / `alt=`. The deployed site never depends on `fm` or the catalog.

**Tech Stack:** TypeScript (strict, ESM), Node `node:child_process` (`execFile`), Vitest 3, the existing `template/scripts/config.ts` `.site-config` reader, and the existing `template/scripts/optimize-images.ts` sharp pipeline.

**Spec:** `docs/superpowers/specs/2026-06-10-fm-alt-text-design.md`

---

## File Structure

- **Create:** `template/scripts/fm.ts` — the shared Foundation-Model module. Pure helpers (output/catalog/key/flag logic) + two shell-outs (`isFmAvailable`, `generateAltText`) behind an injectable `CommandRunner`.
- **Create:** `tests/fm.test.ts` — unit tests for the pure helpers and the shell-outs (fake runner; no real `fm`).
- **Create:** `docs/decisions/0021-on-device-ai-accelerator.md` — ADR recording the boundary.
- **Modify:** `template/scripts/optimize-images.ts` — add the optional alt pass to `main()`.
- **Modify:** `docs/decisions/README.md` — add the ADR-0021 index line.
- **Modify:** `skills/optimize-images/SKILL.md` — document the alt pass, refinement-on-placement, fallback.
- **Modify:** `template/docs/workflows/optimize-images.md` — owner-facing explanation + review step.
- **Modify:** `CLAUDE.md` (root) — one-line note + refresh the ADR count/range.

Note on permissions: the optimizer invokes `fm` as a child process of `npm run ai-optimize`, which is already in the skill's `allowed-tools`. Claude never calls `fm` directly (at placement it refines existing drafts or drafts inline itself), so **no `Bash(fm *)` grant is added**.

---

## Task 1: `fm.ts` pure helpers

**Files:**
- Create: `template/scripts/fm.ts`
- Test: `tests/fm.test.ts`

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `tests/fm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeAltOutput,
  catalogKeyFor,
  needsAltDraft,
  mergeAltEntry,
  shouldRunAltPass,
  readCatalog,
  writeCatalog,
  type AltCatalog,
} from "../template/scripts/fm.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("normalizeAltOutput", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAltOutput("  A dog\n on  grass \n")).toBe("A dog on grass");
  });

  it("strips ANSI escape codes", () => {
    expect(normalizeAltOutput("\x1b[32mA red barn\x1b[0m")).toBe("A red barn");
  });

  it("strips surrounding quotes", () => {
    expect(normalizeAltOutput('"A red barn"')).toBe("A red barn");
  });

  it("drops an 'image of' / 'photo of' prefix", () => {
    expect(normalizeAltOutput("Photo of a red barn")).toBe("a red barn");
    expect(normalizeAltOutput("An image of a red barn")).toBe("a red barn");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAltOutput("   ")).toBe("");
  });
});

describe("catalogKeyFor", () => {
  it("produces a public-relative key with leading slash", () => {
    expect(catalogKeyFor("/site/public", "/site/public/images/blog/x.webp")).toBe(
      "/images/blog/x.webp",
    );
  });
});

describe("needsAltDraft", () => {
  const base: AltCatalog = {
    "/images/a.webp": { alt: "a", model: "m", generatedAt: "2026-06-10", status: "draft" },
    "/images/b.webp": { alt: "b", model: "m", generatedAt: "2026-06-10", status: "reviewed" },
  };
  it("is true when the key is missing", () => {
    expect(needsAltDraft(base, "/images/missing.webp")).toBe(true);
  });
  it("is true when the existing entry is a draft", () => {
    expect(needsAltDraft(base, "/images/a.webp")).toBe(true);
  });
  it("is false when the existing entry is reviewed", () => {
    expect(needsAltDraft(base, "/images/b.webp")).toBe(false);
  });
});

describe("mergeAltEntry", () => {
  it("writes a new entry when the key is missing", () => {
    const cat: AltCatalog = {};
    mergeAltEntry(cat, "/images/a.webp", { alt: "a", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("a");
  });
  it("overwrites an existing draft", () => {
    const cat: AltCatalog = { "/images/a.webp": { alt: "old", model: "m", generatedAt: "d", status: "draft" } };
    mergeAltEntry(cat, "/images/a.webp", { alt: "new", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("new");
  });
  it("never overwrites a reviewed entry", () => {
    const cat: AltCatalog = { "/images/a.webp": { alt: "kept", model: "m", generatedAt: "d", status: "reviewed" } };
    mergeAltEntry(cat, "/images/a.webp", { alt: "new", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("kept");
    expect(cat["/images/a.webp"].status).toBe("reviewed");
  });
});

describe("shouldRunAltPass", () => {
  it("is false when --no-alt was passed", () => {
    expect(shouldRunAltPass({ noAltFlag: true })).toBe(false);
  });
  it("is false when ALT_TEXT_AI=off (any case)", () => {
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "off" })).toBe(false);
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "OFF" })).toBe(false);
  });
  it("is true by default", () => {
    expect(shouldRunAltPass({ noAltFlag: false })).toBe(true);
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "on" })).toBe(true);
  });
});

describe("readCatalog / writeCatalog", () => {
  it("returns {} when the file is missing", () => {
    expect(readCatalog(join(tmpdir(), "nope-" + Math.random() + ".json"))).toEqual({});
  });
  it("returns {} for malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cat-"));
    const p = join(dir, "image-alt.json");
    writeFileSync(p, "{ not json");
    expect(readCatalog(p)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
  it("round-trips and sorts keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cat-"));
    const p = join(dir, "image-alt.json");
    const cat: AltCatalog = {
      "/images/z.webp": { alt: "z", model: "m", generatedAt: "d", status: "draft" },
      "/images/a.webp": { alt: "a", model: "m", generatedAt: "d", status: "draft" },
    };
    writeCatalog(p, cat);
    const text = readFileSync(p, "utf-8");
    expect(text.indexOf("/images/a.webp")).toBeLessThan(text.indexOf("/images/z.webp"));
    expect(readCatalog(p)).toEqual(cat);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/fm.test.ts`
Expected: FAIL — `Cannot find module '../template/scripts/fm.js'` (file does not exist yet).

- [ ] **Step 3: Create `template/scripts/fm.ts` with the pure helpers**

```ts
/**
 * Apple Foundation Models (`fm`) helper — the single module that owns all
 * on-device model interaction for Anglesite.
 *
 * `fm` runs the on-device `system` model on an Apple-Silicon Mac with Apple
 * Intelligence enabled. It is an AUTHORING-TIME accelerator only: it never runs
 * in the deployed site, and every consumer MUST fall back to Claude when
 * `isFmAvailable()` returns false. See docs/decisions/0021-on-device-ai-accelerator.md.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

// ---------------------------------------------------------------------------
// Catalog types
// ---------------------------------------------------------------------------

export interface AltEntry {
  alt: string;
  model: string;
  generatedAt: string;
  status: "draft" | "reviewed";
}

export type AltCatalog = Record<string, AltEntry>;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O, no shell — unit-tested directly)
// ---------------------------------------------------------------------------

const ANSI = /\x1b\[[0-9;]*m/g;

/** Clean raw `fm` stdout into a single-line alt string. */
export function normalizeAltOutput(raw: string): string {
  let s = raw.replace(ANSI, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^["']|["']$/g, "").trim();
  s = s.replace(/^(?:an?\s+)?(?:image|photo|picture)\s+of\s+/i, "").trim();
  return s;
}

/** Convert an absolute optimized-image path into a public-relative catalog key. */
export function catalogKeyFor(publicDir: string, absImagePath: string): string {
  const rel = relative(publicDir, absImagePath).split("\\").join("/");
  return "/" + rel.replace(/^\/+/, "");
}

/** True when the catalog has no usable entry for the key (missing or still a draft). */
export function needsAltDraft(catalog: AltCatalog, key: string): boolean {
  const entry = catalog[key];
  return !entry || entry.status === "draft";
}

/** Merge a draft entry, but never overwrite a reviewed one. Mutates and returns. */
export function mergeAltEntry(catalog: AltCatalog, key: string, entry: AltEntry): AltCatalog {
  const existing = catalog[key];
  if (existing && existing.status === "reviewed") return catalog;
  catalog[key] = entry;
  return catalog;
}

/** Decide whether the alt pass should run at all (flag + config gating). */
export function shouldRunAltPass(opts: { noAltFlag: boolean; altTextAiConfig?: string }): boolean {
  if (opts.noAltFlag) return false;
  if ((opts.altTextAiConfig ?? "").toLowerCase() === "off") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Catalog I/O
// ---------------------------------------------------------------------------

export function readCatalog(path: string): AltCatalog {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as AltCatalog) : {};
  } catch {
    return {};
  }
}

export function writeCatalog(path: string, catalog: AltCatalog): void {
  const ordered: AltCatalog = {};
  for (const k of Object.keys(catalog).sort()) ordered[k] = catalog[k];
  writeFileSync(path, JSON.stringify(ordered, null, 2) + "\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all pure-helper and catalog-I/O tests green.

- [ ] **Step 5: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): fm.ts pure helpers for alt-text catalog"
```

---

## Task 2: `fm.ts` shell-outs (`isFmAvailable`, `generateAltText`)

**Files:**
- Modify: `template/scripts/fm.ts`
- Test: `tests/fm.test.ts`

- [ ] **Step 1: Add the failing shell-out tests**

Append to `tests/fm.test.ts` (and add the imports `isFmAvailable, generateAltText, type CommandRunner` to the existing top import from `../template/scripts/fm.js`):

```ts
import { isFmAvailable, generateAltText, type CommandRunner } from "../template/scripts/fm.js";

describe("isFmAvailable", () => {
  it("is true when `fm available` reports the system model", async () => {
    const run: CommandRunner = async () => ({ stdout: "System model available", exitCode: 0 });
    expect(await isFmAvailable(run)).toBe(true);
  });
  it("is false when the binary is missing (exitCode -1, empty stdout)", async () => {
    const run: CommandRunner = async () => ({ stdout: "", exitCode: -1 });
    expect(await isFmAvailable(run)).toBe(false);
  });
  it("is false when stdout lacks the availability phrase", async () => {
    const run: CommandRunner = async () => ({ stdout: "something else", exitCode: 0 });
    expect(await isFmAvailable(run)).toBe(false);
  });
  it("is false when the runner throws", async () => {
    const run: CommandRunner = async () => { throw new Error("boom"); };
    expect(await isFmAvailable(run)).toBe(false);
  });
});

describe("generateAltText", () => {
  it("returns normalized alt on success", async () => {
    const run: CommandRunner = async () => ({ stdout: "  A red barn\n", exitCode: 0 });
    expect(await generateAltText("/x.webp", run)).toBe("A red barn");
  });
  it("returns null on non-zero exit", async () => {
    const run: CommandRunner = async () => ({ stdout: "A red barn", exitCode: 1 });
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
  it("returns null when output is empty", async () => {
    const run: CommandRunner = async () => ({ stdout: "   ", exitCode: 0 });
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
  it("returns null when the runner throws", async () => {
    const run: CommandRunner = async () => { throw new Error("boom"); };
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/fm.test.ts`
Expected: FAIL — `isFmAvailable`/`generateAltText`/`CommandRunner` are not exported yet.

- [ ] **Step 3: Add the shell-out layer to `template/scripts/fm.ts`**

Append to `template/scripts/fm.ts`:

```ts
// ---------------------------------------------------------------------------
// Command runner (injectable so the shell-outs are testable without `fm`)
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string;
  exitCode: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<CommandResult>;

const defaultRunner: CommandRunner = (command, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) {
          resolve({ stdout: stdout ?? "", exitCode: 0 });
          return;
        }
        // Numeric `code` = process exit status; string `code` (ENOENT) or a
        // kill signal (timeout) = spawn failure → treat as unavailable (-1).
        const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
        const exitCode = typeof code === "number" ? code : -1;
        resolve({ stdout: stdout ?? "", exitCode });
      },
    );
  });

// ---------------------------------------------------------------------------
// Foundation-Model calls
// ---------------------------------------------------------------------------

/**
 * True only when `fm` is installed AND the on-device system model is ready.
 * The stdout phrase is the signal; a missing binary or timeout yields empty
 * stdout via the runner. Never throws.
 */
export async function isFmAvailable(run: CommandRunner = defaultRunner): Promise<boolean> {
  try {
    const { stdout } = await run("fm", ["available"], { timeoutMs: 5_000 });
    return /system model available/i.test(stdout);
  } catch {
    return false;
  }
}

const ALT_INSTRUCTIONS =
  "Write concise alt text for this image, suitable for a screen reader. " +
  "Describe what is shown plainly in under 125 characters. " +
  "Do not start with 'image of' or 'photo of'. Output only the alt text, nothing else.";

/**
 * Draft alt text for one image on-device. Returns the normalized string, or
 * null on any failure (caller falls back to Claude).
 */
export async function generateAltText(
  imagePath: string,
  run: CommandRunner = defaultRunner,
): Promise<string | null> {
  try {
    const { stdout, exitCode } = await run(
      "fm",
      [
        "respond",
        "--image", imagePath,
        "--use-case", "content-tagging",
        "-g",
        "--no-stream",
        "-i", ALT_INSTRUCTIONS,
      ],
      { timeoutMs: 60_000 },
    );
    if (exitCode !== 0) return null;
    const alt = normalizeAltOutput(stdout);
    return alt.length > 0 ? alt : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all `fm.test.ts` cases green.

- [ ] **Step 5: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): fm.ts availability check + on-device alt generation"
```

---

## Task 3: Wire the alt pass into the optimizer

**Files:**
- Modify: `template/scripts/optimize-images.ts:102-136` (the `main()` function and its imports)

This task changes `main()`, which only runs as a CLI entry point (guarded by `process.argv[1]?.endsWith("optimize-images.ts")`) and is not exercised by the existing unit tests. Verification is by reading the diff and a manual smoke run; there is no new unit test (the logic it adds — gating, keying, merging — is already covered in `tests/fm.test.ts`).

- [ ] **Step 1: Add imports at the top of `optimize-images.ts`**

After the existing `import { readdirSync, existsSync } from "node:fs";` / path imports (around line 10-11), add:

```ts
import { readConfig } from "./config.js";
import {
  isFmAvailable,
  generateAltText,
  catalogKeyFor,
  readCatalog,
  writeCatalog,
  needsAltDraft,
  mergeAltEntry,
  shouldRunAltPass,
  type AltCatalog,
} from "./fm.js";
```

- [ ] **Step 2: Add gating + catalog setup inside `main()`**

In `main()`, immediately after the existing block that computes `files` and logs `Optimizing ${files.length} image(s)…` (current line ~123), insert:

```ts
  const noAltFlag = process.argv.includes("--no-alt");
  const altEnabled = shouldRunAltPassLocal(noAltFlag);
  const publicDir = join(cwd, "public");
  const catalogPath = join(cwd, "image-alt.json");
  let catalog: AltCatalog = {};
  let fmReady = false;
  if (altEnabled) {
    fmReady = await isFmAvailable();
    if (fmReady) catalog = readCatalog(catalogPath);
  }
  let altDrafted = 0;
```

Then add this small local wrapper just above `async function main()` (it forwards to the tested `shouldRunAltPass`, reading `.site-config` via the existing `readConfig`; `shouldRunAltPass` is already imported in Step 1):

```ts
function shouldRunAltPassLocal(noAltFlag: boolean): boolean {
  return shouldRunAltPass({ noAltFlag, altTextAiConfig: readConfig("ALT_TEXT_AI") });
}
```

- [ ] **Step 3: Draft alt inside the per-file loop**

Replace the existing loop body:

```ts
  for (const file of files) {
    const result = await optimizeImage(file, {
      outputDir: dirname(file),
      preserveOriginalsDir: join(imagesDir, "originals"),
    });
    console.log(`  ${file.replace(cwd + "/", "")} → ${result.primary} (+${result.variants.length} variants)`);
  }
  console.log("Done.");
```

with:

```ts
  for (const file of files) {
    const result = await optimizeImage(file, {
      outputDir: dirname(file),
      preserveOriginalsDir: join(imagesDir, "originals"),
    });
    console.log(`  ${file.replace(cwd + "/", "")} → ${result.primary} (+${result.variants.length} variants)`);

    if (fmReady) {
      const primaryAbs = join(dirname(file), result.primary);
      const key = catalogKeyFor(publicDir, primaryAbs);
      if (needsAltDraft(catalog, key)) {
        const alt = await generateAltText(primaryAbs);
        if (alt) {
          mergeAltEntry(catalog, key, {
            alt,
            model: "apple-fm-system",
            generatedAt: new Date().toISOString().slice(0, 10),
            status: "draft",
          });
          altDrafted++;
          console.log(`    alt draft: ${alt}`);
        }
      }
    }
  }

  if (fmReady && altDrafted > 0) {
    writeCatalog(catalogPath, catalog);
    console.log(
      `Drafted alt text for ${altDrafted} image(s) → image-alt.json (review before publishing).`,
    );
  }
  console.log("Done.");
```

- [ ] **Step 4: Verify the full suite still passes and types check**

Run: `npx vitest run`
Expected: PASS — existing `optimize-images` tests and the new `fm` tests all green.

Run: `npx tsc --noEmit -p template/tsconfig.json`
Expected: No errors from `optimize-images.ts` or `fm.ts`. (If `template/node_modules` is not installed, skip tsc and rely on the vitest run; note this in the commit if so.)

- [ ] **Step 5: Manual smoke test (best-effort, Mac with `fm` only)**

```bash
mkdir -p /tmp/fm-smoke/public/images && cp <any.jpg> /tmp/fm-smoke/public/images/
cd /tmp/fm-smoke && node --import tsx <repo>/template/scripts/optimize-images.ts
cat /tmp/fm-smoke/image-alt.json
```

Expected on a capable Mac: `image-alt.json` exists with one `"status": "draft"` entry keyed `/images/<name>.webp`. On any other machine: no `image-alt.json`, optimization still completes. Note the actual outcome in the commit message.

- [ ] **Step 6: Commit**

```bash
git add template/scripts/optimize-images.ts
git commit -m "feat(template): draft alt text during ai-optimize when fm is available"
```

---

## Task 4: ADR-0021

**Files:**
- Create: `docs/decisions/0021-on-device-ai-accelerator.md`
- Modify: `docs/decisions/README.md` (append the index line)

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0021-on-device-ai-accelerator.md`:

```markdown
---
status: accepted
date: 2026-06-10
decision-makers: [Anglesite maintainers]
---

# On-device AI (`fm`) as an optional authoring-time accelerator

## Context and Problem Statement

Several authoring tasks — drafting image alt text, summarizing content, suggesting tags, triaging form submissions, short copy rewrites — are repetitive and high-volume. When Claude is in the session it can do them, but per-item Claude calls are expensive at scale, and some inputs (form submissions with PII) are content an owner may not want to send to any cloud.

Apple's Foundation Models CLI (`fm`) runs an on-device model on an Apple-Silicon Mac with Apple Intelligence enabled. It is free, private (nothing leaves the machine), works offline, and supports vision (`--image`), structured output (`--schema`), and content-tagging use cases. But it exists only on a capable Mac — Cowork users on Windows, developers on Linux, and CI runners do not have it — and it cannot run inside a deployed Cloudflare Worker.

## Decision

Use `fm` as an **optional, authoring-time accelerator**, never as a runtime dependency:

1. **Authoring-only.** `fm` runs during local authoring/build steps (e.g. `npm run ai-optimize`). It is never part of the deployed site or any Worker.
2. **Always optional, always falls back to Claude.** Every integration gates on a single availability check (`isFmAvailable()` in `template/scripts/fm.ts`). When `fm` is absent, the same task is done by Claude. The end result is identical on every machine; `fm` only changes who drafts first.
3. **Machine output is a draft, not a commitment.** `fm`-generated content is written to a reviewable, non-deployed store (e.g. the `image-alt.json` catalog) with an explicit `draft` → `reviewed` status. Re-runs never clobber human-reviewed entries.
4. **One module owns it.** All `fm` interaction lives in `template/scripts/fm.ts` behind an injectable command runner, so it is unit-testable without a Mac and future integrations reuse the same availability gate.

The first integration is image alt text in `optimize-images`. Inbox triage, bulk import captions, and copy rewrites/summaries are expected future consumers of the same module.

## Decision Drivers

* Bulk/batch offload — keep repetitive per-item work off paid Claude calls where a free local model suffices
* Privacy — keep PII-bearing content (form submissions) on the owner's machine
* Build-time / no-agent — let deterministic npm scripts produce drafts without an interactive session
* Cost / offline — free local inference that works without a network
* Inclusivity — most Cowork users are not on a capable Mac, so the feature must degrade gracefully (ADR-0011, owner controls everything)

## Consequences

* **Good:** cheaper bulk authoring, a privacy-preserving path for sensitive content, and a documented pattern for adding more on-device features.
* **Good:** zero impact on the deployed site — no new runtime dependency, nothing for the pre-deploy scans to police.
* **Neutral:** on-device output quality is below Claude's; it is always framed as a reviewable draft.
* **Bad / limits:** Mac-only generation means most users get the Claude fallback path; the system model is English-centric, so non-English sites get English drafts to translate.
```

- [ ] **Step 2: Add the README index line**

In `docs/decisions/README.md`, after the ADR-0020 line, append:

```markdown
- [ADR-0021](0021-on-device-ai-accelerator.md) — On-device AI (`fm`) as an optional authoring-time accelerator
```

- [ ] **Step 3: Verify the ADR status test passes**

Run: `npx vitest run tests/adr-status.test.ts`
Expected: PASS — including a row asserting `0021-on-device-ai-accelerator.md has status: accepted`.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0021-on-device-ai-accelerator.md docs/decisions/README.md
git commit -m "docs: ADR-0021 on-device AI as an optional authoring accelerator"
```

---

## Task 5: Documentation — skill, workflow, root CLAUDE.md

**Files:**
- Modify: `skills/optimize-images/SKILL.md`
- Modify: `template/docs/workflows/optimize-images.md`
- Modify: `CLAUDE.md` (root)

- [ ] **Step 1: Update the optimize-images skill**

In `skills/optimize-images/SKILL.md`, after the existing "## Step 3 — Update image references" section, add:

```markdown
## Step 4 — AI-drafted alt text (when available)

On an Apple-Silicon Mac with Apple Intelligence enabled, `npm run ai-optimize`
also drafts alt text for each image **on-device** (nothing is sent to any
cloud) and writes it to `image-alt.json` at the project root. Each entry is a
`draft` — a context-blind starting point, never a finished accessibility claim.

`image-alt.json` is authoring-only: it is committed for review but is **not**
under `public/`, so it never deploys. Re-running the optimizer never overwrites
an entry whose `status` is `reviewed`.

When you place an image (new page, blog post, menu, gallery) or remediate an
`a11y-audit` `img-alt-missing` / `img-alt-placeholder` finding:

1. Look up the draft for that image in `image-alt.json`.
2. Refine it using the on-page context you have (surrounding copy, the image's
   role). Purely decorative images get `alt=""`.
3. Write the result to the real `imageAlt` frontmatter or `alt=` attribute.
4. Set that catalog entry's `status` to `reviewed`.

Always present drafted alt text to the owner as something to review before
publishing.

### When `fm` is not available

On any other machine, no catalog is written and nothing breaks — draft alt text
yourself from context exactly as before. The published result is the same; `fm`
only changes who drafts first. The owner can disable the pass even on a capable
Mac with `ALT_TEXT_AI=off` in `.site-config`, or a one-off `npm run ai-optimize -- --no-alt`.
```

- [ ] **Step 2: Update the owner-facing workflow doc**

In `template/docs/workflows/optimize-images.md`, add a short section (place it after the description of what the optimizer does):

```markdown
## AI-drafted alt text

If you're on a Mac with Apple Intelligence turned on, optimizing images also
drafts alt text for each one — a short description used by screen readers and
search engines. This happens entirely on your Mac; no images are uploaded
anywhere. Drafts land in `image-alt.json` and are marked as drafts until
reviewed.

These are starting points, not final copy. When an image goes on a page, your
webmaster refines the description to fit where it's used and shows it to you to
confirm. On computers without this feature, the descriptions are written
directly — the end result is the same.

To turn the feature off, add `ALT_TEXT_AI=off` to `.site-config`.
```

- [ ] **Step 3: Update the root CLAUDE.md**

In `CLAUDE.md` (root), make two edits:

a) In the editing-guidelines / decisions area, refresh the stale ADR count and range. Change the line:

```
Full ADRs are in `docs/decisions/` (ADR-0001 through ADR-0018).
```

to:

```
Full ADRs are in `docs/decisions/` (ADR-0001 through ADR-0021).
```

b) Add a one-line note under "Key decisions" (in the table, a new row):

```
| On-device `fm` as optional authoring accelerator | Free/private/offline drafts (alt text first); never in the deployed site, always falls back to Claude (ADR-0021) |
```

- [ ] **Step 4: Verify docs reference real paths**

Run: `npx vitest run`
Expected: PASS — no test regressions (doc-only changes plus the prior tasks).

Manually confirm: `skills/optimize-images/SKILL.md` references `image-alt.json`, `ALT_TEXT_AI`, and `--no-alt` consistently with `template/scripts/fm.ts` and `template/scripts/optimize-images.ts`.

- [ ] **Step 5: Commit**

```bash
git add skills/optimize-images/SKILL.md template/docs/workflows/optimize-images.md CLAUDE.md
git commit -m "docs: document on-device alt-text drafting + review flow"
```

---

## Self-Review

**Spec coverage:**
- `fm.ts` module (availability + alt generation, injectable runner) → Tasks 1-2.
- `image-alt.json` catalog at root, not in `public/`, `draft`/`reviewed` status, never-clobber-reviewed → Tasks 1 (helpers) + 3 (write path).
- Optimizer build-time pass, gated on availability + `--no-alt` + `ALT_TEXT_AI` → Task 3.
- Consumer/refinement path (placement + a11y-audit remediation, decorative → `alt=""`) → Task 5 Step 1.
- Fallback contract (no `fm` → Claude drafts inline) → Task 5 Steps 1-2.
- Testing split (pure helpers + mocked shell-outs in CI; real `fm` integration manual) → Tasks 1-2 (CI) + Task 3 Step 5 (manual).
- ADR-0021 + README + root CLAUDE.md + workflow doc + `.site-config` flag → Tasks 4-5.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `AltEntry`/`AltCatalog`, `CommandRunner`/`CommandResult`, and the helpers `normalizeAltOutput` / `catalogKeyFor` / `needsAltDraft` / `mergeAltEntry` / `shouldRunAltPass` / `readCatalog` / `writeCatalog` / `isFmAvailable` / `generateAltText` are named identically across Tasks 1-3 and the tests. The catalog key format (`/images/...`, leading slash, forward slashes) is produced by `catalogKeyFor` and matched by the test and the optimizer's `join(dirname(file), result.primary)` input.

No gaps found.
```
