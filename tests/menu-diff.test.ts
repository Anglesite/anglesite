import { describe, it, expect } from "vitest";
import {
  normalizeItemName,
  similarityScore,
  matchMenuItems,
  computeMenuDiff,
  detectOwnerEdits,
  formatDiffSummary,
  buildImportLog,
  mergeApprovedChanges,
  type ExistingMenuItem,
  type IncomingMenuItem,
  type ImportLogEntry,
} from "../template/scripts/menu-diff.js";

// ---------------------------------------------------------------------------
// normalizeItemName — normalize names for matching
// ---------------------------------------------------------------------------

describe("normalizeItemName", () => {
  it("lowercases the name", () => {
    expect(normalizeItemName("Grilled Chicken")).toBe("grilled chicken");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeItemName("  Caesar Salad  ")).toBe("caesar salad");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeItemName("New   York   Strip")).toBe("new york strip");
  });

  it("removes non-alphanumeric chars except spaces", () => {
    expect(normalizeItemName("Chef's Special™")).toBe("chefs special");
  });

  it("handles empty string", () => {
    expect(normalizeItemName("")).toBe("");
  });

  it("preserves numbers", () => {
    expect(normalizeItemName("12oz Ribeye")).toBe("12oz ribeye");
  });
});

// ---------------------------------------------------------------------------
// similarityScore — Levenshtein-based 0–1 similarity
// ---------------------------------------------------------------------------

