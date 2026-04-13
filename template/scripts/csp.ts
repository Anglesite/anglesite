/**
 * Central CSP builder — generates Content-Security-Policy headers and
 * pre-deploy script allowlists based on active site providers.
 *
 * Reads ECOMMERCE_PROVIDER, BOOKING_PROVIDER, and TURNSTILE_SITE_KEY
 * from .site-config to determine which third-party domains to permit.
 *
 * @module
 */

import { buildSnipcartCSP } from "./snipcart.js";
import { buildShopifyCSP } from "./shopify-buy-button.js";
import { buildPaddleCSP } from "./paddle.js";
import { buildLemonSqueezyCSP } from "./lemon-squeezy.js";
import { buildBookingCSP, type BookingProvider } from "./booking.js";
import { readConfigFromString } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed provider configuration from .site-config */
export interface SiteProviders {
  ecommerce?: "stripe" | "polar" | "snipcart" | "shopify" | "paddle" | "lemonsqueezy";
  booking?: BookingProvider;
  turnstile: boolean;
}

/** CSP directives as arrays of domains per directive */
interface CSPDirectives {
  "script-src"?: string[];
  "style-src"?: string[];
  "img-src"?: string[];
  "connect-src"?: string[];
  "frame-src"?: string[];
}

// ---------------------------------------------------------------------------
// Provider-specific CSP builders
// ---------------------------------------------------------------------------

/** CSP directives for Polar checkout overlay */
export function buildPolarCSP(): CSPDirectives {
  return {
    "script-src": ["cdn.polar.sh"],
    "connect-src": ["api.polar.sh"],
    "frame-src": ["buy.polar.sh"],
  };
}

/** CSP directives for Cloudflare Turnstile */
export function buildTurnstileCSP(): CSPDirectives {
  return {
    "script-src": ["challenges.cloudflare.com"],
    "frame-src": ["challenges.cloudflare.com"],
  };
}

// ---------------------------------------------------------------------------
// Config parser
// ---------------------------------------------------------------------------

/** Parse .site-config content into a SiteProviders object */
export function parseProviders(configContent: string): SiteProviders {
  const ecommerce = readConfigFromString(configContent, "ECOMMERCE_PROVIDER") as
    | SiteProviders["ecommerce"]
    | undefined;
  const booking = readConfigFromString(configContent, "BOOKING_PROVIDER") as
    | BookingProvider
    | undefined;
  const turnstileKey = readConfigFromString(configContent, "TURNSTILE_SITE_KEY");

  return {
    ecommerce,
    booking,
    turnstile: !!turnstileKey,
  };
}

// ---------------------------------------------------------------------------
// CSP builder
// ---------------------------------------------------------------------------

/** Merge multiple CSP directive objects into one */
function mergeDirectives(...sources: CSPDirectives[]): CSPDirectives {
  const merged: CSPDirectives = {};
  for (const src of sources) {
    for (const [key, domains] of Object.entries(src)) {
      const k = key as keyof CSPDirectives;
      if (!merged[k]) merged[k] = [];
      merged[k]!.push(...(domains as string[]));
    }
  }
  return merged;
}

/**
 * Build a full CSP header string from active providers.
 *
 * Base policy always includes 'self' and Cloudflare Analytics.
 * Provider domains are added only when that provider is configured.
 */
export function buildCSP(providers: SiteProviders): string {
  const providerCSPs: CSPDirectives[] = [];

  // Ecommerce provider
  if (providers.ecommerce === "snipcart") {
    providerCSPs.push(buildSnipcartCSP());
  } else if (providers.ecommerce === "shopify") {
    providerCSPs.push(buildShopifyCSP());
  } else if (providers.ecommerce === "polar") {
    providerCSPs.push(buildPolarCSP());
  } else if (providers.ecommerce === "paddle") {
    providerCSPs.push(buildPaddleCSP());
  } else if (providers.ecommerce === "lemonsqueezy") {
    providerCSPs.push(buildLemonSqueezyCSP());
  }
  // stripe = external redirect, no CSP needed

  // Booking provider
  if (providers.booking) {
    providerCSPs.push(buildBookingCSP(providers.booking));
  }

  // Turnstile
  if (providers.turnstile) {
    providerCSPs.push(buildTurnstileCSP());
  }

  const extra = mergeDirectives(...providerCSPs);

  const scriptSrc = ["'self'", "static.cloudflareinsights.com", ...(extra["script-src"] ?? [])];
  const styleSrc = ["'self'", "'unsafe-inline'", ...(extra["style-src"] ?? [])];
  const imgSrc = ["'self'", "data:", ...(extra["img-src"] ?? [])];
  const connectSrc = ["'self'", "cloudflareinsights.com", ...(extra["connect-src"] ?? [])];
  const frameSrc = extra["frame-src"] ?? [];

  const parts = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(" ")}`,
  ];

  if (frameSrc.length > 0) {
    parts.push(`frame-src ${frameSrc.join(" ")}`);
  }

  parts.push(`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`);

  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Allowed scripts builder (for pre-deploy check)
// ---------------------------------------------------------------------------

/**
 * Build the list of allowed script domains for the pre-deploy third-party
 * script scan, based on active providers.
 */
export function buildAllowedScripts(providers: SiteProviders): string[] {
  const scripts = ["cloudflareinsights", "_astro"];

  if (providers.turnstile) {
    scripts.push("challenges.cloudflare.com");
  }

  if (providers.ecommerce === "snipcart") {
    scripts.push("cdn.snipcart.com");
  } else if (providers.ecommerce === "shopify") {
    scripts.push("cdn.shopify.com", "sdks.shopifycdn.com");
  } else if (providers.ecommerce === "polar") {
    scripts.push("cdn.polar.sh");
  } else if (providers.ecommerce === "paddle") {
    scripts.push("cdn.paddle.com", "sandbox-cdn.paddle.com");
  } else if (providers.ecommerce === "lemonsqueezy") {
    scripts.push("assets.lemonsqueezy.com");
  }

  if (providers.booking === "cal") {
    scripts.push("app.cal.com");
  } else if (providers.booking === "calendly") {
    scripts.push("assets.calendly.com");
  }

  return scripts;
}

// ---------------------------------------------------------------------------
// Full _headers file generator
// ---------------------------------------------------------------------------

/** Generate the complete content for public/_headers */
export function generateHeadersContent(providers: SiteProviders): string {
  const csp = buildCSP(providers);

  return `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Content-Security-Policy: ${csp}
  Cache-Control: public, max-age=0, must-revalidate

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
