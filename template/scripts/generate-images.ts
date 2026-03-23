/**
 * Generate apple-touch-icon.png (180x180) and og-image.png (1200x630)
 * from the site name and brand colors.
 *
 * Reads:
 *   - .site-config for SITE_NAME
 *   - src/styles/global.css for --color-primary and --color-bg
 *   - public/favicon.svg as icon source
 *
 * Run: npm run ai-images
 */

import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "./config.js";

export function readCssVar(css: string, name: string): string | undefined {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const publicDir = resolve("public");
  const cssPath = resolve("src/styles/global.css");

  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const primaryColor = readCssVar(css, "--color-primary") || "#2563eb";
  const bgColor = readCssVar(css, "--color-bg") || "#ffffff";
  const siteName = readConfig("SITE_NAME") || "My Website";

  // --- Apple Touch Icon (180x180) ---
  const faviconPath = resolve(publicDir, "favicon.svg");
  if (existsSync(faviconPath)) {
    const faviconSvg = readFileSync(faviconPath, "utf8");
    // Wrap the favicon SVG in a 180x180 canvas with brand background
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" rx="36" fill="${primaryColor}" />
      <svg x="42" y="42" width="96" height="96" viewBox="0 0 32 32">
        ${faviconSvg.replace(/<\?xml[^?]*\?>/, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "")}
      </svg>
    </svg>`;
    await sharp(Buffer.from(iconSvg)).resize(180, 180).png().toFile(resolve(publicDir, "apple-touch-icon.png"));
    console.log("Generated apple-touch-icon.png (180x180)");
  } else {
    console.warn("No favicon.svg found — skipping apple-touch-icon generation");
  }

  // --- OG Image (1200x630) ---
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="${primaryColor}" />
    <text x="600" y="340" text-anchor="middle" dominant-baseline="central"
          font-family="system-ui, -apple-system, sans-serif"
          font-size="72" font-weight="700" fill="${bgColor}">
      ${escapeXml(siteName)}
    </text>
  </svg>`;
  await sharp(Buffer.from(ogSvg)).png().toFile(resolve(publicDir, "og-image.png"));
  console.log("Generated og-image.png (1200x630)");
}

// Only run when executed directly
if (process.argv[1]?.endsWith("generate-images.ts")) {
  main().catch((err) => {
    console.error("Image generation failed:", err.message);
    process.exit(1);
  });
}
