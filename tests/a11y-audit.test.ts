import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
} from "../template/scripts/a11y-audit.js";

// ---------------------------------------------------------------------------
// suggestFix
// ---------------------------------------------------------------------------

describe("suggestFix", () => {
  it("returns the catalogued suggestion for a heuristic rule", () => {
    expect(suggestFix("heading-skip")).toContain("heading levels in order");
  });

  it("returns the catalogued suggestion for an axe-core rule", () => {
    expect(suggestFix("color-contrast")).toContain("contrast");
  });

  it("matches by prefix for long pa11y codes", () => {
    const code = "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18";
    expect(suggestFix(code)).toContain("contrast");
  });

  it("falls back to message keyword when rule is unknown", () => {
    expect(suggestFix("unknown-rule", "Element has insufficient contrast")).toContain("contrast");
    expect(suggestFix("unknown-rule", "Image is missing alt text")).toContain("alt");
    expect(suggestFix("unknown-rule", "Form field has no label")).toContain("label");
    expect(suggestFix("unknown-rule", "Content is outside any landmark")).toContain("landmark");
  });

  it("returns the generic fallback when nothing matches", () => {
    expect(suggestFix("totally-unknown", "some unrelated message")).toContain("WCAG 2.1 AA");
  });
});

// ---------------------------------------------------------------------------
// Severity classifiers
// ---------------------------------------------------------------------------

describe("classifyPa11ySeverity", () => {
  it("maps known pa11y types directly", () => {
    expect(classifyPa11ySeverity("error")).toBe("error");
    expect(classifyPa11ySeverity("warning")).toBe("warning");
    expect(classifyPa11ySeverity("notice")).toBe("notice");
  });

  it("defaults to notice for unknown types", () => {
    expect(classifyPa11ySeverity("anything-else")).toBe("notice");
  });
});

describe("classifyAxeSeverity", () => {
  it("maps critical and serious to error", () => {
    expect(classifyAxeSeverity("critical")).toBe("error");
    expect(classifyAxeSeverity("serious")).toBe("error");
  });

  it("maps moderate to warning", () => {
    expect(classifyAxeSeverity("moderate")).toBe("warning");
  });

  it("maps minor and unknown to notice", () => {
    expect(classifyAxeSeverity("minor")).toBe("notice");
    expect(classifyAxeSeverity(null)).toBe("notice");
    expect(classifyAxeSeverity(undefined)).toBe("notice");
  });
});

