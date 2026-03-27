import { describe, it, expect } from "vitest";
import {
  parseShotList,
  filterByBusinessType,
  formatShotList,
  getPhotoTips,
  getResources,
  type Shot,
  type Resource,
} from "../template/scripts/photography.js";

const sampleMarkdown = `# Photography Shot List

Site-type-specific photography guidance.

## Universal

Every site needs these regardless of business type.

- **Hero image** — priority: must-have — Wide, well-lit, uncluttered. Represents what you do at a glance. — This is the first thing visitors see. A strong hero image sets the tone for the entire site.
- **Owner / team portrait** — priority: must-have — Natural light, relaxed pose. People buy from people. — Visitors trust businesses with real faces.
- **Work in progress** — priority: high-value — You doing the thing — not posing, actually working. — Action shots build credibility.
- **Detail / texture shot** — priority: high-value — Close-up of your craft, product, or environment. — Detail shots add visual richness.
- **Space / location** — priority: nice-to-have — Where you work, if it matters to the brand. — Helps visitors picture themselves in your space.

## Restaurant

Covers: restaurant, cafe, coffee-shop, bakery, catering

- **Signature dish** — priority: must-have — Hero plating shot from overhead and 45-degree angle. — Food is your product.
- **Dining room or bar** — priority: high-value — Empty and inviting, morning light preferred. — Visitors want to see the vibe.
- **Kitchen action** — priority: high-value — Chef or cook at work. Not posed. — Behind-the-scenes energy signals quality.

## Service

Covers: contractor, cleaner, landscaper, plumber

- **Before and after** — priority: must-have — Minimum two jobs. Same angle, same framing. — Nothing sells service work like visible proof.
- **Team on-site** — priority: must-have — Crew working, gear and uniforms visible. — Shows you're professional and equipped.
- **Finished work close-up** — priority: high-value — Detail of craftsmanship. — Close-ups prove quality.

## Professional

Covers: consultant, therapist, accountant, lawyer

- **Professional portrait** — priority: must-have — Approachable, not stiff. Natural light. — Your face is your brand.
- **Workspace** — priority: high-value — Desk, bookshelf. Signals expertise. — Shows you have a real practice.
`;

const sampleResources = [
  {
    name: "iPhone Photography School",
    description: "iOS-specific, very practical",
    url: "https://iphonephotographyschool.com",
    type: "guide",
  },
  {
    name: "Snapseed",
    description: "Best free mobile editor",
    url: "https://snapseed.online",
    type: "app",
  },
];

// ---------------------------------------------------------------------------
// parseShotList
// ---------------------------------------------------------------------------

