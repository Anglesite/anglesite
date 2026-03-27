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
// buy-button skill includes Polar path
// ---------------------------------------------------------------------------

describe("buy-button skill", () => {
  const skillPath = resolve(import.meta.dirname!, "..", "skills", "buy-button", "SKILL.md");

  it("mentions Polar as an option for digital goods", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("Polar");
  });

  it("mentions PolarCheckout component", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("PolarCheckout");
  });

  it("distinguishes digital goods from physical products", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content.toLowerCase()).toContain("digital");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows cdn.polar.sh
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Polar scripts", () => {
  it("includes cdn.polar.sh in allowedScripts", async () => {
    const { allowedScripts } = await import("../template/scripts/pre-deploy-check.js");
    expect(allowedScripts).toContain("cdn.polar.sh");
  });

  it("does not flag Polar checkout script", async () => {
    const { scanScripts } = await import("../template/scripts/pre-deploy-check.js");
    const html = '<script src="https://cdn.polar.sh/embed/buy-button.js" defer data-auto-init></script>';
    expect(scanScripts(html)).toEqual([]);
  });
});
