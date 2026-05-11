/**
 * Satori-based OG image renderer.
 *
 * Converts template element trees → SVG (via Satori) → PNG (via resvg).
 * Requires `satori` and `@resvg/resvg-js` as devDependencies.
 *
 * Run: npm run ai-og
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  textOnlyTemplate,
  textLogoTemplate,
  OG_WIDTH,
  OG_HEIGHT,
  type OgColors,
} from "./og-templates.js";

const _require = createRequire(import.meta.url);

export interface RenderOgOptions {
  title: string;
  siteName: string;
  colors: OgColors;
  template: "text-only" | "text-logo";
  logoSvg?: string;
  /**
   * Override font data (useful for testing without a font file on disk).
   * Must be TTF, OTF, or WOFF — Satori does not support WOFF2.
   */
  fontData?: Buffer;
}

/** TTF font data, decompressed from @fontsource/inter's WOFF2 once and cached. */
let fontCache: Buffer | undefined;

/**
 * Load Inter latin-400 as TTF for Satori.
 *
 * Satori only accepts TTF, OTF, or WOFF — not WOFF2 — so we decompress the
 * @fontsource/inter WOFF2 file in-process via wawoff2. WOFF2 → TTF is the only
 * direction this conversion needs to run; the original file stays untouched.
 */
export async function loadFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const fontPath = _require.resolve(
    "@fontsource/inter/files/inter-latin-400-normal.woff2",
  );
  const woff2 = readFileSync(fontPath);
  const { default: wawoff } = await import("wawoff2");
  const ttf = await wawoff.decompress(woff2);
  fontCache = Buffer.from(ttf);
  return fontCache;
}

/**
 * Render an OG image to a PNG Buffer.
 */
export async function renderOgImage(options: RenderOgOptions): Promise<Buffer> {
  const { title, siteName, colors, template, logoSvg, fontData } = options;

  // Build the element tree from the chosen template
  const element =
    template === "text-logo"
      ? textLogoTemplate(title, siteName, colors, logoSvg ?? "")
      : textOnlyTemplate(title, siteName, colors);

  // Render to SVG via Satori
  const font = fontData ?? (await loadFont());
  const svg = await satori(element as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      {
        name: "Inter",
        data: font,
        weight: 400,
        style: "normal" as const,
      },
    ],
  });

  // Rasterize SVG → PNG via resvg
  const resvg = new Resvg(svg);
  const pngData = resvg.render().asPng();
  return Buffer.from(pngData);
}
