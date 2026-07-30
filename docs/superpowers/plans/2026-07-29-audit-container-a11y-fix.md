# Fix Website ▸ Audit and AuditSiteIntent (#958) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Website ▸ Audit` and `AuditSiteIntent` actually succeed by restoring the deleted accessibility-audit script and routing the audit build through the container runtime, the same way `DeployCommand` already does.

**Architecture:** Two independent halves that meet at one interface. On the template side, restore `scripts/a11y-audit.ts` (+ its `a11y-validate.ts` heuristic-check helper) with a new `html-validate` devDependency. On the Swift side, port `AuditCommand`/`A11yAuditRunner` from the old "resolve a host command or fail" pattern to the `AuditExecutor` protocol — a smaller, audit-scoped mirror of `DeployCommand`'s existing `DeployExecutor`/`ContainerDeployExecutor`/`HostDeployExecutor` — so the build and the accessibility script both run inside a live container when one is available, and fail explicitly (not silently, not on the host) when one isn't.

**Tech Stack:** Swift 6.4 (Swift Testing), TypeScript/`tsx`/`node:test` (Resources/Template), Apple Containerization (`LocalContainerControl`).

## Global Constraints

- Spec: [`docs/superpowers/specs/2026-07-29-audit-container-a11y-fix-design.md`](../specs/2026-07-29-audit-container-a11y-fix-design.md) — read it if anything below is ambiguous.
- `html-validate` devDependency pinned to `^11.6.0` in `Resources/Template/package.json` — approved, do not substitute another package.
- Do not restore `contrast.ts`, `a14y-audit.ts`, `seo-audit.ts`, or pa11y-ci config — out of scope.
- Do not attempt to make `AuditSiteIntent` (headless/Siri) fully container-backed — out of scope; it keeps its current "host Node retired" failure message.
- Commit subject ≤ 72 characters, conventional-commit format, reference `#958` (CONTRIBUTING.md).
- Run `swift test --package-path .` and `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` before the PR (CONTRIBUTING.md ▸ Testing). `Anglesite.xcodeproj` is gitignored — run `xcodegen generate` first if it's missing in this worktree.

---

## Task 1: Template — `html-validate` dependency + `a11y-validate.ts`

**Files:**
- Modify: `Resources/Template/package.json`
- Create: `Resources/Template/scripts/a11y-validate.ts`
- Test: `Resources/Template/scripts/a11y-validate.test.ts`

**Interfaces:**
- Produces: `validateHtml(html: string): A11yIssue[]`, `validateHeadingHierarchy`, `validateLinkText`, `validateImageAlt` (all exported from `./a11y-validate`), and the `A11yIssue` type (`{ rule: string; message: string; severity: "error" | "warning" }`) — consumed by Task 2's `a11y-audit.ts`.

- [ ] **Step 1: Add the `html-validate` devDependency**

Edit `Resources/Template/package.json` — insert into `devDependencies`, alphabetically between `"@types/node"` and `"microformats-parser"`:

```json
    "html-validate": "^11.6.0",
```

- [ ] **Step 2: Install it**

Run: `cd Resources/Template && npm install --no-audit --no-fund`
Expected: exits 0; `Resources/Template/package-lock.json` picks up `html-validate` and its transitive deps.

- [ ] **Step 3: Create `scripts/a11y-validate.ts`**

Create `Resources/Template/scripts/a11y-validate.ts`:

```typescript
/**
 * Content accessibility validators.
 *
 * Uses html-validate for structural WCAG checks (heading hierarchy, missing
 * alt text, empty links) and adds heuristic checks for issues html-validate
 * doesn't cover (generic link text like "click here", placeholder alt text
 * like "image").
 */

import { HtmlValidate } from "html-validate";

export interface A11yIssue {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

// ---------------------------------------------------------------------------
// html-validate instance — configured once, reused across calls
// ---------------------------------------------------------------------------

const htmlValidate = new HtmlValidate({
  rules: {
    "heading-level": "error",
    "wcag/h30": "error",
    "wcag/h37": "error",
  },
});

/** Map html-validate rule IDs to our A11yIssue rule names. */
const RULE_MAP: Record<string, string> = {
  "heading-level": "heading-level",
  "wcag/h30": "link-text-empty",
  "wcag/h37": "img-alt-missing",
};

function runHtmlValidate(html: string): A11yIssue[] {
  const report = htmlValidate.validateStringSync(html);
  return report.results.flatMap((result) =>
    result.messages.map((msg) => ({
      rule: RULE_MAP[msg.ruleId] ?? msg.ruleId,
      message: msg.message,
      severity: msg.severity === 2 ? ("error" as const) : ("warning" as const),
    })),
  );
}

// ---------------------------------------------------------------------------
// Heading hierarchy — delegates to html-validate heading-level rule
// ---------------------------------------------------------------------------

/**
 * Validate heading hierarchy: no skipped levels, single h1 per page.
 * Powered by html-validate's heading-level rule.
 */
export function validateHeadingHierarchy(html: string): A11yIssue[] {
  const all = runHtmlValidate(html);
  return all
    .filter((i) => i.rule === "heading-level")
    .map((i) => ({
      ...i,
      // Normalize rule names to match our API
      rule: i.message.toLowerCase().includes("multiple")
        ? "heading-multiple-h1"
        : "heading-skip",
    }));
}

// ---------------------------------------------------------------------------
// Link text quality — html-validate for empty + heuristic for generic
// ---------------------------------------------------------------------------

const GENERIC_LINK_PATTERNS = [
  /^click\s*here$/i,
  /^here$/i,
  /^read\s*more$/i,
  /^learn\s*more$/i,
  /^more\s*info$/i,
  /^more$/i,
  /^link$/i,
  /^this$/i,
];

/**
 * Validate link text quality.
 * html-validate catches empty links (wcag/h30).
 * Heuristic catches generic phrases ("click here", "read more").
 */
export function validateLinkText(html: string): A11yIssue[] {
  // html-validate handles empty links (including aria-label awareness)
  const issues = runHtmlValidate(html).filter(
    (i) => i.rule === "link-text-empty",
  );

  // Heuristic: flag generic link text that html-validate doesn't catch
  const linkRegex = /<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (!text || /aria-label\s*=/.test(attrs)) continue;

    for (const pattern of GENERIC_LINK_PATTERNS) {
      if (pattern.test(text)) {
        issues.push({
          rule: "link-text-generic",
          message: `Link text "${text}" is not descriptive — screen reader users won't know where it leads.`,
          severity: "warning",
        });
        break;
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Image alt text — html-validate for missing + heuristic for placeholder
// ---------------------------------------------------------------------------

const PLACEHOLDER_ALT_PATTERNS = [
  /^image$/i,
  /^photo$/i,
  /^picture$/i,
  /^img$/i,
  /^untitled$/i,
  /^placeholder$/i,
  /^screenshot$/i,
  /^banner$/i,
  /^hero$/i,
];

/**
 * Validate image alt text.
 * html-validate catches missing alt attributes (wcag/h37).
 * Heuristic catches placeholder text ("image", "photo", "untitled").
 */
