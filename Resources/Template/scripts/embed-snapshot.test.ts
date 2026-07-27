import test from "node:test";
import assert from "node:assert/strict";
import { bareURLsIn } from "./embed-snapshot";

test("bareURLsIn: a plain bare URL on its own line is found", () => {
  assert.deepEqual(bareURLsIn("Check this out:\n\nhttps://example.com/post/1\n\nThanks."), [
    "https://example.com/post/1",
  ]);
});

test("bareURLsIn: a URL with trailing punctuation is found, punctuation stripped", () => {
  assert.deepEqual(bareURLsIn("https://example.com/page."), ["https://example.com/page"]);
  assert.deepEqual(bareURLsIn("https://example.com/page,"), ["https://example.com/page"]);
  assert.deepEqual(bareURLsIn("https://example.com/page;"), ["https://example.com/page"]);
  assert.deepEqual(bareURLsIn("https://example.com/page:"), ["https://example.com/page"]);
  assert.deepEqual(bareURLsIn("https://example.com/page!"), ["https://example.com/page"]);
  assert.deepEqual(bareURLsIn("https://example.com/page?"), ["https://example.com/page"]);
  // An unbalanced trailing ")" (no matching "(" in the URL) is stripped too.
  assert.deepEqual(bareURLsIn("https://example.com/page)"), ["https://example.com/page"]);
});

test("bareURLsIn: a balanced closing paren in the URL is kept", () => {
  assert.deepEqual(bareURLsIn("https://example.com/wiki/Foo_(bar)"), ["https://example.com/wiki/Foo_(bar)"]);
});

test("bareURLsIn: a URL alone inside a fenced code block is NOT found", () => {
  const markdown = ["```", "https://example.com/from-a-code-sample", "```"].join("\n");
  assert.deepEqual(bareURLsIn(markdown), []);
});

test("bareURLsIn: a URL with surrounding text on the same line is NOT found", () => {
  assert.deepEqual(bareURLsIn("See https://example.com/page for details."), []);
});

test("bareURLsIn: an angle-bracketed autolink is found, brackets stripped", () => {
  assert.deepEqual(bareURLsIn("<https://example.com/post/2>"), ["https://example.com/post/2"]);
});

test("bareURLsIn: a fence that is opened and closed correctly resumes scanning after it", () => {
  const markdown = [
    "```",
    "https://example.com/inside-fence",
    "```",
    "",
    "https://example.com/after-fence",
  ].join("\n");
  assert.deepEqual(bareURLsIn(markdown), ["https://example.com/after-fence"]);
});

test("bareURLsIn: a ~~~ fence is also respected", () => {
  const markdown = ["~~~", "https://example.com/inside-tilde-fence", "~~~"].join("\n");
  assert.deepEqual(bareURLsIn(markdown), []);
});
