import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyDir, EXCLUDES } from "../bin/init.js";

// ---------------------------------------------------------------------------
// EXCLUDES
// ---------------------------------------------------------------------------

describe("EXCLUDES", () => {
  it("contains expected entries", () => {
    for (const name of ["node_modules", "dist", ".astro", ".wrangler", ".certs", ".DS_Store", ".site-config"]) {
      expect(EXCLUDES.has(name), `expected EXCLUDES to contain "${name}"`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// copyDir
// ---------------------------------------------------------------------------

describe("copyDir", () => {
  let tmpDir: string;
  let src: string;
  let dst: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-init-test-"));
    src = join(tmpDir, "src");
    dst = join(tmpDir, "dst");
    mkdirSync(src, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies files from src to dst", () => {
    writeFileSync(join(src, "hello.txt"), "world");
    copyDir(src, dst);
    expect(existsSync(join(dst, "hello.txt"))).toBe(true);
    expect(readFileSync(join(dst, "hello.txt"), "utf-8")).toBe("world");
  });

  it("creates nested directories", () => {
    mkdirSync(join(src, "a", "b"), { recursive: true });
    writeFileSync(join(src, "a", "b", "deep.txt"), "nested");
    copyDir(src, dst);
    expect(existsSync(join(dst, "a", "b", "deep.txt"))).toBe(true);
    expect(readFileSync(join(dst, "a", "b", "deep.txt"), "utf-8")).toBe("nested");
  });

  it("skips excluded directories", () => {
    mkdirSync(join(src, "node_modules"), { recursive: true });
    writeFileSync(join(src, "node_modules", "pkg.json"), "{}");
    writeFileSync(join(src, "keep.txt"), "yes");
    copyDir(src, dst);
    expect(existsSync(join(dst, "node_modules"))).toBe(false);
    expect(existsSync(join(dst, "keep.txt"))).toBe(true);
  });

  it("skips excluded files", () => {
    writeFileSync(join(src, ".DS_Store"), "junk");
    writeFileSync(join(src, "real.txt"), "data");
    copyDir(src, dst);
    expect(existsSync(join(dst, ".DS_Store"))).toBe(false);
    expect(existsSync(join(dst, "real.txt"))).toBe(true);
  });

  it("does not overwrite existing files when force is false", () => {
    writeFileSync(join(src, "file.txt"), "new content");
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(dst, "file.txt"), "original content");
    copyDir(src, dst);
    // force defaults to false at module level, so existing files are preserved
    expect(readFileSync(join(dst, "file.txt"), "utf-8")).toBe("original content");
  });
});
