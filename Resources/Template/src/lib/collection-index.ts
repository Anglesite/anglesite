/**
 * Pure helpers shared by the collection index pages (`src/pages/<collection>/index.astro`) and
 * the combined `/timeline/` page — kept free of the `astro:content` import so they stay
 * unit-testable with plain `node:test` (same rationale as `tags.ts` / `content-schemas.ts`). The
 * `astro:content`-importing half of this feature lives in `collection-index-astro.ts`.
 */

/**
 * The mf2 `u-*` class an inline (title-less) entry's target-URL fallback link should carry,
 * mirroring the properties `Hentry.astro` emits for a populated `bookmarkOf`/`inReplyTo`/
 * `likeOf` field. `undefined` for collections with no such field (notes, photos, and every
 * titled collection).
 */
export function targetClassFor(collection: string): string | undefined {
  switch (collection) {
    case "likes":
      return "u-like-of";
    case "replies":
      return "u-in-reply-to";
    case "bookmarks":
      return "u-bookmark-of";
    default:
      return undefined;
  }
}

/**
 * An entry's outbound target URL for its collection (`likeOf`/`inReplyTo`/`bookmarkOf`), or
 * `undefined` for collections with no such field or an entry missing it. Mirrors `feeds.ts`'s
 * private `interactionContentFallback` target-URL lookup — index/timeline pages render the same
 * fallback link inline (in place of an empty `e-content`) that the feeds render as `contentHtml`
 * when a like/reply/bookmark's body is empty (#1021/#1022).
 */
export function targetUrlFor(collection: string, data: Record<string, unknown>): string | undefined {
  const raw =
    collection === "likes"
      ? data.likeOf
      : collection === "replies"
        ? data.inReplyTo
        : collection === "bookmarks"
          ? data.bookmarkOf
          : undefined;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
