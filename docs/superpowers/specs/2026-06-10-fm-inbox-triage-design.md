# Design — On-device inbox triage via Apple Foundation Models (`fm`)

**Date:** 2026-06-10
**Status:** Approved for planning
**Scope:** Second slice of the "use `fm` where it makes sense" effort. Adds on-device classification (spam likelihood + category) of new form submissions during `npm run ai-inbox-fetch`. Reuses the `fm.ts` module and ADR-0021 pattern established by the alt-text slice.

## Background

`/anglesite:inbox` persists form submissions to Cloudflare D1 (written by the contact/forms Workers). `npm run ai-inbox-fetch` (`template/scripts/fetch-submissions.ts`) pulls **new** submissions onto the owner's machine into `src/content/submissions/*.mdoc`, which Keystatic surfaces as a `Form Submissions` collection. Triage today is the owner manually editing a `status` field (`new` / `archived` / `spam`) in Keystatic. There is no automation.

Key existing behaviors this design relies on:

- `fetch-submissions.ts` **only ever writes new files** — existing submission files are skipped so owner triage edits (`status`, `notes`) are never overwritten. Classification therefore runs exactly once per submission, with no merge/catalog bookkeeping.
- Submissions carry PII (sender name/email, message bodies) and already live locally, committed to the owner's **private** repo. They are never rendered on the public site, so the pre-deploy PII scan (which walks `dist/`) is unaffected.

Constraints inherited from ADR-0021:

1. **Authoring-time, Mac-only.** `fm` runs the on-device system model on a capable Mac; it cannot run in a Worker. Classification happens locally during sync, never server-side.
2. **Always optional, always falls back.** Gates on `isFmAvailable()`. Without `fm`, no AI fields are written and the owner triages manually exactly as today.

## Decisions (from brainstorming)

- **Taxonomy:** spam likelihood **and** category (`lead` / `support` / `question` / `other`).
- **Action model:** **advisory only.** Suggestions are written to separate fields; the owner's `status` is never auto-changed. Auto-marking spam could hide a misclassified real inquiry from the default view — unacceptable. Mirrors ADR-0021 draft→reviewed.
- **Structure:** **inline at sync time** (Approach A). Classify during `ai-inbox-fetch`; defer any backfill pass as a future enhancement.

## De-risking result (verified against real `fm`)

`fm respond --schema <file>` was tested on real submissions:

- It requires **fm's own schema format** (the shape `fm schema object` emits, including an `x-order` key). A hand-authored generic JSON Schema is rejected (`Invalid schema … missing`).
- `enum` **is** honored when embedded in that format. The `category` enum constrained outputs correctly.
- Output is JSON on stdout but **field order varies** between calls, and the model can still emit an unexpected value when unconstrained. Therefore the module must parse as an object (never positionally), validate `category` against the allowed set (fallback `other`), and coerce `isSpam` to a boolean.

Verified outputs: spam ad → `isSpam: true`; pricing inquiry → `{category: question, isSpam: false}`; invoice problem → `{category: support, isSpam: false}`.

## Architecture

```
ai-inbox-fetch ─► (new submission) ─► fm.ts classifySubmission(text) ─► aiCategory/aiSpam/aiReason/aiModel in frontmatter
                                          │ (fm --schema, on-device)        │
                                   isFmAvailable()? no ─► no AI fields       └─► Keystatic (advisory) ─► owner triages `status`
```

The deployed site has no dependency on `fm` or the AI fields. Classification is authoring-time only. The owner's `status` field remains the single source of triage truth.

### Component 1 — `fm.ts` additions

Extends the existing module (`template/scripts/fm.ts`); reuses `isFmAvailable`, `CommandRunner`, `defaultRunner`, and `FM_MODEL_ID`.

- **Type:**
  ```ts
  export type SubmissionCategory = "lead" | "support" | "question" | "other";
  export interface SubmissionClassification {
    category: SubmissionCategory;
    isSpam: boolean;
    reason: string;
  }
  ```
