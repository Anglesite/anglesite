/**
 * Routed content collections, declared once so the dynamic route and the per-vocabulary
 * layouts can't drift from each other (or from content.config.ts).
 */

/** The eight h-entry collections that share Hentry.astro. */
export const HENTRY_COLLECTIONS = [
  "notes", "articles", "photos", "albums",
  "bookmarks", "replies", "likes", "announcements",
] as const;
export type HentryCollection = (typeof HENTRY_COLLECTIONS)[number];

/** Every routed collection: h-entry plus the vocabularies with their own layout. */
export const ENTRY_COLLECTIONS = [
  ...HENTRY_COLLECTIONS, "events", "reviews",
] as const;
export type EntryCollection = (typeof ENTRY_COLLECTIONS)[number];

/**
 * The collections whose schema declares a `tags` field (see `content.config.ts` /
 * `content-schemas.ts`) — the set `/tags/[tag]/` and `/tags/` aggregate over. `blog`, `replies`,
 * and `likes` are h-entry collections but have no `tags` field, so they're deliberately excluded
 * here even though they're in `HENTRY_COLLECTIONS` above.
 */
export const TAGGED_COLLECTIONS = ["notes", "articles", "photos", "albums", "bookmarks"] as const;
export type TaggedCollection = (typeof TAGGED_COLLECTIONS)[number];
