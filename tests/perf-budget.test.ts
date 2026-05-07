import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_BUDGET,
  readBudget,
  parseOverrides,
  matchOverride,
  budgetForPage,
  extractAssets,
  resolveAssetPath,
  htmlToUrlPath,
  measurePage,
  evaluatePage,
  formatReport,
  runAudit,
  summarizeForTrend,
  appendTrend,
  exitCodeFor,
} from "../template/scripts/perf-budget.js";

// ---------------------------------------------------------------------------
// Budget resolution
// ---------------------------------------------------------------------------

describe("readBudget", () => {
  it("returns the default when key is missing", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "")).toBe(51200);
  });

  it("returns the parsed value when key is present", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS=102400")).toBe(102400);
  });

  it("falls back to default for non-numeric values", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS=not-a-number")).toBe(51200);
  });

  it("falls back to default for non-positive values", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS=0")).toBe(51200);
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS=-100")).toBe(51200);
  });

  it("trims whitespace", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS=  4096  ")).toBe(4096);
  });

  it("ignores other keys with the same prefix", () => {
    expect(readBudget("PERF_BUDGET_JS", 51200, "PERF_BUDGET_JS_LAB=999999")).toBe(51200);
  });
});

// ---------------------------------------------------------------------------
// Override parsing
// ---------------------------------------------------------------------------

describe("parseOverrides", () => {
  it("returns an empty map when no overrides exist", () => {
    expect(parseOverrides("", "JS").size).toBe(0);
  });

  it("collects per-template overrides keyed by lowercase suffix", () => {
    const config = ["PERF_BUDGET_JS=51200", "PERF_BUDGET_JS_LAB=512000", "PERF_BUDGET_JS_BLOG=102400"].join("\n");
    const overrides = parseOverrides(config, "JS");
    expect(overrides.get("lab")).toBe(512000);
    expect(overrides.get("blog")).toBe(102400);
    expect(overrides.size).toBe(2);
  });

  it("does not pick up other metric prefixes", () => {
    const config = ["PERF_BUDGET_CSS_LAB=51200", "PERF_BUDGET_JS_LAB=999"].join("\n");
    expect(parseOverrides(config, "JS").get("lab")).toBe(999);
    expect(parseOverrides(config, "CSS").get("lab")).toBe(51200);
  });

  it("ignores malformed override values", () => {
    const config = "PERF_BUDGET_JS_LAB=NaNNN";
    expect(parseOverrides(config, "JS").size).toBe(0);
  });

  it("handles LCP_MS suffix", () => {
    const config = "PERF_BUDGET_LCP_MS_LAB=4000";
    expect(parseOverrides(config, "LCP_MS").get("lab")).toBe(4000);
  });
});

describe("matchOverride", () => {
  const overrides = new Map([
    ["lab", 512000],
    ["blog", 102400],
  ]);

  it("matches the first path segment", () => {
    expect(matchOverride("/lab/colors", overrides)).toBe(512000);
    expect(matchOverride("/blog/post", overrides)).toBe(102400);
  });

  it("is case-insensitive on the suffix", () => {
    expect(matchOverride("/LAB/", overrides)).toBe(512000);
  });

  it("returns undefined for unknown segments", () => {
    expect(matchOverride("/about", overrides)).toBeUndefined();
  });

  it("returns undefined for the root path", () => {
    expect(matchOverride("/", overrides)).toBeUndefined();
  });
});

