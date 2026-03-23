import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfig, readConfigFromString } from "../template/scripts/config.js";

// ---------------------------------------------------------------------------
// readConfigFromString — pure, no I/O
// ---------------------------------------------------------------------------

describe("readConfigFromString", () => {
  it("returns the value for a matching key", () => {
    expect(readConfigFromString("FOO=bar", "FOO")).toBe("bar");
  });

  it("returns undefined for a missing key", () => {
    expect(readConfigFromString("FOO=bar", "BAZ")).toBeUndefined();
  });

  it("trims whitespace from the value", () => {
    expect(readConfigFromString("FOO=  hello  ", "FOO")).toBe("hello");
  });

  it("handles multi-line configs", () => {
    const content = "A=1\nB=2\nC=3";
    expect(readConfigFromString(content, "B")).toBe("2");
  });

  it("handles values containing equals signs", () => {
    expect(readConfigFromString("URL=https://example.com?a=1&b=2", "URL")).toBe(
      "https://example.com?a=1&b=2",
    );
  });

  it("returns undefined for empty content", () => {
    expect(readConfigFromString("", "FOO")).toBeUndefined();
  });

  it("matches keys at the start of a line only", () => {
    // "XFOO=bad" should not match key "FOO"
    expect(readConfigFromString("XFOO=bad\nFOO=good", "FOO")).toBe("good");
  });

  it("handles comma-separated values", () => {
    expect(
      readConfigFromString("PII_EMAIL_ALLOW=a@b.com,c@d.com", "PII_EMAIL_ALLOW"),
    ).toBe("a@b.com,c@d.com");
  });
});

// ---------------------------------------------------------------------------
// readConfig — file-based
// ---------------------------------------------------------------------------

describe("readConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a key from a config file", () => {
    const configPath = join(tmpDir, ".site-config");
    writeFileSync(configPath, "SITE_NAME=My Site\nDEV_HOSTNAME=local.test\n");
    expect(readConfig("SITE_NAME", configPath)).toBe("My Site");
    expect(readConfig("DEV_HOSTNAME", configPath)).toBe("local.test");
  });

  it("returns undefined when the file does not exist", () => {
    expect(readConfig("FOO", join(tmpDir, "nonexistent"))).toBeUndefined();
  });

  it("returns undefined when the key is not in the file", () => {
    const configPath = join(tmpDir, ".site-config");
    writeFileSync(configPath, "A=1\n");
    expect(readConfig("B", configPath)).toBeUndefined();
  });
});
