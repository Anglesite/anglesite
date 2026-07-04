/**
 * Shared .site-config parser.
 *
 * Reads KEY=value pairs from a flat config file (one per line).
 * Used by setup, cleanup, check-prereqs, pre-deploy-check, and generate-images.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Default path to the site config file. */
const DEFAULT_CONFIG_PATH = resolve(process.cwd(), ".site-config");

/**
 * Read a value from a KEY=value config file.
 *
 * @param key - The key to look up
 * @param configPath - Path to the config file (defaults to `.site-config` in cwd)
 * @returns The trimmed value, or undefined if not found or file missing
 */
export function readConfig(
  key: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): string | undefined {
  if (!existsSync(configPath)) return undefined;
  const content = readFileSync(configPath, "utf-8");
  return readConfigFromString(content, key);
}

/**
 * Parse a KEY=value string and return the value for the given key.
 * Pure function — no I/O.
 */
export function readConfigFromString(
  content: string,
  key: string,
): string | undefined {
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim();
}
