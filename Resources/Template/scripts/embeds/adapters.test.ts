import test from "node:test";
import assert from "node:assert/strict";
import { resolveAdapter } from "./adapters";

test("resolveAdapter: rejects non-http(s) input", () => {
  assert.equal(resolveAdapter("mailto:me@example.com"), null);
  assert.equal(resolveAdapter("not a url"), null);
});

test("resolveAdapter: x.com and twitter.com resolve identically", () => {
  const a = resolveAdapter("https://twitter.com/jack/status/20");
  const b = resolveAdapter("https://x.com/jack/status/20");
  assert.equal(a?.provider, "x");
  assert.equal(a?.canonicalURL, "https://x.com/jack/status/20");
  assert.deepEqual(a, b);
});

test("resolveAdapter: x mobile host and query string normalize away", () => {
  const r = resolveAdapter("https://mobile.twitter.com/jack/status/20?s=20&t=abc");
  assert.equal(r?.canonicalURL, "https://x.com/jack/status/20");
  assert.match(r?.apiURL ?? "", /^https:\/\/publish\.twitter\.com\/oembed\?/);
  assert.match(r?.apiURL ?? "", /dnt=true/);
});

test("resolveAdapter: youtu.be short form and shorts normalize to watch URL", () => {
  for (const input of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  ]) {
    const r = resolveAdapter(input);
    assert.equal(r?.provider, "youtube", input);
    assert.equal(r?.canonicalURL, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", input);
  }
});

test("resolveAdapter: bluesky builds an at:// URI for the public API", () => {
  const r = resolveAdapter("https://bsky.app/profile/did:plc:abc123/post/3juvfg");
  assert.equal(r?.provider, "bluesky");
  assert.match(r?.apiURL ?? "", /getPostThread\?uri=at%3A%2F%2Fdid%3Aplc%3Aabc123%2Fapp\.bsky\.feed\.post%2F3juvfg/);
});

test("resolveAdapter: mastodon is detected structurally, on any instance host", () => {
  const r = resolveAdapter("https://mastodon.social/@Gargron/109252195886");
  assert.equal(r?.provider, "mastodon");
  assert.equal(r?.apiURL, "https://mastodon.social/api/v1/statuses/109252195886");
});

test("resolveAdapter: unknown host falls back to opengraph, scraping the page itself", () => {
  const r = resolveAdapter("https://example.com/some/post");
  assert.equal(r?.provider, "opengraph");
  assert.equal(r?.canonicalURL, "https://example.com/some/post");
  assert.equal(r?.apiURL, "https://example.com/some/post");
});

test("resolveAdapter: an x profile URL is not a post, so it degrades to opengraph", () => {
  assert.equal(resolveAdapter("https://x.com/jack")?.provider, "opengraph");
});
