import type { APIContext } from "astro";
import { readConfig } from "../../scripts/config";
import { getCombinedItems } from "../lib/feed-data.ts";
import { renderAtom, siteFrom, websubHub } from "../lib/feeds.ts";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderAtom({
    title: "All posts",
    site,
    feedUrl: new URL("/atom.xml", site).href,
    items: await getCombinedItems(site),
    hubUrl: websubHub(site, "/atom.xml", readConfig("WEBSUB_ENABLED") === "true")?.hubUrl,
  });
}
