import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAnglesiteConfig } from "./anglesite-config";

/// Temporarily replaces `console.warn` for the duration of `fn`, recording calls, then restores it.
function withWarnSpy<T>(fn: (calls: unknown[][]) => T): T {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    return fn(calls);
  } finally {
    console.warn = original;
  }
}

function makeTempSiteRoot(): string {
  return mkdtempSync(join(tmpdir(), "anglesite-config-test-"));
}

test("readAnglesiteConfig: missing file returns the default config quietly, without warning", () => {
  const siteRoot = makeTempSiteRoot();
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.equal(calls.length, 0, "console.warn should not be called when anglesite.json is simply absent");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: present-but-invalid JSON returns the default and warns", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), "not json {");
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.ok(calls.length >= 1, "console.warn should be called when anglesite.json exists but fails to parse");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: anglesite.json existing as a directory warns and returns the default", () => {
  const siteRoot = makeTempSiteRoot();
  mkdirSync(join(siteRoot, "anglesite.json"));
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.ok(calls.length >= 1, "console.warn should be called when anglesite.json exists but can't be read as a file");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: a JSON array root returns the default and warns", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), "[]");
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.ok(calls.length >= 1, "console.warn should be called when anglesite.json isn't a JSON object");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: returns declared sections as-is", () => {
  const siteRoot = makeTempSiteRoot();
  const raw = JSON.stringify({
    version: 1,
    domain: { hostname: "example.com", choice: "transfer", attach: true },
    workers: { active: ["webmention-receive"] },
  });
  writeFileSync(join(siteRoot, "anglesite.json"), raw);
  try {
    const result = readAnglesiteConfig(siteRoot);
    assert.deepEqual(result, {
      version: 1,
      domain: { hostname: "example.com", choice: "transfer", attach: true },
      workers: { active: ["webmention-receive"] },
    });
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: defaults version to 1 when the file omits it", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), JSON.stringify({ domain: { hostname: "example.com" } }));
  try {
    const result = readAnglesiteConfig(siteRoot);
    assert.equal(result.version, 1);
    assert.deepEqual(result.domain, { hostname: "example.com" });
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});
