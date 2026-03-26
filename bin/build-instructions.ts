/**
 * Validates and measures token efficiency of all agent instruction files.
 *
 * Checks:
 * - Token budget for always-loaded context
 * - Per-skill token measurements
 * - @import references resolve
 *
 * Usage: npx tsx bin/build-instructions.ts
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WARN_SKILL_BYTES = 8_192;

// Approximate: 1 token ≈ 4 bytes for English text
export function tokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

// ---------------------------------------------------------------------------
// Measure files
// ---------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  label: string;
  bytes: number;
  tokens: number;
}

function measureFile(relativePath: string, label?: string): FileInfo | null {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  const bytes = statSync(fullPath).size;
  return {
    path: relativePath,
    label: label ?? relativePath,
    bytes,
    tokens: tokens(bytes),
  };
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

export interface Issue {
  level: "error" | "warn";
  message: string;
}

export function validateImports(content: string, dir: string, label: string): Issue[] {
  const issues: Issue[] = [];
  const importPattern = /^@(\S+)/gm;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    const importPath = match[1];
    const fullPath = join(dir, importPath);
    if (!existsSync(fullPath)) {
      issues.push({
        level: "error",
        message: `${label} references @${importPath} but file does not exist`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Runtime doc-read analysis — scans skill files for doc references
// ---------------------------------------------------------------------------

interface SkillDocReads {
  skill: string;
  skillBytes: number;
  referencedDocs: FileInfo[];
  totalBytes: number;
  totalTokens: number;
}

/**
 * Scan a skill file for `${CLAUDE_PLUGIN_ROOT}/...` references and
 * measure the total bytes that skill will load at runtime.
 */