describe("similarityScore", () => {
  it("returns 1 for identical strings", () => {
    expect(similarityScore("grilled chicken", "grilled chicken")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(similarityScore("abc", "xyz")).toBe(0);
  });

  it("returns high score for minor differences", () => {
    const score = similarityScore("grilled chicken", "char-grilled chicken");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns low score for major differences", () => {
    const score = similarityScore("grilled chicken", "chocolate cake");
    expect(score).toBeLessThan(0.4);
  });

  it("handles empty strings", () => {
    expect(similarityScore("", "")).toBe(1);
    expect(similarityScore("abc", "")).toBe(0);
    expect(similarityScore("", "abc")).toBe(0);
  });

  it("is case-insensitive when comparing normalized names", () => {
    // similarityScore operates on already-normalized strings,
    // but should still work with mixed case input
    const score = similarityScore("grilled chicken", "grilled chickn");
    expect(score).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// matchMenuItems — pair existing ↔ incoming items
// ---------------------------------------------------------------------------

describe("matchMenuItems", () => {
  const existing: ExistingMenuItem[] = [
    { slug: "bruschetta", name: "Bruschetta", section: "appetizers", price: "$8", dietary: [], description: "", lastImported: "2026-01-15" },
    { slug: "pasta", name: "Pasta Primavera", section: "entrees", price: "$16", dietary: ["vegetarian"], description: "Fresh seasonal vegetables", lastImported: "2026-01-15" },
    { slug: "tiramisu", name: "Tiramisu", section: "desserts", price: "$10", dietary: [], description: "", lastImported: "2026-01-15" },
  ];

  const incoming: IncomingMenuItem[] = [
    { name: "Bruschetta", section: "appetizers", price: "$9", dietary: [], description: "" },
    { name: "Pasta Primavera", section: "entrees", price: "$16", dietary: ["vegetarian"], description: "Fresh seasonal vegetables" },
    { name: "Crème Brûlée", section: "desserts", price: "$12", dietary: [], description: "Classic French custard" },
  ];

  it("matches items by normalized name + section", () => {
    const result = matchMenuItems(existing, incoming);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].existing.slug).toBe("bruschetta");
    expect(result.matched[0].incoming.name).toBe("Bruschetta");
  });

  it("identifies unmatched existing items as removals", () => {
    const result = matchMenuItems(existing, incoming);
    expect(result.removals).toHaveLength(1);
    expect(result.removals[0].name).toBe("Tiramisu");
  });

  it("identifies unmatched incoming items as additions", () => {
    const result = matchMenuItems(existing, incoming);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0].name).toBe("Crème Brûlée");
  });

  it("handles exact name match across different sections", () => {
    const existingDup: ExistingMenuItem[] = [
      { slug: "salad-lunch", name: "House Salad", section: "lunch", price: "$8", dietary: [], description: "", lastImported: "2026-01-15" },
      { slug: "salad-dinner", name: "House Salad", section: "dinner", price: "$10", dietary: [], description: "", lastImported: "2026-01-15" },
    ];
    const incomingDup: IncomingMenuItem[] = [
      { name: "House Salad", section: "lunch", price: "$9", dietary: [], description: "" },
      { name: "House Salad", section: "dinner", price: "$11", dietary: [], description: "" },
    ];
    const result = matchMenuItems(existingDup, incomingDup);
    expect(result.matched).toHaveLength(2);
    expect(result.additions).toHaveLength(0);
    expect(result.removals).toHaveLength(0);
  });

  it("fuzzy matches minor name changes", () => {
    const existingFuzzy: ExistingMenuItem[] = [
      { slug: "chicken", name: "Grilled Chicken", section: "entrees", price: "$14", dietary: [], description: "", lastImported: "2026-01-15" },
    ];
    const incomingFuzzy: IncomingMenuItem[] = [
      { name: "Char-Grilled Chicken", section: "entrees", price: "$15", dietary: [], description: "" },
    ];
    const result = matchMenuItems(existingFuzzy, incomingFuzzy);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].fuzzy).toBe(true);
  });

  it("does not fuzzy match very different names", () => {
    const existingDiff: ExistingMenuItem[] = [
      { slug: "burger", name: "Classic Burger", section: "entrees", price: "$14", dietary: [], description: "", lastImported: "2026-01-15" },
    ];
    const incomingDiff: IncomingMenuItem[] = [
      { name: "Chocolate Cake", section: "desserts", price: "$8", dietary: [], description: "" },
    ];
    const result = matchMenuItems(existingDiff, incomingDiff);
    expect(result.matched).toHaveLength(0);
    expect(result.removals).toHaveLength(1);
    expect(result.additions).toHaveLength(1);
  });

  it("handles empty existing array", () => {
    const result = matchMenuItems([], incoming);
    expect(result.matched).toHaveLength(0);
    expect(result.additions).toHaveLength(3);
    expect(result.removals).toHaveLength(0);
  });

  it("handles empty incoming array", () => {
    const result = matchMenuItems(existing, []);
    expect(result.matched).toHaveLength(0);
    expect(result.additions).toHaveLength(0);
    expect(result.removals).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// computeMenuDiff — classify matched pairs
// ---------------------------------------------------------------------------

describe("computeMenuDiff", () => {
  it("classifies unchanged items", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: ["vegetarian"], description: "Fresh pasta", lastImported: "2026-01-15" },
        incoming: { name: "Pasta", section: "entrees", price: "$16", dietary: ["vegetarian"], description: "Fresh pasta" },
        fuzzy: false,
      },
    ]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.changed).toHaveLength(0);
  });

  it("detects price changes", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "", lastImported: "2026-01-15" },
        incoming: { name: "Pasta", section: "entrees", price: "$18", dietary: [], description: "" },
        fuzzy: false,
      },
    ]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toContainEqual({
      field: "price",
      from: "$16",
      to: "$18",
    });
  });

  it("detects description changes", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "Old desc", lastImported: "2026-01-15" },
        incoming: { name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "New desc" },
        fuzzy: false,
      },
    ]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toContainEqual({
      field: "description",
      from: "Old desc",
      to: "New desc",
    });
  });

  it("detects dietary tag changes", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: ["vegetarian"], description: "", lastImported: "2026-01-15" },
        incoming: { name: "Pasta", section: "entrees", price: "$16", dietary: ["vegetarian", "gluten-free"], description: "" },
        fuzzy: false,
      },
    ]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes.some((c) => c.field === "dietary")).toBe(true);
  });

  it("detects multiple changes on one item", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "Old", lastImported: "2026-01-15" },
        incoming: { name: "Pasta", section: "entrees", price: "$18", dietary: ["vegan"], description: "New" },
        fuzzy: false,
      },
    ]);
    expect(diff.changed[0].changes).toHaveLength(3);
  });

  it("flags fuzzy matches for review", () => {
    const diff = computeMenuDiff([
      {
        existing: { slug: "chicken", name: "Grilled Chicken", section: "entrees", price: "$14", dietary: [], description: "", lastImported: "2026-01-15" },
        incoming: { name: "Char-Grilled Chicken", section: "entrees", price: "$14", dietary: [], description: "" },
        fuzzy: true,
      },
    ]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].fuzzy).toBe(true);
    expect(diff.changed[0].changes.some((c) => c.field === "name")).toBe(true);
  });

  it("handles empty matches array", () => {
    const diff = computeMenuDiff([]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectOwnerEdits — check if owner manually edited an item
// ---------------------------------------------------------------------------

describe("detectOwnerEdits", () => {
  const importSnapshot: IncomingMenuItem = {
    name: "Bruschetta",
    section: "appetizers",
    price: "$8",
    dietary: [],
    description: "Toasted bread with tomatoes",
  };

  it("returns no edits when item matches import snapshot", () => {
    const current: ExistingMenuItem = {
      slug: "bruschetta",
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: [],
      description: "Toasted bread with tomatoes",
      lastImported: "2026-01-15",
    };
    const edits = detectOwnerEdits(current, importSnapshot);
    expect(edits).toEqual([]);
  });

  it("detects owner-edited description", () => {
    const current: ExistingMenuItem = {
      slug: "bruschetta",
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: [],
      description: "Our signature appetizer with heirloom tomatoes",
      lastImported: "2026-01-15",
    };
    const edits = detectOwnerEdits(current, importSnapshot);
    expect(edits).toContain("description");
  });

  it("detects owner-added image", () => {
    const current: ExistingMenuItem = {
      slug: "bruschetta",
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: [],
      description: "Toasted bread with tomatoes",
      lastImported: "2026-01-15",
      image: "/images/menu/bruschetta.webp",
    };
    const edits = detectOwnerEdits(current, importSnapshot);
    expect(edits).toContain("image");
  });

  it("detects owner-added custom tags", () => {
    const current: ExistingMenuItem = {
      slug: "bruschetta",
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: [],
      description: "Toasted bread with tomatoes",
      lastImported: "2026-01-15",
      customTags: [{ label: "House Favorite" }],
    };
    const edits = detectOwnerEdits(current, importSnapshot);
    expect(edits).toContain("customTags");
  });

  it("detects owner-modified dietary tags", () => {
    const current: ExistingMenuItem = {
      slug: "bruschetta",
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: ["vegan"],
      description: "Toasted bread with tomatoes",
      lastImported: "2026-01-15",
    };
    const edits = detectOwnerEdits(current, importSnapshot);
    expect(edits).toContain("dietary");
  });
});

// ---------------------------------------------------------------------------
// formatDiffSummary — plain-English diff report
// ---------------------------------------------------------------------------

describe("formatDiffSummary", () => {
  it("formats additions", () => {
    const summary = formatDiffSummary({
      additions: [
        { name: "Crème Brûlée", section: "desserts", price: "$12", dietary: [], description: "" },
        { name: "Tiramisu", section: "desserts", price: "$10", dietary: [], description: "" },
      ],
      removals: [],
      changed: [],
      unchanged: [],
    });
    expect(summary).toContain("2 new items");
    expect(summary).toContain("Crème Brûlée");
    expect(summary).toContain("Tiramisu");
  });

  it("formats removals", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [
        { slug: "soup", name: "Seasonal Soup", section: "appetizers", price: "$7", dietary: [], description: "", lastImported: "2026-01-15" },
      ],
      changed: [],
      unchanged: [],
    });
    expect(summary).toContain("1 item removed");
    expect(summary).toContain("Seasonal Soup");
  });

  it("formats price changes with old → new", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [],
      changed: [
        {
          existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "", lastImported: "2026-01-15" },
          incoming: { name: "Pasta", section: "entrees", price: "$18", dietary: [], description: "" },
          changes: [{ field: "price", from: "$16", to: "$18" }],
          fuzzy: false,
          ownerEdits: [],
        },
      ],
      unchanged: [],
    });
    expect(summary).toContain("price");
    expect(summary).toContain("$16");
    expect(summary).toContain("$18");
  });

  it("mentions unchanged count", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [],
      changed: [],
      unchanged: [
        { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "", lastImported: "2026-01-15" },
      ],
    });
    expect(summary).toContain("1");
    expect(summary.toLowerCase()).toContain("unchanged");
  });

  it("flags fuzzy matches for review", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [],
      changed: [
        {
          existing: { slug: "chicken", name: "Grilled Chicken", section: "entrees", price: "$14", dietary: [], description: "", lastImported: "2026-01-15" },
          incoming: { name: "Char-Grilled Chicken", section: "entrees", price: "$14", dietary: [], description: "" },
          changes: [{ field: "name", from: "Grilled Chicken", to: "Char-Grilled Chicken" }],
          fuzzy: true,
          ownerEdits: [],
        },
      ],
      unchanged: [],
    });
    expect(summary.toLowerCase()).toContain("review");
  });

  it("flags owner edit conflicts", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [],
      changed: [
        {
          existing: { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "Owner's description", lastImported: "2026-01-15" },
          incoming: { name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "New PDF description" },
          changes: [{ field: "description", from: "Owner's description", to: "New PDF description" }],
          fuzzy: false,
          ownerEdits: ["description"],
        },
      ],
      unchanged: [],
    });
    expect(summary.toLowerCase()).toContain("edited");
  });

  it("returns a no-changes message when everything is unchanged", () => {
    const summary = formatDiffSummary({
      additions: [],
      removals: [],
      changed: [],
      unchanged: [
        { slug: "pasta", name: "Pasta", section: "entrees", price: "$16", dietary: [], description: "", lastImported: "2026-01-15" },
      ],
    });
    expect(summary.toLowerCase()).toContain("no changes");
  });
});

