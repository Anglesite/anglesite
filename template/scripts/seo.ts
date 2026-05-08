/**
 * SEO audit and generation utilities.
 *
 * - auditPage: check a single HTML page for SEO issues
 * - auditSite: cross-page checks (duplicate titles/descriptions)
 * - validateSitemap: check sitemap completeness against built pages
 * - auditRobotsTxt: check robots.txt for alignment with AGENTIC_CRAWLERS policy
 * - generateRobotsTxt: render robots.txt content for the AGENTIC_CRAWLERS policy
 * - generateLlmsTxt: generate /llms.txt for AI crawlers (skipped when blocked)
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

/**
 * Owner's stance toward agentic crawlers, mirroring the `AGENTIC_CRAWLERS`
 * key in `.site-config`. Used as the single source of truth for the deploy
 * gate (a14y), `llms.txt` generation, and `robots.txt` content/audit.
 */
export type AgenticCrawlersPolicy = "allow" | "block";

/**
 * Centralized list of agentic crawler user-agents Anglesite manages in
 * `robots.txt` and that drive the `auditRobotsTxt` alignment check. Add new
 * agents here — `generateRobotsTxt`, `auditRobotsTxt`, and any future surface
 * that needs to enumerate "agentic crawlers" pull from this single source.
 */
export const AGENTIC_CRAWLER_BOTS: readonly string[] = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "PerplexityBot",
  "Bytespider",
];

export interface LlmsTxtInput {
  siteName: string;
  siteUrl: string;
  description: string;
  pages: PageSeoData[];
  /** Owner's agentic-crawler stance. Defaults to `"allow"` when omitted. */
  agenticCrawlers?: AgenticCrawlersPolicy;
}

