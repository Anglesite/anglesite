import type { APIContext } from "astro";
import { readConfig } from "../../scripts/config";
import { getCombinedItems } from "../lib/feed-data.ts";
import { renderRss, siteFrom, websubHub } from "../lib/feeds.ts";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderRss({
    title: "All posts",
    description: "Everything published on this site.",
    site,
    items: await getCombinedItems(site),
    hub: websubHub(site, "/rss.xml", readConfig("WEBSUB_ENABLED") === "true"),
  });
}
