import { describe, it, expect } from "vitest";
import {
  tokens,
  fmt,
  fmtK,
  fmtDollars,
  model,
  SESSION,
  PRICING,
  type Measurements,
} from "../bin/average-tokens.js";

// ---------------------------------------------------------------------------
// Pure formatting functions
// ---------------------------------------------------------------------------

describe("tokens", () => {
  it("converts bytes to tokens at 4:1 ratio", () => {
    expect(tokens(400)).toBe(100);
    expect(tokens(4)).toBe(1);
    expect(tokens(0)).toBe(0);
  });

  it("rounds up partial tokens", () => {
    expect(tokens(1)).toBe(1);
    expect(tokens(5)).toBe(2);
    expect(tokens(7)).toBe(2);
  });
});

describe("fmt", () => {
  it("formats numbers with locale separators", () => {
    const result = fmt(1234567);
    // en-US locale uses commas
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("567");
  });

  it("leaves small numbers unchanged", () => {
    expect(fmt(42)).toBe("42");
  });
});

describe("fmtK", () => {
  it("formats millions with M suffix", () => {
    expect(fmtK(1_500_000)).toBe("1.5M");
    expect(fmtK(1_000_000)).toBe("1.0M");
  });

  it("formats thousands with k suffix", () => {
    expect(fmtK(5_000)).toBe("5k");
    expect(fmtK(12_345)).toBe("12k");
  });

  it("formats small numbers without suffix", () => {
    expect(fmtK(999)).toBe("999");
  });
});

describe("fmtDollars", () => {
  it("formats as dollar amount with 2 decimal places", () => {
    expect(fmtDollars(1.5)).toBe("$1.50");
    expect(fmtDollars(0.1)).toBe("$0.10");
    expect(fmtDollars(99.999)).toBe("$100.00");
  });

  it("formats zero", () => {
    expect(fmtDollars(0)).toBe("$0.00");
  });
});

// ---------------------------------------------------------------------------
// Session cost model
// ---------------------------------------------------------------------------

describe("model", () => {
  it("calculates session costs for known input", () => {
    const measurements: Measurements = {
      alwaysLoaded: [
        { label: "test", path: "test.md", bytes: 4000, tokens: 1000 },
      ],
      command: [
        { label: "cmd", path: "cmd.md", bytes: 2000, tokens: 500 },
      ],
      step1: [
        { label: "s1", path: "s1.md", bytes: 800, tokens: 200 },
      ],
      step2: [
        { label: "s2", path: "s2.md", bytes: 1200, tokens: 300 },
      ],
      smb: {
        count: 10,
        totalBytes: 40000,
        avgBytes: 4000,
        avgTokens: 1000,
        minBytes: 2000,
        maxBytes: 6000,
      },
    };

    const result = model(measurements);

    // contextPerTurn = systemPromptTokens + alwaysTokens + commandTokens + onDemandTokens
    // = 2000 + 1000 + 500 + (200 + 1000 + 300) = 5000
    expect(result.contextPerTurn).toBe(5000);

    // Should have cost entries for each pricing model
    expect(result.costs).toHaveLength(Object.keys(PRICING).length);

    // Each cost should have positive values
    for (const cost of result.costs) {
      expect(cost.cachedInput).toBeGreaterThan(0);
      expect(cost.uncachedInput).toBeGreaterThan(0);
      expect(cost.totalInput).toBeGreaterThan(0);
      expect(cost.totalOutput).toBe(SESSION.outputTokens);
      expect(cost.cost).toBeGreaterThan(0);
    }
  });

  it("Sonnet costs less than Opus", () => {
    const measurements: Measurements = {
      alwaysLoaded: [{ label: "t", path: "t", bytes: 400, tokens: 100 }],
      command: [],
      step1: [],
      step2: [],
      smb: { count: 1, totalBytes: 400, avgBytes: 400, avgTokens: 100, minBytes: 400, maxBytes: 400 },
    };

    const result = model(measurements);
    const sonnet = result.costs.find(c => c.label === "Sonnet");
    const opus = result.costs.find(c => c.label === "Opus");

    expect(sonnet).toBeDefined();
    expect(opus).toBeDefined();
    expect(sonnet!.cost).toBeLessThan(opus!.cost);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("SESSION constants", () => {
  it("has reasonable default values", () => {
    expect(SESSION.turns).toBeGreaterThan(0);
    expect(SESSION.systemPromptTokens).toBeGreaterThan(0);
    expect(SESSION.avgNewContentPerTurn).toBeGreaterThan(0);
    expect(SESSION.outputTokens).toBeGreaterThan(0);
  });
});

describe("PRICING", () => {
  it("has entries for opus and sonnet", () => {
    expect(PRICING.opus).toBeDefined();
    expect(PRICING.sonnet).toBeDefined();
  });

  it("cached rate is lower than standard input rate", () => {
    for (const model of Object.values(PRICING)) {
      expect(model.cached).toBeLessThan(model.input);
    }
  });
});