// ---------------------------------------------------------------------------
// buildImportLog — import metadata
// ---------------------------------------------------------------------------

describe("buildImportLog", () => {
  it("creates a log entry with required fields", () => {
    const entry = buildImportLog({
      fileName: "menu-2026-03-30.pdf",
      date: "2026-03-30",
      itemCount: 42,
    });
    expect(entry.fileName).toBe("menu-2026-03-30.pdf");
    expect(entry.date).toBe("2026-03-30");
    expect(entry.itemCount).toBe(42);
  });

  it("includes optional extraction notes", () => {
    const entry = buildImportLog({
      fileName: "menu.pdf",
      date: "2026-03-30",
      itemCount: 20,
      notes: "Low-resolution PDF, some prices unclear",
    });
    expect(entry.notes).toBe("Low-resolution PDF, some prices unclear");
  });

  it("includes diff summary when provided", () => {
    const entry = buildImportLog({
      fileName: "menu.pdf",
      date: "2026-03-30",
      itemCount: 20,
      diffSummary: { added: 3, removed: 1, changed: 5, unchanged: 11 },
    });
    expect(entry.diffSummary).toEqual({ added: 3, removed: 1, changed: 5, unchanged: 11 });
  });

  it("generates an archived file name with date prefix", () => {
    const entry = buildImportLog({
      fileName: "menu.pdf",
      date: "2026-03-30",
      itemCount: 20,
    });
    expect(entry.archivedAs).toBe("2026-03-30-menu.pdf");
  });

  it("handles file names that already start with a date", () => {
    const entry = buildImportLog({
      fileName: "2026-03-30-menu.pdf",
      date: "2026-03-30",
      itemCount: 20,
    });
    expect(entry.archivedAs).toBe("2026-03-30-menu.pdf");
  });
});

