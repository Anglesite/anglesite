import test from "node:test";
import assert from "node:assert/strict";
import type { EmbedSnapshot } from "../../scripts/embeds/types";
import { escapeHTML, renderEmbedCard } from "./embed-card";

function snap(overrides: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    version: 1,
    url: "https://x.com/jack/status/20",
    provider: "x",
    author: { name: "jack", handle: "@jack", url: "https://x.com/jack" },
    content: "just setting up my twttr",
    publishedAt: "2006-03-21T00:00:00.000Z",
    media: [],
    capturedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

test("escapeHTML: neutralizes every character that could break out of markup", () => {
  assert.equal(escapeHTML(`<script>"x" & 'y'</script>`), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
});

test("renderEmbedCard: hostile post text cannot inject markup", () => {
  const html = renderEmbedCard(snap({ content: '<img src=x onerror="alert(1)">' }));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("renderEmbedCard: hostile author name and alt text are escaped too", () => {
  const html = renderEmbedCard(
    snap({
      author: { name: '"><script>alert(1)</script>', handle: "@a" },
      media: [{ src: "/embeds/a/asset-0.png", alt: '"><b>' }],
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!/alt="">/.test(html));
});

test("renderEmbedCard: renders author, text, permalink and a machine-readable date", () => {
  const html = renderEmbedCard(snap());
  assert.match(html, /class="embed-card embed-card--x"/);
  assert.match(html, /just setting up my twttr/);
  assert.match(html, /href="https:\/\/x\.com\/jack\/status\/20"/);
  assert.match(html, /<time[^>]+datetime="2006-03-21T00:00:00\.000Z"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("renderEmbedCard: no avatar and no media still produces a valid card", () => {
  const html = renderEmbedCard(snap());
  assert.ok(!html.includes("embed-card__avatar"));
  assert.ok(!html.includes("<img"));
});

test("renderEmbedCard: local media renders; width/height are emitted to prevent layout shift", () => {
  const html = renderEmbedCard(
    snap({ media: [{ src: "/embeds/abc/asset-0.png", alt: "a photo", width: 1200, height: 800 }] }),
  );
  assert.match(html, /<img class="embed-card__media" src="\/embeds\/abc\/asset-0\.png" alt="a photo" width="1200" height="800" loading="lazy" decoding="async">/);
});

test("renderEmbedCard: a remote media src is refused — the privacy invariant is enforced at render", () => {
  const html = renderEmbedCard(snap({ media: [{ src: "https://pbs.twimg.com/x.jpg", alt: "leak" }] }));
  assert.ok(!html.includes("pbs.twimg.com"));
});

test("renderEmbedCard: citeClass wraps the card in h-cite for reply context", () => {
  const html = renderEmbedCard(snap(), { citeClass: "u-in-reply-to" });
  assert.match(html, /class="embed-card embed-card--x u-in-reply-to h-cite"/);
  assert.match(html, /class="embed-card__author p-author h-card"/);
  assert.match(html, /class="embed-card__text p-content"/);
  assert.match(html, /class="embed-card__permalink u-url"/);
  assert.match(html, /class="dt-published"/);
});

test("renderEmbedCard: without citeClass the microformats roots are absent", () => {
  const html = renderEmbedCard(snap());
  assert.ok(!html.includes("h-cite"));
  assert.ok(!html.includes("p-author"));
});

test("renderEmbedCard: youtube renders a thumbnail link, not an iframe, by default", () => {
  const html = renderEmbedCard(
    snap({ provider: "youtube", url: "https://www.youtube.com/watch?v=abc", media: [{ src: "/embeds/a/asset-0.jpg", alt: "T" }] }),
  );
  assert.ok(!html.includes("<iframe"));
  assert.match(html, /embed-card__play/);
});

test("renderEmbedCard: inlineVideo opts into a click-to-load youtube-nocookie iframe", () => {
  const html = renderEmbedCard(
    snap({ provider: "youtube", url: "https://www.youtube.com/watch?v=abc", media: [] }),
    { inlineVideo: true },
  );
  assert.match(html, /<iframe[^>]+src="https:\/\/www\.youtube-nocookie\.com\/embed\/abc"/);
  assert.match(html, /loading="lazy"/);
});

test("renderEmbedCard: inlineVideo on a non-youtube snapshot changes nothing", () => {
  assert.ok(!renderEmbedCard(snap(), { inlineVideo: true }).includes("<iframe"));
});
