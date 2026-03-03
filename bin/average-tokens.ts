/**
 * Token efficiency calculator for Anglesite's /anglesite:start skill.
 *
 * Measures actual file sizes, models a 30-turn session cost, and
 * writes a deterministic "Token Efficiency" section into README.md.
 *
 * Usage: npx tsx bin/average-tokens.ts
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

const SESSION = {
  turns: 30,
  systemPromptTokens: 2000,
  avgNewContentPerTurn: 850,
  outputTokens: 25_000,
};

const PRICING: Record<string, { label: string; input: number; output: number; cached: number }> = {
  opus:   { label: "Opus",   input: 15,  output: 75, cached: 1.875 },
  sonnet: { label: "Sonnet", input: 3,   output: 15, cached: 0.375 },
};

// Cross-cutting reference files in docs/smb/ (not business type files)
const SMB_CROSS_CUTTING = new Set([
  "README.md",
  "multi-mode.md",
  "pre-launch.md",
  "consumer-checklist.md",
  "legal-checklist.md",
  "info-changes.md",
  "reviews.md",
  "competitor-awareness.md",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(__dirname, "..");

function bytes(relativePath: string): number {
  return statSync(join(PLUGIN_ROOT, relativePath)).size;
}

function tokens(byteCount: number): number {
  return Math.ceil(byteCount / 4);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return fmt(n);
}

function fmtDollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Measure
// ---------------------------------------------------------------------------

interface FileMeasurement {
  label: string;
  path: string;
  bytes: number;
  tokens: number;
}

interface SmbStats {
  count: number;
  totalBytes: number;
  avgBytes: number;
  avgTokens: number;
  minBytes: number;
  maxBytes: number;
}

interface Measurements {
  alwaysLoaded: FileMeasurement[];
  command: FileMeasurement[];
  step1: FileMeasurement[];
  step2: FileMeasurement[];
  smb: SmbStats;
}

function measure(): Measurements {
  // Always-loaded context (every turn)
  const claudeMd = bytes("template/CLAUDE.md");
  const agentsMd = bytes("template/AGENTS.md");

  // Skill context (in history from turn 1)
  const startMd = bytes("skills/start/SKILL.md");

  // Step 1: business type discovery
  const smbReadme = bytes("template/docs/smb/README.md");

  const smbDir = join(PLUGIN_ROOT, "template/docs/smb");
  const smbTypeFiles = readdirSync(smbDir)
    .filter((f) => f.endsWith(".md") && !SMB_CROSS_CUTTING.has(f));
  const smbSizes = smbTypeFiles.map((f) => statSync(join(smbDir, f)).size);
  const smbTotal = smbSizes.reduce((a, b) => a + b, 0);
  const smbAvgBytes = Math.round(smbTotal / smbSizes.length);

  // Step 2: design interview
  const designInterview = bytes("skills/design-interview/SKILL.md");
  const designSystem = bytes("template/docs/design-system.md");

  return {
    alwaysLoaded: [
      { label: "CLAUDE.md", path: "template/CLAUDE.md", bytes: claudeMd, tokens: tokens(claudeMd) },
      { label: "AGENTS.md", path: "template/AGENTS.md", bytes: agentsMd, tokens: tokens(agentsMd) },
    ],
    command: [
      { label: "start/SKILL.md", path: "skills/start/SKILL.md", bytes: startMd, tokens: tokens(startMd) },
    ],
    step1: [
      { label: "smb/README.md", path: "template/docs/smb/README.md", bytes: smbReadme, tokens: tokens(smbReadme) },
    ],
    step2: [
      { label: "design-interview/SKILL.md", path: "skills/design-interview/SKILL.md", bytes: designInterview, tokens: tokens(designInterview) },
      { label: "design-system.md", path: "template/docs/design-system.md", bytes: designSystem, tokens: tokens(designSystem) },
    ],
    smb: {
      count: smbSizes.length,
      totalBytes: smbTotal,
      avgBytes: smbAvgBytes,
      avgTokens: tokens(smbAvgBytes),
      minBytes: Math.min(...smbSizes),
      maxBytes: Math.max(...smbSizes),
    },
  };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface SessionCost {
  label: string;
  cachedInput: number;
  uncachedInput: number;
  totalInput: number;
  totalOutput: number;
  cost: number;
}

function model(m: Measurements): { contextPerTurn: number; costs: SessionCost[] } {
  const alwaysTokens = SESSION.systemPromptTokens
    + m.alwaysLoaded.reduce((s, f) => s + f.tokens, 0);

  const commandTokens = m.command.reduce((s, f) => s + f.tokens, 0);

  const onDemandTokens = m.step1.reduce((s, f) => s + f.tokens, 0)
    + m.smb.avgTokens
    + m.step2.reduce((s, f) => s + f.tokens, 0);

  const contextPerTurn = alwaysTokens + commandTokens + onDemandTokens;

  const N = SESSION.turns;
  const g = SESSION.avgNewContentPerTurn;

  // After turn 1, the context prefix is cached
  const cachedInput = (N - 1) * contextPerTurn;
  const uncachedInput = contextPerTurn + g * N * (N + 1) / 2;
  const totalInput = cachedInput + uncachedInput;
  const totalOutput = SESSION.outputTokens;

  const costs = Object.values(PRICING).map((p) => ({
    label: p.label,
    cachedInput,
    uncachedInput,
    totalInput,
    totalOutput,
    cost:
      (uncachedInput / 1_000_000) * p.input
      + (cachedInput / 1_000_000) * p.cached
      + (totalOutput / 1_000_000) * p.output,
  }));

  return { contextPerTurn, costs };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(m: Measurements, contextPerTurn: number, costs: SessionCost[]): string {
  const N = SESSION.turns;
  const totalInput = costs[0].totalInput;

  const lines: string[] = [
    "## Token Efficiency",
    "",
    `Estimated cost per \`/anglesite:start\` session (~${N} turns):`,
    "",
    "| Model | Cached input | New input | Output | Est. cost |",
    "|---|---|---|---|---|",
  ];

  for (const c of costs) {
    lines.push(
      `| ${c.label} | ${fmtK(c.cachedInput)} | ${fmtK(c.uncachedInput)} | ${fmtK(c.totalOutput)} | ${fmtDollars(c.cost)} |`,
    );
  }

  lines.push(
    "",
    "<details>",
    "<summary>Context budget breakdown</summary>",
    "",
    "### Always-loaded context (every turn)",
    "",
    "| File | Tokens |",
    "|---|---|",
    `| System prompt (est.) | ${fmt(SESSION.systemPromptTokens)} |`,
  );

  for (const f of m.alwaysLoaded) {
    lines.push(`| ${f.label} | ${fmt(f.tokens)} |`);
  }

  const alwaysTotal = SESSION.systemPromptTokens
    + m.alwaysLoaded.reduce((s, f) => s + f.tokens, 0);
  lines.push(`| **Subtotal** | **${fmt(alwaysTotal)}** |`);

  lines.push(
    "",
    "### Skill + on-demand reads",
    "",
    "| File | Tokens | Loaded after |",
    "|---|---|---|",
  );

  for (const f of m.command) {
    lines.push(`| ${f.label} | ${fmt(f.tokens)} | Skill invocation |`);
  }
  for (const f of m.step1) {
    lines.push(`| ${f.label} | ${fmt(f.tokens)} | Step 1 |`);
  }
  lines.push(`| Avg SMB type (1 of ${m.smb.count} files) | ${fmt(m.smb.avgTokens)} | Step 1 |`);
  for (const f of m.step2) {
    lines.push(`| ${f.label} | ${fmt(f.tokens)} | Step 2 |`);
  }

  const onDemandTotal = m.command.reduce((s, f) => s + f.tokens, 0)
    + m.step1.reduce((s, f) => s + f.tokens, 0)
    + m.smb.avgTokens
    + m.step2.reduce((s, f) => s + f.tokens, 0);
  lines.push(`| **Subtotal** | **${fmt(onDemandTotal)}** | |`);

  lines.push(
    "",
    "### Session model",
    "",
    "| Parameter | Value |",
    "|---|---|",
    `| Turns | ${N} |`,
    `| Context per turn (after step 2) | ${fmt(contextPerTurn)} |`,
    `| New content per turn | ~${fmt(SESSION.avgNewContentPerTurn)} |`,
    `| Total input (all API calls) | ${fmtK(totalInput)} |`,
    `| Total output | ${fmtK(SESSION.outputTokens)} |`,
    "",
    "</details>",
    "",
    "*Generated by `bin/average-tokens.ts` — do not edit manually.*",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const START_MARKER = "<!-- token-efficiency-start -->";
const END_MARKER = "<!-- token-efficiency-end -->";

function main() {
  const m = measure();
  const { contextPerTurn, costs } = model(m);
  const section = render(m, contextPerTurn, costs);
  const markedSection = `${START_MARKER}\n${section}\n${END_MARKER}`;

  // Update README.md
  const readmePath = join(__dirname, "..", "README.md");
  let readme = readFileSync(readmePath, "utf-8");

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    readme = readme.slice(0, startIdx) + markedSection + readme.slice(endIdx + END_MARKER.length);
  } else {
    // Insert before ## License
    const licenseIdx = readme.indexOf("\n## License");
    if (licenseIdx !== -1) {
      readme = readme.slice(0, licenseIdx) + "\n" + markedSection + "\n" + readme.slice(licenseIdx);
    } else {
      readme += "\n" + markedSection + "\n";
    }
  }

  writeFileSync(readmePath, readme);

  // Print summary to stdout
  console.log("Token Efficiency Report");
  console.log("=======================\n");

  console.log("Always-loaded context:");
  console.log(`  System prompt (est.)  ${fmt(SESSION.systemPromptTokens)} tokens`);
  for (const f of m.alwaysLoaded) {
    console.log(`  ${f.label.padEnd(22)} ${fmt(f.tokens)} tokens`);
  }

  console.log("\nOn-demand reads:");
  for (const f of [...m.command, ...m.step1]) {
    console.log(`  ${f.label.padEnd(22)} ${fmt(f.tokens)} tokens`);
  }
  console.log(`  ${"Avg SMB type".padEnd(22)} ${fmt(m.smb.avgTokens)} tokens (1 of ${m.smb.count})`);
  for (const f of m.step2) {
    console.log(`  ${f.label.padEnd(22)} ${fmt(f.tokens)} tokens`);
  }

  console.log(`\nContext per turn:       ${fmt(contextPerTurn)} tokens`);
  console.log(`Estimated turns:       ${SESSION.turns}`);

  console.log("\nSession cost:");
  for (const c of costs) {
    console.log(`  ${c.label.padEnd(8)} ${fmtDollars(c.cost)}  (${fmtK(c.totalInput)} input, ${fmtK(c.totalOutput)} output)`);
  }

  console.log("\nREADME.md updated.");
}

main();
