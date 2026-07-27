import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  htmlToText,
  normalizeX,
  normalizeYouTube,
  normalizeBluesky,
  normalizeMastodon,
  normalizeOpenGraph,
  hasOpenGraphMetadata,
} from "./normalize";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(here, "fixtures", name), "utf-8");
const json = (name: string) => JSON.parse(fixture(name));

const AT = "2026-07-25T00:00:00.000Z";

test("htmlToText: strips tags and decodes the entities platforms actually emit", () => {
  assert.equal(htmlToText("<p>a &amp; b</p>"), "a & b");
  assert.equal(htmlToText("x&nbsp;&mdash;&nbsp;y"), "x — y");
  assert.equal(htmlToText("<p>one</p><p>two</p>"), "one\n\ntwo");
  assert.equal(htmlToText("&lt;script&gt;"), "<script>");
});

test("normalizeX: extracts text, author, handle and date from the oEmbed blockquote", () => {
  const s = normalizeX(json("x-oembed.json"), "https://x.com/jack/status/20", AT);
  assert.equal(s.version, 1);
  assert.equal(s.provider, "x");
  assert.equal(s.content, "just setting up my twttr");
  assert.equal(s.author.name, "jack");
  assert.equal(s.author.handle, "@jack");
  assert.equal(s.author.url, "https://x.com/jack");
  assert.equal(s.publishedAt, new Date("March 21, 2006").toISOString());
  // X's oEmbed carries no avatar and no media — the card must cope with that.
  assert.equal(s.author.avatar, undefined);
  assert.deepEqual(s.media, []);
  assert.equal(s.capturedAt, AT);
});

test("normalizeYouTube: title becomes content, thumbnail becomes the sole media asset", () => {
  const s = normalizeYouTube(json("youtube-oembed.json"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", AT);
  assert.equal(s.provider, "youtube");
  assert.equal(s.content, "Never Gonna Give You Up");
  assert.equal(s.author.name, "Rick Astley");
  assert.deepEqual(s.media, [
    { src: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", alt: "Never Gonna Give You Up", width: 480, height: 360 },
  ]);
});

test("normalizeBluesky: reads record text, avatar and image aspect ratio", () => {
  const s = normalizeBluesky(json("bluesky-thread.json"), "https://bsky.app/profile/did:plc:abc123/post/3juvfg", AT);
  assert.equal(s.provider, "bluesky");
  assert.equal(s.content, "hello from the open network");
  assert.equal(s.author.name, "Example Person");
  assert.equal(s.author.handle, "@example.bsky.social");
  assert.equal(s.publishedAt, "2026-03-04T10:11:12.000Z");
  assert.equal(s.author.avatar, "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkrei@jpeg");
  assert.equal(s.media.length, 1);
  assert.equal(s.media[0].alt, "A photo of a sunset");
  assert.equal(s.media[0].width, 1200);
});

test("normalizeMastodon: converts content HTML to text and keeps attachments", () => {
  const s = normalizeMastodon(json("mastodon-status.json"), "https://mastodon.social/@Gargron/109252195886", AT);
  assert.equal(s.provider, "mastodon");
  assert.equal(s.content, "Hello #fediverse — testing & such.");
  assert.equal(s.author.handle, "@Gargron");
  assert.equal(s.media[0].src, "https://files.mastodon.social/media_attachments/files/original.jpg");
  assert.equal(s.media[0].height, 500);
});

test("normalizeOpenGraph: og:title beats <title>, og:image becomes media", () => {
  const s = normalizeOpenGraph(fixture("opengraph.html"), "https://example.com/some/post", AT);
  assert.equal(s.provider, "opengraph");
  assert.equal(s.author.name, "Some Blog");
  assert.equal(s.content, "A Post On Some Blog — Summary of the post & its contents.");
  assert.deepEqual(s.media, [{ src: "https://example.com/card.png", alt: "A Post On Some Blog" }]);
});

test("normalizeOpenGraph: a relative og:image is resolved against the page URL", () => {
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="/img/hero.png">',
    "https://example.com/blog/some/post",
    AT,
  );
  assert.deepEqual(s.media, [{ src: "https://example.com/img/hero.png", alt: "T" }]);
});

test("normalizeOpenGraph: a document-relative og:image resolves against the fetched URL, not the trailing-slash-stripped canonical one", () => {
  // adapters.ts strips a trailing slash when building canonicalURL for keying purposes; the
  // fetched page was actually at the slash-terminated URL, so a document-relative og:image must
  // resolve as a sibling of the page, not of its parent directory.
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="img/hero.png">',
    "https://example.com/blog/post",
    AT,
    "https://example.com/blog/post/",
  );
  assert.deepEqual(s.media, [{ src: "https://example.com/blog/post/img/hero.png", alt: "T" }]);
});

test("normalizeOpenGraph: omitting fetchedURL falls back to canonicalURL (pre-existing 3-arg callers keep working)", () => {
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="img/hero.png">',
    "https://example.com/blog/post",
    AT,
  );
  assert.deepEqual(s.media, [{ src: "https://example.com/blog/img/hero.png", alt: "T" }]);
});

