/**
 * sitemap.xml generation (#982). Pure helpers here; `sitemap-data.ts` does the `astro:content`
 * fetching and `src/pages/sitemap.xml.ts` is the thin route, mirroring how the feeds are split.
 *
 * A sitemap is what lets a crawler discover pages it can't reach by following links, and
 * `<lastmod>` is what tells it which of those pages changed since its last visit.
 */
import { escapeXml } from "./feeds.ts";

export interface SitemapUrl {
  /** Absolute URL of the page. */
  loc: string;
  /** When the page last changed; omitted from the output when absent. */
  lastmod?: Date;
}

/** One routed content entry, in the shape `sitemap-data.ts` reads out of `astro:content`. */
export interface SitemapEntry {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

/**
 * The route Astro builds one page file at, or undefined when the file isn't a page worth
 * listing. Deriving these from the files that actually exist — rather than a hardcoded list —
 * is what keeps the sitemap from advertising a page the owner deleted, and picks up a page they
 * added for free. Dynamic routes are skipped because their pages come from the collections,
 * which are enumerated separately; `404` is skipped because a sitemap lists pages worth
 * indexing.
 */
export function routePathForPage(file: string): string | undefined {
  const relative = file.slice(file.lastIndexOf("pages/") + "pages/".length);
  if (relative.includes("[")) return undefined;
  const withoutExtension = relative.replace(/\.(astro|md|mdx)$/, "");
  if (withoutExtension === "404") return undefined;
  const path = withoutExtension.replace(/(^|\/)index$/, "").replace(/\/$/, "");
  return path === "" ? "/" : `/${path}/`;
}

/**
 * Every URL in the sitemap: the static routes, then one per content entry. Entry URLs use the
 * same `/collection/id/` shape as the feed links (`toFeedItem`), because they are the same pages.
 * The home page sorts first; the rest keep a stable alphabetical order so a rebuild that changed
 * no content produces a byte-identical sitemap.
 */
export function buildSitemapUrls(
  site: string,
  staticPaths: string[],
  entries: SitemapEntry[],
): SitemapUrl[] {
  const sortedPaths = [...staticPaths].sort((a, b) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );
  return [
    ...sortedPaths.map((path) => ({ loc: new URL(path, site).href })),
    ...entries.map((entry) => ({
      loc: new URL(`/${entry.collection}/${entry.id}/`, site).href,
      lastmod: lastmodFor(entry.data),
    })),
  ];
}

/**
 * Date keys the content collections use, most-recently-meaningful first. A single precedence
 * list rather than a per-collection table: every routed collection in `content.config.ts` dates
 * its entries with one of these, and a collection added later inherits the behavior for free.
 * `updatedDate` isn't in any schema yet — it's here so that adding it anywhere immediately means
 * "this is the date crawlers should re-check", which is exactly what `<lastmod>` is for.
 */
const LASTMOD_KEYS = ["updatedDate", "pubDate", "publishDate", "start"] as const;

/**
 * The `<lastmod>` for one entry, or undefined when it has no usable date — the element is
 * optional, and omitting it is better than emitting a wrong or invalid one.
 */
export function lastmodFor(data: Record<string, unknown>): Date | undefined {
  for (const key of LASTMOD_KEYS) {
    const raw = data[key];
    if (raw === undefined || raw === null) continue;
    const date = raw instanceof Date ? raw : new Date(String(raw));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

export function renderSitemap(urls: SitemapUrl[]): Response {
  const entries = urls
    .map((url) => {
      const lastmod = url.lastmod ? `\n    <lastmod>${url.lastmod.toISOString()}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(url.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