export function validateImageAlt(html: string): A11yIssue[] {
  // html-validate handles missing alt (including role=presentation awareness)
  const issues = runHtmlValidate(html).filter(
    (i) => i.rule === "img-alt-missing",
  );

  // Heuristic: flag placeholder alt text
  const imgRegex = /<img\s([^>]*?)\/?>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const attrs = match[1];
    const altMatch =
      attrs.match(/alt\s*=\s*"([^"]*)"/i) ??
      attrs.match(/alt\s*=\s*'([^']*)'/i);

    if (!altMatch) continue; // html-validate already flagged this
    const alt = altMatch[1].trim();
    if (alt === "") continue; // Decorative — intentionally empty

    for (const pattern of PLACEHOLDER_ALT_PATTERNS) {
      if (pattern.test(alt)) {
        issues.push({
          rule: "img-alt-placeholder",
          message: `Image alt text "${alt}" is a placeholder — describe what the image shows.`,
          severity: "warning",
        });
        break;
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Unified validator — runs all checks at once
// ---------------------------------------------------------------------------

/**
 * Run all accessibility checks on an HTML string.
 * Returns a deduplicated array of issues sorted by severity (errors first).
 */
export function validateHtml(html: string): A11yIssue[] {
  const issues = [
    ...validateHeadingHierarchy(html),
    ...validateLinkText(html),
    ...validateImageAlt(html),
  ];

  return issues.sort((a, b) => {
    if (a.severity === "error" && b.severity !== "error") return -1;
    if (a.severity !== "error" && b.severity === "error") return 1;
    return 0;
  });
}
```

- [ ] **Step 4: Write the test file**

Create `Resources/Template/scripts/a11y-validate.test.ts`:

```typescript
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
```

- [ ] **Step 5: Run the test**

Run: `cd Resources/Template && npx tsx --test scripts/a11y-validate.test.ts`
Expected: `tests 31`, `pass 31`, `fail 0`.

- [ ] **Step 6: Type-check**

Run: `cd Resources/Template && npx tsc --noEmit -p tsconfig.json 2>&1 | grep a11y-validate`
Expected: no output (no errors attributed to this file). Pre-existing unrelated errors about `astro:content`/`import.meta.glob` in `src/lib/*` are expected noise from running bare `tsc` instead of `astro check` — ignore them.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/package.json Resources/Template/package-lock.json Resources/Template/scripts/a11y-validate.ts Resources/Template/scripts/a11y-validate.test.ts
git commit -m "feat(#958): add html-validate and a11y-validate.ts helper"
```

---

## Task 2: Template — restore `a11y-audit.ts`

**Files:**
- Create: `Resources/Template/scripts/a11y-audit.ts`
- Test: `Resources/Template/scripts/a11y-audit.test.ts`
- Modify: `Resources/Template/package.json`

**Interfaces:**
- Consumes: `validateHtml`, `A11yIssue` from `./a11y-validate` (Task 1); `readConfig` from `./config` (pre-existing, `Resources/Template/scripts/config.ts`).
- Produces: `runAudit(distDir?: string): Promise<A11yAuditReport>`; when run directly (`npx tsx scripts/a11y-audit.ts --json`), prints a JSON report matching the shape `A11yAuditRunner.parse(json:)` on the Swift side expects (`{ issues: [{ page, rule, severity, message, suggestion, ... }], totals, ... }`) and exits 0/1/2 by severity — this is the contract `ContainerAuditExecutor`/`A11yAuditRunner` (Task 3/4) depend on.

- [ ] **Step 1: Create `scripts/a11y-audit.ts`**

Create `Resources/Template/scripts/a11y-audit.ts`:

```typescript
/**
 * Accessibility audit orchestrator.
 *
 * Runs WCAG 2.1 AA checks against the built site in `dist/`:
 *
 * 1. Heuristic checks (always run, no install required) — uses `html-validate`
 *    via `scripts/a11y-validate.ts` for heading hierarchy, link text, alt text.
 * 2. pa11y-ci or pa11y (when installed) — full WCAG 2.1 AA scan including
 *    contrast, ARIA, labels, landmarks. Requires `npm install -D pa11y` or
 *    `pa11y-ci`.
 * 3. axe-core via Playwright (when installed) — modern rule engine with rich
 *    selector and remediation context. Requires
 *    `npm install -D @axe-core/playwright playwright`.
 *
 * The script aggregates results into a unified report keyed by page, with a
 * suggested fix per issue. Exit codes are severity-aware so the script is
 * usable in CI:
 *
 *   0  — no errors, no warnings (or `--warn-only` was passed)
 *   1  — at least one error (WCAG 2.1 AA violation)
 *   2  — warnings only (best-practice issue, no AA violation)
 *
 * Usage:
 *   tsx scripts/a11y-audit.ts             # human-readable report
 *   tsx scripts/a11y-audit.ts --json      # machine-readable report
 *   tsx scripts/a11y-audit.ts --warn-only # always exit 0 (mid-remediation)
 *   tsx scripts/a11y-audit.ts --report reports/a11y-report.md  # write markdown (default path)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { validateHtml, type A11yIssue } from "./a11y-validate";
import { readConfig } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "notice";

export interface A11yAuditIssue {
  page: string;
  rule: string;
  severity: Severity;
  message: string;
  wcag?: string[];
  selector?: string;
  context?: string;
  suggestion: string;
  tool: "heuristic" | "pa11y" | "axe-core";
}

export interface PageSummary {
  path: string;
  errors: number;
  warnings: number;
  notices: number;
}

export interface A11yAuditReport {
  pages: PageSummary[];
  issues: A11yAuditIssue[];
  totals: { errors: number; warnings: number; notices: number };
  toolsRun: Array<"heuristic" | "pa11y" | "axe-core">;
}

// ---------------------------------------------------------------------------
// Suggestion catalogue — maps rule IDs to plain-English remediation guidance.
// Matches the four areas called out in issue #197: alt text, contrast, label
// association, landmark structure.
// ---------------------------------------------------------------------------

const SUGGESTIONS: Record<string, string> = {
  // Heuristic / html-validate
  "heading-skip": "Use heading levels in order — don't skip from h1 to h3. Add the missing level or restructure.",
  "heading-multiple-h1": "Use a single h1 per page. Demote the extra heading to h2 or h3.",
  "link-text-empty": "Add visible text inside the link, or set an aria-label that describes the destination.",
  "link-text-generic": "Replace generic phrases like 'click here' with text that describes where the link goes.",
  "img-alt-missing": "Add an alt attribute that describes the image. Use alt=\"\" for purely decorative images.",
  "img-alt-placeholder": "Replace placeholder alt text (image, photo, untitled) with a real description.",

  // pa11y / WCAG codes
  "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37": "Add an alt attribute to every img. Decorative images get alt=\"\".",
  "WCAG2AA.Principle1.Guideline1_3.1_3_1.H42": "Use heading tags (h1–h6) in document order so the page outline is clear.",
  "WCAG2AA.Principle1.Guideline1_3.1_3_1.F68": "Associate each form input with a <label for=\"id\"> or wrap it in a label.",
  "WCAG2AA.Principle1.Guideline1_4.1_4_3": "Increase color contrast to at least 4.5:1 for body text or 3:1 for large text. Use scripts/contrast.ts to find a passing shade.",
  "WCAG2AA.Principle2.Guideline2_4.2_4_1.H64.1": "Provide a unique title attribute on iframes, or use aria-label, so screen readers announce them.",
  "WCAG2AA.Principle2.Guideline2_4.2_4_4.H77,H78,H79,H80,H81": "Make link text describe the destination on its own — no 'click here' or 'read more'.",
  "WCAG2AA.Principle3.Guideline3_1.3_1_1.H57": "Set the lang attribute on the <html> element.",
  "WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent": "Add visible text or an aria-label to the link so screen readers can announce it.",

  // axe-core rule ids
  "image-alt": "Add a descriptive alt attribute to every <img>. Decorative images get alt=\"\".",
  "color-contrast": "Increase contrast between text and background to 4.5:1 (body) or 3:1 (large text). Adjust the CSS custom property in src/styles/global.css.",
  "label": "Each form control needs a <label for=\"id\">. Aria-label is acceptable but a visible label is preferred.",
  "form-field-multiple-labels": "Each form input should have exactly one <label>. Remove the duplicate.",
  "landmark-one-main": "Wrap the page's primary content in a <main> element so users can jump past navigation.",
  "landmark-unique": "Each landmark (nav, main, aside, footer) should be distinct. Add aria-label when there are multiple of the same type.",
  "region": "Move all content inside a landmark element (header, nav, main, aside, footer) so screen reader users can navigate by region.",
  "page-has-heading-one": "Every page needs exactly one h1 that summarizes its content.",
  "heading-order": "Use heading levels in order (h1 → h2 → h3). Don't skip levels for visual sizing — that's what CSS is for.",
  "html-has-lang": "Set the lang attribute on <html> so screen readers use the right pronunciation.",
  "link-name": "Every link must have accessible text — visible content, an aria-label, or alt text on a contained image.",
  "button-name": "Every button needs a visible label or aria-label.",
  "list": "Lists must contain only <li> children (or script/template). Wrap loose content in an <li>.",
  "duplicate-id": "Element IDs must be unique on the page.",
  "aria-required-attr": "Add the required ARIA attributes for this role.",
  "skip-link": "Provide a skip-to-content link as the first focusable element on every page.",
};

const FALLBACK_SUGGESTION = "Review WCAG 2.1 AA guidance for this rule and adjust the markup or styles.";

export function suggestFix(rule: string, message?: string): string {
  if (SUGGESTIONS[rule]) return SUGGESTIONS[rule];

  // Try a partial match — pa11y rule IDs are long (e.g.
  // "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18") and the catalogue is keyed by
  // the meaningful prefix.
  for (const key of Object.keys(SUGGESTIONS)) {
    if (rule.startsWith(key)) return SUGGESTIONS[key];
  }

  // Fallback: derive a hint from the message if it mentions a known concept.
  const m = (message ?? "").toLowerCase();
  if (m.includes("alt")) return SUGGESTIONS["image-alt"];
  if (m.includes("contrast")) return SUGGESTIONS["color-contrast"];
  if (m.includes("label")) return SUGGESTIONS["label"];
  if (m.includes("landmark") || m.includes("region")) return SUGGESTIONS["region"];

  return FALLBACK_SUGGESTION;
}

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

/**
 * Map a pa11y issue type to our severity scale.
 * pa11y emits "error" | "warning" | "notice" already, so this is a passthrough
 * with defensive defaults.
 */
export function classifyPa11ySeverity(type: string): Severity {
  if (type === "error") return "error";
  if (type === "warning") return "warning";
  return "notice";
}

/**
 * Map an axe-core impact to our severity scale.
 * axe levels: "minor" | "moderate" | "serious" | "critical".
 * "serious" and "critical" are AA violations -> error. "moderate" -> warning.
 * "minor" -> notice.
 */
export function classifyAxeSeverity(impact: string | null | undefined): Severity {
  if (impact === "critical" || impact === "serious") return "error";
  if (impact === "moderate") return "warning";
  return "notice";
}

/**
 * Map our heuristic issue severity (error | warning) to the audit severity.
 */
export function classifyHeuristicSeverity(severity: A11yIssue["severity"]): Severity {
  return severity === "error" ? "error" : "warning";
}

// ---------------------------------------------------------------------------
// HTML walking
// ---------------------------------------------------------------------------

export function walkHtml(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkHtml(full));
    } else if (extname(entry.name) === ".html") {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Heuristic scan (always available)
// ---------------------------------------------------------------------------

export function runHeuristicScan(distDir: string): A11yAuditIssue[] {
  if (!existsSync(distDir)) return [];
  const issues: A11yAuditIssue[] = [];
  for (const file of walkHtml(distDir)) {
    const html = readFileSync(file, "utf-8");
    const rel = relative(distDir, file) || file;
    for (const issue of validateHtml(html)) {
      issues.push({
        page: rel,
        rule: issue.rule,
        severity: classifyHeuristicSeverity(issue.severity),
        message: issue.message,
        suggestion: suggestFix(issue.rule, issue.message),
        tool: "heuristic",
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateReport(
  issues: A11yAuditIssue[],
  toolsRun: Array<"heuristic" | "pa11y" | "axe-core">,
): A11yAuditReport {
  const byPage = new Map<string, PageSummary>();
  for (const issue of issues) {
    const summary = byPage.get(issue.page) ?? {
      path: issue.page,
      errors: 0,
      warnings: 0,
      notices: 0,
    };
    if (issue.severity === "error") summary.errors += 1;
    else if (issue.severity === "warning") summary.warnings += 1;
    else summary.notices += 1;
    byPage.set(issue.page, summary);
  }

  const totals = {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    notices: issues.filter((i) => i.severity === "notice").length,
  };

  return {
    pages: Array.from(byPage.values()).sort((a, b) => a.path.localeCompare(b.path)),
    issues,
    totals,
    toolsRun,
  };
}

// ---------------------------------------------------------------------------
// Severity-aware exit code
// ---------------------------------------------------------------------------

/**
 * Compute the process exit code for an audit report.
 *
 *   warnOnly = true  -> always 0
 *   errors > 0       -> 1
 *   warnings > 0     -> 2
 *   otherwise        -> 0
 */
export function exitCodeFor(report: A11yAuditReport, warnOnly: boolean): number {
  if (warnOnly) return 0;
  if (report.totals.errors > 0) return 1;
  if (report.totals.warnings > 0) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Markdown formatting
// ---------------------------------------------------------------------------

export function formatReport(report: A11yAuditReport): string {
  const lines: string[] = [];
  lines.push("# Accessibility Audit");
  lines.push("");
  lines.push(`Tools run: ${report.toolsRun.join(", ")}`);
  lines.push("");
  lines.push(
    `Totals: ${report.totals.errors} error(s), ${report.totals.warnings} warning(s), ${report.totals.notices} notice(s)`,
  );
  lines.push("");

  if (report.issues.length === 0) {
    lines.push("No accessibility issues found.");
    return lines.join("\n");
  }

  lines.push("## Per-page summary");
  lines.push("");
  lines.push("| Page | Errors | Warnings | Notices |");
  lines.push("|---|---:|---:|---:|");
  for (const page of report.pages) {
    lines.push(`| ${page.path} | ${page.errors} | ${page.warnings} | ${page.notices} |`);
  }
  lines.push("");

  lines.push("## Issues");
  lines.push("");
  const grouped = new Map<string, A11yAuditIssue[]>();
  for (const issue of report.issues) {
    const list = grouped.get(issue.page) ?? [];
    list.push(issue);
    grouped.set(issue.page, list);
  }
  for (const [page, issues] of grouped) {
    lines.push(`### ${page}`);
    lines.push("");
    for (const issue of issues) {
      const wcag = issue.wcag && issue.wcag.length > 0 ? ` (${issue.wcag.join(", ")})` : "";
      lines.push(`- **[${issue.severity.toUpperCase()}] ${issue.rule}**${wcag} — ${issue.message}`);
      if (issue.selector) lines.push(`  - Selector: \`${issue.selector}\``);
      lines.push(`  - Fix: ${issue.suggestion}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// pa11y runner — dynamically imported so the dependency stays optional
// ---------------------------------------------------------------------------

interface Pa11yIssue {
  code: string;
  type: string;
  message: string;
  selector?: string;
  context?: string;
}

type Pa11yFn = (target: string, opts?: Record<string, unknown>) => Promise<{ issues: Pa11yIssue[] }>;

export async function runPa11yScan(htmlFiles: string[], distDir: string): Promise<A11yAuditIssue[]> {
  let pa11y: Pa11yFn | null = null;
  try {
    // A non-literal specifier: `pa11y` isn't a dependency, so a literal `import("pa11y")` fails
    // `tsc --noEmit` with "Cannot find module" even though the failure is caught at runtime.
    // Routing through a `const` keeps the specifier optional without a `@ts-expect-error`.
    const pa11yModuleName = "pa11y";
    const mod = await import(pa11yModuleName /* @vite-ignore */);
    // Named `Pa11yFn`, not `typeof pa11y`: a self-referential type query at the assignment site
    // picks up `pa11y`'s flow-narrowed type (`null`, since this is the first assignment) instead
    // of its declared union type, which silently collapses everything below to `never`.
    pa11y = (mod as { default: Pa11yFn }).default ?? (mod as unknown as Pa11yFn);
  } catch {
    return [];
  }
  if (!pa11y) return [];

  const results: A11yAuditIssue[] = [];
  for (const file of htmlFiles) {
    const fileUrl = `file://${file}`;
    try {
      const result = await pa11y(fileUrl, { standard: "WCAG2AA" });
      const rel = relative(distDir, file) || file;
      for (const issue of result.issues) {
        results.push({
          page: rel,
          rule: issue.code,
          severity: classifyPa11ySeverity(issue.type),
          message: issue.message,
          wcag: extractWcagCriteria(issue.code),
          selector: issue.selector,
          context: issue.context,
          suggestion: suggestFix(issue.code, issue.message),
          tool: "pa11y",
        });
      }
    } catch (err) {
      const rel = relative(distDir, file) || file;
      results.push({
        page: rel,
        rule: "pa11y-runtime-error",
        severity: "warning",
        message: `pa11y could not scan ${rel}: ${(err as Error).message}`,
        suggestion: "Re-run after starting the dev server, or verify pa11y's Chromium dependency is installed.",
        tool: "pa11y",
      });
    }
  }
  return results;
}

export function extractWcagCriteria(code: string): string[] {
  // pa11y codes look like "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18".
  // The numeric tail (1_4_3) maps to WCAG SC 1.4.3.
  const match = code.match(/\b(\d+_\d+_\d+)/);
  return match ? [`SC ${match[1].replace(/_/g, ".")}`] : [];
}

// ---------------------------------------------------------------------------
// axe-core runner — dynamically imported, requires Playwright
// ---------------------------------------------------------------------------

interface AxeNode {
  target: string[];
  html?: string;
}

interface AxeViolation {
  id: string;
  impact?: string | null;
  description: string;
  help: string;
  helpUrl?: string;
  tags?: string[];
  nodes: AxeNode[];
}

type ChromiumLauncher = { launch: () => Promise<unknown> };
type AxeBuilderCtor = new (opts: { page: unknown }) => {
  withTags: (tags: string[]) => { analyze: () => Promise<{ violations: AxeViolation[] }> };
};

export async function runAxeScan(htmlFiles: string[], distDir: string): Promise<A11yAuditIssue[]> {
  let chromium: ChromiumLauncher | null = null;
  let AxeBuilder: AxeBuilderCtor | null = null;
  try {
    // Non-literal specifiers — see the identical note in `runPa11yScan` above. Neither
    // `playwright` nor `@axe-core/playwright` is a dependency of this template. Named type
    // aliases (`ChromiumLauncher`/`AxeBuilderCtor`), not `typeof chromium`/`typeof AxeBuilder` —
    // see the identical note in `runPa11yScan` about self-referential type queries collapsing to
    // `never`.
    const playwrightModuleName = "playwright";
    const axeCoreModuleName = "@axe-core/playwright";
    const playwright = await import(playwrightModuleName /* @vite-ignore */);
    chromium = (playwright as { chromium: ChromiumLauncher }).chromium;
    const axeMod = await import(axeCoreModuleName /* @vite-ignore */);
    AxeBuilder = (axeMod as { default: AxeBuilderCtor }).default ?? (axeMod as unknown as AxeBuilderCtor);
  } catch {
    return [];
  }
  if (!chromium || !AxeBuilder) return [];

  const browser = (await chromium.launch()) as {
    newPage: () => Promise<{ goto: (url: string) => Promise<void>; close: () => Promise<void> }>;
    close: () => Promise<void>;
  };
  const results: A11yAuditIssue[] = [];
  try {
    for (const file of htmlFiles) {
      const rel = relative(distDir, file) || file;
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`);
        const builder = new AxeBuilder({ page });
        const { violations } = await builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        for (const v of violations) {
          for (const node of v.nodes) {
            results.push({
              page: rel,
              rule: v.id,
              severity: classifyAxeSeverity(v.impact),
              message: v.help,
              wcag: (v.tags ?? []).filter((t: string) => t.startsWith("wcag")),
              selector: node.target?.join(" ") ?? undefined,
              context: node.html,
              suggestion: suggestFix(v.id, v.help),
              tool: "axe-core",
            });
          }
        }
      } catch (err) {
        results.push({
          page: rel,
          rule: "axe-runtime-error",
          severity: "warning",
          message: `axe-core could not scan ${rel}: ${(err as Error).message}`,
          suggestion: "Verify @axe-core/playwright and Playwright browsers are installed (npx playwright install chromium).",
          tool: "axe-core",
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runAudit(distDir = "dist"): Promise<A11yAuditReport> {
  const toolsRun: Array<"heuristic" | "pa11y" | "axe-core"> = [];
  const issues: A11yAuditIssue[] = [];

  // 1. Heuristic — always runs
  toolsRun.push("heuristic");
  issues.push(...runHeuristicScan(distDir));

  // 2. pa11y — only if installed
  const htmlFiles = existsSync(distDir) ? walkHtml(distDir) : [];
  const pa11yIssues = await runPa11yScan(htmlFiles, distDir);
  if (pa11yIssues.length > 0 || (await isPackageAvailable("pa11y"))) {
    toolsRun.push("pa11y");
    issues.push(...pa11yIssues);
  }

  // 3. axe-core — only if installed
  const axeIssues = await runAxeScan(htmlFiles, distDir);
  if (axeIssues.length > 0 || (await isPackageAvailable("@axe-core/playwright"))) {
    toolsRun.push("axe-core");
    issues.push(...axeIssues);
  }

  return aggregateReport(issues, toolsRun);
}

async function isPackageAvailable(name: string): Promise<boolean> {
  try {
    await import(name /* @vite-ignore */);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Script entry — executed when run directly (not when imported by tests)
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("a11y-audit.ts")) {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : "reports/a11y-report.md";
  const cliWarnOnly = args.includes("--warn-only");
  const configWarnOnly = (readConfig("A11Y_WARN_ONLY") ?? "").toLowerCase() === "true";
  const warnOnly = cliWarnOnly || configWarnOnly;

  if (!existsSync("dist")) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  runAudit("dist")
    .then((report) => {
      if (reportPath) {
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, formatReport(report), "utf-8");
        console.log(`Wrote accessibility report to ${reportPath}`);
      }

      if (wantJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReport(report));
      }

      if (!report.toolsRun.includes("pa11y") && !report.toolsRun.includes("axe-core")) {
        console.warn(
          "\nHint: install pa11y (`npm install -D pa11y`) or axe-core (`npm install -D @axe-core/playwright playwright`) for full WCAG 2.1 AA coverage.",
        );
      }

      process.exit(exitCodeFor(report, warnOnly));
    })
    .catch((err) => {
      console.error("Accessibility audit failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Write the test file**

Create `Resources/Template/scripts/a11y-audit.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aggregateReport,
  classifyAxeSeverity,
  classifyHeuristicSeverity,
  classifyPa11ySeverity,
  exitCodeFor,
  extractWcagCriteria,
  formatReport,
  runHeuristicScan,
  suggestFix,
  walkHtml,
  type A11yAuditIssue,
  type A11yAuditReport,
} from "./a11y-audit";

// ---------------------------------------------------------------------------
// suggestFix
// ---------------------------------------------------------------------------

test("suggestFix: returns the catalogued suggestion for a heuristic rule", () => {
  assert.match(suggestFix("heading-skip"), /heading levels in order/);
});

test("suggestFix: returns the catalogued suggestion for an axe-core rule", () => {
  assert.match(suggestFix("color-contrast"), /contrast/);
});

test("suggestFix: matches by prefix for long pa11y codes", () => {
  const code = "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18";
  assert.match(suggestFix(code), /contrast/);
});

test("suggestFix: falls back to message keyword when rule is unknown", () => {
  assert.match(suggestFix("unknown-rule", "Element has insufficient contrast"), /contrast/);
  assert.match(suggestFix("unknown-rule", "Image is missing alt text"), /alt/);
  assert.match(suggestFix("unknown-rule", "Form field has no label"), /label/);
  assert.match(suggestFix("unknown-rule", "Content is outside any landmark"), /landmark/);
});

test("suggestFix: returns the generic fallback when nothing matches", () => {
  assert.match(suggestFix("totally-unknown", "some unrelated message"), /WCAG 2\.1 AA/);
});

// ---------------------------------------------------------------------------
// Severity classifiers
// ---------------------------------------------------------------------------

test("classifyPa11ySeverity: maps known pa11y types directly", () => {
  assert.equal(classifyPa11ySeverity("error"), "error");
  assert.equal(classifyPa11ySeverity("warning"), "warning");
  assert.equal(classifyPa11ySeverity("notice"), "notice");
});

test("classifyPa11ySeverity: defaults to notice for unknown types", () => {
  assert.equal(classifyPa11ySeverity("anything-else"), "notice");
});

test("classifyAxeSeverity: maps critical and serious to error", () => {
  assert.equal(classifyAxeSeverity("critical"), "error");
  assert.equal(classifyAxeSeverity("serious"), "error");
});

test("classifyAxeSeverity: maps moderate to warning", () => {
  assert.equal(classifyAxeSeverity("moderate"), "warning");
});

test("classifyAxeSeverity: maps minor and unknown to notice", () => {
  assert.equal(classifyAxeSeverity("minor"), "notice");
  assert.equal(classifyAxeSeverity(null), "notice");
  assert.equal(classifyAxeSeverity(undefined), "notice");
});

test("classifyHeuristicSeverity: maps html-validate errors to error", () => {
  assert.equal(classifyHeuristicSeverity("error"), "error");
});

test("classifyHeuristicSeverity: maps warnings to warning", () => {
  assert.equal(classifyHeuristicSeverity("warning"), "warning");
});

// ---------------------------------------------------------------------------
// extractWcagCriteria
// ---------------------------------------------------------------------------

test("extractWcagCriteria: pulls a SC reference from a pa11y code", () => {
  assert.deepEqual(extractWcagCriteria("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18"), ["SC 1.4.3"]);
});

test("extractWcagCriteria: returns an empty array when no SC is present", () => {
  assert.deepEqual(extractWcagCriteria("color-contrast"), []);
});

// ---------------------------------------------------------------------------
// aggregateReport
// ---------------------------------------------------------------------------

function issue(page: string, severity: A11yAuditIssue["severity"], rule = "test"): A11yAuditIssue {
  return {
    page,
    rule,
    severity,
    message: "test",
    suggestion: "fix it",
    tool: "heuristic",
  };
}

test("aggregateReport: counts errors, warnings, and notices per page", () => {
  const report = aggregateReport(
    [
      issue("/index.html", "error"),
      issue("/index.html", "warning"),
      issue("/about.html", "notice"),
      issue("/about.html", "warning"),
    ],
    ["heuristic"],
  );
  assert.deepEqual(report.totals, { errors: 1, warnings: 2, notices: 1 });
  assert.equal(report.pages.length, 2);
  const home = report.pages.find((p) => p.path === "/index.html")!;
  assert.deepEqual(home, { path: "/index.html", errors: 1, warnings: 1, notices: 0 });
});

test("aggregateReport: sorts pages by path", () => {
  const report = aggregateReport(
    [issue("/zebra.html", "error"), issue("/alpha.html", "error")],
    ["heuristic"],
  );
  assert.deepEqual(report.pages.map((p) => p.path), ["/alpha.html", "/zebra.html"]);
});

test("aggregateReport: returns empty totals for no issues", () => {
  const report = aggregateReport([], ["heuristic"]);
  assert.deepEqual(report.totals, { errors: 0, warnings: 0, notices: 0 });
  assert.deepEqual(report.pages, []);
});

// ---------------------------------------------------------------------------
// exitCodeFor
// ---------------------------------------------------------------------------

function reportWith(errors: number, warnings: number, notices = 0): A11yAuditReport {
  return {
    pages: [],
    issues: [],
    totals: { errors, warnings, notices },
    toolsRun: ["heuristic"],
  };
}

test("exitCodeFor: returns 1 for any error", () => {
  assert.equal(exitCodeFor(reportWith(1, 0), false), 1);
  assert.equal(exitCodeFor(reportWith(3, 5), false), 1);
});

test("exitCodeFor: returns 2 for warnings without errors", () => {
  assert.equal(exitCodeFor(reportWith(0, 1), false), 2);
  assert.equal(exitCodeFor(reportWith(0, 5, 3), false), 2);
});

test("exitCodeFor: returns 0 for clean reports", () => {
  assert.equal(exitCodeFor(reportWith(0, 0), false), 0);
  assert.equal(exitCodeFor(reportWith(0, 0, 5), false), 0);
});

test("exitCodeFor: always returns 0 in warn-only mode", () => {
  assert.equal(exitCodeFor(reportWith(10, 10, 10), true), 0);
  assert.equal(exitCodeFor(reportWith(0, 0), true), 0);
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

test("formatReport: includes a clean message when there are no issues", () => {
  const out = formatReport(aggregateReport([], ["heuristic"]));
  assert.match(out, /No accessibility issues found/);
});

test("formatReport: includes the per-page summary table for issues", () => {
  const out = formatReport(aggregateReport([issue("/index.html", "error", "image-alt")], ["heuristic"]));
  assert.match(out, /\/index\.html/);
  assert.match(out, /Errors/);
  assert.match(out, /\[ERROR\] image-alt/);
});

test("formatReport: includes the suggested fix for each issue", () => {
  const out = formatReport(aggregateReport([issue("/x.html", "warning", "color-contrast")], ["heuristic"]));
  assert.match(out, /Fix:/);
});

// ---------------------------------------------------------------------------
// walkHtml + runHeuristicScan against a fixture directory
// ---------------------------------------------------------------------------

test("walkHtml: finds .html files recursively", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "blog"));
    writeFileSync(join(dir, "blog", "post.html"), "<html></html>");
    writeFileSync(join(dir, "skip.txt"), "ignored");

    const files = walkHtml(dir);
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.endsWith("index.html")));
    assert.ok(files.some((f) => f.endsWith("post.html")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runHeuristicScan: returns an empty array when dist does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    assert.deepEqual(runHeuristicScan(join(dir, "missing")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runHeuristicScan: flags a missing alt attribute", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    writeFileSync(
      join(dir, "index.html"),
      '<!doctype html><html lang="en"><body><h1>Hi</h1><img src="x.png"></body></html>',
    );
    const issues = runHeuristicScan(dir);
    assert.ok(issues.length > 0);
    assert.ok(issues.some((i) => i.rule === "img-alt-missing"));
    const altIssue = issues.find((i) => i.rule === "img-alt-missing")!;
    assert.equal(altIssue.tool, "heuristic");
    assert.match(altIssue.suggestion, /alt/i);
    assert.equal(altIssue.severity, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runHeuristicScan: flags generic link text as a warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    writeFileSync(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><body><h1>Hi</h1><a href="/x">click here</a></body></html>',
    );
    const issues = runHeuristicScan(dir);
    assert.ok(issues.some((i) => i.rule === "link-text-generic"));
    const generic = issues.find((i) => i.rule === "link-text-generic")!;
    assert.equal(generic.severity, "warning");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runHeuristicScan: returns no issues for clean HTML", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    writeFileSync(
      join(dir, "index.html"),
      '<!doctype html><html lang="en"><body><h1>Hello</h1><img src="x.png" alt="A clear photo of a dog"><a href="/about">Read about the team</a></body></html>',
    );
    assert.deepEqual(runHeuristicScan(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runHeuristicScan: uses paths relative to the dist directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  try {
    mkdirSync(join(dir, "blog"));
    writeFileSync(
      join(dir, "blog", "post.html"),
      '<!doctype html><html lang="en"><body><h1>Hi</h1><img src="x.png"></body></html>',
    );
    const issues = runHeuristicScan(dir);
    assert.ok(issues[0].page.startsWith("blog"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the test**

Run: `cd Resources/Template && npx tsx --test scripts/a11y-audit.test.ts`
Expected: `tests 30`, `pass 30`, `fail 0`.

- [ ] **Step 4: Type-check**

Run: `cd Resources/Template && npx tsc --noEmit -p tsconfig.json 2>&1 | grep a11y-audit`
Expected: no output.

- [ ] **Step 5: Add the convenience npm script**

Edit `Resources/Template/package.json` — insert into `scripts`, right after `"check"`:

```json
    "a11y": "npx tsx scripts/a11y-audit.ts",
```

- [ ] **Step 6: Smoke-test the CLI entry point end-to-end**

Run:
```bash
cd Resources/Template
mkdir -p /tmp/a11y-smoke-dist
printf '<!doctype html><html lang="en"><body><h1>Hi</h1><img src="x.png"><a href="/x">click here</a></body></html>' > /tmp/a11y-smoke-dist/index.html
ln -sfn /tmp/a11y-smoke-dist dist
npx tsx scripts/a11y-audit.ts --json
echo "exit: $?"
rm -f dist
rm -rf reports /tmp/a11y-smoke-dist
```
Expected: prints `Wrote accessibility report to reports/a11y-report.md`, then a JSON report with one `img-alt-missing` error and one `link-text-generic` warning, `"toolsRun": ["heuristic"]`, then `exit: 1`.

- [ ] **Step 7: Run the full template test suite to check for regressions**

Run: `cd Resources/Template && npx tsx --test scripts/*.test.ts scripts/embeds/*.test.ts src/lib/*.test.ts`
Expected: all pass (no `fail`), same as before this task except the two new files' tests now included.

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/package.json Resources/Template/scripts/a11y-audit.ts Resources/Template/scripts/a11y-audit.test.ts
git commit -m "feat(#958): restore scripts/a11y-audit.ts (deleted in #466)"
```

---

## Task 3: Swift — `AuditExecutor` protocol + `HostAuditExecutor` + `ContainerAuditExecutor`

**Files:**
- Create: `Sources/AnglesiteCore/AuditExecutor.swift`
- Modify: `Sources/AnglesiteCore/AuditCommand.swift:184-190` (additive only — add one new static, do not touch `init`/`runBuild` yet; that's Task 4)
- Test: `Tests/AnglesiteCoreTests/ContainerAuditExecutorTests.swift`

**Interfaces:**
- Consumes: `AuditCommand.CommandResolver`, `AuditCommand.LaunchPlan`, `AuditCommand.resolveBuildCommand` (all pre-existing, unchanged), and the new `AuditCommand.resolveA11yCommand` this task adds. `LocalContainerControl.exec(siteID:argv:environment:workingDirectory:onOutput:) async throws -> ContainerExecResult` (pre-existing). `HostNodeRetirement.reason(_:)` (pre-existing).
- Produces: `AuditStep` (`.build`, `.a11y`), `AuditStepResult { exitCode: Int32?, output: String }`, `AuditExecutor` protocol with `run(step:siteDirectory:source:) async -> AuditStepResult`, `HostAuditExecutor`, `ContainerAuditExecutor` — all consumed by Task 4 (`AuditCommand`, `AuditRunner` conformers) and Task 5/6.

- [ ] **Step 1: Add the `.a11y` default resolver to `AuditCommand`**

Read `Sources/AnglesiteCore/AuditCommand.swift` first if you haven't already this session. Find:

```swift
    /// Host Node is retired (#70). Audits must run through the container runtime once validation
    /// lands; until then the command fails explicitly instead of spawning embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }
```

Replace with (adds a new static right after; does not change `resolveBuildCommand` itself):

```swift
    /// Host Node is retired (#70). Audits must run through the container runtime — see
    /// `ContainerAuditExecutor`. `HostAuditExecutor.defaultResolver` uses this for the `.build`
    /// step so the command fails explicitly instead of spawning embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }

    /// Same as `resolveBuildCommand`, for the `.a11y` step. `A11yAuditRunner` used to spawn
    /// `npx tsx` on the host directly (bypassing this convention entirely); it now goes through
    /// `HostAuditExecutor.defaultResolver` like every other step.
    public static let resolveA11yCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("accessibility audit"))
    }
```

This is purely additive — `AuditCommand`'s `init`/`runBuild`/existing tests are untouched by this step.

- [ ] **Step 2: Create `AuditExecutor.swift`**

Create `Sources/AnglesiteCore/AuditExecutor.swift`:

```swift
import Foundation

// MARK: - Types

/// Identifies one logical step in the audit sequence.
public enum AuditStep: Sendable {
    /// `npm run build` — produces `dist/`, which every runner audits.
    case build
    /// `npx tsx scripts/a11y-audit.ts --json` — the accessibility runner's script.
    case a11y
}

/// The result of running a single audit step.
///
/// - `exitCode`: the process exit code, or `nil` for pre-spawn failures (resolver reported
///   `.unavailable`, the process could not be spawned/exec'd at all, or the step was
///   cancelled/terminated).
/// - `output`: captured stdout, used for JSON parsing by `A11yAuditRunner` and as the failure
///   reason text for pre-spawn refusals. Also streamed line-by-line to `LogCenter` under the
///   caller-supplied source during execution.
public struct AuditStepResult: Sendable, Equatable {
    public let exitCode: Int32?
    public let output: String

    public init(exitCode: Int32?, output: String) {
        self.exitCode = exitCode
        self.output = output
    }
}

// MARK: - Protocol

/// Abstraction over the execution substrate for one audit step. A smaller, audit-scoped mirror
/// of `DeployExecutor` — `HostAuditExecutor` fails explicitly after host Node retirement (#70);
/// `ContainerAuditExecutor` runs inside a live container once one is available.
public protocol AuditExecutor: Sendable {
    func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult
}

// MARK: - ContainerAuditExecutor

/// Runs audit steps inside a running container via `LocalContainerControl.exec`. Mirrors
/// `ContainerDeployExecutor`'s streaming/cancellation pattern exactly; no environment forwarding
/// (unlike deploy, no secrets cross the host/guest boundary for an audit) and no well-known
/// claim-manifest seam (that's deploy-specific, #744/#748).
public struct ContainerAuditExecutor: AuditExecutor {
    private let control: any LocalContainerControl
    private let siteID: String
    private let logCenter: LogCenter

    public init(
        control: any LocalContainerControl,
        siteID: String,
        logCenter: LogCenter = .shared
    ) {
        self.control = control
        self.siteID = siteID
        self.logCenter = logCenter
    }

    public func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult {
        let argv = Self.guestArgv(for: step)
        // Stream guest output to LogCenter LIVE — see `ContainerDeployExecutor.run` for the full
        // rationale on the detached drain task (survives structured cancellation so a kill-
        // triggered final line isn't dropped).
        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        let logCenter = self.logCenter
        let drain = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }
        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: argv,
                environment: [:],
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch is CancellationError {
            continuation.finish()
            _ = await drain.value
            return AuditStepResult(exitCode: nil, output: "")
        } catch let error as LocalContainerError {
            continuation.finish()
            _ = await drain.value
            // A dead/never-booted container surfaces as `.bootFailed`; give the user an
            // actionable message instead of the raw error.
            if case .bootFailed = error {
                return AuditStepResult(
                    exitCode: nil,
                    output: "Container isn't running — open/start the site's preview first.")
            }
            return AuditStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        } catch let error {
            continuation.finish()
            _ = await drain.value
            return AuditStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        }
        continuation.finish()
        _ = await drain.value
        return AuditStepResult(exitCode: result.exitCode, output: result.stdout)
    }

    static func guestArgv(for step: AuditStep) -> [String] {
        switch step {
        case .build:
            return ["npm", "run", "build"]
        case .a11y:
            return ["npx", "tsx", "scripts/a11y-audit.ts", "--json"]
        }
    }
}

/// Test-only visibility onto `ContainerAuditExecutor`'s argv mapping — mirrors
/// `ContainerDeployExecutorTestHook`.
enum ContainerAuditExecutorTestHook {
    static func guestArgv(for step: AuditStep) -> [String] {
        ContainerAuditExecutor.guestArgv(for: step)
    }
}

// MARK: - HostAuditExecutor

/// Runs audit steps through `ProcessSupervisor` when a caller injects explicit commands. Mirrors
/// `HostDeployExecutor`: the production default fails explicitly for both steps (host Node is
/// retired, #70) via `AuditCommand.resolveBuildCommand`/`resolveA11yCommand`.
public struct HostAuditExecutor: AuditExecutor {
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let resolveCommand: @Sendable (AuditStep) -> AuditCommand.CommandResolver

    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveCommand: @escaping @Sendable (AuditStep) -> AuditCommand.CommandResolver =
            HostAuditExecutor.defaultResolver
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveCommand = resolveCommand
    }

    public func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult {
        let resolver = resolveCommand(step)
        let plan = resolver(siteDirectory)

        switch plan {
        case .unavailable(let reason):
            return AuditStepResult(exitCode: nil, output: reason)
        case .run(let executable, let arguments):
            return await spawn(executable: executable, arguments: arguments, siteDirectory: siteDirectory, source: source)
        }
    }

    private func spawn(
        executable: URL,
        arguments: [String],
        siteDirectory: URL,
        source: String
    ) async -> AuditStepResult {
        let handle: ProcessSupervisor.Handle
        do {
            handle = try await supervisor.launch(
                source: source,
                executable: executable,
                arguments: arguments,
                currentDirectoryURL: siteDirectory,
                logCenter: logCenter
            )
        } catch {
            return AuditStepResult(exitCode: nil, output: "couldn't spawn process: \(error)")
        }

        let reason = await withTaskCancellationHandler {
            await supervisor.waitForExit(handle)
        } onCancel: {
            Task { await supervisor.terminate(handle) }
        }

        let snapshot = await logCenter.snapshot()
        let output = snapshot
            .filter { $0.source == source && $0.stream == .stdout }
            .map(\.text)
            .joined(separator: "\n")

        switch reason {
        case .exited(let code):
            return AuditStepResult(exitCode: code, output: output)
        case .terminated:
            return AuditStepResult(exitCode: nil, output: output)
        case .retriesExhausted(let lastCode):
            return AuditStepResult(exitCode: lastCode, output: output)
        }
    }

    public static let defaultResolver: @Sendable (AuditStep) -> AuditCommand.CommandResolver = { step in
        switch step {
        case .build:
            return AuditCommand.resolveBuildCommand
        case .a11y:
            return AuditCommand.resolveA11yCommand
        }
    }
}
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `swift build --package-path .`
Expected: builds with no errors. (The rest of `AuditCommand`/`AuditRunner` still use the old `supervisor:`-based signatures at this point — that's fine, this file doesn't touch them.)

- [ ] **Step 4: Write `ContainerAuditExecutorTests.swift`**

Create `Tests/AnglesiteCoreTests/ContainerAuditExecutorTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContainerAuditExecutor")
struct ContainerAuditExecutorTests {

    // MARK: Helpers

    private func makeExecutor(
        fake: FakeLocalContainerControl,
        siteID: String = "site-abc",
        logCenter: LogCenter = LogCenter()
    ) -> ContainerAuditExecutor {
        ContainerAuditExecutor(control: fake, siteID: siteID, logCenter: logCenter)
    }

    private func fakePassing(lines: [String] = []) -> FakeLocalContainerControl {
        FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "ok", stderr: ""),
            execStdoutLines: lines
        )
    }

    // MARK: - argv mapping

    @Test("build step sends correct argv")
    func buildArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:build")
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npm", "run", "build"])
    }

    @Test("a11y step sends correct argv")
    func a11yArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .a11y, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:accessibility")
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
    }

    // MARK: - cwd is always /workspace/site

    @Test("exec always uses /workspace/site as working directory")
    func workingDirectory() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host/totally/different"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].cwd == "/workspace/site")
    }

    // MARK: - no environment forwarded

    @Test("no environment is forwarded to exec")
    func noEnvironmentForwarded() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].env.isEmpty)
    }

    // MARK: - log streaming

    @Test("stdout lines from exec are appended to LogCenter under source")
    func stdoutToLogCenter() async {
        let logCenter = LogCenter()
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "full", stderr: ""),
            execStdoutLines: ["line one", "line two"]
        )
        let executor = makeExecutor(fake: fake, logCenter: logCenter)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:build")
        let snapshot = await logCenter.snapshot()
        let texts = snapshot.filter { $0.source == "audit:site-abc:build" }.map(\.text)
        #expect(texts.contains("line one"))
        #expect(texts.contains("line two"))
    }

    // MARK: - exit code surfaced

    @Test("non-zero exit code surfaces in AuditStepResult")
    func nonZeroExitCode() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 1, stdout: "not found", stderr: ""),
            execStdoutLines: []
        )
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == 1)
    }

    @Test("zero exit code surfaces in AuditStepResult")
    func zeroExitCode() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == 0)
    }

    // MARK: - thrown exec surfaces as nil exitCode

    @Test("thrown exec returns nil exitCode and error message")
    func thrownExecReturnsNilExitCode() async {
        let fake = ThrowingFakeLocalContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-abc", logCenter: LogCenter())
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == nil)
        #expect(result.output.contains("couldn't exec in the container"))
    }

    // MARK: - bootFailed produces an actionable message

    @Test("a not-running container surfaces an actionable message, not a raw error dump")
    func bootFailedProducesActionableMessage() async {
        let fake = BootFailedFakeLocalContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-abc", logCenter: LogCenter())
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == nil)
        #expect(result.output == "Container isn't running — open/start the site's preview first.")
    }

    // MARK: - cancellation does not hang and surfaces termination

    @Test("a cancelled exec resolves (does not hang) and surfaces termination, not an exec error")
    func cancelledExecTerminates() async {
        let fake = CancelParkingFakeAuditContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "s", logCenter: LogCenter())

        let task = Task {
            await executor.run(step: .a11y, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:s:accessibility")
        }
        await fake.waitUntilParked()
        task.cancel()

        let result = await task.value
        #expect(result.exitCode == nil)
        #expect(result.output.isEmpty, "cancellation must not surface a generic exec-error string")
    }

    // MARK: - siteID forwarded to exec

    @Test("siteID is forwarded to exec")
    func siteIDForwarded() async {
        let fake = fakePassing()
        let executor = ContainerAuditExecutor(control: fake, siteID: "my-special-site", logCenter: LogCenter())
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].siteID == "my-special-site")
    }

    // MARK: - argv mapping test hook coverage

    @Test("guestArgv test hook matches the runtime argv for both steps")
    func guestArgvTestHook() {
        #expect(ContainerAuditExecutorTestHook.guestArgv(for: .build) == ["npm", "run", "build"])
        #expect(ContainerAuditExecutorTestHook.guestArgv(for: .a11y) == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
    }
}

// MARK: - ThrowingFakeLocalContainerControl

private actor ThrowingFakeLocalContainerControl: LocalContainerControl {
    enum ExecError: Error { case boom }

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw ExecError.boom
    }
    func stop(siteID: String) async throws {}
    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        throw ExecError.boom
    }
    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        throw ExecError.boom
    }
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        throw ExecError.boom
    }
    func stopWorkersDev(siteID: String) async throws {
        throw ExecError.boom
    }
}

// MARK: - BootFailedFakeLocalContainerControl

private actor BootFailedFakeLocalContainerControl: LocalContainerControl {
    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw LocalContainerError.bootFailed("never started")
    }
    func stop(siteID: String) async throws {}
    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        throw LocalContainerError.bootFailed("container is not running")
    }
    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }
    func stopWorkersDev(siteID: String) async throws {}
}

// MARK: - CancelParkingFakeAuditContainerControl

/// A `LocalContainerControl` whose `exec` suspends until the calling Task is cancelled, then
/// throws `CancellationError` — modelling a long-running guest process the audit aborts
/// mid-flight. Mirrors `ContainerDeployExecutorTests`'s `CancelParkingFakeContainerControl`.
private actor CancelParkingFakeAuditContainerControl: LocalContainerControl {
    private var parkedContinuation: CheckedContinuation<Void, Never>?

    func waitUntilParked() async {
        await withCheckedContinuation { cont in parkedContinuation = cont }
    }

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw LocalContainerError.virtualizationUnavailable
    }
    func stop(siteID: String) async throws {}

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        signalParked()
        try await Task.sleep(for: .seconds(3600))
        return ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
    }

    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    private func signalParked() {
        parkedContinuation?.resume()
        parkedContinuation = nil
    }
}
```

- [ ] **Step 5: Run the new tests**

Run: `swift test --package-path . --filter ContainerAuditExecutorTests`
Expected: all tests pass (note: per project memory, a broken sibling target still blocks compilation even with `--filter` — if this fails to build, check the error is actually about this file, not an unrelated target).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/AuditCommand.swift Sources/AnglesiteCore/AuditExecutor.swift Tests/AnglesiteCoreTests/ContainerAuditExecutorTests.swift
git commit -m "feat(#958): add AuditExecutor, HostAuditExecutor, ContainerAuditExecutor"
```

---

## Task 4: Swift — wire `AuditCommand`/`AuditRunner` through `AuditExecutor`

This is the atomic swap: `AuditRunner`'s protocol signature, `AuditCommand`'s init/build step, both runner conformances, and their tests all change together because they only compile as one unit.

**Files:**
- Modify: `Sources/AnglesiteCore/AuditCommand.swift`
- Modify: `Sources/AnglesiteCore/A11yAuditRunner.swift`
- Modify: `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift`
- Modify: `Tests/AnglesiteCoreTests/AuditCommandTests.swift`
- Modify: `Tests/AnglesiteCoreTests/AuditCommandProgressTests.swift`
- Modify: `Tests/AnglesiteCoreTests/AuditCommandCancellationTests.swift`
- Modify: `Tests/AnglesiteCoreTests/A11yAuditRunnerTests.swift`

**Interfaces:**
- Consumes: `AuditExecutor`, `AuditStep`, `AuditStepResult`, `HostAuditExecutor` (Task 3).
- Produces: `AuditRunner.run(siteDirectory:executor:logCenter:source:)` (replaces the old `supervisor:`-taking signature) — consumed by Task 5/6 and by any future runner.

- [ ] **Step 1: Rewrite `AuditCommand.swift`**

Replace the entire contents of `Sources/AnglesiteCore/AuditCommand.swift` with:

```swift
import Foundation

/// Pluggable seam for one audit category (accessibility, SEO, performance, security).
/// Production implementations run against the container-executed build (see `AuditExecutor`);
/// tests inject closures or fakes that return canned `[Finding]`.
///
/// `source` is the `LogCenter` tag the runner should use for any subprocess output
/// (`audit:<siteID>:<runner>`), so the drawer/sheet can distinguish phases.
public protocol AuditRunner: Sendable {
    var category: AuditReport.Finding.Category { get }
    func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding]
}

/// One-shot orchestrator for the deterministic structured-audit path that replaces
/// the chat-routed `/anglesite:check` pill (#86). Pairs with the LLM-routed skill,
/// which retains the broader surface (plain-English translation, troubleshooting,
/// Cloudflare doc lookups, drafting fixes).
///
/// Steps:
///   1. `executor.run(step: .build, ...)` so `dist/` is fresh (the audit scripts walk built
///      HTML). Streams to `LogCenter` under `audit:<siteID>:build`. A non-zero exit (or a
///      pre-spawn refusal / cancellation) short-circuits to `.failed` — runners can't audit
///      what didn't build.
///   2. For each `AuditRunner`, call its `run(...)`. Successful runs add their
///      findings + record the category in `runnersExecuted`. Throwing runs are
///      recorded in `runnersSkipped` — one runner's missing tooling shouldn't
///      kill the whole audit.
///
/// Returns the aggregated `AuditReport` in `.succeeded`. The actor doesn't decide
/// what counts as a "passing" audit — that's the UI's job (e.g. show a green
/// badge if no `.critical` findings, regardless of warnings).
public actor AuditCommand {
    public enum Result: Sendable, Equatable {
        case succeeded(report: AuditReport, duration: TimeInterval)
        /// `logTail` carries the captured `audit:<siteID>:build` lines so the failure
        /// sheet can show *why* the build failed without the owner having to open the
        /// Debug pane. Empty for pre-spawn refusals (`.unavailable`, spawn errors) where
        /// no subprocess produced output.
        case failed(reason: String, exitCode: Int32?, logTail: [LogCenter.LogLine])
    }

    /// How to run a subprocess for a site directory — or why it can't be run. Consumed by
    /// `HostAuditExecutor`'s injectable resolver; the default `resolveBuildCommand`/
    /// `resolveA11yCommand` values below live here for the same reason `DeployCommand` keeps
    /// `LaunchPlan`/`CommandResolver` even though only `HostDeployExecutor` uses them now.
    public enum LaunchPlan: Sendable, Equatable {
        case run(executable: URL, arguments: [String])
        case unavailable(reason: String)
    }

    public typealias CommandResolver = @Sendable (_ siteDirectory: URL) -> LaunchPlan

    private let logCenter: LogCenter
    private let executor: any AuditExecutor
    private let runners: [any AuditRunner]

    public init(
        logCenter: LogCenter = .shared,
        executor: any AuditExecutor = HostAuditExecutor(),
        runners: [any AuditRunner] = AuditCommand.defaultRunners
    ) {
        self.logCenter = logCenter
        self.executor = executor
        self.runners = runners
    }

    /// Run the audit pipeline against `siteDirectory`. Reaches `.succeeded` even when
    /// individual runners throw — those are surfaced via `report.runnersSkipped`.
    public func audit(siteID: String, siteDirectory: URL, onProgress: ProgressHandler? = nil) async -> Result {
        let started = Date()
        onProgress?(.auditBuilding)

        // Build dist/ first. Streamed so the UI can show progress.
        switch await runBuild(siteID: siteID, siteDirectory: siteDirectory) {
        case .success: break
        case .failure(let result): return result
        }

        // Run each runner in declared order. Failures are non-fatal at this layer.
        var findings: [AuditReport.Finding] = []
        var executed: [AuditReport.Finding.Category] = []
        var skipped: [AuditReport.SkippedRunner] = []

        for (index, runner) in runners.enumerated() {
            if Task.isCancelled { break }   // CancellableIntent cancel — stop before the next runner
            onProgress?(.auditRunning(category: runner.category.rawValue, index: index, of: runners.count))
            let source = "audit:\(siteID):\(runner.category.rawValue)"
            do {
                let runnerFindings = try await runner.run(
                    siteDirectory: siteDirectory,
                    executor: executor,
                    logCenter: logCenter,
                    source: source
                )
                findings.append(contentsOf: runnerFindings)
                executed.append(runner.category)
            } catch {
                // Record the skip AND log it — a runner that throws before it can emit anything
                // itself (e.g. a spawn failure) would otherwise be invisible in the drawer.
                await logCenter.append(
                    source: source,
                    stream: .stderr,
                    text: "\(runner.category.rawValue) audit skipped — \(error)"
                )
                skipped.append(.init(category: runner.category, reason: "\(error)"))
            }
        }

        if Task.isCancelled {
            return .failed(reason: "audit canceled", exitCode: nil, logTail: [])
        }
        onProgress?(.auditFinalizing)
        let report = AuditReport(findings: findings, runnersExecuted: executed, runnersSkipped: skipped)
        return .succeeded(report: report, duration: Date().timeIntervalSince(started))
    }

    // MARK: - Build step

    private enum BuildOutcome { case success; case failure(Result) }

    private func runBuild(siteID: String, siteDirectory: URL) async -> BuildOutcome {
        let source = "audit:\(siteID):build"
        let result = await executor.run(step: .build, siteDirectory: siteDirectory, source: source)
        let tail = await logCenter.snapshot().filter { $0.source == source }

        guard let code = result.exitCode else {
            // nil exit code → unavailable resolver, spawn failure, or termination (cancellation).
            if Task.isCancelled {
                return .failure(.failed(reason: "build was terminated", exitCode: nil, logTail: tail))
            }
            return .failure(.failed(reason: result.output, exitCode: nil, logTail: tail))
        }
        guard code == 0 else {
            return .failure(.failed(reason: "build failed", exitCode: code, logTail: tail))
        }
        return .success
    }

    // MARK: - Default seams

    /// Host Node is retired (#70). Audits must run through the container runtime — see
    /// `ContainerAuditExecutor`. `HostAuditExecutor.defaultResolver` uses this for the `.build`
    /// step so the command fails explicitly instead of spawning embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }

    /// Same as `resolveBuildCommand`, for the `.a11y` step. `A11yAuditRunner` used to spawn
    /// `npx tsx` on the host directly (bypassing this convention entirely); it now goes through
    /// `HostAuditExecutor.defaultResolver` like every other step.
    public static let resolveA11yCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("accessibility audit"))
    }

    /// Default runner set: `A11yAuditRunner` plus `SecurityTxtAuditRunner` (#843). SEO / perf /
    /// link-check runners are mechanical follow-ups that slot into this list without changing
    /// the actor or sheet UI (#86 follow-ups).
    public static let defaultRunners: [any AuditRunner] = [
        A11yAuditRunner(),
        SecurityTxtAuditRunner()
    ]
}
```

- [ ] **Step 2: Rewrite `A11yAuditRunner.swift`**

Replace the entire contents of `Sources/AnglesiteCore/A11yAuditRunner.swift` with:

```swift
import Foundation

/// `AuditRunner` for accessibility: runs `scripts/a11y-audit.ts` with `--json` via the shared
/// `AuditExecutor` (container-routed when a container is live; explicitly unavailable on host,
/// matching `AuditCommand`'s build step), and parses its structured output into
/// `[AuditReport.Finding]`.
///
/// The script's report shape (`A11yAuditReport`) maps to `Finding`s as:
///   - `issue.severity == "error"`   → `.critical`
///   - `issue.severity == "warning"` → `.warning`
///   - `issue.severity == "notice"`  → `.info`
///   - `issue.rule`                  → `title`
///   - `issue.message`               → `detail`
///   - `issue.suggestion`            → `remediation`
///   - `issue.page`                  → `location`
///
/// The runner stays thin and stateless — all the parsing is a single static method
/// so it's trivially testable without spawning `tsx`.
public struct A11yAuditRunner: AuditRunner {
    public let category: AuditReport.Finding.Category = .accessibility

    public init() {}

    public func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
        let result = await executor.run(step: .a11y, siteDirectory: siteDirectory, source: source)

        // The script writes a markdown report to `reports/a11y-report.md` *and* prints the
        // JSON on stdout when `--json` is passed. Exit code is severity-aware:
        //   0 → no errors AND no warnings
        //   1 → at least one WCAG violation
        //   2 → warnings only
        // We treat all three as "the script ran" — the findings list reflects the severity.
        // Anything else (including a nil exit code — pre-spawn refusal, container not running,
        // or a thrown exec) is unexpected; mirror it as a runner failure so the UI can show
        // "audit script couldn't run" rather than silently ignoring the issue.
        guard let exitCode = result.exitCode, [0, 1, 2].contains(exitCode) else {
            throw Error.scriptFailed(exitCode: result.exitCode, output: result.output)
        }

        // The output may contain the markdown report (always written) plus the JSON object.
        // Find the JSON object by scanning for the first `{` and parsing from there.
        guard let jsonStart = result.output.firstIndex(of: "{") else {
            throw Error.noJSONInOutput
        }
        let jsonString = String(result.output[jsonStart...])
        return try Self.parse(json: Data(jsonString.utf8))
    }

    public enum Error: Swift.Error, Equatable {
        case scriptFailed(exitCode: Int32?, output: String)
        case noJSONInOutput
        case unknownSeverity(String)
    }

    // MARK: - JSON parsing

    /// Parses an `a11y-audit.ts --json` report into `[Finding]`. Exposed for tests.
    public static func parse(json data: Data) throws -> [AuditReport.Finding] {
        let decoded = try JSONDecoder().decode(WireReport.self, from: data)
        return try decoded.issues.map { issue in
            AuditReport.Finding(
                category: .accessibility,
                severity: try mapSeverity(issue.severity),
                title: issue.rule,
                detail: issue.message,
                remediation: issue.suggestion,
                location: issue.page
            )
        }
    }

    private static func mapSeverity(_ raw: String) throws -> AuditReport.Finding.Severity {
        switch raw {
        case "error":   return .critical
        case "warning": return .warning
        case "notice":  return .info
        default:        throw Error.unknownSeverity(raw)
        }
    }

    /// Wire shape of the audit script's `--json` output. We only decode the fields we use.
    private struct WireReport: Decodable {
        let issues: [WireIssue]

        struct WireIssue: Decodable {
            let page: String
            let rule: String
            let severity: String
            let message: String
            let suggestion: String?
        }
    }
}
```

- [ ] **Step 3: Update `SecurityTxtAuditRunner.swift`'s `run` signature**

Read `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift` first if you haven't already this session. Find:

```swift
    public func run(
        siteDirectory: URL,
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
```

Replace with:

```swift
    public func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
```

The body is unchanged — it never referenced `supervisor`/`logCenter`/`source` (only `siteDirectory`), so it doesn't reference `executor` either.

- [ ] **Step 4: Update `AuditCommandTests.swift`**

Replace the `makeCommand`/`shFixture` helpers and the one test that reads `AuditCommand.resolveBuildCommand` directly. Find:

```swift
    private func makeCommand(
        runners: [any AuditRunner],
        build: @escaping AuditCommand.CommandResolver = { _ in
            .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [])
        }
    ) -> (AuditCommand, ProcessSupervisor, LogCenter) {
        let supervisor = ProcessSupervisor()
        let center = LogCenter()
        let cmd = AuditCommand(
            supervisor: supervisor,
            logCenter: center,
            resolveBuildCommand: build,
            runners: runners
        )
        return (cmd, supervisor, center)
    }

    private func shFixture(_ script: String) -> AuditCommand.LaunchPlan {
        .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", script])
    }

    @Test("default build resolver fails explicitly after host Node retirement")
    func defaultBuildResolverUnavailable() {
        #expect(
            AuditCommand.resolveBuildCommand(tmpDir)
                == .unavailable(reason: "audit build must run in the container runtime; host Node has been retired")
        )
    }
```

Replace with:

```swift
    private func makeCommand(
        runners: [any AuditRunner],
        build: @escaping AuditCommand.CommandResolver = { _ in
            .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [])
        }
    ) -> (AuditCommand, LogCenter) {
        let center = LogCenter()
        let hostExecutor = HostAuditExecutor(
            logCenter: center,
            resolveCommand: { step in
                switch step {
                case .build: return build
                case .a11y: return { _ in .unavailable(reason: "a11y step not used by this fixture") }
                }
            }
        )
        let cmd = AuditCommand(logCenter: center, executor: hostExecutor, runners: runners)
        return (cmd, center)
    }

    private func shFixture(_ script: String) -> AuditCommand.LaunchPlan {
        .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", script])
    }

    @Test("default build resolver fails explicitly after host Node retirement")
    func defaultBuildResolverUnavailable() {
        #expect(
            AuditCommand.resolveBuildCommand(tmpDir)
                == .unavailable(reason: "audit build must run in the container runtime; host Node has been retired")
        )
    }

    @Test("default a11y resolver fails explicitly after host Node retirement")
    func defaultA11yResolverUnavailable() {
        #expect(
            AuditCommand.resolveA11yCommand(tmpDir)
                == .unavailable(reason: "accessibility audit must run in the container runtime; host Node has been retired")
        )
    }

    @Test("HostAuditExecutor's default resolver fails explicitly for both steps")
    func hostExecutorDefaultUnavailableForBothSteps() async {
        let executor = HostAuditExecutor()
        let buildResult = await executor.run(step: .build, siteDirectory: tmpDir, source: "test")
        let a11yResult = await executor.run(step: .a11y, siteDirectory: tmpDir, source: "test")
        #expect(buildResult.exitCode == nil)
        #expect(buildResult.output == "audit build must run in the container runtime; host Node has been retired")
        #expect(a11yResult.exitCode == nil)
        #expect(a11yResult.output == "accessibility audit must run in the container runtime; host Node has been retired")
    }
```

Now every call site of `makeCommand` in this file returns a 2-tuple, not a 3-tuple. Update each call site — find every occurrence of:

```swift
let (cmd, _, center) = makeCommand(
```

and replace with:

```swift
let (cmd, center) = makeCommand(
```

and every occurrence of:

```swift
let (cmd, _, _) = makeCommand(
```

and replace with:

```swift
let (cmd, _) = makeCommand(
```

There are exactly 8 such call sites in this file: `cancellationTerminatesBuild` uses the 3-arg form `let (cmd, _, center) = makeCommand(` (becomes `let (cmd, center) = makeCommand(`); the other 7 — `failsWhenBuildExitsNonZero`, `failedBuildCapturesLogTail`, `failsWhenBuildResolverReportsUnavailable`, `emptyRunnersListReturnsSuccessWithNoFindings`, `singleAccessibilityRunnerSucceeds`, `runnerThatThrowsIsRecordedAsSkipped`, `findingsFromMultipleRunnersAreConcatenated` — use `let (cmd, _, _) = makeCommand(` (becomes `let (cmd, _) = makeCommand(`). Update all 8; if `swift build` reports a tuple-arity mismatch afterward, you missed one.

Finally, update `FakeAuditRunner` at the bottom of the file. Find:

```swift
private struct FakeAuditRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    let result: Result<[AuditReport.Finding], Error>

    func run(siteDirectory: URL, supervisor: ProcessSupervisor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] {
        switch result {
        case .success(let findings): return findings
        case .failure(let error):    throw error
        }
    }
}
```

Replace with:

```swift
private struct FakeAuditRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    let result: Result<[AuditReport.Finding], Error>

    func run(siteDirectory: URL, executor: any AuditExecutor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] {
        switch result {
        case .success(let findings): return findings
        case .failure(let error):    throw error
        }
    }
}
```

- [ ] **Step 5: Update `AuditCommandProgressTests.swift`**

Replace the entire file contents with:

```swift
// Tests/AnglesiteCoreTests/AuditCommandProgressTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite(.serialized)
struct AuditCommandProgressTests {
    @Test("emits building, one running-per-runner with fractions, then finalizing")
    func milestones() async {
        let recorder = ProgressRecorder()
        let r1 = PassRunner(category: .accessibility)
        let r2 = PassRunner(category: .seo)
        let executor = HostAuditExecutor(
            resolveCommand: { step in
                switch step {
                case .build: return { _ in .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: []) }
                case .a11y: return { _ in .unavailable(reason: "not used by this fixture") }
                }
            }
        )
        let cmd = AuditCommand(executor: executor, runners: [r1, r2])
        _ = await cmd.audit(siteID: "s", siteDirectory: URL(fileURLWithPath: NSTemporaryDirectory()),
                            onProgress: { recorder.record($0) })
        let phases = recorder.phases()
        #expect(phases == ["building", "running", "running", "finalizing"])
    }
}

private struct PassRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    func run(siteDirectory: URL, executor: any AuditExecutor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] { [] }
}
```

- [ ] **Step 6: Update `AuditCommandCancellationTests.swift`**

Replace the entire file contents with:

```swift
// Tests/AnglesiteCoreTests/AuditCommandCancellationTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite(.serialized)
struct AuditCommandCancellationTests {
    @Test("cancelling after the first runner skips the remaining runners")
    func cancelBetweenRunners() async throws {
        let counter = RunCounter()
        let holder = AuditTaskHolder()
        let first = ClosureRunner(category: .accessibility) { await counter.bump(); await holder.cancel(); return [] }
        let second = ClosureRunner(category: .seo) { await counter.bump(); return [] }
        // The build must succeed (exit 0 via `true`) so the runner loop is reached at all.
        let executor = HostAuditExecutor(
            resolveCommand: { step in
                switch step {
                case .build: return { _ in .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: []) }
                case .a11y: return { _ in .unavailable(reason: "not used by this fixture") }
                }
            }
        )
        let cmd = AuditCommand(executor: executor, runners: [first, second])
        let task = Task { await cmd.audit(siteID: "s", siteDirectory: URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)) }
        await holder.hold(task)
        let result = await task.value
        #expect(await counter.value == 1)   // only the first runner ran
        // A cancelled audit must return .failed, not .succeeded with a partial report
        #expect(result == .failed(reason: "audit canceled", exitCode: nil, logTail: []))
    }
}

private actor RunCounter { private(set) var value = 0; func bump() { value += 1 } }
private actor AuditTaskHolder {
    private var pending = false
    private var task: Task<AuditCommand.Result, Never>?
    func cancel() { pending = true; task?.cancel() }
    func hold(_ t: Task<AuditCommand.Result, Never>) { task = t; if pending { t.cancel() } }
}
private struct ClosureRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    let body: @Sendable () async -> [AuditReport.Finding]
    func run(siteDirectory: URL, executor: any AuditExecutor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] {
        await body()
    }
}
```

- [ ] **Step 7: Add a `run()`-level test to `A11yAuditRunnerTests.swift`**

Read `Tests/AnglesiteCoreTests/A11yAuditRunnerTests.swift` first if you haven't already this session. Add these two tests inside the `A11yAuditRunnerTests` struct, after the existing `toleratesAbsentOptionalFields` test (before the closing `}`):

```swift

    @Test("run() parses successful executor output into findings")
    func runParsesExecutorOutput() async throws {
        let raw = #"{"issues": [{"page": "/", "rule": "img-alt-missing", "severity": "error", "message": "m", "suggestion": "s"}]}"#
        let executor = FakeAuditExecutor(result: AuditStepResult(exitCode: 0, output: raw))
        let runner = A11yAuditRunner()
        let findings = try await runner.run(
            siteDirectory: URL(fileURLWithPath: "/site"), executor: executor, logCenter: LogCenter(), source: "audit:s:accessibility"
        )
        #expect(findings.count == 1)
        #expect(findings[0].title == "img-alt-missing")
    }

    @Test("run() throws scriptFailed when the executor reports no exit code (container unavailable)")
    func runThrowsWhenExecutorUnavailable() async {
        let executor = FakeAuditExecutor(result: AuditStepResult(exitCode: nil, output: "container isn't running"))
        let runner = A11yAuditRunner()
        await #expect(throws: A11yAuditRunner.Error.self) {
            _ = try await runner.run(
                siteDirectory: URL(fileURLWithPath: "/site"), executor: executor, logCenter: LogCenter(), source: "audit:s:accessibility"
            )
        }
    }
```

Add this fake at the bottom of the file (after the closing `}` of the `A11yAuditRunnerTests` struct):

```swift

private struct FakeAuditExecutor: AuditExecutor {
    let result: AuditStepResult
    func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult { result }
}
```

- [ ] **Step 8: Build and run all AnglesiteCore audit-related tests**

Run: `swift build --package-path .`
Expected: builds with no errors.

Run: `swift test --package-path . --filter AuditCommandTests --filter AuditCommandProgressTests --filter AuditCommandCancellationTests --filter A11yAuditRunnerTests --filter ContainerAuditExecutorTests`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add Sources/AnglesiteCore/AuditCommand.swift Sources/AnglesiteCore/A11yAuditRunner.swift Sources/AnglesiteCore/SecurityTxtAuditRunner.swift Tests/AnglesiteCoreTests/AuditCommandTests.swift Tests/AnglesiteCoreTests/AuditCommandProgressTests.swift Tests/AnglesiteCoreTests/AuditCommandCancellationTests.swift Tests/AnglesiteCoreTests/A11yAuditRunnerTests.swift
git commit -m "fix(#958): route AuditCommand + A11yAuditRunner via AuditExecutor"
```

---

## Task 5: Swift — `AuditExecutorSelectionTests.swift`

**Files:**
- Test: `Tests/AnglesiteCoreTests/AuditExecutorSelectionTests.swift`

**Interfaces:**
- Consumes: `AuditCommand`, `HostAuditExecutor`, `ContainerAuditExecutor`, `FakeLocalContainerControl` (all pre-existing after Tasks 3–4).

- [ ] **Step 1: Write the test file**

Create `Tests/AnglesiteCoreTests/AuditExecutorSelectionTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

/// When a `LocalContainerControl` is supplied to `AuditCommand` via `ContainerAuditExecutor`,
/// the audit routes through it; when absent (`HostAuditExecutor`) it never touches a container.
/// Mirrors `DeployExecutorSelectionTests`.
@Suite("AuditExecutor selection")
struct AuditExecutorSelectionTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    // MARK: - Container path

    @Test("when a container control is supplied, exec() is called on it for the build step")
    func containerControlRoutesExecToContainer() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: #"{"issues":[]}"#, stderr: ""),
            execStdoutLines: []
        )
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-1", logCenter: LogCenter())
        let cmd = AuditCommand(executor: executor, runners: [])
        _ = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        let calls = await fake.execCalls
        #expect(calls.count == 1, "the build step must route through container control.exec()")
        #expect(calls[0].siteID == "site-1")
        #expect(calls[0].argv == ["npm", "run", "build"])
    }

    @Test("all runners' steps route through the container executor, in order, after a successful build")
    func runnerStepsRouteViaContainer() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: #"{"issues":[]}"#, stderr: ""),
            execStdoutLines: []
        )
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-1", logCenter: LogCenter())
        let cmd = AuditCommand(executor: executor, runners: [A11yAuditRunner()])
        let result = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        let calls = await fake.execCalls
        #expect(calls.count == 2)
        #expect(calls[0].argv == ["npm", "run", "build"])
        #expect(calls[1].argv == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
    }

    // MARK: - Host path (no container control → no exec calls on any container control)

    @Test("when no container control is supplied, container control exec() is never called")
    func hostPathDoesNotCallContainerExec() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "", stderr: ""),
            execStdoutLines: []
        )
        let hostExecutor = HostAuditExecutor(
            resolveCommand: { _ in { _ in .unavailable(reason: "host path chosen") } }
        )
        let cmd = AuditCommand(executor: hostExecutor, runners: [])
        _ = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        let calls = await fake.execCalls
        #expect(calls.isEmpty, "container control.exec() must NOT be called when the host executor is used")
    }
}
```

- [ ] **Step 2: Run it**

Run: `swift test --package-path . --filter AuditExecutorSelectionTests`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add Tests/AnglesiteCoreTests/AuditExecutorSelectionTests.swift
git commit -m "test(#958): add AuditCommand container/host executor selection tests"
```

---

## Task 6: Swift — `AuditModel`/`SiteWindowModel` container wiring

**Files:**
- Modify: `Sources/AnglesiteApp/AuditModel.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:612-616`

**Interfaces:**
- Consumes: `ContainerAuditExecutor`, `LocalContainerControl` (AnglesiteCore, after Task 3); `PreviewModel.activeContainerControl() async -> (siteID: String, control: any LocalContainerControl)?` (pre-existing, `Sources/AnglesiteApp/PreviewModel.swift:488`).

- [ ] **Step 1: Rewrite `AuditModel.swift`**

Replace the entire contents of `Sources/AnglesiteApp/AuditModel.swift` with:

```swift
import SwiftUI
import AnglesiteCore

/// SwiftUI-facing wrapper around `AuditCommand`. Drives one audit at a time and exposes
/// the structured `AuditReport` to `AuditSheetView`.
///
/// The audit is render-as-sheet (not drawer) because the findings list can be long —
/// fits a 600pt-tall sheet better than a 320pt drawer. The deploy drawer's live-log
/// streaming pattern would just hide the result behind a wall of `npm run build` noise
/// the moment the build settles.
@MainActor
@Observable
final class AuditModel {
    /// Resolves the local-container capability at the moment an audit actually runs, mirroring
    /// `DeployModel.ContainerControlProvider` — a container started after the model was wired up
    /// (or restarted since) is still picked up.
    typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    enum Phase: Equatable {
        case idle
        case running(siteID: String, since: Date)
        case succeeded(report: AuditReport, duration: TimeInterval)
        case failed(reason: String, exitCode: Int32?, logTail: [LogCenter.LogLine])
    }

    private(set) var phase: Phase = .idle

    /// Bound to a `.sheet` in `SiteWindow`. The view sets this back to false when the
    /// user dismisses; we open it whenever the phase reaches a terminal state so the
    /// owner gets the report (or failure) without a second click.
    var sheetPresented: Bool = false

    /// Fires on every phase change — start and terminal alike — with the site id of the run the
    /// transition belongs to (delivered per-run, not captured at wiring time, so a window
    /// replayed onto a different site can't mis-attribute an in-flight audit's outcome).
    /// `SiteWindowModel` wires this to the completion notifier (#526); the model stays
    /// UserNotifications-free.
    @ObservationIgnored var onPhaseTransition: ((_ siteID: String, _ phase: Phase) -> Void)?

    private let command: AuditCommand
    /// Shared with whatever `AuditCommand` this model builds for the container path (see
    /// `runAudit`), so the runner-skip log line and the build/a11y-step output land under the
    /// same `LogCenter` instance instead of silently splitting across two.
    private let logCenter: LogCenter
    private var inFlight: Task<Void, Never>?

    init(command: AuditCommand = AuditCommand(), logCenter: LogCenter = .shared) {
        self.command = command
        self.logCenter = logCenter
    }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    /// Renders the captured build log as plain text for the "Copy log" affordance on the
    /// failure sheet. Empty for non-failure phases or for failures that produced no output
    /// (e.g. spawn refusal before the build process started).
    var logText: String {
        guard case .failed(_, _, let tail) = phase else { return "" }
        return tail.map(\.text).joined(separator: "\n")
    }

    /// Kicks off an audit. No-op if one is already running. `containerControlProvider` is
    /// resolved inside `runAudit`, at the moment the audit actually runs — mirrors
    /// `DeployModel.deploy`'s identical seam.
    func audit(
        siteID: String,
        siteDirectory: URL,
        containerControlProvider: @escaping ContainerControlProvider = { nil }
    ) {
        guard !isRunning else { return }
        inFlight = Task { @MainActor [weak self] in
            await self?.runAudit(siteID: siteID, siteDirectory: siteDirectory, containerControlProvider: containerControlProvider)
        }
    }

    func dismissSheet() {
        sheetPresented = false
    }

    /// Set `phase` and notify the transition hook.
    private func transition(siteID: String, to newPhase: Phase) {
        phase = newPhase
        onPhaseTransition?(siteID, newPhase)
    }

    private func runAudit(
        siteID: String,
        siteDirectory: URL,
        containerControlProvider: @escaping ContainerControlProvider
    ) async {
        let started = Date()
        transition(siteID: siteID, to: .running(siteID: siteID, since: started))
        // Don't open the sheet during the build/audit — the running spinner lives in the
        // toolbar button. Sheet opens on terminal state so the owner sees the result.
        sheetPresented = false

        // Select the executor: in-container when the runtime is a started container; the
        // injected default (host, explicit failure) otherwise. Mirrors
        // `DeployModel.runDeploy`'s `activeCommand` selection.
        let containerControl = await containerControlProvider()
        let activeCommand: AuditCommand
        if let cc = containerControl {
            activeCommand = AuditCommand(
                logCenter: logCenter,
                executor: ContainerAuditExecutor(control: cc.control, siteID: cc.siteID, logCenter: logCenter)
            )
        } else {
            activeCommand = command
        }

        let result = await activeCommand.audit(siteID: siteID, siteDirectory: siteDirectory)
        switch result {
        case .succeeded(let report, let duration):
            transition(siteID: siteID, to: .succeeded(report: report, duration: duration))
        case .failed(let reason, let exit, let logTail):
            transition(siteID: siteID, to: .failed(reason: reason, exitCode: exit, logTail: logTail))
        }
        sheetPresented = true
    }
}
```

- [ ] **Step 2: Wire `SiteWindowModel.auditSite()`**

Read `Sources/AnglesiteApp/SiteWindowModel.swift` around line 612 first if you haven't already this session. Find:

```swift
    func auditSite() {
        guard let site, canRunAudit else { return }
```

Look at the next line(s) to see the existing call to `audit.audit(...)` and replace that call. It currently reads:

```swift
        audit.audit(siteID: site.id, siteDirectory: site.sourceDirectory)
```

Replace with:

```swift
        audit.audit(
            siteID: site.id, siteDirectory: site.sourceDirectory,
            containerControlProvider: { [preview] in await preview.activeContainerControl() })
```

(This mirrors `deploySite()`'s `containerControlProvider: { [preview] in await preview.activeContainerControl() }` a few lines above it in the same file.)

- [ ] **Step 3: Build the app target**

Run: `xcodegen generate` (only if `Anglesite.xcodeproj` doesn't exist yet in this worktree — check with `ls Anglesite.xcodeproj` first).
Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`. `AnglesiteApp` isn't a SwiftPM test target (per CONTRIBUTING.md, app-target logic is kept thin and pushed into `AnglesiteCore` for testability, which is exactly what Tasks 3–5 did) — this build is the verification for this task, there's no `swift test` coverage for `AuditModel`/`SiteWindowModel` directly.

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/AuditModel.swift Sources/AnglesiteApp/SiteWindowModel.swift
git commit -m "fix(#958): route Website > Audit through the container when available"
```

---

## Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full Swift package test suite**

Run: `swift test --package-path .`
Expected: all suites pass, including the four modified/new audit suites from Tasks 3–5. If `swift test` hangs with no output, check for a stale `swift-test` process holding the `.build` lock (`pgrep -fl swift-test`) before assuming a bad test.

- [ ] **Step 2: Full app build**

Run: `xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Full template test suite + type-check**

Run:
```bash
cd Resources/Template
npx tsx --test scripts/*.test.ts scripts/embeds/*.test.ts src/lib/*.test.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "astro:content\|ImportMeta"
```
Expected: all `node:test` runs pass; the filtered `tsc` output is empty (the grep strips the pre-existing `astro:content`/`import.meta` noise unrelated to this change — if `astro check` is available and fast enough in this environment, running `npm run build` instead is a stronger check, but is not required if it needs network access this environment doesn't have).

- [ ] **Step 4: Manually verify the whole flow end-to-end (optional but recommended)**

If you have a local Apple Containerization environment available: open a site in Anglesite, wait for the preview container to start, run **Website ▸ Audit**, and confirm it now completes with a findings sheet (or a clean "no issues" state) instead of the old "audit build must run in the container runtime; host Node has been retired" failure. This can't be automated in this environment — note in the PR description whether you were able to verify it live, and if not, say so explicitly rather than claiming it works.

- [ ] **Step 5: Review the full diff against CONTRIBUTING.md before opening the PR**

Re-read `CONTRIBUTING.md` ▸ "Commits and pull requests". Confirm:
- Every commit subject is ≤ 72 characters and conventional-commit-formatted.
- The PR body uses `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan) — this change touches no MCP message schema, so the Paired PR check section should say so explicitly, not be omitted.
- Remove the `🛠️ In Progress` label from issue #958 once the PR is open: `gh issue edit 958 --remove-label "🛠️ In Progress"`.
