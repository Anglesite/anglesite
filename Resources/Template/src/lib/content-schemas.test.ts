import test from "node:test";
import assert from "node:assert/strict";
import { notesSchema, articlesSchema } from "./content-schemas.ts";

test("notes: audience is optional — omitting it parses exactly as before", () => {
  const parsed = notesSchema.parse({ publishDate: "2026-01-01" });
  assert.equal(parsed.audience, undefined);
});

test("notes: a valid audience URL round-trips", () => {
  const parsed = notesSchema.parse({
    publishDate: "2026-01-01",
    audience: "https://community.example/c/local",
  });
  assert.equal(parsed.audience, "https://community.example/c/local");
});

test("notes: a non-URL audience value fails validation", () => {
  assert.throws(() => notesSchema.parse({ publishDate: "2026-01-01", audience: "not-a-url" }));
});

test("notes: an unrelated unknown key still fails under .strict()", () => {
  assert.throws(() => notesSchema.parse({ publishDate: "2026-01-01", bogus: "x" }));
});

test("articles: a valid audience URL round-trips alongside required fields", () => {
  const parsed = articlesSchema.parse({
    title: "Hello",
    publishDate: "2026-01-01",
    audience: "https://community.example/c/local",
  });
  assert.equal(parsed.audience, "https://community.example/c/local");
});

test("articles: audience is optional — omitting it parses exactly as before", () => {
  const parsed = articlesSchema.parse({ title: "Hello", publishDate: "2026-01-01" });
  assert.equal(parsed.audience, undefined);
});