// ---------------------------------------------------------------------------
// mergeApprovedChanges — apply changes preserving owner customizations
// ---------------------------------------------------------------------------

describe("mergeApprovedChanges", () => {
  const existing: ExistingMenuItem = {
    slug: "bruschetta",
    name: "Bruschetta",
    section: "appetizers",
    price: "$8",
    dietary: [],
    description: "Our signature starter",
    image: "/images/menu/bruschetta.webp",
    customTags: [{ label: "House Favorite" }],
    lastImported: "2026-01-15",
  };

  const incoming: IncomingMenuItem = {
    name: "Bruschetta",
    section: "appetizers",
    price: "$10",
    dietary: ["vegan"],
    description: "Toasted bread with fresh tomatoes",
  };

  it("applies approved price change", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.price).toBe("$10");
  });

  it("preserves owner-added image when not in incoming", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.image).toBe("/images/menu/bruschetta.webp");
  });

  it("preserves owner-added custom tags", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.customTags).toEqual([{ label: "House Favorite" }]);
  });

  it("does not apply unapproved changes", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.description).toBe("Our signature starter");
    expect(merged.dietary).toEqual([]);
  });

  it("applies all approved changes at once", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price", "description", "dietary"], []);
    expect(merged.price).toBe("$10");
    expect(merged.description).toBe("Toasted bread with fresh tomatoes");
    expect(merged.dietary).toEqual(["vegan"]);
  });

  it("skips description update when owner edited it and not explicitly approved", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], ["description"]);
    expect(merged.description).toBe("Our signature starter");
  });

  it("allows overriding owner edit when explicitly approved", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price", "description"], ["description"]);
    expect(merged.description).toBe("Toasted bread with fresh tomatoes");
  });

  it("updates lastImported timestamp", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.lastImported).not.toBe("2026-01-15");
  });

  it("preserves slug", () => {
    const merged = mergeApprovedChanges(existing, incoming, ["price"], []);
    expect(merged.slug).toBe("bruschetta");
  });
});
