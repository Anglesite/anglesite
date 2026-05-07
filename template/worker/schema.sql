-- Anglesite form submissions inbox — D1 schema.
--
-- Applied by /anglesite:inbox via:
--   npx wrangler d1 execute form_submissions --file=worker/schema.sql --remote
--
-- The schema is idempotent (all CREATEs are IF NOT EXISTS) so it is safe to
-- re-run after dependency upgrades or when adding a new Worker binding.
-- See ADR-0019 for the rationale and shape decisions.

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  form_slug       TEXT NOT NULL,
  form_title      TEXT,
  submitted_at    TEXT NOT NULL,
  submitted_at_ms INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new',
  sender_name     TEXT,
  sender_email    TEXT,
  ip              TEXT,
  payload         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_date    ON submissions(form_slug, submitted_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_status_date  ON submissions(status,    submitted_at_ms DESC);
