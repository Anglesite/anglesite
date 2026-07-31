import rss from "@astrojs/rss";

export interface FeedItem {
  /** Absent for collections whose items have no natural title (notes, replies, likes, photos,
   * and bookmarks without an explicit title) — a synthesized title (excerpt/"Re: host"/etc.) is
   * not a real title, so we omit the field rather than fake one. */
  title?: string;
  link: string; // absolute
  date: Date;
  summary: string;
  /** Full entry body rendered to HTML at build time (see `feed-data.ts`). */
  contentHtml: string;
  /** `entry.data.tags`, when the collection's schema has the field and the entry set it. */
  tags?: string[];
}

/** Feed-level (RSS channel / Atom feed / JSON Feed) attribution, sourced from `siteProfile()`. */
export interface FeedAuthor {
  name: string;
  url?: string;
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
  deriveTitle(entry: FeedEntry): string | undefined;
}

/** Exported for reuse by `/tags/[tag]/` (`tags.ts`), which needs the same title-less-entry
 * fallback text as the feeds do. */
export function excerpt(body: string | undefined, max = 80): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

export const FEED_COLLECTIONS: Record<string, FeedCollectionConfig> = {
  blog: { title: "Blog", dateField: "pubDate", deriveTitle: (e) => e.data.title },
  notes: { title: "Notes", dateField: "publishDate", deriveTitle: () => undefined },
  articles: { title: "Articles", dateField: "publishDate", deriveTitle: (e) => e.data.title },
  photos: { title: "Photos", dateField: "publishDate", deriveTitle: () => undefined },
  albums: { title: "Albums", dateField: "publishDate", deriveTitle: (e) => e.data.title },
  bookmarks: { title: "Bookmarks", dateField: "publishDate", deriveTitle: (e) => e.data.title },
  replies: { title: "Replies", dateField: "publishDate", deriveTitle: () => undefined },
  likes: { title: "Likes", dateField: "publishDate", deriveTitle: () => undefined },
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

/**
 * Fallback `contentHtml` for interaction posts (likes/replies/bookmarks) whose body rendered to
 * nothing — a like/reply/bookmark with no commentary still has faithful content to syndicate:
 * the target URL it points at. This is deliberately *not* prose ("Liked", "Re:", …) — a
 * synthesized caption is exactly what #1021/#1022 removed; the target URL is the one piece of
 * real content every interaction post has. Photos keep their existing caption fallback
 * (`feed-data.ts`'s `renderContentHtml`) and are untouched here.
 */
function interactionContentFallback(collection: string, data: Record<string, any>): string {
  const targetUrl =
    collection === "likes"
      ? data.likeOf
      : collection === "replies"
        ? data.inReplyTo
        : collection === "bookmarks"
          ? data.bookmarkOf
          : undefined;
  if (!targetUrl) return "";
  const escaped = escapeXml(String(targetUrl));
  return `<a href="${escaped}">${escaped}</a>`;
}

/** Resolve a possibly root-relative path against the site origin; already-absolute URLs,
 * protocol-relative URLs, and fragments pass through unchanged. Mirrors the `new URL(path, site)`
 * pattern used elsewhere in the template (`schema.ts`'s `abs()`, `sitemap.ts`) for turning a
 * content field's root-relative path into a URL usable outside the site's own pages. */
function absolutizeUrl(pathOrUrl: string, site: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith("//") || pathOrUrl.startsWith("#")) {
    return pathOrUrl;
  }
  try {
    return new URL(pathOrUrl, site).href;
  } catch {
    return pathOrUrl;
  }
}

/**
 * Rewrite every `src="…"`/`href="…"` attribute in a fragment of rendered markdown HTML to an
 * absolute URL against `site`. A note or article body can write `![](/images/x.png)` or
 * `[text](/about/)` — fine when the page itself is served from the site, but feed content
 * travels into a reader with no notion of "relative to this site", so a relative URL there is
 * simply broken (#1043).
 */
export function absolutizeHtmlUrls(html: string, site: string): string {
  return html.replace(/\b(src|href)="([^"]*)"/g, (match, attr, value) =>
    value ? `${attr}="${absolutizeUrl(value, site)}"` : match,
  );
}

