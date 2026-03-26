import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tokens,
  fmt,
  fmtKB,
  validateImports,
  WARN_SKILL_BYTES,
} from "../bin/build-instructions.js";

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
  it("WARN_SKILL_BYTES is 8192", () => {
    expect(WARN_SKILL_BYTES).toBe(8_192);
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
    writeFileSync(join(tmpDir, "CLAUDE.md"), "# Claude");
    const content = "@CLAUDE.md\n@missing.md";
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
