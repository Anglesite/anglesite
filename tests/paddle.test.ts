import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  parsePaddleConfig,
  buildPaddleCSP,
} from "../template/scripts/paddle.js";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// parsePaddleConfig
// ---------------------------------------------------------------------------

describe("parsePaddleConfig", () => {
  it("extracts client token and price ID", () => {
    const result = parsePaddleConfig("test_abc123def456", "pri_01abc123");
    expect(result).toEqual({
      clientToken: "test_abc123def456",
      priceId: "pri_01abc123",
      sandbox: true,
    });
  });

  it("detects sandbox mode from test_ prefix", () => {
    expect(parsePaddleConfig("test_abc123", "pri_01abc").sandbox).toBe(true);
  });

  it("detects live mode from live_ prefix", () => {
    expect(parsePaddleConfig("live_abc123", "pri_01abc").sandbox).toBe(false);
  });

  it("trims whitespace from inputs", () => {
    const result = parsePaddleConfig("  test_abc123  ", "  pri_01abc  ");
    expect(result.clientToken).toBe("test_abc123");
    expect(result.priceId).toBe("pri_01abc");
  });

  it("returns null for empty client token", () => {
    expect(parsePaddleConfig("", "pri_01abc")).toBeNull();
  });

  it("returns null for empty price ID", () => {
    expect(parsePaddleConfig("test_abc123", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPaddleCSP
// ---------------------------------------------------------------------------

describe("buildPaddleCSP", () => {
  it("includes cdn.paddle.com in script-src", () => {
    const csp = buildPaddleCSP();
    expect(csp["script-src"]).toContain("cdn.paddle.com");
  });

  it("includes checkout.paddle.com in frame-src", () => {
    const csp = buildPaddleCSP();
    expect(csp["frame-src"]).toContain("checkout.paddle.com");
  });

  it("includes sandbox-cdn.paddle.com in script-src for sandbox coverage", () => {
    const csp = buildPaddleCSP();
    expect(csp["script-src"]).toContain("sandbox-cdn.paddle.com");
  });

  it("includes sandbox-checkout.paddle.com in frame-src for sandbox coverage", () => {
    const csp = buildPaddleCSP();
    expect(csp["frame-src"]).toContain("sandbox-checkout.paddle.com");
  });

  it("includes log.paddle.com in connect-src for analytics", () => {
    const csp = buildPaddleCSP();
    expect(csp["connect-src"]).toContain("log.paddle.com");
  });

  it("does not include style-src or img-src", () => {
    const csp = buildPaddleCSP();
    expect(csp["style-src"] ?? []).toEqual([]);
    expect(csp["img-src"] ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PaddleCheckout component
// ---------------------------------------------------------------------------

describe("PaddleCheckout component", () => {
  const componentPath = resolve(
    templateDir,
    "src/components/PaddleCheckout.astro",
  );

  it("exists", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("accepts clientToken and priceId props", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("clientToken");
    expect(src).toContain("priceId");
  });

  it("includes Paddle.js from cdn.paddle.com", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("cdn.paddle.com");
  });

  it("initializes Paddle with the client token", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("Paddle.Initialize");
  });

  it("opens checkout with the price ID", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("Paddle.Checkout.open");
  });

  it("supports a label prop with a default", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toMatch(/label.*=.*["']Buy Now["']/);
  });

  it("does not import a layout (it's a component, not a page)", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).not.toContain("import BaseLayout");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows cdn.paddle.com when Paddle is configured
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Paddle scripts", () => {
  it("includes cdn.paddle.com in allowedScripts when configured", async () => {
    const { buildAllowedScripts } = await import(
      "../template/scripts/csp.js"
    );
    expect(
      buildAllowedScripts({ ecommerce: "paddle", turnstile: false }),
    ).toContain("cdn.paddle.com");
  });

  it("includes sandbox-cdn.paddle.com in allowedScripts when configured", async () => {
    const { buildAllowedScripts } = await import(
      "../template/scripts/csp.js"
    );
    expect(
      buildAllowedScripts({ ecommerce: "paddle", turnstile: false }),
    ).toContain("sandbox-cdn.paddle.com");
  });

  it("does not include Paddle domains when not configured", async () => {
    const { buildAllowedScripts } = await import(
      "../template/scripts/csp.js"
    );
    const scripts = buildAllowedScripts({ turnstile: false });
    expect(scripts).not.toContain("cdn.paddle.com");
  });

  it("does not flag Paddle script when configured", async () => {
    const { scanScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    const { buildAllowedScripts } = await import(
      "../template/scripts/csp.js"
    );
    const allowed = buildAllowedScripts({
      ecommerce: "paddle",
      turnstile: false,
    });
    const html =
      '<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>';
    expect(scanScripts(html, allowed)).toEqual([]);
  });

  it("flags Paddle script when Paddle is NOT configured", async () => {
    const { scanScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    const { buildAllowedScripts } = await import(
      "../template/scripts/csp.js"
    );
    const allowed = buildAllowedScripts({ turnstile: false });
    const html =
      '<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>';
    expect(scanScripts(html, allowed).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CSP includes Paddle domains when configured
// ---------------------------------------------------------------------------

describe("CSP headers allow Paddle when configured", () => {
  it("includes cdn.paddle.com when ECOMMERCE_PROVIDER=paddle", async () => {
    const { generateHeadersContent } = await import(
      "../template/scripts/csp.js"
    );
    const headers = generateHeadersContent({
      ecommerce: "paddle",
      turnstile: false,
    });
    expect(headers).toContain("cdn.paddle.com");
  });

  it("includes checkout.paddle.com in frame-src", async () => {
    const { buildCSP } = await import("../template/scripts/csp.js");
    const csp = buildCSP({ ecommerce: "paddle", turnstile: false });
    expect(csp).toContain("checkout.paddle.com");
  });

  it("does not include Paddle domains in template _headers (minimal CSP)", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).not.toContain("cdn.paddle.com");
  });
});
