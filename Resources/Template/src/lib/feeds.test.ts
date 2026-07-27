import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEED_COLLECTIONS,
  toFeedItem,
  sortAndLimit,
  siteFrom,
  renderRss,
  renderAtom,
  renderJsonFeed,
  websubHub,
  type FeedEntry,
} from "./feeds.ts";

const SITE = "https://example.com";

function entry(collection: string, data: Record<string, any>, body = ""): FeedEntry {
  return { id: "hello", collection, data, body };
}

test("config covers all eight collections", () => {
  assert.deepEqual(
    Object.keys(FEED_COLLECTIONS).sort(),
    ["albums", "articles", "blog", "bookmarks", "likes", "notes", "photos", "replies"],
  );
});

test("toFeedItem uses pubDate for blog and an absolute link", () => {
  const item = toFeedItem("blog", entry("blog", { title: "Hi", pubDate: "2026-01-02" }), SITE);
  assert.equal(item.title, "Hi");
  assert.equal(item.link, "https://example.com/blog/hello/");
  assert.equal(item.date.getUTCFullYear(), 2026);
});

test("toFeedItem derives a title for a title-less note from its body", () => {
  const item = toFeedItem(
    "notes",
    entry("notes", { publishDate: "2026-01-02" }, "Just a quick thought about feeds."),
    SITE,
  );
  assert.ok(item.title.length > 0);
  assert.ok(item.title.startsWith("Just a quick"));
});

test("toFeedItem derives a title from the link host for a like", () => {
  const item = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post", publishDate: "2026-01-02" }),
    SITE,
  );
  assert.equal(item.title, "Liked indieweb.org");
});

test("toFeedItem throws on a missing or invalid date field", () => {
  assert.throws(
    () => toFeedItem("notes", entry("notes", {}), SITE),
    /missing or invalid publishDate/,
  );
  assert.throws(
    () => toFeedItem("notes", entry("notes", { publishDate: "not-a-date" }), SITE),
    /missing or invalid publishDate/,
  );
});

test("siteFrom returns the href or throws a clear error when site is unset", () => {
  assert.equal(siteFrom({ site: new URL("https://x.test/") }), "https://x.test/");
  assert.throws(() => siteFrom({}), /not configured/);
});

test("sortAndLimit sorts newest first and caps", () => {
  const mk = (iso: string): any => ({ title: iso, link: "/", date: new Date(iso), summary: "" });
  const out = sortAndLimit([mk("2026-01-01"), mk("2026-03-01"), mk("2026-02-01")], 2);
  assert.deepEqual(out.map((i) => i.title), ["2026-03-01", "2026-02-01"]);
});

test("renderRss produces RSS XML with the item and escapes specials", async () => {
  const res = await renderRss({
    title: "All",
    description: "Everything",
    site: SITE,
    items: [{ title: "A & B", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi" }],
  });
  const xml = await res.text();
  assert.match(xml, /<rss/);
  assert.match(xml, /A &(amp|#38);? ?B|A &amp; B/);
  assert.match(xml, /example\.com\/blog\/a\//);
});

test("renderAtom produces a feed with entry and self link", () => {
  const res = renderAtom({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/atom.xml`,
    items: [{ title: "A", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi" }],
  });
  assert.equal(res.headers.get("content-type"), "application/atom+xml; charset=utf-8");
});

test("renderJsonFeed produces valid JSON Feed 1.1", async () => {
  const res = renderJsonFeed({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/feed.json`,
    items: [{ title: "A", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi" }],
  });
  const feed = JSON.parse(await res.text());
  assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(feed.feed_url, `${SITE}/feed.json`);
  assert.equal(feed.items[0].url, `${SITE}/blog/a/`);
});

// --- WebSub discovery (V-3.3, #361) ---------------------------------------------------------

test("websubHub returns hub + self URLs when enabled, undefined when not", () => {
  assert.deepEqual(websubHub(SITE, "/rss.xml", true), {
    hubUrl: "https://example.com/websub",
    selfUrl: "https://example.com/rss.xml",
  });
  assert.equal(websubHub(SITE, "/rss.xml", false), undefined);
});

test("renderRss advertises the hub via atom:link rel=hub and rel=self when enabled", async () => {
  const hub = websubHub(SITE, "/rss.xml", true)!;
  const res = await renderRss({
    title: "All",
    description: "Everything",
    site: SITE,
    items: [],
    hub,
  });
  const xml = await res.text();
  assert.match(xml, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(xml, /<atom:link rel="hub" href="https:\/\/example\.com\/websub"\/>/);
  assert.match(xml, /<atom:link rel="self" type="application\/rss\+xml" href="https:\/\/example\.com\/rss\.xml"\/>/);
});

test("renderRss emits no hub advertisement when the hub is not provisioned", async () => {
  const res = await renderRss({ title: "All", description: "Everything", site: SITE, items: [] });
  const xml = await res.text();
  assert.doesNotMatch(xml, /rel="hub"/);
});

test("renderAtom emits a rel=hub link only when a hub URL is given", async () => {
  const withHub = renderAtom({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/atom.xml`,
    items: [],
    hubUrl: `${SITE}/websub`,
  });
  assert.match(await withHub.text(), /<link rel="hub" href="https:\/\/example\.com\/websub"\/>/);

  const withoutHub = renderAtom({ title: "All", site: SITE, feedUrl: `${SITE}/atom.xml`, items: [] });
  assert.doesNotMatch(await withoutHub.text(), /rel="hub"/);
});

test("renderJsonFeed emits a WebSub hubs array only when a hub URL is given", async () => {
  const withHub = renderJsonFeed({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/feed.json`,
    items: [],
    hubUrl: `${SITE}/websub`,
  });
  assert.deepEqual(JSON.parse(await withHub.text()).hubs, [
    { type: "WebSub", url: `${SITE}/websub` },
  ]);

  const withoutHub = renderJsonFeed({ title: "All", site: SITE, feedUrl: `${SITE}/feed.json`, items: [] });
  assert.equal(JSON.parse(await withoutHub.text()).hubs, undefined);
});
