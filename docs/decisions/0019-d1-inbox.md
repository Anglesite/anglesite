---
status: accepted
date: 2026-05-07
decision-makers: [Anglesite maintainers]
---

# Use Cloudflare D1 for the form submissions inbox

## Context and Problem Statement

`/anglesite:inbox` (introduced alongside `/anglesite:contact` and `/anglesite:forms`) persisted every submission to Workers KV under a `submission:<formSlug>:<id>` key, and the local `npm run ai-inbox-fetch` script pulled them down through a `/inbox` endpoint on each Worker. KV was the right shape for the first iteration — write-once, read by ID, no schema — but the actual usage pattern is the opposite of what KV is good at. The inbox is a triage UI: owners want to filter by form, sort by date, mark spam, search by sender, and export filtered subsets to CSV.

Every one of those operations on KV is "list every key with the prefix, fetch each value, fold in memory" — which is exactly the access pattern KV is documented as bad at. Worse, `/anglesite:stats` (#194) wants the same data already shaped for aggregate queries (counts per form, conversion-from-A/B-variant rollups), so leaving submissions in KV would force every consumer to keep its own hand-rolled secondary index.

D1 (SQLite at the edge) is a much better fit:

- Native `WHERE` / `ORDER BY` / `LIKE` for triage, with two indexes covering the queries the inbox UI actually issues
- Structured `status` column so triage updates (mark archived, mark spam) are a single `UPDATE` rather than a read-modify-write of an opaque blob
- Cleaner CSV export — single `SELECT` instead of full-scan fold of every key in the namespace
- Shared schema across `forms` (writes), `inbox` (reads), and `/anglesite:stats` (aggregates), so future analytics work doesn't need its own data store
- Aligns with the existing edge A/B testing decision (ADR-0014) which already runs outcomes through D1

## Decision Drivers

* The inbox is a triage UI — filter, sort, status-update — not a key-value cache
* Operations must stay free or near-free for typical SMB submission volume
* The forms Worker must keep operating in degraded mode (email-only) when the inbox database is absent, to avoid making the inbox a precondition for the contact form
* The shape must be useful to other skills (`stats`, `experiment`) without each one re-deriving it
* Staying inside the Cloudflare stack keeps ADR-0011 (owner controls everything) intact — no third-party storage

## Considered Options

* **Cloudflare D1 with a single `submissions` table** (chosen)
* Workers KV with hand-rolled secondary indexes (status keys, form keys, date buckets)
* Cloudflare R2 + JSON object per submission, listed via S3-style prefix scans
* External database (Turso, Neon, PlanetScale)

## Decision Outcome

Chosen option: "Cloudflare D1 with a single `submissions` table". D1 is on the same Cloudflare account the Worker already runs on, free up to 5 GB of storage and 5 M reads / 100 K writes per day (more than three orders of magnitude past typical SMB inbox volume), and exposes the SQL primitives the triage UI actually needs. The inbox stays a one-table feature — no joins, no migrations beyond the initial schema — so the cost of moving off SQLite later, if it ever happens, is bounded.

### Schema

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  form_slug       TEXT NOT NULL,
  form_title      TEXT,
  submitted_at    TEXT NOT NULL,           -- ISO 8601, used by the UI
  submitted_at_ms INTEGER NOT NULL,        -- epoch ms, used by indexes
  status          TEXT NOT NULL DEFAULT 'new',
  sender_name     TEXT,
  sender_email    TEXT,
  ip              TEXT,
  payload         TEXT NOT NULL            -- JSON: entries[] from the form
);
CREATE INDEX IF NOT EXISTS idx_form_date    ON submissions(form_slug, submitted_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_status_date  ON submissions(status,    submitted_at_ms DESC);
```

`payload` keeps the original `entries[]` JSON the Worker already builds. That preserves field order and labels without normalising every form's columns into the schema, which would force a second migration the moment a form adds a new field. Sender identifiers are denormalised into top-level columns so triage list views and `/anglesite:stats` rollups don't have to parse JSON to render a row.

### Architecture

1. The `/anglesite:inbox` skill provisions one D1 database (default name `form_submissions`) and applies `worker/schema.sql` once via `npx wrangler d1 execute --file=worker/schema.sql --remote`.
2. Both the contact-form Worker and the forms-handler Worker bind the same database as `INBOX_DB`. The binding is optional — if it is absent, `persistSubmission` is a silent no-op and the Worker still emails the owner. The inbox is never a precondition for the form working.
3. The `GET /inbox` endpoint (gated by `INBOX_SECRET`) selects from `submissions` with optional `slug` and `status` query parameters and returns the same JSON shape the local sync script already consumes. The local file format under `src/content/submissions/` is unchanged, so existing Keystatic schema and CSV export logic carry over untouched.

### Consequences

* Good — triage filters, status updates, and CSV exports become single SQL statements instead of full-scan folds.
* Good — `/anglesite:stats` and `/anglesite:experiment` can read directly from the same table for submission-derived metrics without each maintaining its own KV index.
* Good — the JSON `payload` column means form schemas can evolve (new fields, removed fields) without migrating the table.
* Good — D1 free-tier limits comfortably absorb typical SMB inbox volume; usage stays at $0 in normal operation.
* Bad — D1 has stricter per-statement limits than KV (1 MB row max, 100 statements per `batch` call). Form payloads are well under this in practice but a malicious uploader could still try to overflow `payload`; the Worker already trims fields and applies per-field length caps so the practical risk is bounded.
* Bad — the inbox is now coupled to D1 availability; if a regional D1 incident occurs, the persist call fails and we fall back to email-only delivery. This is the same failure mode KV had, so net resilience is unchanged.

### Confirmation

`tests/inbox.test.ts` covers the D1 path with an in-memory fake binding: `persistSubmission` writes the expected row shape, `handleInboxList` filters by slug and status, and the CSV exporter still parses the unchanged `.mdoc` output.

## Pros and Cons of the Options

### Cloudflare D1 with a single `submissions` table

* Good, because triage operations map directly to SQL the database is built for.
* Good, because the schema is small (one table, two indexes) so the cost of evolving it later is bounded.
* Good, because it stays inside Cloudflare — no new account, no new bill, no new key to rotate.

### Workers KV with hand-rolled secondary indexes

* Good, because nothing changes in the architecture — the inbox is already on KV.
* Bad, because every new query (status, sender, form) requires another set of mirrored keys and another consistency hazard.
* Bad, because spam triage is a read-modify-write of an opaque blob — easy to lose updates under retries.
* Bad, because `/anglesite:stats` would still need its own data store; KV doesn't aggregate.

### Cloudflare R2 + JSON object per submission

* Good, because R2 has very generous free-tier storage.
* Bad, because R2 list operations are slower than KV's, with no native filter or sort — every triage query degenerates to a full bucket scan.
* Bad, because there is no atomic update primitive; status changes need to copy the object.

### External database (Turso, Neon, PlanetScale)

* Good, because purpose-built SQL with rich tooling.
* Bad, because it introduces a new account, new credentials, new bill, and a new failure boundary outside Cloudflare.
* Bad, because it conflicts with ADR-0011 — the owner now has to manage another vendor relationship just to read their contact form submissions.

## More Information

The Workers binding is named `INBOX_DB`. Anglesite is pre-1.0, so this is treated as a breaking change for any site already using the older KV-backed inbox: re-run `/anglesite:inbox` after upgrading to provision the D1 database and rebind the Workers.
