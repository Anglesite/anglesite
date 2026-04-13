import { describe, it, expect } from "vitest";
import {
  buildUtmUrl,
  buildQrUrl,
  buildRedirectLine,
  parseUtmParams,
  describeUtmSource,
  sanitizeUtmValue,
  validateUtmParams,
  formatQrReport,
  VALID_MEDIUMS,
  type UtmParams,
} from "../template/scripts/qr-generate.js";

// ---------------------------------------------------------------------------
// sanitizeUtmValue — enforce naming conventions
// ---------------------------------------------------------------------------

describe("sanitizeUtmValue", () => {
  it("lowercases values", () => {
    expect(sanitizeUtmValue("Facebook")).toBe("facebook");
  });

  it("replaces spaces with dashes", () => {
    expect(sanitizeUtmValue("spring sale")).toBe("spring-sale");
  });

  it("strips .com from source names", () => {
    expect(sanitizeUtmValue("facebook.com")).toBe("facebook");
  });

  it("removes special characters except dashes and underscores", () => {
    expect(sanitizeUtmValue("spring+sale!2026")).toBe("springsale2026");
  });

  it("preserves underscores", () => {
    expect(sanitizeUtmValue("winter_sale")).toBe("winter_sale");
  });

  it("collapses multiple dashes", () => {
    expect(sanitizeUtmValue("spring - - sale")).toBe("spring-sale");
  });

  it("trims leading and trailing dashes", () => {
    expect(sanitizeUtmValue("-sale-")).toBe("sale");
  });
});

// ---------------------------------------------------------------------------
// validateUtmParams — best practice enforcement
// ---------------------------------------------------------------------------

