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
// Inbox triage classification types
// ---------------------------------------------------------------------------

export type SubmissionCategory = "lead" | "support" | "question" | "other";

export interface SubmissionClassification {
  category: SubmissionCategory;
  isSpam: boolean;
  reason: string;
}

const SUBMISSION_CATEGORIES: SubmissionCategory[] = ["lead", "support", "question", "other"];

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

/**
 * Parse `fm`'s structured-output JSON into a classification. Defensive:
 * validates the category against the allowed set (else "other"), coerces
 * isSpam to a boolean, and returns null only when the input is not a usable
 * JSON object. `fm` field order is not guaranteed, so this never relies on it.
 */
export function parseClassification(raw: string): SubmissionClassification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(ANSI, "").trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const categoryRaw = typeof o.category === "string" ? o.category.toLowerCase() : "";
  const category = (SUBMISSION_CATEGORIES as string[]).includes(categoryRaw)
    ? (categoryRaw as SubmissionCategory)
    : "other";
  const isSpam =
    o.isSpam === true || (typeof o.isSpam === "string" && /^(true|yes)$/i.test(o.isSpam));
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  return { category, isSpam, reason };
}

// ---------------------------------------------------------------------------
// Catalog I/O
// ---------------------------------------------------------------------------

export function readCatalog(path: string): AltCatalog {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AltCatalog)
      : {};
  } catch {
    return {};
  }
}

export function writeCatalog(path: string, catalog: AltCatalog): void {
  const ordered: AltCatalog = {};
  for (const k of Object.keys(catalog).sort()) ordered[k] = catalog[k];
  writeFileSync(path, JSON.stringify(ordered, null, 2) + "\n");
}

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
  opts?: { timeoutMs?: number; input?: string },
) => Promise<CommandResult>;

export const defaultRunner: CommandRunner = (command, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
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
    if (opts.input != null) {
      // Guard against EPIPE if the child exits without reading stdin.
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }
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

/** Identifier recorded in catalog entries for drafts produced by `fm`'s system model. */
export const FM_MODEL_ID = "apple-fm-system";

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
