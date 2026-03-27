import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSnipcartAttrs,
  buildSnipcartCSP,
  formatPrice,
} from "../template/scripts/snipcart.js";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// buildSnipcartAttrs
// ---------------------------------------------------------------------------

describe("buildSnipcartAttrs", () => {
  it("generates required data-item-* attributes", () => {
    const attrs = buildSnipcartAttrs({
      id: "leather-bag",
      name: "Leather Bag",
      price: 4500,
      url: "/products/leather-bag",
      description: "Handmade leather bag",
    });
    expect(attrs["data-item-id"]).toBe("leather-bag");
    expect(attrs["data-item-name"]).toBe("Leather Bag");
    expect(attrs["data-item-price"]).toBe("45.00");
    expect(attrs["data-item-url"]).toBe("/products/leather-bag");
    expect(attrs["data-item-description"]).toBe("Handmade leather bag");
  });

  it("includes image when provided", () => {
    const attrs = buildSnipcartAttrs({
      id: "mug",
      name: "Ceramic Mug",
      price: 1200,
      url: "/products/mug",
      description: "Hand-thrown ceramic mug",
      image: "/images/products/mug.webp",
    });
    expect(attrs["data-item-image"]).toBe("/images/products/mug.webp");
  });

  it("omits image when not provided", () => {
    const attrs = buildSnipcartAttrs({
      id: "mug",
      name: "Ceramic Mug",
      price: 1200,
      url: "/products/mug",
      description: "A mug",
    });
    expect(attrs).not.toHaveProperty("data-item-image");
  });

  it("includes weight when provided", () => {
    const attrs = buildSnipcartAttrs({
      id: "candle",
      name: "Soy Candle",
      price: 2000,
      url: "/products/candle",
      description: "Soy wax candle",
      weight: 250,
    });
    expect(attrs["data-item-weight"]).toBe(250);
  });

  it("omits weight when not provided", () => {
    const attrs = buildSnipcartAttrs({
      id: "candle",
      name: "Soy Candle",
      price: 2000,
      url: "/products/candle",
      description: "Soy wax candle",
    });
    expect(attrs).not.toHaveProperty("data-item-weight");
  });

  it("formats zero price as 0.00", () => {
    const attrs = buildSnipcartAttrs({
      id: "free-sample",
      name: "Free Sample",
      price: 0,
      url: "/products/free-sample",
      description: "A free sample",
    });
    expect(attrs["data-item-price"]).toBe("0.00");
  });

  it("formats high prices correctly", () => {
    const attrs = buildSnipcartAttrs({
      id: "art-print",
      name: "Art Print",
      price: 99999,
      url: "/products/art-print",
      description: "Limited edition print",
    });
    expect(attrs["data-item-price"]).toBe("999.99");
  });
});

// ---------------------------------------------------------------------------
// formatPrice
// ---------------------------------------------------------------------------

describe("formatPrice", () => {
  it("formats cents to dollars with two decimals", () => {
    expect(formatPrice(4500)).toBe("45.00");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("0.00");
  });

  it("formats single-digit cents", () => {
    expect(formatPrice(5)).toBe("0.05");
  });

  it("formats prices with no cents", () => {
    expect(formatPrice(10000)).toBe("100.00");
  });

  it("formats prices with one cent digit", () => {
    expect(formatPrice(1050)).toBe("10.50");
  });
});

// ---------------------------------------------------------------------------
// buildSnipcartCSP
// ---------------------------------------------------------------------------

describe("buildSnipcartCSP", () => {
  it("includes cdn.snipcart.com in script-src", () => {
    const csp = buildSnipcartCSP();
    expect(csp["script-src"]).toContain("cdn.snipcart.com");
  });

  it("includes cdn.snipcart.com in style-src", () => {
    const csp = buildSnipcartCSP();
    expect(csp["style-src"]).toContain("cdn.snipcart.com");
  });

  it("includes app.snipcart.com in connect-src", () => {
    const csp = buildSnipcartCSP();
    expect(csp["connect-src"]).toContain("app.snipcart.com");
  });

  it("includes app.snipcart.com in frame-src", () => {
    const csp = buildSnipcartCSP();
    expect(csp["frame-src"]).toContain("app.snipcart.com");
  });
});

// ---------------------------------------------------------------------------
// SnipcartProduct component
// ---------------------------------------------------------------------------

describe("SnipcartProduct component", () => {
  const componentPath = resolve(
    templateDir,
    "src/components/SnipcartProduct.astro",
  );

  it("exists", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("accepts product props (id, name, price, description)", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("id");
    expect(src).toContain("name");
    expect(src).toContain("price");
    expect(src).toContain("description");
  });

  it("renders a button with snipcart-add-item class", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("snipcart-add-item");
  });

  it("uses data-item-* attributes for Snipcart integration", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("data-item-id");
    expect(src).toContain("data-item-name");
    expect(src).toContain("data-item-price");
    expect(src).toContain("data-item-url");
  });

  it("does not import a layout (it is embedded in pages)", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).not.toContain("import BaseLayout");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows cdn.snipcart.com
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Snipcart scripts", () => {
  it("includes cdn.snipcart.com in allowedScripts", async () => {
    const { allowedScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    expect(allowedScripts).toContain("cdn.snipcart.com");
  });

  it("does not flag Snipcart script tag", async () => {
    const { scanScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    const html =
      '<script src="https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Products content collection
// ---------------------------------------------------------------------------

describe("products content collection", () => {
  it("is defined in content.config.ts", () => {
    const src = readFileSync(
      resolve(templateDir, "src/content.config.ts"),
      "utf-8",
    );
    expect(src).toContain("products");
  });

  it("exports products in collections", () => {
    const src = readFileSync(
      resolve(templateDir, "src/content.config.ts"),
      "utf-8",
    );
    expect(src).toMatch(/export\s+const\s+collections\s*=\s*\{[^}]*products/);
  });

  it("is defined in keystatic.config.ts", () => {
    const src = readFileSync(
      resolve(templateDir, "keystatic.config.ts"),
      "utf-8",
    );
    expect(src).toContain("products");
  });
});

// ---------------------------------------------------------------------------
// CSP headers
// ---------------------------------------------------------------------------

describe("CSP headers allow Snipcart", () => {
  it("includes cdn.snipcart.com in script-src", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).toContain("cdn.snipcart.com");
  });

  it("includes app.snipcart.com in connect-src", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).toContain("app.snipcart.com");
  });
});
