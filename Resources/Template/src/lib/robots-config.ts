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

export const EMPTY_ROBOTS_CONFIG: RobotsConfig = { noindex: [], disallow: [], extra: [] };

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

/** A short human-readable label for a `Disallow` line's `# from …` back-reference comment. */
export function sourceLabel(source: RobotsConfigSource | null | undefined): string | null {
  if (!source) return null;
  if (source.kind === "collection") return `${source.collection}/${source.id}`;
  return source.file ?? null;
}
