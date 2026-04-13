/**
 * Generate per-page OG images using Satori.
 *
 * Scans content collections and static pages, generates branded OG images
 * for any page that lacks a custom og:image in frontmatter.
 *
 * Reads:
 *   - .site-config for SITE_NAME
 *   - src/styles/global.css for brand colors
 *   - public/favicon.svg as logo source
 *   - src/content/ and src/pages/ for page discovery
 *
 * Run: npm run ai-og
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { globSync } from "node:fs";
import { readConfig } from "./config.js";
import { readCssVar } from "./generate-images.js";
import { renderOgImage } from "./satori-og.js";

// ---------------------------------------------------------------------------
// Exported helpers (tested independently)
// ---------------------------------------------------------------------------

export interface PageInfo {
  title: string;
  slug: string;
  image?: string;
  draft?: boolean;
}

/** Map a page slug to its OG image output path (relative to public/). */
export function slugToOgPath(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  const filename = clean || "index";
  return `images/og/${filename}.png`;
}

/** Determine whether a page needs a generated OG image. */
export function needsOgImage(page: PageInfo): boolean {
  if (page.draft) return false;
  if (page.image && page.image.length > 0) return false;
  return true;
}

/** Parse YAML frontmatter from Astro/MDX/Markdoc content. */
export function parsePageFrontmatter(
  content: string,
): { title: string; image?: string; draft?: boolean } | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;

  const yaml = match[1];
  const title = yaml.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (!title) return undefined;

  const image = yaml.match(/^image:\s*(.+)$/m)?.[1]?.trim();
  const draftMatch = yaml.match(/^draft:\s*(.+)$/m)?.[1]?.trim();
  const draft = draftMatch === "true";

  return { title, image: image || undefined, draft };
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly
// ---------------------------------------------------------------------------

async function main() {
  const publicDir = resolve("public");
  const cssPath = resolve("src/styles/global.css");

  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const primary = readCssVar(css, "--color-primary") || "#2563eb";
  const bg = readCssVar(css, "--color-bg") || "#ffffff";
  const text = readCssVar(css, "--color-text") || "#1a1a1a";
  const siteName = readConfig("SITE_NAME") || "My Website";
  const colors = { primary, bg, text };

  // Load logo if available
  const faviconPath = resolve(publicDir, "favicon.svg");
  const logoSvg = existsSync(faviconPath)
    ? readFileSync(faviconPath, "utf8")
    : "";
  const template = logoSvg ? "text-logo" : "text-only";

  // Load font
  const fontPath = resolve(
    import.meta.dirname ?? ".",
    "fonts",
    "Inter-Regular.woff",
  );
  const fontData = existsSync(fontPath)
    ? readFileSync(fontPath)
    : undefined;

  // Discover pages from content collections
  const pages: PageInfo[] = [];
  const contentDir = resolve("src/content");
  if (existsSync(contentDir)) {
    for (const collection of ["posts", "services", "events"]) {
      const collDir = resolve(contentDir, collection);
      if (!existsSync(collDir)) continue;

      const files = globSync("**/*.{mdx,mdoc,md}", { cwd: collDir });
      for (const file of files) {
        const content = readFileSync(resolve(collDir, file), "utf8");
        const fm = parsePageFrontmatter(content);
        if (!fm) continue;

        const slug =
          collection === "posts"
            ? `blog/${file.replace(/\.(mdx?|mdoc)$/, "")}`
            : `${collection}/${file.replace(/\.(mdx?|mdoc)$/, "")}`;

        pages.push({ title: fm.title, slug, image: fm.image, draft: fm.draft });
      }
    }
  }

  // Discover static pages
  const pagesDir = resolve("src/pages");
  if (existsSync(pagesDir)) {
    const astroFiles = globSync("**/*.astro", { cwd: pagesDir });
    for (const file of astroFiles) {
      // Skip dynamic routes and special pages
      if (file.includes("[") || file === "404.astro" || file === "rss.xml.ts")
        continue;

      const content = readFileSync(resolve(pagesDir, file), "utf8");
      // Static .astro files may have title in frontmatter or as a prop
      const titleMatch = content.match(/title[=:]\s*["']([^"']+)["']/);
      if (!titleMatch) continue;

      const slug = file.replace(/\.astro$/, "").replace(/\/index$/, "");
      pages.push({ title: titleMatch[1], slug });
    }
  }

  // Generate OG images
  const toGenerate = pages.filter(needsOgImage);
  let generated = 0;

  for (const page of toGenerate) {
    const ogPath = slugToOgPath(page.slug);
    const fullPath = resolve(publicDir, ogPath);
    const dir = resolve(fullPath, "..");

    mkdirSync(dir, { recursive: true });

    const png = await renderOgImage({
      title: page.title,
      siteName,
      colors,
      template: template as "text-only" | "text-logo",
      logoSvg,
      fontData,
    });

    writeFileSync(fullPath, png);
    generated++;
    console.log(`Generated ${ogPath} — "${page.title}"`);
  }

  console.log(
    `\nDone: ${generated} OG image${generated === 1 ? "" : "s"} generated.`,
  );
}

if (process.argv[1]?.endsWith("generate-og-pages.ts")) {
  main().catch((err) => {
    console.error("OG image generation failed:", err.message);
    process.exit(1);
  });
}