function analyzeSkillReads(skillName: string): SkillDocReads {
  const skillPath = join(ROOT, `skills/${skillName}/SKILL.md`);
  const skillBytes = statSync(skillPath).size;
  const content = readFileSync(skillPath, "utf-8");

  // Match ${CLAUDE_PLUGIN_ROOT}/path/to/file.md references
  const refPattern = /\$\{CLAUDE_PLUGIN_ROOT\}\/([\w/.-]+\.md)/g;
  const seen = new Set<string>();
  const docs: FileInfo[] = [];
  let match;

  while ((match = refPattern.exec(content)) !== null) {
    const relPath = match[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const fullPath = join(ROOT, relPath);
    if (existsSync(fullPath)) {
      const bytes = statSync(fullPath).size;
      docs.push({ path: relPath, label: relPath, bytes, tokens: tokens(bytes) });
    }
  }

  // Also check for sub-file references within the skill directory
  const skillDir = join(ROOT, `skills/${skillName}`);
  const subFiles = readdirSync(skillDir).filter(
    f => f.endsWith(".md") && f !== "SKILL.md"
  );
  for (const sub of subFiles) {
    const subPath = `skills/${skillName}/${sub}`;
    if (seen.has(subPath)) continue;
    seen.add(subPath);

    // Check if the sub-file is referenced from SKILL.md
    if (content.includes(sub)) {
      const bytes = statSync(join(ROOT, subPath)).size;
      docs.push({ path: subPath, label: sub, bytes, tokens: tokens(bytes) });
    }
  }

  // Check for shared skill references
  const sharedPattern = /\$\{CLAUDE_PLUGIN_ROOT\}\/(skills\/shared\/[\w/.-]+\.md)/g;
  while ((match = sharedPattern.exec(content)) !== null) {
    const relPath = match[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const fullPath = join(ROOT, relPath);
    if (existsSync(fullPath)) {
      const bytes = statSync(fullPath).size;
      docs.push({ path: relPath, label: relPath, bytes, tokens: tokens(bytes) });
    }
  }

  const totalBytes = skillBytes + docs.reduce((s, d) => s + d.bytes, 0);

  return {
    skill: skillName,
    skillBytes,
    referencedDocs: docs,
    totalBytes,
    totalTokens: tokens(totalBytes),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const issues: Issue[] = [];

  // Measure always-loaded files
  const templateDir = join(ROOT, "template");
  const claudeMd = measureFile("template/CLAUDE.md", "CLAUDE.md");

  console.log("Agent Instruction Efficiency Report");
  console.log("====================================\n");

  // --- Always-loaded context ---
  console.log("Always-loaded context (every turn):");
  const alwaysLoaded: FileInfo[] = [];
  if (claudeMd) alwaysLoaded.push(claudeMd);

  for (const f of alwaysLoaded) {
    console.log(`  ${f.label.padEnd(24)} ${fmtKB(f.bytes).padStart(8)}  ${fmt(f.tokens).padStart(6)} tokens`);
  }

  const totalAlwaysBytes = alwaysLoaded.reduce((s, f) => s + f.bytes, 0);
  const totalAlwaysTokens = alwaysLoaded.reduce((s, f) => s + f.tokens, 0);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(8)}  ${"─".repeat(6)}`);
  console.log(`  ${"Total".padEnd(24)} ${fmtKB(totalAlwaysBytes).padStart(8)}  ${fmt(totalAlwaysTokens).padStart(6)} tokens`);

  // --- Skills ---
  console.log("\nSkills:");
  const skillsDir = join(ROOT, "skills");
  const skillDirs = readdirSync(skillsDir).filter(d =>
    existsSync(join(skillsDir, d, "SKILL.md"))
  ).sort();

  const skills: FileInfo[] = [];
  for (const name of skillDirs) {
    const f = measureFile(`skills/${name}/SKILL.md`, name);
    if (f) {
      skills.push(f);
      const flag = f.bytes > WARN_SKILL_BYTES ? " !" : "";
      console.log(`  ${f.label.padEnd(24)} ${fmtKB(f.bytes).padStart(8)}  ${fmt(f.tokens).padStart(6)} tokens${flag}`);
      if (f.bytes > WARN_SKILL_BYTES) {
        issues.push({
          level: "warn",
          message: `${name}/SKILL.md is ${fmtKB(f.bytes)} — consider splitting or trimming (>${fmtKB(WARN_SKILL_BYTES)} threshold)`,
        });
      }
    }
  }

  const totalSkillBytes = skills.reduce((s, f) => s + f.bytes, 0);
  const totalSkillTokens = skills.reduce((s, f) => s + f.tokens, 0);
  console.log(`  ${"─".repeat(24)} ${"─".repeat(8)}  ${"─".repeat(6)}`);
  console.log(`  ${"Total".padEnd(24)} ${fmtKB(totalSkillBytes).padStart(8)}  ${fmt(totalSkillTokens).padStart(6)} tokens`);

  // --- Runtime doc-read analysis ---
  console.log("\nRuntime doc reads (SKILL.md + referenced docs):");
  for (const name of skillDirs) {
    const reads = analyzeSkillReads(name);
    const docCount = reads.referencedDocs.length;
    const docsLabel = docCount === 0 ? "no refs" : `${docCount} docs`;
    console.log(
      `  ${name.padEnd(24)} ${fmtKB(reads.totalBytes).padStart(8)}  ${fmt(reads.totalTokens).padStart(6)} tokens  (${docsLabel})`
    );
  }

  // --- Reference docs ---
  const docsDir = join(ROOT, "docs");
  let totalDocBytes = 0;
  let docCount = 0;
  if (existsSync(docsDir)) {
    const countDocs = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          countDocs(join(dir, entry.name));
        } else if (entry.name.endsWith(".md")) {
          totalDocBytes += statSync(join(dir, entry.name)).size;
          docCount++;
        }
      }
    };
    countDocs(docsDir);
  }

  console.log(`\nReference docs: ${docCount} files, ${fmtKB(totalDocBytes)}, ${fmt(tokens(totalDocBytes))} tokens (loaded on demand)`);

  // --- Validation ---
  if (claudeMd) {
    const claudeContent = readFileSync(join(ROOT, "template/CLAUDE.md"), "utf-8");
    issues.push(...validateImports(claudeContent, templateDir, "CLAUDE.md"));
  }

  // --- Summary ---
  console.log("\n────────────────────────────────────");

  const errors = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warn");

  if (errors.length === 0 && warnings.length === 0) {
    console.log("All checks passed.");
  } else {
    for (const e of errors) {
      console.log(`ERROR: ${e.message}`);
    }
    for (const w of warnings) {
      console.log(`WARN:  ${w.message}`);
    }
  }

  console.log(`Claude context: ~${fmt(totalAlwaysTokens)} tokens always loaded`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  main();
}
