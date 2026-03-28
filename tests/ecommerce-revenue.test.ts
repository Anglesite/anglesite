import { describe, it, expect } from "vitest";
import {
  buildRevenueDataPoint,
  buildRevenueQuery,
  parseRevenueRow,
} from "../template/scripts/ecommerce-revenue.js";

// ---------------------------------------------------------------------------
// buildRevenueDataPoint
// ---------------------------------------------------------------------------

describe("buildRevenueDataPoint", () => {
  it("sets the fixed index to ecommerce-revenue", () => {
    const dp = buildRevenueDataPoint("snipcart", 4500, "usd", "order-1");
    expect(dp.indexes).toEqual(["ecommerce-revenue"]);
  });

  it("stores provider, currency, and orderId as blobs", () => {
    const dp = buildRevenueDataPoint("stripe", 9900, "eur", "pi_abc123");
    expect(dp.blobs).toEqual(["stripe", "EUR", "pi_abc123"]);
  });

  it("normalizes currency to uppercase", () => {
    const dp = buildRevenueDataPoint("shopify", 1500, "gbp", "order-5");
    expect(dp.blobs[1]).toBe("GBP");
  });

  it("stores amountCents as the sole double", () => {
    const dp = buildRevenueDataPoint("polar", 2500, "USD", "pol_xyz");
    expect(dp.doubles).toEqual([2500]);
  });

  it("handles zero amount", () => {
    const dp = buildRevenueDataPoint("lemonsqueezy", 0, "USD", "ls_free");
    expect(dp.doubles).toEqual([0]);
  });

  it("handles large amounts", () => {
    const dp = buildRevenueDataPoint("paddle", 9999999, "USD", "txn_big");
    expect(dp.doubles).toEqual([9999999]);
  });
});

// ---------------------------------------------------------------------------
// buildRevenueQuery
// ---------------------------------------------------------------------------

describe("buildRevenueQuery", () => {
  it("defaults to 30-day lookback", () => {
    const sql = buildRevenueQuery();
    expect(sql).toContain("INTERVAL '30' DAY");
  });

  it("accepts a custom lookback period", () => {
    const sql = buildRevenueQuery(7);
    expect(sql).toContain("INTERVAL '7' DAY");
  });

  it("floors fractional days", () => {
    const sql = buildRevenueQuery(14.7);
    expect(sql).toContain("INTERVAL '14' DAY");
  });

  it("clamps to minimum 1 day", () => {
    const sql = buildRevenueQuery(0);
    expect(sql).toContain("INTERVAL '1' DAY");
  });

  it("clamps negative days to 1", () => {
    const sql = buildRevenueQuery(-5);
    expect(sql).toContain("INTERVAL '1' DAY");
  });

  it("queries the ecommerce-revenue index", () => {
    const sql = buildRevenueQuery();
    expect(sql).toContain("index1 = 'ecommerce-revenue'");
  });

  it("groups by provider and currency", () => {
    const sql = buildRevenueQuery();
    expect(sql).toContain("GROUP BY provider, currency");
  });

  it("accounts for _sample_interval in aggregation", () => {
    const sql = buildRevenueQuery();
    expect(sql).toContain("_sample_interval");
  });
});

// ---------------------------------------------------------------------------
// parseRevenueRow
// ---------------------------------------------------------------------------

describe("parseRevenueRow", () => {
  it("parses a row into typed fields", () => {
    const row = {
      provider: "snipcart",
      currency: "USD",
      total_cents: 150000,
      order_count: 12,
    };
    const parsed = parseRevenueRow(row);
    expect(parsed.provider).toBe("snipcart");
    expect(parsed.currency).toBe("USD");
    expect(parsed.totalCents).toBe(150000);
    expect(parsed.orderCount).toBe(12);
  });

  it("coerces string numbers from query results", () => {
    const row = {
      provider: "stripe",
      currency: "EUR",
      total_cents: "99000",
      order_count: "5",
    };
    const parsed = parseRevenueRow(row);
    expect(parsed.totalCents).toBe(99000);
    expect(parsed.orderCount).toBe(5);
  });
});
