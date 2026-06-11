/**
 * Pull persisted form submissions from the contact and forms Workers
 * and write each one as a Markdoc file into `src/content/submissions/`,
 * which Keystatic surfaces as the inbox.
 *
 * The Worker exposes `GET /inbox` gated by `INBOX_SECRET` (set via
 * `wrangler secret put INBOX_SECRET`). The same secret is read locally
 * from `.env.local` so the agent never needs to handle it directly.
 *
 * Existing local files are preserved — the owner's triage edits
 * (`status`, `notes`) are never overwritten. New submissions are added,
 * stale entries left alone. Run before opening Keystatic to pick up
 * fresh submissions:
 *
 *     npm run ai-inbox-fetch
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readConfig } from "./config.js";
import { isFmAvailable, classifySubmission, FM_MODEL_ID, type SubmissionClassification } from "./fm.js";

export interface SubmissionEntry {
  key: string;
  label?: string;
  type?: string;
  value: string;
}

export interface Submission {
  id: string;
  formSlug: string;
  formTitle?: string;
  submittedAt: string;
  status?: "new" | "archived" | "spam";
  senderName?: string;
  senderEmail?: string;
  ip?: string;
  entries?: SubmissionEntry[];
}

const SUBMISSIONS_DIR = resolve(process.cwd(), "src/content/submissions");

function readSecret(): string | undefined {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf-8");
  const match = content.match(/^INBOX_SECRET=(.+)$/m);
  if (!match) return undefined;
  return match[1].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

async function fetchInbox(workerUrl: string, secret: string): Promise<Submission[]> {
  const url = new URL(workerUrl);
  url.pathname = "/inbox";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Worker ${workerUrl} responded ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { items?: Submission[] };
  return Array.isArray(data.items) ? data.items : [];
}

function listExistingIds(): Set<string> {
  if (!existsSync(SUBMISSIONS_DIR)) return new Set();
  const ids = new Set<string>();
  for (const file of readdirSync(SUBMISSIONS_DIR)) {
    if (file.endsWith(".mdoc")) ids.add(file.replace(/\.mdoc$/, ""));
  }
  return ids;
}

function escapeYaml(value: string): string {
  if (value === "") return '""';
  if (
    /^[\w\-/.@:+ ]+$/.test(value) &&
    !/^[\d-]/.test(value) &&
    !/:\s/.test(value) && // colon followed by whitespace is a YAML mapping indicator
    !/:$/.test(value) // trailing colon
  ) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function renderEntry(entry: SubmissionEntry): string {
  const lines = [
    `  - key: ${escapeYaml(entry.key)}`,
    `    label: ${escapeYaml(entry.label ?? entry.key)}`,
    `    type: ${escapeYaml(entry.type ?? "text")}`,
    `    value: ${escapeYaml(entry.value ?? "")}`,
  ];
  return lines.join("\n");
}

export function renderSubmission(
  s: Submission,
  classification?: SubmissionClassification | null,
): string {
  const status = s.status ?? "new";
  const entries = (s.entries ?? []).map(renderEntry).join("\n");
  const aiLines = classification
    ? [
        `aiCategory: ${escapeYaml(classification.category)}`,
        `aiSpam: ${classification.isSpam ? "yes" : "no"}`,
        `aiReason: ${escapeYaml(classification.reason)}`,
        `aiModel: ${escapeYaml(FM_MODEL_ID)}`,
      ]
    : [];
  return [
    "---",
    `id: ${escapeYaml(s.id)}`,
    `formSlug: ${escapeYaml(s.formSlug)}`,
    `formTitle: ${escapeYaml(s.formTitle ?? s.formSlug)}`,
    `submittedAt: ${escapeYaml(s.submittedAt)}`,
    `status: ${escapeYaml(status)}`,
    `senderName: ${escapeYaml(s.senderName ?? "")}`,
    `senderEmail: ${escapeYaml(s.senderEmail ?? "")}`,
    `ip: ${escapeYaml(s.ip ?? "")}`,
    ...aiLines,
    "entries:",
    entries,
    "---",
    "",
  ].join("\n");
}

export function buildSubmissionText(s: Submission): string {
  const lines: string[] = [`Form: ${s.formTitle ?? s.formSlug}`];
  if (s.senderName) lines.push(`From: ${s.senderName}`);
  if (s.senderEmail) lines.push(`Email: ${s.senderEmail}`);
  for (const e of s.entries ?? []) {
    const label = e.label ?? e.key;
    lines.push(`${label}: ${(e.value ?? "").slice(0, 1000)}`);
  }
  return lines.join("\n");
}

export interface TriageTally {
  classified: number;
  spam: number;
  lead: number;
  support: number;
  question: number;
  other: number;
}

export function formatTriageSummary(t: TriageTally): string {
  if (t.classified === 0) return "";
  const parts: string[] = [];
  if (t.spam) parts.push(`${t.spam} likely spam`);
  if (t.lead) parts.push(`${t.lead} lead${t.lead === 1 ? "" : "s"}`);
  if (t.support) parts.push(`${t.support} support`);
  if (t.question) parts.push(`${t.question} question${t.question === 1 ? "" : "s"}`);
  if (t.other) parts.push(`${t.other} other`);
  return `Triaged ${t.classified} new: ${parts.join(", ")}`;
}

function workerUrls(): string[] {
  const urls = new Set<string>();
  const contact = readConfig("CONTACT_WORKER_URL");
  const forms = readConfig("FORMS_WORKER_URL");
  if (contact) urls.add(contact.trim());
  if (forms) urls.add(forms.trim());
  return [...urls];
}

export async function fetchSubmissions(): Promise<{ added: number; skipped: number; triage: TriageTally }> {
  const urls = workerUrls();
  if (urls.length === 0) {
    throw new Error(
      "No contact or forms worker URL in .site-config. Run /anglesite:contact or /anglesite:forms first.",
    );
  }
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      "INBOX_SECRET not set in .env.local. Run /anglesite:inbox to set it up.",
    );
  }

  const triageEnabled =
    readConfig("INBOX_TRIAGE_AI") !== "off" && (await isFmAvailable());
  const triage: TriageTally = { classified: 0, spam: 0, lead: 0, support: 0, question: 0, other: 0 };

  if (!existsSync(SUBMISSIONS_DIR)) {
    mkdirSync(SUBMISSIONS_DIR, { recursive: true });
  }

  const existing = listExistingIds();
  const seen = new Set<string>();
  let added = 0;
  let skipped = 0;

  for (const url of urls) {
    let items: Submission[];
    try {
      items = await fetchInbox(url, secret);
    } catch (err) {
      console.warn(`fetch-submissions: ${(err as Error).message}`);
      continue;
    }
    for (const item of items) {
      if (!item.id || !item.formSlug) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (existing.has(item.id)) {
        skipped++;
        continue;
      }
      let classification: SubmissionClassification | null = null;
      if (triageEnabled) {
        classification = await classifySubmission(buildSubmissionText(item));
        if (classification) {
          triage.classified++;
          if (classification.isSpam) triage.spam++;
          else triage[classification.category]++;
        }
      }
      const path = join(SUBMISSIONS_DIR, `${item.id}.mdoc`);
      writeFileSync(path, renderSubmission(item, classification));
      added++;
    }
  }

  return { added, skipped, triage };
}

async function main(): Promise<void> {
  const result = await fetchSubmissions();
  console.log(
    `fetch-submissions: ${result.added} new, ${result.skipped} already on disk`,
  );
  const summary = formatTriageSummary(result.triage);
  if (summary) console.log(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
