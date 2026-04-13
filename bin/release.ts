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
import semver from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST_FILES = [
  "package.json",
  ".claude-plugin/plugin.json",
  "template/package.json",
];

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
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

export function bump(current: string, type: "patch" | "minor" | "major"): string {
  const next = semver.inc(current, type);
  if (!next) throw new Error(`Cannot bump "${current}" by "${type}"`);
  return next;
}

export function isValidSemver(v: string): boolean {
  return semver.valid(v) !== null;
}

/**
 * Replace the **Version:** line in a CLAUDE.md file with the given version.
 */
export function updateClaudeMdVersion(filePath: string, version: string): void {
  const content = readFileSync(filePath, "utf-8");
  const pattern = /(\*\*Version:\*\*\s+)[\d.][-\w.]*/;
  if (!pattern.test(content)) {
    throw new Error(`No **Version:** line found in ${filePath}`);
  }
  writeFileSync(filePath, content.replace(pattern, `$1${version}`));
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\.js$/, ".ts"));

if (isDirectRun) {
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

  // Update CLAUDE.md
  const claudeMdPath = join(root, "CLAUDE.md");
  updateClaudeMdVersion(claudeMdPath, next);
  console.log(`  CLAUDE.md: → ${next}`);

  // Commit and tag
  const tag = `v${next}`;
  run(`git add ${MANIFEST_FILES.join(" ")} CLAUDE.md`);
  run(`git commit -m "chore: release ${tag}"`);
  run(`git tag ${tag}`);
  console.log(`\nCommitted and tagged ${tag}`);

  // Push commit + tag — CI creates the release
  run("git push");
  run("git push --tags");
  console.log("Pushed to origin — CI will create the release");
}
