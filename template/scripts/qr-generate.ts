/**
 * QR code generation + UTM parameter utilities.
 *
 * Enforces UTM best practices automatically:
 * - All values lowercased
 * - Spaces replaced with dashes
 * - Platform names stripped of .com
 * - Medium validated against standard channel types
 * - Redundancy between params flagged
 *
 * Used by the /anglesite:qr skill and available for ad agency handoffs.
 *
 * Run: npm run ai-qr
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
}

export interface QrEntry {
  file: string;
  url: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Valid medium values (aligned with GA4 default channel groupings)
// ---------------------------------------------------------------------------

export const VALID_MEDIUMS = [
  "print",
  "email",
  "paid-social",
  "organic-social",
  "cpc",
  "display",
  "referral",
  "affiliate",
  "video",
  "audio",
  "sms",
  "push",
  "qr",
] as const;

// ---------------------------------------------------------------------------
// UTM value sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a UTM parameter value following best practices:
 * - Lowercase
 * - Spaces → dashes
 * - Strip .com/.org/.net suffixes
 * - Remove special characters (keep alphanumeric, dashes, underscores)
 * - Collapse multiple dashes
 * - Trim leading/trailing dashes
 */
export function sanitizeUtmValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(?:com|org|net|io|co)$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// UTM validation
// ---------------------------------------------------------------------------

/**
 * Validate UTM params against best practices.
 * Returns an array of warning/error strings (empty = valid).
 */
