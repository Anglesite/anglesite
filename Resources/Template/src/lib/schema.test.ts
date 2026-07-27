import test from "node:test";
import assert from "node:assert/strict";
import { blogPostingSchema, entrySchema, type SchemaContext } from "./schema.ts";

const LICENSE = "https://creativecommons.org/licenses/by/4.0/";

function ctx(overrides: Partial<SchemaContext> = {}): SchemaContext {
  return { url: "https://example.com/notes/hi/", site: new URL("https://example.com"), ...overrides };
}

test("entrySchema: notes carry the license URL when one is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: articles carry the license URL", () => {
  const out = entrySchema("articles", { title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});

test("entrySchema: omits license entirely when none is supplied", () => {
  const out = entrySchema("notes", { publishDate: new Date("2026-01-02") }, ctx());
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: events emit no license (Event is not a CreativeWork)", () => {
  const out = entrySchema("events", { name: "Meetup" }, ctx({ license: LICENSE }));
  assert.equal(Object.hasOwn(out as object, "license"), false);
});

test("entrySchema: likes still project nothing at all", () => {
  assert.equal(entrySchema("likes", {}, ctx({ license: LICENSE })), null);
});

test("blogPostingSchema: carries the license URL", () => {
  const out = blogPostingSchema({ title: "Hi" }, ctx({ license: LICENSE }));
  assert.equal((out as unknown as Record<string, unknown>).license, LICENSE);
});
