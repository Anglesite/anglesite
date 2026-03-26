import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatPostForEmail,
  generateSubscribeFormHtml,
  formatSubscriberReport,
} from "../template/scripts/newsletter.js";

// ---------------------------------------------------------------------------
// formatPostForEmail
// ---------------------------------------------------------------------------

describe("formatPostForEmail", () => {
  it("includes the post title", () => {
    const result = formatPostForEmail(
      "Spring Menu Update",
      "Five new seasonal dishes.",
      "Full post body here with lots of details about the new menu...",
      "https://example.com",
      "spring-menu-update",
    );
    expect(result).toContain("Spring Menu Update");
  });

  it("includes a read-more link with absolute URL", () => {
    const result = formatPostForEmail(
      "Title",
      "Description",
      "Body text",
      "https://example.com",
      "my-post",
    );
    expect(result).toContain("https://example.com/blog/my-post");
  });

  it("includes the description", () => {
    const result = formatPostForEmail(
      "Title",
      "A short summary of the post.",
      "Body",
      "https://example.com",
      "slug",
    );
    expect(result).toContain("A short summary of the post.");
  });

  it("converts relative image paths to absolute URLs", () => {
    const body = "Check out this ![photo](/images/blog/food.webp) of our dishes.";
    const result = formatPostForEmail(
      "Title",
      "Desc",
      body,
      "https://example.com",
      "slug",
    );
    expect(result).toContain("https://example.com/images/blog/food.webp");
  });

  it("returns non-empty output", () => {
    const result = formatPostForEmail("T", "D", "B", "https://x.com", "s");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateSubscribeFormHtml
// ---------------------------------------------------------------------------

describe("generateSubscribeFormHtml", () => {
  it("generates a form with email input for buttondown", () => {
    const html = generateSubscribeFormHtml("buttondown", "https://buttondown.email/api/emails/embed-subscribe/mylist");
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
    expect(html).toContain("action=");
  });

  it("generates a form for a worker proxy URL", () => {
    const html = generateSubscribeFormHtml("buttondown", "https://subscribe.example.workers.dev");
    expect(html).toContain("https://subscribe.example.workers.dev");
  });

  it("includes required attribute on email field", () => {
    const html = generateSubscribeFormHtml("buttondown", "https://example.com");
    expect(html).toContain("required");
  });

  it("includes a submit button", () => {
    const html = generateSubscribeFormHtml("buttondown", "https://example.com");
    expect(html).toContain("type=\"submit\"");
  });

  it("includes a label for accessibility", () => {
    const html = generateSubscribeFormHtml("buttondown", "https://example.com");
    expect(html).toMatch(/for=["']email["']/);
  });

  it("escapes HTML in actionUrl to prevent injection", () => {
    const html = generateSubscribeFormHtml("buttondown", 'https://evil.com" onsubmit="alert(1)');
    expect(html).not.toContain('onsubmit="alert(1)"');
    expect(html).toContain("&quot;");
  });
});

// ---------------------------------------------------------------------------
// formatSubscriberReport
// ---------------------------------------------------------------------------

describe("formatSubscriberReport", () => {
  it("shows subscriber count", () => {
    const result = formatSubscriberReport(42);
    expect(result).toContain("42");
    expect(result).toContain("subscriber");
  });

  it("shows growth when previous count provided", () => {
    const result = formatSubscriberReport(42, 39);
    expect(result).toContain("3");
  });

  it("handles zero subscribers", () => {
    const result = formatSubscriberReport(0);
    expect(result).toContain("0");
    expect(result).not.toContain("NaN");
  });

  it("handles no previous count", () => {
    const result = formatSubscriberReport(42);
    expect(result).not.toContain("undefined");
  });

  it("shows decline", () => {
    const result = formatSubscriberReport(38, 42);
    expect(result).toMatch(/down|lost|fewer/i);
  });
});

// ---------------------------------------------------------------------------
// Subscribe worker
// ---------------------------------------------------------------------------

describe("subscribe worker", () => {
  const workerPath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "worker",
    "subscribe-worker.js",
  );

  it("exists", () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  it("exports a default fetch handler", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toMatch(/export\s+default/);
  });

  it("proxies to the newsletter API", () => {
    const code = readFileSync(workerPath, "utf-8");
    expect(code).toContain("buttondown");
  });

  it("does not expose the API key to the client", () => {
    const code = readFileSync(workerPath, "utf-8");
    // API key should come from env, not be hardcoded
    expect(code).toContain("env.");
    expect(code).not.toMatch(/Token [A-Za-z0-9]{20,}/);
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
});

// ---------------------------------------------------------------------------
// content.config.ts — sendNewsletter field
// ---------------------------------------------------------------------------

describe("blog post schema", () => {
  const configPath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "content.config.ts",
  );

  it("includes sendNewsletter field", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("sendNewsletter");
  });
});
