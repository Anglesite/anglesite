/**
 * Rich Webmention inbox (worker/webmention-inbox.js) — the drop-in InboxStore
 * that upgrades @dwk/webmention's source/target-only default to full mention
 * cards (Anglesite/anglesite#363, rich author cards). Covers mf2 extraction
 * against the real microformats-parser, the store→fetch→parse→upsert path, and
 * schema-creation resilience.
 *
 * @dwk/webmention is aliased to a stub whose `safeFetch` delegates to the
 * injected `fetchImpl`, so a test can serve canned source HTML.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseMention,
  createRichWebmentionInbox,
} from "../template/worker/webmention-inbox.js";

const TARGET = "https://example.com/notes/abc/";

const REPLY_HTML = `
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

describe("parseMention() — microformats2 extraction", () => {
  it("extracts a reply with author h-card, content, permalink, and published", () => {
    const m = parseMention(REPLY_HTML, {
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

  it("classifies like-of and repost-of", () => {
    const like = parseMention(
      `<div class="h-entry"><a class="u-like-of" href="${TARGET}">♥</a></div>`,
      { source: "https://x.example/l", target: TARGET },
    );
    expect(like.type).toBe("like");
    const repost = parseMention(
      `<div class="h-entry"><a class="u-repost-of" href="${TARGET}">RT</a></div>`,
      { source: "https://x.example/r", target: TARGET },
    );
    expect(repost.type).toBe("repost");
  });

  it("defaults to 'mention' and falls back to the source URL when unparseable", () => {
    const m = parseMention("", { source: "https://x.example/p", target: TARGET });
    expect(m.type).toBe("mention");
    expect(m.url).toBe("https://x.example/p");
    expect(m.author_name).toBeUndefined();
  });
});

describe("createRichWebmentionInbox()", () => {
  // Captures the bound args of the INSERT…UPSERT; SELECT/DELETE are no-ops.
  function captureDb({ failFirstCreate = false } = {}) {
    let createCalls = 0;
    const upserts: unknown[][] = [];
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("CREATE TABLE")) {
        return {
          run: async () => {
            createCalls++;
            if (failFirstCreate && createCalls === 1) throw new Error("transient D1");
            return {};
          },
        };
      }
      if (sql.startsWith("INSERT")) {
        return {
          bind: (...args: unknown[]) => {
            upserts.push(args);
            return { run: async () => ({}) };
          },
        };
      }
      return { bind: () => ({ run: async () => ({}) }) };
    });
    return { db: { prepare }, upserts, createCalls: () => createCalls };
  }

  it("fetches the source, parses mf2, and upserts a rich row", async () => {
    const { db, upserts } = captureDb();
    const fetchImpl = vi.fn(async () =>
      new Response(REPLY_HTML, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const inbox = createRichWebmentionInbox(db as any, { fetchImpl });

    await inbox.store({
      source: "https://alice.example/reply/1",
      target: TARGET,
      verifiedAt: 1717200000000,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    // bind order: source, target, author_name, author_url, author_photo,
    // content, url, type, published, verified_at.
    const row = upserts[0];
    expect(row[0]).toBe("https://alice.example/reply/1");
    expect(row[1]).toBe(TARGET);
    expect(row[2]).toBe("Alice");
    expect(row[3]).toBe("https://alice.example/");
    expect(row[4]).toBe("https://alice.example/me.jpg");
    expect(row[5]).toBe("Great post!");
    expect(row[7]).toBe("reply");
    expect(row[9]).toBe(1717200000000);
  });

  it("degrades to a source/target row when the source fetch fails", async () => {
    const { db, upserts } = captureDb();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    });
    const inbox = createRichWebmentionInbox(db as any, { fetchImpl });

    await inbox.store({ source: "https://x.example/p", target: TARGET, verifiedAt: 1 });

    const row = upserts[0];
    expect(row[2]).toBeNull(); // author_name
    expect(row[6]).toBe("https://x.example/p"); // url falls back to source
    expect(row[7]).toBe("mention");
  });

  it("retries CREATE TABLE after a transient failure instead of wedging", async () => {
    const { db, createCalls } = captureDb({ failFirstCreate: true });
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const inbox = createRichWebmentionInbox(db as any, { fetchImpl });
    const mention = { source: "https://x.example/a", target: TARGET, verifiedAt: 1 };

    await expect(inbox.store(mention)).rejects.toThrow("transient D1");
    await expect(inbox.store(mention)).resolves.toBeUndefined();
    expect(createCalls()).toBe(2);
  });

  it("list(target) maps D1 rows to rich mention objects", async () => {
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("CREATE TABLE")) return { run: async () => ({}) };
        return {
          bind: () => ({
            all: async () => ({
              results: [
                {
                  source: "https://alice.example/reply/1",
                  target: TARGET,
                  author_name: "Alice",
                  author_url: "https://alice.example/",
                  author_photo: null,
                  content: "Hi",
                  url: "https://alice.example/reply/1",
                  type: "reply",
                  published: "2026-06-01T00:00:00Z",
                  verified_at: 1717200000000,
                },
              ],
            }),
          }),
        };
      },
    };
    const inbox = createRichWebmentionInbox(db as any);
    const rows = await inbox.list(TARGET);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      author_name: "Alice",
      type: "reply",
      verifiedAt: 1717200000000,
      content: "Hi",
    });
  });
});
