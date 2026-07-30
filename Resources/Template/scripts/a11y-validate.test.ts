import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHeadingHierarchy,
  validateLinkText,
  validateImageAlt,
  validateHtml,
} from "./a11y-validate";

// ---------------------------------------------------------------------------
// validateHeadingHierarchy
// ---------------------------------------------------------------------------

test("validateHeadingHierarchy: returns no issues for correct hierarchy", () => {
  const html = "<h1>Title</h1><h2>Section</h2><h3>Sub</h3>";
  assert.deepEqual(validateHeadingHierarchy(html), []);
});

test("validateHeadingHierarchy: flags skipped heading levels", () => {
  const html = "<h1>Title</h1><h3>Skipped h2</h3>";
  const issues = validateHeadingHierarchy(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "heading-skip");
  assert.match(issues[0].message, /h3/);
});

test("validateHeadingHierarchy: flags multiple h1 elements", () => {
  const html = "<h1>First</h1><h1>Second</h1>";
  const issues = validateHeadingHierarchy(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "heading-multiple-h1");
});

test("validateHeadingHierarchy: allows heading level to go back up (h3 -> h2 is fine)", () => {
  const html = "<h1>Title</h1><h2>A</h2><h3>A1</h3><h2>B</h2>";
  assert.deepEqual(validateHeadingHierarchy(html), []);
});

test("validateHeadingHierarchy: flags when first heading is not h1", () => {
  const html = "<h2>Starts at h2</h2><h3>Sub</h3>";
  const issues = validateHeadingHierarchy(html);
  assert.ok(issues.some((i) => i.rule === "heading-skip"));
});

test("validateHeadingHierarchy: returns no issues for empty content", () => {
  assert.deepEqual(validateHeadingHierarchy(""), []);
  assert.deepEqual(validateHeadingHierarchy("<p>No headings</p>"), []);
});

test("validateHeadingHierarchy: handles multiple skip violations", () => {
  const html = "<h1>Title</h1><h3>Skip</h3><h6>Big skip</h6>";
  const issues = validateHeadingHierarchy(html);
  assert.equal(issues.filter((i) => i.rule === "heading-skip").length, 2);
});

// ---------------------------------------------------------------------------
// validateLinkText
// ---------------------------------------------------------------------------

test("validateLinkText: returns no issues for descriptive link text", () => {
  const html = '<a href="/about">Learn about our services</a>';
  assert.deepEqual(validateLinkText(html), []);
});

test("validateLinkText: flags 'click here'", () => {
  const html = '<a href="/about">click here</a>';
  const issues = validateLinkText(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "link-text-generic");
  assert.match(issues[0].message, /click here/);
});

test("validateLinkText: flags 'read more'", () => {
  const html = '<a href="/post">Read More</a>';
  const issues = validateLinkText(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "link-text-generic");
});

test("validateLinkText: flags 'here' as link text", () => {
  const html = '<a href="/page">here</a>';
  assert.equal(validateLinkText(html).length, 1);
});

test("validateLinkText: flags 'learn more'", () => {
  const html = '<a href="/page">Learn more</a>';
  assert.equal(validateLinkText(html).length, 1);
});

test("validateLinkText: flags 'more info'", () => {
  const html = '<a href="/page">more info</a>';
  assert.equal(validateLinkText(html).length, 1);
});

test("validateLinkText: flags multiple bad links", () => {
  const html = '<a href="/a">click here</a> and <a href="/b">read more</a>';
  assert.equal(validateLinkText(html).length, 2);
});

test("validateLinkText: ignores links with aria-label", () => {
  const html = '<a href="/page" aria-label="View our pricing">here</a>';
  assert.deepEqual(validateLinkText(html), []);
});

test("validateLinkText: flags empty link text", () => {
  const html = '<a href="/page"></a>';
  const issues = validateLinkText(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "link-text-empty");
});

test("validateLinkText: does not flag empty links with aria-label", () => {
  const html = '<a href="/page" aria-label="Home"></a>';
  assert.deepEqual(validateLinkText(html), []);
});

// ---------------------------------------------------------------------------
// validateImageAlt
// ---------------------------------------------------------------------------

test("validateImageAlt: returns no issues for images with alt text", () => {
  const html = '<img src="photo.jpg" alt="A sunset over the mountains" />';
  assert.deepEqual(validateImageAlt(html), []);
});

test("validateImageAlt: allows decorative images with empty alt", () => {
  const html = '<img src="divider.svg" alt="" />';
  assert.deepEqual(validateImageAlt(html), []);
});

