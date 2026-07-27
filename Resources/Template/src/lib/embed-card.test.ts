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

test("renderEmbedCard: a remote avatar src is refused — mirrors the remote-media invariant", () => {
  const html = renderEmbedCard(snap({ author: { name: "jack", handle: "@jack", avatar: "https://pbs.twimg.com/avatar.jpg" } }));
  assert.ok(!html.includes("pbs.twimg.com"));
  assert.ok(!html.includes("embed-card__avatar"));
});

test("renderEmbedCard: a javascript: author.url renders no anchor and is scrubbed from output", () => {
  const html = renderEmbedCard(snap({ author: { name: "jack", handle: "@jack", url: "javascript:alert(document.domain)" } }));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!/<a[^>]*class="embed-card__author/.test(html));
  assert.match(html, /<span class="embed-card__author">/);
  assert.match(html, /jack/);
});

test("renderEmbedCard: a javascript: snap.url renders the permalink without an anchor", () => {
  const html = renderEmbedCard(snap({ url: "javascript:alert(document.domain)" }));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!/<a[^>]*class="embed-card__permalink/.test(html));
  assert.match(html, /<span class="embed-card__permalink">/);
});

test("renderEmbedCard: a data: URL author.url is likewise refused", () => {
  const html = renderEmbedCard(snap({ author: { name: "jack", handle: "@jack", url: "data:text/html,<script>alert(1)</script>" } }));
  assert.ok(!html.includes("data:text/html"));
  assert.ok(!/<a[^>]*class="embed-card__author/.test(html));
});

test("renderEmbedCard: a data: URL snap.url is likewise refused", () => {
  const html = renderEmbedCard(snap({ url: "data:text/html,<script>alert(1)</script>" }));
  assert.ok(!html.includes("data:text/html"));
  assert.ok(!/<a[^>]*class="embed-card__permalink/.test(html));
});

test("renderEmbedCard: an ordinary https:// author.url still renders as a link", () => {
  const html = renderEmbedCard(snap({ author: { name: "jack", handle: "@jack", url: "https://x.com/jack" } }));
  assert.match(html, /<a class="embed-card__author" href="https:\/\/x\.com\/jack" rel="noopener noreferrer">/);
});

test("renderEmbedCard: an ordinary https:// snap.url still renders as a link", () => {
  const html = renderEmbedCard(snap({ url: "https://x.com/jack/status/20" }));
  assert.match(html, /<a class="embed-card__permalink" href="https:\/\/x\.com\/jack\/status\/20" rel="noopener noreferrer">/);
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

test("renderEmbedCard: inlineVideo opts into a lazily-loaded youtube-nocookie iframe", () => {
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

test("reply context: each citation class produces the matching mf2 root", () => {
  for (const citeClass of ["u-in-reply-to", "u-bookmark-of", "u-like-of"]) {
    const html = renderEmbedCard(snap(), { citeClass });
    assert.ok(html.includes(`${citeClass} h-cite`), citeClass);
    assert.ok(html.includes("p-author h-card"), citeClass);
    assert.ok(html.includes("u-url"), citeClass);
  }
});