describe("validateUtmParams", () => {
  it("returns no errors for valid params", () => {
    const errors = validateUtmParams({
      source: "facebook",
      medium: "paid-social",
      campaign: "spring-sale-2026",
    });
    expect(errors).toEqual([]);
  });

  it("warns if medium is a platform name instead of channel type", () => {
    const errors = validateUtmParams({
      source: "newsletter",
      medium: "mailchimp",
      campaign: "weekly",
    });
    expect(errors.some((e) => e.toLowerCase().includes("medium"))).toBe(true);
  });

  it("warns if source and medium are the same", () => {
    const errors = validateUtmParams({
      source: "email",
      medium: "email",
      campaign: "test",
    });
    expect(errors.some((e) => e.toLowerCase().includes("redundant"))).toBe(true);
  });

  it("requires source, medium, and campaign", () => {
    const errors = validateUtmParams({} as UtmParams);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts all valid medium values", () => {
    for (const medium of VALID_MEDIUMS) {
      const errors = validateUtmParams({
        source: "test",
        medium,
        campaign: "test",
      });
      expect(errors.filter((e) => e.includes("medium"))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// buildUtmUrl
// ---------------------------------------------------------------------------

describe("buildUtmUrl", () => {
  it("appends UTM parameters to a URL", () => {
    const url = buildUtmUrl("https://example.com/menu", {
      source: "facebook",
      medium: "paid-social",
      campaign: "spring-sale",
    });
    expect(url).toContain("utm_source=facebook");
    expect(url).toContain("utm_medium=paid-social");
    expect(url).toContain("utm_campaign=spring-sale");
  });

  it("auto-sanitizes values", () => {
    const url = buildUtmUrl("https://example.com", {
      source: "Facebook.com",
      medium: "Paid Social",
      campaign: "Spring Sale 2026",
    });
    expect(url).toContain("utm_source=facebook");
    expect(url).toContain("utm_medium=paid-social");
    expect(url).toContain("utm_campaign=spring-sale-2026");
  });

  it("includes optional content and term params", () => {
    const url = buildUtmUrl("https://example.com", {
      source: "google",
      medium: "cpc",
      campaign: "brand",
      term: "pizza-near-me",
      content: "headline-a",
    });
    expect(url).toContain("utm_term=pizza-near-me");
    expect(url).toContain("utm_content=headline-a");
  });

  it("preserves existing query params", () => {
    const url = buildUtmUrl("https://example.com?page=2", {
      source: "newsletter",
      medium: "email",
      campaign: "weekly",
    });
    expect(url).toContain("page=2");
    expect(url).toContain("utm_source=newsletter");
  });

  it("omits undefined optional params", () => {
    const url = buildUtmUrl("https://example.com", {
      source: "qr",
      medium: "print",
      campaign: "menu",
    });
    expect(url).not.toContain("utm_term");
    expect(url).not.toContain("utm_content");
  });
});

// ---------------------------------------------------------------------------
// buildQrUrl
// ---------------------------------------------------------------------------

describe("buildQrUrl", () => {
  it("sets source=qr and medium=print", () => {
    const url = buildQrUrl("https://example.com", "table-tent");
    expect(url).toContain("utm_source=qr");
    expect(url).toContain("utm_medium=print");
  });

  it("uses the label as campaign name", () => {
    const url = buildQrUrl("https://example.com", "spring-flyer");
    expect(url).toContain("utm_campaign=spring-flyer");
  });

  it("defaults campaign to 'website' when no label", () => {
    const url = buildQrUrl("https://example.com");
    expect(url).toContain("utm_campaign=website");
  });

  it("sanitizes the label", () => {
    const url = buildQrUrl("https://example.com", "Spring Flyer 2026");
    expect(url).toContain("utm_campaign=spring-flyer-2026");
  });
});

// ---------------------------------------------------------------------------
// buildRedirectLine
// ---------------------------------------------------------------------------

describe("buildRedirectLine", () => {
  it("generates a _redirects line with 301", () => {
    const line = buildRedirectLine("/menu", "/services");
    expect(line).toBe("/menu /services 301");
  });

  it("appends UTM params to the target", () => {
    const line = buildRedirectLine("/podcast", "/", {
      source: "podcast",
      medium: "referral",
      campaign: "episode-42",
    });
    expect(line).toContain("/podcast");
    expect(line).toContain("utm_source=podcast");
    expect(line).toContain("301");
  });

  it("sanitizes slug with spaces into URL-safe format", () => {
    const line = buildRedirectLine("my slug", "/");
    const slug = line.split(" ")[0];
    expect(slug).not.toContain(" ");
    expect(slug).toBe("/my-slug");
  });

  it("ensures slug starts with /", () => {
    const line = buildRedirectLine("promo", "/");
    expect(line).toMatch(/^\/promo /);
  });

  it("ensures targetPath starts with /", () => {
    const line = buildRedirectLine("/go", "services");
    expect(line).toContain("/go /services");
  });

  it("sanitizes UTM values in redirect", () => {
    const line = buildRedirectLine("/promo", "/", {
      source: "Radio Ad",
      medium: "referral",
      campaign: "Summer Promo",
    });
    expect(line).toContain("utm_source=radio-ad");
    expect(line).toContain("utm_campaign=summer-promo");
  });
});

// ---------------------------------------------------------------------------
// parseUtmParams
// ---------------------------------------------------------------------------

describe("parseUtmParams", () => {
  it("extracts UTM params from a URL", () => {
    const params = parseUtmParams(
      "https://example.com?utm_source=facebook&utm_medium=paid-social&utm_campaign=spring",
    );
    expect(params.source).toBe("facebook");
    expect(params.medium).toBe("paid-social");
    expect(params.campaign).toBe("spring");
  });

  it("extracts optional params", () => {
    const params = parseUtmParams(
      "https://example.com?utm_source=x&utm_medium=y&utm_campaign=z&utm_term=shoes&utm_content=banner",
    );
    expect(params.term).toBe("shoes");
    expect(params.content).toBe("banner");
  });

  it("returns empty strings for missing params", () => {
    const params = parseUtmParams("https://example.com");
    expect(params.source).toBe("");
    expect(params.medium).toBe("");
    expect(params.campaign).toBe("");
  });

  it("returns empty params for malformed URL instead of throwing", () => {
    const params = parseUtmParams("not a url");
    expect(params.source).toBe("");
    expect(params.medium).toBe("");
    expect(params.campaign).toBe("");
  });

  it("returns empty params for empty string", () => {
    const params = parseUtmParams("");
    expect(params.source).toBe("");
    expect(params.medium).toBe("");
    expect(params.campaign).toBe("");
  });
});

// ---------------------------------------------------------------------------
// describeUtmSource
// ---------------------------------------------------------------------------

describe("describeUtmSource", () => {
  it("describes QR code traffic", () => {
    const desc = describeUtmSource({
      source: "qr",
      medium: "print",
      campaign: "table-tent",
    });
    expect(desc.toLowerCase()).toContain("qr");
    expect(desc.toLowerCase()).toContain("table-tent");
  });

  it("describes email traffic", () => {
    const desc = describeUtmSource({
      source: "newsletter",
      medium: "email",
      campaign: "weekly-update",
    });
    expect(desc.toLowerCase()).toContain("email");
    expect(desc.toLowerCase()).toContain("newsletter");
  });

  it("describes paid social", () => {
    const desc = describeUtmSource({
      source: "facebook",
      medium: "paid-social",
      campaign: "march-promo",
    });
    expect(desc.toLowerCase()).toContain("facebook");
    expect(desc.toLowerCase()).toContain("ad");
  });

  it("handles generic sources", () => {
    const desc = describeUtmSource({
      source: "partner-site",
      medium: "referral",
      campaign: "collab",
    });
    expect(desc.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatQrReport
// ---------------------------------------------------------------------------

describe("formatQrReport", () => {
  it("summarizes generated QR codes", () => {
    const report = formatQrReport([
      { file: "homepage.svg", url: "https://example.com", label: "homepage" },
      { file: "menu.svg", url: "https://example.com/menu", label: "menu" },
    ]);
    expect(report).toContain("2");
    expect(report).toContain("QR");
  });

  it("handles empty list", () => {
    const report = formatQrReport([]);
    expect(report.toLowerCase()).toContain("no qr");
  });
});
