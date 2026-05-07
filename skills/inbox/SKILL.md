---
name: inbox
description: "Browse, triage, and export form submissions from Keystatic instead of digging through email"
allowed-tools: Bash(npm run *), Bash(npx wrangler *), Bash(grep *), Write, Read, Glob, mcp__cloudflare__d1_database_create, mcp__cloudflare__d1_databases_list, mcp__cloudflare__d1_database_get, mcp__cloudflare__d1_database_query
disable-model-invocation: true
---

Persist submissions from `/anglesite:contact` and `/anglesite:forms` to Cloudflare D1, surface them in Keystatic as a `Form Submissions` collection, and triage from there. Closes the gap of digging through email for a single submission and gives spam triage a real home. Custom forms and the contact form share one inbox, distinguished by `formSlug`.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — Workers + D1 are part of the Cloudflare stack already in use
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — the D1 database lives on the owner's account; the Workers are the only writers
- [ADR-0019 D1 inbox](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0019-d1-inbox.md) — why submissions live in D1 (filter, sort, status updates) instead of KV

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt — say what you're about to do and why in plain language. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config`:

- At least one of `CONTACT_WORKER_URL` or `FORMS_WORKER_URL` must be set
- `CF_PROJECT_NAME` and `SITE_DOMAIN` must be set (site has been deployed)

If neither worker URL exists, tell the owner: "Set up `/anglesite:contact` or `/anglesite:forms` first — the inbox sits on top of those workers."

If `INBOX_DB_ID` is already set in `.site-config`, the inbox is already configured — skip to Step 5 (sync) or Step 6 (triage and export).

If `INBOX_KV_ID` is set but `INBOX_DB_ID` is not, this is a legacy KV-based inbox. Tell the owner: "Your inbox is on the older KV backend. I'll provision the new D1 database, copy the existing submissions across, and then you can delete the KV namespace." Then run Steps 1–4 followed by Step 7 (migration).

## Step 1 — Create the D1 database

Tell the owner: "I'm creating a Cloudflare D1 database to store your form submissions. D1 is a SQL database at the edge — it's free up to 5 GB and 100,000 writes per day, more than a small business will ever need."

```sh
npx wrangler d1 create form_submissions
```

Wrangler prints a block like:

```
✅ Successfully created DB 'form_submissions' in region <REGION>

[[d1_databases]]
binding = "INBOX_DB"
database_name = "form_submissions"
database_id = "abc123-def4-..."
```

Copy the `database_id` value. Save it to `.site-config` as `INBOX_DB_ID=abc123-def4-...` using the Write tool.

## Step 2 — Apply the schema

The schema (one `submissions` table plus two indexes) ships at `worker/schema.sql`. Apply it once to the live database:

```sh
npx wrangler d1 execute form_submissions --remote --file=worker/schema.sql
```

If `worker/schema.sql` is missing on an older site, run `/anglesite:update` first to copy it in, then re-run the execute command. The schema uses `CREATE TABLE IF NOT EXISTS` so re-running it is safe.

## Step 3 — Wire the binding into each worker

For every deployed worker (`worker/wrangler.toml` for the contact form, `worker/forms-wrangler.toml` for the forms handler), uncomment the `[[d1_databases]]` block and replace `REPLACE_WITH_D1_DATABASE_ID` with the saved `INBOX_DB_ID`. The binding name must remain `INBOX_DB`.

Example (after edit):

```toml
[[d1_databases]]
binding = "INBOX_DB"
database_name = "form_submissions"
database_id = "abc123-def4-..."
```

## Step 4 — Set INBOX_SECRET on every worker and locally

