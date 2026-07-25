/**
 * IndieWeb Post Type Discovery (https://www.w3.org/TR/post-type-discovery/), extended with a
 * `bookmark-of` check and a count-based photo/album split, mapping an incoming Micropub mf2
 * object to the Astro content collection it should land in once synced to git. See
 * docs/superpowers/specs/2026-07-24-micropub-content-sync-design.md §1.
 *
 * `discoverCollection` returns `null` for any type this bridge doesn't support yet (an
 * unrecognized `h-*` type, `repost-of`, `rsvp`, `checkin`, `video`) — the caller must fall back
 * to `@dwk/micropub`'s own default flat-URL policy rather than guessing a collection.
 */

import type { Mf2Object, MicropubCommands } from "@dwk/micropub";

function hasProperty(mf2: Mf2Object, name: string): boolean {
  const values = mf2.properties[name];
  return Array.isArray(values) && values.length > 0;
}

/**
 * Mirrors `worker.ts`'s AP fan-out `extractMf2ContentString` — same mf2 rich-text shape. The
 * standard Micropub JSON *create* shape for HTML content is `content: [{"html": "..."}]` with NO
 * `value` key at all — `value` only appears in mf2 read back off a rendered page, not in what a
 * client posts — so `html` is checked as a fallback, not just `value`.
 */
function plainTextContent(mf2: Mf2Object): string {
  const raw = mf2.properties.content?.[0];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as { value?: unknown; html?: unknown };
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.html === "string") return obj.html;
  }
  return "";
}

export function discoverCollection(mf2: Mf2Object): string | null {
  const type = mf2.type[0];
  if (type === "h-event") return "events";
  if (type === "h-review") return "reviews";
  if (type !== undefined && type !== "h-entry") return null;

  // Unsupported post types — these should be skipped, not miscategorized as notes/articles.
  // Check these before supported types (e.g., in-reply-to) to prevent combinations like
  // RSVP + in-reply-to from being miscategorized.
  if (hasProperty(mf2, "repost-of")) return null;
  if (hasProperty(mf2, "rsvp")) return null;
  if (hasProperty(mf2, "checkin")) return null;
  if (hasProperty(mf2, "video")) return null;

  if (hasProperty(mf2, "bookmark-of")) return "bookmarks";
  if (hasProperty(mf2, "like-of")) return "likes";
  if (hasProperty(mf2, "in-reply-to")) return "replies";

  const photoCount = mf2.properties.photo?.length ?? 0;
  if (photoCount === 1) return "photos";
  if (photoCount > 1) return "albums";

  const name = mf2.properties.name?.[0];
  if (typeof name === "string" && name.trim().length > 0) {
    const trimmedName = name.trim();
    const content = plainTextContent(mf2).trim();
    if (content.length > 0 && !content.startsWith(trimmedName)) return "articles";
  }
  return "notes";
}

/** Lowercase, dash-separated slug derived from arbitrary text (max 80 chars). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A short, collision-resistant slug: base36 timestamp plus random suffix. */
function randomSlug(): string {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${time}-${rand}`;
}

/**
 * Same slug policy as `@dwk/micropub`'s own default `generatePostUrl` (`mp-slug` → a slug
 * derived from `name` → a timestamp-based slug) — reimplemented here (not imported) because
 * the package doesn't export its internal `slugify`/`randomSlug` helpers. Kept identical so a
 * post's slug doesn't change depending on whether its type was recognized (see `worker.ts`'s
 * `generatePostUrl`, which calls this once and uses the same slug for both the type-aware and
 * flat-URL fallback branches).
 */
export function generateSlug(mf2: Mf2Object, commands: MicropubCommands): string {
  const name = mf2.properties.name?.[0];
  return (
    commands.slug ||
    (typeof name === "string" && name.trim() ? slugify(name) : "") ||
    randomSlug()
  );
}
