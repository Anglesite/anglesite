# Form submissions inbox

Read every contact and form submission inside Keystatic instead of digging through email. Built on Cloudflare D1 (see [ADR-0019](../../docs/decisions/0019-d1-inbox.md)) — submissions are persisted by the same Workers that power [contact](contact.md) and [forms](forms.md), then synced down to a `Form Submissions` collection for triage and CSV export.

## Prerequisites

- `/anglesite:contact` and/or `/anglesite:forms` already configured (the inbox sits on top of those Workers)
- Site deployed to Cloudflare (`CF_PROJECT_NAME` and `SITE_DOMAIN` in `.site-config`)

## What gets created

- A Cloudflare D1 database (default name `form_submissions`) with a `submissions` table and two indexes
- D1 binding (`INBOX_DB`) added to `worker/wrangler.toml` and `worker/forms-wrangler.toml`
- `INBOX_SECRET` set on each Worker and saved locally to `.env.local`
- `src/content/submissions/*.mdoc` — one file per submission, written by `npm run ai-inbox-fetch`
- A `submissions` Keystatic collection labelled **Form Submissions**

## Configuration

| `.site-config` key | Purpose |
|---|---|
| `INBOX_DB_ID` | The D1 database ID created by `wrangler d1 create` |

Worker secrets (set via `npx wrangler secret put`):

| Secret | Purpose |
|---|---|
| `INBOX_SECRET` | Bearer token gating `GET /inbox` on each Worker |

Local file:

| File | Purpose |
|---|---|
| `.env.local` | `INBOX_SECRET=...` for the local sync script (gitignored) |

## Day-to-day flow

```sh
npm run ai-inbox-fetch        # pull new submissions into src/content/submissions/
npm run dev                   # open the site + Keystatic
```

Open Keystatic → **Form Submissions**. Each entry shows the form it came from, sender name and email (best-effort), every submitted value, and a status field. Triage by changing `status`:

- **New** — needs attention
- **Archived** — handled
- **Spam** — junk

Add private commentary in the **Notes** field — it's never published.

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

## CSV export

```sh
npm run ai-inbox-export -- --slug=lead --status=new --out=leads.csv
```

Filters:

- `--slug=<formSlug>` — restrict to one form
- `--status=new|archived|spam` — restrict by status
- `--since=YYYY-MM-DD` — only on or after this date
- `--out=<path>` — write to a file instead of stdout

## Privacy

Submissions live inside the private Git repo (`/anglesite:backup` pushes to a private GitHub repo) and are never rendered onto a public page — no Astro route reads from the `submissions` collection. The pre-deploy PII scan only walks `dist/`, so submitter emails and phone numbers don't trigger the gate.

## Troubleshooting

- **`fetch-submissions: Worker responded 401`** — `INBOX_SECRET` differs between `.env.local` and the Worker. Re-run `npx wrangler secret put INBOX_SECRET --name <worker>` and update `.env.local` to match.
- **`fetch-submissions: Worker responded 501`** — the Worker has no `INBOX_DB` binding. Edit `worker/wrangler.toml` (or `forms-wrangler.toml`), uncomment the `[[d1_databases]]` block, fill in `INBOX_DB_ID`, and redeploy.
- **`D1_ERROR: no such table: submissions`** — apply the schema once: `npx wrangler d1 execute form_submissions --remote --file=worker/schema.sql`. The schema is idempotent so re-running is safe.
- **No new submissions appearing** — confirm the test submission completed Turnstile and reached the Worker (check Cloudflare → Workers → logs). D1 writes are best-effort; check the worker logs for `D1 persist failed`.
