import type { APIContext } from "astro";
import { getCollectionItems, feedAuthor } from "../../lib/feed-data.ts";
import { renderJsonFeed, FEED_COLLECTIONS, siteFrom } from "../../lib/feeds.ts";

const COLLECTION = "photos";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderJsonFeed({
    title: FEED_COLLECTIONS[COLLECTION].title,
    site,
    feedUrl: new URL(`/${COLLECTION}/feed.json`, site).href,
    items: await getCollectionItems(COLLECTION, site),
    author: feedAuthor(),
  });
}
