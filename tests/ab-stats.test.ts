import { describe, it, expect } from "vitest";
import {
  betaMean,
  betaVariance,
  bayesianABTest,
  formatExperimentResult,
  type VariantStats,
  type ABTestResult,
} from "../template/scripts/ab-stats.js";

// ---------------------------------------------------------------------------
// betaMean / betaVariance — Beta distribution helpers
// ---------------------------------------------------------------------------

describe("betaMean", () => {
  it("returns 0.5 for uniform prior (1, 1)", () => {
    expect(betaMean(1, 1)).toBeCloseTo(0.5);
  });

  it("returns the expected mean for (10, 90)", () => {
    // mean = alpha / (alpha + beta) = 10/100 = 0.1
    expect(betaMean(10, 90)).toBeCloseTo(0.1);
  });
});

describe("betaVariance", () => {
  it("returns correct variance for uniform prior", () => {
    // var = 1*1 / (4 * 3) = 1/12
    expect(betaVariance(1, 1)).toBeCloseTo(1 / 12);
  });

  it("variance decreases with more data", () => {
    expect(betaVariance(100, 100)).toBeLessThan(betaVariance(10, 10));
  });
});

// ---------------------------------------------------------------------------
// bayesianABTest
// ---------------------------------------------------------------------------

describe("bayesianABTest", () => {
  it("detects a clear winner with strong signal", () => {
    const variants: VariantStats[] = [
      { name: "control", impressions: 1000, conversions: 50 },
      { name: "variant-a", impressions: 1000, conversions: 100 },
    ];
    const result = bayesianABTest(variants);
    expect(result.winner).toBe("variant-a");
    expect(result.probabilityBeatControl).toBeGreaterThan(0.95);
    expect(result.liftPct).toBeGreaterThan(50);
  });

  it("returns inconclusive when variants are similar", () => {
    const variants: VariantStats[] = [
      { name: "control", impressions: 100, conversions: 10 },
      { name: "variant-a", impressions: 100, conversions: 11 },
    ];
    const result = bayesianABTest(variants);
    // With such similar numbers and low sample, confidence should be low
    expect(result.probabilityBeatControl).toBeLessThan(0.95);
  });

  it("handles zero conversions in control", () => {
    const variants: VariantStats[] = [
      { name: "control", impressions: 100, conversions: 0 },
      { name: "variant-a", impressions: 100, conversions: 5 },
    ];
    const result = bayesianABTest(variants);
    expect(result.winner).toBe("variant-a");
    expect(result.probabilityBeatControl).toBeGreaterThan(0.9);
  });

  it("handles zero conversions in both variants", () => {
    const variants: VariantStats[] = [
      { name: "control", impressions: 100, conversions: 0 },
      { name: "variant-a", impressions: 100, conversions: 0 },
    ];
    const result = bayesianABTest(variants);
    expect(result.winner).toBe("inconclusive");
    expect(result.liftPct).toBeCloseTo(0, 0);
  });

  it("control can win when variant is worse", () => {
    const variants: VariantStats[] = [
      { name: "control", impressions: 1000, conversions: 100 },
      { name: "variant-a", impressions: 1000, conversions: 30 },
    ];
    const result = bayesianABTest(variants);
    expect(result.winner).toBe("control");
    // probabilityBeatControl should be low because control is actually better
    expect(result.probabilityBeatControl).toBeLessThan(0.05);
  });

  it("accepts a custom confidence threshold", () => {
    // Strong signal: variant-a clearly better
    const variants: VariantStats[] = [
      { name: "control", impressions: 1000, conversions: 50 },
      { name: "variant-a", impressions: 1000, conversions: 100 },
    ];
    // With 0.99 threshold, may or may not declare winner
    const strict = bayesianABTest(variants, 0.99);
    // With 0.80 threshold, should declare variant-a winner
    const relaxed = bayesianABTest(variants, 0.80);
    expect(relaxed.winner).toBe("variant-a");
    // Both should have high probability (>0.95) since signal is strong
    expect(strict.probabilityBeatControl).toBeGreaterThan(0.95);
    expect(relaxed.probabilityBeatControl).toBeGreaterThan(0.95);
  });
});

// ---------------------------------------------------------------------------
// formatExperimentResult — plain-language summaries
// ---------------------------------------------------------------------------

describe("formatExperimentResult", () => {
  it("describes a winning variant", () => {
    const result: ABTestResult = {
      winner: "variant-a",
      probabilityBeatControl: 0.97,
      liftPct: 22.5,
      controlRate: 0.05,
      variantRate: 0.0613,
    };
    const text = formatExperimentResult("Homepage Hero", result);
    expect(text).toContain("Homepage Hero");
    expect(text).toContain("variant-a");
    expect(text).toMatch(/23/); // lift percentage rounded
    expect(text).toContain("97%");
  });

  it("describes an inconclusive result", () => {
    const result: ABTestResult = {
      winner: "inconclusive",
      probabilityBeatControl: 0.62,
      liftPct: 5.1,
      controlRate: 0.1,
      variantRate: 0.1051,
    };
    const text = formatExperimentResult("Pricing CTA", result);
    expect(text).toContain("Pricing CTA");
    expect(text).toMatch(/not enough data|too close to call/i);
  });

  it("describes control winning", () => {
    const result: ABTestResult = {
      winner: "control",
      probabilityBeatControl: 0.03,
      liftPct: -40.2,
      controlRate: 0.1,
      variantRate: 0.06,
    };
    const text = formatExperimentResult("Hero Test", result);
    expect(text).toContain("original");
  });

  it("includes conversion rates", () => {
    const result: ABTestResult = {
      winner: "variant-a",
      probabilityBeatControl: 0.98,
      liftPct: 30,
      controlRate: 0.05,
      variantRate: 0.065,
    };
    const text = formatExperimentResult("Test", result);
    expect(text).toMatch(/5\.0%/);
    expect(text).toMatch(/6\.5%/);
  });
});
