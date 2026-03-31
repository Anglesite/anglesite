/**
 * Menu diff engine for re-importing updated menus.
 *
 * Compares newly extracted menu items against existing Keystatic
 * collections, computes a diff, and merges approved changes while
 * preserving owner customizations (photos, descriptions, custom tags).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An existing menu item from Keystatic (has slug and import metadata). */
export interface ExistingMenuItem {
  slug: string;
  name: string;
  section?: string;
  price?: string;
  dietary: string[];
  description: string;
  image?: string;
  imageAlt?: string;
  customTags?: Array<{ label: string; icon?: string; color?: string }>;
  lastImported: string;
}

/** A menu item extracted from a new PDF/photo (no slug yet). */
export interface IncomingMenuItem {
  name: string;
  section?: string;
  price?: string;
  dietary: string[];
  description: string;
}

/** A matched pair of existing ↔ incoming items. */
export interface MatchedPair {
  existing: ExistingMenuItem;
  incoming: IncomingMenuItem;
  fuzzy: boolean;
}

/** Match result from matchMenuItems. */
export interface MatchResult {
  matched: MatchedPair[];
  additions: IncomingMenuItem[];
  removals: ExistingMenuItem[];
}

/** A single field change. */
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** A changed item with details. */
export interface ChangedItem {
  existing: ExistingMenuItem;
  incoming: IncomingMenuItem;
  changes: FieldChange[];
  fuzzy: boolean;
  ownerEdits: string[];
}

/** Full diff result. */
export interface MenuDiff {
  additions: IncomingMenuItem[];
  removals: ExistingMenuItem[];
  changed: ChangedItem[];
  unchanged: ExistingMenuItem[];
}

/** Input for buildImportLog. */
export interface ImportLogInput {
  fileName: string;
  date: string;
  itemCount: number;
  notes?: string;
  diffSummary?: { added: number; removed: number; changed: number; unchanged: number };
}

/** Output from buildImportLog. */
export interface ImportLogEntry extends ImportLogInput {
  archivedAs: string;
}

// ---------------------------------------------------------------------------
// Fuzzy match threshold
// ---------------------------------------------------------------------------

const FUZZY_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// normalizeItemName
// ---------------------------------------------------------------------------

/**
 * Normalize a menu item name for matching:
 * lowercase, trim, collapse whitespace, strip non-alphanumeric chars.
 */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// similarityScore
// ---------------------------------------------------------------------------

/**
 * Compute similarity between two strings using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function similarityScore(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  // Classic DP Levenshtein with single-row optimization
  let prev = Array.from({ length: lenB + 1 }, (_, i) => i);
  for (let i = 1; i <= lenA; i++) {
    const curr = [i];
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    prev = curr;
  }

  const distance = prev[lenB];
  return 1 - distance / Math.max(lenA, lenB);
}

// ---------------------------------------------------------------------------
// matchMenuItems
// ---------------------------------------------------------------------------

/**
 * Match existing menu items to incoming items.
 *
 * Strategy:
 * 1. Exact match by normalized name + section
 * 2. Exact match by normalized name only (cross-section)
 * 3. Fuzzy match (similarity > 0.75) within the same section
 */
