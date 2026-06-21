/**
 * Regression test for the stored-XSS in the webmention edge-render
 * (issue #363, finding 3).
 *
 * Webmention fields (author_url, author_photo, url) come from arbitrary
 * external sites. `escapeHtml()` neutralizes HTML metacharacters but NOT
 * dangerous URL schemes, so a verified mention whose author_url is
 * `javascript:…` or `data:…` previously rendered an executable href/src.
 * `renderMention()` must run every URL through `safeUrl()` (http/https
 * allowlist) before interpolating it into an attribute.
 */
import { describe, it, expect } from "vitest";
import { renderMention, safeUrl } from "../template/worker/webmention.js";

describe("safeUrl()", () => {
  it("allows http and https URLs", () => {
    expect(safeUrl("http://example.com/")).toBe("http://example.com/");
    expect(safeUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("rejects dangerous and non-http(s) schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeUrl("  javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects empty, relative, and unparseable values", () => {
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("/relative/path")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("renderMention() URL hardening", () => {
  it("drops a javascript: author_url instead of rendering an href", () => {
    const html = renderMention({
      author_name: "Mallory",
      author_url: "javascript:alert(document.cookie)",
    });
    expect(html).not.toContain("javascript:");
    // Falls back to a plain <span>, not an anchor.
    expect(html).toContain('<span class="p-author">Mallory</span>');
    expect(html).not.toContain("<a class=\"p-author");
  });

  it("drops a data: author_photo instead of rendering an img src", () => {
    const html = renderMention({
      author_name: "Mallory",
      author_photo: "data:text/html,<script>alert(1)</script>",
    });
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<img");
  });

  it("drops a javascript: permalink URL", () => {
    const html = renderMention({
      author_name: "Mallory",
      url: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("permalink");
  });

  it("renders safe http(s) URLs with hardening rel attributes", () => {
    const html = renderMention({
      author_name: "Alice",
      author_url: "https://alice.example/",
      author_photo: "https://alice.example/me.jpg",
      url: "https://alice.example/post/1",
      content: "nice post",
    });
    expect(html).toContain('href="https://alice.example/"');
    expect(html).toContain('src="https://alice.example/me.jpg"');
    expect(html).toContain('href="https://alice.example/post/1"');
    // Both anchors carry the untrusted-link hardening rel.
    expect(html.match(/rel="nofollow ugc noopener"/g)?.length).toBe(2);
  });

  it("does not surface a dangerous author_url as the display name", () => {
    const html = renderMention({
      author_url: "javascript:alert(1)",
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Someone");
  });
});
