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
 *   tsx scripts/a11y-audit.ts --report a11y-report.md  # write markdown
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { validateHtml, type A11yIssue } from "./a11y-validate.js";
import { readConfig } from "./config.js";

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

export async function runPa11yScan(htmlFiles: string[], distDir: string): Promise<A11yAuditIssue[]> {
  let pa11y: ((target: string, opts?: Record<string, unknown>) => Promise<{ issues: Pa11yIssue[] }>) | null = null;
  try {
    const mod = await import("pa11y" /* @vite-ignore */);
    pa11y = (mod as { default: typeof pa11y }).default ?? (mod as unknown as typeof pa11y);
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

export async function runAxeScan(htmlFiles: string[], distDir: string): Promise<A11yAuditIssue[]> {
  let chromium: { launch: () => Promise<unknown> } | null = null;
  let AxeBuilder: (new (opts: { page: unknown }) => { withTags: (tags: string[]) => { analyze: () => Promise<{ violations: AxeViolation[] }> } }) | null = null;
  try {
    const playwright = await import("playwright" /* @vite-ignore */);
    chromium = (playwright as { chromium: typeof chromium }).chromium;
    const axeMod = await import("@axe-core/playwright" /* @vite-ignore */);
    AxeBuilder = (axeMod as { default: typeof AxeBuilder }).default ?? (axeMod as unknown as typeof AxeBuilder);
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
              wcag: (v.tags ?? []).filter((t) => t.startsWith("wcag")),
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
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : undefined;
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
