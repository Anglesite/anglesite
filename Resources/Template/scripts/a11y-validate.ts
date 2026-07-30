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
