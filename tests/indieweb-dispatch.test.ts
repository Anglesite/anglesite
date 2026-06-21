/**
 * Plugin-side tests for the IndieWeb runtime wiring in
 * `template/worker/site-entry.js` (issue #337, design §7):
 *
 *   - Gated endpoint dispatch — each route fires only when its binding is
 *     present, and falls through to ASSETS otherwise.
 *   - queue()/scheduled() hooks — the webmention queue consumer runs only with
 *     WEBMENTION_INBOX; the Micropub bridge sync always runs via waitUntil.
 *     (@dwk/webmention has no scheduled arm, so scheduled() only syncs the bridge.)
 *   - Webmention edge-render gating — no WEBMENTION_INBOX read and no rewrite
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

  it("routes /webmention to the Webmention handler when WEBMENTION_INBOX is bound", async () => {
    const env = makeEnv({ WEBMENTION_INBOX: {} });
    const res = await worker.fetch(
      req("/webmention", { method: "POST" }),
      env,
      makeCtx(),
    );
    expect(res.headers.get("x-handler")).toBe("webmention");
    expect(webmentionCalls.fetch).toBe(1);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("falls through /webmention to ASSETS when WEBMENTION_INBOX is absent", async () => {
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
    const env = makeEnv({ AUTH_DB: {}, MICROPUB_DB: {}, WEBMENTION_INBOX: {} });
    const res = await worker.fetch(req("/about/"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(res.headers.get("x-handler")).toBeNull();
  });
});

describe("queue() and scheduled() dispatch", () => {
  it("queue() runs the webmention queue consumer only when WEBMENTION_INBOX is bound", async () => {
    await worker.queue({ messages: [] }, makeEnv({ WEBMENTION_INBOX: {} }), makeCtx());
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

  it("scheduled() does NOT invoke the webmention consumer (the package has no scheduled arm)", async () => {
    await worker.scheduled({}, makeEnv({ WEBMENTION_INBOX: {} }), makeCtx());
    expect(webmentionCalls.queue).toBe(0);
    expect(webmentionCalls.fetch).toBe(0);
  });

  it("scheduled() always schedules the Micropub bridge sync via waitUntil", async () => {
    const ctx = makeCtx();
    await worker.scheduled({}, makeEnv(), ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

describe("SITE_URL guard", () => {
  // An empty baseUrl makes @dwk/webmention reject every inbound mention silently.
  it("warns once when WEBMENTION_INBOX is bound but SITE_URL is empty", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = makeEnv({ WEBMENTION_INBOX: {} }); // no SITE_URL
    await worker.queue({ messages: [] }, env, makeCtx());
    expect(err).toHaveBeenCalledWith(expect.stringContaining("SITE_URL"));
    err.mockRestore();
  });

  it("does not warn when SITE_URL is set", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = makeEnv({
      WEBMENTION_INBOX: {},
      SITE_URL: "https://example.com",
    });
    await worker.queue({ messages: [] }, env, makeCtx());
    expect(err).not.toHaveBeenCalledWith(expect.stringContaining("SITE_URL"));
    err.mockRestore();
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

  // The edge-render reads through the rich inbox (createRichWebmentionInbox),
  // which runs `db.prepare(sql).all()` against the WEBMENTION_INBOX D1 binding —
  // a no-WHERE SELECT for the known-target set and a `WHERE target = ?1` SELECT
  // (via `bind`) per page, after an `ensureSchema` CREATE TABLE. This fake routes
  // by SQL and serves the rows. The worker caches the target set per inbox
  // object, so each test's fresh fake starts cold.
  function webmentionInbox(mentionsByTarget: Record<string, { source: string }[]>) {
    const makeRow = (source: string, t: string) => ({
      source,
      target: t,
      verified_at: 1717200000000,
      author_name: null,
      author_url: null,
      author_photo: null,
      content: null,
      url: source,
      type: "mention",
      published: null,
    });
    const allRows = () =>
      Object.entries(mentionsByTarget).flatMap(([t, arr]) =>
        arr.map((m) => makeRow(m.source, t)),
      );
    const setScan = vi.fn(async () => ({ results: allRows() }));
    const bind = vi.fn((t: string) => ({
      all: async () => ({
        results: (mentionsByTarget[t] ?? []).map((m) => makeRow(m.source, t)),
      }),
    }));
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("CREATE TABLE")) return { run: async () => ({}) };
      if (sql.includes("WHERE target")) return { bind };
      return { all: setScan }; // no-WHERE SELECT — the known-target set scan
    });
    // How many times the worker ran the "all targets" set scan.
    const setQueries = () => setScan.mock.calls.length;
    return { db: { prepare }, prepare, bind, setQueries };
  }

  it("queries the inbox and rewrites a note/blog page that has stored mentions", async () => {
    for (const path of ["/notes/abc/", "/blog/my-post/"]) {
      rewriteUsed = false;
      const target = `https://example.com${path}`;
      const { db, bind } = webmentionInbox({
        [target]: [{ source: "https://alice.example/reply/1" }],
      });
      const env = makeEnv({ WEBMENTION_INBOX: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());

      expect(bind, path).toHaveBeenCalledWith(target);
      expect(rewriteUsed, path).toBe(true);
    }
  });

  it("does NOT query mentions or rewrite when the page has no stored mentions", async () => {
    const { db, bind } = webmentionInbox({
      "https://example.com/notes/other/": [{ source: "https://alice.example" }],
    });
    const env = makeEnv({ WEBMENTION_INBOX: db });
    const res = await worker.fetch(
      req("/notes/abc/", { accept: "text/html" }),
      env,
      makeCtx(),
    );

    // The page isn't in the known-target set, so no per-target query runs.
    expect(bind).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
    // Response passes through untouched.
    expect(res.headers.get("x-asset")).toBe("1");
  });

  it("caches the known-target set — one list() across requests", async () => {
    const { db, setQueries } = webmentionInbox({});
    const env = makeEnv({ WEBMENTION_INBOX: db });
    await worker.fetch(req("/notes/a/", { accept: "text/html" }), env, makeCtx());
    await worker.fetch(req("/notes/b/", { accept: "text/html" }), env, makeCtx());
    expect(setQueries()).toBe(1);
  });

  it("does NOT query for non-target paths (home, about)", async () => {
    for (const path of ["/", "/about/", "/contact/"]) {
      const { db, prepare } = webmentionInbox({
        "https://example.com/notes/abc/": [{ source: "https://bob.example" }],
      });
      const env = makeEnv({ WEBMENTION_INBOX: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());
      expect(prepare, path).not.toHaveBeenCalled();
      expect(rewriteUsed, path).toBe(false);
    }
  });

  it("does NOT query the collection index — only permalinks are targets", async () => {
    for (const path of ["/notes", "/notes/", "/blog", "/blog/"]) {
      const { db, prepare } = webmentionInbox({
        "https://example.com/notes/abc/": [{ source: "https://bob.example" }],
      });
      const env = makeEnv({ WEBMENTION_INBOX: db });
      await worker.fetch(req(path, { accept: "text/html" }), env, makeCtx());
      expect(prepare, path).not.toHaveBeenCalled();
    }
  });

  it("does NOT query when WEBMENTION_INBOX is unbound", async () => {
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
    const { db, prepare } = webmentionInbox({
      "https://example.com/notes/abc/": [{ source: "https://bob.example" }],
    });
    const env = makeEnv({
      WEBMENTION_INBOX: db,
      ASSETS: {
        fetch: vi.fn(async () => assetsResponse("{}", "application/json")),
      },
    });
    await worker.fetch(req("/notes/abc/", { accept: "text/html" }), env, makeCtx());
    expect(prepare).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
  });

  it("does NOT query for non-HTML requests (no Accept: text/html)", async () => {
    const { db, prepare } = webmentionInbox({
      "https://example.com/notes/abc/": [{ source: "https://bob.example" }],
    });
    const env = makeEnv({ WEBMENTION_INBOX: db });
    await worker.fetch(req("/notes/abc/"), env, makeCtx());
    expect(prepare).not.toHaveBeenCalled();
    expect(rewriteUsed).toBe(false);
  });
});
