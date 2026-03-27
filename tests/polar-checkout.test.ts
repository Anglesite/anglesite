import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// PolarCheckout component
// ---------------------------------------------------------------------------

describe("PolarCheckout component", () => {
  const componentPath = resolve(templateDir, "src/components/PolarCheckout.astro");

  it("exists", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("accepts href and label props", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("href");
    expect(src).toContain("label");
  });

  it("renders a link with data-polar-checkout attribute", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("data-polar-checkout");
  });

  it("includes the Polar embed script from cdn.polar.sh", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("cdn.polar.sh/embed/buy-button.js");
  });

  it("defers the script and uses data-auto-init", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("defer");
    expect(src).toContain("data-auto-init");
  });

  it("supports a theme prop defaulting to light", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("data-polar-checkout-theme");
    // Default should be light
    expect(src).toMatch(/theme.*=.*["']light["']/);
  });

  it("uses BaseLayout-compatible markup (no layout import)", () => {
    const src = readFileSync(componentPath, "utf-8");
    // Component should NOT import a layout — it's embedded in pages
    expect(src).not.toContain("import BaseLayout");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows cdn.polar.sh when Polar is configured
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Polar scripts", () => {
  it("includes cdn.polar.sh in allowedScripts when ECOMMERCE_PROVIDER=polar", async () => {
    const { buildAllowedScripts, parseProviders } = await import("../template/scripts/csp.js");
    const providers = parseProviders("ECOMMERCE_PROVIDER=polar");
    expect(buildAllowedScripts(providers)).toContain("cdn.polar.sh");
  });

  it("does not include cdn.polar.sh when no ecommerce provider set", async () => {
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    expect(buildAllowedScripts({ turnstile: false })).not.toContain("cdn.polar.sh");
  });

  it("does not flag Polar checkout script when Polar is configured", async () => {
    const { scanScripts } = await import("../template/scripts/pre-deploy-check.js");
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    const allowed = buildAllowedScripts({ ecommerce: "polar", turnstile: false });
    const html = '<script src="https://cdn.polar.sh/embed/buy-button.js" defer data-auto-init></script>';
    expect(scanScripts(html, allowed)).toEqual([]);
  });

  it("flags Polar checkout script when Polar is NOT configured", async () => {
    const { scanScripts } = await import("../template/scripts/pre-deploy-check.js");
    const { buildAllowedScripts } = await import("../template/scripts/csp.js");
    const allowed = buildAllowedScripts({ turnstile: false });
    const html = '<script src="https://cdn.polar.sh/embed/buy-button.js" defer data-auto-init></script>';
    expect(scanScripts(html, allowed).length).toBe(1);
  });
});
