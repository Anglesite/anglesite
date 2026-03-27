import { describe, it, expect } from "vitest";
import {
  buildConversionQuery,
  buildImpressionDataPoint,
  buildConversionDataPoint,
} from "../template/scripts/ab-analytics.js";

// ---------------------------------------------------------------------------
// buildConversionQuery
// ---------------------------------------------------------------------------

describe("buildConversionQuery", () => {
  it("generates SQL for a given experiment ID", () => {
    const sql = buildConversionQuery("homepage-hero", 14);
    expect(sql).toContain("homepage-hero");
    expect(sql).toContain("_sample_interval");
    expect(sql).toContain("14");
  });

  it("includes variant grouping", () => {
    const sql = buildConversionQuery("pricing-cta", 7);
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("blob1");
  });

  it("calculates weighted counts using _sample_interval", () => {
    const sql = buildConversionQuery("test", 30);
    expect(sql).toMatch(/SUM\(.*_sample_interval/);
  });

  it("filters by experiment ID in index1", () => {
    const sql = buildConversionQuery("my-exp", 14);
    expect(sql).toContain("index1 = 'my-exp'");
  });

  it("uses the specified lookback days", () => {
    const sql = buildConversionQuery("test", 90);
    expect(sql).toContain("90");
  });
});

// ---------------------------------------------------------------------------
// buildImpressionDataPoint / buildConversionDataPoint
// ---------------------------------------------------------------------------

describe("buildImpressionDataPoint", () => {
  it("returns the correct shape", () => {
    const dp = buildImpressionDataPoint("homepage-hero", "variant-a", "sess-123");
    expect(dp.indexes).toEqual(["homepage-hero"]);
    expect(dp.blobs).toEqual(["variant-a", "impression", "sess-123"]);
    expect(dp.doubles).toEqual([1]);
  });
});

describe("buildConversionDataPoint", () => {
  it("returns the correct shape with event type", () => {
    const dp = buildConversionDataPoint(
      "homepage-hero",
      "variant-a",
      "contact-form-submit",
      "sess-456",
    );
    expect(dp.indexes).toEqual(["homepage-hero"]);
    expect(dp.blobs).toEqual(["variant-a", "contact-form-submit", "sess-456"]);
    expect(dp.doubles).toEqual([1]);
  });
});
