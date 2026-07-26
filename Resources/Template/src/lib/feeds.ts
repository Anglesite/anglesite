import rss from "@astrojs/rss";

export interface FeedItem {
  title: string;
  link: string; // absolute
  date: Date;
  summary: string;
}

export type FeedEntry = {
  id: string;
  collection: string;
  data: Record<string, any>;
  body?: string;
};

export interface FeedCollectionConfig {
  title: string;
  dateField: string;
  deriveTitle(entry: FeedEntry): string;
}

function host(url: unknown): string {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url ?? "");
  }
}

function excerpt(body: string | undefined, max = 80): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text || "Untitled";
  return text.slice(0, max).trimEnd() + "…";
}

export const FEED_COLLECTIONS: Record<string, FeedCollectionConfig> = {
  blog: { title: "Blog", dateField: "pubDate", deriveTitle: (e) => e.data.title },
  notes: { title: "Notes", dateField: "publishDate", deriveTitle: (e) => excerpt(e.body) },
  articles: { title: "Articles", dateField: "publishDate", deriveTitle: (e) => e.data.title },
  photos: {
    title: "Photos",
    dateField: "publishDate",
    deriveTitle: (e) => e.data.caption ?? "Photo",
  },
  albums: { title: "Albums", dateField: "publishDate", deriveTitle: (e) => e.data.title },
  bookmarks: {
    title: "Bookmarks",
    dateField: "publishDate",
    deriveTitle: (e) => e.data.title ?? host(e.data.bookmarkOf),
  },
  replies: {
    title: "Replies",
    dateField: "publishDate",
    deriveTitle: (e) => "Re: " + host(e.data.inReplyTo),
  },
  likes: {
    title: "Likes",
    dateField: "publishDate",
    deriveTitle: (e) => "Liked " + host(e.data.likeOf),
  },
};

/// Resolve the absolute site base URL from an Astro endpoint context, failing loudly when
/// `site` is unset. `astro.config.ts` always provides a fallback, so in practice this never
/// throws — but an `Invalid`/undefined site would otherwise surface as an opaque TypeError in
/// all 27 feed routes, so we give one clear message instead.
export function siteFrom(context: { site?: URL }): string {
  if (!context.site) {
    throw new Error(
      "[feeds] Astro `site` is not configured — set SITE_URL in .site-config so feeds can emit absolute URLs.",
    );
  }
  return context.site.href;
}

/** WebSub discovery advertisement for one feed: the hub plus the feed's own canonical URL. */
export interface WebSubHubAdvertisement {
  /** Absolute URL of the site's WebSub hub endpoint (`/websub`). */
  hubUrl: string;
  /** Absolute canonical URL of this feed — the topic a subscriber passes as `hub.topic`. */
  selfUrl: string;
}

/**
 * The WebSub advertisement for the feed at `selfPath`, or `undefined` when the hub isn't
 * provisioned (`WEBSUB_ENABLED` in `.site-config`, written by Anglesite's worker provisioning).
 * WebSub discovery requires the topic to advertise both `rel="hub"` and `rel="self"`, and the
 * URLs must match the hub's allowed-topic list (worker/worker.ts `WEBSUB_TOPIC_PATHS`) — both
 * derive from the same canonical site origin, so they agree by construction.
 */
export function websubHub(
  site: string,
  selfPath: string,
  enabled: boolean,
): WebSubHubAdvertisement | undefined {
  if (!enabled) return undefined;
  return {
    hubUrl: new URL("/websub", site).href,
    selfUrl: new URL(selfPath, site).href,
  };
}

export function toFeedItem(collection: string, entry: FeedEntry, site: string): FeedItem {
  const cfg = FEED_COLLECTIONS[collection];
  if (!cfg) throw new Error(`No feed config for collection "${collection}"`);
  const rawDate = entry.data[cfg.dateField];
  const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
  // An invalid/missing date would make `sortAndLimit` non-deterministic and crash
  // `renderAtom`/`renderJsonFeed` at `date.toISOString()` (RangeError). Fail at build instead.
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[feeds] entry "${entry.id}" has a missing or invalid ${cfg.dateField}`);
  }
  const summary = (entry.data.summary ?? entry.data.caption ?? excerpt(entry.body, 280)) || "";
  return {
    title: cfg.deriveTitle(entry) || "Untitled",
    link: new URL(`/${collection}/${entry.id}/`, site).href,
    date,
    summary: String(summary),
  };
}

export function sortAndLimit(items: FeedItem[], limit?: number): FeedItem[] {
  const sorted = [...items].sort((a, b) => b.date.valueOf() - a.date.valueOf());
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

export function renderRss(o: {
  title: string;
  description: string;
  site: string;
  items: FeedItem[];
  hub?: WebSubHubAdvertisement;
}): Promise<Response> {
  // RSS 2.0 has no native link relations; WebSub discovery in RSS uses Atom link elements
  // inside <channel> (the convention websub.rocks and every major reader check).
  const hubData = o.hub
    ? `<atom:link rel="hub" href="${escapeXml(o.hub.hubUrl)}"/>` +
      `<atom:link rel="self" type="application/rss+xml" href="${escapeXml(o.hub.selfUrl)}"/>`
    : undefined;
  return rss({
    title: o.title,
    description: o.description,
    site: o.site,
    ...(hubData
      ? { xmlns: { atom: "http://www.w3.org/2005/Atom" }, customData: hubData }
      : {}),
    items: o.items.map((i) => ({
      title: i.title,
      link: i.link,
      pubDate: i.date,
      description: i.summary,
    })),
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderAtom(o: {
  title: string;
  site: string;
  feedUrl: string;
  items: FeedItem[];
  /** WebSub hub URL; emits a `rel="hub"` link when set (`rel="self"` is always present). */
  hubUrl?: string;
}): Response {
  const updated = o.items[0]?.date ?? new Date(0);
  const entries = o.items
    .map(
      // Known limitation: <id> uses the permalink rather than a permanent tag: IRI (RFC 4287
      // §4.2.6). Renaming a slug therefore reads as a new entry in readers that saw the old URL.
      // This matches most simple RSS libraries; a stable tag: URI is a future improvement.
      (i) => `  <entry>
    <title>${escapeXml(i.title)}</title>
    <link href="${escapeXml(i.link)}"/>
    <id>${escapeXml(i.link)}</id>
    <updated>${i.date.toISOString()}</updated>
    <summary>${escapeXml(i.summary)}</summary>
  </entry>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(o.title)}</title>
  <id>${escapeXml(o.site)}</id>
  <link href="${escapeXml(o.site)}"/>
  <link rel="self" href="${escapeXml(o.feedUrl)}"/>
${o.hubUrl ? `  <link rel="hub" href="${escapeXml(o.hubUrl)}"/>\n` : ""}  <updated>${updated.toISOString()}</updated>
${entries}
</feed>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
  });
}

export function renderJsonFeed(o: {
  title: string;
  site: string;
  feedUrl: string;
  items: FeedItem[];
  /** WebSub hub URL; emits the JSON Feed `hubs` array when set. */
  hubUrl?: string;
}): Response {
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: o.title,
    home_page_url: o.site,
    feed_url: o.feedUrl,
    ...(o.hubUrl ? { hubs: [{ type: "WebSub", url: o.hubUrl }] } : {}),
    items: o.items.map((i) => ({
      id: i.link,
      url: i.link,
      title: i.title,
      summary: i.summary,
      date_published: i.date.toISOString(),
    })),
  };
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { "Content-Type": "application/feed+json; charset=utf-8" },
  });
}
