import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readRobotsConfig, isNoindexed, EMPTY_ROBOTS_CONFIG } from "./robots-config";

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

test("isNoindexed: true only for an exact path match", () => {
  const config = { ...EMPTY_ROBOTS_CONFIG, noindex: [{ path: "/blog/private/" }] };
  assert.equal(isNoindexed("/blog/private/", config), true);
  assert.equal(isNoindexed("/blog/other/", config), false);
});
