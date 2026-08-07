import type { APIContext } from "astro";
import { getCollectionItems, feedAuthor, feedRsl } from "../../lib/feed-data.ts";
import { renderRss, FEED_COLLECTIONS, siteFrom } from "../../lib/feeds.ts";

const COLLECTION = "replies";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderRss({
    title: FEED_COLLECTIONS[COLLECTION].title,
    description: `${FEED_COLLECTIONS[COLLECTION].title} feed`,
    site,
    items: await getCollectionItems(COLLECTION, site),
    author: feedAuthor(),
    rsl: feedRsl(site),
  });
}
