import { describe, it, expect } from "vitest";
import {
  OUTCOMES_SCHEMA,
  buildInsertOutcomeSQL,
  buildQueryHistorySQL,
  type ExperimentOutcome,
} from "../template/scripts/ab-outcomes.js";

// ---------------------------------------------------------------------------
// OUTCOMES_SCHEMA
// ---------------------------------------------------------------------------

describe("OUTCOMES_SCHEMA", () => {
  it("creates a table named experiment_outcomes", () => {
    expect(OUTCOMES_SCHEMA).toContain("CREATE TABLE");
    expect(OUTCOMES_SCHEMA).toContain("experiment_outcomes");
  });

  it("includes all required columns", () => {
    const columns = [
      "id",
      "experiment_id",
      "page",
      "hypothesis",
      "control_copy",
      "variant_copy",
      "winner",
      "lift_pct",
      "confidence",
      "impressions",
      "conversions",
      "started_at",
      "concluded_at",
      "notes",
    ];
    for (const col of columns) {
      expect(OUTCOMES_SCHEMA).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// buildInsertOutcomeSQL
// ---------------------------------------------------------------------------

describe("buildInsertOutcomeSQL", () => {
  const outcome: ExperimentOutcome = {
    id: "abc-123",
    experimentId: "homepage-hero",
    page: "/",
    hypothesis: "Urgency CTA will convert better",
    controlCopy: "Learn More",
    variantCopy: "Get Your Free Estimate",
    winner: "variant-a",
    liftPct: 22.5,
    confidence: 0.97,
    impressions: 2000,
    conversions: 150,
    startedAt: "2025-04-01",
    concludedAt: "2025-04-15",
    notes: "Urgency messaging works for this audience.",
  };

  it("produces an INSERT statement", () => {
    const sql = buildInsertOutcomeSQL(outcome);
    expect(sql).toContain("INSERT INTO experiment_outcomes");
  });

  it("includes all values", () => {
    const sql = buildInsertOutcomeSQL(outcome);
    expect(sql).toContain("abc-123");
    expect(sql).toContain("homepage-hero");
    expect(sql).toContain("variant-a");
    expect(sql).toContain("22.5");
    expect(sql).toContain("0.97");
  });

  it("escapes single quotes in text fields", () => {
    const withQuotes: ExperimentOutcome = {
      ...outcome,
      hypothesis: "Owner's preferred headline",
    };
    const sql = buildInsertOutcomeSQL(withQuotes);
    expect(sql).toContain("Owner''s preferred headline");
    expect(sql).not.toMatch(/[^']Owner's/);
  });
});

// ---------------------------------------------------------------------------
// buildQueryHistorySQL
// ---------------------------------------------------------------------------

describe("buildQueryHistorySQL", () => {
  it("queries by page", () => {
    const sql = buildQueryHistorySQL({ page: "/" });
    expect(sql).toContain("page = '/'");
    expect(sql).toContain("ORDER BY");
  });

  it("queries all outcomes when no filter", () => {
    const sql = buildQueryHistorySQL();
    expect(sql).toContain("SELECT");
    expect(sql).not.toContain("WHERE");
  });

  it("limits results", () => {
    const sql = buildQueryHistorySQL({ limit: 5 });
    expect(sql).toContain("LIMIT 5");
  });

  it("combines page filter and limit", () => {
    const sql = buildQueryHistorySQL({ page: "/pricing", limit: 10 });
    expect(sql).toContain("page = '/pricing'");
    expect(sql).toContain("LIMIT 10");
  });
});
