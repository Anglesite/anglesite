import type { APIContext } from "astro";
import { getCollectionItems, feedAuthor, feedRsl } from "../../lib/feed-data.ts";
import { renderAtom, FEED_COLLECTIONS, siteFrom } from "../../lib/feeds.ts";

const COLLECTION = "replies";

export async function GET(context: APIContext) {
  const site = siteFrom(context);
  return renderAtom({
    title: FEED_COLLECTIONS[COLLECTION].title,
    site,
    feedUrl: new URL(`/${COLLECTION}/atom.xml`, site).href,
    items: await getCollectionItems(COLLECTION, site),
    author: feedAuthor(),
    rsl: feedRsl(site),
  });
}
