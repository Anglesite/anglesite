// ---------------------------------------------------------------------------
// D1 experiment outcomes schema and query builders
// ---------------------------------------------------------------------------

/** An experiment outcome record for long-term storage in D1 */
export interface ExperimentOutcome {
  id: string;
  experimentId: string;
  page: string;
  hypothesis: string;
  controlCopy: string;
  variantCopy: string;
  winner: string;
  liftPct: number;
  confidence: number;
  impressions: number;
  conversions: number;
  startedAt: string;
  concludedAt: string;
  notes: string;
}

/** Options for querying experiment history */
export interface QueryHistoryOptions {
  page?: string;
  limit?: number;
}

/** SQL schema for the experiment_outcomes table */
export const OUTCOMES_SCHEMA = `CREATE TABLE IF NOT EXISTS experiment_outcomes (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL,
  page            TEXT NOT NULL,
  hypothesis      TEXT NOT NULL,
  control_copy    TEXT NOT NULL,
  variant_copy    TEXT NOT NULL,
  winner          TEXT NOT NULL,
  lift_pct        REAL,
  confidence      REAL,
  impressions     INTEGER NOT NULL,
  conversions     INTEGER NOT NULL,
  started_at      TEXT NOT NULL,
  concluded_at    TEXT NOT NULL,
  notes           TEXT
)`;

/** Escape a string for safe inclusion in a SQL literal */
function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build an INSERT statement for an experiment outcome.
 * @param outcome - The outcome record to insert
 * @returns SQL INSERT statement
 */
export function buildInsertOutcomeSQL(outcome: ExperimentOutcome): string {
  const e = escapeSQL;
  return `INSERT INTO experiment_outcomes (
  id, experiment_id, page, hypothesis, control_copy, variant_copy,
  winner, lift_pct, confidence, impressions, conversions,
  started_at, concluded_at, notes
) VALUES (
  '${e(outcome.id)}', '${e(outcome.experimentId)}', '${e(outcome.page)}',
  '${e(outcome.hypothesis)}', '${e(outcome.controlCopy)}', '${e(outcome.variantCopy)}',
  '${e(outcome.winner)}', ${outcome.liftPct}, ${outcome.confidence},
  ${outcome.impressions}, ${outcome.conversions},
  '${e(outcome.startedAt)}', '${e(outcome.concludedAt)}', '${e(outcome.notes)}'
)`;
}

/**
 * Build a SELECT query for experiment history.
 * @param options - Optional filters (page, limit)
 * @returns SQL SELECT statement
 */
export function buildQueryHistorySQL(options?: QueryHistoryOptions): string {
  let sql = "SELECT * FROM experiment_outcomes";
  const conditions: string[] = [];

  if (options?.page) {
    conditions.push(`page = '${escapeSQL(options.page)}'`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += " ORDER BY concluded_at DESC";

  if (options?.limit) {
    sql += ` LIMIT ${options.limit}`;
  }

  return sql;
}
