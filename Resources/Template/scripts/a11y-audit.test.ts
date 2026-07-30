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
