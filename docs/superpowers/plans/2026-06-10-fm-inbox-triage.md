# On-device Inbox Triage via Apple Foundation Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During `npm run ai-inbox-fetch`, classify each new form submission on-device (spam likelihood + lead/support/question/other category) and write advisory `aiCategory`/`aiSpam`/`aiReason` fields, with a Claude-relayed triage summary — falling back cleanly to manual triage when `fm` is absent.

**Architecture:** Extends the existing `template/scripts/fm.ts` module with a stdin-capable command runner, a structured-output classifier (`classifySubmission`) using `fm`'s `--schema`, and a defensive parser. `fetch-submissions.ts` calls the classifier for each new submission, renders advisory frontmatter, and reports a triage tally. Keystatic surfaces three read-mostly fields beside the existing `status`. Advisory only — `status` is never auto-changed. Reuses ADR-0021's pattern (no new ADR).

**Tech Stack:** TypeScript (strict, ESM), Node `node:child_process` (`execFile` + stdin), `node:os`/`node:fs` for the temp schema file, Vitest 3, the existing `.site-config` reader, Keystatic.

**Spec:** `docs/superpowers/specs/2026-06-10-fm-inbox-triage-design.md`

---

## File Structure

- **Modify:** `template/scripts/fm.ts` — add `input?` to `CommandRunner`/`defaultRunner`; add `SubmissionCategory`/`SubmissionClassification` types, the embedded `TRIAGE_SCHEMA`, `parseClassification`, and `classifySubmission`.
- **Modify:** `tests/fm.test.ts` — tests for stdin passing, `parseClassification`, and `classifySubmission`.
- **Modify:** `template/scripts/fetch-submissions.ts` — add `buildSubmissionText`, extend `renderSubmission` with optional classification, wire classification into the new-submission path, add the `TriageTally` + `formatTriageSummary`, and report the summary.
- **Create:** `tests/fetch-submissions.test.ts` — tests for `buildSubmissionText`, `renderSubmission`, and `formatTriageSummary`.
- **Modify:** `template/keystatic.config.ts` — add `aiCategory`/`aiSpam`/`aiReason` to the `submissions` collection.
- **Modify:** `skills/inbox/SKILL.md`, `template/docs/workflows/inbox.md`, `CLAUDE.md` (root) — documentation.

Boundary note: `fm.ts` stays domain-agnostic about the inbox — it classifies a **string**. `fetch-submissions.ts` owns turning a `Submission` into that string (`buildSubmissionText`). The `SubmissionClassification` type lives in `fm.ts` because it is bound to `TRIAGE_SCHEMA` and `parseClassification`.

---

## Task 1: stdin support in the command runner

**Files:**
- Modify: `template/scripts/fm.ts` (the `CommandRunner` type and `defaultRunner`)
- Test: `tests/fm.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/fm.test.ts` (the `defaultRunner` describe block already exists — add this case inside it, or as a new `it` in that block):

```ts
  it("passes opts.input to the child's stdin", async () => {
    const r = await defaultRunner(
      process.execPath,
      ["-e", "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.toUpperCase()))"],
      { input: "hello" },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("HELLO");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/fm.test.ts -t "passes opts.input"`
Expected: FAIL — `input` is not in the opts type / not written, so stdout is empty (`""`), not `"HELLO"`. (TypeScript may also error that `input` is not assignable; that still counts as red.)

- [ ] **Step 3: Add `input` to the runner type and write it to stdin**

In `template/scripts/fm.ts`, change the `CommandRunner` type:

```ts
export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
) => Promise<CommandResult>;
```

And change `defaultRunner` to capture the child process and write stdin (note the `child` binding and the trailing `if (opts.input != null)` block):

```ts
export const defaultRunner: CommandRunner = (command, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (!error) {
          resolve({ stdout: stdout ?? "", exitCode: 0 });
          return;
        }
        // Numeric `code` = process exit status; string `code` (ENOENT) or a
        // kill signal (timeout) = spawn failure → treat as unavailable (-1).
        const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
        const exitCode = typeof code === "number" ? code : -1;
        resolve({ stdout: stdout ?? "", exitCode });
      },
    );
    if (opts.input != null) {
      // Guard against EPIPE if the child exits without reading stdin.
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all prior `fm.test.ts` tests plus the new stdin case.

- [ ] **Step 5: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): stdin support in fm.ts command runner"
```