export function matchMenuItems(
  existing: ExistingMenuItem[],
  incoming: IncomingMenuItem[],
): MatchResult {
  const matched: MatchedPair[] = [];
  const unmatchedExisting = new Set(existing.map((_, i) => i));
  const unmatchedIncoming = new Set(incoming.map((_, i) => i));

  // Pass 1: exact name + section match
  for (const iIdx of unmatchedIncoming) {
    const inc = incoming[iIdx];
    const normInc = normalizeItemName(inc.name);
    for (const eIdx of unmatchedExisting) {
      const ext = existing[eIdx];
      if (
        normalizeItemName(ext.name) === normInc &&
        ext.section === inc.section
      ) {
        matched.push({ existing: ext, incoming: inc, fuzzy: false });
        unmatchedExisting.delete(eIdx);
        unmatchedIncoming.delete(iIdx);
        break;
      }
    }
  }

  // Pass 2: exact name only (different sections)
  for (const iIdx of unmatchedIncoming) {
    const inc = incoming[iIdx];
    const normInc = normalizeItemName(inc.name);
    for (const eIdx of unmatchedExisting) {
      const ext = existing[eIdx];
      if (normalizeItemName(ext.name) === normInc) {
        matched.push({ existing: ext, incoming: inc, fuzzy: false });
        unmatchedExisting.delete(eIdx);
        unmatchedIncoming.delete(iIdx);
        break;
      }
    }
  }

  // Pass 3: fuzzy match within same section
  for (const iIdx of [...unmatchedIncoming]) {
    const inc = incoming[iIdx];
    const normInc = normalizeItemName(inc.name);
    let bestScore = 0;
    let bestEIdx = -1;

    for (const eIdx of unmatchedExisting) {
      const ext = existing[eIdx];
      if (ext.section !== inc.section) continue;
      const score = similarityScore(normalizeItemName(ext.name), normInc);
      if (score > bestScore) {
        bestScore = score;
        bestEIdx = eIdx;
      }
    }

    if (bestScore >= FUZZY_THRESHOLD && bestEIdx >= 0) {
      matched.push({
        existing: existing[bestEIdx],
        incoming: inc,
        fuzzy: true,
      });
      unmatchedExisting.delete(bestEIdx);
      unmatchedIncoming.delete(iIdx);
    }
  }

  return {
    matched,
    additions: [...unmatchedIncoming].map((i) => incoming[i]),
    removals: [...unmatchedExisting].map((i) => existing[i]),
  };
}

// ---------------------------------------------------------------------------
// computeMenuDiff
// ---------------------------------------------------------------------------

/**
 * Classify matched pairs as unchanged or changed (with field-level detail).
 */
export function computeMenuDiff(matches: MatchedPair[]): {
  unchanged: ExistingMenuItem[];
  changed: ChangedItem[];
} {
  const unchanged: ExistingMenuItem[] = [];
  const changed: ChangedItem[] = [];

  for (const pair of matches) {
    const changes: FieldChange[] = [];

    if (pair.fuzzy) {
      changes.push({
        field: "name",
        from: pair.existing.name,
        to: pair.incoming.name,
      });
    }

    if ((pair.existing.price ?? "") !== (pair.incoming.price ?? "")) {
      changes.push({
        field: "price",
        from: pair.existing.price ?? "",
        to: pair.incoming.price ?? "",
      });
    }

    if ((pair.existing.description ?? "") !== (pair.incoming.description ?? "")) {
      changes.push({
        field: "description",
        from: pair.existing.description ?? "",
        to: pair.incoming.description ?? "",
      });
    }

    const existDietary = [...pair.existing.dietary].sort().join(",");
    const incDietary = [...pair.incoming.dietary].sort().join(",");
    if (existDietary !== incDietary) {
      changes.push({
        field: "dietary",
        from: existDietary,
        to: incDietary,
      });
    }

    if (changes.length === 0) {
      unchanged.push(pair.existing);
    } else {
      changed.push({
        existing: pair.existing,
        incoming: pair.incoming,
        changes,
        fuzzy: pair.fuzzy,
        ownerEdits: [],
      });
    }
  }

  return { unchanged, changed };
}

// ---------------------------------------------------------------------------
// detectOwnerEdits
// ---------------------------------------------------------------------------

/**
 * Detect which fields the owner manually edited after the last import.
 * Compares the current item state against the original import snapshot.
 */
export function detectOwnerEdits(
  current: ExistingMenuItem,
  importSnapshot: IncomingMenuItem,
): string[] {
  const edits: string[] = [];

  if ((current.description ?? "") !== (importSnapshot.description ?? "")) {
    edits.push("description");
  }

  if ((current.price ?? "") !== (importSnapshot.price ?? "")) {
    edits.push("price");
  }

  const currentDietary = [...current.dietary].sort().join(",");
  const snapshotDietary = [...importSnapshot.dietary].sort().join(",");
  if (currentDietary !== snapshotDietary) {
    edits.push("dietary");
  }

  // Owner added an image that wasn't in the import
  if (current.image && !importSnapshot.description?.includes(current.image)) {
    // Simple check: if current has an image, it was owner-added
    // (imports don't typically include images from PDFs)
    edits.push("image");
  }

  // Owner added custom tags
  if (current.customTags && current.customTags.length > 0) {
    edits.push("customTags");
  }

  return edits;
}

// ---------------------------------------------------------------------------
// formatDiffSummary
// ---------------------------------------------------------------------------

