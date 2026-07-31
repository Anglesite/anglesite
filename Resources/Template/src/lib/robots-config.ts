/**
 * `src/data/robots-config.json` (#1093) — the site's editable source of truth for per-route
 * noindex/disallow directives, written directly by the Anglesite app when a page's inspector
 * toggle changes. `BaseLayout.astro`, `scripts/csp.ts`, and `scripts/edge-artifacts.ts` all read
 * this file independently at build time; nothing here scans page files to reconstruct it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RobotsConfigSource {
  kind: "page" | "collection";
  file?: string;
  collection?: string;
  id?: string;
}

export interface RobotsConfigEntry {
  path: string;
  source?: RobotsConfigSource | null;
}

export interface RobotsConfig {
  noindex: RobotsConfigEntry[];
  disallow: RobotsConfigEntry[];
  extra: string[];
}

/**
 * Shared empty config. Frozen (object *and* arrays) so a caller that spreads it without overriding
 * every field — `{ ...EMPTY_ROBOTS_CONFIG }` — can't push into the arrays it now shares with every
 * other such caller. Reading and spreading still work; only in-place mutation is blocked.
 */
const emptyRobotsConfig: RobotsConfig = { noindex: [], disallow: [], extra: [] };
Object.freeze(emptyRobotsConfig.noindex);
Object.freeze(emptyRobotsConfig.disallow);
Object.freeze(emptyRobotsConfig.extra);
export const EMPTY_ROBOTS_CONFIG: RobotsConfig = Object.freeze(emptyRobotsConfig);

/** Reads and validates the shape loosely — malformed/missing input reads as empty, never throws. */
export function readRobotsConfig(cwd: string): RobotsConfig {
  const path = resolve(cwd, "src/data/robots-config.json");
  if (!existsSync(path)) return { noindex: [], disallow: [], extra: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      noindex: Array.isArray(raw.noindex) ? raw.noindex : [],
      disallow: Array.isArray(raw.disallow) ? raw.disallow : [],
      extra: Array.isArray(raw.extra) ? raw.extra : [],
    };
  } catch {
    return { noindex: [], disallow: [], extra: [] };
  }
}

/** True when `pathname` exactly matches a `noindex` entry's `path`. */
export function isNoindexed(pathname: string, config: RobotsConfig): boolean {
  return config.noindex.some((entry) => entry.path === pathname);
}

/**
 * Strips CR/LF from a string that is about to be interpolated into `robots.txt` or `_headers`.
 * Both formats are newline-delimited, so a path or label containing one would inject an extra
 * directive or header block — defense in depth against a pathological filename (#1093).
 */
export function sanitizeForHeaderLine(s: string): string {
  return s.replace(/[\r\n]/g, "");
}

/**
 * A short human-readable label for a `Disallow` line's `# from …` back-reference comment, or
 * `null` for no comment. A `{kind: "collection"}` entry missing `collection`/`id` — only reachable
 * via a malformed hand-edit — returns `null` rather than rendering `"undefined/undefined"`.
 */
export function sourceLabel(source: RobotsConfigSource | null | undefined): string | null {
  if (!source) return null;
  if (source.kind === "collection") {
    if (!source.collection || !source.id) return null;
    return sanitizeForHeaderLine(`${source.collection}/${source.id}`);
  }
  return source.file ? sanitizeForHeaderLine(source.file) : null;
}
