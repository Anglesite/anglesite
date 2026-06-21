/**
 * Plugin-side tests for the IndieWeb runtime wiring in the SHIPPED default
 * `template/worker/site-entry.js` (issues #337, #363):
 *
 *   - IndieAuth + Micropub routes report 501 while their wiring is pending the
 *     auth follow-up — the Worker boots and never crashes on missing config.
 *   - Webmention is NOT wired in the default template: `/anglesite:indieweb`
 *     injects it (import + dispatch + queue drain + edge-render) at the
 *     `@anglesite-inject:*` sentinels when the owner enables Webmention. The
 *     default worker therefore falls every IndieWeb-shaped request through to
 *     ASSETS, and queue()/scheduled() only run the Micropub bridge sync.
 *   - The integrated webmention behavior is covered in webmention-module.test.ts
 *     (handler, queue drain, edge-render, mf2 parse) against worker/webmention.js.
 *
 * This file also guards the injection sentinels so the skill's anchors can't
 * silently disappear.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../template/worker/site-entry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteEntrySource = readFileSync(
  join(__dirname, "..", "template", "worker", "site-entry.js"),
  "utf-8",
);

function makeCtx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}

function assetsResponse(
  body = "<html><body>asset</body></html>",
  contentType = "text/html",
) {
  return new Response(body, {
    headers: { "content-type": contentType, "x-asset": "1" },
  });
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: vi.fn(async () => assetsResponse()) },
    ...overrides,
  } as any;
}

function req(
  path: string,
  { method = "GET", accept }: { method?: string; accept?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (accept) headers.Accept = accept;
  return new Request(`https://example.com${path}`, { method, headers });
}

describe("IndieAuth / Micropub dispatch (wiring pending — 501)", () => {
  it("reports 501 for /auth when AUTH_DB is bound, without crashing or hitting ASSETS", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/auth"), env, makeCtx());
    expect(res.status).toBe(501);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("reports 501 for any /auth subpath (e.g. /auth/token)", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/auth/token"), env, makeCtx());
    expect(res.status).toBe(501);
  });

  it("falls /auth through to ASSETS when AUTH_DB is absent", async () => {
    const env = makeEnv();
    const res = await worker.fetch(req("/auth"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-asset")).toBe("1");
  });

  it("reports 501 for /micropub and /media when MICROPUB_DB is bound", async () => {
    for (const path of ["/micropub", "/media"]) {
      const env = makeEnv({ MICROPUB_DB: {} });
      const res = await worker.fetch(req(path), env, makeCtx());
      expect(res.status, path).toBe(501);
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    }
  });

  it("falls /micropub through to ASSETS when MICROPUB_DB is absent", async () => {
    const env = makeEnv();
    const res = await worker.fetch(req("/micropub"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.status).not.toBe(501);
  });

  it("routes are independent: AUTH_DB alone does not affect /micropub", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/micropub"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.status).not.toBe(501);
  });
});

describe("Webmention is not wired in the default template", () => {
  it("falls /webmention through to ASSETS even when WEBMENTION_DB is bound", async () => {
    const env = makeEnv({ WEBMENTION_DB: {} });
    const res = await worker.fetch(
      req("/webmention", { method: "POST" }),
      env,
      makeCtx(),
    );
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-asset")).toBe("1");
  });

  it("does not rewrite note/post pages (edge-render is injected, not default)", async () => {
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
    (globalThis as any).HTMLRewriter = FakeHTMLRewriter;
    try {
      const env = makeEnv({ WEBMENTION_DB: {} });
      const res = await worker.fetch(
        req("/notes/abc/", { accept: "text/html" }),
        env,
        makeCtx(),
      );
      expect(rewriteUsed).toBe(false);
      expect(res.headers.get("x-asset")).toBe("1");
    } finally {
      delete (globalThis as any).HTMLRewriter;
    }
  });
});

describe("queue() and scheduled() in the default template", () => {
  it("queue() runs only the Micropub bridge sync (no webmention drain wired)", async () => {
    const ctx = makeCtx();
    await worker.queue({ messages: [] }, makeEnv({ WEBMENTION_DB: {} }), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });

  it("scheduled() runs the Micropub bridge sync via waitUntil", async () => {
    const ctx = makeCtx();
    await worker.scheduled({}, makeEnv(), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

describe("webmention injection sentinels (skill anchor contract)", () => {
  it("ships all four @anglesite-inject sentinels the indieweb skill targets", () => {
    for (const id of [
      "webmention-import",
      "webmention-dispatch",
      "webmention-render",
      "webmention-queue",
    ]) {
      expect(siteEntrySource, id).toContain(`/* @anglesite-inject:${id} */`);
    }
  });
});
