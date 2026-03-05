#!/usr/bin/env node

/**
 * Anglesite CLI — scaffold a new site.
 *
 * Usage:
 *   npx anglesite init [directory]
 *   npx anglesite init my-site
 *   npx anglesite init .
 *
 * Copies the Anglesite template to the target directory,
 * producing a project with AGENTS.md, CLAUDE.md, GEMINI.md,
 * and full documentation that any AI coding agent can use.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, "..", "template");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Anglesite — AI webmaster

Usage:
  npx anglesite init [directory]

Scaffolds a new Astro + Keystatic site with AI agent instructions
(AGENTS.md, CLAUDE.md, GEMINI.md) and full documentation.

Options:
  --force    Overwrite existing files
  --help     Show this help
`);
  process.exit(0);
}

const command = args[0];
if (command && command !== "init") {
  console.error(`Unknown command: ${command}\nUsage: npx anglesite init [directory]`);
  process.exit(1);
}

const force = args.includes("--force");
const dest = resolve(args.find(a => a !== "init" && !a.startsWith("-")) || ".");

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

if (!existsSync(TEMPLATE)) {
  console.error("Error: template directory not found. The package may be corrupted.");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// Check if destination has existing files (besides hidden files)
const existing = readdirSync(dest).filter(f => !f.startsWith("."));
if (existing.length > 0 && !force) {
  console.error(`Directory ${dest} is not empty. Use --force to overwrite.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Copy template
// ---------------------------------------------------------------------------

const EXCLUDES = new Set(["node_modules", "dist", ".astro", ".wrangler", ".certs", ".DS_Store", ".site-config"]);

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDES.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      if (!force && existsSync(dstPath)) continue;
      cpSync(srcPath, dstPath);
    }
  }
}

copyDir(TEMPLATE, dest);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log(`\nAnglesite scaffolded to ${dest}\n`);
console.log("Next steps:");
console.log(`  cd ${dest === "." ? "." : dest}`);
console.log("  npm install");
console.log("  npm run dev");
console.log("");
console.log("AI agent instructions:");
console.log("  AGENTS.md  — Any agent (Codex, Cursor, Copilot, etc.)");
console.log("  CLAUDE.md  — Claude Code");
console.log("  GEMINI.md  — Gemini CLI");
