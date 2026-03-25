import { describe, it, expect } from "vitest";
import {
  parseSeasonalCalendar,
  filterByBusinessType,
  filterByDateRange,
  formatSuggestions,
  currentQuarterFiles,
  type SeasonalEvent,
} from "../template/scripts/seasonal-suggestions.js";

const sampleMarkdown = `# Q1 — January, February, March

## January

### Universal hooks

- **New Year's Day** (Jan 1) — types: all — New year hours, fresh start messaging.
- **Winter weather** — types: all — Updated hours during storms, safety tips.

### Industry hooks

- **Resolution season** — types: fitness, healthcare, salon — New member specials, wellness packages.
- **Tax prep season begins** — types: accounting, credit-union — "Get organized" checklists, appointment availability.
- **Wedding booking season starts** — types: florist, photography — Portfolio posts, "book your date" CTAs. Lead time: begin now, peak through March.

## February

### Universal hooks

- **Valentine's Day** (Feb 14) — types: all — Gift guides, specials, promotions. Lead time: 3 weeks.
- **Super Bowl weekend** (1st Sunday, date varies) — types: restaurant, brewery — Watch parties, catering specials.

### Industry hooks

- **Valentine's peak** — types: florist, restaurant, salon — Florists: this is the #1 revenue day. Lead time: 3–4 weeks.

## March

### Universal hooks

- **First day of spring** (Mar 20/21) — types: all — Seasonal transition content, fresh starts.
`;

// ---------------------------------------------------------------------------
// parseSeasonalCalendar
// ---------------------------------------------------------------------------

describe("parseSeasonalCalendar", () => {
  it("extracts events from markdown", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    expect(events.length).toBeGreaterThan(0);
  });

  it("parses event names", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const names = events.map((e) => e.name);
    expect(names).toContain("New Year's Day");
    expect(names).toContain("Valentine's Day");
    expect(names).toContain("Resolution season");
  });

  it("parses types correctly", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const resolution = events.find((e) => e.name === "Resolution season")!;
    expect(resolution.types).toEqual(["fitness", "healthcare", "salon"]);
  });

  it("parses 'all' type", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const newYear = events.find((e) => e.name === "New Year's Day")!;
    expect(newYear.types).toEqual(["all"]);
  });

  it("extracts month from section headers", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const valentine = events.find((e) => e.name === "Valentine's Day")!;
    expect(valentine.month).toBe(2);
  });

  it("extracts day from date parenthetical", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const valentine = events.find((e) => e.name === "Valentine's Day")!;
    expect(valentine.day).toBe(14);
  });

  it("handles events without a specific day", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const resolution = events.find((e) => e.name === "Resolution season")!;
    expect(resolution.day).toBeUndefined();
  });

  it("extracts description", () => {
    const events = parseSeasonalCalendar(sampleMarkdown);
    const newYear = events.find((e) => e.name === "New Year's Day")!;
    expect(newYear.description).toContain("fresh start");
  });
});

// ---------------------------------------------------------------------------
// filterByBusinessType
// ---------------------------------------------------------------------------

describe("filterByBusinessType", () => {
  const events = parseSeasonalCalendar(sampleMarkdown);

  it("includes 'all' type events for any business", () => {
    const result = filterByBusinessType(events, "plumber");
    const names = result.map((e) => e.name);
    expect(names).toContain("New Year's Day");
    expect(names).toContain("Valentine's Day");
  });

  it("includes matching industry events", () => {
    const result = filterByBusinessType(events, "florist");
    const names = result.map((e) => e.name);
    expect(names).toContain("Wedding booking season starts");
    expect(names).toContain("Valentine's peak");
  });

  it("excludes non-matching industry events", () => {
    const result = filterByBusinessType(events, "plumber");
    const names = result.map((e) => e.name);
    expect(names).not.toContain("Resolution season");
    expect(names).not.toContain("Tax prep season begins");
  });

  it("handles comma-separated business types", () => {
    const result = filterByBusinessType(events, "florist,photography");
    const names = result.map((e) => e.name);
    expect(names).toContain("Wedding booking season starts");
  });
});

// ---------------------------------------------------------------------------
// filterByDateRange
// ---------------------------------------------------------------------------

describe("filterByDateRange", () => {
  const events = parseSeasonalCalendar(sampleMarkdown);

  it("returns events in the upcoming window", () => {
    // Jan 25 — Valentine's Day is 20 days away (within 3 weeks)
    const result = filterByDateRange(events, new Date(2026, 0, 25), 3);
    const names = result.map((e) => e.name);
    expect(names).toContain("Valentine's Day");
  });

  it("excludes events outside the window", () => {
    // Jan 1 — Valentine's Day is 44 days away (outside 3 weeks)
    const result = filterByDateRange(events, new Date(2026, 0, 1), 3);
    const names = result.map((e) => e.name);
    expect(names).not.toContain("Valentine's Day");
  });

  it("includes month-level events for the current month", () => {
    // Jan 10 — January events without specific dates should match
    const result = filterByDateRange(events, new Date(2026, 0, 10), 3);
    const names = result.map((e) => e.name);
    expect(names).toContain("Winter weather");
    expect(names).toContain("Resolution season");
  });

  it("includes month-level events for next month within window", () => {
    // Jan 20 with 3 weeks = covers into Feb
    const result = filterByDateRange(events, new Date(2026, 0, 20), 3);
    const names = result.map((e) => e.name);
    // Super Bowl is a Feb event without fixed day
    expect(names).toContain("Super Bowl weekend");
  });
});

// ---------------------------------------------------------------------------
// currentQuarterFiles
// ---------------------------------------------------------------------------

describe("currentQuarterFiles", () => {
  it("returns q1 for January", () => {
    const files = currentQuarterFiles(new Date(2026, 0, 15));
    expect(files).toContain("q1.md");
  });

  it("returns q2 for April", () => {
    const files = currentQuarterFiles(new Date(2026, 3, 15));
    expect(files).toContain("q2.md");
  });

  it("includes next quarter near boundary (March)", () => {
    const files = currentQuarterFiles(new Date(2026, 2, 20));
    expect(files).toContain("q1.md");
    expect(files).toContain("q2.md");
  });

  it("includes next quarter near boundary (December)", () => {
    const files = currentQuarterFiles(new Date(2026, 11, 20));
    expect(files).toContain("q4.md");
    expect(files).toContain("q1.md");
  });
});

// ---------------------------------------------------------------------------
// formatSuggestions
// ---------------------------------------------------------------------------

describe("formatSuggestions", () => {
  it("returns plain-language suggestions", () => {
    const events: SeasonalEvent[] = [
      {
        name: "Valentine's Day",
        month: 2,
        day: 14,
        types: ["all"],
        description: "Gift guides, specials, promotions.",
      },
    ];
    const result = formatSuggestions(events, "florist", new Date(2026, 0, 25));
    expect(result).toContain("Valentine's Day");
    expect(result).toContain("florist");
  });

  it("returns empty message when no suggestions", () => {
    const result = formatSuggestions([], "plumber", new Date(2026, 0, 25));
    expect(result.toLowerCase()).toContain("no upcoming");
  });

  it("includes days-away count for dated events", () => {
    const events: SeasonalEvent[] = [
      {
        name: "Valentine's Day",
        month: 2,
        day: 14,
        types: ["all"],
        description: "Gift guides.",
      },
    ];
    const result = formatSuggestions(events, "florist", new Date(2026, 0, 25));
    expect(result).toMatch(/\d+ day/);
  });
});
