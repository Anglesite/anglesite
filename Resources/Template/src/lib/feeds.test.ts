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
  const item = toFeedItem("blog", entry("blog", { title: "Hi", pubDate: "2026-01-02" }), SITE, "<p>Hi</p>");
  assert.equal(item.title, "Hi");
  assert.equal(item.link, "https://example.com/blog/hello/");
  assert.equal(item.date.getUTCFullYear(), 2026);
});

test("toFeedItem passes the rendered contentHtml through unchanged", () => {
  const item = toFeedItem(
    "blog",
    entry("blog", { title: "Hi", pubDate: "2026-01-02" }),
    SITE,
    "<p>Full <em>body</em>.</p>",
  );
  assert.equal(item.contentHtml, "<p>Full <em>body</em>.</p>");
});

test("toFeedItem leaves a note title-less rather than synthesizing one from its body", () => {
  const item = toFeedItem(
    "notes",
    entry("notes", { publishDate: "2026-01-02" }, "Just a quick thought about feeds."),
    SITE,
    "<p>Just a quick thought about feeds.</p>",
  );
  assert.equal(item.title, undefined);
});

test("toFeedItem leaves a reply and a like title-less rather than deriving from the link host", () => {
  const like = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post", publishDate: "2026-01-02" }),
    SITE,
    "",
  );
  assert.equal(like.title, undefined);

  const reply = toFeedItem(
    "replies",
    entry("replies", { inReplyTo: "https://indieweb.org/post", publishDate: "2026-01-02" }),
    SITE,
    "",
  );
  assert.equal(reply.title, undefined);
});

test("toFeedItem leaves a photo title-less even when a caption is present", () => {
  const item = toFeedItem(
    "photos",
    entry("photos", { caption: "Sunset over the bay", publishDate: "2026-01-02" }),
    SITE,
    "Sunset over the bay",
  );
  assert.equal(item.title, undefined);
});

test("toFeedItem uses the bookmark's title when present, otherwise leaves it title-less", () => {
  const titled = toFeedItem(
    "bookmarks",
    entry("bookmarks", { title: "Great post", bookmarkOf: "https://indieweb.org/post", publishDate: "2026-01-02" }),
    SITE,
    "",
  );
  assert.equal(titled.title, "Great post");

  const untitled = toFeedItem(
    "bookmarks",
    entry("bookmarks", { bookmarkOf: "https://indieweb.org/post", publishDate: "2026-01-02" }),
    SITE,
    "",
  );
  assert.equal(untitled.title, undefined);
});

test("toFeedItem gives an empty-body, title-less entry an empty summary rather than a synthesized 'Untitled'", () => {
  const like = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post", publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );
  assert.equal(like.summary, "");
  assert.equal(like.title, undefined);
});

