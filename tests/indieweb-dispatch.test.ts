/**
 * Plugin-side tests for the IndieWeb runtime wiring in
 * `template/worker/site-entry.js` (issue #337, design §7):
 *
 *   - Gated endpoint dispatch — each route fires only when its binding is
 *     present, and falls through to ASSETS otherwise.
 *   - queue()/scheduled() hooks — webmention drain runs only with
 *     WEBMENTION_DB; the Micropub bridge sync always runs via waitUntil.
 *   - Webmention edge-render gating — no WEBMENTION_DB query and no rewrite
 *     unless the request is for a note/post HTML page that actually has
 *     stored mentions.
 *
 * The @dwk/* handlers are unpublished; vitest aliases them to tagged stubs
 * (tests/__stubs__/dwk-*.ts) so the real worker imports cleanly and each
 * dispatch target is identifiable by its `x-handler` response header.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../template/worker/site-entry.js";
import {
  webmentionCalls,
  resetWebmentionCalls,
} from "./__stubs__/dwk-webmention";

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

beforeEach(() => {
  resetWebmentionCalls();
});

describe("IndieWeb endpoint dispatch (gated on bindings)", () => {
  it("routes /auth to the IndieAuth handler when AUTH_DB is bound", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/auth"), env, makeCtx());
    expect(res.headers.get("x-handler")).toBe("indieauth");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("routes any /auth subpath (e.g. /auth/token) to IndieAuth", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/auth/token"), env, makeCtx());
    expect(res.headers.get("x-handler")).toBe("indieauth");
  });

  it("falls through /auth to ASSETS when AUTH_DB is absent", async () => {
    const env = makeEnv();
    const res = await worker.fetch(req("/auth"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-asset")).toBe("1");
    expect(res.headers.get("x-handler")).toBeNull();
  });

  it("routes /micropub and /media to Micropub when MICROPUB_DB is bound", async () => {
    for (const path of ["/micropub", "/media"]) {
      const env = makeEnv({ MICROPUB_DB: {} });
      const res = await worker.fetch(req(path), env, makeCtx());
      expect(res.headers.get("x-handler"), path).toBe("micropub");
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    }
  });

  it("falls through /micropub to ASSETS when MICROPUB_DB is absent", async () => {
    const env = makeEnv();
    const res = await worker.fetch(req("/micropub"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
  });

  it("routes /webmention to the Webmention handler when WEBMENTION_DB is bound", async () => {
    const env = makeEnv({ WEBMENTION_DB: {} });
    const res = await worker.fetch(
      req("/webmention", { method: "POST" }),
      env,
      makeCtx(),
    );
    expect(res.headers.get("x-handler")).toBe("webmention");
    expect(webmentionCalls.fetch).toBe(1);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("falls through /webmention to ASSETS when WEBMENTION_DB is absent", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req("/webmention", { method: "POST" }),
      env,
      makeCtx(),
    );
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
    expect(webmentionCalls.fetch).toBe(0);
  });

  it("routes are independent: AUTH_DB alone does not enable /micropub", async () => {
    const env = makeEnv({ AUTH_DB: {} });
    const res = await worker.fetch(req("/micropub"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
  });

  it("unknown paths always fall through to ASSETS even with every binding set", async () => {
    const env = makeEnv({ AUTH_DB: {}, MICROPUB_DB: {}, WEBMENTION_DB: {} });
    const res = await worker.fetch(req("/about/"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
  });
});

describe("queue() and scheduled() dispatch", () => {
  it("queue() drains the webmention queue only when WEBMENTION_DB is bound", async () => {
    await worker.queue({ messages: [] }, makeEnv({ WEBMENTION_DB: {} }), makeCtx());
    expect(webmentionCalls.queue).toBe(1);

    resetWebmentionCalls();
    await worker.queue({ messages: [] }, makeEnv(), makeCtx());
    expect(webmentionCalls.queue).toBe(0);
  });

  it("queue() always schedules the Micropub bridge sync via waitUntil", async () => {
    const ctx = makeCtx();
    await worker.queue({ messages: [] }, makeEnv(), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });

  it("scheduled() runs the webmention cron only when WEBMENTION_DB is bound", async () => {
    await worker.scheduled({}, makeEnv({ WEBMENTION_DB: {} }), makeCtx());
    expect(webmentionCalls.scheduled).toBe(1);

    resetWebmentionCalls();
    await worker.scheduled({}, makeEnv(), makeCtx());
    expect(webmentionCalls.scheduled).toBe(0);
  });

  it("scheduled() always schedules the Micropub bridge sync via waitUntil", async () => {
    const ctx = makeCtx();
    await worker.scheduled({}, makeEnv(), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

describe("Webmention edge-render gating", () => {
  // site-entry.js calls `new HTMLRewriter()` only when it decides to inject.
  // The Node test runtime has no HTMLRewriter, so we install a fake that
  // records whether a rewrite was attempted — that flag is the assertion.
  let rewriteUsed = false;

  class FakeHTMLRewriter {
    on() {
      return this;
    }
    transform(response: Response) {
      rewriteUsed = true;
      return response;
    }
  }

  beforeEach(() => {
    rewriteUsed = false;
    (globalThis as any).HTMLRewriter = FakeHTMLRewriter;
  });

  afterEach(() => {
    delete (globalThis as any).HTMLRewriter;
  });

  function webmentionDb(results: unknown[]) {
    const all = vi.fn(async () => ({ results }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    return { db: { prepare }, prepare, bind, all };
  }

  it("queries D1 and rewrites a note/blog page that has stored mentions", async () => {
    for (const path of ["/notes/abc/", "/blog/my-post/"]) {
      rewriteUsed = false;
      const { db, prepare, bind } = webmentionDb([
        {
          author_name: "Alice",
          author_url: "https://alice.example",
          content: "Great post!",
          url: "https://alice.example/reply/1",
          type: "in-reply-to",
          published: "2026-06-01T00:00:00Z",
        },
      ]);
      const env = makeEnv({ WEBMENTION_DB: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());

      expect(prepare, path).toHaveBeenCalledOnce();
      expect(bind, path).toHaveBeenCalledWith(`https://example.com${path}`);
      expect(rewriteUsed, path).toBe(true);
    }
  });

  it("queries but does NOT rewrite when the target page has no mentions", async () => {
    const { db, prepare } = webmentionDb([]);
    const env = makeEnv({ WEBMENTION_DB: db });
    const res = await worker.fetch(
      req("/notes/abc/", { accept: "text/html" }),
      env,
      makeCtx(),
    );

    expect(prepare).toHaveBeenCalledOnce();
    expect(rewriteUsed).toBe(false);
    // Response passes through untouched.
    expect(res.headers.get("x-asset")).toBe("1");
  });

  it("does NOT query for non-target paths (home, about)", async () => {
    for (const path of ["/", "/about/", "/contact/"]) {
      const { db, prepare } = webmentionDb([{ author_name: "Bob" }]);
      const env = makeEnv({ WEBMENTION_DB: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());
      expect(prepare, path).not.toHaveBeenCalled();
      expect(rewriteUsed, path).toBe(false);
    }
  });

  it("does NOT query the collection index — only permalinks are targets", async () => {
    for (const path of ["/notes", "/notes/", "/blog", "/blog/"]) {
      const { db, prepare } = webmentionDb([{ author_name: "Bob" }]);
      const env = makeEnv({ WEBMENTION_DB: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());
      expect(prepare, path).not.toHaveBeenCalled();
    }
  });

  it("does NOT query when WEBMENTION_DB is unbound", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      req("/notes/abc/", { accept: "text/html" }),
      env,
      makeCtx(),
    );
    expect(rewriteUsed).toBe(false);
    expect(res.headers.get("x-asset")).toBe("1");
  });

  it("does NOT query non-HTML responses even on a target path", async () => {
    const { db, prepare } = webmentionDb([{ author_name: "Bob" }]);
    const env = makeEnv({
      WEBMENTION_DB: db,
      ASSETS: {
        fetch: vi.fn(async () => assetsResponse("{}", "application/json")),
      },
    });
    await worker.fetch(req("/notes/abc/", { accept: "text/html" }), env, makeCtx());
    expect(prepare).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
  });

  it("does NOT query for non-HTML requests (no Accept: text/html)", async () => {
    const { db, prepare } = webmentionDb([{ author_name: "Bob" }]);
    const env = makeEnv({ WEBMENTION_DB: db });
    await worker.fetch(req("/notes/abc/"), env, makeCtx());
    expect(prepare).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
  });
});
