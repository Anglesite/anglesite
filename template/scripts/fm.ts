/**
 * Apple Foundation Models (`fm`) helper — the single module that owns all
 * on-device model interaction for Anglesite.
 *
 * `fm` runs the on-device `system` model on an Apple-Silicon Mac with Apple
 * Intelligence enabled. It is an AUTHORING-TIME accelerator only: it never runs
 * in the deployed site, and every consumer MUST fall back to Claude when
 * `isFmAvailable()` returns false. See docs/decisions/0021-on-device-ai-accelerator.md.
 */

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
