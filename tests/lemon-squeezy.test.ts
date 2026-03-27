import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseLemonSqueezyConfig,
  buildLemonSqueezyCSP,
} from "../template/scripts/lemon-squeezy.js";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// parseLemonSqueezyConfig
// ---------------------------------------------------------------------------

describe("parseLemonSqueezyConfig", () => {
  it("extracts store slug and product ID", () => {
    const result = parseLemonSqueezyConfig("my-store", "my-product");
    expect(result).toEqual({
      storeSlug: "my-store",
      productSlug: "my-product",
    });
  });

  it("trims whitespace from inputs", () => {
    const result = parseLemonSqueezyConfig("  my-store  ", "  my-product  ");
    expect(result!.storeSlug).toBe("my-store");
    expect(result!.productSlug).toBe("my-product");
  });

  it("returns null for empty store slug", () => {
    expect(parseLemonSqueezyConfig("", "my-product")).toBeNull();
  });

  it("returns null for empty product slug", () => {
    expect(parseLemonSqueezyConfig("my-store", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildLemonSqueezyCSP
// ---------------------------------------------------------------------------

describe("buildLemonSqueezyCSP", () => {
  it("includes assets.lemonsqueezy.com in script-src", () => {
    const csp = buildLemonSqueezyCSP();
    expect(csp["script-src"]).toContain("assets.lemonsqueezy.com");
  });

  it("includes api.lemonsqueezy.com in connect-src", () => {
    const csp = buildLemonSqueezyCSP();
    expect(csp["connect-src"]).toContain("api.lemonsqueezy.com");
  });

  it("includes *.lemonsqueezy.com in frame-src for checkout overlay", () => {
    const csp = buildLemonSqueezyCSP();
    expect(csp["frame-src"]).toContain("*.lemonsqueezy.com");
  });

  it("does not include style-src or img-src", () => {
    const csp = buildLemonSqueezyCSP();
    expect(csp["style-src"] ?? []).toEqual([]);
    expect(csp["img-src"] ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LemonSqueezyCheckout component
// ---------------------------------------------------------------------------

describe("LemonSqueezyCheckout component", () => {
  const componentPath = resolve(templateDir, "src/components/LemonSqueezyCheckout.astro");

  it("exists", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("accepts href and label props", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("href");
    expect(src).toContain("label");
  });

  it("renders a link with data-lemonsqueezy attribute", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("data-lemonsqueezy");
  });

  it("includes the Lemon Squeezy embed script from assets.lemonsqueezy.com", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("assets.lemonsqueezy.com");
  });

  it("supports a theme prop defaulting to light", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toMatch(/theme.*=.*["']light["']/);
  });

  it("does not import a layout (it's a component, not a page)", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).not.toContain("import BaseLayout");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows Lemon Squeezy scripts when configured
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Lemon Squeezy scripts", () => {
  it("includes assets.lemonsqueezy.com in allowedScripts when configured", async () => {
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    expect(
      buildAllowedScripts({ ecommerce: "lemonsqueezy", turnstile: false }),
    ).toContain("assets.lemonsqueezy.com");
  });

  it("does not include Lemon Squeezy domains when not configured", async () => {
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    const scripts = buildAllowedScripts({ turnstile: false });
    expect(scripts).not.toContain("assets.lemonsqueezy.com");
  });

  it("does not flag Lemon Squeezy script when configured", async () => {
    const { scanScripts } = await import("../template/scripts/pre-deploy-check.js");
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    const allowed = buildAllowedScripts({ ecommerce: "lemonsqueezy", turnstile: false });
    const html = '<script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>';
    expect(scanScripts(html, allowed)).toEqual([]);
  });

  it("flags Lemon Squeezy script when NOT configured", async () => {
    const { scanScripts } = await import("../template/scripts/pre-deploy-check.js");
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    const allowed = buildAllowedScripts({ turnstile: false });
    const html = '<script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>';
    expect(scanScripts(html, allowed).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CSP headers allow Lemon Squeezy when configured
// ---------------------------------------------------------------------------

describe("CSP headers allow Lemon Squeezy when configured", () => {
  it("includes assets.lemonsqueezy.com when ECOMMERCE_PROVIDER=lemonsqueezy", async () => {
    const { generateHeadersContent } = await import("../template/scripts/csp.js");
    const headers = generateHeadersContent({
      ecommerce: "lemonsqueezy",
      turnstile: false,
    });
    expect(headers).toContain("assets.lemonsqueezy.com");
  });

  it("includes *.lemonsqueezy.com in frame-src", async () => {
    const { buildCSP } = await import("../template/scripts/csp.js");
    const csp = buildCSP({ ecommerce: "lemonsqueezy", turnstile: false });
    expect(csp).toContain("*.lemonsqueezy.com");
  });

  it("does not include Lemon Squeezy domains in template _headers (minimal CSP)", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).not.toContain("lemonsqueezy.com");
  });
});