export function validateUtmParams(params: UtmParams): string[] {
  const errors: string[] = [];

  if (!params.source) errors.push("utm_source is required (e.g., facebook, newsletter, qr).");
  if (!params.medium) errors.push("utm_medium is required (e.g., email, paid-social, print).");
  if (!params.campaign) errors.push("utm_campaign is required (e.g., spring-sale-2026).");

  if (params.medium && !VALID_MEDIUMS.includes(params.medium as any)) {
    const sanitized = sanitizeUtmValue(params.medium);
    if (!VALID_MEDIUMS.includes(sanitized as any)) {
      errors.push(
        `utm_medium "${params.medium}" is not a standard channel type. ` +
        `Use one of: ${VALID_MEDIUMS.join(", ")}. ` +
        `The medium describes the channel (email, print), not the platform (mailchimp, facebook).`,
      );
    }
  }

  if (
    params.source &&
    params.medium &&
    sanitizeUtmValue(params.source) === sanitizeUtmValue(params.medium)
  ) {
    errors.push(
      `Redundant: utm_source and utm_medium are both "${params.source}". ` +
      `Source identifies the platform, medium identifies the channel type.`,
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * Append UTM parameters to a URL. Auto-sanitizes all values.
 */
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  const url = new URL(baseUrl);

  url.searchParams.set("utm_source", sanitizeUtmValue(params.source));
  url.searchParams.set("utm_medium", sanitizeUtmValue(params.medium));
  url.searchParams.set("utm_campaign", sanitizeUtmValue(params.campaign));

  if (params.term) {
    url.searchParams.set("utm_term", sanitizeUtmValue(params.term));
  }
  if (params.content) {
    url.searchParams.set("utm_content", sanitizeUtmValue(params.content));
  }

  return url.toString();
}

/**
 * Build a QR-specific URL with print UTM params.
 */
export function buildQrUrl(baseUrl: string, label?: string): string {
  return buildUtmUrl(baseUrl, {
    source: "qr",
    medium: "print",
    campaign: label ? sanitizeUtmValue(label) : "website",
  });
}

/**
 * Generate a Cloudflare Pages _redirects line.
 * Format: /slug /target?utm_params 301
 */
export function buildRedirectLine(
  slug: string,
  targetPath: string,
  utmParams?: UtmParams,
): string {
  if (!utmParams) {
    return `${slug} ${targetPath} 301`;
  }

  // Build query string from UTM params
  const qs = new URLSearchParams();
  qs.set("utm_source", sanitizeUtmValue(utmParams.source));
  qs.set("utm_medium", sanitizeUtmValue(utmParams.medium));
  qs.set("utm_campaign", sanitizeUtmValue(utmParams.campaign));
  if (utmParams.term) qs.set("utm_term", sanitizeUtmValue(utmParams.term));
  if (utmParams.content) qs.set("utm_content", sanitizeUtmValue(utmParams.content));

  return `${slug} ${targetPath}?${qs.toString()} 301`;
}

// ---------------------------------------------------------------------------
// UTM parsing and description
// ---------------------------------------------------------------------------

/**
 * Extract UTM parameters from a URL string.
 */
export function parseUtmParams(url: string): UtmParams {
  const parsed = new URL(url);
  return {
    source: parsed.searchParams.get("utm_source") || "",
    medium: parsed.searchParams.get("utm_medium") || "",
    campaign: parsed.searchParams.get("utm_campaign") || "",
    term: parsed.searchParams.get("utm_term") || undefined,
    content: parsed.searchParams.get("utm_content") || undefined,
  };
}

/**
 * Generate a plain-language description of a UTM source.
 */
export function describeUtmSource(params: UtmParams): string {
  const source = params.source;
  const medium = params.medium;
  const campaign = params.campaign;

  if (medium === "print" && source === "qr") {
    return `visitors who scanned your "${campaign}" QR code`;
  }

  if (medium === "email") {
    return `visitors from your "${campaign}" email via ${source}`;
  }

  if (medium === "paid-social") {
    return `visitors from your "${campaign}" ad on ${source}`;
  }

  if (medium === "cpc") {
    return `visitors from your "${campaign}" search ad on ${source}`;
  }

  if (medium === "organic-social") {
    return `visitors from your "${campaign}" post on ${source}`;
  }

  if (medium === "referral") {
    return `visitors referred by ${source} (${campaign})`;
  }

  return `visitors from ${source} via ${medium} (${campaign})`;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Format a summary of generated QR codes.
 */
export function formatQrReport(entries: QrEntry[]): string {
  if (entries.length === 0) {
    return "No QR codes generated.";
  }

  const count = entries.length;
  const lines = entries.map((e) => `  - ${e.file} → ${e.url}`);
  return (
    `Generated ${count} QR code${count !== 1 ? "s" : ""} in public/images/qr/:\n` +
    lines.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Main script (only runs when executed directly)
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("qr-generate.ts")) {
  (async () => {
    const QRCode = (await import("qrcode")).default;
    const { readFileSync } = await import("node:fs");
    const { writeFileSync } = await import("node:fs");
    const { readConfig } = await import("./config.js");

    const siteDomain = readConfig("SITE_DOMAIN");
    if (!siteDomain) {
      console.error("SITE_DOMAIN not set in .site-config. Run /anglesite:deploy first.");
      process.exit(1);
    }

    const siteUrl = `https://${siteDomain}`;
    const outDir = resolve("public/images/qr");
    mkdirSync(outDir, { recursive: true });

    // Read primary color for branding
    const cssPath = resolve("src/styles/global.css");
    let primaryColor = "#2563eb";
    if (existsSync(cssPath)) {
      const css = readFileSync(cssPath, "utf-8");
      const match = css.match(/--color-primary:\s*([^;]+);/);
      if (match) primaryColor = match[1].trim();
    }

    // Generate homepage QR
    const homepageUrl = buildQrUrl(siteUrl, "homepage");
    const svg = await QRCode.toString(homepageUrl, {
      type: "svg",
      color: { dark: primaryColor, light: "#ffffff" },
      margin: 2,
    });

    const outPath = resolve(outDir, "homepage.svg");
    writeFileSync(outPath, svg);

    console.log(formatQrReport([{ file: "homepage.svg", url: homepageUrl, label: "homepage" }]));
  })().catch((err) => {
    console.error("QR generation failed:", err.message);
    process.exit(1);
  });
}
