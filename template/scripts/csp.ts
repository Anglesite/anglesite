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
  comments?: "giscus";
  turnstile: boolean;
  /** When set, the podcast skill embeds a privacy-respecting YouTube iframe
   *  on episode pages. `.site-config` key: `PODCAST_VIDEO=youtube`. */
  podcastVideo?: "youtube";
  /** Advertising / analytics pixels installed via `/anglesite:tracking`.
   *  Each entry corresponds to a `TRACKING_*` key in `.site-config`. The
   *  pixels run inside Partytown's web worker; the loader domains still
   *  need to be permitted by the CSP and the pre-deploy script scan. */
  tracking?: TrackingPixels;
}

/** Which advertising / analytics pixels are configured. */
export interface TrackingPixels {
  /** TRACKING_META_PIXEL_ID — Facebook / Instagram Ads pixel. */
  meta: boolean;
  /** TRACKING_GA4_ID — Google Analytics 4. Shares gtag.js with Google Ads. */
  ga4: boolean;
  /** TRACKING_GOOGLE_ADS_ID — Google Ads conversion tag. Shares gtag.js with GA4. */
  googleAds: boolean;
  /** TRACKING_LINKEDIN_PARTNER_ID — LinkedIn Insight Tag. */
  linkedin: boolean;
  /** TRACKING_TIKTOK_PIXEL_ID — TikTok Pixel. */
  tiktok: boolean;
  /** TRACKING_PINTEREST_TAG_ID — Pinterest Tag. */
  pinterest: boolean;
  /** TRACKING_X_PIXEL_ID — X / Twitter Pixel. */
  x: boolean;
  /** TRACKING_CLARITY_PROJECT_ID — Microsoft Clarity (heatmaps + session
   *  recording). Unlike the ad pixels above, Clarity runs on the MAIN THREAD,
   *  not in Partytown — its session recording needs direct DOM access. The
   *  loader domain still has to be allowlisted by the CSP and pre-deploy scan. */
  clarity: boolean;
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

/** CSP directives for Giscus comments (loader script + iframe) */
export function buildGiscusCSP(): CSPDirectives {
  return {
    "script-src": ["giscus.app"],
    "frame-src": ["giscus.app"],
  };
}

/** CSP directives for the podcast YouTube embed (privacy-respecting nocookie). */
export function buildPodcastYouTubeCSP(): CSPDirectives {
  return {
    "frame-src": ["www.youtube-nocookie.com"],
  };
}

/**
 * CSP directives for the advertising / analytics pixels installed via
 * `/anglesite:tracking`. Pixels run inside Partytown's web worker, but the
 * worker still loads the platform's loader script over the network, so the
 * CSP and pre-deploy script scan must permit each loader domain. Only the
 * domains for *configured* platforms are returned — owners who only run
 * Meta and GA4 don't widen their CSP to LinkedIn or TikTok.
 */
export function buildTrackingCSP(pixels: TrackingPixels): CSPDirectives {
  const scriptSrc: string[] = [];
  const connectSrc: string[] = [];
  const imgSrc: string[] = [];

  if (pixels.meta) {
    scriptSrc.push("connect.facebook.net");
    connectSrc.push("connect.facebook.net", "www.facebook.com");
    imgSrc.push("www.facebook.com"); // 1x1 tracking pixel
  }
  if (pixels.ga4 || pixels.googleAds) {
    scriptSrc.push("www.googletagmanager.com");
    connectSrc.push(
      "www.google-analytics.com",
      "analytics.google.com",
      "stats.g.doubleclick.net",
    );
    imgSrc.push(
      "www.google-analytics.com",
      "www.googletagmanager.com",
      "www.google.com",
    );
  }
  if (pixels.linkedin) {
    scriptSrc.push("snap.licdn.com");
    connectSrc.push("px.ads.linkedin.com");
    imgSrc.push("px.ads.linkedin.com");
  }
  if (pixels.tiktok) {
    scriptSrc.push("analytics.tiktok.com");
    connectSrc.push("analytics.tiktok.com");
  }
  if (pixels.pinterest) {
    scriptSrc.push("s.pinimg.com");
    imgSrc.push("ct.pinterest.com");
  }
  if (pixels.x) {
    scriptSrc.push("static.ads-twitter.com");
    connectSrc.push("analytics.twitter.com");
    imgSrc.push("t.co", "analytics.twitter.com");
  }
  if (pixels.clarity) {
    // Microsoft Clarity loads on the main thread (not Partytown), but it still
    // pulls its tag script and beacons telemetry over the network, so both the
    // loader and the telemetry endpoint must be permitted.
    scriptSrc.push("www.clarity.ms");
    connectSrc.push("www.clarity.ms", "c.clarity.ms");
  }

  const directives: CSPDirectives = {};
  if (scriptSrc.length) directives["script-src"] = scriptSrc;
  if (connectSrc.length) directives["connect-src"] = connectSrc;
  if (imgSrc.length) directives["img-src"] = imgSrc;
  return directives;
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
  const comments = readConfigFromString(configContent, "COMMENTS_PROVIDER") as
    | SiteProviders["comments"]
    | undefined;
  const turnstileKey = readConfigFromString(configContent, "TURNSTILE_SITE_KEY");
  const podcastVideo = readConfigFromString(configContent, "PODCAST_VIDEO") as
    | SiteProviders["podcastVideo"]
    | undefined;

  const tracking: TrackingPixels = {
    meta: !!readConfigFromString(configContent, "TRACKING_META_PIXEL_ID"),
    ga4: !!readConfigFromString(configContent, "TRACKING_GA4_ID"),
    googleAds: !!readConfigFromString(configContent, "TRACKING_GOOGLE_ADS_ID"),
    linkedin: !!readConfigFromString(configContent, "TRACKING_LINKEDIN_PARTNER_ID"),
    tiktok: !!readConfigFromString(configContent, "TRACKING_TIKTOK_PIXEL_ID"),
    pinterest: !!readConfigFromString(configContent, "TRACKING_PINTEREST_TAG_ID"),
    x: !!readConfigFromString(configContent, "TRACKING_X_PIXEL_ID"),
    clarity: !!readConfigFromString(configContent, "TRACKING_CLARITY_PROJECT_ID"),
  };
  const anyTracking =
    tracking.meta ||
    tracking.ga4 ||
    tracking.googleAds ||
    tracking.linkedin ||
    tracking.tiktok ||
    tracking.pinterest ||
    tracking.x ||
    tracking.clarity;

  return {
    ecommerce,
    booking,
    comments,
    turnstile: !!turnstileKey,
    podcastVideo,
    tracking: anyTracking ? tracking : undefined,
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

  // Comments provider
  if (providers.comments === "giscus") {
    providerCSPs.push(buildGiscusCSP());
  }

  // Podcast video embed
  if (providers.podcastVideo === "youtube") {
    providerCSPs.push(buildPodcastYouTubeCSP());
  }

  // Advertising / analytics pixels (Partytown-wrapped)
  if (providers.tracking) {
    providerCSPs.push(buildTrackingCSP(providers.tracking));
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

  if (providers.comments === "giscus") {
    scripts.push("giscus.app");
  }

  if (providers.tracking) {
    if (providers.tracking.meta) {
      scripts.push("connect.facebook.net");
    }
    if (providers.tracking.ga4 || providers.tracking.googleAds) {
      scripts.push("www.googletagmanager.com");
    }
    if (providers.tracking.linkedin) {
      scripts.push("snap.licdn.com");
    }
    if (providers.tracking.tiktok) {
      scripts.push("analytics.tiktok.com");
    }
    if (providers.tracking.pinterest) {
      scripts.push("s.pinimg.com");
    }
    if (providers.tracking.x) {
      scripts.push("static.ads-twitter.com");
    }
    if (providers.tracking.clarity) {
      scripts.push("www.clarity.ms");
    }
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
