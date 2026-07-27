import test from "node:test";
import assert from "node:assert/strict";
import { groupByTag, labelFor, permalinkFor, sortedTagNames, tagCounts, type TaggedEntry } from "./tags.ts";

function entry(overrides: Partial<TaggedEntry> & Pick<TaggedEntry, "id" | "collection">): TaggedEntry {
  return {
    tags: [],
    publishDate: new Date("2026-01-01"),
    ...overrides,
  };
}

test("permalinkFor: builds the /<collection>/<id>/ shape used by [collection]/[...slug].astro", () => {
  assert.equal(permalinkFor("notes", "hello-note"), "/notes/hello-note/");
  assert.equal(permalinkFor("bookmarks", "some-link"), "/bookmarks/some-link/");
});

test("labelFor: a titled entry uses its title", () => {
  const e = entry({ id: "post-1", collection: "articles", title: "Hello World" });
  assert.equal(labelFor(e), "Hello World");
});

test("labelFor: a title-less entry falls back to a body excerpt", () => {
  const e = entry({ id: "note-1", collection: "notes", body: "Just checking in from the road." });
  assert.equal(labelFor(e), "Just checking in from the road.");
});

test("labelFor: a title-less entry prefers summary over an excerpt", () => {
  const e = entry({ id: "article-1", collection: "articles", summary: "A short summary.", body: "Full body text." });
  assert.equal(labelFor(e), "A short summary.");
});

test("labelFor: a title-less, summary-less entry prefers caption over an excerpt (photos)", () => {
  const e = entry({ id: "photo-1", collection: "photos", caption: "An example photo.", body: "" });
  assert.equal(labelFor(e), "An example photo.");
});

test("labelFor: a title-less entry with no body, summary, or caption falls back to its id", () => {
  const e = entry({ id: "note-2", collection: "notes" });
  assert.equal(labelFor(e), "note-2");
});

test("groupByTag: groups entries under each tag they carry, including multi-tag entries", () => {
  const a = entry({ id: "a", collection: "notes", tags: ["hello", "indieweb"] });
  const b = entry({ id: "b", collection: "photos", tags: ["hello"] });
  const byTag = groupByTag([a, b]);
  assert.deepEqual([...byTag.keys()].sort(), ["hello", "indieweb"]);
  assert.equal(byTag.get("hello")?.length, 2);
  assert.equal(byTag.get("indieweb")?.length, 1);
});

test("groupByTag: a tag with a space is preserved as its own key (no silent splitting)", () => {
  const a = entry({ id: "a", collection: "notes", tags: ["hello world"] });
  const byTag = groupByTag([a]);
  assert.ok(byTag.has("hello world"));
  assert.equal(byTag.size, 1);
});

test("groupByTag: sorts each tag's entries newest-first", () => {
  const older = entry({ id: "older", collection: "notes", tags: ["hello"], publishDate: new Date("2026-01-01") });
  const newer = entry({ id: "newer", collection: "notes", tags: ["hello"], publishDate: new Date("2026-02-01") });
  const byTag = groupByTag([older, newer]);
  assert.deepEqual(byTag.get("hello")?.map((e) => e.id), ["newer", "older"]);
});

test("sortedTagNames: alphabetical, independent of insertion order", () => {
  const byTag = groupByTag([
    entry({ id: "a", collection: "notes", tags: ["zebra"] }),
    entry({ id: "b", collection: "notes", tags: ["apple"] }),
  ]);
  assert.deepEqual(sortedTagNames(byTag), ["apple", "zebra"]);
});

test("tagCounts: one entry per tag, alphabetical, with the right count", () => {
  const byTag = groupByTag([
    entry({ id: "a", collection: "notes", tags: ["hello", "indieweb"] }),
    entry({ id: "b", collection: "photos", tags: ["hello"] }),
  ]);
  assert.deepEqual(tagCounts(byTag), [
    { tag: "hello", count: 2 },
    { tag: "indieweb", count: 1 },
  ]);
});
