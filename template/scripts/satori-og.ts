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
  /** Override font data (useful for testing without a font file on disk). */
  fontData?: Buffer;
}

/** Font data — loaded once from @fontsource/inter, cached in memory. */
let fontCache: Buffer | undefined;

/** Load Inter latin-400 woff2 from the @fontsource/inter npm package. */
export function loadFont(): Buffer {
  if (fontCache) return fontCache;
  const fontPath = _require.resolve(
    "@fontsource/inter/files/inter-latin-400-normal.woff2",
  );
  fontCache = readFileSync(fontPath);
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
  const font = fontData ?? loadFont();
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