- **Embedded schema constant** — the fm-format JSON (with `x-order`, `additionalProperties:false`, `required`, and the `category` `enum`). Stored as a module constant and written to a temp file (`os.tmpdir()`) at call time, so there is no scaffolded asset to manage and no bare-path resolution risk (cf. issue #320).
- **`buildSubmissionText(submission): string`** (pure) — assembles a compact, model-friendly block from `formTitle`, `senderName`, `senderEmail`, and each entry rendered as `label: value`. Truncates very long values to keep the prompt bounded.
- **`parseClassification(raw: string): SubmissionClassification | null`** (pure) — `JSON.parse` inside try/catch; validate `category` ∈ the four values (else `other`); coerce `isSpam` to boolean; trim `reason` (default `""`); return `null` only when the input is not a usable object.
- **`classifySubmission(submissionText, run = defaultRunner): Promise<SubmissionClassification | null>`** — writes the schema temp file, runs `fm respond --schema <tmp> --use-case content-tagging -g --no-stream` with `submissionText` on stdin, then `parseClassification`. Returns `null` on non-zero exit, unparseable output, or any throw (caller falls back).
  - The `CommandRunner` interface gains an optional `input?: string` so the runner can pass stdin; `defaultRunner` writes it to the child's stdin. (Alt-text calls omit `input`, unaffected.)

### Component 2 — sync integration (`fetch-submissions.ts`)

- Once per run: `triageEnabled = isFmAvailable()` AND `readConfig("INBOX_TRIAGE_AI") !== "off"`.
- For each **new** submission (the existing add path), when `triageEnabled`: `classifySubmission(buildSubmissionText(item))`. On a non-null result, include in the rendered frontmatter:
  - `aiCategory: lead|support|question|other`
  - `aiSpam: yes|no`
  - `aiReason: "<short rationale>"`
  - `aiModel: apple-fm-system`
- `renderSubmission` is extended to emit those fields when present (omitted entirely when classification was skipped or failed — old submissions and the fallback path render exactly as today).
- Tally classified submissions and print a per-run **triage summary** (e.g. `Triaged 3 new: 1 likely spam, 2 leads`). The `fetchSubmissions` return type gains a small triage breakdown so the skill/test can consume it.

### Component 3 — Keystatic schema (`keystatic.config.ts`)

Add three advisory fields to the `submissions` collection, beside `status`:

- `aiCategory` — `fields.select` (`Lead` / `Support` / `Question` / `Other` / `—` unset), default unset.
- `aiSpam` — `fields.select` (`Yes` / `No` / `—` unset), default unset.
- `aiReason` — `fields.text` (multiline), described as the model's rationale (advisory; safe to ignore or edit).

These are read-mostly hints. The owner continues to triage via `status`.

### Component 4 — skill + docs

- `skills/inbox/SKILL.md`: a new section documenting advisory triage — what the fields mean, that `status` is never auto-changed, the `INBOX_TRIAGE_AI=off` opt-out, and an instruction for Claude to **relay the sync triage summary in chat** ("3 new: 1 likely spam, 2 leads — open Keystatic to confirm") so the owner gets the overview before opening the CMS.
- `template/docs/workflows/inbox.md` (owner-facing, if present): a short plain-language note that on a Mac, new submissions get an on-device spam/category hint, nothing is uploaded, and the hints are suggestions the owner confirms.
- Root `CLAUDE.md`: extend the existing ADR-0021 key-decisions row to mention inbox triage as the second `fm` consumer (no new ADR).

## Fallback contract

| Environment | Behavior |
|---|---|
| Mac + Apple Intelligence on, `INBOX_TRIAGE_AI` unset/on | New submissions get `aiCategory`/`aiSpam`/`aiReason`; summary reported. |
| No `fm`, or `INBOX_TRIAGE_AI=off` | No AI fields written; owner triages `status` manually as today. |

Identical end state — the owner can always triage. `fm` only adds an advisory first pass.

## Testing

- **Unit (no `fm`, CI):** `buildSubmissionText` (sender + entries assembly, truncation); `parseClassification` (valid object; non-enum `category` → `other`; non-boolean `isSpam` coerced; malformed JSON → `null`; missing keys → defaults); `renderSubmission` emits AI fields when present and omits them when absent.
- **Shell-out (fake runner):** `classifySubmission` — valid JSON → object; non-zero exit → `null`; unparseable → `null`; throw → `null`; confirms stdin `input` is passed.
- **Integration (manual, Mac):** real `fm` classification — already verified during design (spam / lead / support cases).
- Mirrors the alt-text split: pure helpers importable without invoking `fm`.

## Out of scope (this slice)

- Backfill pass for submissions synced on a non-Mac (future enhancement, like the alt-text backfill).
- Auto-acting on `status` (explicitly rejected — advisory only).
- Server-side / Worker classification (impossible — `fm` is Mac-only).
- Non-English submissions: the system model is English-centric; non-English messages get a best-effort classification. Noted, not solved.
- Re-classifying already-synced submissions (existing files are never rewritten).

## Open questions

None blocking. Backfill and language handling are explicitly deferred.
