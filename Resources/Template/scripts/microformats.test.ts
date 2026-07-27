import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntryHtml, findRoots } from "./microformats.ts";

const GOOD_ENTRY = `<!doctype html><html><body>
<article class="h-entry">
  <h1 class="p-name">My Article</h1>
  <p class="p-summary">Article summary text</p>
  <a class="u-url" href="/articles/my-article/"><time class="dt-published" datetime="2026-06-27T12:00:00.000Z">Jun 27, 2026</time></a>
  <div class="e-content"><p>Article body.</p></div>
  <ul><li><a class="p-category" href="/tags/indieweb">indieweb</a></li></ul>
</article></body></html>`;

const GOOD_REVIEW = `<!doctype html><html><body>
<article class="h-review">
  <h1 class="p-name">Review of The Widget</h1>
  <p>Reviewed: <span class="p-item">The Widget</span></p>
  <data class="p-rating" value="4">4</data>
  <a class="u-url" href="/reviews/the-widget/"><time class="dt-published" datetime="2026-06-27T12:00:00.000Z">Jun 27, 2026</time></a>
  <div class="e-content"><p>Solid widget.</p></div>
</article></body></html>`;

const GOOD_EVENT = `<!doctype html><html><body>
<article class="h-event">
  <h1 class="p-name">Launch Party</h1>
  <a class="u-url" href="/events/launch-party/"><time class="dt-start" datetime="2026-07-01T18:00:00.000Z">Jul 1, 2026</time></a>
  <p class="p-location">Online</p>
  <div class="e-content"><p>Join us.</p></div>
</article></body></html>`;

const NO_URL = `<!doctype html><html><body>
<article class="h-entry">
  <h1 class="p-name">No Permalink</h1>
  <time class="dt-published" datetime="2026-06-27T12:00:00.000Z">Jun 27, 2026</time>
  <div class="e-content"><p>Body.</p></div>
</article></body></html>`;

const NAMELESS_NOTE = `<!doctype html><html><body>
<article class="h-entry">
  <a class="u-url" href="/notes/hello-note/"><time class="dt-published" datetime="2026-06-27T12:00:00.000Z">Jun 27, 2026</time></a>
  <div class="e-content"><p>Just a quick note.</p></div>
</article></body></html>`;

// h-review with NO explicit p-name: the parser implies a name from the full text,
// smashing item/rating/body together — the pitfall Hreview.astro documents.
const IMPLIED_REVIEW = `<!doctype html><html><body>
<article class="h-review">
  <p>Reviewed: <span class="p-item">The Widget</span></p>
  <data class="p-rating" value="4">4</data>
  <a class="u-url" href="/reviews/the-widget/"><time class="dt-published" datetime="2026-06-27T12:00:00.000Z">d</time></a>
  <div class="e-content"><p>Solid widget.</p></div>
</article></body></html>`;

// Implied-name review whose body has inline markup + irregular whitespace — the guard must
// still flag it after whitespace normalization (proves it is not fitted to one fixture).
const IMPLIED_REVIEW_MARKUP = `<!doctype html><html><body>
<article class="h-review">
  <p>Reviewed: <span class="p-item">The Widget</span></p>
  <data class="p-rating" value="4">4</data>
  <a class="u-url" href="/reviews/the-widget/"><time class="dt-published" datetime="2026-06-27T12:00:00.000Z">d</time></a>
  <div class="e-content"><p>Solid   <strong>widget</strong>,
  truly.</p></div>
</article></body></html>`;

test("valid h-entry passes and exposes expected properties", () => {
  assert.deepEqual(validateEntryHtml(GOOD_ENTRY, "good-entry"), []);
  const [item] = findRoots(GOOD_ENTRY);
  assert.deepEqual(item.properties.name, ["My Article"]);
  assert.deepEqual(item.properties.summary, ["Article summary text"]);
  assert.deepEqual(item.properties.category, ["indieweb"]);
  assert.equal(item.properties.url[0], "https://example.com/articles/my-article/");
  assert.ok(String(item.properties.published[0]).startsWith("2026-06-27"));
});

test("nameless h-entry (note) passes — p-name is optional for entries", () => {
  assert.deepEqual(validateEntryHtml(NAMELESS_NOTE, "note"), []);
});

test("valid h-review passes with explicit name, item and rating", () => {
  assert.deepEqual(validateEntryHtml(GOOD_REVIEW, "good-review"), []);
  const [item] = findRoots(GOOD_REVIEW);
  assert.deepEqual(item.properties.name, ["Review of The Widget"]);
  assert.deepEqual(item.properties.item, ["The Widget"]);
  assert.deepEqual(item.properties.rating, ["4"]);
});

test("valid h-event passes", () => {
  assert.deepEqual(validateEntryHtml(GOOD_EVENT, "good-event"), []);
  const [item] = findRoots(GOOD_EVENT);
  assert.deepEqual(item.properties.name, ["Launch Party"]);
  assert.deepEqual(item.properties.location, ["Online"]);
  assert.ok(String(item.properties.start[0]).startsWith("2026-07-01"));
});

test("h-entry without u-url is flagged", () => {
  const problems = validateEntryHtml(NO_URL, "no-url");
  assert.ok(problems.some((p) => p.includes("missing u-url")), problems.join("; "));
});

test("h-review with implied (non-explicit) name is flagged", () => {
  const problems = validateEntryHtml(IMPLIED_REVIEW, "implied-review");
  assert.ok(problems.some((p) => p.includes("implied")), problems.join("; "));
});

test("implied-name h-review with inline markup/whitespace is still flagged", () => {
  const problems = validateEntryHtml(IMPLIED_REVIEW_MARKUP, "implied-markup");
  assert.ok(problems.some((p) => p.includes("implied")), problems.join("; "));
});

// --- Deferred to #388 (site identity model) -------------------------------
test("entries carry a p-author h-card", { skip: "#388 — site identity model" }, () => {
  // When #388 lands the businessProfile h-card, assert the nested p-author here.
});
test("site-wide h-card is present", { skip: "#388 — site identity model" }, () => {
  // #388 emits the businessProfile h-card in BaseLayout; assert a root h-card then.
});

// --- #689 (content licensing: u-license) -----------------------------------
test("findRoots: a u-license inside an h-entry parses as the entry's license property", () => {
  const html = `
    <article class="h-entry">
      <a class="u-url" href="/notes/hi/"><time class="dt-published" datetime="2026-01-02">Jan 2</time></a>
      <div class="e-content">Hi</div>
      <a class="u-license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
    </article>`;
  const roots = findRoots(html);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].properties.license, ["https://creativecommons.org/licenses/by/4.0/"]);
});

test("validateEntryHtml: a u-license does not make an otherwise valid entry invalid", () => {
  const html = `
    <article class="h-entry">
      <a class="u-url" href="/notes/hi/"><time class="dt-published" datetime="2026-01-02">Jan 2</time></a>
      <div class="e-content">Hi</div>
      <a class="u-license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>
    </article>`;
  assert.deepEqual(validateEntryHtml(html, "notes/hi"), []);
});
