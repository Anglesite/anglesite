import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSitemapUrls, lastmodFor, renderSitemap, routePathForPage } from "./sitemap.ts";

const SITE = "https://example.com";

test("routePathForPage maps the index page to the site root", () => {
  assert.equal(routePathForPage("../pages/index.astro"), "/");
});

test("routePathForPage maps a top-level page to a trailing-slash route", () => {
  assert.equal(routePathForPage("../pages/about.md"), "/about/");
});

test("routePathForPage maps a nested index page to its directory route", () => {
  assert.equal(routePathForPage("../pages/blog/index.astro"), "/blog/");
});

test("routePathForPage skips the 404 page — a sitemap lists pages worth indexing", () => {
  assert.equal(routePathForPage("../pages/404.astro"), undefined);
});

test("routePathForPage skips dynamic routes, whose pages come from the collections", () => {
  assert.equal(routePathForPage("../pages/blog/[...slug].astro"), undefined);
  assert.equal(routePathForPage("../pages/[collection]/[...slug].astro"), undefined);
});

test("renderSitemap emits a urlset in the sitemaps.org namespace", async () => {
  const xml = await renderSitemap([{ loc: "https://example.com/" }]).text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<url>\s*<loc>https:\/\/example\.com\/<\/loc>\s*<\/url>/);
});

test("renderSitemap emits lastmod as a W3C datetime when the entry has one", async () => {
  const xml = await renderSitemap([
    { loc: "https://example.com/blog/hello/", lastmod: new Date("2026-01-02T03:04:05Z") },
  ]).text();
  assert.match(xml, /<lastmod>2026-01-02T03:04:05\.000Z<\/lastmod>/);
});

test("renderSitemap omits lastmod entirely when the entry has no date", async () => {
  const xml = await renderSitemap([{ loc: "https://example.com/about/" }]).text();
  assert.equal(xml.includes("<lastmod>"), false);
});

test("renderSitemap escapes XML metacharacters in a loc", async () => {
  const xml = await renderSitemap([{ loc: "https://example.com/notes/a&b/" }]).text();
  assert.match(xml, /<loc>https:\/\/example\.com\/notes\/a&amp;b\/<\/loc>/);
});

test("renderSitemap serves application/xml", () => {
  const response = renderSitemap([{ loc: "https://example.com/" }]);
  assert.equal(response.headers.get("Content-Type"), "application/xml; charset=utf-8");
});

test("buildSitemapUrls makes each static route absolute, home first", () => {
  const locs = buildSitemapUrls(SITE, ["/about/", "/"], []).map((url) => url.loc);
  assert.deepEqual(locs, ["https://example.com/", "https://example.com/about/"]);
});

test("buildSitemapUrls gives an entry the same absolute URL its feed link uses", () => {
  const urls = buildSitemapUrls(SITE, [], [
    { collection: "notes", id: "hello", data: { publishDate: new Date("2026-03-04") } },
  ]);
  const note = urls.find((url) => url.loc.includes("/notes/"));
  assert.equal(note?.loc, "https://example.com/notes/hello/");
});

test("buildSitemapUrls carries each entry's lastmod through", () => {
  const urls = buildSitemapUrls(SITE, [], [
    { collection: "blog", id: "hello", data: { pubDate: new Date("2026-01-02") } },
  ]);
  const post = urls.find((url) => url.loc.endsWith("/blog/hello/"));
  assert.deepEqual(post?.lastmod, new Date("2026-01-02"));
});

test("lastmodFor reads pubDate for a blog post", () => {
  assert.deepEqual(lastmodFor({ pubDate: new Date("2026-01-02") }), new Date("2026-01-02"));
});

test("lastmodFor reads publishDate for the post-family collections", () => {
  assert.deepEqual(
    lastmodFor({ publishDate: new Date("2026-03-04") }),
    new Date("2026-03-04"),
  );
});

test("lastmodFor reads start for an event, which has no publish date", () => {
  assert.deepEqual(lastmodFor({ start: new Date("2026-05-06") }), new Date("2026-05-06"));
});

test("lastmodFor prefers updatedDate over the original publication date", () => {
  const data = { pubDate: new Date("2026-01-02"), updatedDate: new Date("2026-06-07") };
  assert.deepEqual(lastmodFor(data), new Date("2026-06-07"));
});

test("lastmodFor coerces a string date", () => {
  assert.deepEqual(lastmodFor({ publishDate: "2026-03-04" }), new Date("2026-03-04"));
});

test("lastmodFor returns undefined when there is no usable date", () => {
  assert.equal(lastmodFor({}), undefined);
  assert.equal(lastmodFor({ publishDate: "not a date" }), undefined);
});
