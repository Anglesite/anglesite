/**
 * Tests for the form submissions inbox: the worker logic that persists
 * submissions to D1 (ADR-0019) and serves them via /inbox, plus the
 * local CSV exporter that drives `npm run ai-inbox-export`.
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
// In-memory fake of the Cloudflare D1 binding for unit testing.
// Implements just enough of the prepared-statement API for our two queries:
// the INSERT used by `persistSubmission` and the parameterised SELECT used
// by `handleInboxList`.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  form_slug: string;
  form_title: string | null;
  submitted_at: string;
  submitted_at_ms: number;
  status: string;
  sender_name: string | null;
  sender_email: string | null;
  ip: string | null;
  payload: string;
}

function fakeD1() {
  const rows: Row[] = [];
  function prepare(sql: string) {
    let binds: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        binds = values;
        return stmt;
      },
      async run() {
        if (sql.trim().toUpperCase().startsWith("INSERT")) {
          const [
            id,
            form_slug,
            form_title,
            submitted_at,
            submitted_at_ms,
            status,
            sender_name,
            sender_email,
            ip,
            payload,
          ] = binds as [
            string,
            string,
            string | null,
            string,
            number,
            string,
            string | null,
            string | null,
            string | null,
            string,
          ];
          if (rows.some((r) => r.id === id)) {
            return { meta: {} };
          }
          rows.push({
            id,
            form_slug,
            form_title,
            submitted_at,
            submitted_at_ms,
            status,
            sender_name,
            sender_email,
            ip,
            payload,
          });
        }
        return { meta: {} };
      },
      async all() {
        let results = [...rows];
        const whereMatch = sql.match(/WHERE\s+(.+?)\s+ORDER BY/i);
        if (whereMatch) {
          const parts = whereMatch[1].split(/\s+AND\s+/i);
          parts.forEach((part, i) => {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (!colMatch) return;
            const col = colMatch[1] as keyof Row;
            const val = binds[i];
            results = results.filter((r) => r[col] === val);
          });
        }
        if (/ORDER BY submitted_at_ms DESC/i.test(sql)) {
          results.sort((a, b) => b.submitted_at_ms - a.submitted_at_ms);
        }
        return { results };
      },
    };
    return stmt;
  }
  return { rows, prepare };
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

  it("persistSubmission writes a row to D1", async () => {
    const db = fakeD1();
    const sub = buildContactSubmission({
      name: "A",
      email: "a@example.com",
      message: "hi",
      ip: "x",
    });
    await persistSubmission({ INBOX_DB: db } as never, sub);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].id).toBe(sub.id);
    expect(db.rows[0].form_slug).toBe("contact");
    const payload = JSON.parse(db.rows[0].payload);
    expect(payload.map((e: { key: string }) => e.key)).toEqual([
      "name",
      "email",
      "message",
    ]);
  });

  it("persistSubmission is a no-op when no INBOX_DB binding", async () => {
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
    const db = fakeD1();
    const env = { INBOX_DB: db, INBOX_SECRET: "topsecret" } as never;
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox"),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("handleInboxList returns submissions sorted newest first", async () => {
    const db = fakeD1();
    db.rows.push({
      id: "1",
      form_slug: "contact",
      form_title: "Contact",
      submitted_at: "2026-01-01T00:00:00Z",
      submitted_at_ms: Date.parse("2026-01-01T00:00:00Z"),
      status: "new",
      sender_name: null,
      sender_email: null,
      ip: null,
      payload: "[]",
    });
    db.rows.push({
      id: "2",
      form_slug: "contact",
      form_title: "Contact",
      submitted_at: "2026-02-01T00:00:00Z",
      submitted_at_ms: Date.parse("2026-02-01T00:00:00Z"),
      status: "new",
      sender_name: null,
      sender_email: null,
      ip: null,
      payload: "[]",
    });
    const env = { INBOX_DB: db, INBOX_SECRET: "s" } as never;
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
    const db = fakeD1();
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox"),
      { INBOX_DB: db } as never,
    );
    expect(res.status).toBe(503);
  });

  it("handleInboxList signals 501 when no INBOX_DB binding is present", async () => {
    const res = await handleInboxList(
      new Request("https://example.workers.dev/inbox"),
      { INBOX_SECRET: "s" } as never,
    );
    expect(res.status).toBe(501);
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

  it("documents the D1 binding in both wrangler tomls", () => {
    const contact = readFileSync(
      resolve(templateDir, "worker/wrangler.toml"),
      "utf-8",
    );
    const forms = readFileSync(
      resolve(templateDir, "worker/forms-wrangler.toml"),
      "utf-8",
    );
    expect(contact).toContain("INBOX_DB");
    expect(contact).toContain("d1_databases");
    expect(forms).toContain("INBOX_DB");
    expect(forms).toContain("d1_databases");
  });

  it("ships the schema.sql with the submissions table", () => {
    const sql = readFileSync(
      resolve(templateDir, "worker/schema.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS submissions/);
    expect(sql).toMatch(/idx_form_date/);
    expect(sql).toMatch(/idx_status_date/);
  });

  it("registers the migrate-kv-to-d1 script in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(templateDir, "package.json"), "utf-8"),
    );
    expect(pkg.scripts["ai-inbox-migrate"]).toContain("migrate-kv-to-d1.ts");
  });
});
