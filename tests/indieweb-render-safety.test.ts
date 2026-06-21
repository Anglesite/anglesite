/**
 * Webmention edge-render output safety (Anglesite/anglesite#363, problem 3).
 *
 * `renderMention()` interpolates the externally-sourced `source` URL into an
 * `href`. Escaping the value is not enough: a verified mention whose `source` is
 * `javascript:…` or `data:…` would render an executable link — stored XSS, since
 * webmention data comes from arbitrary external sites. Only http/https URLs may
 * reach an attribute; anything else drops the mention entirely.
 */
import { describe, it, expect } from "vitest";
import { renderMention } from "../template/worker/site-entry.js";

const HOSTILE = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "mailto:me@example.com",
  "file:///etc/passwd",
  // Unicode-confusable scheme: U+FF4A FULLWIDTH LATIN SMALL LETTER J. The WHATWG
  // URL parser rejects a non-ASCII scheme start, so safeUrl drops it via catch.
  "ｊavascript:alert(1)",
];

describe("renderMention URL-scheme safety", () => {
  it("drops a mention whose source is a non-http(s) URL", () => {
    for (const source of HOSTILE) {
      const html = renderMention({ source });
      expect(html, source).not.toMatch(/href="[^"]*(javascript|data|vbscript):/i);
      // Non-http(s) source → nothing rendered at all.
      expect(html, source).toBe("");
    }
  });

  it("renders an http/https source as a link with rel hardening", () => {
    const html = renderMention({ source: "https://alice.example/reply/1" });
    expect(html).toContain('href="https://alice.example/reply/1"');
    expect(html).toContain("alice.example"); // host shown as link text
    // External, user-generated content: don't pass link equity, a window handle,
    // or a Referer signal that this URL appeared as a webmention here.
    expect(html).toMatch(/rel="[^"]*nofollow[^"]*"/);
    expect(html).toMatch(/rel="[^"]*ugc[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  it("does not let a crafted source break out of the href attribute", () => {
    // URL normalization percent-encodes the quotes/angle brackets, and
    // escapeHtml is a second layer — either way the markup can't break out.
    const html = renderMention({
      source: 'https://evil.example/?x="><script>alert(1)</script>',
    });
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain("<script>");
  });
});
