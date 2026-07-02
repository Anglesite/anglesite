/**
 * Build-time webmention sender (template/scripts/send-webmentions.ts). Closes
 * the receive-only gap: ADR-0020 composes a receiving @dwk/webmention endpoint,
 * but nothing sent webmentions for outbound links in the owner's own posts.
 *
 * Endpoint discovery and outbound-link extraction are pure functions tested
 * against canned HTML/mf2 fixtures with an injected `fetchImpl`, mirroring the
 * pattern in webmention-inbox.test.ts. `isSafeUrl` guards against SSRF via an
 * injected DNS `lookupImpl` rather than real network resolution.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverWebmentionEndpoint,
  extractOutboundLinksFromEntry,
  isPrivateAddress,
  isSafeUrl,
  loadLedger,
  saveLedger,
  sendWebmention,
  sendWebmentionsForSite,
} from "../template/scripts/send-webmentions.ts";

describe("extractOutboundLinksFromEntry()", () => {
  const PERMALINK = "https://mysite.example/blog/hello/";

  it("extracts only external links from e-content, ignoring nav/footer", () => {
    const html = `
      <nav><a href="https://mysite.example/other-post/">nav link</a></nav>
      <article class="h-entry">
        <h1 class="p-name">Hello</h1>
        <div class="e-content">
          <p>Check out <a href="https://alice.example/post">Alice's post</a>
          and <a href="/blog/another-post/">my other post</a>.</p>
        </div>
      </article>
      <footer><a href="https://mysite.example/privacy/">Privacy</a></footer>`;
    const links = extractOutboundLinksFromEntry(html, PERMALINK);
    expect(links).toEqual(["https://alice.example/post"]);
  });

  it("dedupes repeated links and resolves relative URLs against the permalink", () => {
    const html = `
      <article class="h-entry">
        <div class="e-content">
          <a href="https://bob.example/x">one</a>
          <a href="https://bob.example/x">two</a>
        </div>
      </article>`;
    expect(extractOutboundLinksFromEntry(html, PERMALINK)).toEqual([
      "https://bob.example/x",
    ]);
  });

  it("returns an empty array when there is no h-entry or e-content", () => {
    expect(extractOutboundLinksFromEntry("<p>no entry here</p>", PERMALINK)).toEqual([]);
  });
});

describe("discoverWebmentionEndpoint()", () => {
  it("prefers the HTTP Link header", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          link: '<https://target.example/webmention>; rel="webmention"',
        },
      }),
    );
    const endpoint = await discoverWebmentionEndpoint("https://target.example/post", fetchImpl);
    expect(endpoint).toBe("https://target.example/webmention");
  });

  it("falls back to a <link rel=webmention> tag in the HTML body", async () => {
    const html = `<html><head><link rel="webmention" href="/wm-endpoint"></head></html>`;
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    const endpoint = await discoverWebmentionEndpoint("https://target.example/post", fetchImpl);
    expect(endpoint).toBe("https://target.example/wm-endpoint");
  });

  it("falls back to an <a rel=webmention> tag", async () => {
    const html = `<html><body><a rel="webmention" href="https://target.example/wm">send</a></body></html>`;
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 }));
    const endpoint = await discoverWebmentionEndpoint("https://target.example/post", fetchImpl);
    expect(endpoint).toBe("https://target.example/wm");
  });

  it("returns null when no endpoint is advertised", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html></html>", { status: 200 }));
    expect(await discoverWebmentionEndpoint("https://target.example/post", fetchImpl)).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network error");
    });
    expect(await discoverWebmentionEndpoint("https://target.example/post", fetchImpl)).toBeNull();
  });
});

describe("isPrivateAddress()", () => {
  it("flags loopback, private, and link-local ranges", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.5")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.1.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1::")).toBe(false);
  });
});

describe("isSafeUrl()", () => {
  it("rejects non-http(s) protocols without a DNS lookup", async () => {
    const lookupImpl = vi.fn();
    expect(await isSafeUrl("file:///etc/passwd", lookupImpl)).toBe(false);
    expect(lookupImpl).not.toHaveBeenCalled();
  });

  it("rejects a target that resolves to a private address", async () => {
    const lookupImpl = vi.fn(async () => ({ address: "127.0.0.1", family: 4 }));
    expect(await isSafeUrl("https://internal.example/", lookupImpl)).toBe(false);
  });

  it("allows a target that resolves to a public address", async () => {
    const lookupImpl = vi.fn(async () => ({ address: "93.184.216.34", family: 4 }));
    expect(await isSafeUrl("https://public.example/", lookupImpl)).toBe(true);
  });

  it("fails closed when DNS lookup errors", async () => {
    const lookupImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await isSafeUrl("https://nowhere.example/", lookupImpl)).toBe(false);
  });
});

describe("sendWebmention()", () => {
  it("POSTs source and target form-encoded and reports success on 2xx", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toBe(
        "source=https%3A%2F%2Fmy.example%2Fp&target=https%3A%2F%2Fyou.example%2Fq",
      );
      return new Response("", { status: 202 });
    });
    const result = await sendWebmention(
      "https://you.example/webmention",
      "https://my.example/p",
      "https://you.example/q",
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true, status: 202 });
  });

  it("reports failure on non-2xx and on network error", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 400 }));
    expect(
      await sendWebmention("https://x/wm", "https://a", "https://b", fetchImpl as unknown as typeof fetch),
    ).toEqual({ ok: false, status: 400 });

    const throwing = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(
      await sendWebmention("https://x/wm", "https://a", "https://b", throwing as unknown as typeof fetch),
    ).toEqual({ ok: false });
  });
});

describe("ledger persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wm-ledger-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads an empty ledger when the file does not exist", () => {
    expect(loadLedger(join(dir, "missing.json"))).toEqual({});
  });

  it("round-trips through save and load", () => {
    const path = join(dir, "webmention-sent.json");
    const ledger = { "https://a|https://b": { status: "sent" as const, at: "2026-07-01T00:00:00.000Z" } };
    saveLedger(path, ledger);
    expect(existsSync(path)).toBe(true);
    expect(loadLedger(path)).toEqual(ledger);
    expect(readFileSync(path, "utf-8")).toContain("\n");
  });
});

describe("sendWebmentionsForSite()", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wm-site-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePost(relPath: string, html: string) {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { dirname } = require("node:path") as typeof import("node:path");
    const full = join(dir, "dist", relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, html, "utf-8");
  }

  it("sends new mentions, skips already-sent ones, and records the outcome", async () => {
    writePost(
      "blog/hello/index.html",
      `<article class="h-entry"><div class="e-content">
         <a href="https://alice.example/post">Alice</a>
         <a href="https://bob.example/post">Bob</a>
       </div></article>`,
    );

    const ledgerPath = join(dir, "webmention-sent.json");
    saveLedger(ledgerPath, {
      "https://mysite.example/blog/hello/|https://bob.example/post": {
        status: "sent",
        at: "2026-01-01T00:00:00.000Z",
      },
    });

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://alice.example/post" && init?.method !== "POST") {
        return new Response("<html></html>", {
          status: 200,
          headers: { link: '<https://alice.example/wm>; rel="webmention"' },
        });
      }
      if (u === "https://alice.example/wm" && init?.method === "POST") {
        return new Response("", { status: 202 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await sendWebmentionsForSite({
      distDir: join(dir, "dist"),
      siteUrl: "https://mysite.example",
      ledgerPath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupImpl: vi.fn(async () => ({ address: "93.184.216.34", family: 4 })),
    });

    expect(result).toEqual({ sent: 1, noEndpoint: 0, failed: 0, blocked: 0, skipped: 1 });

    const ledger = loadLedger(ledgerPath);
    expect(ledger["https://mysite.example/blog/hello/|https://alice.example/post"].status).toBe(
      "sent",
    );
    // Bob was already recorded and must not have been re-fetched.
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("bob.example"),
      expect.anything(),
    );
  });

  it("blocks a target that resolves to a private address without sending", async () => {
    writePost(
      "notes/abc/index.html",
      `<article class="h-entry"><div class="e-content"><a href="https://internal.example/x">x</a></div></article>`,
    );
    const ledgerPath = join(dir, "webmention-sent.json");
    const fetchImpl = vi.fn();

    const result = await sendWebmentionsForSite({
      distDir: join(dir, "dist"),
      siteUrl: "https://mysite.example",
      ledgerPath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupImpl: vi.fn(async () => ({ address: "127.0.0.1", family: 4 })),
    });

    expect(result.blocked).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadLedger(ledgerPath)["https://mysite.example/notes/abc/|https://internal.example/x"].status).toBe(
      "failed",
    );
  });
});
