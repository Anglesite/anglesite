import test from "node:test";
import assert from "node:assert/strict";
import { targetClassFor, targetUrlFor } from "./collection-index.ts";

test("targetClassFor: maps each interaction collection to its mf2 u-* class", () => {
  assert.equal(targetClassFor("likes"), "u-like-of");
  assert.equal(targetClassFor("replies"), "u-in-reply-to");
  assert.equal(targetClassFor("bookmarks"), "u-bookmark-of");
});

test("targetClassFor: undefined for collections with no target-URL field", () => {
  assert.equal(targetClassFor("notes"), undefined);
  assert.equal(targetClassFor("photos"), undefined);
  assert.equal(targetClassFor("articles"), undefined);
  assert.equal(targetClassFor("albums"), undefined);
  assert.equal(targetClassFor("blog"), undefined);
});

test("targetUrlFor: reads likeOf for likes", () => {
  assert.equal(targetUrlFor("likes", { likeOf: "https://example.com/liked" }), "https://example.com/liked");
});

test("targetUrlFor: reads inReplyTo for replies", () => {
  assert.equal(targetUrlFor("replies", { inReplyTo: "https://example.com/post" }), "https://example.com/post");
});

test("targetUrlFor: reads bookmarkOf for bookmarks", () => {
  assert.equal(targetUrlFor("bookmarks", { bookmarkOf: "https://example.com/" }), "https://example.com/");
});

test("targetUrlFor: undefined for collections with no target-URL field", () => {
  assert.equal(targetUrlFor("notes", { likeOf: "https://example.com/x" }), undefined);
  assert.equal(targetUrlFor("photos", {}), undefined);
});

test("targetUrlFor: undefined when the field is missing, empty, or not a string", () => {
  assert.equal(targetUrlFor("likes", {}), undefined);
  assert.equal(targetUrlFor("likes", { likeOf: "" }), undefined);
  assert.equal(targetUrlFor("likes", { likeOf: 42 }), undefined);
});
