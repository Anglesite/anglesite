/**
 * Analytics summary formatters.
 *
 * Transforms raw Cloudflare Analytics API data into plain-language
 * summaries for the site owner. Used by /anglesite:stats.
 */

export interface CampaignData {
  source: string;
  medium: string;
  campaign: string;
  visits: number;
}

export interface AnalyticsData {
  visitors: { current: number; previous?: number };
  topPages: { path: string; views: number }[];
  referrers: { source: string; visits: number }[];
  devices: { type: string; visits: number }[];
  dailyCounts: { day: string; visits: number }[];
  campaigns?: CampaignData[];
}

const DAY_BEFORE: Record<string, string> = {
  Monday: "Sunday",
  Tuesday: "Monday",
  Wednesday: "Tuesday",
  Thursday: "Wednesday",
  Friday: "Thursday",
  Saturday: "Friday",
  Sunday: "Saturday",
};

/**
 * "142 visitors this week (up 23% from last week)"
 */
export function formatVisitorSummary(
  current: number,
  previous?: number,
): string {
  const label = `${current} visitor${current !== 1 ? "s" : ""} this week`;

  if (previous === undefined || previous === null) {
    return label + ".";
  }

  if (previous === 0) {
    if (current === 0) return label + " (same as last week).";
    return label + " (no visitors last week).";
  }

  const change = Math.round(((current - previous) / previous) * 100);

  if (change === 0) return label + " (same as last week).";
  if (change > 0) return label + ` (up ${change}% from last week).`;
  return label + ` (down ${Math.abs(change)}% from last week).`;
}

/**
 * Ranked list of top 5 pages by views.
 */
export function formatTopPages(
  pages: { path: string; views: number }[],
): string {
  if (pages.length === 0) return "No page data available.";

  const sorted = [...pages].sort((a, b) => b.views - a.views).slice(0, 5);
  const lines = sorted.map(
    (p, i) => `${i + 1}. ${p.path} — ${p.views} view${p.views !== 1 ? "s" : ""}`,
  );
  return "Top pages:\n" + lines.join("\n");
}

/**
 * Where visitors come from.
 */
export function formatReferrers(
  referrers: { source: string; visits: number }[],
): string {
  if (referrers.length === 0) return "No referrer data available.";

  const sorted = [...referrers].sort((a, b) => b.visits - a.visits);
  const lines = sorted.map(
    (r) =>
      `- ${r.source}: ${r.visits} visit${r.visits !== 1 ? "s" : ""}`,
  );
  return "Traffic sources:\n" + lines.join("\n");
}

/**
 * Device type breakdown as percentages.
 */
export function formatDevices(
  devices: { type: string; visits: number }[],
): string {
  if (devices.length === 0) return "No device data available.";

  const total = devices.reduce((sum, d) => sum + d.visits, 0);
  if (total === 0) return "No device data available.";

  const lines = devices.map((d) => {
    const pct = Math.round((d.visits / total) * 100);
    return `${d.type}: ${pct}%`;
  });
  return "Devices: " + lines.join(", ") + ".";
}

/**
 * Busiest day of the week with posting suggestion.
 */
export function formatBusiestDay(
  dailyCounts: { day: string; visits: number }[],
): string {
  if (dailyCounts.length === 0) return "No traffic data available yet.";

  const sorted = [...dailyCounts].sort((a, b) => b.visits - a.visits);
  const busiest = sorted[0];

  const dayBefore = DAY_BEFORE[busiest.day] || "the day before";
  return (
    `Busiest day: ${busiest.day} with ${busiest.visits} visit${busiest.visits !== 1 ? "s" : ""}. ` +
    `Consider posting new content on ${dayBefore} to catch the wave.`
  );
}

/**
 * UTM campaign breakdown with plain-language descriptions.
 */
export function formatCampaigns(campaigns: CampaignData[]): string {
  if (campaigns.length === 0) return "No campaign data available.";

  const sorted = [...campaigns].sort((a, b) => b.visits - a.visits);
  const lines = sorted.map((c) => {
    const desc = describeCampaignSource(c);
    return `- ${desc}: ${c.visits} visit${c.visits !== 1 ? "s" : ""}`;
  });
  return "Campaigns:\n" + lines.join("\n");
}

function describeCampaignSource(c: CampaignData): string {
  if (c.medium === "print" && c.source === "qr") {
    return `QR code "${c.campaign}"`;
  }
  if (c.medium === "email") {
    return `Email "${c.campaign}" via ${c.source}`;
  }
  if (c.medium === "paid-social") {
    return `${c.source} ad "${c.campaign}"`;
  }
  if (c.medium === "cpc") {
    return `${c.source} search ad "${c.campaign}"`;
  }
  if (c.medium === "organic-social") {
    return `${c.source} post "${c.campaign}"`;
  }
  return `${c.source} / ${c.medium} "${c.campaign}"`;
}

/**
 * Complete plain-language analytics report.
 */
export function formatFullReport(data: AnalyticsData): string {
  const sections = [
    formatVisitorSummary(data.visitors.current, data.visitors.previous),
    formatTopPages(data.topPages),
    formatReferrers(data.referrers),
    formatDevices(data.devices),
    formatBusiestDay(data.dailyCounts),
  ];

  if (data.campaigns && data.campaigns.length > 0) {
    sections.push(formatCampaigns(data.campaigns));
  }

  return sections.join("\n\n");
}
