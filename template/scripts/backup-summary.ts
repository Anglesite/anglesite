/**
 * Backup summary — parses git status output into human-readable descriptions.
 *
 * Used by /anglesite:backup to generate descriptive commit messages
 * and plain-language summaries for the site owner.
 */

export interface ParsedStatus {
  added: {
    posts: number;
    pages: string[];
    collections: Record<string, number>;
  };
  modified: {
    pages: string[];
    styles: boolean;
    layout: boolean;
    config: boolean;
    collections: Record<string, number>;
  };
  deleted: string[];
  other: number;
}

/**
 * Parse `git status --porcelain` lines into categorized changes.
 */
export function parseStatus(lines: string[]): ParsedStatus {
  const result: ParsedStatus = {
    added: { posts: 0, pages: [], collections: {} },
    modified: {
      pages: [],
      styles: false,
      layout: false,
      config: false,
      collections: {},
    },
    deleted: [],
    other: 0,
  };

  for (const line of lines) {
    if (!line.trim()) continue;

    const status = line.slice(0, 2).trim();
    const file = line.slice(3).trim();

    const isNew = status === "??" || status === "A";
    const isModified = status === "M";
    const isDeleted = status === "D";

    // Blog posts
    if (file.startsWith("src/content/posts/")) {
      if (isNew) result.added.posts++;
      continue;
    }

    // Content collections (services, team, testimonials, gallery, events, faq)
    const collectionMatch = file.match(/^src\/content\/([^/]+)\//);
    if (collectionMatch) {
      const collection = collectionMatch[1];
      if (isNew) {
        result.added.collections[collection] =
          (result.added.collections[collection] || 0) + 1;
      } else if (isModified) {
        result.modified.collections[collection] =
          (result.modified.collections[collection] || 0) + 1;
      }
      continue;
    }

    // Pages
    if (file.startsWith("src/pages/") && file.endsWith(".astro")) {
      const name = file
        .replace("src/pages/", "")
        .replace(".astro", "")
        .replace(/\/index$/, "");
      if (isNew) {
        result.added.pages.push(name);
      } else if (isModified) {
        result.modified.pages.push(name);
      } else if (isDeleted) {
        result.deleted.push(file.split("/").pop() ?? file);
      }
      continue;
    }

    // Styles
    if (file.includes("styles/") && isModified) {
      result.modified.styles = true;
      continue;
    }

    // Layout
    if (file.includes("layouts/") && isModified) {
      result.modified.layout = true;
      continue;
    }

    // Config
    if (
      (file === ".site-config" ||
        file === "astro.config.ts" ||
        file === "keystatic.config.ts") &&
      isModified
    ) {
      result.modified.config = true;
      continue;
    }

    // Deleted files (non-page)
    if (isDeleted) {
      result.deleted.push(file.split("/").pop()!);
      continue;
    }

    result.other++;
  }

  return result;
}

/**
 * Generate a descriptive git commit message from parsed status.
 */
export function commitMessage(status: ParsedStatus): string {
  const parts: string[] = [];

  if (status.added.posts > 0) {
    parts.push(
      `Add ${status.added.posts} blog post${status.added.posts > 1 ? "s" : ""}`,
    );
  }

  if (status.added.pages.length > 0) {
    parts.push(`Add ${status.added.pages.join(", ")} page`);
  }

  for (const [collection, count] of Object.entries(
    status.added.collections,
  )) {
    parts.push(`Add ${count} ${collection} item${count > 1 ? "s" : ""}`);
  }

  if (status.modified.pages.length > 0) {
    parts.push(`Update ${status.modified.pages.join(", ")} page`);
  }

  for (const [collection, count] of Object.entries(
    status.modified.collections,
  )) {
    parts.push(`Update ${count} ${collection} item${count > 1 ? "s" : ""}`);
  }

  if (status.modified.styles) {
    parts.push("Update styles");
  }

  if (status.modified.layout) {
    parts.push("Update layout");
  }

  if (status.modified.config) {
    parts.push("Update config");
  }

  if (status.deleted.length > 0) {
    parts.push(`Remove ${status.deleted.join(", ")}`);
  }

  if (parts.length === 0) {
    if (status.other > 0) {
      return `Update ${status.other} file${status.other > 1 ? "s" : ""}`;
    }
    return "Backup site changes";
  }

  return parts.join(", ").replace(/, ([^,]*)$/, " and $1");
}

/**
 * Generate a plain-language summary for the site owner.
 */
export function userSummary(status: ParsedStatus): string {
  const parts: string[] = [];

  if (status.added.posts > 0) {
    parts.push(
      `${status.added.posts} new blog post${status.added.posts > 1 ? "s" : ""}`,
    );
  }

  if (status.added.pages.length > 0) {
    parts.push(
      `new ${status.added.pages.join(", ")} page${status.added.pages.length > 1 ? "s" : ""}`,
    );
  }

  for (const [collection, count] of Object.entries(
    status.added.collections,
  )) {
    parts.push(
      `${count} new ${collection} item${count > 1 ? "s" : ""}`,
    );
  }

  if (status.modified.pages.length > 0) {
    parts.push(
      `updated ${status.modified.pages.join(", ")} page${status.modified.pages.length > 1 ? "s" : ""}`,
    );
  }

  for (const [collection, count] of Object.entries(
    status.modified.collections,
  )) {
    parts.push(
      `updated ${count} ${collection} item${count > 1 ? "s" : ""}`,
    );
  }

  if (status.modified.styles) {
    parts.push("style changes");
  }

  if (status.modified.layout) {
    parts.push("layout changes");
  }

  if (status.modified.config) {
    parts.push("configuration changes");
  }

  if (status.deleted.length > 0) {
    parts.push(
      `removed ${status.deleted.join(", ")}`,
    );
  }

  if (status.other > 0) {
    parts.push(
      `${status.other} other file${status.other > 1 ? "s" : ""} updated`,
    );
  }

  if (parts.length === 0) {
    return "No changes to back up.";
  }

  return (
    "Changes backed up: " + parts.join(", ").replace(/, ([^,]*)$/, " and $1") + "."
  );
}