describe("parseShotList", () => {
  it("extracts shots from markdown", () => {
    const shots = parseShotList(sampleMarkdown);
    expect(shots.length).toBeGreaterThan(0);
  });

  it("parses shot labels", () => {
    const shots = parseShotList(sampleMarkdown);
    const labels = shots.map((s) => s.label);
    expect(labels).toContain("Hero image");
    expect(labels).toContain("Signature dish");
    expect(labels).toContain("Before and after");
  });

  it("parses priority levels", () => {
    const shots = parseShotList(sampleMarkdown);
    const hero = shots.find((s) => s.label === "Hero image")!;
    expect(hero.priority).toBe("must-have");
    const detail = shots.find((s) => s.label === "Detail / texture shot")!;
    expect(detail.priority).toBe("high-value");
    const space = shots.find((s) => s.label === "Space / location")!;
    expect(space.priority).toBe("nice-to-have");
  });

  it("parses description and rationale", () => {
    const shots = parseShotList(sampleMarkdown);
    const hero = shots.find((s) => s.label === "Hero image")!;
    expect(hero.description).toContain("Wide, well-lit");
    expect(hero.rationale).toContain("first thing visitors see");
  });

  it("assigns correct site type from section headers", () => {
    const shots = parseShotList(sampleMarkdown);
    const hero = shots.find((s) => s.label === "Hero image")!;
    expect(hero.siteType).toBe("universal");
    const dish = shots.find((s) => s.label === "Signature dish")!;
    expect(dish.siteType).toBe("restaurant");
  });

  it("parses covers line into type aliases", () => {
    const shots = parseShotList(sampleMarkdown);
    const dish = shots.find((s) => s.label === "Signature dish")!;
    expect(dish.aliases).toContain("restaurant");
    expect(dish.aliases).toContain("cafe");
    expect(dish.aliases).toContain("bakery");
  });

  it("universal shots have no aliases (they match everything)", () => {
    const shots = parseShotList(sampleMarkdown);
    const hero = shots.find((s) => s.label === "Hero image")!;
    expect(hero.aliases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterByBusinessType
// ---------------------------------------------------------------------------

describe("filterByBusinessType", () => {
  const shots = parseShotList(sampleMarkdown);

  it("always includes universal shots", () => {
    const result = filterByBusinessType(shots, "plumber");
    const labels = result.map((s) => s.label);
    expect(labels).toContain("Hero image");
    expect(labels).toContain("Owner / team portrait");
    expect(labels).toContain("Work in progress");
  });

  it("includes matching site-type shots", () => {
    const result = filterByBusinessType(shots, "restaurant");
    const labels = result.map((s) => s.label);
    expect(labels).toContain("Signature dish");
    expect(labels).toContain("Dining room or bar");
  });

  it("includes shots when business matches an alias", () => {
    const result = filterByBusinessType(shots, "cafe");
    const labels = result.map((s) => s.label);
    expect(labels).toContain("Signature dish");
  });

  it("excludes non-matching site-type shots", () => {
    const result = filterByBusinessType(shots, "consultant");
    const labels = result.map((s) => s.label);
    expect(labels).not.toContain("Signature dish");
    expect(labels).not.toContain("Before and after");
  });

  it("handles comma-separated business types", () => {
    const result = filterByBusinessType(shots, "restaurant,consultant");
    const labels = result.map((s) => s.label);
    expect(labels).toContain("Signature dish");
    expect(labels).toContain("Professional portrait");
  });

  it("returns only universals for unknown business type", () => {
    const result = filterByBusinessType(shots, "unicorn-farm");
    const universals = result.filter((s) => s.siteType === "universal");
    expect(result.length).toBe(universals.length);
  });
});

// ---------------------------------------------------------------------------
// formatShotList
// ---------------------------------------------------------------------------

describe("formatShotList", () => {
  const shots = parseShotList(sampleMarkdown);

  it("groups shots by priority tier", () => {
    const filtered = filterByBusinessType(shots, "restaurant");
    const result = formatShotList(filtered, "restaurant");
    expect(result).toContain("Must-have");
    expect(result).toContain("High value");
  });

  it("includes the site type in the header", () => {
    const filtered = filterByBusinessType(shots, "restaurant");
    const result = formatShotList(filtered, "restaurant");
    expect(result).toContain("restaurant");
  });

  it("includes shot labels and descriptions", () => {
    const filtered = filterByBusinessType(shots, "restaurant");
    const result = formatShotList(filtered, "restaurant");
    expect(result).toContain("Hero image");
    expect(result).toContain("Signature dish");
  });

  it("includes nice-to-have section when present", () => {
    const filtered = filterByBusinessType(shots, "restaurant");
    const result = formatShotList(filtered, "restaurant");
    expect(result).toContain("Nice to have");
  });

  it("returns markdown format", () => {
    const filtered = filterByBusinessType(shots, "restaurant");
    const result = formatShotList(filtered, "restaurant");
    expect(result).toMatch(/^# /m); // Has a heading
    expect(result).toMatch(/^- \*\*/m); // Has bold list items
  });
});

// ---------------------------------------------------------------------------
// getPhotoTips
// ---------------------------------------------------------------------------

describe("getPhotoTips", () => {
  it("returns exactly 5 tips", () => {
    const tips = getPhotoTips();
    expect(tips).toHaveLength(5);
  });

  it("each tip has a title and body", () => {
    const tips = getPhotoTips();
    for (const tip of tips) {
      expect(tip.title).toBeTruthy();
      expect(tip.body).toBeTruthy();
    }
  });

  it("covers the five core principles", () => {
    const tips = getPhotoTips();
    const titles = tips.map((t) => t.title.toLowerCase());
    expect(titles.some((t) => t.includes("light"))).toBe(true);
    expect(titles.some((t) => t.includes("lens"))).toBe(true);
    expect(titles.some((t) => t.includes("focus"))).toBe(true);
    expect(titles.some((t) => t.includes("still"))).toBe(true);
    expect(titles.some((t) => t.includes("shoot more"))).toBe(true);
  });

  it("formats as plain-language advice", () => {
    const tips = getPhotoTips();
    // Should not contain jargon-heavy terms
    for (const tip of tips) {
      expect(tip.body).not.toContain("aperture");
      expect(tip.body).not.toContain("ISO");
      expect(tip.body).not.toContain("shutter speed");
    }
  });
});

// ---------------------------------------------------------------------------
// getResources
// ---------------------------------------------------------------------------

describe("getResources", () => {
  it("parses resource JSON", () => {
    const resources = getResources(JSON.stringify(sampleResources));
    expect(resources).toHaveLength(2);
  });

  it("each resource has name, description, url, and type", () => {
    const resources = getResources(JSON.stringify(sampleResources));
    for (const r of resources) {
      expect(r.name).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.url).toBeTruthy();
      expect(r.type).toBeTruthy();
    }
  });

  it("preserves resource data", () => {
    const resources = getResources(JSON.stringify(sampleResources));
    const iphone = resources.find((r) => r.name === "iPhone Photography School")!;
    expect(iphone.url).toBe("https://iphonephotographyschool.com");
    expect(iphone.type).toBe("guide");
  });

  it("returns empty array for invalid JSON", () => {
    const resources = getResources("not json");
    expect(resources).toEqual([]);
  });
});
