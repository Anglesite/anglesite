/**
 * SEO audit and generation utilities.
 *
 * - auditPage: check a single HTML page for SEO issues
 * - auditSite: cross-page checks (duplicate titles/descriptions)
 * - validateSitemap: check sitemap completeness against built pages
 * - auditRobotsTxt: check robots.txt for AI crawler blocks
 * - generateLlmsTxt: generate /llms.txt for AI crawlers
 * - auditChunkability: flag pages with long unbroken prose
 * - formatSeoReport: produce ranked issues table as markdown
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "nice-to-have";

export interface SeoIssue {
  code: string;
  severity: Severity;
  message: string;
  page: string;
}

export interface PageSeoData {
  url: string;
  title: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageSchemaInput {
  pageType: string;
  url: string;
  title: string;
  description: string;
  siteName: string;
  datePublished?: string;
  dateModified?: string;
  author?: string;
  image?: string;
  breadcrumbs?: BreadcrumbItem[];
  faqItems?: FaqItem[];
}

export interface LlmsTxtInput {
  siteName: string;
  siteUrl: string;
  description: string;
  pages: PageSeoData[];
}

export interface SitemapPageConfig {
  changefreq: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

function getTagContent(html: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : undefined;
}

function getMetaContent(
  html: string,
  attr: string,
  value: string,
): string | undefined {
  // Match both name="x" and property="x" meta tags
  const re = new RegExp(
    `<meta\\s+[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["'][^>]*/?>|<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["'][^>]*/?>`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2]) : undefined;
}

function getLinkHref(
  html: string,
  rel: string,
): string | undefined {
  const re = new RegExp(
    `<link\\s+[^>]*rel=["']${rel}["'][^>]*href=["']([^"']*)["'][^>]*/?>|<link\\s+[^>]*href=["']([^"']*)["'][^>]*rel=["']${rel}["'][^>]*/?>`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2]) : undefined;
}

// ---------------------------------------------------------------------------
// auditPage — single-page SEO checks
// ---------------------------------------------------------------------------

export function auditPage(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Title
  const title = getTagContent(html, "title");
  if (!title) {
    issues.push({
      code: "missing-title",
      severity: "critical",
      message: "Page is missing a <title> tag",
      page: url,
    });
  } else {
    if (title.length < 30) {
      issues.push({
        code: "title-length",
        severity: "warning",
        message: `Title is too short (${title.length} chars, aim for 30–60)`,
        page: url,
      });
    } else if (title.length > 60) {
      issues.push({
        code: "title-length",
        severity: "warning",
        message: `Title is too long (${title.length} chars, aim for 30–60)`,
        page: url,
      });
    }
  }

  // Meta description
  const description = getMetaContent(html, "name", "description");
  if (!description) {
    issues.push({
      code: "missing-description",
      severity: "critical",
      message: "Page is missing a meta description",
      page: url,
    });
  } else {
    if (description.length < 50) {
      issues.push({
        code: "description-length",
        severity: "warning",
        message: `Meta description is too short (${description.length} chars, aim for 50–160)`,
        page: url,
      });
    } else if (description.length > 160) {
      issues.push({
        code: "description-length",
        severity: "warning",
        message: `Meta description is too long (${description.length} chars, aim for 50–160)`,
        page: url,
      });
    }
  }

  // Canonical
  const canonical = getLinkHref(html, "canonical");
  if (!canonical) {
    issues.push({
      code: "missing-canonical",
      severity: "warning",
      message: "Page is missing a canonical URL",
      page: url,
    });
  }

  // Open Graph
  if (!getMetaContent(html, "property", "og:title")) {
    issues.push({
      code: "missing-og-title",
      severity: "warning",
      message: "Missing og:title meta tag",
      page: url,
    });
  }

  if (!getMetaContent(html, "property", "og:description")) {
    issues.push({
      code: "missing-og-description",
      severity: "warning",
      message: "Missing og:description meta tag",
      page: url,
    });
  }

  if (!getMetaContent(html, "property", "og:image")) {
    issues.push({
      code: "missing-og-image",
      severity: "warning",
      message: "Missing og:image — social shares won't show a preview image",
      page: url,
    });
  }

  // Twitter Card
  if (!getMetaContent(html, "name", "twitter:card")) {
    issues.push({
      code: "missing-twitter-card",
      severity: "nice-to-have",
      message: "Missing twitter:card meta tag",
      page: url,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// auditSite — cross-page duplicate checks
// ---------------------------------------------------------------------------

export function auditSite(pages: PageSeoData[]): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Duplicate titles
  const titleMap = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.title) continue;
    const existing = titleMap.get(p.title) ?? [];
    existing.push(p.url);
    titleMap.set(p.title, existing);
  }
  for (const [title, urls] of titleMap) {
    if (urls.length > 1) {
      issues.push({
        code: "duplicate-title",
        severity: "warning",
        message: `Duplicate title "${title}" on pages: ${urls.join(", ")}`,
        page: urls.join(", "),
      });
    }
  }

  // Duplicate descriptions
  const descMap = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.description) continue;
    const existing = descMap.get(p.description) ?? [];
    existing.push(p.url);
    descMap.set(p.description, existing);
  }
  for (const [desc, urls] of descMap) {
    if (urls.length > 1) {
      issues.push({
        code: "duplicate-description",
        severity: "warning",
        message: `Duplicate meta description on pages: ${urls.join(", ")}`,
        page: urls.join(", "),
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Schema.org type inference
// ---------------------------------------------------------------------------

const PAGE_SCHEMA_MAP: Record<string, string> = {
  "blog-post": "BlogPosting",
  "article": "Article",
  "faq": "FAQPage",
  "event": "Event",
  "product": "Product",
  "about": "AboutPage",
  "contact": "ContactPage",
  "generic": "WebPage",
};

export function inferPageSchemaType(pageType: string): string {
  return PAGE_SCHEMA_MAP[pageType] ?? "WebPage";
}

// ---------------------------------------------------------------------------
// generatePageJsonLd — produce JSON-LD for any page type
// ---------------------------------------------------------------------------

export function generatePageJsonLd(
  input: PageSchemaInput,
): Record<string, unknown> | Record<string, unknown>[] {
  const schemaType = inferPageSchemaType(input.pageType);

  const basePage: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: input.title,
    url: input.url,
    description: input.description,
  };

  // BlogPosting / Article specifics
  if (schemaType === "BlogPosting" || schemaType === "Article") {
    basePage.headline = input.title;
    if (input.datePublished) basePage.datePublished = input.datePublished;
    if (input.dateModified) basePage.dateModified = input.dateModified;
    if (input.author) {
      basePage.author = { "@type": "Person", name: input.author };
    }
    if (input.image) basePage.image = input.image;
    basePage.publisher = { "@type": "Organization", name: input.siteName };
  }

  // FAQPage specifics
  if (schemaType === "FAQPage" && input.faqItems?.length) {
    basePage.mainEntity = input.faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    }));
  }

  // BreadcrumbList for interior pages
  if (input.breadcrumbs?.length) {
    const breadcrumb: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: input.breadcrumbs.map((bc, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: bc.name,
        item: bc.url,
      })),
    };
    return [basePage, breadcrumb];
  }

  return basePage;
}

