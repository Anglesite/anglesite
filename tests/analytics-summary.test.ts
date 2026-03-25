import { describe, it, expect } from "vitest";
import {
  formatVisitorSummary,
  formatTopPages,
  formatReferrers,
  formatDevices,
  formatBusiestDay,
  formatCampaigns,
  formatFullReport,
  type AnalyticsData,
} from "../template/scripts/analytics-summary.js";

// ---------------------------------------------------------------------------
// formatVisitorSummary
// ---------------------------------------------------------------------------

describe("formatVisitorSummary", () => {
  it("shows visitor count and percentage increase", () => {
    const result = formatVisitorSummary(142, 115);
    expect(result).toContain("142");
    expect(result).toMatch(/up\s+23%/i);
  });

  it("shows percentage decrease", () => {
    const result = formatVisitorSummary(80, 100);
    expect(result).toMatch(/down\s+20%/i);
  });

  it("handles zero previous visitors", () => {
    const result = formatVisitorSummary(50, 0);
    expect(result).toContain("50");
    expect(result).not.toContain("NaN");
    expect(result).not.toContain("Infinity");
  });

  it("handles no previous data", () => {
    const result = formatVisitorSummary(50, undefined);
    expect(result).toContain("50");
    expect(result).not.toContain("%");
  });

  it("handles zero current visitors", () => {
    const result = formatVisitorSummary(0, 10);
    expect(result).toContain("0");
  });

  it("shows no change when equal", () => {
    const result = formatVisitorSummary(100, 100);
    expect(result).toContain("100");
  });
});

// ---------------------------------------------------------------------------
// formatTopPages
// ---------------------------------------------------------------------------

describe("formatTopPages", () => {
  it("lists pages ranked by views", () => {
    const pages = [
      { path: "/services", views: 58 },
      { path: "/", views: 45 },
      { path: "/about", views: 30 },
    ];
    const result = formatTopPages(pages);
    expect(result).toContain("/services");
    expect(result).toContain("58");
    expect(result.indexOf("/services")).toBeLessThan(result.indexOf("/about"));
  });

  it("returns a message for empty data", () => {
    const result = formatTopPages([]);
    expect(result.toLowerCase()).toContain("no page");
  });

  it("limits to top 5 pages", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      path: `/page-${i}`,
      views: 100 - i * 10,
    }));
    const result = formatTopPages(pages);
    expect(result).toContain("/page-0");
    expect(result).toContain("/page-4");
    expect(result).not.toContain("/page-5");
  });
});

// ---------------------------------------------------------------------------
// formatReferrers
// ---------------------------------------------------------------------------

describe("formatReferrers", () => {
  it("lists referral sources", () => {
    const referrers = [
      { source: "Google Search", visits: 80 },
      { source: "Direct", visits: 40 },
      { source: "Facebook", visits: 20 },
    ];
    const result = formatReferrers(referrers);
    expect(result).toContain("Google Search");
    expect(result).toContain("Direct");
  });

  it("returns a message for empty data", () => {
    const result = formatReferrers([]);
    expect(result.toLowerCase()).toContain("no referr");
  });
});

// ---------------------------------------------------------------------------
// formatDevices
// ---------------------------------------------------------------------------

describe("formatDevices", () => {
  it("shows percentages for each device type", () => {
    const devices = [
      { type: "mobile", visits: 67 },
      { type: "desktop", visits: 33 },
    ];
    const result = formatDevices(devices);
    expect(result).toMatch(/mobile.*67%/i);
    expect(result).toMatch(/desktop.*33%/i);
  });

  it("handles single device type", () => {
    const devices = [{ type: "mobile", visits: 100 }];
    const result = formatDevices(devices);
    expect(result).toMatch(/mobile.*100%/i);
  });

  it("returns a message for empty data", () => {
    const result = formatDevices([]);
    expect(result.toLowerCase()).toContain("no device");
  });
});

