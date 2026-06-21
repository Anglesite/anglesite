/**
 * Rich Webmention render (Anglesite/anglesite#363, rich author cards).
 *
 * renderMention() now builds an author card (photo, name, content, permalink),
 * not just the source host. This covers the rich output and that EACH external
 * URL (author_url, author_photo, permalink/source) is independently scheme-
 * checked — escapeHtml alone wouldn't block javascript:/data: in an href/src.
 * Source-only safety invariants live in indieweb-render-safety.test.ts.
 */
import { describe, it, expect } from "vitest";
import { renderMention } from "../template/worker/site-entry.js";

describe("renderMention() — rich author cards", () => {
  it("renders photo, author link, content, permalink, and a type class", () => {
    const html = renderMention({
      author_name: "Alice",
      author_url: "https://alice.example/",
      author_photo: "https://alice.example/me.jpg",
      content: "Great post!",
      url: "https://alice.example/reply/1",
      type: "reply",
    });
    expect(html).toContain('class="h-cite webmention-reply"');
    expect(html).toContain('src="https://alice.example/me.jpg"');
    expect(html).toContain('href="https://alice.example/"');
    expect(html).toContain(">Alice<");
    expect(html).toContain('<div class="p-content">Great post!</div>');
    expect(html).toContain('href="https://alice.example/reply/1"');
    // Every rendered anchor carries the untrusted-link hardening rel.
    expect(html.match(/rel="nofollow ugc noopener noreferrer"/g)?.length).toBe(2);
  });

  it("drops a javascript: author_url to a plain span (no anchor, no scheme)", () => {
    const html = renderMention({
      author_name: "Mallory",
      author_url: "javascript:alert(1)",
      url: "https://m.example/p",
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="p-author">Mallory</span>');
  });

  it("drops a data: author_photo (no img element)", () => {
    const html = renderMention({
      author_name: "Mallory",
      author_photo: "data:text/html,<script>alert(1)</script>",
      url: "https://m.example/p",
    });
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<img");
  });

  it("clamps an unknown type to webmention-mention", () => {
    const html = renderMention({ url: "https://x.example/p", type: "../evil" });
    expect(html).toContain('class="h-cite webmention-mention"');
    expect(html).not.toContain("evil");
  });

  it("drops a mention with no usable http(s) permalink/source", () => {
    expect(renderMention({ source: "javascript:alert(1)" })).toBe("");
    expect(renderMention({ url: "data:text/html,x" })).toBe("");
  });
});
