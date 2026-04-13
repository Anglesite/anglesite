import { describe, it, expect } from "vitest";
import {
  auditPage,
  auditSite,
  inferPageSchemaType,
  generatePageJsonLd,
  detectFaqSections,
  validateSitemap,
  suggestSitemapConfig,
  auditRobotsTxt,
  generateLlmsTxt,
  auditChunkability,
  formatSeoReport,
  type SeoIssue,
  type PageSeoData,
  type PageSchemaInput,
  type LlmsTxtInput,
} from "../template/scripts/seo.js";

// ---------------------------------------------------------------------------
// auditPage — single-page SEO checks
// ---------------------------------------------------------------------------

describe("auditPage", () => {
  const minimal = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Page — My Site | Quality Services</title>
  <meta name="description" content="A helpful description of this page for search engines.">
  <link rel="canonical" href="https://example.com/my-page">
  <meta property="og:title" content="My Page">
  <meta property="og:description" content="A helpful description of this page for search engines.">
  <meta property="og:url" content="https://example.com/my-page">
  <meta property="og:image" content="https://example.com/og.png">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
</head>
<body><h1>My Page</h1></body>
</html>`;

  it("returns no issues for a well-formed page", () => {
    const issues = auditPage(minimal, "/my-page");
    expect(issues).toEqual([]);
  });

  it("flags missing <title>", () => {
    const html = minimal.replace(/<title>.*<\/title>/, "");
    const issues = auditPage(html, "/about");
    expect(issues.some((i) => i.code === "missing-title")).toBe(true);
    expect(issues.find((i) => i.code === "missing-title")!.severity).toBe(
      "critical",
    );
  });

  it("flags too-short title (<30 chars)", () => {
    const html = minimal.replace(
      /<title>.*<\/title>/,
      "<title>Hi</title>",
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "title-length")).toBe(true);
    expect(issues.find((i) => i.code === "title-length")!.severity).toBe(
      "warning",
    );
  });

  it("flags too-long title (>60 chars)", () => {
    const long = "A".repeat(65);
    const html = minimal.replace(
      /<title>.*<\/title>/,
      `<title>${long}</title>`,
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "title-length")).toBe(true);
  });

  it("flags missing meta description", () => {
    const html = minimal.replace(
      /<meta name="description"[^>]*>/,
      "",
    );
    const issues = auditPage(html, "/about");
    expect(issues.some((i) => i.code === "missing-description")).toBe(true);
    expect(
      issues.find((i) => i.code === "missing-description")!.severity,
    ).toBe("critical");
  });

  it("flags too-short description (<50 chars)", () => {
    const html = minimal.replace(
      /<meta name="description"[^>]*>/,
      '<meta name="description" content="Short.">',
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "description-length")).toBe(true);
  });

  it("flags too-long description (>160 chars)", () => {
    const long = "B".repeat(170);
    const html = minimal.replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${long}">`,
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "description-length")).toBe(true);
  });

  it("flags missing canonical URL", () => {
    const html = minimal.replace(/<link rel="canonical"[^>]*>/, "");
    const issues = auditPage(html, "/about");
    expect(issues.some((i) => i.code === "missing-canonical")).toBe(true);
    expect(
      issues.find((i) => i.code === "missing-canonical")!.severity,
    ).toBe("warning");
  });

  it("flags missing og:title", () => {
    const html = minimal.replace(
      /<meta property="og:title"[^>]*>/,
      "",
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "missing-og-title")).toBe(true);
  });

  it("flags missing og:description", () => {
    const html = minimal.replace(
      /<meta property="og:description"[^>]*>/,
      "",
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "missing-og-description")).toBe(true);
  });

  it("flags missing og:image", () => {
    const html = minimal.replace(
      /<meta property="og:image"[^>]*>/,
      "",
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "missing-og-image")).toBe(true);
    expect(
      issues.find((i) => i.code === "missing-og-image")!.severity,
    ).toBe("warning");
  });

  it("flags missing twitter:card", () => {
    const html = minimal.replace(
      /<meta name="twitter:card"[^>]*>/,
      "",
    );
    const issues = auditPage(html, "/");
    expect(issues.some((i) => i.code === "missing-twitter-card")).toBe(true);
    expect(
      issues.find((i) => i.code === "missing-twitter-card")!.severity,
    ).toBe("nice-to-have");
  });

  it("includes the page URL in every issue", () => {
    const html = "<html><head></head><body></body></html>";
    const issues = auditPage(html, "/broken");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.page === "/broken")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// auditSite — cross-page checks (duplicate titles/descriptions)
// ---------------------------------------------------------------------------

describe("auditSite", () => {
  it("flags duplicate titles across pages", () => {
    const pages: PageSeoData[] = [
      { url: "/", title: "Same Title", description: "Desc one." },
      { url: "/about", title: "Same Title", description: "Desc two." },
    ];
    const issues = auditSite(pages);
    expect(issues.some((i) => i.code === "duplicate-title")).toBe(true);
    expect(issues.find((i) => i.code === "duplicate-title")!.severity).toBe(
      "warning",
    );
  });

  it("flags duplicate descriptions across pages", () => {
    const pages: PageSeoData[] = [
      { url: "/", title: "Title One", description: "Same description." },
      { url: "/about", title: "Title Two", description: "Same description." },
    ];
    const issues = auditSite(pages);
    expect(issues.some((i) => i.code === "duplicate-description")).toBe(true);
  });

  it("returns no issues when titles and descriptions are unique", () => {
    const pages: PageSeoData[] = [
      { url: "/", title: "Home", description: "Welcome to our site." },
      { url: "/about", title: "About", description: "Learn about us." },
    ];
    const issues = auditSite(pages);
    expect(issues).toEqual([]);
  });

  it("ignores pages with missing titles (already caught by auditPage)", () => {
    const pages: PageSeoData[] = [
      { url: "/", title: undefined as unknown as string, description: "Desc." },
      { url: "/about", title: undefined as unknown as string, description: "Other." },
    ];
    const issues = auditSite(pages);
    expect(issues.some((i) => i.code === "duplicate-title")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inferPageSchemaType — per-page Schema.org type inference
// ---------------------------------------------------------------------------

describe("inferPageSchemaType", () => {
  it("returns BlogPosting for blog post pages", () => {
    expect(inferPageSchemaType("blog-post")).toBe("BlogPosting");
  });

  it("returns FAQPage for FAQ pages", () => {
    expect(inferPageSchemaType("faq")).toBe("FAQPage");
  });

  it("returns Event for event pages", () => {
    expect(inferPageSchemaType("event")).toBe("Event");
  });

  it("returns Product for product pages", () => {
    expect(inferPageSchemaType("product")).toBe("Product");
  });

  it("returns WebPage as default", () => {
    expect(inferPageSchemaType("generic")).toBe("WebPage");
  });

  it("returns AboutPage for about pages", () => {
    expect(inferPageSchemaType("about")).toBe("AboutPage");
  });

  it("returns ContactPage for contact pages", () => {
    expect(inferPageSchemaType("contact")).toBe("ContactPage");
  });
});

// ---------------------------------------------------------------------------
// generatePageJsonLd — produce complete JSON-LD for any page type
// ---------------------------------------------------------------------------

describe("generatePageJsonLd", () => {
  it("generates BlogPosting JSON-LD with required fields", () => {
    const input: PageSchemaInput = {
      pageType: "blog-post",
      url: "https://example.com/posts/hello",
      title: "Hello World",
      description: "My first post",
      datePublished: "2025-01-15",
      author: "Jane Doe",
      siteName: "My Site",
    };
    const ld = generatePageJsonLd(input);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BlogPosting");
    expect(ld.headline).toBe("Hello World");
    expect(ld.datePublished).toBe("2025-01-15");
    expect(ld.author).toEqual({ "@type": "Person", name: "Jane Doe" });
  });

  it("generates BreadcrumbList for interior pages", () => {
    const input: PageSchemaInput = {
      pageType: "generic",
      url: "https://example.com/services/plumbing",
      title: "Plumbing Services",
      description: "We fix pipes",
      siteName: "My Plumber",
      breadcrumbs: [
        { name: "Home", url: "https://example.com/" },
        { name: "Services", url: "https://example.com/services" },
        { name: "Plumbing", url: "https://example.com/services/plumbing" },
      ],
    };
    const ld = generatePageJsonLd(input);
    // Should return an array with WebPage + BreadcrumbList
    expect(Array.isArray(ld)).toBe(true);
    const arr = ld as any[];
    expect(arr.some((item: any) => item["@type"] === "BreadcrumbList")).toBe(true);
    const breadcrumb = arr.find((item: any) => item["@type"] === "BreadcrumbList");
    expect(breadcrumb.itemListElement).toHaveLength(3);
    expect(breadcrumb.itemListElement[0].position).toBe(1);
  });

  it("generates FAQPage JSON-LD with questions", () => {
    const input: PageSchemaInput = {
      pageType: "faq",
      url: "https://example.com/faq",
      title: "FAQ",
      description: "Frequently asked questions",
      siteName: "My Site",
      faqItems: [
        { question: "What is this?", answer: "A test." },
        { question: "How does it work?", answer: "Like magic." },
      ],
    };
    const ld = generatePageJsonLd(input);
    const faq = Array.isArray(ld) ? ld.find((i: any) => i["@type"] === "FAQPage") : ld;
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]["@type"]).toBe("Question");
    expect(faq.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
  });

  it("generates WebPage for generic pages without breadcrumbs", () => {
    const input: PageSchemaInput = {
      pageType: "generic",
      url: "https://example.com/privacy",
      title: "Privacy Policy",
      description: "Our privacy policy",
      siteName: "My Site",
    };
    const ld = generatePageJsonLd(input);
    expect(Array.isArray(ld)).toBe(false);
    expect((ld as any)["@type"]).toBe("WebPage");
  });
});

// ---------------------------------------------------------------------------
// detectFaqSections — find FAQ patterns in HTML
// ---------------------------------------------------------------------------

describe("detectFaqSections", () => {
  it("detects FAQ from heading + details/summary pattern", () => {
    const html = `
      <h2>Frequently Asked Questions</h2>
      <details><summary>What is this?</summary><p>A thing.</p></details>
      <details><summary>How much?</summary><p>Free.</p></details>
    `;
    const faqs = detectFaqSections(html);
    expect(faqs).toHaveLength(2);
    expect(faqs[0].question).toBe("What is this?");
    expect(faqs[0].answer).toBe("A thing.");
  });

  it("detects FAQ from dt/dd pattern", () => {
    const html = `
      <dl>
        <dt>What is your return policy?</dt>
        <dd>30 days no questions asked.</dd>
        <dt>Do you ship internationally?</dt>
        <dd>Yes, worldwide.</dd>
      </dl>
    `;
    const faqs = detectFaqSections(html);
    expect(faqs).toHaveLength(2);
    expect(faqs[1].question).toBe("Do you ship internationally?");
  });

  it("returns empty array when no FAQ patterns found", () => {
    const html = "<p>Just a regular paragraph.</p>";
    expect(detectFaqSections(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateSitemap — check sitemap completeness
// ---------------------------------------------------------------------------

describe("validateSitemap", () => {
  it("returns no issues when all pages are listed with lastmod", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2025-01-01</lastmod></url>
  <url><loc>https://example.com/about</loc><lastmod>2025-01-01</lastmod></url>
</urlset>`;
    const issues = validateSitemap(xml, ["/", "/about"], "https://example.com");
    expect(issues).toEqual([]);
  });

  it("flags pages missing from sitemap", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`;
    const issues = validateSitemap(xml, ["/", "/about", "/contact"], "https://example.com");
    expect(issues.some((i) => i.code === "sitemap-missing-page")).toBe(true);
    expect(issues.find((i) => i.code === "sitemap-missing-page")!.message).toContain("/about");
  });

  it("warns when <lastmod> is missing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`;
    const issues = validateSitemap(xml, ["/"], "https://example.com");
    expect(issues.some((i) => i.code === "sitemap-no-lastmod")).toBe(true);
  });

  it("does not warn about lastmod when present", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2025-01-01</lastmod></url>
</urlset>`;
    const issues = validateSitemap(xml, ["/"], "https://example.com");
    expect(issues.some((i) => i.code === "sitemap-no-lastmod")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestSitemapConfig — changefreq/priority heuristics
// ---------------------------------------------------------------------------

describe("suggestSitemapConfig", () => {
  it("assigns high priority to homepage", () => {
    const config = suggestSitemapConfig(["/"]);
    expect(config["/"]).toEqual({ changefreq: "daily", priority: 1.0 });
  });

  it("assigns monthly/0.7 to blog posts", () => {
    const config = suggestSitemapConfig(["/posts/hello-world"]);
    expect(config["/posts/hello-world"]).toEqual({ changefreq: "monthly", priority: 0.7 });
  });

  it("assigns weekly/0.8 to standard pages", () => {
    const config = suggestSitemapConfig(["/about"]);
    expect(config["/about"]).toEqual({ changefreq: "weekly", priority: 0.8 });
  });
});

// ---------------------------------------------------------------------------
// auditRobotsTxt — AI crawler checks
// ---------------------------------------------------------------------------

describe("auditRobotsTxt", () => {
  it("returns no issues for a permissive robots.txt", () => {
    const content = `User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap-index.xml`;
    const issues = auditRobotsTxt(content, "https://example.com");
    expect(issues.some((i) => i.severity === "critical")).toBe(false);
  });

  it("flags missing sitemap reference", () => {
    const content = `User-agent: *\nAllow: /`;
    const issues = auditRobotsTxt(content, "https://example.com");
    expect(issues.some((i) => i.code === "robots-no-sitemap")).toBe(true);
  });

  it("warns when AI crawlers are blocked", () => {
    const content = `User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /`;
    const issues = auditRobotsTxt(content, "https://example.com");
    expect(issues.some((i) => i.code === "robots-ai-blocked")).toBe(true);
    expect(issues.find((i) => i.code === "robots-ai-blocked")!.message).toContain("ClaudeBot");
  });

  it("warns about Cloudflare default AI bot blocking", () => {
    // When robots.txt doesn't explicitly allow AI bots, warn about Cloudflare's
    // default behavior of blocking them at the CDN level
    const content = `User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml`;
    const issues = auditRobotsTxt(content, "https://example.com");
    expect(issues.some((i) => i.code === "robots-cloudflare-ai-block")).toBe(true);
    expect(issues.find((i) => i.code === "robots-cloudflare-ai-block")!.severity).toBe("nice-to-have");
  });
});

// ---------------------------------------------------------------------------
// generateLlmsTxt — markdown index for AI crawlers
// ---------------------------------------------------------------------------

describe("generateLlmsTxt", () => {
  it("generates valid markdown with site info", () => {
    const input: LlmsTxtInput = {
      siteName: "Joe's Pizza",
      siteUrl: "https://joespizza.com",
      description: "New York-style pizza in Springfield",
      pages: [
        { url: "/", title: "Home", description: "Welcome" },
        { url: "/menu", title: "Menu", description: "Our pizza menu" },
      ],
    };
    const txt = generateLlmsTxt(input);
    expect(txt).toContain("# Joe's Pizza");
    expect(txt).toContain("joespizza.com");
    expect(txt).toContain("New York-style pizza");
    expect(txt).toContain("Menu");
    expect(txt).toContain("/menu");
  });

  it("includes all pages in the output", () => {
    const input: LlmsTxtInput = {
      siteName: "Test",
      siteUrl: "https://test.com",
      description: "A test site",
      pages: [
        { url: "/a", title: "Page A", description: "Desc A" },
        { url: "/b", title: "Page B", description: "Desc B" },
        { url: "/c", title: "Page C", description: "Desc C" },
      ],
    };
    const txt = generateLlmsTxt(input);
    expect(txt).toContain("/a");
    expect(txt).toContain("/b");
    expect(txt).toContain("/c");
  });
});

// ---------------------------------------------------------------------------
// auditChunkability — flag long unbroken prose
// ---------------------------------------------------------------------------

describe("auditChunkability", () => {
  it("flags sections with >225 words of unbroken prose", () => {
    const words = Array(230).fill("word").join(" ");
    const html = `<section><p>${words}</p></section>`;
    const issues = auditChunkability(html, "/long-page");
    expect(issues.some((i) => i.code === "poor-chunkability")).toBe(true);
  });

  it("returns no issues for well-structured content", () => {
    const shortParagraph = Array(50).fill("word").join(" ");
    const html = `
      <section><h2>Part 1</h2><p>${shortParagraph}</p></section>
      <section><h2>Part 2</h2><p>${shortParagraph}</p></section>
    `;
    const issues = auditChunkability(html, "/good-page");
    expect(issues).toEqual([]);
  });

  it("does not flag content split by headings", () => {
    const words = Array(100).fill("word").join(" ");
    const html = `<p>${words}</p><h2>Break</h2><p>${words}</p>`;
    const issues = auditChunkability(html, "/");
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSeoReport — ranked issues table as markdown
// ---------------------------------------------------------------------------

describe("formatSeoReport", () => {
  it("produces markdown with Critical section first", () => {
    const issues: SeoIssue[] = [
      { code: "missing-title", severity: "critical", message: "No title", page: "/" },
      { code: "missing-og-image", severity: "warning", message: "No OG image", page: "/" },
      { code: "missing-twitter-card", severity: "nice-to-have", message: "No twitter card", page: "/" },
    ];
    const report = formatSeoReport(issues);
    const critIdx = report.indexOf("Critical");
    const warnIdx = report.indexOf("Warning");
    const niceIdx = report.indexOf("Nice to have");
    expect(critIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(niceIdx);
  });

  it("includes all issues in the output", () => {
    const issues: SeoIssue[] = [
      { code: "a", severity: "critical", message: "Issue A", page: "/a" },
      { code: "b", severity: "warning", message: "Issue B", page: "/b" },
    ];
    const report = formatSeoReport(issues);
    expect(report).toContain("Issue A");
    expect(report).toContain("Issue B");
  });

  it("returns clean message when no issues", () => {
    const report = formatSeoReport([]);
    expect(report).toContain("No SEO issues");
  });

  it("includes a timestamp", () => {
    const report = formatSeoReport([
      { code: "x", severity: "warning", message: "test", page: "/" },
    ]);
    // Should contain a date-like pattern
    expect(report).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