---

## Task 2: `parseClassification` + classification types

**Files:**
- Modify: `template/scripts/fm.ts`
- Test: `tests/fm.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top `../template/scripts/fm.js` import in `tests/fm.test.ts`: `parseClassification`, `type SubmissionClassification`. Append:

```ts
describe("parseClassification", () => {
  it("parses a valid object", () => {
    const r = parseClassification('{"isSpam": true, "category": "lead", "reason": "wants a quote"}');
    expect(r).toEqual({ isSpam: true, category: "lead", reason: "wants a quote" });
  });
  it("is order-independent", () => {
    const r = parseClassification('{"reason": "x", "category": "support", "isSpam": false}');
    expect(r).toEqual({ isSpam: false, category: "support", reason: "x" });
  });
  it("falls back to 'other' for an unknown category", () => {
    expect(parseClassification('{"isSpam": false, "category": "marketing", "reason": "ad"}')!.category).toBe("other");
  });
  it("coerces non-boolean isSpam", () => {
    expect(parseClassification('{"isSpam": "yes", "category": "other", "reason": ""}')!.isSpam).toBe(true);
    expect(parseClassification('{"isSpam": "no", "category": "other", "reason": ""}')!.isSpam).toBe(false);
  });
  it("defaults a missing reason to empty string", () => {
    expect(parseClassification('{"isSpam": false, "category": "question"}')!.reason).toBe("");
  });
  it("strips ANSI and whitespace before parsing", () => {
    expect(parseClassification('\x1b[32m {"isSpam": false, "category": "lead", "reason": "x"} \x1b[0m')!.category).toBe("lead");
  });
  it("returns null for malformed JSON", () => {
    expect(parseClassification("{ not json")).toBeNull();
  });
  it("returns null for a JSON array", () => {
    expect(parseClassification("[1,2,3]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fm.test.ts -t "parseClassification"`
Expected: FAIL — `parseClassification` is not exported.

- [ ] **Step 3: Implement the types + parser**

In `template/scripts/fm.ts`, after the `AltCatalog` type (or near the other types), add:

```ts
export type SubmissionCategory = "lead" | "support" | "question" | "other";

export interface SubmissionClassification {
  category: SubmissionCategory;
  isSpam: boolean;
  reason: string;
}

const SUBMISSION_CATEGORIES: SubmissionCategory[] = ["lead", "support", "question", "other"];

/**
 * Parse `fm`'s structured-output JSON into a classification. Defensive:
 * validates the category against the allowed set (else "other"), coerces
 * isSpam to a boolean, and returns null only when the input is not a usable
 * JSON object. `fm` field order is not guaranteed, so this never relies on it.
 */
export function parseClassification(raw: string): SubmissionClassification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(ANSI, "").trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const category =
    typeof o.category === "string" && (SUBMISSION_CATEGORIES as string[]).includes(o.category)
      ? (o.category as SubmissionCategory)
      : "other";
  const isSpam = o.isSpam === true || o.isSpam === "true" || o.isSpam === "yes";
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  return { category, isSpam, reason };
}
```

Note: `ANSI` is the existing module-level regex in `fm.ts` (used by `normalizeAltOutput`). Reuse it; do not redeclare.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): parseClassification for fm structured triage output"
```

---

## Task 3: `classifySubmission` shell-out

**Files:**
- Modify: `template/scripts/fm.ts`
- Test: `tests/fm.test.ts`

- [ ] **Step 1: Write the failing tests (fake runner)**

Add to the top `../template/scripts/fm.js` import: `classifySubmission`, `type CommandRunner` (already imported). Append:

```ts
describe("classifySubmission", () => {
  it("returns the parsed classification on success and forwards text via stdin", async () => {
    let seenInput: string | undefined;
    let seenArgs: string[] = [];
    const run: CommandRunner = async (_cmd, args, opts) => {
      seenInput = opts?.input;
      seenArgs = args;
      return { stdout: '{"isSpam": false, "category": "lead", "reason": "quote request"}', exitCode: 0 };
    };
    const r = await classifySubmission("Form: contact\nMessage: please send a quote", run);
    expect(r).toEqual({ isSpam: false, category: "lead", reason: "quote request" });
    expect(seenInput).toContain("please send a quote");
    expect(seenArgs).toContain("--schema");
  });
  it("returns null on non-zero exit", async () => {
    const run: CommandRunner = async () => ({ stdout: "{}", exitCode: 1 });
    expect(await classifySubmission("x", run)).toBeNull();
  });
  it("returns null on unparseable output", async () => {
    const run: CommandRunner = async () => ({ stdout: "not json", exitCode: 0 });
    expect(await classifySubmission("x", run)).toBeNull();
  });
  it("returns null when the runner throws", async () => {
    const run: CommandRunner = async () => { throw new Error("boom"); };
    expect(await classifySubmission("x", run)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fm.test.ts -t "classifySubmission"`
Expected: FAIL — `classifySubmission` is not exported.

- [ ] **Step 3: Implement the classifier**

Add imports to the top of `template/scripts/fm.ts`: extend the `node:path` import to include `join`, and add `node:os`:

```ts
import { relative, join } from "node:path";
import { tmpdir } from "node:os";
```

Then append (after `generateAltText`):

```ts
// The schema fm expects is NOT generic JSON Schema — it requires fm's own
// shape (note `x-order`). `enum` IS honored inside that shape. Verified against
// the real CLI during design.
const TRIAGE_SCHEMA = {
  required: ["isSpam", "category", "reason"],
  "x-order": ["isSpam", "category", "reason"],
  additionalProperties: false,
  title: "Triage",
  type: "object",
  properties: {
    isSpam: {
      type: "boolean",
      description: "true if the message is spam, advertising, or abuse",
    },
    category: {
      type: "string",
      enum: ["lead", "support", "question", "other"],
      description:
        "lead=potential new customer; support=existing-customer help; question=general inquiry; other=anything else",
    },
    reason: { type: "string", description: "short rationale, max 12 words" },
  },
};

const TRIAGE_INSTRUCTIONS =
  "Classify this form submission. A pricing, booking, or service inquiry from a " +
  "potential new customer is a 'lead'. Help from an existing customer is 'support'.";

/**
 * Classify a form submission on-device. Writes fm's schema to a temp file,
 * runs `fm respond --schema` with the submission text on stdin, and parses
 * the structured JSON. Returns null on any failure (caller falls back).
 */
export async function classifySubmission(
  submissionText: string,
  run: CommandRunner = defaultRunner,
): Promise<SubmissionClassification | null> {
  try {
    const schemaPath = join(tmpdir(), "anglesite-fm-triage-schema.json");
    writeFileSync(schemaPath, JSON.stringify(TRIAGE_SCHEMA));
    const { stdout, exitCode } = await run(
      "fm",
      [
        "respond",
        "--schema", schemaPath,
        "--use-case", "content-tagging",
        "-g",
        "--no-stream",
        "-i", TRIAGE_INSTRUCTIONS,
      ],
      { timeoutMs: 60_000, input: submissionText },
    );
    if (exitCode !== 0) return null;
    return parseClassification(stdout);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/fm.test.ts`
Expected: PASS — all `fm.test.ts` tests green.

- [ ] **Step 5: Manual real-`fm` smoke (Mac only, best-effort)**

```bash
cat > /tmp/fm-triage-smoke.ts <<'EOF'
import { classifySubmission, isFmAvailable } from "/Users/dwk/Developer/github.com/Anglesite/anglesite/template/scripts/fm.ts";
async function run() {
  console.log("available:", await isFmAvailable());
  console.log("spam:", JSON.stringify(await classifySubmission("Form: contact\nFrom: deals@cheap-seo.biz\nMessage: Buy 5000 backlinks now!!! Rank #1 guaranteed")));
  console.log("lead:", JSON.stringify(await classifySubmission("Form: contact\nFrom: maria@gmail.com\nMessage: Do you have availability for a kitchen remodel consult next month? What are rates?")));
}
run();
EOF
npx tsx /tmp/fm-triage-smoke.ts ; rm -f /tmp/fm-triage-smoke.ts /tmp/anglesite-fm-triage-schema.json
```
Expected on a capable Mac: the spam line shows `"isSpam":true`; the lead line shows `"isSpam":false` with category `lead` or `question`. Report the actual output. On non-Mac, `available:false` and both classifications `null` — that's the fallback path; note it and move on.

- [ ] **Step 6: Commit**

```bash
git add template/scripts/fm.ts tests/fm.test.ts
git commit -m "feat(template): classifySubmission via fm structured output"
```

---

## Task 4: wire classification into the inbox sync

**Files:**
- Modify: `template/scripts/fetch-submissions.ts`
- Test: `tests/fetch-submissions.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/fetch-submissions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildSubmissionText,
  renderSubmission,
  formatTriageSummary,
  type Submission,
  type TriageTally,
} from "../template/scripts/fetch-submissions.js";

const sample: Submission = {
  id: "abc123",
  formSlug: "contact",
  formTitle: "Contact Form",
  submittedAt: "2026-06-10T12:00:00Z",
  senderName: "Maria",
  senderEmail: "maria@example.com",
  entries: [
    { key: "message", label: "Message", type: "textarea", value: "Do you have availability?" },
  ],
};

describe("buildSubmissionText", () => {
  it("includes form title, sender, and entry label:value", () => {
    const text = buildSubmissionText(sample);
    expect(text).toContain("Contact Form");
    expect(text).toContain("Maria");
    expect(text).toContain("maria@example.com");
    expect(text).toContain("Message: Do you have availability?");
  });
  it("truncates very long values", () => {
    const big: Submission = { ...sample, entries: [{ key: "m", value: "x".repeat(5000) }] };
    const line = buildSubmissionText(big).split("\n").find((l) => l.startsWith("m:"))!;
    expect(line.length).toBeLessThan(1100);
  });
});

describe("renderSubmission", () => {
  it("omits ai fields when no classification is given", () => {
    const out = renderSubmission(sample);
    expect(out).not.toContain("aiCategory");
    expect(out).toContain("status: new");
  });
  it("emits advisory ai fields when a classification is given", () => {
    const out = renderSubmission(sample, { category: "lead", isSpam: false, reason: "wants a quote" });
    expect(out).toContain("aiCategory: lead");
    expect(out).toContain("aiSpam: no");
    expect(out).toContain("aiReason:");
    expect(out).toContain("aiModel: apple-fm-system");
    // status is still the owner's field, untouched
    expect(out).toContain("status: new");
  });
});

describe("formatTriageSummary", () => {
  it("returns empty string when nothing was classified", () => {
    const t: TriageTally = { classified: 0, spam: 0, lead: 0, support: 0, question: 0, other: 0 };
    expect(formatTriageSummary(t)).toBe("");
  });
  it("summarizes nonzero buckets", () => {
    const t: TriageTally = { classified: 3, spam: 1, lead: 2, support: 0, question: 0, other: 0 };
    expect(formatTriageSummary(t)).toBe("Triaged 3 new: 1 likely spam, 2 leads");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fetch-submissions.test.ts`
Expected: FAIL — the symbols are not exported from `fetch-submissions.ts`.

- [ ] **Step 3: Export types and add the new helpers**

In `template/scripts/fetch-submissions.ts`:

a) Export the existing interfaces (add `export` to the existing `SubmissionEntry` and `Submission` declarations):

```ts
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
```

b) Add the fm imports near the existing `import { readConfig } from "./config.js";`:

```ts
import { isFmAvailable, classifySubmission, FM_MODEL_ID, type SubmissionClassification } from "./fm.js";
```

c) Add `buildSubmissionText` and the triage tally + summary (place near the other helpers):

```ts
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
```

- [ ] **Step 4: Extend `renderSubmission` and export it**

Replace the existing `renderSubmission` with (adds the optional `classification` param + `aiLines`, and `export`):

```ts
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
```

- [ ] **Step 5: Wire classification into `fetchSubmissions` and report the summary**

In `fetchSubmissions`, change the return type and add the triage gate + tally. Specifically:

1. Change the function signature's return type from `Promise<{ added: number; skipped: number }>` to:
```ts
export async function fetchSubmissions(): Promise<{ added: number; skipped: number; triage: TriageTally }> {
```

2. After the `secret` check and before the `for (const url of urls)` loop, add:
```ts
  const triageEnabled =
    readConfig("INBOX_TRIAGE_AI") !== "off" && (await isFmAvailable());
  const triage: TriageTally = { classified: 0, spam: 0, lead: 0, support: 0, question: 0, other: 0 };
```

3. Replace the existing add block:
```ts
      const path = join(SUBMISSIONS_DIR, `${item.id}.mdoc`);
      writeFileSync(path, renderSubmission(item));
      added++;
```
with:
```ts
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
```

4. Change the final `return { added, skipped };` to:
```ts
  return { added, skipped, triage };
```

5. Update `main()` to print the triage summary when present:
```ts
async function main(): Promise<void> {
  const result = await fetchSubmissions();
  console.log(
    `fetch-submissions: ${result.added} new, ${result.skipped} already on disk`,
  );
  const summary = formatTriageSummary(result.triage);
  if (summary) console.log(summary);
}
```

- [ ] **Step 6: Run tests + full suite**

Run: `npx vitest run tests/fetch-submissions.test.ts`
Expected: PASS — all new tests green.

Run: `npx vitest run`
Expected: same 5 pre-existing `sharp`/mcp-server failures as before, everything else green. No NEW failures.

- [ ] **Step 7: Commit**

```bash
git add template/scripts/fetch-submissions.ts tests/fetch-submissions.test.ts
git commit -m "feat(template): classify new submissions during ai-inbox-fetch"
```

---

## Task 5: Keystatic advisory fields

**Files:**
- Modify: `template/keystatic.config.ts` (the `submissions` collection schema, around lines 631-665)

No new unit test (Keystatic config is declarative). Verification is reading the diff and a no-regression suite run.

- [ ] **Step 1: Add the three advisory fields**

In `template/keystatic.config.ts`, inside the `submissions` collection `schema`, immediately AFTER the `status` field (the `fields.select` with New/Archived/Spam) and BEFORE `senderName`, insert:

```ts
        aiCategory: fields.select({
          label: "AI Category",
          description: "On-device suggestion (advisory). The Status field above is what you triage.",
          options: [
            { label: "—", value: "" },
            { label: "Lead", value: "lead" },
            { label: "Support", value: "support" },
            { label: "Question", value: "question" },
            { label: "Other", value: "other" },
          ],
          defaultValue: "",
        }),
        aiSpam: fields.select({
          label: "AI Spam?",
          description: "On-device suggestion (advisory).",
          options: [
            { label: "—", value: "" },
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
          defaultValue: "",
        }),
        aiReason: fields.text({
          label: "AI Reason",
          description: "Why the model suggested the above. Advisory — safe to ignore or edit.",
          multiline: true,
        }),
```

- [ ] **Step 2: Verify no regression**

Run: `npx vitest run`
Expected: no NEW failures vs. the known 5 pre-existing ones.

Manually confirm the inserted block is valid TS and the field keys (`aiCategory`, `aiSpam`, `aiReason`) exactly match the frontmatter keys written by `renderSubmission` in Task 4. Note: `renderSubmission` writes `aiSpam: yes|no` and `aiCategory: <enum>`, which line up with these `select` option values; `aiModel` is written to frontmatter but intentionally has no Keystatic field (internal provenance, not owner-facing).

- [ ] **Step 3: Commit**

```bash
git add template/keystatic.config.ts
git commit -m "feat(template): advisory AI triage fields on the submissions collection"
```

---

## Task 6: Documentation

**Files:**
- Modify: `skills/inbox/SKILL.md`
- Modify: `template/docs/workflows/inbox.md`
- Modify: `CLAUDE.md` (root)

READ each file before editing.

- [ ] **Step 1: Update the inbox skill**

In `skills/inbox/SKILL.md`, after "## Step 6 — Sync the inbox" (and before "## Step 7 — Export to CSV"), insert:

```markdown
## Step 6b — AI triage (when available)

On an Apple-Silicon Mac with Apple Intelligence enabled, `npm run ai-inbox-fetch`
also classifies each **new** submission **on-device** — nothing is uploaded.
Each new submission gets three advisory fields: `aiCategory`
(lead / support / question / other), `aiSpam` (yes / no), and `aiReason` (the
model's short rationale).

These are **suggestions only**. The owner's `status` field is never changed
automatically — a misclassified message is never hidden. Surface the suggestion
and let the owner decide.

After a sync, the script prints a one-line summary like
`Triaged 3 new: 1 likely spam, 2 leads`. **Relay this to the owner in chat** so
they get the overview before opening Keystatic — e.g. "3 new submissions: 1
looks like spam, 2 look like leads. Open the inbox to confirm and triage."

### When `fm` is not available

On any other machine, no AI fields are written and nothing breaks — the owner
triages `status` manually exactly as before. To disable AI triage even on a
capable Mac, set `INBOX_TRIAGE_AI=off` in `.site-config`.
```

- [ ] **Step 2: Update the owner-facing workflow doc**

In `template/docs/workflows/inbox.md`, add a short section (place it after the sync description):

```markdown
## AI triage (Mac only)

If you're on a Mac with Apple Intelligence turned on, syncing your inbox also
adds a quick on-device read on each new submission: whether it looks like spam,
and a rough category (lead, support, question, or other). This happens entirely
on your Mac — no submissions are uploaded anywhere.

These are suggestions, not decisions. Your webmaster shows you the summary
("3 new: 1 likely spam, 2 leads") and you stay in control of how each one is
filed — the AI never marks anything as spam for you. On computers without this
feature, you just triage as usual.

To turn it off, add `INBOX_TRIAGE_AI=off` to `.site-config`.
```

- [ ] **Step 3: Update root CLAUDE.md**

In `CLAUDE.md` (root), find the Key-decisions table row added for on-device `fm` (it mentions "alt text first"). Update its "Why" cell to note inbox triage as the second consumer. Change:

```
| On-device `fm` as optional authoring accelerator | Free/private/offline drafts (alt text first); never in the deployed site, always falls back to Claude (ADR-0021) |
```

to:

```
| On-device `fm` as optional authoring accelerator | Free/private/offline drafts — alt text and inbox triage; never in the deployed site, always falls back to Claude (ADR-0021) |
```

If the exact wording differs, preserve the rest of the cell and just add ", inbox triage" alongside the alt-text mention. Report what you found.

- [ ] **Step 4: Verify no regression**

Run: `npx vitest run`
Expected: no NEW failures vs. the known 5 pre-existing ones.

Manually confirm the docs reference `INBOX_TRIAGE_AI`, `aiCategory`/`aiSpam`/`aiReason`, and the summary string consistently with `fetch-submissions.ts` and `keystatic.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add skills/inbox/SKILL.md template/docs/workflows/inbox.md CLAUDE.md
git commit -m "docs: document on-device inbox triage + advisory review flow"
```

---

## Self-Review

**Spec coverage:**
- `classifySubmission` (fm `--schema`, temp schema file, stdin) → Task 3 (+ Task 1 stdin runner).
- `parseClassification` (validate enum→other, coerce boolean, null on garbage) → Task 2.
- `buildSubmissionText` (sender + entries, truncation) → Task 4.
- `renderSubmission` advisory `aiCategory`/`aiSpam`/`aiReason`/`aiModel`, omitted when absent → Task 4.
- Gate on `isFmAvailable()` + `INBOX_TRIAGE_AI` once per run; classify only new submissions → Task 4.
- Triage tally + Claude-relayed summary → Task 4 (`formatTriageSummary`) + Task 6 (skill relays it).
- Keystatic advisory fields beside `status` → Task 5.
- Fallback (no fm → no fields, manual triage) → Task 4 gate + Task 6 docs.
- Privacy (on-device, no new data leaves) → documented in Task 6.
- Reuse ADR-0021, no new ADR → Task 6 CLAUDE.md row.
- Testing split (pure helpers + fake-runner shell-out in CI; real fm manual) → Tasks 1-4 + Task 3 Step 5.

No gaps found.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `SubmissionClassification` / `SubmissionCategory` defined in Task 2, consumed identically in Tasks 3-4. `classifySubmission(text, run?)`, `parseClassification(raw)`, `buildSubmissionText(s)`, `renderSubmission(s, classification?)`, `formatTriageSummary(t)`, and `TriageTally` are named and signed consistently across tasks and tests. Frontmatter keys (`aiCategory`/`aiSpam` values `yes|no`/`aiReason`) written in Task 4 match the Keystatic field keys/options in Task 5. `CommandRunner` `input?` (Task 1) is the field `classifySubmission` passes (Task 3) and the stdin test asserts (Task 1). `FM_MODEL_ID` (existing export) is imported into `fetch-submissions.ts` in Task 4.
```
