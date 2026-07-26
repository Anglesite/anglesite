import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EmbedSnapshot } from "./types";

/** Snapshot records live in src/ (committed, not served); their media lives in public/ (served). */
export const SNAPSHOT_DIR = "src/embeds";
export const MEDIA_DIR = "public/embeds";

/** Extensions we are willing to write. Anything else becomes .img rather than trusting the URL. */
const SAFE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

/**
 * Stable identity for a snapshot. Must not drift: the slug names committed media paths that
 * end up in built HTML, so a change would orphan every previously-captured asset.
 */
export function embedSlug(canonicalURL: string): string {
  return createHash("sha256").update(canonicalURL).digest("hex").slice(0, 12);
}

function isRemote(src: string | undefined): src is string {
  return typeof src === "string" && /^https?:\/\//i.test(src);
}

/** Every remote URL this snapshot still references, in a stable order (avatar first). */
export function collectRemoteAssets(snap: EmbedSnapshot): string[] {
  const out: string[] = [];
  if (isRemote(snap.author.avatar)) out.push(snap.author.avatar);
  for (const asset of snap.media) if (isRemote(asset.src)) out.push(asset.src);
  return out;
}

/**
 * Index-based filename. Deliberately does not reuse the remote basename: those can contain
 * path traversal, be absent entirely (Bluesky's CIDs), or collide across assets.
 */
export function assetFilename(remoteURL: string, index: number): string {
  let ext = "";
  try {
    ext = new URL(remoteURL).pathname.split(".").pop()?.toLowerCase() ?? "";
  } catch {
    ext = "";
  }
  return SAFE_EXTENSIONS.has(ext) ? `asset-${index}.${ext}` : `asset-${index}.img`;
}

/**
 * Replace every remote asset reference with its downloaded repo-relative path. An asset absent
 * from the map is **dropped**, never left remote — a half-localized snapshot would silently
 * reintroduce the third-party request this whole feature exists to remove.
 */
export function localizeAssets(snap: EmbedSnapshot, map: Record<string, string>): EmbedSnapshot {
  const avatar = snap.author.avatar;
  return {
    ...snap,
    author: {
      ...snap.author,
      avatar: isRemote(avatar) ? map[avatar] : avatar,
    },
    media: snap.media
      .map((asset) => (isRemote(asset.src) ? { ...asset, src: map[asset.src] } : asset))
      .filter((asset): asset is EmbedSnapshot["media"][number] => typeof asset.src === "string"),
  };
}

export function snapshotPath(cwd: string, slug: string): string {
  return resolve(cwd, SNAPSHOT_DIR, `${slug}.json`);
}

export function mediaDir(cwd: string, slug: string): string {
  return resolve(cwd, MEDIA_DIR, slug);
}

export function writeSnapshot(cwd: string, snap: EmbedSnapshot): string {
  const path = snapshotPath(cwd, embedSlug(snap.url));
  mkdirSync(resolve(cwd, SNAPSHOT_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snap, null, 2)}\n`, "utf-8");
  _cache.delete(resolve(cwd, SNAPSHOT_DIR));
  return path;
}

// Hentry.astro pulls every h-entry collection through this one layout, so loadAllSnapshots
// runs on every rendered page — including plain notes/articles that never cite anything.
// Cache per resolved snapshot directory so the readdirSync + JSON.parse pass happens once per
// build rather than once per page. Keyed on the directory (not a single global cwd) so callers
// pointed at different roots (tests, multiple sites) don't bleed into each other.
const _cache = new Map<string, Map<string, EmbedSnapshot>>();

/**
 * Every committed snapshot, keyed by canonical URL. Called once per build by the remark plugin
 * and by Hentry.astro — reading the directory, never the network.
 */
export function loadAllSnapshots(cwd: string): Map<string, EmbedSnapshot> {
  const dir = resolve(cwd, SNAPSHOT_DIR);
  const cached = _cache.get(dir);
  if (cached !== undefined) return new Map(cached);

  const out = new Map<string, EmbedSnapshot>();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const snap = JSON.parse(readFileSync(join(dir, name), "utf-8")) as EmbedSnapshot;
        if (snap.version === 1 && typeof snap.url === "string") out.set(snap.url, snap);
      } catch {
        // A corrupt snapshot degrades that one embed to a plain link; it must never fail a build.
      }
    }
  }
  _cache.set(dir, out);
  return new Map(out);
}
