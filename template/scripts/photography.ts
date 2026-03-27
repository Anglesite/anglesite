/**
 * Photography shot list generator.
 *
 * Parses the photography-shots.md knowledge document and generates
 * prioritized, site-type-specific shot lists with phone photography tips.
 * Used by the /anglesite:photography skill.
 */

export interface Shot {
  label: string;
  priority: "must-have" | "high-value" | "nice-to-have";
  description: string;
  rationale: string;
  siteType: string;
  aliases: string[];
}

export interface PhotoTip {
  title: string;
  body: string;
}

export interface Resource {
  name: string;
  description: string;
  url: string;
  type: string;
}

/**
 * Parse the photography-shots.md knowledge document into structured shots.
 * @param markdown - Raw markdown content from the shots knowledge doc
 * @returns Parsed shots with label, priority, description, rationale, siteType, aliases
 */
export function parseShotList(markdown: string): Shot[] {
  const shots: Shot[] = [];
  let currentType = "";
  let currentAliases: string[] = [];

  for (const line of markdown.split("\n")) {
    // Detect site-type section headers: "## Restaurant", "## Universal", etc.
    const sectionMatch = line.match(/^## (\w+)/);
    if (sectionMatch) {
      currentType = sectionMatch[1].toLowerCase();
      currentAliases = [];
      continue;
    }

    // Parse "Covers:" lines for type aliases
    const coversMatch = line.match(/^Covers:\s*(.+)/);
    if (coversMatch && currentType) {
      currentAliases = coversMatch[1].split(",").map((a) => a.trim().toLowerCase());
      continue;
    }

    // Parse shot lines:
    // - **Label** — priority: LEVEL — Description. — Rationale.
    const shotMatch = line.match(
      /^- \*\*(.+?)\*\*\s*—\s*priority:\s*(must-have|high-value|nice-to-have)\s*—\s*(.+?)\s*—\s*(.+)$/,
    );
    if (!shotMatch || !currentType) continue;

    const [, label, priority, description, rationale] = shotMatch;

    shots.push({
      label,
      priority: priority as Shot["priority"],
      description,
      rationale,
      siteType: currentType,
      aliases: currentType === "universal" ? [] : currentAliases,
    });
  }

  return shots;
}

/**
 * Filter shots to those relevant for a given business type.
 * Always includes universal shots. Matches against both siteType and aliases.
 * @param shots - All parsed shots
 * @param businessType - Comma-separated business types (e.g. "restaurant,catering")
 * @returns Filtered shots relevant to the business
 */
export function filterByBusinessType(shots: Shot[], businessType: string): Shot[] {
  const types = businessType
    .split(",")
    .map((t) => t.trim().toLowerCase());

  return shots.filter((shot) => {
    if (shot.siteType === "universal") return true;
    // Match against the section name or any alias from the Covers line
    return types.some(
      (t) => shot.siteType === t || shot.aliases.includes(t),
    );
  });
}

const PRIORITY_EMOJI: Record<string, string> = {
  "must-have": "\uD83D\uDD34",
  "high-value": "\uD83D\uDFE1",
  "nice-to-have": "\uD83D\uDFE2",
};

const PRIORITY_LABEL: Record<string, string> = {
  "must-have": "Must-have",
  "high-value": "High value",
  "nice-to-have": "Nice to have",
};

const PRIORITY_ORDER = ["must-have", "high-value", "nice-to-have"];

/**
 * Format filtered shots into a prioritized markdown shot list.
 * @param shots - Filtered shots for the site type
 * @param businessType - The business type for the header
 * @returns Formatted markdown string
 */
export function formatShotList(shots: Shot[], businessType: string): string {
  const lines: string[] = [];
  lines.push(`# Your Shot List`);
  lines.push("");
  lines.push(
    `Based on your ${businessType} site, here are the photos that will make the biggest difference. Prioritized — start from the top.`,
  );

  for (const priority of PRIORITY_ORDER) {
    const tier = shots.filter((s) => s.priority === priority);
    if (tier.length === 0) continue;

    lines.push("");
    lines.push(
      `## ${PRIORITY_EMOJI[priority]} ${PRIORITY_LABEL[priority]}`,
    );
    lines.push("");

    for (const shot of tier) {
      lines.push(`- **${shot.label}** — ${shot.description}`);
      lines.push(`  *Why:* ${shot.rationale}`);
    }
  }

  return lines.join("\n");
}

/**
 * Return the five phone photography tips.
 * Kept as structured data so the skill can format them.
 */
export function getPhotoTips(): PhotoTip[] {
  return [
    {
      title: "Light is everything — find a window",
      body: "The best camera upgrade is free: move closer to a window. Soft, indirect natural light (not direct sun) flatters everything. Shoot with the light on your subject, not behind it. Cloudy days are better than sunny ones for portraits.",
    },
    {
      title: "Clean your lens",
      body: "Phone lenses collect fingerprints constantly. Wipe with a soft cloth before every session. This one habit fixes more blurry, hazy photos than any setting change.",
    },
    {
      title: "Lock focus and exposure",
      body: "Tap the subject on your screen before shooting. On iPhone, tap and hold to lock focus and exposure (AE/AF lock) — prevents the camera from readjusting mid-shot. On Android, most camera apps support the same tap-to-focus behavior.",
    },
    {
      title: "Keep it still — brace or use a tripod",
      body: "Camera shake is the number one cause of soft photos. Brace your elbows against your body, lean against a wall, or invest in a $15 phone tripod. For food and product shots, a tripod is worth it.",
    },
    {
      title: "Shoot more than you think you need",
      body: "Delete ruthlessly later. Take 10 to 20 variations of every important shot: different angles, distances, slightly adjusted framing. The winning shot is rarely the first.",
    },
  ];
}

/**
 * Parse external resource links from JSON.
 * @param json - Raw JSON string of resource objects
 * @returns Parsed resources, or empty array on invalid input
 */
export function getResources(json: string): Resource[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as Resource[];
  } catch {
    return [];
  }
}
