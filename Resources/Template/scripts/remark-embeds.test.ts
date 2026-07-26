import test from "node:test";
import assert from "node:assert/strict";
import type { EmbedSnapshot } from "./embeds/types";
import { transformEmbeds, type MdastNode } from "./remark-embeds";

const SNAP: EmbedSnapshot = {
  version: 1,
  url: "https://x.com/jack/status/20",
  provider: "x",
  author: { name: "jack" },
  content: "just setting up my twttr",
  media: [],
  capturedAt: "2026-07-25T00:00:00.000Z",
};

const resolve = (url: string) => (url === SNAP.url ? SNAP : null);

function paragraph(...children: MdastNode[]): MdastNode {
  return { type: "paragraph", children };
}
function link(url: string): MdastNode {
  return { type: "link", url, children: [{ type: "text", value: url }] };
}
function root(...children: MdastNode[]): MdastNode {
  return { type: "root", children };
}

test("transformEmbeds: a bare URL alone in a paragraph becomes a card", () => {
  const tree = transformEmbeds(root(paragraph(link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "html");
  assert.match(tree.children?.[0].value ?? "", /embed-card/);
  assert.match(tree.children?.[0].value ?? "", /just setting up my twttr/);
});

test("transformEmbeds: a URL with surrounding text is left as an ordinary link", () => {
  const tree = transformEmbeds(root(paragraph({ type: "text", value: "see " }, link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: two links in one paragraph are left alone", () => {
  const tree = transformEmbeds(root(paragraph(link(SNAP.url), link(SNAP.url))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: a URL with no snapshot stays a working link", () => {
  const tree = transformEmbeds(root(paragraph(link("https://example.com/nope"))), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: link text differing from the href is a real link, not an embed", () => {
  const labelled: MdastNode = { type: "link", url: SNAP.url, children: [{ type: "text", value: "this tweet" }] };
  const tree = transformEmbeds(root(paragraph(labelled)), resolve);
  assert.equal(tree.children?.[0].type, "paragraph");
});

test("transformEmbeds: a trailing slash still matches the snapshot", () => {
  const tree = transformEmbeds(root(paragraph(link(`${SNAP.url}/`))), resolve);
  assert.equal(tree.children?.[0].type, "html");
});

test("transformEmbeds: other content is untouched and order is preserved", () => {
  const heading: MdastNode = { type: "heading", children: [{ type: "text", value: "Hi" }] };
  const tree = transformEmbeds(root(heading, paragraph(link(SNAP.url)), heading), resolve);
  assert.deepEqual(
    tree.children?.map((n) => n.type),
    ["heading", "html", "heading"],
  );
});

test("transformEmbeds: an empty document is a no-op", () => {
  assert.deepEqual(transformEmbeds(root(), resolve).children, []);
});
