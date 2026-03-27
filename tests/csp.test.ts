import { describe, it, expect } from "vitest";
import {
  buildPolarCSP,
  buildTurnstileCSP,
  parseProviders,
  buildCSP,
  buildAllowedScripts,
  generateHeadersContent,
} from "../template/scripts/csp.js";

// ---------------------------------------------------------------------------
// buildPolarCSP
// ---------------------------------------------------------------------------

describe("buildPolarCSP", () => {
  it("includes cdn.polar.sh in script-src", () => {
    const csp = buildPolarCSP();
    expect(csp["script-src"]).toContain("cdn.polar.sh");
  });

  it("includes api.polar.sh in connect-src", () => {
    const csp = buildPolarCSP();
    expect(csp["connect-src"]).toContain("api.polar.sh");
  });

  it("includes buy.polar.sh in frame-src", () => {
    const csp = buildPolarCSP();
    expect(csp["frame-src"]).toContain("buy.polar.sh");
  });

  it("does not include style-src or img-src", () => {
    const csp = buildPolarCSP();
    expect(csp["style-src"] ?? []).toEqual([]);
    expect(csp["img-src"] ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildTurnstileCSP
// ---------------------------------------------------------------------------

describe("buildTurnstileCSP", () => {
  it("includes challenges.cloudflare.com in script-src", () => {
    const csp = buildTurnstileCSP();
    expect(csp["script-src"]).toContain("challenges.cloudflare.com");
  });

  it("includes challenges.cloudflare.com in frame-src", () => {
    const csp = buildTurnstileCSP();
    expect(csp["frame-src"]).toContain("challenges.cloudflare.com");
  });
});

// ---------------------------------------------------------------------------
// parseProviders
// ---------------------------------------------------------------------------

describe("parseProviders", () => {
  it("returns empty providers for empty config", () => {
    const p = parseProviders("");
    expect(p.ecommerce).toBeUndefined();
    expect(p.booking).toBeUndefined();
    expect(p.turnstile).toBe(false);
  });

  it("parses ECOMMERCE_PROVIDER", () => {
    expect(parseProviders("ECOMMERCE_PROVIDER=snipcart").ecommerce).toBe("snipcart");
    expect(parseProviders("ECOMMERCE_PROVIDER=shopify").ecommerce).toBe("shopify");
    expect(parseProviders("ECOMMERCE_PROVIDER=polar").ecommerce).toBe("polar");
    expect(parseProviders("ECOMMERCE_PROVIDER=stripe").ecommerce).toBe("stripe");
  });

  it("parses BOOKING_PROVIDER", () => {
    expect(parseProviders("BOOKING_PROVIDER=cal").booking).toBe("cal");
    expect(parseProviders("BOOKING_PROVIDER=calendly").booking).toBe("calendly");
  });

  it("detects TURNSTILE_SITE_KEY presence", () => {
    expect(parseProviders("TURNSTILE_SITE_KEY=0xABC123").turnstile).toBe(true);
  });

  it("parses multiple providers from multi-line config", () => {
    const config = [
      "SITE_NAME=My Shop",
      "ECOMMERCE_PROVIDER=snipcart",
      "BOOKING_PROVIDER=cal",
      "TURNSTILE_SITE_KEY=0xABC",
    ].join("\n");
    const p = parseProviders(config);
    expect(p.ecommerce).toBe("snipcart");
    expect(p.booking).toBe("cal");
    expect(p.turnstile).toBe(true);
  });

  it("treats stripe as no third-party CSP needed", () => {
    // Stripe Payment Links are external redirects, no JS loaded
    const p = parseProviders("ECOMMERCE_PROVIDER=stripe");
    expect(p.ecommerce).toBe("stripe");
  });
});

// ---------------------------------------------------------------------------
// buildCSP — base only (no providers)
// ---------------------------------------------------------------------------

describe("buildCSP", () => {
  it("includes 'self' in default-src when no providers configured", () => {
    const csp = buildCSP({ turnstile: false });
    expect(csp).toContain("default-src 'self'");
  });

  it("includes Cloudflare Analytics in base CSP", () => {
    const csp = buildCSP({ turnstile: false });
    expect(csp).toContain("static.cloudflareinsights.com");
    expect(csp).toContain("cloudflareinsights.com");
  });

  it("includes frame-ancestors 'none' and base-uri 'self'", () => {
    const csp = buildCSP({ turnstile: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("does not include provider domains when no providers set", () => {
    const csp = buildCSP({ turnstile: false });
    expect(csp).not.toContain("cdn.polar.sh");
    expect(csp).not.toContain("cdn.snipcart.com");
    expect(csp).not.toContain("cdn.shopify.com");
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(csp).not.toContain("app.cal.com");
    expect(csp).not.toContain("calendly.com");
  });
});

// ---------------------------------------------------------------------------
// buildCSP — with providers
// ---------------------------------------------------------------------------

describe("buildCSP with providers", () => {
  it("adds Snipcart domains when ecommerce=snipcart", () => {
    const csp = buildCSP({ ecommerce: "snipcart", turnstile: false });
    expect(csp).toContain("cdn.snipcart.com");
    expect(csp).toContain("app.snipcart.com");
    // Should NOT include other providers
    expect(csp).not.toContain("cdn.shopify.com");
    expect(csp).not.toContain("cdn.polar.sh");
  });

  it("adds Shopify domains when ecommerce=shopify", () => {
    const csp = buildCSP({ ecommerce: "shopify", turnstile: false });
    expect(csp).toContain("cdn.shopify.com");
    expect(csp).toContain("sdks.shopifycdn.com");
    expect(csp).toContain("*.myshopify.com");
    expect(csp).toContain("monorail-edge.shopifysvc.com");
    expect(csp).not.toContain("cdn.snipcart.com");
  });

  it("adds Polar domains when ecommerce=polar", () => {
    const csp = buildCSP({ ecommerce: "polar", turnstile: false });
    expect(csp).toContain("cdn.polar.sh");
    expect(csp).toContain("api.polar.sh");
    expect(csp).toContain("buy.polar.sh");
    expect(csp).not.toContain("cdn.snipcart.com");
  });

  it("adds no extra domains for ecommerce=stripe", () => {
    const csp = buildCSP({ ecommerce: "stripe", turnstile: false });
    // Stripe Payment Links are external redirects — no JS to allow
    expect(csp).not.toContain("cdn.polar.sh");
    expect(csp).not.toContain("cdn.snipcart.com");
    expect(csp).not.toContain("cdn.shopify.com");
  });

  it("adds Turnstile domains when turnstile=true", () => {
    const csp = buildCSP({ turnstile: true });
    expect(csp).toContain("challenges.cloudflare.com");
  });

  it("adds Cal.com domains when booking=cal", () => {
    const csp = buildCSP({ booking: "cal", turnstile: false });
    expect(csp).toContain("app.cal.com");
    expect(csp).not.toContain("calendly.com");
  });

  it("adds Calendly domains when booking=calendly", () => {
    const csp = buildCSP({ booking: "calendly", turnstile: false });
    expect(csp).toContain("assets.calendly.com");
    expect(csp).toContain("calendly.com");
    expect(csp).not.toContain("app.cal.com");
  });

  it("combines multiple providers correctly", () => {
    const csp = buildCSP({
      ecommerce: "snipcart",
      booking: "cal",
      turnstile: true,
    });
    expect(csp).toContain("cdn.snipcart.com");
    expect(csp).toContain("app.cal.com");
    expect(csp).toContain("challenges.cloudflare.com");
    // Still no Shopify or Polar
    expect(csp).not.toContain("cdn.shopify.com");
    expect(csp).not.toContain("cdn.polar.sh");
  });
});

// ---------------------------------------------------------------------------
// buildAllowedScripts
// ---------------------------------------------------------------------------

describe("buildAllowedScripts", () => {
  it("always includes cloudflareinsights and _astro", () => {
    const scripts = buildAllowedScripts({ turnstile: false });
    expect(scripts).toContain("cloudflareinsights");
    expect(scripts).toContain("_astro");
  });

  it("does not include provider scripts when no providers set", () => {
    const scripts = buildAllowedScripts({ turnstile: false });
    expect(scripts).not.toContain("cdn.polar.sh");
    expect(scripts).not.toContain("cdn.snipcart.com");
    expect(scripts).not.toContain("cdn.shopify.com");
    expect(scripts).not.toContain("sdks.shopifycdn.com");
    expect(scripts).not.toContain("challenges.cloudflare.com");
  });

  it("includes Turnstile script when turnstile=true", () => {
    const scripts = buildAllowedScripts({ turnstile: true });
    expect(scripts).toContain("challenges.cloudflare.com");
  });

  it("includes Snipcart script when ecommerce=snipcart", () => {
    const scripts = buildAllowedScripts({ ecommerce: "snipcart", turnstile: false });
    expect(scripts).toContain("cdn.snipcart.com");
  });

  it("includes Shopify scripts when ecommerce=shopify", () => {
    const scripts = buildAllowedScripts({ ecommerce: "shopify", turnstile: false });
    expect(scripts).toContain("cdn.shopify.com");
    expect(scripts).toContain("sdks.shopifycdn.com");
  });

  it("includes Polar script when ecommerce=polar", () => {
    const scripts = buildAllowedScripts({ ecommerce: "polar", turnstile: false });
    expect(scripts).toContain("cdn.polar.sh");
  });

  it("includes no extra scripts for ecommerce=stripe", () => {
    const scripts = buildAllowedScripts({ ecommerce: "stripe", turnstile: false });
    expect(scripts).toEqual(["cloudflareinsights", "_astro"]);
  });

  it("includes booking provider scripts", () => {
    const cal = buildAllowedScripts({ booking: "cal", turnstile: false });
    expect(cal).toContain("app.cal.com");

    const calendly = buildAllowedScripts({ booking: "calendly", turnstile: false });
    expect(calendly).toContain("assets.calendly.com");
  });

  it("combines all provider scripts", () => {
    const scripts = buildAllowedScripts({
      ecommerce: "snipcart",
      booking: "cal",
      turnstile: true,
    });
    expect(scripts).toContain("cloudflareinsights");
    expect(scripts).toContain("_astro");
    expect(scripts).toContain("challenges.cloudflare.com");
    expect(scripts).toContain("cdn.snipcart.com");
    expect(scripts).toContain("app.cal.com");
  });
});

// ---------------------------------------------------------------------------
// generateHeadersContent
// ---------------------------------------------------------------------------

describe("generateHeadersContent", () => {
  it("produces valid _headers format with /* path", () => {
    const content = generateHeadersContent({ turnstile: false });
    expect(content).toContain("/*");
    expect(content).toContain("X-Frame-Options: DENY");
    expect(content).toContain("X-Content-Type-Options: nosniff");
  });

  it("includes immutable cache for _astro assets", () => {
    const content = generateHeadersContent({ turnstile: false });
    expect(content).toContain("/_astro/*");
    expect(content).toContain("max-age=31536000, immutable");
  });

  it("uses minimal CSP when no providers configured", () => {
    const content = generateHeadersContent({ turnstile: false });
    expect(content).not.toContain("cdn.snipcart.com");
    expect(content).not.toContain("cdn.shopify.com");
    expect(content).not.toContain("cdn.polar.sh");
    expect(content).not.toContain("challenges.cloudflare.com");
  });

  it("includes provider CSP when providers are configured", () => {
    const content = generateHeadersContent({
      ecommerce: "snipcart",
      turnstile: true,
    });
    expect(content).toContain("cdn.snipcart.com");
    expect(content).toContain("challenges.cloudflare.com");
    expect(content).not.toContain("cdn.shopify.com");
  });
});
