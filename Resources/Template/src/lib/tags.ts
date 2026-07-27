import { excerpt } from "./feeds.ts";

/**
 * The subset of a tagged content entry that `/tags/[tag]/` and `/tags/` need. Kept as a plain
 * object (rather than `CollectionEntry<TaggedCollection>`) so this stays importable — and
 * unit-testable with plain `node:test` — outside Astro's `astro:content` virtual module, same
 * rationale as `content-schemas.ts`.
 */
export interface TaggedEntry {
  id: string;
  collection: string;
  tags: string[];
  title?: string;
  summary?: string;
  caption?: string;
  body?: string;
  publishDate: Date;
}

/**
 * Where a tagged entry's own page lives. Every collection in `TAGGED_COLLECTIONS` is routed
 * through `[collection]/[...slug].astro`, which always publishes at `/<collection>/<id>/`
 * (same shape `feeds.ts`'s `toFeedItem` uses for `FeedItem.link`) — `blog` is not among them
 * (it has no `tags` field), so there's no `/blog/<id>/` special case to handle here.
 */
export function permalinkFor(collection: string, id: string): string {
  return `/${collection}/${id}/`;
}

/**
 * Display label for a tagged-entry link: the entry's title when it has one (articles, albums,
 * and titled bookmarks); otherwise its summary/caption (notes have neither field, photos have
 * `caption`); otherwise an excerpt of its body. Same fallback chain and order as `feeds.ts`'s
 * `toFeedItem` (`entry.data.summary ?? entry.data.caption ?? excerpt(entry.body, …)`), so a
 * title-less note/photo/bookmark reads the same way here as it does in a feed. Falls back to
 * the entry id only in the unlikely case a title-less entry also has no summary, caption, or
 * body text, so the link never renders with no visible text.
 */
export function labelFor(entry: Pick<TaggedEntry, "id" | "title" | "summary" | "caption" | "body">): string {
  return entry.title || entry.summary || entry.caption || excerpt(entry.body, 80) || entry.id;
}

/**
 * Group entries by tag, each tag's entries sorted reverse-chronologically (newest first) —
 * matching `blog/index.astro`'s listing convention. An entry with multiple tags appears once
 * per tag it carries.
 */
export function groupByTag(entries: TaggedEntry[]): Map<string, TaggedEntry[]> {
  const byTag = new Map<string, TaggedEntry[]>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const list = byTag.get(tag);
      if (list) list.push(entry);
      else byTag.set(tag, [entry]);
    }
  }
  for (const list of byTag.values()) {
    list.sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf());
  }
  return byTag;
}

/** Every tag name in a `groupByTag` map, alphabetically — a stable, deterministic order for
 * both the `/tags/` index and `getStaticPaths` iteration. */
export function sortedTagNames(byTag: Map<string, TaggedEntry[]>): string[] {
  return [...byTag.keys()].sort((a, b) => a.localeCompare(b));
}

export interface TagCount {
  tag: string;
  count: number;
}

/** `{ tag, count }` for every tag, alphabetically — what `/tags/` renders. */
export function tagCounts(byTag: Map<string, TaggedEntry[]>): TagCount[] {
  return sortedTagNames(byTag).map((tag) => ({ tag, count: byTag.get(tag)!.length }));
}
