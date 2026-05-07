---
name: inbox
description: "Browse, triage, and export form submissions from Keystatic instead of digging through email"
allowed-tools: Bash(npm run *), Bash(npx wrangler *), Bash(grep *), Write, Read, Glob
disable-model-invocation: true
---

Persist submissions from `/anglesite:contact` and `/anglesite:forms` to Cloudflare Workers KV, surface them in Keystatic as a `Form Submissions` collection, and triage from there. Closes the gap of digging through email for a single submission and gives spam triage a real home. Custom forms and the contact form share one inbox, distinguished by `formSlug`.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — Workers + KV are part of the Cloudflare stack already in use
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — KV namespace lives on the owner's account; the Worker is the only writer

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt — say what you're about to do and why in plain language. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config`:

- At least one of `CONTACT_WORKER_URL` or `FORMS_WORKER_URL` must be set
- `CF_PROJECT_NAME` and `SITE_DOMAIN` must be set (site has been deployed)

If neither worker URL exists, tell the owner: "Set up `/anglesite:contact` or `/anglesite:forms` first — the inbox sits on top of those workers."

If `INBOX_KV_ID` is already set in `.site-config`, the inbox is already configured — skip to Step 4 (sync) or Step 5 (triage and export).

## Step 1 — Create the KV namespace

Tell the owner: "I'm creating a Cloudflare Workers KV namespace to store your form submissions. It's free up to 100k reads and 1k writes per day, more than enough for a small business."

```sh
npx wrangler kv namespace create form_submissions
```

Wrangler prints two lines like:

```
🌀 Creating namespace with title "form_submissions"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "form_submissions", id = "abc123def456..." }
```

Copy the `id` value. Save it to `.site-config` as `INBOX_KV_ID=abc123def456...` using the Write tool.

## Step 2 — Wire the binding into each worker

For every deployed worker (`worker/wrangler.toml` for the contact form, `worker/forms-wrangler.toml` for the forms handler), uncomment the `[[kv_namespaces]]` block and replace `REPLACE_WITH_KV_NAMESPACE_ID` with the saved `INBOX_KV_ID`. The binding name must remain `SUBMISSIONS`.

Example (after edit):

```toml
[[kv_namespaces]]
binding = "SUBMISSIONS"
id = "abc123def456..."
```

## Step 3 — Set INBOX_SECRET on every worker and locally

Generate a long random secret (use the owner's `openssl rand -hex 32` or any password manager). Tell the owner: "I'll save this token in two places — in Cloudflare so the workers can verify it, and locally in `.env.local` so the sync script can use it."

For each worker that exists (`contact-form` and/or `forms-handler`):

```sh
npx wrangler secret put INBOX_SECRET --name contact-form
npx wrangler secret put INBOX_SECRET --name forms-handler
```

Tell the owner to paste the same value when prompted.

Then write the secret to `.env.local` (gitignored) using the Write tool:

```
INBOX_SECRET=<paste-the-same-value>
```

If `.env.local` already exists, append the line.

## Step 4 — Redeploy the workers

Each worker now needs to re-deploy so the KV binding and the secret are picked up. Run only the deploy commands that match what's installed on this site:

```sh
npx wrangler deploy --config worker/wrangler.toml
```

```sh
npx wrangler deploy --config worker/forms-wrangler.toml
```

## Step 5 — Sync the inbox

Pull new submissions from KV into `src/content/submissions/`:

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

## Step 6 — Export to CSV (optional)

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

- **Per-form thread.** The `formSlug` field separates contact-form messages from each custom form. The Keystatic list view groups by form when the owner wants — sort or filter on `formSlug`.
- **Email still works.** KV persistence is best-effort; even if the KV write fails the worker still emails the owner. The inbox is a complement, not a replacement.
- **Privacy.** Submission data lives in `src/content/submissions/` and is committed to the owner's private Git repo as part of the standard backup flow. It is *not* rendered on the public site (no Astro page reads from this collection). Keep the repo private.
- **PII scan.** Submissions contain emails and phone numbers, but the pre-deploy PII scan only walks `dist/` (built HTML) — the submissions never get rendered onto a public page so the scan is unaffected. Confirm by running `npm run predeploy` after a sync.
