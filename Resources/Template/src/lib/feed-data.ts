import { getCollection } from "astro:content";
import { createMarkdownProcessor, type MarkdownRenderer } from "@astrojs/markdown-remark";
import {
  FEED_COLLECTIONS,
  toFeedItem,
  sortAndLimit,
  escapeXml,
  type FeedEntry,
  type FeedItem,
  type FeedAuthor,
  type FeedRsl,
} from "./feeds.ts";
import { siteProfile, ownerName } from "./profile.ts";
import { readConfig } from "../../scripts/config";
import { assertsNothingExplicitly, type LicensableCollection } from "./licensing.ts";
import { licensingPolicy, licenseFor } from "./licensing-data.ts";
import { rslActive } from "./rsl.ts";

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
/// body (caption-only) fall back to the caption text, HTML-escaped and wrapped as a paragraph
/// (the caption is plain text, but `contentHtml` is consumed as HTML everywhere it's rendered —
/// JSON Feed `content_html`, Atom `<content type="html">`, RSS description — so a caption
/// containing `&`/`<`/etc. must not be promoted into HTML unescaped), so an entry with *some*
/// text to syndicate never ends up with empty content.
async function renderContentHtml(entry: FeedEntry): Promise<string> {
  const body = entry.body?.trim();
  if (!body) {
    const caption = entry.data.caption;
    return caption ? `<p>${escapeXml(String(caption))}</p>` : "";
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
  const policy = licensingPolicy();
  const licensable = collection as LicensableCollection;
  const licenseInfo = {
    license: licenseFor(licensable),
    assertsNothingExplicitly: assertsNothingExplicitly(policy, licensable),
  };
  return Promise.all(
    entries.map(async (e: any) => {
      const entry: FeedEntry = { id: e.id, collection, data: e.data, body: e.body };
      const contentHtml = await renderContentHtml(entry);
      return toFeedItem(collection, entry, site, contentHtml, licenseInfo);
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

/// The site-wide RSL context to pass as `renderRss`/`renderAtom`'s `rsl` option (#992), or
/// undefined when RSL isn't active for this build (`rslActive` in `rsl.ts` — the same gate
/// `scripts/edge-artifacts.ts`, `scripts/csp.ts`, and `BaseLayout.astro` all use). `holder` uses
/// the same `COPYRIGHT_HOLDER`/h-card fallback as `Rights.astro`'s footer statement, unlike
/// `edge-artifacts.ts`'s `main()` (which has no Vite context to read `ownerName()` from).
export function feedRsl(site: string): FeedRsl | undefined {
  const policy = licensingPolicy();
  if (!rslActive(policy, site)) return undefined;
  const holder = readConfig("COPYRIGHT_HOLDER") ?? ownerName();
  return { usage: policy.usage, holder };
}
