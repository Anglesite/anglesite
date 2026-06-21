/**
 * Tests for the injectable webmention runtime (worker/webmention.js), the
 * module `/anglesite:indieweb` wires into the site Worker when Webmention is
 * enabled (issue #363). Covers the real composition against @dwk/webmention
 * (aliased to a stub) plus mf2 extraction against the real microformats-parser:
 *
 *   - parseMention() — h-entry / h-card → author, content, type, permalink.
 *   - handleWebmention() — dispatches to the receiver for the request origin.
 *   - drainWebmentionQueue() — runs the consumer only when WEBMENTION_DB is set.
 *   - injectWebmentions() — edge-render gating (target path, HTML, known target).
 *
 * URL/XSS hardening of renderMention()/safeUrl() lives in
 * webmention-render-xss.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseMention,
  handleWebmention,
  drainWebmentionQueue,
  injectWebmentions,
} from "../template/worker/webmention.js";
import { webmentionCalls, resetWebmentionCalls } from "./__stubs__/dwk-webmention";

const TARGET = "https://example.com/notes/abc/";

beforeEach(() => {
  resetWebmentionCalls();
});

describe("parseMention() — microformats2 extraction", () => {
  it("extracts a reply with author h-card, content, permalink, and published", () => {
    const html = `
      <div class="h-entry">
        <div class="p-author h-card">
          <a class="p-name u-url" href="https://alice.example/">Alice</a>
          <img class="u-photo" src="https://alice.example/me.jpg" alt="">
        </div>
        <a class="u-in-reply-to" href="${TARGET}">in reply to</a>
        <div class="e-content">Great post!</div>
        <time class="dt-published" datetime="2026-06-01T00:00:00Z">Jun 1</time>
        <a class="u-url" href="https://alice.example/reply/1">permalink</a>
      </div>`;
    const m = parseMention(html, {
      source: "https://alice.example/reply/1",
      target: TARGET,
    });
    expect(m.type).toBe("reply");
    expect(m.author_name).toBe("Alice");
    expect(m.author_url).toBe("https://alice.example/");
    expect(m.author_photo).toBe("https://alice.example/me.jpg");
    expect(m.content).toBe("Great post!");
    expect(m.published).toBe("2026-06-01T00:00:00Z");
    expect(m.url).toBe("https://alice.example/reply/1");
  });

  it("classifies a like-of as type 'like'", () => {
    const html = `
      <div class="h-entry">
        <a class="p-author h-card u-url" href="https://bob.example/">Bob</a>
        <a class="u-like-of" href="${TARGET}">liked</a>
      </div>`;
    const m = parseMention(html, { source: "https://bob.example/l/1", target: TARGET });
    expect(m.type).toBe("like");
    expect(m.author_url).toBe("https://bob.example/");
  });

  it("classifies a repost-of as type 'repost'", () => {
    const html = `<div class="h-entry"><a class="u-repost-of" href="${TARGET}">RT</a></div>`;
    const m = parseMention(html, { source: "https://x.example/r/1", target: TARGET });
    expect(m.type).toBe("repost");
  });

  it("defaults to type 'mention' when no response property points at the target", () => {
    const html = `<div class="h-entry"><div class="e-content">See <a href="${TARGET}">this</a></div></div>`;
    const m = parseMention(html, { source: "https://x.example/m/1", target: TARGET });
    expect(m.type).toBe("mention");
  });

  it("falls back to source URL and no author for an unparseable page", () => {
    const m = parseMention("<html><body>plain</body></html>", {
      source: "https://x.example/p",
      target: TARGET,
    });
    expect(m.type).toBe("mention");
    expect(m.url).toBe("https://x.example/p");
    expect(m.author_name).toBeUndefined();
  });
});

describe("handleWebmention() — receiver dispatch", () => {
  it("dispatches to the receiver and returns its response", async () => {
    const res = await handleWebmention(
      new Request("https://example.com/webmention", { method: "POST" }),
      {},
      { waitUntil: vi.fn() },
      "https://example.com",
    );
    expect(res.headers.get("x-handler")).toBe("webmention");
    expect(res.status).toBe(202);
    expect(webmentionCalls.receive).toBe(1);
  });
});

describe("drainWebmentionQueue() — queue consumer gating", () => {
  it("runs the consumer when WEBMENTION_DB is bound", async () => {
    await drainWebmentionQueue({ messages: [] }, { WEBMENTION_DB: {} }, { waitUntil: vi.fn() });
    expect(webmentionCalls.queue).toBe(1);
  });

  it("is a no-op when WEBMENTION_DB is absent", async () => {
    await drainWebmentionQueue({ messages: [] }, {}, { waitUntil: vi.fn() });
    expect(webmentionCalls.queue).toBe(0);
  });
});

describe("injectWebmentions() — edge-render gating", () => {
  let rewriteUsed = false;
  class FakeHTMLRewriter {
    on() {
      return this;
    }
    transform(r: Response) {
      rewriteUsed = true;
      return r;
    }
  }

  beforeEach(() => {
    rewriteUsed = false;
    (globalThis as any).HTMLRewriter = FakeHTMLRewriter;
  });
  afterEach(() => {
    delete (globalThis as any).HTMLRewriter;
  });

  function htmlResponse() {
    return new Response("<div id=webmentions></div>", {
      headers: { "content-type": "text/html" },
    });
  }

  // Serves both edge-render queries: the distinct-targets set and the per-target
  // rows. The targets cache is keyed per binding object, so a fresh mock per test
  // starts cold.
  function webmentionDb(mentionsByTarget: Record<string, unknown[]>) {
    const targetsAll = vi.fn(async () => ({
      results: Object.keys(mentionsByTarget).map((target) => ({ target })),
    }));
    let boundTarget: string;
    const mentionsAll = vi.fn(async () => ({ results: mentionsByTarget[boundTarget] ?? [] }));
    const bind = vi.fn((target: string) => {
      boundTarget = target;
      return { all: mentionsAll };
    });
    const prepare = vi.fn((sql: string) =>
      sql.includes("DISTINCT") ? { all: targetsAll } : { bind },
    );
    return { db: { prepare }, prepare, bind, targetsAll };
  }

  it("rewrites a note/blog page that has stored mentions", async () => {
    for (const path of ["/notes/abc/", "/blog/my-post/"]) {
      rewriteUsed = false;
      const target = `https://example.com${path}`;
      const { db, bind } = webmentionDb({
        [target]: [{ author_name: "Alice", url: "https://alice.example/r/1", type: "reply" }],
      });
      await injectWebmentions(htmlResponse(), { WEBMENTION_DB: db }, new URL(target));
      expect(bind, path).toHaveBeenCalledWith(target);
      expect(rewriteUsed, path).toBe(true);
    }
  });

  it("does not query or rewrite when the page has no stored mentions", async () => {
    const { db, bind } = webmentionDb({ "https://example.com/notes/other/": [{}] });
    const res = await injectWebmentions(
      htmlResponse(),
      { WEBMENTION_DB: db },
      new URL("https://example.com/notes/abc/"),
    );
    expect(bind).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("caches the known-target set across requests (one distinct query)", async () => {
    const { db, targetsAll } = webmentionDb({});
    await injectWebmentions(htmlResponse(), { WEBMENTION_DB: db }, new URL("https://example.com/notes/a/"));
    await injectWebmentions(htmlResponse(), { WEBMENTION_DB: db }, new URL("https://example.com/notes/b/"));
    expect(targetsAll).toHaveBeenCalledOnce();
  });

  it("skips non-target paths and collection indexes without querying", async () => {
    for (const path of ["/", "/about/", "/notes", "/notes/", "/blog/"]) {
      const { db, prepare } = webmentionDb({ "https://example.com/notes/abc/": [{}] });
      await injectWebmentions(htmlResponse(), { WEBMENTION_DB: db }, new URL(`https://example.com${path}`));
      expect(prepare, path).not.toHaveBeenCalled();
    }
  });

  it("skips when WEBMENTION_DB is unbound", async () => {
    const res = await injectWebmentions(htmlResponse(), {}, new URL("https://example.com/notes/abc/"));
    expect(rewriteUsed).toBe(false);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("skips non-HTML responses even on a target path", async () => {
    const { db, prepare } = webmentionDb({ "https://example.com/notes/abc/": [{}] });
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    await injectWebmentions(json, { WEBMENTION_DB: db }, new URL("https://example.com/notes/abc/"));
    expect(prepare).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
  });
});
