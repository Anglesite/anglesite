import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bump, isValidSemver, updateClaudeMdVersion } from "../bin/release.js";

// ---------------------------------------------------------------------------
// bump
// ---------------------------------------------------------------------------

describe("bump", () => {
  it("bumps patch", () => {
    expect(bump("0.16.1", "patch")).toBe("0.16.2");
  });

  it("bumps minor", () => {
    expect(bump("0.16.1", "minor")).toBe("0.17.0");
  });

  it("bumps major", () => {
    expect(bump("0.16.1", "major")).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// isValidSemver
// ---------------------------------------------------------------------------

describe("isValidSemver", () => {
  it("accepts valid semver", () => {
    expect(isValidSemver("1.2.3")).toBe(true);
  });

  it("rejects partial version", () => {
    expect(isValidSemver("1.2")).toBe(false);
  });

  it("rejects text", () => {
    expect(isValidSemver("patch")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateClaudeMdVersion
// ---------------------------------------------------------------------------

describe("updateClaudeMdVersion", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-release-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates the version string in CLAUDE.md", () => {
    const claudeMd = join(tmpDir, "CLAUDE.md");
    writeFileSync(
      claudeMd,
      "# Anglesite\n\n**Version:** 0.16.1 · **License:** ISC · **Node:** >=22\n\nMore content.\n"
    );
    updateClaudeMdVersion(claudeMd, "0.16.4");
    const result = readFileSync(claudeMd, "utf-8");
    expect(result).toContain("**Version:** 0.16.4");
    expect(result).not.toContain("0.16.1");
  });

  it("preserves surrounding content", () => {
    const claudeMd = join(tmpDir, "CLAUDE.md");
    const content =
      "# Anglesite\n\n**Version:** 1.0.0 · **License:** ISC · **Node:** >=22 · **Module system:** ESM\n\n## Structure\n";
    writeFileSync(claudeMd, content);
    updateClaudeMdVersion(claudeMd, "1.1.0");
    const result = readFileSync(claudeMd, "utf-8");
    expect(result).toContain("# Anglesite");
    expect(result).toContain("## Structure");
    expect(result).toContain("**Version:** 1.1.0");
  });

  it("throws if no version line is found", () => {
    const claudeMd = join(tmpDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# Anglesite\n\nNo version line here.\n");
    expect(() => updateClaudeMdVersion(claudeMd, "1.0.0")).toThrow(
      /Version.*line/i
    );
  });

  it("keeps CLAUDE.md in sync with manifests (real project)", () => {
    // Validates the actual project state — this is the regression test
    const root = join(import.meta.dirname, "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const claudeMd = readFileSync(join(root, "CLAUDE.md"), "utf-8");
    const match = claudeMd.match(/\*\*Version:\*\*\s+([\d.]+)/);
    expect(match, "CLAUDE.md should contain a **Version:** line").not.toBeNull();
    expect(match![1]).toBe(pkg.version);
  });
});
