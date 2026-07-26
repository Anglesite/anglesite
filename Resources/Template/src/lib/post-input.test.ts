import test from "node:test";
import assert from "node:assert/strict";
import { postInputFor } from "./post-input.ts";

test("an entry with no audience projects to null (federation-inert, the default today)", () => {
  assert.equal(postInputFor({ body: "hello" }), null);
});

test("a note (no title) with audience projects to kind: note", () => {
  const result = postInputFor({ audience: "https://community.example/c/local", body: "hello" });
  assert.deepEqual(result, {
    audience: "https://community.example/c/local",
    kind: "note",
    content: "hello",
  });
});

test("an article (has a title) with audience projects to kind: page + name, for Lemmy-style targets", () => {
  const result = postInputFor({
    audience: "https://community.example/c/local",
    title: "Hello World",
    body: "hello",
  });
  assert.deepEqual(result, {
    audience: "https://community.example/c/local",
    kind: "page",
    name: "Hello World",
    content: "hello",
  });
});
