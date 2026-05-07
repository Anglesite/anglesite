/**
 * Tests for the form submissions inbox: the worker logic that persists
 * submissions to KV and serves them via /inbox, plus the local CSV
 * exporter that drives `npm run ai-inbox-export`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildContactSubmission,
  newSubmissionId,
  timingSafeEqual,
  handleInboxList,
  persistSubmission,
} from "../template/worker/contact-worker.js";

import {
  buildSubmission,
  pickValue,
} from "../template/worker/forms-worker.js";

import {
  parseArgs,
  filterSubmissions,
  toCsv,
  readSubmissions,
} from "../template/scripts/export-submissions.js";

// ---------------------------------------------------------------------------
// In-memory fake of the Workers KV binding for unit testing.
// ---------------------------------------------------------------------------

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

describe("contact-worker inbox helpers", () => {
  it("newSubmissionId returns a sortable, hyphenated id", () => {
    const a = newSubmissionId();
    const b = newSubmissionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("buildContactSubmission shapes a submission record", () => {
    const sub = buildContactSubmission({
      name: "Alice",
      email: "alice@example.com",
      message: "Hi",
      ip: "1.2.3.4",
    });
    expect(sub.formSlug).toBe("contact");
    expect(sub.status).toBe("new");
    expect(sub.senderName).toBe("Alice");
    expect(sub.senderEmail).toBe("alice@example.com");
    expect(sub.entries.map((e) => e.key)).toEqual(["name", "email", "message"]);
  });

  it("persistSubmission writes to KV with structured metadata", async () => {
    const kv = fakeKv();
    const sub = buildContactSubmission({
      name: "A",
      email: "a@example.com",
      message: "hi",
      ip: "x",
    });
    await persistSubmission({ SUBMISSIONS: kv } as never, sub);
    expect(kv.store.size).toBe(1);
    const [key, value] = [...kv.store.entries()][0];
    expect(key).toBe(`submission:contact:${sub.id}`);
    expect(JSON.parse(value).formSlug).toBe("contact");
  });

  it("persistSubmission is a no-op when no SUBMISSIONS binding", async () => {
    const sub = buildContactSubmission({
      name: "A",
      email: "a@example.com",
      message: "hi",
      ip: "x",
    });
    const ok = await persistSubmission({} as never, sub);
    expect(ok).toBe(false);
  });

  it("timingSafeEqual rejects mismatched lengths and values", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("handleInboxList rejects unauthenticated requests", async () => {
    const kv = fakeKv();
    const env = { SUBMISSIONS: kv, INBOX_SECRET: "topsecret" } as never;
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox"),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("handleInboxList returns submissions sorted newest first", async () => {
    const kv = fakeKv();
    await kv.put(
      "submission:contact:1",
      JSON.stringify({
        id: "1",
        formSlug: "contact",
        submittedAt: "2026-01-01T00:00:00Z",
      }),
    );
    await kv.put(
      "submission:contact:2",
      JSON.stringify({
        id: "2",
        formSlug: "contact",
        submittedAt: "2026-02-01T00:00:00Z",
      }),
    );
    const env = { SUBMISSIONS: kv, INBOX_SECRET: "s" } as never;
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox", {
        headers: { Authorization: "Bearer s" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual(["2", "1"]);
  });

  it("handleInboxList signals 503 when no INBOX_SECRET is set", async () => {
    const kv = fakeKv();
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox"),
      { SUBMISSIONS: kv } as never,
    );
    expect(res.status).toBe(503);
  });
});

describe("forms-worker inbox helpers", () => {
  it("buildSubmission omits empty hidden fields and pulls sender info", () => {
    const form = {
      slug: "lead",
      title: "Lead",
      fields: [
        { name: "name", label: "Name", type: "text" },
        { name: "email", label: "Email", type: "email" },
        { name: "utm_source", label: "Source", type: "hidden" },
      ],
    };
    const sub = buildSubmission(
      form,
      { name: "Alice", email: "alice@example.com", utm_source: "" },
      "1.2.3.4",
    );
    expect(sub.senderName).toBe("Alice");
    expect(sub.senderEmail).toBe("alice@example.com");
    expect(sub.entries.map((e) => e.key)).toEqual(["name", "email"]);
  });

  it("pickValue ignores invalid email matches when validator is supplied", () => {
    const values = { email: "not-an-email", contact: "real@example.com" };
    expect(pickValue(values, ["email", "contact"], /^[^\s@]+@[^\s@]+\.[^\s@]+$/)).toBe(
      "real@example.com",
    );
  });
});

describe("export-submissions CSV builder", () => {
  it("parseArgs picks up flags and ignores junk", () => {
    expect(
      parseArgs(["--slug=lead", "--status=new", "--since=2026-01-01", "junk"]),
    ).toEqual({ slug: "lead", status: "new", since: "2026-01-01" });
  });

  it("filterSubmissions applies slug, status, and since", () => {
    const items = [
      {
        id: "a",
        formSlug: "lead",
        submittedAt: "2026-01-01T00:00:00Z",
        status: "new",
        entries: [],
      },
      {
        id: "b",
        formSlug: "rsvp",
        submittedAt: "2026-02-01T00:00:00Z",
        status: "new",
        entries: [],
      },
      {
        id: "c",
        formSlug: "lead",
        submittedAt: "2026-03-01T00:00:00Z",
        status: "spam",
        entries: [],
      },
    ];
    expect(filterSubmissions(items, { slug: "lead" }).map((i) => i.id)).toEqual([
      "a",
      "c",
    ]);
    expect(
      filterSubmissions(items, { status: "new", since: "2026-01-15" }).map((i) => i.id),
    ).toEqual(["b"]);
  });

  it("toCsv unions field columns and escapes problematic values", () => {
    const items = [
      {
        id: "a",
        formSlug: "lead",
        submittedAt: "2026-01-01T00:00:00Z",
        status: "new",
        senderName: "Alice",
        senderEmail: "a@example.com",
        entries: [{ key: "company", value: "Acme, Inc." }],
      },
      {
        id: "b",
        formSlug: "lead",
        submittedAt: "2026-01-02T00:00:00Z",
        status: "new",
        senderName: "Bob \"the Builder\"",
        senderEmail: "b@example.com",
        entries: [{ key: "phone", value: "555-1234" }],
      },
    ];
    const csv = toCsv(items);
    const [header, rowA, rowB] = csv.trim().split("\n");
    expect(header).toContain("company");
    expect(header).toContain("phone");
    expect(rowA).toContain('"Acme, Inc."');
    expect(rowB).toContain('"Bob ""the Builder"""');
  });

  it("readSubmissions parses mdoc files written by the fetch script", () => {
    const dir = mkdtempSync(join(tmpdir(), "anglesite-inbox-"));
    try {
      const mdoc = `---\nid: foo\nformSlug: contact\nsubmittedAt: 2026-05-06T00:00:00Z\nstatus: new\nsenderName: Alice\nsenderEmail: alice@example.com\nip: 1.2.3.4\nentries:\n  - key: name\n    label: Name\n    type: text\n    value: Alice\n  - key: message\n    label: Message\n    type: textarea\n    value: "Hello, world"\n---\n`;
      writeFileSync(join(dir, "foo.mdoc"), mdoc);
      const items = readSubmissions(dir);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("foo");
      expect(items[0].entries.map((e) => e.value)).toEqual(["Alice", "Hello, world"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Static checks on shipped templates.
// ---------------------------------------------------------------------------

const templateDir = resolve(import.meta.dirname!, "..", "template");

describe("inbox skill artifacts", () => {
  it("ships the SKILL.md", () => {
    const skill = resolve(import.meta.dirname!, "..", "skills/inbox/SKILL.md");
    expect(existsSync(skill)).toBe(true);
  });

  it("registers the submissions collection in keystatic.config.ts", () => {
    const text = readFileSync(
      resolve(templateDir, "keystatic.config.ts"),
      "utf-8",
    );
    expect(text).toMatch(/submissions:\s*collection\(/);
  });

  it("registers the submissions collection in content.config.ts", () => {
    const text = readFileSync(
      resolve(templateDir, "src/content.config.ts"),
      "utf-8",
    );
    expect(text).toMatch(/const\s+submissions\s*=\s*defineCollection/);
    expect(text).toMatch(/submissions\s*}/);
  });

  it("wires the npm scripts for fetch and export", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts["ai-inbox-fetch"]).toContain("fetch-submissions.ts");
    expect(pkg.scripts["ai-inbox-export"]).toContain("export-submissions.ts");
  });

  it("documents the KV binding in both wrangler tomls", () => {
    const contact = readFileSync(
      resolve(templateDir, "worker/wrangler.toml"),
      "utf-8",
    );
    const forms = readFileSync(
      resolve(templateDir, "worker/forms-wrangler.toml"),
      "utf-8",
    );
    expect(contact).toContain("SUBMISSIONS");
    expect(forms).toContain("SUBMISSIONS");
  });
});
