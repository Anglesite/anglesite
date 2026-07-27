import { getCollection } from "astro:content";
import { createMarkdownProcessor, type MarkdownRenderer } from "@astrojs/markdown-remark";
import {
  FEED_COLLECTIONS,
  toFeedItem,
  sortAndLimit,
  type FeedEntry,
  type FeedItem,
  type FeedAuthor,
} from "./feeds.ts";
import { siteProfile } from "./profile.ts";

const PER_COLLECTION_LIMIT = 50;
const COMBINED_LIMIT = 50;

// Constructing a processor loads the remark/rehype plugin pipeline, so build it once and reuse
// the same promise for every entry across every collection in a build rather than per-entry.
let processorPromise: Promise<MarkdownRenderer> | undefined;
function getProcessor(): Promise<MarkdownRenderer> {
  if (!processorPromise) processorPromise = createMarkdownProcessor();
  return processorPromise;
}

/// Render an entry's markdown body to full HTML for the feed's `contentHtml`. Photos with no
/// body (caption-only) fall back to the caption text so an entry with *some* text to syndicate
/// never ends up with empty content.
async function renderContentHtml(entry: FeedEntry): Promise<string> {
  const body = entry.body?.trim();
  if (!body) {
    const caption = entry.data.caption;
    return caption ? String(caption) : "";
  }
  const renderer = await getProcessor();
  const { code } = await renderer.render(body);
  return code;
}

/// Map a collection's entries to feed items *without* sorting — callers that immediately re-sort
/// (the combined feed) skip the wasted per-collection sort. Drafts are always excluded (#798): a
/// feed is syndication data consumed by external readers, not a live dev preview, so unlike the
/// page routes above this filter is unconditional — dev or prod, a draft never appears in a feed.
async function mapCollection(collection: string, site: string): Promise<FeedItem[]> {
  const entries = await getCollection(collection as any, (entry: any) => !entry.data.draft);
  return Promise.all(
    entries.map(async (e: any) => {
      const entry: FeedEntry = { id: e.id, collection, data: e.data, body: e.body };
      const contentHtml = await renderContentHtml(entry);
      return toFeedItem(collection, entry, site, contentHtml);
    }),
  );
}

export async function getCollectionItems(
  collection: string,
  site: string,
  limit = PER_COLLECTION_LIMIT,
): Promise<FeedItem[]> {
  return sortAndLimit(await mapCollection(collection, site), limit);
}

export async function getCombinedItems(site: string, limit = COMBINED_LIMIT): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (const collection of Object.keys(FEED_COLLECTIONS)) {
    all.push(...(await mapCollection(collection, site)));
  }
  return sortAndLimit(all, limit);
}

/// Feed-level (channel/feed) author, derived from `siteProfile()` (`src/data/profile.json`).
/// `siteProfile()` reads via `import.meta.glob`, which only resolves under Astro/Vite — this
/// lookup belongs here (consumed by the 27 feed routes) rather than in `feeds.ts`, whose
/// renderers take `author` as a plain parameter so pure node:test unit tests can inject it
/// directly. Returns `undefined` when no name is configured (the default, unconfigured site),
/// so every renderer omits author markup cleanly.
export function feedAuthor(): FeedAuthor | undefined {
  const profile = siteProfile();
  const name = typeof profile.name === "string" && profile.name.length > 0 ? profile.name : undefined;
  if (!name) return undefined;
  const url = typeof profile.url === "string" && profile.url.length > 0 ? profile.url : undefined;
  return url ? { name, url } : { name };
}
