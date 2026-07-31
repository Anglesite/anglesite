import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  readRobotsConfig,
  isNoindexed,
  sanitizeForHeaderLine,
  sourceLabel,
  EMPTY_ROBOTS_CONFIG,
} from "./robots-config";

function tempSite(): string {
  return mkdtempSync(resolve(tmpdir(), "robots-config-test-"));
}

test("readRobotsConfig: missing file yields the empty config", () => {
  const cwd = tempSite();
  assert.deepEqual(readRobotsConfig(cwd), EMPTY_ROBOTS_CONFIG);
});

test("readRobotsConfig: malformed JSON yields the empty config", () => {
  const cwd = tempSite();
  mkdirSync(resolve(cwd, "src/data"), { recursive: true });
  writeFileSync(resolve(cwd, "src/data/robots-config.json"), "not json", "utf-8");
  assert.deepEqual(readRobotsConfig(cwd), EMPTY_ROBOTS_CONFIG);
});

test("readRobotsConfig: parses a valid config", () => {
  const cwd = tempSite();
  mkdirSync(resolve(cwd, "src/data"), { recursive: true });
  writeFileSync(
    resolve(cwd, "src/data/robots-config.json"),
    JSON.stringify({
      noindex: [{ path: "/a/", source: { kind: "page", file: "src/pages/a.astro" } }],
      disallow: [],
      extra: ["User-agent: Foo\nDisallow: /bar/"],
    }),
    "utf-8",
  );
  const config = readRobotsConfig(cwd);
  assert.equal(config.noindex.length, 1);
  assert.equal(config.noindex[0].path, "/a/");
  assert.deepEqual(config.extra, ["User-agent: Foo\nDisallow: /bar/"]);
});

test("readRobotsConfig: returns independent array instances across calls", () => {
  const cwd1 = tempSite();
  const cwd2 = tempSite();
  const config1 = readRobotsConfig(cwd1);
  const config2 = readRobotsConfig(cwd2);
  // Verify arrays are not shared instances
  assert.notStrictEqual(config1.noindex, config2.noindex);
  assert.notStrictEqual(config1.disallow, config2.disallow);
  assert.notStrictEqual(config1.extra, config2.extra);
  // Verify mutation doesn't affect the other
  config1.noindex.push({ path: "/test/" });
  assert.equal(config1.noindex.length, 1);
  assert.equal(config2.noindex.length, 0);
});

test("isNoindexed: true only for an exact path match", () => {
  const config = { ...EMPTY_ROBOTS_CONFIG, noindex: [{ path: "/blog/private/" }] };
  assert.equal(isNoindexed("/blog/private/", config), true);
  assert.equal(isNoindexed("/blog/other/", config), false);
});

test("EMPTY_ROBOTS_CONFIG: object and arrays are frozen against in-place mutation", () => {
  assert.equal(Object.isFrozen(EMPTY_ROBOTS_CONFIG), true);
  assert.equal(Object.isFrozen(EMPTY_ROBOTS_CONFIG.noindex), true);
  assert.equal(Object.isFrozen(EMPTY_ROBOTS_CONFIG.disallow), true);
  assert.equal(Object.isFrozen(EMPTY_ROBOTS_CONFIG.extra), true);
  // A bare spread shares the frozen arrays, so the mutation a sloppy caller would make throws
  // here instead of silently leaking into every other holder of the shared constant.
  const shared = { ...EMPTY_ROBOTS_CONFIG };
  assert.throws(() => shared.noindex.push({ path: "/leaked/" }), TypeError);
  assert.equal(EMPTY_ROBOTS_CONFIG.noindex.length, 0);
});

test("sanitizeForHeaderLine: strips CR/LF so a path can't inject a line", () => {
  assert.equal(sanitizeForHeaderLine("/about/"), "/about/");
  assert.equal(
    sanitizeForHeaderLine("/evil/\nDisallow: /\n"),
    "/evil/Disallow: /",
  );
  assert.equal(sanitizeForHeaderLine("/evil/\r\n  X-Robots-Tag: none"), "/evil/  X-Robots-Tag: none");
});

test("sourceLabel: renders page and collection sources, null for none", () => {
  assert.equal(sourceLabel(null), null);
  assert.equal(sourceLabel(undefined), null);
  assert.equal(sourceLabel({ kind: "page", file: "src/pages/about.astro" }), "src/pages/about.astro");
  assert.equal(sourceLabel({ kind: "collection", collection: "notes", id: "2026/foo" }), "notes/2026/foo");
});

test("sourceLabel: null rather than 'undefined/undefined' for a malformed collection entry", () => {
  assert.equal(sourceLabel({ kind: "collection" }), null);
  assert.equal(sourceLabel({ kind: "collection", collection: "notes" }), null);
  assert.equal(sourceLabel({ kind: "collection", id: "foo" }), null);
  assert.equal(sourceLabel({ kind: "page" }), null);
});

test("sourceLabel: strips CR/LF from its rendered label", () => {
  assert.equal(sourceLabel({ kind: "page", file: "src/pages/a\nDisallow: /" }), "src/pages/aDisallow: /");
  assert.equal(sourceLabel({ kind: "collection", collection: "notes", id: "a\nb" }), "notes/ab");
});