describe("classifyHeuristicSeverity", () => {
  it("maps html-validate errors to error", () => {
    expect(classifyHeuristicSeverity("error")).toBe("error");
  });

  it("maps warnings to warning", () => {
    expect(classifyHeuristicSeverity("warning")).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// extractWcagCriteria
// ---------------------------------------------------------------------------

describe("extractWcagCriteria", () => {
  it("pulls a SC reference from a pa11y code", () => {
    expect(extractWcagCriteria("WCAG2AA.Principle1.Guideline1_4.1_4_3.G18")).toEqual(["SC 1.4.3"]);
  });

  it("returns an empty array when no SC is present", () => {
    expect(extractWcagCriteria("color-contrast")).toEqual([]);
  });
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

describe("aggregateReport", () => {
  it("counts errors, warnings, and notices per page", () => {
    const report = aggregateReport(
      [
        issue("/index.html", "error"),
        issue("/index.html", "warning"),
        issue("/about.html", "notice"),
        issue("/about.html", "warning"),
      ],
      ["heuristic"],
    );
    expect(report.totals).toEqual({ errors: 1, warnings: 2, notices: 1 });
    expect(report.pages).toHaveLength(2);
    const home = report.pages.find((p) => p.path === "/index.html")!;
    expect(home).toEqual({ path: "/index.html", errors: 1, warnings: 1, notices: 0 });
  });

  it("sorts pages by path", () => {
    const report = aggregateReport(
      [issue("/zebra.html", "error"), issue("/alpha.html", "error")],
      ["heuristic"],
    );
    expect(report.pages.map((p) => p.path)).toEqual(["/alpha.html", "/zebra.html"]);
  });

  it("returns empty totals for no issues", () => {
    const report = aggregateReport([], ["heuristic"]);
    expect(report.totals).toEqual({ errors: 0, warnings: 0, notices: 0 });
    expect(report.pages).toEqual([]);
  });
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

describe("exitCodeFor", () => {
  it("returns 1 for any error", () => {
    expect(exitCodeFor(reportWith(1, 0), false)).toBe(1);
    expect(exitCodeFor(reportWith(3, 5), false)).toBe(1);
  });

  it("returns 2 for warnings without errors", () => {
    expect(exitCodeFor(reportWith(0, 1), false)).toBe(2);
    expect(exitCodeFor(reportWith(0, 5, 3), false)).toBe(2);
  });

  it("returns 0 for clean reports", () => {
    expect(exitCodeFor(reportWith(0, 0), false)).toBe(0);
    expect(exitCodeFor(reportWith(0, 0, 5), false)).toBe(0);
  });

  it("always returns 0 in warn-only mode", () => {
    expect(exitCodeFor(reportWith(10, 10, 10), true)).toBe(0);
    expect(exitCodeFor(reportWith(0, 0), true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe("formatReport", () => {
  it("includes a clean message when there are no issues", () => {
    const out = formatReport(aggregateReport([], ["heuristic"]));
    expect(out).toContain("No accessibility issues found");
  });

  it("includes the per-page summary table for issues", () => {
    const out = formatReport(
      aggregateReport([issue("/index.html", "error", "image-alt")], ["heuristic"]),
    );
    expect(out).toContain("/index.html");
    expect(out).toContain("Errors");
    expect(out).toContain("[ERROR] image-alt");
  });

  it("includes the suggested fix for each issue", () => {
    const out = formatReport(
      aggregateReport([issue("/x.html", "warning", "color-contrast")], ["heuristic"]),
    );
    expect(out).toContain("Fix:");
  });
});

// ---------------------------------------------------------------------------
// walkHtml + runHeuristicScan against a fixture directory
// ---------------------------------------------------------------------------

describe("walkHtml", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds .html files recursively", () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "blog"));
    writeFileSync(join(dir, "blog", "post.html"), "<html></html>");
    writeFileSync(join(dir, "skip.txt"), "ignored");

    const files = walkHtml(dir);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("index.html"))).toBe(true);
    expect(files.some((f) => f.endsWith("post.html"))).toBe(true);
  });
});

describe("runHeuristicScan", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "a11y-audit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty array when dist does not exist", () => {
    expect(runHeuristicScan(join(dir, "missing"))).toEqual([]);
  });

  it("flags a missing alt attribute", () => {
    writeFileSync(
      join(dir, "index.html"),
      "<!doctype html><html lang=\"en\"><body><h1>Hi</h1><img src=\"x.png\"></body></html>",
    );
    const issues = runHeuristicScan(dir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.rule === "img-alt-missing")).toBe(true);
    const altIssue = issues.find((i) => i.rule === "img-alt-missing")!;
    expect(altIssue.tool).toBe("heuristic");
    expect(altIssue.suggestion).toMatch(/alt/i);
    expect(altIssue.severity).toBe("error");
  });

  it("flags generic link text as a warning", () => {
    writeFileSync(
      join(dir, "page.html"),
      "<!doctype html><html lang=\"en\"><body><h1>Hi</h1><a href=\"/x\">click here</a></body></html>",
    );
    const issues = runHeuristicScan(dir);
    expect(issues.some((i) => i.rule === "link-text-generic")).toBe(true);
    const generic = issues.find((i) => i.rule === "link-text-generic")!;
    expect(generic.severity).toBe("warning");
  });

  it("returns no issues for clean HTML", () => {
    writeFileSync(
      join(dir, "index.html"),
      "<!doctype html><html lang=\"en\"><body><h1>Hello</h1><img src=\"x.png\" alt=\"A clear photo of a dog\"><a href=\"/about\">Read about the team</a></body></html>",
    );
    expect(runHeuristicScan(dir)).toEqual([]);
  });

  it("uses paths relative to the dist directory", () => {
    mkdirSync(join(dir, "blog"));
    writeFileSync(
      join(dir, "blog", "post.html"),
      "<!doctype html><html lang=\"en\"><body><h1>Hi</h1><img src=\"x.png\"></body></html>",
    );
    const issues = runHeuristicScan(dir);
    expect(issues[0].page.startsWith("blog")).toBe(true);
  });
});
