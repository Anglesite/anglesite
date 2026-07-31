import { getCollection, render, type RenderResult } from "astro:content";
import { FEED_COLLECTIONS } from "./feeds.ts";
import { targetClassFor, targetUrlFor } from "./collection-index.ts";

/**
 * One entry's worth of data for a collection index page or `/timeline/` — the page-side
 * equivalent of `feed-data.ts`'s `FeedItem`, but carrying the rendered `Content` component (so
 * the page can inline the entry's full body) instead of pre-rendered `contentHtml`, plus the raw
 * fields `IndexEntry.astro` needs to decide how to present an entry (image, target-URL fallback,
 * tags). A title present (`title`) means "render as a linked headline" (articles, albums, and
 * titled bookmarks); absent means "render full content inline" (notes, photos, replies, likes,
 * and title-less bookmarks) — same `deriveTitle` truthiness `feeds.ts` uses to decide whether a
 * feed item gets a `<title>`.
 */
export interface IndexItem {
  collection: string;
  id: string;
  permalink: string;
  date: Date;
  draft: boolean;
  title?: string;
  summary?: string;
  caption?: string;
  image?: string;
  tags?: string[];
  /** Whether the entry's markdown body renders to non-empty content — when false, an
   * interaction post (likes/replies/bookmarks) falls back to its target URL as a link in place
   * of `Content` (mirrors `feeds.ts`'s `interactionContentFallback`). */
  hasBody: boolean;
  /** `likeOf`/`inReplyTo`/`bookmarkOf`, when the collection has one. */
  targetUrl?: string;
  /** The mf2 `u-*` class for `targetUrl` (`u-like-of`/`u-in-reply-to`/`u-bookmark-of`). */
  targetClass?: string;
  Content: RenderResult["Content"];
}

// The metadata half of `IndexItem` plus the source `entry`, ahead of the `render()` call that
// produces `Content`. Sorting/slicing (`getTimelineItems`) happens on this cheap shape so
// `render()` — the expensive part — only runs on the entries that survive the cap.
type IndexItemMeta = Omit<IndexItem, "Content"> & { entry: any };

// `entry` is whatever `getCollection` hands back (a real content-layer entry, not a
// reconstructed object) — `render()` needs the original entry, not a copy, and `data`/`body`/
// `id` are read straight off it. Typed loosely (matching `feed-data.ts`'s `as any` collection
// param) because this loops over every collection in `FEED_COLLECTIONS` rather than one typed
// literal.
function toIndexItemMeta(collection: string, entry: any): IndexItemMeta {
  const cfg = FEED_COLLECTIONS[collection];
  if (!cfg) throw new Error(`[collection-index] no feed config for collection "${collection}"`);
  const data = entry.data as Record<string, unknown>;
  const rawDate = data[cfg.dateField];
  const date = rawDate instanceof Date ? rawDate : new Date(rawDate as string);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[collection-index] entry "${entry.id}" has a missing or invalid ${cfg.dateField}`);
  }
  return {
    collection,
    id: entry.id,
    permalink: `/${collection}/${entry.id}/`,
    date,
    draft: Boolean(data.draft),
    title: cfg.deriveTitle(entry) || undefined,
    summary: typeof data.summary === "string" ? data.summary : undefined,
    caption: typeof data.caption === "string" ? data.caption : undefined,
    image: typeof data.image === "string" ? data.image : undefined,
    tags: Array.isArray(data.tags) && data.tags.length > 0 ? (data.tags as string[]) : undefined,
    hasBody: Boolean((entry.body as string | undefined)?.trim()),
    targetUrl: targetUrlFor(collection, data),
    targetClass: targetClassFor(collection),
    entry,
  };
}

// Renders `meta.entry` into `Content`, the one part of `IndexItem` that costs build time.
async function withContent({ entry, ...item }: IndexItemMeta): Promise<IndexItem> {
  const { Content } = await render(entry);
  return { ...item, Content };
}

/// Fetch one collection's entries as `IndexItemMeta`s, unsorted. Drafts are excluded in PROD
/// only — matching `blog/index.astro` and `[collection]/[...slug].astro`'s page-route convention
/// (a dev preview shows drafts with `DraftBadge`), unlike `feed-data.ts`'s unconditional exclusion
/// (a feed is syndication data, not a live preview).
async function mapEntryMetas(collection: string): Promise<IndexItemMeta[]> {
  const entries = await getCollection(collection as any, ({ data }: any) =>
    import.meta.env.PROD ? !data.draft : true,
  );
  return entries.map((entry: any) => toIndexItemMeta(collection, entry));
}

/// One collection's entries, reverse-chronological — what each `<collection>/index.astro` lists.
/// Every entry is shown (no cap), so metadata and `Content` are built together.
export async function getIndexItems(collection: string): Promise<IndexItem[]> {
  const items = await Promise.all((await mapEntryMetas(collection)).map(withContent));
  return items.sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

/// Combined reverse-chronological stream across all eight feed collections (blog plus the seven
/// micropost/titled collections) — the page-side equivalent of `feed-data.ts`'s
/// `getCombinedItems`, capped at the same default limit. Sorts and slices metadata first, then
/// renders `Content` only for the entries that survive the cap — build cost scales with `limit`,
/// not with total post count.
export async function getTimelineItems(limit = 50): Promise<IndexItem[]> {
  const allMetas: IndexItemMeta[] = [];
  for (const collection of Object.keys(FEED_COLLECTIONS)) {
    allMetas.push(...(await mapEntryMetas(collection)));
  }
  const surviving = allMetas.sort((a, b) => b.date.valueOf() - a.date.valueOf()).slice(0, limit);
  return Promise.all(surviving.map(withContent));
}
