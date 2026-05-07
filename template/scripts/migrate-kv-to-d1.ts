/**
 * One-shot migration helper that copies form submissions from a legacy
 * Workers KV namespace (the original inbox backend) into the new D1
 * database. See ADR-0019 for context on why the storage moved.
 *
 * The script is idempotent: each row is inserted with `OR IGNORE` so
 * re-running after a partial failure (or after the owner accidentally
 * runs it twice) is safe and converges on the same result.
 *
 * Usage:
 *   npm run ai-inbox-migrate -- --dry-run    # report row count, write nothing
 *   npm run ai-inbox-migrate                  # commit
 *
 * Requires:
 *   - `INBOX_KV_ID` in `.site-config` (legacy KV namespace ID)
 *   - `INBOX_DB_ID` in `.site-config` (new D1 database ID)
 *   - `wrangler` available locally and authenticated to the right account
 *
 * @module
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readConfig } from "./config.js";

interface SubmissionEntry {
  key: string;
  label?: string;
  type?: string;
  value: string;
}

interface KvSubmission {
  id: string;
  formSlug: string;
  formTitle?: string;
  submittedAt: string;
  status?: string;
  senderName?: string;
  senderEmail?: string;
  ip?: string;
  entries?: SubmissionEntry[];
}

interface Options {
  dryRun: boolean;
  databaseName: string;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: false, databaseName: "form_submissions" };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    const m = arg.match(/^--database=(.+)$/);
    if (m) opts.databaseName = m[1];
  }
  return opts;
}

interface KvKey {
  name: string;
}

function wranglerJson<T>(args: string[]): T {
  const out = execFileSync("npx", ["wrangler", ...args, "--json"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out) as T;
}

function listKvKeys(namespaceId: string): KvKey[] {
  const result = wranglerJson<KvKey[] | { keys: KvKey[] }>([
    "kv",
    "key",
    "list",
    `--namespace-id=${namespaceId}`,
  ]);
  if (Array.isArray(result)) return result;
  return result.keys ?? [];
}

function getKvValue(namespaceId: string, key: string): string {
  return execFileSync(
    "npx",
    [
      "wrangler",
      "kv",
      "key",
      "get",
      key,
      `--namespace-id=${namespaceId}`,
      "--remote",
    ],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] },
  );
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function buildInsert(sub: KvSubmission): string {
  const submittedAtMs = Date.parse(sub.submittedAt) || Date.now();
  const cols = [
    `'${escapeSql(sub.id)}'`,
    `'${escapeSql(sub.formSlug)}'`,
    sub.formTitle ? `'${escapeSql(sub.formTitle)}'` : "NULL",
    `'${escapeSql(sub.submittedAt)}'`,
    String(submittedAtMs),
    `'${escapeSql(sub.status ?? "new")}'`,
    sub.senderName ? `'${escapeSql(sub.senderName)}'` : "NULL",
    sub.senderEmail ? `'${escapeSql(sub.senderEmail)}'` : "NULL",
    sub.ip ? `'${escapeSql(sub.ip)}'` : "NULL",
    `'${escapeSql(JSON.stringify(sub.entries ?? []))}'`,
  ];
  return `INSERT OR IGNORE INTO submissions (id, form_slug, form_title, submitted_at, submitted_at_ms, status, sender_name, sender_email, ip, payload) VALUES (${cols.join(", ")});`;
}

export function migrate(
  opts: Options = { dryRun: false, databaseName: "form_submissions" },
): { read: number; written: number; namespaceId: string } {
  const namespaceId = readConfig("INBOX_KV_ID");
  if (!namespaceId) {
    throw new Error(
      "INBOX_KV_ID not set in .site-config — nothing to migrate. If the inbox was never on KV, this script is a no-op for you.",
    );
  }
  const databaseId = readConfig("INBOX_DB_ID");
  if (!databaseId) {
    throw new Error(
      "INBOX_DB_ID not set in .site-config — run /anglesite:inbox to create the D1 database first.",
    );
  }

  const keys = listKvKeys(namespaceId);
  const submissions: KvSubmission[] = [];
  for (const k of keys) {
    if (!k.name.startsWith("submission:")) continue;
    let raw: string;
    try {
      raw = getKvValue(namespaceId, k.name);
    } catch (err) {
      console.warn(`migrate: skipping ${k.name} — ${(err as Error).message}`);
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.id && parsed.formSlug) {
        submissions.push(parsed as KvSubmission);
      }
    } catch {
      console.warn(`migrate: skipping ${k.name} — invalid JSON`);
    }
  }

  if (opts.dryRun) {
    return { read: submissions.length, written: 0, namespaceId };
  }
  if (submissions.length === 0) {
    return { read: 0, written: 0, namespaceId };
  }

  const tmp = mkdtempSync(join(tmpdir(), "anglesite-migrate-"));
  const sqlPath = join(tmp, "migrate.sql");
  try {
    const sql = submissions.map(buildInsert).join("\n");
    writeFileSync(sqlPath, sql);
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        opts.databaseName,
        "--remote",
        `--file=${sqlPath}`,
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return { read: submissions.length, written: submissions.length, namespaceId };
}

function renamePostMigration(): void {
  // After a successful commit, soft-deprecate INBOX_KV_ID to LEGACY_INBOX_KV_ID
  // so /anglesite:check can warn about an un-deleted KV namespace and the
  // migration helper does not run again on its own.
  const path = ".site-config";
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  if (!/^INBOX_KV_ID=/m.test(content)) return;
  if (/^LEGACY_INBOX_KV_ID=/m.test(content)) {
    content = content.replace(/^INBOX_KV_ID=.*\n?/m, "");
  } else {
    content = content.replace(/^INBOX_KV_ID=/m, "LEGACY_INBOX_KV_ID=");
  }
  writeFileSync(path, content);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  let result: { read: number; written: number; namespaceId: string };
  try {
    result = migrate(opts);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(
      `migrate-kv-to-d1: would copy ${result.read} submission(s) from KV namespace ${result.namespaceId}.`,
    );
    console.log("Re-run without --dry-run to commit.");
    return;
  }

  if (result.written > 0) {
    renamePostMigration();
  }

  console.log(
    `migrate-kv-to-d1: migrated ${result.written}/${result.read} submission(s) from KV namespace ${result.namespaceId}.`,
  );
  if (result.written > 0) {
    console.log(
      "Renamed INBOX_KV_ID → LEGACY_INBOX_KV_ID in .site-config. Delete the KV namespace from the Cloudflare dashboard when ready.",
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
