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

/**
 * Deterministic, non-empty fallback for a tag whose slugification produces nothing (e.g. "###",
 * which has no `[a-z0-9]` character to keep). Hex-joins the tag's own codepoints — stable across
 * calls and, unlike a random id, reproducible from static content alone (no build-time state).
 * `[...tag]` iterates by codepoint so astral characters (outside the BMP) aren't split into
 * mismatched surrogate halves. Empty input (`tagSlug("")`) falls through to the literal "tag".
 */
function fallbackSlug(tag: string): string {
  const hex = [...tag].map((ch) => ch.codePointAt(0)!.toString(16)).join("");
  return hex || "tag";
}

/**
 * URL-safe route param for a tag's `/tags/<slug>/` page. Tags are free text with no character
 * restrictions, so two defects motivate slugifying rather than `encodeURIComponent`-ing the raw
 * tag: a tag containing "/" makes an illegal `getStaticPaths` param and crashes `astro build`
 * ("Missing parameter: tag"); a tag containing "#" percent-encodes to an href a
 * standards-compliant static server can never match back to the literal directory Astro wrote
 * (it percent-decodes the request before the filesystem lookup, and "%23" decodes to "#", not
 * back to the on-disk "c%23d" Astro created). Lowercases, Unicode-normalizes (NFKD, so
 * e.g. "café"'s precomposed é decomposes into "e" plus a combining mark), then collapses every
 * run of non-`[a-z0-9]` characters (that combining mark included) to a single hyphen and trims
 * leading/trailing hyphens. Falls back to `fallbackSlug` when nothing alphanumeric survives, so
 * the route never gets an empty param.
 */
export function tagSlug(tag: string): string {
  const slug = tag
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallbackSlug(tag);
}

/** One `/tags/<slug>/` page's worth of data: the slug itself, every verbatim tag spelling that
 * maps to it (alphabetical), and the merged, deduped, newest-first entries tagged with any of
 * them. */
export interface TagGroup {
  slug: string;
  tags: string[];
  entries: TaggedEntry[];
}

/**
 * Group entries by `tagSlug`, not verbatim tag text, so spellings like "Hello World" and
 * "hello world" share one `/tags/hello-world/` page instead of each getting their own (and, more
 * importantly, so a tag containing "/" or "#" doesn't crash the build or 404 — see `tagSlug`).
 * An entry carrying two tags that collapse to the same slug (e.g. "Hello" and "hello") appears
 * only once in that slug's `entries`.
 */
export function groupBySlug(entries: TaggedEntry[]): Map<string, TagGroup> {
  const bySlug = new Map<string, TagGroup>();
  for (const entry of entries) {
    const seenSlugsForEntry = new Set<string>();
    for (const tag of entry.tags) {
      const slug = tagSlug(tag);
      let group = bySlug.get(slug);
      if (!group) {
        group = { slug, tags: [], entries: [] };
        bySlug.set(slug, group);
      }
      if (!group.tags.includes(tag)) group.tags.push(tag);
      if (!seenSlugsForEntry.has(slug)) {
        group.entries.push(entry);
        seenSlugsForEntry.add(slug);
      }
    }
  }
  for (const group of bySlug.values()) {
    group.tags.sort((a, b) => a.localeCompare(b));
    group.entries.sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf());
  }
  return bySlug;
}

/** Every slug in a `groupBySlug` map, alphabetically — a stable, deterministic order for both
 * the `/tags/` index and `getStaticPaths` iteration. */
export function sortedSlugs(bySlug: Map<string, TagGroup>): string[] {
  return [...bySlug.keys()].sort((a, b) => a.localeCompare(b));
}

export interface TagGroupCount {
  slug: string;
  tags: string[];
  count: number;
}

/** `{ slug, tags, count }` for every slug, alphabetically — what `/tags/` renders. `count` merges
 * across every verbatim spelling sharing that slug. */
export function tagGroupCounts(bySlug: Map<string, TagGroup>): TagGroupCount[] {
  return sortedSlugs(bySlug).map((slug) => {
    const group = bySlug.get(slug)!;
    return { slug, tags: group.tags, count: group.entries.length };
  });
}
