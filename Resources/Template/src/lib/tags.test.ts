import test from "node:test";
import assert from "node:assert/strict";
import {
  groupByTag,
  groupBySlug,
  labelFor,
  permalinkFor,
  sortedTagNames,
  tagCounts,
  tagGroupCounts,
  tagSlug,
  type TaggedEntry,
} from "./tags.ts";

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

// tagSlug: URL-safe route params. Free-text tags can contain characters that either crash
// `astro build` (a literal "/" inside a getStaticPaths param) or 404 at request time (a "#"
// percent-encodes to a href a standards-compliant static server can never match back to the
// literal directory Astro wrote) — see Resources/Template/src/pages/tags/. tagSlug sidesteps
// both by routing on a normalized [a-z0-9-]+ slug instead of the verbatim tag text.
test("tagSlug: lowercases and hyphenates spaces", () => {
  assert.equal(tagSlug("hello world"), "hello-world");
});

test("tagSlug: a tag containing a slash collapses to a single hyphen (would crash astro build as a param)", () => {
  assert.equal(tagSlug("a/b"), "a-b");
});

test("tagSlug: a tag containing a hash collapses to a single hyphen (would 404 via percent-decoding mismatch)", () => {
  assert.equal(tagSlug("c#d"), "c-d");
});

test("tagSlug: mixed case and punctuation runs collapse to one hyphen", () => {
  assert.equal(tagSlug("C&AD"), "c-ad");
});

test("tagSlug: unicode is normalized (NFKD) before slugifying, dropping combining marks", () => {
  assert.equal(tagSlug("café"), "cafe");
});

test("tagSlug: a tag with no [a-z0-9] characters falls back to a stable non-empty slug", () => {
  const slug = tagSlug("###");
  assert.ok(slug.length > 0);
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal(slug, tagSlug("###"), "must be stable across calls");
});

test("groupBySlug: merges different spellings that share a slug into one group", () => {
  const a = entry({ id: "a", collection: "notes", tags: ["Hello World"] });
  const b = entry({ id: "b", collection: "photos", tags: ["hello world"] });
  const bySlug = groupBySlug([a, b]);
  assert.equal(bySlug.size, 1);
  const group = bySlug.get("hello-world");
  assert.ok(group);
  assert.deepEqual(new Set(group?.tags), new Set(["Hello World", "hello world"]));
  assert.deepEqual(
    group?.entries.map((e) => e.id),
    ["a", "b"],
  );
});

test("groupBySlug: an entry whose two tags collapse to the same slug appears once in that group", () => {
  const a = entry({ id: "a", collection: "notes", tags: ["Hello", "hello"] });
  const bySlug = groupBySlug([a]);
  assert.equal(bySlug.size, 1);
  const group = bySlug.get("hello");
  assert.equal(group?.entries.length, 1);
  assert.deepEqual(new Set(group?.tags), new Set(["Hello", "hello"]));
});

test("groupBySlug: sorts each group's entries newest-first", () => {
  const older = entry({ id: "older", collection: "notes", tags: ["hello"], publishDate: new Date("2026-01-01") });
  const newer = entry({ id: "newer", collection: "notes", tags: ["hello"], publishDate: new Date("2026-02-01") });
  const bySlug = groupBySlug([older, newer]);
  assert.deepEqual(bySlug.get("hello")?.entries.map((e) => e.id), ["newer", "older"]);
});

test("tagGroupCounts: merges counts across spellings sharing a slug, alphabetical by slug", () => {
  const bySlug = groupBySlug([
    entry({ id: "a", collection: "notes", tags: ["zebra"] }),
    entry({ id: "b", collection: "notes", tags: ["Hello"] }),
    entry({ id: "c", collection: "photos", tags: ["hello"] }),
  ]);
  const counts = tagGroupCounts(bySlug);
  assert.deepEqual(
    counts.map(({ slug, count }) => ({ slug, count })),
    [
      { slug: "hello", count: 2 },
      { slug: "zebra", count: 1 },
    ],
  );
  assert.deepEqual(new Set(counts[0]!.tags), new Set(["Hello", "hello"]));
  assert.deepEqual(counts[1]!.tags, ["zebra"]);
});
