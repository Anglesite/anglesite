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

export const CODEX_MAX_BYTES = 32_768;
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

export function validateCodexLimit(agentsMd: FileInfo | null): Issue[] {
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

export function validateNoDuplication(agentsContent: string, claudeContent: string): Issue[] {
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
// Validate bare docs/ references in skills
// ---------------------------------------------------------------------------

/**
 * Docs that are created dynamically at runtime (not scaffolded from template/).
 * These are exempt from existence checks but still counted for token measurement.
 */
const DYNAMIC_DOCS = ["brand.md", "brand-voice.md", "social-calendar.md"];

/**
 * Scan all skills for bare `docs/X.md` references (not prefixed with
 * ${CLAUDE_PLUGIN_ROOT}) and verify the referenced files exist in
 * `template/docs/`. These bare paths resolve in the user's CWD at runtime,
 * so they must be scaffolded from template/ or created dynamically.
 */
export function validateSkillDocReferences(
  root: string = ROOT,
  dynamicDocs: string[] = DYNAMIC_DOCS,
): Issue[] {
  const issues: Issue[] = [];
  const skillsDir = join(root, "skills");
  const templateDocsDir = join(root, "template", "docs");

  if (!existsSync(skillsDir)) return issues;

  const skillDirs = readdirSync(skillsDir).filter(d =>
    existsSync(join(skillsDir, d, "SKILL.md"))
  );

  // Match bare docs/X.md references that are NOT preceded by ${CLAUDE_PLUGIN_ROOT}/
  // Matches: `docs/foo.md`, "docs/foo.md", docs/foo.md (standalone)
  // Skips: ${CLAUDE_PLUGIN_ROOT}/docs/foo.md
  const bareDocPattern = /(?<!\$\{CLAUDE_PLUGIN_ROOT\}\/)docs\/([\w/.-]+\.md)/g;

  for (const name of skillDirs) {
    const skillPath = join(skillsDir, name, "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    const seen = new Set<string>();
    let match;

    while ((match = bareDocPattern.exec(content)) !== null) {
      const docFile = match[1];
      if (seen.has(docFile)) continue;
      seen.add(docFile);

      // Skip dynamically-created docs
      if (dynamicDocs.includes(docFile)) continue;

      // Check if the file exists in template/docs/
      const templatePath = join(templateDocsDir, docFile);
      if (!existsSync(templatePath)) {
        issues.push({
          level: "error",
          message: `${name}/SKILL.md references docs/${docFile} but it does not exist in template/docs/`,
        });
      }
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

  // --- Runtime doc-read analysis ---
  console.log("\nRuntime doc reads (SKILL.md + referenced docs):");
  const skillReads: SkillDocReads[] = [];
  for (const name of skillDirs) {
    const reads = analyzeSkillReads(name);
    skillReads.push(reads);
    const docCount = reads.referencedDocs.length;
    const docsLabel = docCount === 0 ? "no refs" : `${docCount} docs`;
    console.log(
      `  ${name.padEnd(24)} ${fmtKB(reads.totalBytes).padStart(8)}  ${fmt(reads.totalTokens).padStart(6)} tokens  (${docsLabel})`
    );
  }

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

  // Validate bare docs/ references in skills
  issues.push(...validateSkillDocReferences());

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

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  main();
}
