import { co2 } from "@tgwf/co2";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { readConfig } from "./config";

/// Rendered by CO2Badge.astro instead of a real value: the page's own final byte size (which
/// includes this badge's own markup) isn't knowable until after Astro has finished rendering it,
/// so the component renders this token and a post-build step (see co2Badge() below) patches the
/// real estimate into the already-written HTML.
export const CO2_PLACEHOLDER = "__ANGLESITE_CO2_PENDING__";

const estimator = new co2({ model: "1byte" });

/// UTF-8 byte size of a page — the transfer-size proxy this badge estimates from. This measures
/// the page's own rendered HTML only, not its full asset weight (CSS/JS/images) — an honest,
/// documented approximation, not a claim of total page-weight accuracy.
export function byteLength(html: string): number {
  return Buffer.byteLength(html, "utf-8");
}

/// Grams of CO2e for one page view of `bytes`, via CO2.js's byte-based model.
/// `greenHosting` lowers the estimate when the host is on a verified green-energy provider.
export function estimateGramsPerByte(bytes: number, greenHosting?: boolean): number {
  return estimator.perByte(bytes, greenHosting);
}

/// Two-decimal display string, e.g. "0.35".
export function formatGrams(grams: number): string {
  return grams.toFixed(2);
}

/// Replaces every occurrence of CO2_PLACEHOLDER in `html` with the formatted grams value.
/// A no-op when the placeholder isn't present (the integration isn't installed on this page).
export function patchHtml(html: string, grams: number): string {
  if (!html.includes(CO2_PLACEHOLDER)) return html;
  return html.split(CO2_PLACEHOLDER).join(formatGrams(grams));
}

/// The byte size the page will actually ship at once its placeholder token(s) are replaced by
/// the short formatted number — NOT `byteLength(html)` on the raw pre-patch HTML, which would
/// overcount by roughly len(CO2_PLACEHOLDER) - len(formatted) per badge instance (the placeholder
/// is 25 bytes; a formatted value is typically 4-6). Approximates the eventual replacement as
/// zero-length, undercounting by only the few digits of the final number — negligible next to a
/// typical page's size, and far closer to the truth than counting the placeholder as real content.
export function estimatedFinalByteLength(html: string): number {
  return byteLength(html.split(CO2_PLACEHOLDER).join(""));
}

/// Recursively collects every `.html` file under `dir`. Mirrors microformats.ts's walkHtml.
/// An unstattable entry (e.g. a dangling symlink) is warned and skipped — an exception here
/// would escape patchDist's per-file try/catch (the walk runs before it) and fail the build.
function walkHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out; // dir absent — not an error here
  }
  for (const name of names) {
    const full = join(dir, name);
    try {
      if (statSync(full).isDirectory()) out.push(...walkHtmlFiles(full));
      else if (extname(full) === ".html") out.push(full);
    } catch (err) {
      console.warn(`[anglesite-co2-badge] skipping unstattable entry ${full}: ${err}`);
    }
  }
  return out;
}

/// Walks `distDir` and patches every built page carrying CO2_PLACEHOLDER with a real, per-page
/// CO2 estimate. A complete no-op for sites that haven't installed the co2Badge integration (no
/// page will contain the placeholder), matching redirects()'s always-registered-but-conditionally
/// -active shape. `configPath` is forwarded to readConfig() for the green-hosting lookup — tests
/// pass an explicit path to avoid readConfig's process.cwd()-keyed module-level cache; production
/// (co2Badge()'s hook, below) omits it and gets the normal cwd-based `.site-config` lookup.
///
/// A single unreadable/unwritable file, or a `@tgwf/co2` failure, is warned and skipped rather
/// than failing the whole `astro build` — matching this template's existing astro:build:done
/// convention (see redirects.ts's try/catch-and-warn shape).
export function patchDist(distDir: string, configPath?: string): void {
  const greenHosting = readConfig("GREEN_HOST_VERIFIED", configPath) === "true";
  for (const file of walkHtmlFiles(distDir)) {
    try {
      const html = readFileSync(file, "utf-8");
      if (!html.includes(CO2_PLACEHOLDER)) continue;
      const grams = estimateGramsPerByte(estimatedFinalByteLength(html), greenHosting);
      writeFileSync(file, patchHtml(html, grams));
    } catch (err) {
      console.warn(`[anglesite-co2-badge] couldn't patch ${file}: ${err}`);
    }
  }
}

export default function co2Badge(): AstroIntegration {
  return {
    name: "anglesite-co2-badge",
    hooks: {
      "astro:build:done": ({ dir }) => {
        patchDist(fileURLToPath(dir));
      },
    },
  };
}
