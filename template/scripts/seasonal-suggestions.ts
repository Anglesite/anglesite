/**
 * Seasonal content suggestion engine.
 *
 * Parses the seasonal calendar markdown files and surfaces relevant
 * content hooks based on business type and current date.
 * Used by the /anglesite:seasonal skill.
 *
 * IMPORTANT: All functions require an explicit date parameter.
 * Never rely on Date.now() — LLMs cannot reliably know the current date.
 * The skill reads the date from the system via `date +%Y-%m-%d`.
 */

export interface SeasonalEvent {
  name: string;
  month: number;
  day?: number;
  types: string[];
  description: string;
}

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_ABBREVS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Parse a seasonal calendar markdown file into structured events.
 */
export function parseSeasonalCalendar(markdown: string): SeasonalEvent[] {
  const events: SeasonalEvent[] = [];
  let currentMonth = 0;

  for (const line of markdown.split("\n")) {
    // Detect month headers: "## January", "## February", etc.
    const monthMatch = line.match(/^## (\w+)/);
    if (monthMatch) {
      const m = MONTH_NAMES[monthMatch[1].toLowerCase()];
      if (m) currentMonth = m;
      continue;
    }

    // Parse event lines: - **Name** (date) — types: t1, t2 — Description.
    const eventMatch = line.match(
      /^- \*\*(.+?)\*\*\s*(?:\(([^)]*)\))?\s*—\s*types:\s*(.+?)\s*—\s*(.+)$/,
    );
    if (!eventMatch || currentMonth === 0) continue;

    const [, name, dateInfo, typesStr, description] = eventMatch;
    const types = typesStr.split(",").map((t) => t.trim().toLowerCase());

    // Extract day from date info like "Feb 14", "Jan 1", "Apr 22"
    let day: number | undefined;
    if (dateInfo) {
      const dayMatch = dateInfo.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})/i,
      );
      if (dayMatch) {
        day = parseInt(dayMatch[1], 10);
      }
    }

    events.push({ name, month: currentMonth, day, types, description });
  }

  return events;
}

/**
 * Filter events by business type. Includes "all" type events.
 * businessType can be comma-separated for multi-mode businesses.
 */
export function filterByBusinessType(
  events: SeasonalEvent[],
  businessType: string,
): SeasonalEvent[] {
  const types = businessType
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  return events.filter(
    (e) =>
      e.types.includes("all") || e.types.some((t) => types.includes(t)),
  );
}

/**
 * Filter events to those within the next N weeks from currentDate.
 *
 * For events with a specific day: checks if the date falls within the window.
 * For events without a day (month-level): includes if any part of that month
 * overlaps with the window.
 */
export function filterByDateRange(
  events: SeasonalEvent[],
  currentDate: Date,
  weeksAhead: number,
): SeasonalEvent[] {
  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);

  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + weeksAhead * 7);

  const currentYear = today.getFullYear();

  return events.filter((e) => {
    if (e.day) {
      // Specific date — check if within window
      const eventDate = new Date(currentYear, e.month - 1, e.day);
      return eventDate >= today && eventDate <= windowEnd;
    }

    // Month-level event — include if any part of the month overlaps the window
    const monthStart = new Date(currentYear, e.month - 1, 1);
    const monthEnd = new Date(currentYear, e.month, 0); // last day of month
    return monthEnd >= today && monthStart <= windowEnd;
  });
}

/**
 * Determine which quarter files to read based on the current date.
 * Includes next quarter if within the last 2 weeks of the current quarter.
 */
export function currentQuarterFiles(currentDate: Date): string[] {
  const month = currentDate.getMonth(); // 0-indexed
  const day = currentDate.getDate();

  const quarterMap: Record<number, string> = {
    0: "q1.md",
    1: "q1.md",
    2: "q1.md",
    3: "q2.md",
    4: "q2.md",
    5: "q2.md",
    6: "q3.md",
    7: "q3.md",
    8: "q3.md",
    9: "q4.md",
    10: "q4.md",
    11: "q4.md",
  };

  const nextQuarterMap: Record<string, string> = {
    "q1.md": "q2.md",
    "q2.md": "q3.md",
    "q3.md": "q4.md",
    "q4.md": "q1.md",
  };

  const current = quarterMap[month];
  const files = [current];

  // Near quarter boundary (last month, day >= 15)
  const isLastMonthOfQuarter = month % 3 === 2;
  if (isLastMonthOfQuarter && day >= 15) {
    files.push(nextQuarterMap[current]);
  }

  return files;
}

/**
 * Format events into plain-language suggestions.
 */
export function formatSuggestions(
  events: SeasonalEvent[],
  businessType: string,
  currentDate: Date,
): string {
  if (events.length === 0) {
    return `No upcoming seasonal content hooks for a ${businessType} business in the next few weeks.`;
  }

  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);

  const lines = events.map((e) => {
    let timing = "";
    if (e.day) {
      const eventDate = new Date(today.getFullYear(), e.month - 1, e.day);
      const daysAway = Math.round(
        (eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysAway > 0) {
        timing = ` (${daysAway} day${daysAway !== 1 ? "s" : ""} away)`;
      } else if (daysAway === 0) {
        timing = " (today)";
      }
    }

    return `- **${e.name}**${timing} — ${e.description}`;
  });

  return (
    `Upcoming content ideas for your ${businessType} business:\n\n` +
    lines.join("\n")
  );
}
