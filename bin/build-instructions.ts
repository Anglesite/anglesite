/**
 * Validates and measures token efficiency of all agent instruction files.
 *
 * Checks:
 * - AGENTS.md under Codex 32KB limit
 * - No content duplication between AGENTS.md and CLAUDE.md
 * - Token budget for always-loaded context
 * - Per-skill token measurements
 * - @import references resolve
 *
 * Usage: npx tsx bin/build-instructions.ts
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODEX_MAX_BYTES = 32_768;
const WARN_SKILL_BYTES = 8_192;

// Approximate: 1 token ≈ 4 bytes for English text
function tokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

// ---------------------------------------------------------------------------
// Measure files
// ---------------------------------------------------------------------------

interface FileInfo {
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

interface Issue {
  level: "error" | "warn";
  message: string;
}

function validateCodexLimit(agentsMd: FileInfo | null): Issue[] {
  if (!agentsMd) return [];
  if (agentsMd.bytes > CODEX_MAX_BYTES) {
    return [{
      level: "error",
      message: `AGENTS.md is ${fmtKB(agentsMd.bytes)} — exceeds Codex 32KB limit (${fmtKB(CODEX_MAX_BYTES)})`,
    }];
  }
  if (agentsMd.bytes > CODEX_MAX_BYTES * 0.8) {
    return [{
      level: "warn",
      message: `AGENTS.md is ${fmtKB(agentsMd.bytes)} — over 80% of Codex 32KB limit`,
    }];
  }
  return [];
}

function validateImports(content: string, dir: string, label: string): Issue[] {
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

function validateNoDuplication(agentsContent: string, claudeContent: string): Issue[] {
  const issues: Issue[] = [];

  // Extract non-trivial lines (>30 chars, not headers/tables/blank)
  const agentsLines = agentsContent.split("\n")
    .filter(l => l.length > 30 && !l.startsWith("#") && !l.startsWith("|") && l.trim() !== "");

  const claudeLines = new Set(
    claudeContent.split("\n")
      .filter(l => l.length > 30 && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("@") && l.trim() !== "")
  );

  const duplicates = agentsLines.filter(l => claudeLines.has(l));
  if (duplicates.length > 3) {
    issues.push({
      level: "warn",
      message: `${duplicates.length} lines appear in both AGENTS.md and CLAUDE.md — possible duplication`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const issues: Issue[] = [];

  // Measure always-loaded files
  const templateDir = join(ROOT, "template");
  const agentsMd = measureFile("template/AGENTS.md", "AGENTS.md");
  const claudeMd = measureFile("template/CLAUDE.md", "CLAUDE.md");

  console.log("Agent Instruction Efficiency Report");
  console.log("====================================\n");

  // --- Always-loaded context ---
  console.log("Always-loaded context (every turn):");
  const alwaysLoaded: FileInfo[] = [];
  if (agentsMd) alwaysLoaded.push(agentsMd);
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

  // --- Template docs ---
  const docsDir = join(ROOT, "template/docs");
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
  if (agentsMd) {
    issues.push(...validateCodexLimit(agentsMd));
  }

  if (claudeMd) {
    const claudeContent = readFileSync(join(ROOT, "template/CLAUDE.md"), "utf-8");
    issues.push(...validateImports(claudeContent, templateDir, "CLAUDE.md"));

    if (agentsMd) {
      const agentsContent = readFileSync(join(ROOT, "template/AGENTS.md"), "utf-8");
      issues.push(...validateNoDuplication(agentsContent, claudeContent));
    }
  }

  // Validate GEMINI.md imports
  const geminiPath = join(ROOT, "template/GEMINI.md");
  if (existsSync(geminiPath)) {
    const geminiContent = readFileSync(geminiPath, "utf-8");
    issues.push(...validateImports(geminiContent, templateDir, "GEMINI.md"));
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

  // Codex budget
  if (agentsMd) {
    const pct = Math.round((agentsMd.bytes / CODEX_MAX_BYTES) * 100);
    console.log(`\nCodex budget: ${pct}% of 32KB limit`);
  }

  console.log(`Claude context: ~${fmt(totalAlwaysTokens)} tokens always loaded`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