/**
 * The `<img>` tag prepended to a photo entry's `contentHtml` (#1043) — without it, a body-less
 * photo post syndicates as bare caption text and the photo itself never reaches the feed.
 * `data.image` is the photos schema's root-relative path (`content.config.ts`); absolutized the
 * same way a body's relative URLs are, since a feed reader has no site context to resolve it
 * against.
 */
export function photoImageHtml(data: Record<string, any>, site: string): string {
  const image = typeof data.image === "string" && data.image.length > 0 ? data.image : undefined;
  if (!image) return "";
  const alt = typeof data.caption === "string" ? data.caption : "";
  return `<img src="${escapeXml(absolutizeUrl(image, site))}" alt="${escapeXml(alt)}">`;
}

/**
 * Build a `FeedItem` from a content entry. `contentHtml` is the entry body already rendered to
 * HTML — rendering is async (`createMarkdownProcessor`) and lives in `feed-data.ts`, so it's
 * computed by the caller and passed in rather than made here, keeping this function synchronous
 * and easy to unit test. When the rendered body is empty, likes/replies/bookmarks fall back to
 * a link to their target URL (`interactionContentFallback`) rather than shipping empty content.
 * Relative URLs inside the rendered body are absolutized, and a photo entry gets its image
 * prepended, regardless of whether it had a body (#1043).
 */
export function toFeedItem(
  collection: string,
  entry: FeedEntry,
  site: string,
  contentHtml: string,
): FeedItem {
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
  const tags = Array.isArray(entry.data.tags) && entry.data.tags.length > 0 ? entry.data.tags : undefined;
  const absolutized = contentHtml ? absolutizeHtmlUrls(contentHtml, site) : contentHtml;
  const body = absolutized || interactionContentFallback(collection, entry.data);
  const withImage = collection === "photos" ? photoImageHtml(entry.data, site) + body : body;
  return {
    title: cfg.deriveTitle(entry) || undefined,
    link: new URL(`/${collection}/${entry.id}/`, site).href,
    date,
    summary: String(summary),
    contentHtml: withImage,
    tags,
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
  /** Channel-level attribution, rendered as `<dc:creator>` (RSS 2.0 has no native author element). */
  author?: FeedAuthor;
}): Promise<Response> {
  // RSS 2.0 has no native link relations; WebSub discovery in RSS uses Atom link elements
  // inside <channel> (the convention websub.rocks and every major reader check).
  const hubData = o.hub
    ? `<atom:link rel="hub" href="${escapeXml(o.hub.hubUrl)}"/>` +
      `<atom:link rel="self" type="application/rss+xml" href="${escapeXml(o.hub.selfUrl)}"/>`
    : undefined;
  const authorData = o.author ? `<dc:creator>${escapeXml(o.author.name)}</dc:creator>` : undefined;
  const customData = [hubData, authorData].filter((s): s is string => Boolean(s)).join("") || undefined;
  const xmlns: Record<string, string> = {};
  if (o.hub) xmlns.atom = "http://www.w3.org/2005/Atom";
  if (o.author) xmlns.dc = "http://purl.org/dc/elements/1.1/";
  return rss({
    title: o.title,
    description: o.description,
    site: o.site,
    ...(Object.keys(xmlns).length ? { xmlns } : {}),
    ...(customData ? { customData } : {}),
    items: o.items.map((i) => ({
      // Zod's `title` field is optional and `@astrojs/rss` only emits <title> when truthy, so an
      // absent `i.title` correctly drops the element rather than rendering it empty.
      title: i.title,
      link: i.link,
      pubDate: i.date,
      // Invariant: RSS 2.0 requires title *or* description on every item, so a title-less item
      // must always have a non-empty description. `contentHtml` (full HTML body, or the
      // interaction-post target-URL fallback from `toFeedItem`) carries it when present, then
      // the short summary, then — for a pathological entry with no title, no content, and no
      // summary — the permalink itself, which is never empty. `fast-xml-parser`'s `XMLBuilder`
      // (used by `@astrojs/rss` under the hood) escapes text-node content automatically, so the
      // raw `i.link` here doesn't need manual XML-escaping, and neither does `i.contentHtml`
      // (already real HTML that needs exactly the one automatic escape pass to travel safely as
      // XML text). `i.summary`, though, is plain text that readers still interpret as HTML once
      // they XML-decode `<description>` — so when it's promoted to stand in for contentHtml it
      // needs an *additional* HTML-escape pass first (`escapeXml` here) so that a literal "&" or
      // "<" the author typed renders as that literal character rather than markup; the automatic
      // XML-escape pass astro-rss applies on top only protects the transport encoding, not this.
      description: i.contentHtml || escapeXml(i.summary) || i.link,
      // `@astrojs/rss` maps a `categories` array to one <category> element per tag; `undefined`
      // (no tags) is dropped, matching the title/description optionality above.
      categories: i.tags,
    })),
  });
}

