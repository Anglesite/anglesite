import { describe, it, expect } from "vitest";
import {
  parseExperiments,
  getActiveExperiment,
  assignVariant,
  parseVariantCookie,
  serializeVariantCookie,
  resolveVariantPath,
  type Experiment,
  type ExperimentConfig,
} from "../template/scripts/experiments.js";

// ---------------------------------------------------------------------------
// parseExperiments
// ---------------------------------------------------------------------------

describe("parseExperiments", () => {
  it("parses a single experiment", () => {
    const config: ExperimentConfig = {
      "homepage-hero": {
        page: "/",
        variants: ["control", "variant-a"],
        weights: [0.5, 0.5],
        metric: "contact-form-submit",
      },
    };
    const result = parseExperiments(config);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("homepage-hero");
    expect(result[0].page).toBe("/");
    expect(result[0].variants).toEqual(["control", "variant-a"]);
  });

  it("parses multiple experiments", () => {
    const config: ExperimentConfig = {
      "homepage-hero": {
        page: "/",
        variants: ["control", "variant-a"],
        weights: [0.5, 0.5],
        metric: "contact-form-submit",
      },
      "pricing-cta": {
        page: "/pricing",
        variants: ["control", "variant-a", "variant-b"],
        weights: [0.34, 0.33, 0.33],
        metric: "checkout-start",
      },
    };
    const result = parseExperiments(config);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("pricing-cta");
    expect(result[1].variants).toHaveLength(3);
  });

  it("returns empty array for empty config", () => {
    expect(parseExperiments({})).toEqual([]);
  });

  it("defaults active to true when not specified", () => {
    const config: ExperimentConfig = {
      "test-exp": {
        page: "/test",
        variants: ["control", "variant-a"],
        weights: [0.5, 0.5],
        metric: "click",
      },
    };
    const result = parseExperiments(config);
    expect(result[0].active).toBe(true);
  });

  it("preserves active: false", () => {
    const config: ExperimentConfig = {
      "test-exp": {
        page: "/test",
        variants: ["control", "variant-a"],
        weights: [0.5, 0.5],
        metric: "click",
        active: false,
      },
    };
    const result = parseExperiments(config);
    expect(result[0].active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActiveExperiment
// ---------------------------------------------------------------------------

describe("getActiveExperiment", () => {
  const experiments: Experiment[] = [
    {
      id: "homepage-hero",
      page: "/",
      variants: ["control", "variant-a"],
      weights: [0.5, 0.5],
      metric: "contact-form-submit",
      active: true,
    },
    {
      id: "pricing-cta",
      page: "/pricing",
      variants: ["control", "variant-a"],
      weights: [0.5, 0.5],
      metric: "checkout-start",
      active: true,
    },
    {
      id: "paused-test",
      page: "/about",
      variants: ["control", "variant-a"],
      weights: [0.5, 0.5],
      metric: "scroll-depth",
      active: false,
    },
  ];

  it("returns the experiment matching the pathname", () => {
    const result = getActiveExperiment("/", experiments);
    expect(result?.id).toBe("homepage-hero");
  });

  it("returns the experiment for a nested path", () => {
    const result = getActiveExperiment("/pricing", experiments);
    expect(result?.id).toBe("pricing-cta");
  });

  it("returns undefined for a path with no experiment", () => {
    expect(getActiveExperiment("/contact", experiments)).toBeUndefined();
  });

  it("skips inactive experiments", () => {
    expect(getActiveExperiment("/about", experiments)).toBeUndefined();
  });

  it("normalizes trailing slashes", () => {
    expect(getActiveExperiment("/pricing/", experiments)?.id).toBe("pricing-cta");
  });

  it("returns undefined for empty experiments array", () => {
    expect(getActiveExperiment("/", [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assignVariant — weighted random assignment
// ---------------------------------------------------------------------------

describe("assignVariant", () => {
  it("returns a variant from the list", () => {
    const variants = ["control", "variant-a"];
    const weights = [0.5, 0.5];
    const result = assignVariant(variants, weights);
    expect(variants).toContain(result);
  });

  it("respects weights over many iterations", () => {
    const variants = ["control", "variant-a"];
    const weights = [0.9, 0.1];
    const counts: Record<string, number> = { control: 0, "variant-a": 0 };
    for (let i = 0; i < 1000; i++) {
      counts[assignVariant(variants, weights)]++;
    }
    // With 90/10 split over 1000 trials, control should dominate
    expect(counts.control).toBeGreaterThan(800);
    expect(counts["variant-a"]).toBeGreaterThan(30);
  });

  it("handles a single variant", () => {
    expect(assignVariant(["control"], [1])).toBe("control");
  });

  it("handles three variants", () => {
    const variants = ["control", "variant-a", "variant-b"];
    const weights = [0.34, 0.33, 0.33];
    const result = assignVariant(variants, weights);
    expect(variants).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// parseVariantCookie / serializeVariantCookie
// ---------------------------------------------------------------------------

describe("parseVariantCookie", () => {
  it("extracts the variant from a cookie header", () => {
    const header = "exp_homepage-hero=variant-a; other=value";
    expect(parseVariantCookie(header, "homepage-hero")).toBe("variant-a");
  });

  it("returns undefined when cookie is missing", () => {
    expect(parseVariantCookie("other=value", "homepage-hero")).toBeUndefined();
  });

  it("returns undefined for empty header", () => {
    expect(parseVariantCookie("", "homepage-hero")).toBeUndefined();
  });

  it("handles cookie with no spaces after semicolons", () => {
    const header = "a=1;exp_test=control;b=2";
    expect(parseVariantCookie(header, "test")).toBe("control");
  });
});

describe("serializeVariantCookie", () => {
  it("produces a Set-Cookie string", () => {
    const result = serializeVariantCookie("homepage-hero", "variant-a");
    expect(result).toContain("exp_homepage-hero=variant-a");
    expect(result).toContain("Path=/");
    expect(result).toContain("SameSite=Lax");
  });

  it("sets HttpOnly and Secure flags", () => {
    const result = serializeVariantCookie("test", "control");
    expect(result).toContain("HttpOnly");
    expect(result).toContain("Secure");
  });
});

// ---------------------------------------------------------------------------
// resolveVariantPath
// ---------------------------------------------------------------------------

describe("resolveVariantPath", () => {
  it("returns the original path for control", () => {
    expect(resolveVariantPath("/", "control")).toBe("/");
  });

  it("appends variant name for non-control on root", () => {
    expect(resolveVariantPath("/", "variant-a")).toBe("/index.variant-a.html");
  });

  it("appends variant name for nested path", () => {
    expect(resolveVariantPath("/pricing", "variant-a")).toBe(
      "/pricing/index.variant-a.html",
    );
  });

  it("handles trailing slash", () => {
    expect(resolveVariantPath("/pricing/", "variant-b")).toBe(
      "/pricing/index.variant-b.html",
    );
  });

  it("returns original path unchanged for control on nested path", () => {
    expect(resolveVariantPath("/about", "control")).toBe("/about");
  });
});
