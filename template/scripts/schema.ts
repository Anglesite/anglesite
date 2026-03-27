/**
 * Keystatic schema extraction.
 *
 * Parses keystatic.config.ts source text and extracts collection and
 * singleton names. Used to generate anglesite.config.json — the manifest
 * that tells the agent what content types exist for routing decisions.
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface KeystaticSchema {
  collections: string[];
  singletons: string[];
}

/**
 * Extract collection and singleton names from keystatic.config.ts source.
 *
 * Uses regex to find top-level keys inside `collections: { ... }` and
 * `singletons: { ... }` blocks. Keys may be bare identifiers or quoted
 * strings (for hyphenated names like "business-info").
 *
 * @param source - The full text content of keystatic.config.ts
 * @returns Object with arrays of collection and singleton names
 */
export function extractKeystatic(source: string): KeystaticSchema {
  return {
    collections: extractBlock(source, "collections"),
    singletons: extractBlock(source, "singletons"),
  };
}

/**
 * Extract top-level keys from a named block like `collections: { ... }`.
 */
function extractBlock(source: string, blockName: string): string[] {
  // Match the block: `collections: {` or `singletons: {`
  const blockPattern = new RegExp(`${blockName}\\s*:\\s*\\{`);
  const blockMatch = blockPattern.exec(source);
  if (!blockMatch) return [];

  // Find the matching closing brace by counting depth
  const start = blockMatch.index + blockMatch[0].length;
  let depth = 1;
  let end = start;
  for (let i = start; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    if (depth === 0) end = i;
  }

  const blockContent = source.slice(start, end);

  // Find all key: collection/singleton( patterns
  // Since nested objects use `fields.xxx` not `collection(`, this matches only top-level keys
  const keyPattern = /(?:"([^"]+)"|'([^']+)'|(\w[\w-]*))\s*:\s*(?:collection|singleton)\s*\(/g;
  const keys: string[] = [];
  let match;
  while ((match = keyPattern.exec(blockContent)) !== null) {
    const key = match[1] ?? match[2] ?? match[3];
    if (key) keys.push(key);
  }

  return keys;
}

/**
 * Read keystatic.config.ts from a project directory, extract the schema,
 * and write anglesite.config.json.
 *
 * If keystatic.config.ts does not exist, writes an empty schema manifest.
 *
 * @param projectDir - Root directory of the Anglesite project
 */
export function generateManifest(projectDir: string): void {
  const configPath = join(projectDir, "keystatic.config.ts");
  const source = existsSync(configPath)
    ? readFileSync(configPath, "utf-8")
    : "";

  const schema = extractKeystatic(source);
  const manifest = { keystatic: schema };

  writeFileSync(
    join(projectDir, "anglesite.config.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