describe("budgetForPage", () => {
  const defaults = { jsBytes: 51200, cssBytes: 51200, lcpMs: 2500, clsScore: 0.1 };
  const empty = new Map<string, number>();

  it("returns the override when one matches", () => {
    const overrides = new Map([["lab", 999999]]);
    expect(budgetForPage("/lab/canvas", "js", defaults, overrides)).toBe(999999);
  });

  it("falls back to the metric-specific default", () => {
    expect(budgetForPage("/about", "js", defaults, empty)).toBe(51200);
    expect(budgetForPage("/about", "css", defaults, empty)).toBe(51200);
    expect(budgetForPage("/about", "lcp", defaults, empty)).toBe(2500);
    expect(budgetForPage("/about", "cls", defaults, empty)).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// Asset extraction
// ---------------------------------------------------------------------------

describe("extractAssets", () => {
  it("extracts script src values", () => {
    const html = '<script src="/_astro/foo.js"></script><script src="bar.js"></script>';
    expect(extractAssets(html).scripts).toEqual(["/_astro/foo.js", "bar.js"]);
  });

  it("ignores inline scripts", () => {
    const html = '<script>console.log("hi")</script><script src="/x.js"></script>';
    expect(extractAssets(html).scripts).toEqual(["/x.js"]);
  });

  it("extracts stylesheet hrefs in either attribute order", () => {
    const html = [
      '<link rel="stylesheet" href="/a.css">',
      '<link href="/b.css" rel="stylesheet">',
    ].join("");
    expect(extractAssets(html).styles.sort()).toEqual(["/a.css", "/b.css"]);
  });

  it("ignores non-stylesheet link tags", () => {
    const html = '<link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css">';
    expect(extractAssets(html).styles).toEqual(["/style.css"]);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveAssetPath", () => {
  const dist = "/var/site/dist";

  it("returns undefined for absolute URLs", () => {
    expect(resolveAssetPath("https://example.com/x.js", `${dist}/index.html`, dist)).toBeUndefined();
    expect(resolveAssetPath("//cdn.example.com/x.js", `${dist}/index.html`, dist)).toBeUndefined();
    expect(resolveAssetPath("data:text/js,console.log(1)", `${dist}/index.html`, dist)).toBeUndefined();
  });

  it("resolves root-relative paths against dist", () => {
    expect(resolveAssetPath("/_astro/x.js", `${dist}/about/index.html`, dist)).toBe(`${dist}/_astro/x.js`);
  });

  it("resolves relative paths against the HTML file's directory", () => {
    expect(resolveAssetPath("./local.css", `${dist}/blog/post.html`, dist)).toBe(`${dist}/blog/local.css`);
  });

  it("strips query strings and fragments before resolving", () => {
    expect(resolveAssetPath("/x.css?v=1#h", `${dist}/index.html`, dist)).toBe(`${dist}/x.css`);
  });

  it("returns undefined for empty input", () => {
    expect(resolveAssetPath("", `${dist}/index.html`, dist)).toBeUndefined();
  });
});

describe("htmlToUrlPath", () => {
  const dist = "/var/site/dist";

  it("maps dist/index.html to /", () => {
    expect(htmlToUrlPath(`${dist}/index.html`, dist)).toBe("/");
  });

  it("maps dist/about/index.html to /about/", () => {
    expect(htmlToUrlPath(`${dist}/about/index.html`, dist)).toBe("/about/");
  });

  it("strips .html for non-index pages", () => {
    expect(htmlToUrlPath(`${dist}/blog/post.html`, dist)).toBe("/blog/post");
  });
});

// ---------------------------------------------------------------------------
// Measurement and evaluation (filesystem)
// ---------------------------------------------------------------------------

describe("measurePage and evaluatePage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perf-budget-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): void {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  it("sums the size of referenced JS and CSS assets", () => {
    writeFile("_astro/app.js", "x".repeat(2048));
    writeFile("_astro/extra.js", "y".repeat(1024));
    writeFile("style.css", "z".repeat(4096));
    writeFile(
      "index.html",
      [
        '<link rel="stylesheet" href="/style.css">',
        '<script src="/_astro/app.js"></script>',
        '<script src="/_astro/extra.js"></script>',
      ].join(""),
    );

    const metrics = measurePage(join(dir, "index.html"), dir);
    expect(metrics.jsBytes).toBe(2048 + 1024);
    expect(metrics.cssBytes).toBe(4096);
    expect(metrics.path).toBe("/");
  });

  it("ignores external scripts that aren't part of the local bundle", () => {
    writeFile("_astro/app.js", "x".repeat(1024));
    writeFile(
      "index.html",
      [
        '<script src="https://cdn.example.com/big.js"></script>',
        '<script src="/_astro/app.js"></script>',
      ].join(""),
    );
    const metrics = measurePage(join(dir, "index.html"), dir);
    expect(metrics.jsBytes).toBe(1024);
  });

  it("flags pages over the JS budget", () => {
    writeFile("_astro/heavy.js", "x".repeat(60000));
    writeFile("index.html", '<script src="/_astro/heavy.js"></script>');
    const metrics = measurePage(join(dir, "index.html"), dir);
    const findings = evaluatePage(metrics, DEFAULT_BUDGET, {
      js: new Map(),
      css: new Map(),
      lcp: new Map(),
      cls: new Map(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ metric: "js", status: "fail" });
    expect(findings[0].actual).toBe(60000);
    expect(findings[0].budget).toBe(DEFAULT_BUDGET.jsBytes);
  });

  it("respects per-template overrides", () => {
    writeFile("_astro/heavy.js", "x".repeat(200000));
    writeFile("lab/index.html", '<script src="/_astro/heavy.js"></script>');
    const metrics = measurePage(join(dir, "lab/index.html"), dir);
    expect(metrics.path).toBe("/lab/");
    const findings = evaluatePage(metrics, DEFAULT_BUDGET, {
      js: new Map([["lab", 524288]]),
      css: new Map(),
      lcp: new Map(),
      cls: new Map(),
    });
    expect(findings).toHaveLength(0);
  });

  it("flags LCP and CLS when measurements are present", () => {
    writeFile("index.html", "<html></html>");
    const metrics = measurePage(join(dir, "index.html"), dir);
    metrics.lcpMs = 4000;
    metrics.clsScore = 0.5;
    const findings = evaluatePage(metrics, DEFAULT_BUDGET, {
      js: new Map(),
      css: new Map(),
      lcp: new Map(),
      cls: new Map(),
    });
    expect(findings.map((f) => f.metric).sort()).toEqual(["cls", "lcp"]);
  });
});

// ---------------------------------------------------------------------------
// runAudit (integration with filesystem)
// ---------------------------------------------------------------------------

describe("runAudit", () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perf-audit-"));
    originalCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("audits every HTML page in dist/", async () => {
    mkdirSync(join(dir, "dist/_astro"), { recursive: true });
    writeFileSync(join(dir, "dist/_astro/a.js"), "x".repeat(1000));
    writeFileSync(join(dir, "dist/_astro/b.js"), "x".repeat(60000));
    writeFileSync(join(dir, "dist/index.html"), '<script src="/_astro/a.js"></script>');
    mkdirSync(join(dir, "dist/heavy"));
    writeFileSync(join(dir, "dist/heavy/index.html"), '<script src="/_astro/b.js"></script>');

    const report = await runAudit({ distDir: "dist", configContent: "" });
    expect(report.pages).toHaveLength(2);
    const heavy = report.pages.find((p) => p.path === "/heavy/");
    expect(heavy?.jsBytes).toBe(60000);
    expect(report.findings.some((f) => f.path === "/heavy/" && f.metric === "js")).toBe(true);
    expect(report.findings.some((f) => f.path === "/" && f.metric === "js")).toBe(false);
  });

  it("honors PERF_BUDGET_JS overrides from config", async () => {
    mkdirSync(join(dir, "dist/_astro"), { recursive: true });
    writeFileSync(join(dir, "dist/_astro/a.js"), "x".repeat(60000));
    writeFileSync(join(dir, "dist/index.html"), '<script src="/_astro/a.js"></script>');

    const report = await runAudit({ distDir: "dist", configContent: "PERF_BUDGET_JS=100000" });
    expect(report.findings).toHaveLength(0);
    expect(report.defaults.jsBytes).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// Trend tracking
// ---------------------------------------------------------------------------

describe("summarizeForTrend", () => {
  it("sums totals across all pages", () => {
    const entry = summarizeForTrend({
      generatedAt: "2026-05-06T00:00:00Z",
      defaults: DEFAULT_BUDGET,
      lighthouseRan: false,
      pages: [
        { path: "/", jsBytes: 1000, cssBytes: 500, jsAssets: [], cssAssets: [] },
        { path: "/about/", jsBytes: 2000, cssBytes: 800, jsAssets: [], cssAssets: [] },
      ],
      findings: [],
    });
    expect(entry.totalJs).toBe(3000);
    expect(entry.totalCss).toBe(1300);
    expect(entry.pageCount).toBe(2);
    expect(entry.findingCount).toBe(0);
    expect(entry.worstLcpMs).toBeUndefined();
  });

  it("captures the worst LCP and CLS when present", () => {
    const entry = summarizeForTrend({
      generatedAt: "2026-05-06T00:00:00Z",
      defaults: DEFAULT_BUDGET,
      lighthouseRan: true,
      pages: [
        { path: "/", jsBytes: 0, cssBytes: 0, jsAssets: [], cssAssets: [], lcpMs: 1800, clsScore: 0.05 },
        { path: "/heavy/", jsBytes: 0, cssBytes: 0, jsAssets: [], cssAssets: [], lcpMs: 3200, clsScore: 0.3 },
      ],
      findings: [],
    });
    expect(entry.worstLcpMs).toBe(3200);
    expect(entry.worstCls).toBe(0.3);
  });
});

describe("appendTrend", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perf-trend-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a fresh history when the file doesn't exist", () => {
    const trendPath = join(dir, "perf-trend.json");
    const history = appendTrend(trendPath, {
      generatedAt: "2026-05-06T00:00:00Z",
      totalJs: 1000,
      totalCss: 500,
      pageCount: 1,
      findingCount: 0,
    });
    expect(history).toHaveLength(1);
  });

  it("appends to an existing history", () => {
    const trendPath = join(dir, "perf-trend.json");
    writeFileSync(
      trendPath,
      JSON.stringify([
        { generatedAt: "2026-05-01T00:00:00Z", totalJs: 500, totalCss: 200, pageCount: 1, findingCount: 0 },
      ]),
    );
    const history = appendTrend(trendPath, {
      generatedAt: "2026-05-06T00:00:00Z",
      totalJs: 1000,
      totalCss: 500,
      pageCount: 1,
      findingCount: 0,
    });
    expect(history).toHaveLength(2);
    expect(history[0].generatedAt).toBe("2026-05-01T00:00:00Z");
  });

  it("trims to the most recent N entries", () => {
    const trendPath = join(dir, "perf-trend.json");
    const seed = Array.from({ length: 30 }, (_, i) => ({
      generatedAt: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      totalJs: i * 100,
      totalCss: 0,
      pageCount: 1,
      findingCount: 0,
    }));
    writeFileSync(trendPath, JSON.stringify(seed));
    const history = appendTrend(
      trendPath,
      { generatedAt: "2026-05-01T00:00:00Z", totalJs: 9999, totalCss: 0, pageCount: 1, findingCount: 0 },
      30,
    );
    expect(history).toHaveLength(30);
    expect(history[history.length - 1].totalJs).toBe(9999);
    expect(history[0].generatedAt).toBe("2026-04-02T00:00:00Z");
  });

  it("recovers from a corrupt history file", () => {
    const trendPath = join(dir, "perf-trend.json");
    writeFileSync(trendPath, "not json");
    const history = appendTrend(trendPath, {
      generatedAt: "2026-05-06T00:00:00Z",
      totalJs: 0,
      totalCss: 0,
      pageCount: 0,
      findingCount: 0,
    });
    expect(history).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------

describe("exitCodeFor", () => {
  const cleanReport = {
    generatedAt: "2026-05-06T00:00:00Z",
    defaults: DEFAULT_BUDGET,
    pages: [],
    findings: [],
    lighthouseRan: false,
  };

  it("returns 0 for a clean report", () => {
    expect(exitCodeFor(cleanReport, false)).toBe(0);
  });

  it("returns 1 when findings exist and warn-only is off", () => {
    const report = { ...cleanReport, findings: [{ path: "/", metric: "js" as const, actual: 999, budget: 100, status: "fail" as const }] };
    expect(exitCodeFor(report, false)).toBe(1);
  });

  it("returns 0 when warn-only is on, regardless of findings", () => {
    const report = { ...cleanReport, findings: [{ path: "/", metric: "js" as const, actual: 999, budget: 100, status: "fail" as const }] };
    expect(exitCodeFor(report, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

describe("formatReport", () => {
  it("renders an all-clear summary when there are no findings", () => {
    const out = formatReport({
      generatedAt: "2026-05-06T00:00:00Z",
      defaults: DEFAULT_BUDGET,
      pages: [{ path: "/", jsBytes: 1024, cssBytes: 2048, jsAssets: [], cssAssets: [] }],
      findings: [],
      lighthouseRan: false,
    });
    expect(out).toContain("All pages within budget.");
    expect(out).toContain("/");
    expect(out).toMatch(/JS/);
  });

  it("renders an over-budget table when findings exist", () => {
    const out = formatReport({
      generatedAt: "2026-05-06T00:00:00Z",
      defaults: DEFAULT_BUDGET,
      pages: [{ path: "/", jsBytes: 60000, cssBytes: 0, jsAssets: [], cssAssets: [] }],
      findings: [{ path: "/", metric: "js", actual: 60000, budget: 51200, status: "fail" }],
      lighthouseRan: false,
    });
    expect(out).toContain("## Over budget");
    expect(out).toContain("| / | JS |");
  });
});