test("validateImageAlt: flags images with no alt attribute at all", () => {
  const html = '<img src="photo.jpg" />';
  const issues = validateImageAlt(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "img-alt-missing");
});

test("validateImageAlt: flags images with placeholder alt text", () => {
  const html = '<img src="photo.jpg" alt="image" />';
  const issues = validateImageAlt(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "img-alt-placeholder");
});

test("validateImageAlt: flags 'photo' as placeholder alt text", () => {
  const html = '<img src="team.jpg" alt="photo" />';
  assert.equal(validateImageAlt(html).length, 1);
});

test("validateImageAlt: flags 'untitled' as placeholder alt text", () => {
  const html = '<img src="hero.jpg" alt="untitled" />';
  assert.equal(validateImageAlt(html).length, 1);
});

test("validateImageAlt: flags multiple images with issues", () => {
  const html = '<img src="a.jpg" /><img src="b.jpg" alt="image" /><img src="c.jpg" alt="A dog" />';
  const issues = validateImageAlt(html);
  assert.equal(issues.length, 2); // missing + placeholder
});

test("validateImageAlt: handles self-closing and non-self-closing img tags", () => {
  const html1 = '<img src="a.jpg" alt="Good alt">';
  const html2 = '<img src="a.jpg" alt="Good alt" />';
  assert.deepEqual(validateImageAlt(html1), []);
  assert.deepEqual(validateImageAlt(html2), []);
});

// ---------------------------------------------------------------------------
// A11yIssue shape
// ---------------------------------------------------------------------------

test("A11yIssue shape: has rule, message, and severity fields", () => {
  const html = '<img src="x.jpg" />';
  const issues = validateImageAlt(html);
  assert.ok("rule" in issues[0]);
  assert.ok("message" in issues[0]);
  assert.ok("severity" in issues[0]);
  assert.ok(["error", "warning"].includes(issues[0].severity));
});

// ---------------------------------------------------------------------------
// validateHtml -- unified validator
// ---------------------------------------------------------------------------

test("validateHtml: returns all issues from all validators", () => {
  const html = '<h1>Title</h1><h3>Skip</h3><a href="/x">click here</a><img src="y.jpg" />';
  const issues = validateHtml(html);
  const rules = issues.map((i) => i.rule);
  assert.ok(rules.includes("heading-skip"));
  assert.ok(rules.includes("link-text-generic"));
  assert.ok(rules.includes("img-alt-missing"));
});

test("validateHtml: sorts errors before warnings", () => {
  const html = '<h1>Title</h1><a href="/x">click here</a><img src="y.jpg" />';
  const issues = validateHtml(html);
  // img-alt-missing is error, link-text-generic is warning
  const errorIdx = issues.findIndex((i) => i.rule === "img-alt-missing");
  const warnIdx = issues.findIndex((i) => i.rule === "link-text-generic");
  assert.ok(errorIdx < warnIdx);
});

test("validateHtml: returns empty array for clean HTML", () => {
  const html =
    '<h1>Title</h1><h2>Sub</h2><a href="/about">About us</a><img src="x.jpg" alt="A photo of the team" />';
  assert.deepEqual(validateHtml(html), []);
});

// ---------------------------------------------------------------------------
// html-validate edge cases (things regex would miss)
// ---------------------------------------------------------------------------

test("html-validate integration: handles nested tags inside links", () => {
  // Regex-based parsers struggle with nested HTML in link text
  const html = '<a href="/x"><span>click here</span></a>';
  const issues = validateLinkText(html);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "link-text-generic");
});

test("html-validate integration: recognizes img role=presentation as not needing alt", () => {
  const html = '<img src="spacer.gif" role="presentation" />';
  assert.deepEqual(validateImageAlt(html), []);
});

// ---------------------------------------------------------------------------
// stripTags safety (CodeQL js/incomplete-multi-character-sanitization) — a
// single-pass `.replace(/<[^>]*>/g, "")` is an incomplete sanitizer for
// malformed/overlapping markup; validateLinkText's tag-stripping must fully
// remove nested/overlapping tag fragments, not just well-formed ones.
// ---------------------------------------------------------------------------

test("validateLinkText: fully strips overlapping/malformed tag fragments, leaving no tag residue", () => {
  const html = '<a href="/x"><scr<script>ipt>click here</scr<script>ipt></a>';
  const issues = validateLinkText(html);
  for (const issue of issues) {
    assert.doesNotMatch(issue.message, /<[a-z!/]/i, `message retained a tag fragment: ${issue.message}`);
  }
});