test("normalizeOpenGraph: a protocol-relative og:image inherits the page's scheme", () => {
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="//cdn.example.com/hero.png">',
    "https://example.com/blog/some/post",
    AT,
  );
  assert.deepEqual(s.media, [{ src: "https://cdn.example.com/hero.png", alt: "T" }]);
});

test("normalizeOpenGraph: an absolute og:image is left exactly as published", () => {
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="https://cdn.other/x.png">',
    "https://example.com/p",
    AT,
  );
  assert.deepEqual(s.media, [{ src: "https://cdn.other/x.png", alt: "T" }]);
});

test("normalizeOpenGraph: a malformed og:image yields no media instead of throwing", () => {
  const s = normalizeOpenGraph(
    '<meta property="og:title" content="T"><meta property="og:image" content="http://[">',
    "https://example.com/p",
    AT,
  );
  assert.equal(s.content, "T");
  assert.deepEqual(s.media, []);
});

test("normalizers degrade on partial payloads instead of throwing", () => {
  const empty = normalizeX({}, "https://x.com/a/status/1", AT);
  assert.equal(empty.content, "");
  assert.equal(empty.author.name, "x.com");
  assert.deepEqual(normalizeBluesky({}, "https://bsky.app/x", AT).media, []);
  assert.equal(normalizeMastodon({ account: null }, "https://m.example/@a/1", AT).content, "");
  assert.equal(normalizeOpenGraph("<html></html>", "https://example.com/p", AT).content, "");
});

test("hasOpenGraphMetadata: a page with real og: tags has metadata", () => {
  assert.equal(hasOpenGraphMetadata(fixture("opengraph.html")), true);
});

test("hasOpenGraphMetadata: a <title>-only page (the Instagram shape) has NO metadata", () => {
  // Instagram returns HTTP 200 with a <title>Instagram</title> and no og: tags at all —
  // normalizeOpenGraph would still fall back to that title, but there is no real metadata.
  assert.equal(hasOpenGraphMetadata(fixture("instagram-title-only.html")), false);
});

test("hasOpenGraphMetadata: empty/garbage HTML has no metadata", () => {
  assert.equal(hasOpenGraphMetadata(""), false);
  assert.equal(hasOpenGraphMetadata("<html></html>"), false);
  assert.equal(hasOpenGraphMetadata("not even html, just garbage text"), false);
});

test("hasOpenGraphMetadata: og:image alone (no title/description) still counts", () => {
  assert.equal(
    hasOpenGraphMetadata('<meta property="og:image" content="https://example.com/card.png">'),
    true,
  );
});

test("normalizers never throw on a hostile payload", () => {
  const hostile = { author_name: "<img src=x onerror=alert(1)>", html: "<p><script>alert(1)</script></p>" };
  const s = normalizeX(hostile, "https://x.com/a/status/1", AT);
  // Stored as plain text; escaping is the renderer's job (Task 6), not the normalizer's.
  assert.equal(s.content, "alert(1)");
  assert.equal(s.author.name, "<img src=x onerror=alert(1)>");
});