export function escapeXml(s: string): string {
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
  /** Feed-level attribution, rendered as a top-level `<author>`. */
  author?: FeedAuthor;
}): Response {
  const updated = o.items[0]?.date ?? new Date(0);
  const entries = o.items
    .map((i) => {
      // One <category term="…"/> per tag; entries without tags emit none.
      const categories = (i.tags ?? []).map((t) => `    <category term="${escapeXml(t)}"/>\n`).join("");
      // <summary> is optional in Atom (RFC 4287); an empty one is noise, not signal, so omit the
      // element entirely rather than emitting `<summary></summary>`.
      const summaryXml = i.summary ? `    <summary>${escapeXml(i.summary)}</summary>\n` : "";
      // Known limitation: <id> uses the permalink rather than a permanent tag: IRI (RFC 4287
      // §4.2.6). Renaming a slug therefore reads as a new entry in readers that saw the old URL.
      // This matches most simple RSS libraries; a stable tag: URI is a future improvement.
      // Atom requires <title> on every entry (unlike RSS/JSON Feed); title-less items emit an
      // empty element rather than omitting the tag or faking a title.
      return `  <entry>
    <title>${escapeXml(i.title ?? "")}</title>
    <link href="${escapeXml(i.link)}"/>
    <id>${escapeXml(i.link)}</id>
    <updated>${i.date.toISOString()}</updated>
${categories}${summaryXml}    <content type="html">${escapeXml(i.contentHtml)}</content>
  </entry>`;
    })
    .join("\n");
  const authorXml = o.author
    ? `  <author>
    <name>${escapeXml(o.author.name)}</name>
${o.author.url ? `    <uri>${escapeXml(o.author.url)}</uri>\n` : ""}  </author>
`
    : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(o.title)}</title>
  <id>${escapeXml(o.site)}</id>
  <link href="${escapeXml(o.site)}"/>
  <link rel="self" href="${escapeXml(o.feedUrl)}"/>
${o.hubUrl ? `  <link rel="hub" href="${escapeXml(o.hubUrl)}"/>\n` : ""}${authorXml}  <updated>${updated.toISOString()}</updated>
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
  /** Feed-level attribution, rendered as the top-level `authors` array. */
  author?: FeedAuthor;
}): Response {
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: o.title,
    home_page_url: o.site,
    feed_url: o.feedUrl,
    ...(o.hubUrl ? { hubs: [{ type: "WebSub", url: o.hubUrl }] } : {}),
    ...(o.author ? { authors: [{ name: o.author.name, url: o.author.url }] } : {}),
    items: o.items.map((i) => ({
      id: i.link,
      url: i.link,
      // Undefined `title` is dropped by JSON.stringify below, matching JSON Feed's "title is
      // optional" contract for items with no natural title.
      title: i.title,
      // An empty summary is noise, not signal — omit the key entirely rather than emitting
      // `"summary": ""`. Unlike `title` above, JSON.stringify only drops `undefined`, not an
      // empty *string*, so this needs an explicit conditional spread.
      ...(i.summary ? { summary: i.summary } : {}),
      // JSON Feed 1.1 requires content_html or content_text on every item; fall back to the
      // short summary when the body was empty. `i.summary` is plain text, but `content_html` is
      // parsed as HTML by every consumer, so it needs HTML-escaping when it stands in for
      // `contentHtml` (already real HTML, left untouched) — otherwise a literal "&"/"<" in the
      // summary would be misread as an entity/tag instead of the literal character the author
      // wrote.
      content_html: i.contentHtml || escapeXml(i.summary),
      date_published: i.date.toISOString(),
      // Undefined (no tags) is dropped by JSON.stringify below.
      tags: i.tags,
    })),
  };
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { "Content-Type": "application/feed+json; charset=utf-8" },
  });
}
