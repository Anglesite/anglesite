import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEntryHtml, validateFeedHtml, validateResumeHtml, validateDist, findRoots } from "./microformats.ts";

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

// --- #964 (h-resume) --------------------------------------------------------
const GOOD_RESUME = `<!doctype html><html><body>
<article class="h-resume">
  <h1 class="p-name">Jane Doe</h1>
  <p class="p-summary">Backend engineer.</p>
  <ul>
    <li class="p-experience h-event">
      <span class="p-name">Senior Engineer</span>
      <span class="p-org h-card"><span class="p-name">Acme Corp</span></span>
      <time class="dt-start" datetime="2020-01-01">2020</time>
      <time class="dt-end" datetime="2024-06-30">2024</time>
    </li>
  </ul>
  <ul>
    <li class="p-education h-event">
      <span class="p-name">B.S. Computer Science</span>
      <time class="dt-start" datetime="2012-09-01">2012</time>
    </li>
  </ul>
  <ul><li class="p-skill">TypeScript</li></ul>
</article></body></html>`;

test("valid h-resume passes, with nested experience/education parsed as h-event", () => {
  assert.deepEqual(validateResumeHtml(GOOD_RESUME, "resume/index.html"), []);
  const [item] = findRoots(GOOD_RESUME);
  assert.deepEqual(item.properties.name, ["Jane Doe"]);
  const [experience] = item.properties.experience as unknown as Array<{ type: string[]; properties: Record<string, unknown[]> }>;
  assert.ok(experience.type.includes("h-event"));
  assert.deepEqual(experience.properties.name, ["Senior Engineer"]);
});

test("a page with no h-resume root is not an error (the singleton is optional)", () => {
  const html = `<!doctype html><html><body><p>No resume yet.</p></body></html>`;
  assert.deepEqual(validateResumeHtml(html, "resume/index.html"), []);
});

test("h-resume missing p-summary is flagged", () => {
  const html = `<!doctype html><html><body>
  <article class="h-resume"><h1 class="p-name">Jane Doe</h1></article>
  </body></html>`;
  const problems = validateResumeHtml(html, "resume/index.html");
  assert.ok(problems.some((p) => p.includes("missing p-summary")), problems.join("; "));
});

test("an experience entry missing dt-start is flagged", () => {
  const html = `<!doctype html><html><body>
  <article class="h-resume">
    <h1 class="p-name">Jane Doe</h1>
    <p class="p-summary">x</p>
    <li class="p-experience h-event"><span class="p-name">Engineer</span></li>
  </article></body></html>`;
  const problems = validateResumeHtml(html, "resume/index.html");
  assert.ok(problems.some((p) => p.includes("experience[0] missing dt-start")), problems.join("; "));
});

// --- #1044 (mf2 build gate: h-feed list pages) -----------------------------

const FEED_WITH_ENTRIES = `<!doctype html><html><body>
<div class="h-feed">
  <h1 class="p-name">Notes</h1>
  <ul>
    <li class="h-entry">
      <a class="u-url" href="/notes/hi/"><time class="dt-published" datetime="2026-01-02">Jan 2</time></a>
      <div class="e-content">Hi</div>
    </li>
    <li class="h-entry">
      <a class="p-name u-url" href="/notes/second/">Second note title</a>
      <time class="dt-published" datetime="2026-01-03">Jan 3</time>
    </li>
  </ul>
</div></body></html>`;

const EMPTY_FEED = `<!doctype html><html><body>
<div class="h-feed">
  <h1 class="p-name">Notes</h1>
  <p>No notes yet.</p>
</div></body></html>`;

const FEED_WITH_BAD_ENTRY = `<!doctype html><html><body>
<div class="h-feed">
  <h1 class="p-name">Notes</h1>
  <ul>
    <li class="h-entry">
      <time class="dt-published" datetime="2026-01-02">Jan 2</time>
      <div class="e-content">Missing a permalink</div>
    </li>
  </ul>
</div></body></html>`;

const NO_FEED = `<!doctype html><html><body><p>Plain page, no mf2 at all.</p></body></html>`;

test("h-feed with valid h-entry children passes", () => {
  assert.deepEqual(validateFeedHtml(FEED_WITH_ENTRIES, "notes/index.html"), []);
});

test("empty h-feed (no children) is valid — an empty collection has nothing to list", () => {
  assert.deepEqual(validateFeedHtml(EMPTY_FEED, "notes/index.html"), []);
});

test("h-feed child missing u-url is flagged, scoped to that child", () => {
  const problems = validateFeedHtml(FEED_WITH_BAD_ENTRY, "notes/index.html");
  assert.ok(problems.some((p) => p.includes("missing u-url")), problems.join("; "));
});

test("a page with no h-feed root is flagged", () => {
  const problems = validateFeedHtml(NO_FEED, "notes/index.html");
  assert.ok(problems.some((p) => p.includes("no h-feed root")), problems.join("; "));
});

// --- #1297 (validateDist: fail loudly when zero built pages are scanned) ---

test("validateDist: fails loudly on an absent dist directory instead of a vacuous pass", () => {
  const dir = join(tmpdir(), "microformats-test-does-not-exist");
  const problems = validateDist(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no built pages found/);
});

test("validateDist: fails loudly when dist/ exists but none of the entry dirs have pages", () => {
  const dir = mkdtempSync(join(tmpdir(), "microformats-test-"));
  try {
    writeFileSync(join(dir, "styles.css"), "body { color: red; }");
    const problems = validateDist(dir);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no built pages found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateDist: a single built entry page is enough to avoid the empty-scan failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "microformats-test-"));
  try {
    mkdirSync(join(dir, "notes", "hi"), { recursive: true });
    writeFileSync(join(dir, "notes", "hi", "index.html"), NAMELESS_NOTE);
    const problems = validateDist(dir);
    assert.ok(!problems.some((p) => p.includes("no built pages found")), problems.join("; "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
