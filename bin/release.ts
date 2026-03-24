/**
 * Bump version across all manifests, commit, tag, and push.
 * The tag push triggers .github/workflows/release.yml, which builds
 * the plugin zip and creates the GitHub release.
 *
 * Usage:
 *   npx tsx bin/release.ts 0.16.0
 *   npx tsx bin/release.ts patch    # 0.15.0 → 0.15.1
 *   npx tsx bin/release.ts minor    # 0.15.0 → 0.16.0
 *   npx tsx bin/release.ts major    # 0.15.0 → 1.0.0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST_FILES = [
  "package.json",
  ".claude-plugin/plugin.json",
  "template/package.json",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), "utf-8"));
}

function writeJson(rel: string, data: Record<string, unknown>): void {
  writeFileSync(join(root, rel), JSON.stringify(data, null, 2) + "\n");
}

function run(cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: "utf-8", stdio: "pipe" }).trim();
}

function bump(current: string, type: "patch" | "minor" | "major"): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
  }
}

function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npx tsx bin/release.ts <version | patch | minor | major>");
  process.exit(1);
}

// Determine current version from the source of truth
const current = readJson("package.json").version as string;
console.log(`Current version: ${current}`);

// Resolve target version
let next: string;
if (["patch", "minor", "major"].includes(arg)) {
  next = bump(current, arg as "patch" | "minor" | "major");
} else if (isValidSemver(arg)) {
  next = arg;
} else {
  console.error(`Invalid argument: "${arg}". Use a semver (1.2.3) or patch/minor/major.`);
  process.exit(1);
}

if (next === current) {
  console.error(`Version is already ${current}.`);
  process.exit(1);
}

console.log(`Bumping to: ${next}\n`);

// Update all manifests
for (const file of MANIFEST_FILES) {
  const data = readJson(file);
  const old = data.version as string;
  data.version = next;
  writeJson(file, data);
  console.log(`  ${file}: ${old} → ${next}`);
}

// Commit and tag
const tag = `v${next}`;
run(`git add ${MANIFEST_FILES.join(" ")}`);
run(`git commit -m "chore: release ${tag}"`);
run(`git tag ${tag}`);
console.log(`\nCommitted and tagged ${tag}`);

// Push commit + tag — CI creates the release
run("git push");
run("git push --tags");
console.log("Pushed to origin — CI will create the release");
