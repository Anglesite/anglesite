import type { APIContext } from "astro";
import { siteFrom } from "../lib/feeds.ts";
import { getSitemapUrls } from "../lib/sitemap-data.ts";
import { renderSitemap } from "../lib/sitemap.ts";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderSitemap(await getSitemapUrls(site));
}
