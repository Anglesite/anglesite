import { getCollection } from "astro:content";
import { ENTRY_COLLECTIONS } from "./collections.ts";
import {
  buildSitemapUrls,
  routePathForPage,
  type SitemapEntry,
  type SitemapUrl,
} from "./sitemap.ts";

/**
 * The static page files, resolved at build time by Vite. `eager: false` keeps this to a list of
 * paths — the modules themselves are never loaded, only their filenames matter. The glob lives
 * here rather than in `sitemap.ts` so the pure helpers stay runnable under `node --test`.
 */
const PAGE_FILES = import.meta.glob("../pages/**/*.{astro,md,mdx}");

/** Routes for the pages that exist in this site, dynamic routes and 404 excluded. */
function staticPaths(): string[] {
  return Object.keys(PAGE_FILES)
    .map(routePathForPage)
    .filter((path): path is string => path !== undefined);
}

/**
 * Every routed collection: the typed content types plus `blog`, which has its own route
 * (`src/pages/blog/[...slug].astro`) rather than going through `[collection]/[...slug].astro`.
 */
const SITEMAP_COLLECTIONS = ["blog", ...ENTRY_COLLECTIONS];

/**
 * The sitemap's URLs for this build. Draft filtering matches the page routes exactly —
 * `import.meta.env.PROD ? !draft : true` — rather than the feeds' unconditional exclusion,
 * because a sitemap must list the pages the build actually produced and nothing else: a `<loc>`
 * that 404s is worse than an omitted one. (Business types carry no `draft` key; `!undefined` is
 * true, so they pass through unfiltered, same as in the routes.)
 */
export async function getSitemapUrls(site: string): Promise<SitemapUrl[]> {
  const entries: SitemapEntry[] = [];
  for (const collection of SITEMAP_COLLECTIONS) {
    // `as any` on the collection name (the loop erases the literal-union type) makes the result
    // `unknown[]`, so the entries are re-typed here the same way `feed-data.ts` does it.
    const visible: any[] = await getCollection(collection as any, (entry: any) =>
      import.meta.env.PROD ? !entry.data.draft : true,
    );
    for (const entry of visible) {
      entries.push({ collection, id: entry.id, data: entry.data });
    }
  }
  return buildSitemapUrls(site, staticPaths(), entries);
}
