/**
 * Export form submissions from `src/content/submissions/` to a CSV file.
 *
 * One row per submission. Columns are the union of every entry `key`
 * encountered across the inbox, plus the standard metadata columns
 * (`id`, `formSlug`, `submittedAt`, `status`, `senderName`, `senderEmail`).
 *
 * Filter to a single form with `--slug=<slug>`, or by status
 * (`--status=new|archived|spam`). Restrict to a date range with
 * `--since=YYYY-MM-DD`.
 *
 * Usage:
 *   npm run ai-inbox-export -- --slug=lead --status=new
 *   npm run ai-inbox-export -- --since=2026-01-01 > leads.csv
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

interface Entry {
  key: string;
  label?: string;
  type?: string;
  value: string;
}

interface Submission {
  id: string;
  formSlug: string;
  formTitle?: string;
  submittedAt: string;
  status?: string;
  senderName?: string;
  senderEmail?: string;
  ip?: string;
  entries: Entry[];
}

const SUBMISSIONS_DIR = resolve(process.cwd(), "src/content/submissions");

interface Options {
  slug?: string;
  status?: string;
  since?: string;
  out?: string;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {};
  for (const arg of argv) {
    const m = arg.match(/^--(slug|status|since|out)=(.+)$/);
    if (m) opts[m[1] as keyof Options] = m[2];
  }
  return opts;
}

function parseFrontmatter(raw: string): Submission | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const body = match[1];
  const lines = body.split("\n");
  const out: Record<string, unknown> = { entries: [] };
  let inEntries = false;
  let currentEntry: Partial<Entry> | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line === "entries:") {
      inEntries = true;
      continue;
    }
    if (inEntries) {
      const dashMatch = line.match(/^\s*-\s*key:\s*(.*)$/);
      if (dashMatch) {
        if (currentEntry) (out.entries as Entry[]).push(currentEntry as Entry);
        currentEntry = { key: unquote(dashMatch[1]) };
        continue;
      }
      const kvMatch = line.match(/^\s+(label|type|value):\s*(.*)$/);
      if (kvMatch && currentEntry) {
        const key = kvMatch[1] as keyof Entry;
        (currentEntry as Record<string, string>)[key] = unquote(kvMatch[2]);
        continue;
      }
      // a blank or non-matching line ends entries parsing
      const topLevel = line.match(/^(\w+):\s*(.*)$/);
      if (topLevel) {
        if (currentEntry) {
          (out.entries as Entry[]).push(currentEntry as Entry);
          currentEntry = null;
        }
        inEntries = false;
        out[topLevel[1]] = unquote(topLevel[2]);
        continue;
      }
    } else {
      const topLevel = line.match(/^(\w+):\s*(.*)$/);
      if (topLevel) out[topLevel[1]] = unquote(topLevel[2]);
    }
  }
  if (currentEntry) (out.entries as Entry[]).push(currentEntry as Entry);
  if (!out.id || !out.formSlug || !out.submittedAt) return null;
  return out as unknown as Submission;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

export function readSubmissions(dir: string = SUBMISSIONS_DIR): Submission[] {
  if (!existsSync(dir)) return [];
  const items: Submission[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mdoc")) continue;
    const raw = readFileSync(join(dir, file), "utf-8");
    const sub = parseFrontmatter(raw);
    if (sub) items.push(sub);
  }
  return items;
}

export function filterSubmissions(
  items: Submission[],
  opts: Options,
): Submission[] {
  return items.filter((s) => {
    if (opts.slug && s.formSlug !== opts.slug) return false;
    if (opts.status && (s.status ?? "new") !== opts.status) return false;
    if (opts.since) {
      const sinceMs = Date.parse(opts.since);
      if (Number.isNaN(sinceMs)) {
        throw new Error(
          `--since is not a valid ISO date: ${opts.since} (try YYYY-MM-DD).`,
        );
      }
      if (Date.parse(s.submittedAt) < sinceMs) return false;
    }
    return true;
  });
}

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(items: Submission[]): string {
  const baseColumns = [
    "id",
    "formSlug",
    "submittedAt",
    "status",
    "senderName",
    "senderEmail",
  ];
  const fieldColumnSet = new Set<string>();
  for (const s of items) {
    for (const e of s.entries ?? []) fieldColumnSet.add(e.key);
  }
  const fieldColumns = [...fieldColumnSet].sort();
  const header = [...baseColumns, ...fieldColumns];
  const rows = [header.join(",")];
  for (const s of items) {
    const lookup = new Map((s.entries ?? []).map((e) => [e.key, e.value]));
    const row = [
      s.id,
      s.formSlug,
      s.submittedAt,
      s.status ?? "new",
      s.senderName ?? "",
      s.senderEmail ?? "",
      ...fieldColumns.map((c) => lookup.get(c) ?? ""),
    ].map(csvEscape);
    rows.push(row.join(","));
  }
  return rows.join("\n") + "\n";
}

export function resolveOutPath(out: string, cwd: string = process.cwd()): string {
  // Disallow absolute paths and any traversal that escapes the project root.
  // This is a local CLI but the flag is still user input — treat it as one.
  if (isAbsolute(out)) {
    throw new Error(`--out must be a relative path inside the project (got: ${out}).`);
  }
  const target = resolve(cwd, out);
  const rel = relative(cwd, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`--out must stay inside the project (got: ${out}).`);
  }
  return target;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const items = filterSubmissions(readSubmissions(), opts);
  const csv = toCsv(items);
  if (opts.out) {
    const target = resolveOutPath(opts.out);
    writeFileSync(target, csv);
    console.error(`export-submissions: wrote ${items.length} row(s) to ${opts.out}`);
  } else {
    process.stdout.write(csv);
    console.error(`export-submissions: ${items.length} row(s)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
