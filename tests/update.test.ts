import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_SCRIPT = join(__dirname, "..", "scripts", "update.sh");
const PLUGIN_ROOT = join(__dirname, "..");

// These tests require zsh (scripts use zsh arrays). Skip on systems without it.
const hasZsh = (() => {
  try {
    execFileSync("/bin/zsh", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Helper: run update.sh and return parsed output
// ---------------------------------------------------------------------------

function runUpdate(siteDir: string): string {
  return execFileSync("/bin/zsh", [UPDATE_SCRIPT, siteDir], {
    env: { ...process.env, ANGLESITE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
}

function parseOutput(output: string): Record<string, string[]> {
  const result: Record<string, string[]> = { A: [], M: [], "=": [] };
  for (const line of output.trim().split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const status = line[0];
    const path = line.slice(2);
    if (status in result) {
      result[status].push(path);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// update.sh — file categorization
// ---------------------------------------------------------------------------

describe.skipIf(!hasZsh)("update.sh file categorization", () => {
  let tmpDir: string;
  let siteDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-update-test-"));
    siteDir = join(tmpDir, "site");
    mkdirSync(siteDir, { recursive: true });
    // Write a .site-config with a version to avoid "no version" error
    writeFileSync(
      join(siteDir, ".site-config"),
      "ANGLESITE_VERSION=0.1.0\nSITE_NAME=Test\n",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks files missing from site as new (A)", () => {
    // Site has no template files — everything in template/ should be A (new)
    const output = runUpdate(siteDir);
    const parsed = parseOutput(output);
    expect(parsed.A.length).toBeGreaterThan(0);
    expect(parsed.A).toContain("package.json");
  });

  it("marks identical files as up-to-date (=)", () => {
    // Copy a template file exactly into the site dir
    const templateFile = join(PLUGIN_ROOT, "template", "astro.config.ts");
    const content = readFileSync(templateFile, "utf-8");
    writeFileSync(join(siteDir, "astro.config.ts"), content);

    const output = runUpdate(siteDir);
    const parsed = parseOutput(output);
    expect(parsed["="]).toContain("astro.config.ts");
  });

  it("marks modified files as changed (M)", () => {
    // Copy a template file but modify it
    const templateFile = join(PLUGIN_ROOT, "template", "astro.config.ts");
    const content = readFileSync(templateFile, "utf-8");
    writeFileSync(
      join(siteDir, "astro.config.ts"),
      content + "\n// user customization\n",
    );

    const output = runUpdate(siteDir);
    const parsed = parseOutput(output);
    expect(parsed.M).toContain("astro.config.ts");
  });

  it("excludes .site-config from comparison", () => {
    const output = runUpdate(siteDir);
    const parsed = parseOutput(output);
    const allFiles = [...parsed.A, ...parsed.M, ...parsed["="]];
    expect(allFiles).not.toContain(".site-config");
  });

  it("excludes node_modules from comparison", () => {
    mkdirSync(join(siteDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(siteDir, "node_modules", "pkg", "index.js"), "");

    const output = runUpdate(siteDir);
    const allLines = output.trim().split("\n").filter(l => !l.startsWith("#"));
    const hasNodeModules = allLines.some((l) => l.includes("node_modules"));
    expect(hasNodeModules).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update.sh — version header
// ---------------------------------------------------------------------------

describe.skipIf(!hasZsh)("update.sh version output", () => {
  let tmpDir: string;
  let siteDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-update-test-"));
    siteDir = join(tmpDir, "site");
    mkdirSync(siteDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("outputs the current and site versions as header comments", () => {
    writeFileSync(
      join(siteDir, ".site-config"),
      "ANGLESITE_VERSION=0.10.0\nSITE_NAME=Test\n",
    );
    const output = runUpdate(siteDir);
    expect(output).toMatch(/^# from=0\.10\.0$/m);
    // The "to" version should match the plugin's current version
    const pkg = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf-8"),
    );
    expect(output).toContain(`# to=${pkg.version}`);
  });

  it("uses 0.0.0 when ANGLESITE_VERSION is missing from .site-config", () => {
    writeFileSync(join(siteDir, ".site-config"), "SITE_NAME=Test\n");
    const output = runUpdate(siteDir);
    expect(output).toMatch(/^# from=0\.0\.0$/m);
  });
});

// ---------------------------------------------------------------------------
// scaffold.sh — ANGLESITE_VERSION stamping
// ---------------------------------------------------------------------------

describe.skipIf(!hasZsh)("scaffold.sh ANGLESITE_VERSION stamping", () => {
  let tmpDir: string;
  const SCAFFOLD_SCRIPT = join(__dirname, "..", "scripts", "scaffold.sh");

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-scaffold-ver-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes ANGLESITE_VERSION to .site-config after scaffolding", () => {
    execFileSync("/bin/zsh", [SCAFFOLD_SCRIPT, "--yes", tmpDir], {
      stdio: "pipe",
    });

    const configPath = join(tmpDir, ".site-config");
    expect(existsSync(configPath)).toBe(true);

    const config = readFileSync(configPath, "utf-8");
    const pkg = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf-8"),
    );
    expect(config).toContain(`ANGLESITE_VERSION=${pkg.version}`);
  });

  it("does not overwrite existing .site-config content", () => {
    // Pre-create a .site-config with user content
    writeFileSync(
      join(tmpDir, ".site-config"),
      "SITE_NAME=My Business\nOWNER_NAME=Alice\n",
    );

    execFileSync("/bin/zsh", [SCAFFOLD_SCRIPT, "--yes", tmpDir], {
      stdio: "pipe",
    });

    const config = readFileSync(join(tmpDir, ".site-config"), "utf-8");
    // Existing content preserved
    expect(config).toContain("SITE_NAME=My Business");
    expect(config).toContain("OWNER_NAME=Alice");
    // Version stamped
    const pkg = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf-8"),
    );
    expect(config).toContain(`ANGLESITE_VERSION=${pkg.version}`);
  });
});
