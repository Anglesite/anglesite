import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// Contact page template
// ---------------------------------------------------------------------------

describe("contact page template", () => {
  const contactPath = resolve(templateDir, "src/pages/contact.astro");

  it("exists", () => {
    expect(existsSync(contactPath)).toBe(true);
  });

  it("has name, email, and message fields", () => {
    const html = readFileSync(contactPath, "utf-8");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
  });

  it("includes required attributes for accessibility", () => {
    const html = readFileSync(contactPath, "utf-8");
    // All fields should have labels (for= or aria-label)
    expect(html).toMatch(/for=["']name["']/);
    expect(html).toMatch(/for=["']email["']/);
    expect(html).toMatch(/for=["']message["']/);
    // Required fields
    expect(html).toContain("required");
  });

  it("has a Turnstile widget placeholder", () => {
    const html = readFileSync(contactPath, "utf-8");
    expect(html).toContain("cf-turnstile");
  });

  it("uses BaseLayout", () => {
    const html = readFileSync(contactPath, "utf-8");
    expect(html).toContain("BaseLayout");
  });

  it("posts to a configurable action URL", () => {
    const html = readFileSync(contactPath, "utf-8");
    // The form action should read from .site-config or use a placeholder
    expect(html).toMatch(/action=/);
  });
});

// ---------------------------------------------------------------------------
// Thank you page template
// ---------------------------------------------------------------------------

describe("thank you page template", () => {
  const thanksPath = resolve(templateDir, "src/pages/contact/thanks.astro");

  it("exists", () => {
    expect(existsSync(thanksPath)).toBe(true);
  });

  it("uses BaseLayout", () => {
    const html = readFileSync(thanksPath, "utf-8");
    expect(html).toContain("BaseLayout");
  });

  it("links back to the home page", () => {
    const html = readFileSync(thanksPath, "utf-8");
    expect(html).toMatch(/href=["']\/["']/);
  });
});

// ---------------------------------------------------------------------------
// Worker validation logic
// ---------------------------------------------------------------------------

describe("contact worker", () => {
  const workerPath = resolve(templateDir, "worker/contact-worker.js");

  it("exists", () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  it("exports a default fetch handler", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toMatch(/export\s+default/);
  });

  it("validates Turnstile token", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toContain("siteverify");
  });

  it("does not store submissions", () => {
    const code = readFileSync(workerPath, "utf-8");
    // No KV, D1, or R2 bindings — forward and discard
    expect(code).not.toMatch(/\.put\(|\.insert\(|KV_NAMESPACE|D1_DATABASE|R2_BUCKET/i);
  });

  it("does not fall back to wildcard CORS origin", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).not.toContain('origin || "*"');
    expect(code).not.toContain("origin || '*'");
  });

  it("validates origin against SITE_DOMAIN", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toContain("SITE_DOMAIN");
  });

  it("handles Turnstile network failures with try-catch", () => {
    const code = readFileSync(workerPath, "utf-8");
    // verifyTurnstile must wrap its fetch in try-catch
    const fnMatch = code.match(/async function verifyTurnstile[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain("try");
    expect(fnMatch![0]).toContain("catch");
  });
});
