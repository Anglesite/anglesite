/**
 * Webmention edge-render output safety (Anglesite/anglesite#363, problem 3).
 *
 * `renderMention()` interpolates externally-sourced webmention fields
 * (author_url, author_photo, url) into `href`/`src`. Escaping the value is not
 * enough: a verified mention whose URL is `javascript:…` or `data:…` renders an
 * executable link/`src` — stored XSS, since webmention data comes from arbitrary
 * external sites. Only http/https URLs may reach an attribute.
 */
import { describe, it, expect } from "vitest";
import { renderMention } from "../template/worker/site-entry.js";

const HOSTILE = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "javascript:alert(1)",
];

describe("renderMention URL-scheme safety", () => {
  it("never emits a javascript:/data:/vbscript: href for author_url", () => {
    for (const url of HOSTILE) {
      const html = renderMention({ author_name: "X", author_url: url });
      expect(html, url).not.toMatch(/href="[^"]*(javascript|data|vbscript):/i);
      // The name still renders, just not as a link.
      expect(html).toContain("X");
    }
  });

  it("never emits a hostile src for author_photo", () => {
    for (const url of HOSTILE) {
      const html = renderMention({ author_name: "X", author_photo: url });
      expect(html, url).not.toMatch(/src="[^"]*(javascript|data|vbscript):/i);
    }
  });

  it("never emits a hostile permalink href for url", () => {
    for (const url of HOSTILE) {
      const html = renderMention({ author_name: "X", url });
      expect(html, url).not.toMatch(/href="[^"]*(javascript|data|vbscript):/i);
    }
  });

  it("renders http/https URLs as links with rel hardening", () => {
    const html = renderMention({
      author_name: "Alice",
      author_url: "https://alice.example/",
      author_photo: "https://alice.example/me.jpg",
      content: "Nice!",
      url: "https://alice.example/reply/1",
    });
    expect(html).toContain('href="https://alice.example/"');
    expect(html).toContain('src="https://alice.example/me.jpg"');
    expect(html).toContain('href="https://alice.example/reply/1"');
    // External, user-generated content: don't pass link equity or window handle.
    expect(html).toMatch(/rel="[^"]*nofollow[^"]*"/);
    expect(html).toMatch(/rel="[^"]*ugc[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it("still escapes HTML metacharacters in text fields", () => {
    const html = renderMention({
      author_name: '<img src=x onerror=alert(1)>',
      content: "<b>hi</b>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>hi</b>");
    expect(html).toContain("&lt;");
  });
});