/**
 * Format a menu diff as a plain-English summary for the non-technical owner.
 */
export function formatDiffSummary(diff: MenuDiff): string {
  const lines: string[] = [];

  if (diff.additions.length > 0) {
    const count = diff.additions.length;
    const names = diff.additions.map((a) => a.name).join(", ");
    lines.push(`${count} new item${count !== 1 ? "s" : ""} added: ${names}`);
  }

  if (diff.removals.length > 0) {
    const count = diff.removals.length;
    const names = diff.removals.map((r) => r.name).join(", ");
    lines.push(`${count} item${count !== 1 ? "s" : ""} removed: ${names}`);
  }

  if (diff.changed.length > 0) {
    for (const item of diff.changed) {
      const changeDescs: string[] = [];

      for (const c of item.changes) {
        if (c.field === "name") {
          changeDescs.push(`name: "${c.from}" → "${c.to}"`);
        } else if (c.field === "price") {
          changeDescs.push(`price: ${c.from} → ${c.to}`);
        } else if (c.field === "description") {
          changeDescs.push("description updated");
        } else if (c.field === "dietary") {
          changeDescs.push(`dietary tags: ${c.from || "(none)"} → ${c.to || "(none)"}`);
        }
      }

      let line = `${item.existing.name}: ${changeDescs.join("; ")}`;

      if (item.fuzzy) {
        line += " ⚠️ needs review (fuzzy name match)";
      }

      if (item.ownerEdits.length > 0) {
        line += ` ⚠️ you edited ${item.ownerEdits.join(", ")} after the last import`;
      }

      lines.push(line);
    }
  }

  if (diff.unchanged.length > 0) {
    lines.push(`${diff.unchanged.length} item${diff.unchanged.length !== 1 ? "s" : ""} unchanged.`);
  }

  if (lines.length === 0 || (diff.additions.length === 0 && diff.removals.length === 0 && diff.changed.length === 0)) {
    if (diff.unchanged.length > 0) {
      return `No changes detected. ${diff.unchanged.length} item${diff.unchanged.length !== 1 ? "s" : ""} unchanged.`;
    }
    return "No changes detected.";
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// buildImportLog
// ---------------------------------------------------------------------------

/**
 * Create an import log entry with metadata and archived file name.
 */
export function buildImportLog(input: ImportLogInput): ImportLogEntry {
  const datePrefix = `${input.date}-`;
  const archivedAs = input.fileName.startsWith(datePrefix)
    ? input.fileName
    : `${datePrefix}${input.fileName}`;

  return {
    ...input,
    archivedAs,
  };
}

// ---------------------------------------------------------------------------
// mergeApprovedChanges
// ---------------------------------------------------------------------------

/**
 * Apply approved changes from the incoming item to the existing item,
 * preserving owner customizations (images, custom tags) and respecting
 * the approval list.
 *
 * @param existing - Current item from Keystatic
 * @param incoming - New item from PDF extraction
 * @param approvedFields - Fields the owner approved for update
 * @param ownerEdits - Fields the owner manually edited (for conflict awareness)
 */
export function mergeApprovedChanges(
  existing: ExistingMenuItem,
  incoming: IncomingMenuItem,
  approvedFields: string[],
  ownerEdits: string[],
): ExistingMenuItem {
  const merged: ExistingMenuItem = { ...existing };

  for (const field of approvedFields) {
    // Skip owner-edited fields unless explicitly approved
    if (ownerEdits.includes(field) && !approvedFields.includes(field)) {
      continue;
    }

    switch (field) {
      case "name":
        merged.name = incoming.name;
        break;
      case "price":
        merged.price = incoming.price;
        break;
      case "description":
        merged.description = incoming.description;
        break;
      case "dietary":
        merged.dietary = [...incoming.dietary];
        break;
      case "section":
        merged.section = incoming.section;
        break;
    }
  }

  // Always preserve owner-added image and custom tags
  // (incoming PDF items don't have these)
  if (existing.image) merged.image = existing.image;
  if (existing.imageAlt) merged.imageAlt = existing.imageAlt;
  if (existing.customTags) merged.customTags = [...existing.customTags];

  // Update import timestamp
  merged.lastImported = new Date().toISOString().slice(0, 10);

  return merged;
}
