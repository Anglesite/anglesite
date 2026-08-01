#!/usr/bin/env node
// Generates an OSS attribution manifest from a resolved node_modules tree.
// Usage: node generate-npm-attributions.mjs <node_modules-root> <output.json> [overrides.json]
//
// See docs/superpowers/specs/2026-07-31-oss-attributions-design.md for the overrides format and
// the "fail loudly on an undisclosed license" rule `generate` enforces.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

// Both spellings: npm packages occasionally ship the British "LICENCE" spelling.
const LICENSE_NAMES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt",
  "LICENCE", "LICENCE.md", "LICENCE.txt",
  "COPYING", "COPYING.md", "COPYING.txt",
];

export function findLicenseText(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const byLowerName = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const candidate of LICENSE_NAMES) {
    const realName = byLowerName.get(candidate.toLowerCase());
    if (realName) return readFileSync(join(dir, realName), "utf8");
  }
  return null;
}

/** Handles the three shapes npm's `license`/`licenses` field has taken over the registry's history. */
export function extractLicenseId(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0] && typeof pkg.licenses[0].type === "string") {
    return pkg.licenses[0].type;
  }
  return null;
}

export function extractHomepage(pkg) {
  if (typeof pkg.homepage === "string") return pkg.homepage;
  const repo = pkg.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo.url === "string") return repo.url.replace(/^git\+/, "").replace(/\.git$/, "");
  return null;
}

/**
 * Recursively finds every package directory under a node_modules tree — including nested
 * node_modules from unhoisted transitive dependencies — keyed by "name@version" to dedupe.
 */
export function collectPackages(nodeModulesRoot) {
  const found = new Map();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".bin") continue;
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      if (entry.startsWith("@")) {
        walk(entryPath); // scoped packages live one level deeper (@scope/name)
        continue;
      }

      const pkgJsonPath = join(entryPath, "package.json");
      if (existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (pkg.name && pkg.version) {
          found.set(`${pkg.name}@${pkg.version}`, { dir: entryPath, pkg });
        }
      }
      const nested = join(entryPath, "node_modules");
      if (existsSync(nested)) walk(nested);
    }
  }

  walk(nodeModulesRoot);
  return found;
}

export function loadOverrides(overridesPath) {
  if (!overridesPath || !existsSync(overridesPath)) return {};
  return JSON.parse(readFileSync(overridesPath, "utf8"));
}

/**
 * Builds the sorted attribution list for one node_modules tree. Throws (naming every offending
 * package) if any package has neither a discoverable license file nor an override entry — a
 * legal-disclosure gap must never resolve silently.
 */
export function generate(nodeModulesRoot, overridesPath) {
  const overrides = loadOverrides(overridesPath);
  const packages = collectPackages(nodeModulesRoot);
  const entries = [];
  const failures = [];

  for (const [key, { dir, pkg }] of packages) {
    const override = overrides[key] || overrides[pkg.name] || {};
    const licenseText = override.licenseText || findLicenseText(dir);
    if (!licenseText) {
      failures.push(key);
      continue;
    }
    entries.push({
      name: pkg.name,
      version: pkg.version,
      licenseSPDXId: override.licenseSPDXId ?? extractLicenseId(pkg),
      licenseText,
      homepage: override.homepage ?? extractHomepage(pkg),
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `no license file found and no override for: ${failures.sort().join(", ")}\n` +
      `       Add an entry to ${overridesPath} once a human confirms the license.`
    );
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function main() {
  const [, , nodeModulesRoot, outputPath, overridesPath] = process.argv;
  if (!nodeModulesRoot || !outputPath) {
    console.error("usage: generate-npm-attributions.mjs <node_modules-root> <output.json> [overrides.json]");
    process.exit(2);
  }
  const entries = generate(nodeModulesRoot, overridesPath);
  writeFileSync(outputPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`Wrote ${entries.length} attribution(s) to ${outputPath}`);
}

if (process.argv[1] && basename(process.argv[1]) === "generate-npm-attributions.mjs") {
  main();
}