Generate a long random secret (use the owner's `openssl rand -hex 32` or any password manager). Tell the owner: "I'll save this token in two places — in Cloudflare so the workers can verify it, and locally in `.env.local` so the sync script can use it."

For each worker that exists (`contact-form` and/or `forms-handler`):

```sh
npx wrangler secret put INBOX_SECRET --name contact-form
```

```sh
npx wrangler secret put INBOX_SECRET --name forms-handler
```

Tell the owner to paste the same value when prompted.

Then write the secret to `.env.local` (gitignored) using the Write tool:

```
INBOX_SECRET=<paste-the-same-value>
```

If `.env.local` already exists, append the line.

## Step 5 — Redeploy the workers

Each worker now needs to re-deploy so the D1 binding and the secret are picked up. Run only the deploy commands that match what's installed on this site:

```sh
npx wrangler deploy --config worker/wrangler.toml
```

```sh
npx wrangler deploy --config worker/forms-wrangler.toml
```

## Step 6 — Sync the inbox

Pull new submissions from D1 into `src/content/submissions/`:

```sh
npm run ai-inbox-fetch
```

Tell the owner what you saw — e.g. "Synced 4 new submissions, skipped 12 already on disk." Existing local files are never overwritten so the owner's triage edits (`status`, `notes`) are safe.

Open Keystatic and route them to the **Form Submissions** collection so they can review and triage. The list shows newest first; each entry includes:

- The form it came from (`formSlug`)
- Sender name and email (best-effort, derived from the submitted fields)
- Status — `New`, `Archived`, or `Spam`
- Every submitted value
- A private notes field for owner-only commentary

Triage actions are just edits to the `status` field — no special tooling. Encourage the owner to bulk-process: archive what's resolved, mark spam as spam.

## Step 7 — Migrate from a legacy KV inbox (only if `INBOX_KV_ID` was set)

If `.site-config` had `INBOX_KV_ID` from an older deploy, run the one-shot migration after Steps 1–5 succeed:

```sh
npm run ai-inbox-migrate -- --dry-run
```

The dry run prints how many rows would be copied. Confirm the count looks right — it should match what the owner saw in the old inbox — then commit:

```sh
npm run ai-inbox-migrate
```

The script reads every key from the legacy KV namespace and inserts it into D1 with `ON CONFLICT DO NOTHING`, so re-running is harmless. When it reports `0 new rows`, the migration is complete.

After the dust settles, rename the legacy key in `.site-config` (`INBOX_KV_ID` → `LEGACY_INBOX_KV_ID`) and tell the owner they can delete the KV namespace from the Cloudflare dashboard whenever they want — nothing else uses it. `/anglesite:check` will warn until the KV namespace is deleted.

## Step 8 — Export to CSV (optional)

Lead-capture and survey responses are easier to work with in a spreadsheet. The export script reads the same files Keystatic shows:

```sh
npm run ai-inbox-export -- --slug=lead --status=new --out=leads.csv
```

Available filters:

- `--slug=<formSlug>` — only this form (e.g. `contact`, `lead`, `rsvp`)
- `--status=new|archived|spam` — only this status
- `--since=YYYY-MM-DD` — only submissions on or after this date
- `--out=<path>` — write to a file instead of stdout

Without `--out`, CSV is printed to stdout so the owner can pipe it into a spreadsheet, an email, or another tool.

## Notes

- **Per-form thread.** The `formSlug` field separates contact-form messages from each custom form. The Keystatic list view groups by form when the owner wants — sort or filter on `formSlug`. The `/inbox` Worker endpoint also accepts `?slug=<slug>` and `?status=<status>` query parameters that translate directly into indexed `WHERE` clauses on the D1 table.
- **Email still works.** D1 persistence is best-effort; even if the D1 write fails the worker still emails the owner. The inbox is a complement, not a replacement.
- **Privacy.** Submission data lives in `src/content/submissions/` and is committed to the owner's private Git repo as part of the standard backup flow. It is *not* rendered on the public site (no Astro page reads from this collection). Keep the repo private.
- **PII scan.** Submissions contain emails and phone numbers, but the pre-deploy PII scan only walks `dist/` (built HTML) — the submissions never get rendered onto a public page so the scan is unaffected. Confirm by running `npm run predeploy` after a sync.
- **Schema upgrades.** Re-running `npx wrangler d1 execute form_submissions --remote --file=worker/schema.sql` is idempotent. New indexes added to `worker/schema.sql` in a future template release will apply cleanly during `/anglesite:update`.