// ---------------------------------------------------------------------------
// formatBusiestDay
// ---------------------------------------------------------------------------

describe("formatBusiestDay", () => {
  it("identifies the busiest day", () => {
    const days = [
      { day: "Monday", visits: 15 },
      { day: "Tuesday", visits: 30 },
      { day: "Wednesday", visits: 20 },
    ];
    const result = formatBusiestDay(days);
    expect(result).toContain("Tuesday");
  });

  it("suggests posting before the busiest day", () => {
    const days = [
      { day: "Monday", visits: 15 },
      { day: "Tuesday", visits: 30 },
    ];
    const result = formatBusiestDay(days);
    expect(result.toLowerCase()).toContain("monday");
  });

  it("returns a message for empty data", () => {
    const result = formatBusiestDay([]);
    expect(result.toLowerCase()).toContain("no traffic");
  });
});

// ---------------------------------------------------------------------------
// formatFullReport
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// formatCampaigns
// ---------------------------------------------------------------------------

describe("formatCampaigns", () => {
  it("lists campaigns with visit counts", () => {
    const campaigns = [
      { source: "qr", medium: "print", campaign: "table-tent", visits: 23 },
      { source: "facebook", medium: "paid-social", campaign: "march-promo", visits: 45 },
    ];
    const result = formatCampaigns(campaigns);
    expect(result).toContain("table-tent");
    expect(result).toContain("march-promo");
    expect(result).toContain("23");
    expect(result).toContain("45");
  });

  it("includes plain-language descriptions", () => {
    const campaigns = [
      { source: "qr", medium: "print", campaign: "menu-card", visits: 10 },
    ];
    const result = formatCampaigns(campaigns);
    expect(result.toLowerCase()).toContain("qr");
  });

  it("returns a message for empty data", () => {
    const result = formatCampaigns([]);
    expect(result.toLowerCase()).toContain("no campaign");
  });

  it("sorts by visit count descending", () => {
    const campaigns = [
      { source: "a", medium: "email", campaign: "low", visits: 5 },
      { source: "b", medium: "print", campaign: "high", visits: 50 },
    ];
    const result = formatCampaigns(campaigns);
    expect(result.indexOf("high")).toBeLessThan(result.indexOf("low"));
  });
});

// ---------------------------------------------------------------------------
// formatFullReport
// ---------------------------------------------------------------------------

describe("formatFullReport", () => {
  const data: AnalyticsData = {
    visitors: { current: 142, previous: 115 },
    topPages: [
      { path: "/services", views: 58 },
      { path: "/", views: 45 },
    ],
    referrers: [
      { source: "Google Search", visits: 80 },
      { source: "Direct", visits: 40 },
    ],
    devices: [
      { type: "mobile", visits: 67 },
      { type: "desktop", visits: 33 },
    ],
    dailyCounts: [
      { day: "Monday", visits: 15 },
      { day: "Tuesday", visits: 30 },
      { day: "Wednesday", visits: 25 },
    ],
  };

  it("includes all sections", () => {
    const result = formatFullReport(data);
    expect(result).toContain("142");
    expect(result).toContain("/services");
    expect(result).toContain("Google Search");
    expect(result).toContain("mobile");
    expect(result).toContain("Tuesday");
  });

  it("includes campaign section when present", () => {
    const withCampaigns: AnalyticsData = {
      ...data,
      campaigns: [
        { source: "qr", medium: "print", campaign: "flyer", visits: 15 },
      ],
    };
    const result = formatFullReport(withCampaigns);
    expect(result).toContain("flyer");
  });

  it("returns non-empty output", () => {
    expect(formatFullReport(data).length).toBeGreaterThan(0);
  });

  it("handles empty analytics data", () => {
    const empty: AnalyticsData = {
      visitors: { current: 0 },
      topPages: [],
      referrers: [],
      devices: [],
      dailyCounts: [],
    };
    const result = formatFullReport(empty);
    expect(result.length).toBeGreaterThan(0);
  });
});