// ---------------------------------------------------------------------------
// detectFaqSections — find FAQ patterns in HTML
// ---------------------------------------------------------------------------

export function detectFaqSections(html: string): FaqItem[] {
  const faqs: FaqItem[] = [];

  // Pattern 1: details/summary
  const detailsRe =
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/details>/gi;
  let m: RegExpExecArray | null;
  while ((m = detailsRe.exec(html)) !== null) {
    faqs.push({ question: m[1].trim(), answer: m[2].trim() });
  }

  // Pattern 2: dt/dd
  if (faqs.length === 0) {
    const dlRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    while ((m = dlRe.exec(html)) !== null) {
      faqs.push({ question: m[1].trim(), answer: m[2].trim() });
    }
  }

  return faqs;
}

// ---------------------------------------------------------------------------
// validateSitemap — check sitemap completeness
// ---------------------------------------------------------------------------

export function validateSitemap(
  xml: string,
  builtPages: string[],
  siteUrl: string,
): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Extract all loc URLs from sitemap
  const locRe = /<loc>([\s\S]*?)<\/loc>/gi;
  const sitemapUrls: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = locRe.exec(xml)) !== null) {
    sitemapUrls.push(sm[1].trim());
  }

  // Normalize sitemap URLs to paths
  const normalizedBase = siteUrl.replace(/\/$/, "");
  const sitemapPaths = sitemapUrls.map((url) => {
    const path = url.replace(normalizedBase, "");
    return path === "" ? "/" : path.replace(/\/$/, "") || "/";
  });

  // Check which built pages are missing from sitemap
  const missing = builtPages.filter((p) => !sitemapPaths.includes(p));
  if (missing.length > 0) {
    issues.push({
      code: "sitemap-missing-page",
      severity: "warning",
      message: `Pages missing from sitemap: ${missing.join(", ")}`,
      page: "sitemap.xml",
    });
  }

  // Check for lastmod
  if (!xml.includes("<lastmod>")) {
    issues.push({
      code: "sitemap-no-lastmod",
      severity: "nice-to-have",
      message: "Sitemap has no lastmod dates — search engines use these to prioritize recrawling",
      page: "sitemap.xml",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// suggestSitemapConfig — changefreq/priority heuristics by page type
// ---------------------------------------------------------------------------

export function suggestSitemapConfig(
  pages: string[],
): Record<string, SitemapPageConfig> {
  const config: Record<string, SitemapPageConfig> = {};

  for (const page of pages) {
    if (page === "/") {
      config[page] = { changefreq: "daily", priority: 1.0 };
    } else if (page.startsWith("/posts/") || page.startsWith("/blog/")) {
      config[page] = { changefreq: "monthly", priority: 0.7 };
    } else {
      config[page] = { changefreq: "weekly", priority: 0.8 };
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// auditRobotsTxt — check for AI crawler blocks
// ---------------------------------------------------------------------------

const AI_CRAWLERS = [
  "ClaudeBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "GPTBot",
];

export function auditRobotsTxt(
  content: string,
  siteUrl: string,
): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Check for sitemap reference
  if (!/sitemap:/i.test(content)) {
    issues.push({
      code: "robots-no-sitemap",
      severity: "warning",
      message: "robots.txt has no Sitemap directive — add one so search engines can find your sitemap",
      page: "robots.txt",
    });
  }

  // Check if any AI crawlers are explicitly blocked
  const blockedCrawlers: string[] = [];
  for (const crawler of AI_CRAWLERS) {
    const crawlerBlock = new RegExp(
      `User-agent:\\s*${crawler}[\\s\\S]*?Disallow:\\s*/`,
      "i",
    );
    if (crawlerBlock.test(content)) {
      blockedCrawlers.push(crawler);
    }
  }

  if (blockedCrawlers.length > 0) {
    issues.push({
      code: "robots-ai-blocked",
      severity: "warning",
      message: `AI crawlers blocked in robots.txt: ${blockedCrawlers.join(", ")}. This prevents your site from appearing in AI search results.`,
      page: "robots.txt",
    });
  }

  // Warn about Cloudflare default AI bot blocking (always relevant for Anglesite)
  issues.push({
    code: "robots-cloudflare-ai-block",
    severity: "nice-to-have",
    message: "Cloudflare blocks AI bots by default. Check Cloudflare dashboard > Security > Bot Management to allow AI crawlers if you want AI search visibility.",
    page: "robots.txt",
  });

  return issues;
}

// ---------------------------------------------------------------------------
// generateLlmsTxt — markdown index for AI crawlers
// ---------------------------------------------------------------------------

export function generateLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [
    `# ${input.siteName}`,
    "",
    `> ${input.description}`,
    "",
    `Website: ${input.siteUrl}`,
    "",
    "## Pages",
    "",
  ];

  for (const page of input.pages) {
    lines.push(`- [${page.title}](${input.siteUrl}${page.url}): ${page.description}`);
  }

  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// auditChunkability — flag pages with long unbroken prose
// ---------------------------------------------------------------------------

export function auditChunkability(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Split content by headings (h1-h6) to get sections
  const sections = html.split(/<h[1-6][^>]*>/i);

  for (const section of sections) {
    // Strip HTML tags to get raw text
    const text = section.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (wordCount > 225) {
      issues.push({
        code: "poor-chunkability",
        severity: "nice-to-have",
        message: `Section has ${wordCount} words of unbroken prose. Add subheadings to break it up for better AI search visibility.`,
        page: url,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// formatSeoReport — ranked issues table as markdown
// ---------------------------------------------------------------------------

export function formatSeoReport(issues: SeoIssue[]): string {
  if (issues.length === 0) {
    return `# SEO Report\n\nNo SEO issues found. Your site looks great!\n\n_Generated ${new Date().toISOString().slice(0, 10)}_\n`;
  }

  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const niceToHave = issues.filter((i) => i.severity === "nice-to-have");

  const lines: string[] = [
    "# SEO Report",
    "",
    `_Generated ${new Date().toISOString().slice(0, 10)}_`,
    "",
  ];

  if (critical.length > 0) {
    lines.push("## Critical", "");
    lines.push("| Page | Issue |", "|---|---|");
    for (const i of critical) {
      lines.push(`| ${i.page} | ${i.message} |`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("## Warning", "");
    lines.push("| Page | Issue |", "|---|---|");
    for (const i of warnings) {
      lines.push(`| ${i.page} | ${i.message} |`);
    }
    lines.push("");
  }

  if (niceToHave.length > 0) {
    lines.push("## Nice to have", "");
    lines.push("| Page | Issue |", "|---|---|");
    for (const i of niceToHave) {
      lines.push(`| ${i.page} | ${i.message} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
