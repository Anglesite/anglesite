import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tokens,
  fmt,
  fmtKB,
  validateCodexLimit,
  validateImports,
  validateNoDuplication,
  CODEX_MAX_BYTES,
  WARN_SKILL_BYTES,
} from "../bin/build-instructions.js";
import type { FileInfo } from "../bin/build-instructions.js";

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

describe("tokens", () => {
  it("divides bytes by 4", () => {
    expect(tokens(400)).toBe(100);
  });

  it("rounds up with Math.ceil", () => {
    expect(tokens(1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fmt
// ---------------------------------------------------------------------------

describe("fmt", () => {
  it("locale-formats large numbers", () => {
    expect(fmt(1234567)).toContain("1,234,567");
  });
});

// ---------------------------------------------------------------------------
// fmtKB
// ---------------------------------------------------------------------------

describe("fmtKB", () => {
  it("formats 1024 bytes as 1.0KB", () => {
    expect(fmtKB(1024)).toBe("1.0KB");
  });

  it("formats 2560 bytes as 2.5KB", () => {
    expect(fmtKB(2560)).toBe("2.5KB");
  });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("CODEX_MAX_BYTES is 32768", () => {
    expect(CODEX_MAX_BYTES).toBe(32_768);
  });

  it("WARN_SKILL_BYTES is 8192", () => {
    expect(WARN_SKILL_BYTES).toBe(8_192);
  });
});

// ---------------------------------------------------------------------------
// validateCodexLimit
// ---------------------------------------------------------------------------

describe("validateCodexLimit", () => {
  it("returns empty array for null", () => {
    expect(validateCodexLimit(null)).toEqual([]);
  });

  it("returns empty array when under limit", () => {
    const info: FileInfo = { path: "test", label: "test", bytes: 1000, tokens: 250 };
    expect(validateCodexLimit(info)).toEqual([]);
  });

  it("returns error when over 32KB", () => {
    const info: FileInfo = { path: "test", label: "test", bytes: 33000, tokens: 8250 };
    const issues = validateCodexLimit(info);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
  });

  it("returns warning when over 80% of limit", () => {
    const info: FileInfo = { path: "test", label: "test", bytes: 27000, tokens: 6750 };
    const issues = validateCodexLimit(info);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// validateImports
// ---------------------------------------------------------------------------

describe("validateImports", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-build-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error for missing import targets", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "# Agents");
    const content = "@AGENTS.md\n@missing.md";
    const issues = validateImports(content, tmpDir, "TEST");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toContain("missing.md");
  });

  it("returns empty array when no imports exist", () => {
    const issues = validateImports("No imports here", tmpDir, "TEST");
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateNoDuplication
// ---------------------------------------------------------------------------

describe("validateNoDuplication", () => {
  it("warns when 4+ long lines are shared", () => {
    const sharedLine = "This is a long line that is definitely more than thirty characters long for testing.";
    const agentsContent = [sharedLine, sharedLine + " v2", sharedLine + " v3", sharedLine + " v4"].join("\n");
    const claudeContent = agentsContent;
    const issues = validateNoDuplication(agentsContent, claudeContent);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
  });

  it("returns empty when 3 or fewer lines are shared", () => {
    const line1 = "This is a long line that is definitely more than thirty characters.";
    const line2 = "Another long line that is definitely more than thirty characters.";
    const line3 = "A third long line that is definitely more than thirty characters.";
    const agentsContent = [line1, line2, line3].join("\n");
    const claudeContent = [line1, line2, line3].join("\n");
    const issues = validateNoDuplication(agentsContent, claudeContent);
    expect(issues).toEqual([]);
  });
});