export interface RobotsTxtInput {
  /** Absolute URL of the sitemap (e.g. `https://example.com/sitemap-index.xml`). Optional. */
  sitemapUrl?: string;
  /** Owner's agentic-crawler stance. Defaults to `"allow"` when omitted. */
  agenticCrawlers?: AgenticCrawlersPolicy;
  /** Extra paths to disallow under `User-agent: *` (e.g. `["/keystatic/"]`). */
  disallowPaths?: string[];
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
  // Each capture is anchored to the same quote that opened it, so a value
  // like `What's new` (with a stray apostrophe inside a double-quoted attr)
  // isn't truncated at the first inner quote.
  const attrPart = `${attr}=(?:"${value}"|'${value}')`;
  const contentPart = `content=(?:"([^"]*)"|'([^']*)')`;
  const re = new RegExp(
    `<meta\\s+[^>]*${attrPart}[^>]*${contentPart}[^>]*/?>|<meta\\s+[^>]*${contentPart}[^>]*${attrPart}[^>]*/?>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3] ?? m[4];
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

/**
 * Detect whether a page opts out of search indexing via `<meta name="robots">`
 * (or `googlebot`). Pages with `noindex` won't appear in search results, so
 * the SEO checks aren't actionable for them.
 */
function isNoindex(html: string): boolean {
  const robots = getMetaContent(html, "name", "robots");
  if (robots && /\bnoindex\b/i.test(robots)) return true;
  const googlebot = getMetaContent(html, "name", "googlebot");
  if (googlebot && /\bnoindex\b/i.test(googlebot)) return true;
  return false;
}

export function auditPage(html: string, url: string): SeoIssue[] {
  // Pages explicitly marked noindex (e.g. KioskLayout) won't be indexed by
  // search engines, so warning about missing meta/og tags isn't actionable.
  if (isNoindex(html)) return [];

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

  // Normalize sitemap URLs to paths (strip trailing slash so `/about/` and
  // `/about` compare equal). We apply the same rule to `builtPages` because
  // Astro's default `trailingSlash: 'ignore'` produces directory-style URLs.
  const normalizedBase = siteUrl.replace(/\/$/, "");
  const normalizePath = (p: string): string => {
    if (p === "" || p === "/") return "/";
    return p.replace(/\/$/, "") || "/";
  };
  const sitemapPaths = sitemapUrls.map((url) =>
    normalizePath(url.replace(normalizedBase, "")),
  );
  const normalizedBuiltPages = builtPages.map(normalizePath);

  // Check which built pages are missing from sitemap
  const missing = normalizedBuiltPages.filter(
    (p) => !sitemapPaths.includes(p),
  );
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
// auditRobotsTxt — check robots.txt against the AGENTIC_CRAWLERS policy
// ---------------------------------------------------------------------------

/**
 * Audit `robots.txt` against the owner's agentic-crawler policy.
 *
 * When `agenticCrawlers` is `"allow"` (default), warns if any centralized
 * agentic crawler is blocked — that drift means the site won't appear in AI
 * search results despite the owner's stated stance.
 *
 * When `agenticCrawlers` is `"block"`, warns if any centralized agentic
 * crawler is *not* blocked — the owner has declared agents shouldn't read the
 * site, so `robots.txt` should reflect that.
 */
export function auditRobotsTxt(
  content: string,
  siteUrl: string,
  agenticCrawlers: AgenticCrawlersPolicy = "allow",
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

  // Detect which centralized agentic crawlers are explicitly disallowed.
  const blockedCrawlers: string[] = [];
  for (const crawler of AGENTIC_CRAWLER_BOTS) {
    const crawlerBlock = new RegExp(
      `User-agent:\\s*${crawler}[\\s\\S]*?Disallow:\\s*/`,
      "i",
    );
    if (crawlerBlock.test(content)) {
      blockedCrawlers.push(crawler);
    }
  }

  if (agenticCrawlers === "allow") {
    if (blockedCrawlers.length > 0) {
      issues.push({
        code: "robots-ai-blocked",
        severity: "warning",
        message: `AGENTIC_CRAWLERS=allow but robots.txt blocks: ${blockedCrawlers.join(", ")}. Remove these Disallow rules so AI crawlers can index the site, or set AGENTIC_CRAWLERS=block to align the two.`,
        page: "robots.txt",
      });
    }

    // Cloudflare bot management is orthogonal to robots.txt and applies even
    // when AGENTIC_CRAWLERS=allow. Keep the reminder so owners know the dashboard
    // toggle still has to be on.
    issues.push({
      code: "robots-cloudflare-ai-block",
      severity: "nice-to-have",
      message: "Cloudflare blocks AI bots by default. Check Cloudflare dashboard > Security > Bot Management to allow AI crawlers if you want AI search visibility.",
      page: "robots.txt",
    });
  } else {
    const missing = AGENTIC_CRAWLER_BOTS.filter(
      (c) => !blockedCrawlers.includes(c),
    );
    if (missing.length > 0) {
      issues.push({
        code: "robots-ai-not-blocked",
        severity: "warning",
        message: `AGENTIC_CRAWLERS=block but robots.txt doesn't disallow: ${missing.join(", ")}. Regenerate robots.txt with generateRobotsTxt() so it reflects the owner's choice.`,
        page: "robots.txt",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// generateRobotsTxt — render robots.txt for the AGENTIC_CRAWLERS policy
// ---------------------------------------------------------------------------

/**
 * Render `robots.txt` content reflecting the owner's `AGENTIC_CRAWLERS` policy.
 *
 * When `agenticCrawlers` is `"block"`, every user-agent in
 * `AGENTIC_CRAWLER_BOTS` gets its own `User-agent` / `Disallow: /` block
 * before the catch-all `User-agent: *` rule.
 *
 * The default catch-all is `User-agent: *` + `Allow: /`, plus any
 * `disallowPaths` (e.g. `/keystatic/`). A `Sitemap:` directive is appended
 * when `sitemapUrl` is provided.
 */
export function generateRobotsTxt(input: RobotsTxtInput): string {
  const lines: string[] = [];

  if (input.agenticCrawlers === "block") {
    for (const bot of AGENTIC_CRAWLER_BOTS) {
      lines.push(`User-agent: ${bot}`);
      lines.push("Disallow: /");
      lines.push("");
    }
  }

  lines.push("User-agent: *");
  lines.push("Allow: /");
  for (const path of input.disallowPaths ?? []) {
    lines.push(`Disallow: ${path}`);
  }

  if (input.sitemapUrl) {
    lines.push("");
    lines.push(`Sitemap: ${input.sitemapUrl}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// generateLlmsTxt — markdown index for AI crawlers
// ---------------------------------------------------------------------------

/**
 * Generate an `llms.txt` markdown index for AI crawlers.
 *
 * Returns `null` when the owner has set `AGENTIC_CRAWLERS=block` — publishing
 * an AI-readable index of the site would directly contradict that stance.
 * Callers should treat `null` as "do not write the file" (and remove any
 * existing `dist/llms.txt` if cleaning up).
 */
export function generateLlmsTxt(input: LlmsTxtInput): string | null {
  if (input.agenticCrawlers === "block") return null;

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

  // Scope to <main> if present, otherwise <article>, otherwise the full page
  // with global chrome (header/footer/nav/aside) stripped out — those would
  // otherwise lump into the trailing chunk after the last heading and falsely
  // inflate word counts.
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const scope = mainMatch
    ? mainMatch[1]
    : articleMatch
    ? articleMatch[1]
    : html
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  // Split content by headings (h1-h6) to get sections
  const sections = scope.split(/<h[1-6][^>]*>/i);

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