test("toFeedItem throws on a missing or invalid date field", () => {
  assert.throws(
    () => toFeedItem("notes", entry("notes", {}), SITE, ""),
    /missing or invalid publishDate/,
  );
  assert.throws(
    () => toFeedItem("notes", entry("notes", { publishDate: "not-a-date" }), SITE, ""),
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

const FULL_HTML = "<p>Paragraph one.</p>\n<p>Paragraph two.</p>";

test("renderRss produces RSS XML with the item and escapes specials", async () => {
  const res = await renderRss({
    title: "All",
    description: "Everything",
    site: SITE,
    items: [
      {
        title: "A & B",
        link: `${SITE}/blog/a/`,
        date: new Date("2026-01-02"),
        summary: "hi",
        contentHtml: "",
      },
    ],
  });
  const xml = await res.text();
  assert.match(xml, /<rss/);
  assert.match(xml, /A &(amp|#38);? ?B|A &amp; B/);
  assert.match(xml, /example\.com\/blog\/a\//);
});

test("renderRss omits <title> for a title-less item and falls back to the summary for description", async () => {
  const res = await renderRss({
    title: "All",
    description: "Everything",
    site: SITE,
    items: [{ link: `${SITE}/notes/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: "" }],
  });
  const xml = await res.text();
  assert.doesNotMatch(xml, /<title>hi<\/title>/);
  assert.match(xml, /<description>hi<\/description>/);
});

test("renderRss uses the full HTML content as the description when present", async () => {
  const res = await renderRss({
    title: "All",
    description: "Everything",
    site: SITE,
    items: [
      { link: `${SITE}/notes/a/`, date: new Date("2026-01-02"), summary: "short", contentHtml: FULL_HTML },
    ],
  });
  const xml = await res.text();
  assert.match(xml, /Paragraph one\./);
  assert.match(xml, /Paragraph two\./);
  assert.doesNotMatch(xml, /<description>short<\/description>/);
});

test("renderAtom produces a feed with entry and self link", () => {
  const res = renderAtom({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/atom.xml`,
    items: [
      { title: "A", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: "" },
    ],
  });
  assert.equal(res.headers.get("content-type"), "application/atom+xml; charset=utf-8");
});

test("renderAtom emits an empty <title> element for a title-less item", async () => {
  const res = renderAtom({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/atom.xml`,
    items: [{ link: `${SITE}/notes/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: "" }],
  });
  const xml = await res.text();
  assert.match(xml, /<title><\/title>/);
});

test("renderAtom emits the full HTML content as an escaped <content type=\"html\"> element", async () => {
  const res = renderAtom({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/atom.xml`,
    items: [
      { title: "A", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: FULL_HTML },
    ],
  });
  const xml = await res.text();
  assert.match(xml, /<content type="html">.*Paragraph one\..*Paragraph two\..*<\/content>/s);
  assert.match(xml, /&lt;p&gt;Paragraph one\.&lt;\/p&gt;/);
});

test("renderJsonFeed produces valid JSON Feed 1.1", async () => {
  const res = renderJsonFeed({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/feed.json`,
    items: [
      { title: "A", link: `${SITE}/blog/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: FULL_HTML },
    ],
  });
  const feed = JSON.parse(await res.text());
  assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(feed.feed_url, `${SITE}/feed.json`);
  assert.equal(feed.items[0].url, `${SITE}/blog/a/`);
  assert.equal(feed.items[0].content_html, FULL_HTML);
});

test("renderJsonFeed omits the title key for a title-less item and falls back to summary for content_html", async () => {
  const res = renderJsonFeed({
    title: "All",
    site: SITE,
    feedUrl: `${SITE}/feed.json`,
    items: [{ link: `${SITE}/notes/a/`, date: new Date("2026-01-02"), summary: "hi", contentHtml: "" }],
  });
  const feed = JSON.parse(await res.text());
  assert.equal("title" in feed.items[0], false);
  assert.equal(feed.items[0].content_html, "hi");
});

// --- Empty-body entries never synthesize "Untitled" text (#1021/#1022 follow-up) -----------

test("renderRss, renderAtom, and renderJsonFeed never emit 'Untitled' for an empty-body, title-less item", async () => {
  const like = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post", publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );

  const rssXml = await (
    await renderRss({ title: "Likes", description: "Likes", site: SITE, items: [like] })
  ).text();
  assert.doesNotMatch(rssXml, /Untitled/);

  const atomXml = await renderAtom({
    title: "Likes",
    site: SITE,
    feedUrl: `${SITE}/likes/atom.xml`,
    items: [like],
  }).text();
  assert.doesNotMatch(atomXml, /Untitled/);

  const jsonFeed = await (
    await renderJsonFeed({ title: "Likes", site: SITE, feedUrl: `${SITE}/likes/feed.json`, items: [like] })
  ).text();
  assert.doesNotMatch(jsonFeed, /Untitled/);
});

// --- Target-URL content fallback for empty-body interaction posts (#1022 follow-up) ---------

test("toFeedItem falls back to an escaped anchor to likeOf when the like has no body", () => {
  const like = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post?a=1&b=2", publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );
  assert.equal(
    like.contentHtml,
    `<a href="https://indieweb.org/post?a=1&amp;b=2">https://indieweb.org/post?a=1&amp;b=2</a>`,
  );
});

test("toFeedItem falls back to an escaped anchor to inReplyTo when the reply has no body", () => {
  const reply = toFeedItem(
    "replies",
    entry("replies", { inReplyTo: "https://indieweb.org/post", publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );
  assert.equal(
    reply.contentHtml,
    `<a href="https://indieweb.org/post">https://indieweb.org/post</a>`,
  );
});

test("toFeedItem falls back to an escaped anchor to bookmarkOf when the bookmark has no body", () => {
  const bookmark = toFeedItem(
    "bookmarks",
    entry("bookmarks", { bookmarkOf: "https://indieweb.org/post", publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );
  assert.equal(
    bookmark.contentHtml,
    `<a href="https://indieweb.org/post">https://indieweb.org/post</a>`,
  );
});

test("toFeedItem does not synthesize a target-URL fallback for collections without one", () => {
  const note = toFeedItem(
    "notes",
    entry("notes", { publishDate: "2026-01-02" }, ""),
    SITE,
    "",
  );
  assert.equal(note.contentHtml, "");
});

test("toFeedItem leaves non-empty contentHtml untouched (no fallback applied)", () => {
  const like = toFeedItem(
    "likes",
    entry("likes", { likeOf: "https://indieweb.org/post", publishDate: "2026-01-02" }, "some body"),
    SITE,
    "<p>rendered body</p>",
  );
  assert.equal(like.contentHtml, "<p>rendered body</p>");
});

test("renderRss falls back to the permalink for <description> when contentHtml and summary are both empty", async () => {
  const res = await renderRss({
    title: "Likes",
    description: "Likes",
    site: SITE,
    items: [
      {
        link: `${SITE}/likes/hello-like/`,
        date: new Date("2026-01-02"),
        summary: "",
        contentHtml: "",
      },
    ],
  });
  const xml = await res.text();
  assert.match(xml, new RegExp(`<description>${SITE.replace(/\./g, "\\.")}/likes/hello-like/</description>`));
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
