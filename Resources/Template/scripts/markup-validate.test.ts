import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateMarkupHtml, validateDist } from "./markup-validate.ts";

const GOOD = `<!DOCTYPE html><html lang="en"><head><title>Hello</title></head><body><h1>Hi</h1></body></html>`;

test("validateMarkupHtml: passes conformant markup", () => {
  assert.deepEqual(validateMarkupHtml(GOOD, "index.html"), []);
});

test("validateMarkupHtml: flags an empty <title>", () => {
  const html = `<!DOCTYPE html><html><head><title></title></head><body></body></html>`;
  const problems = validateMarkupHtml(html, "about/index.html");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^about\/index\.html:/);
  assert.match(problems[0], /empty-title/);
});

test("validateMarkupHtml: flags unclosed/misnested elements", () => {
  const html = `<!DOCTYPE html><html><head><title>T</title></head><body><div><span></div></span></body></html>`;
  const problems = validateMarkupHtml(html, "index.html");
  assert.ok(problems.length > 0);
  assert.ok(problems.every((p) => /close-order/.test(p)));
});

test("validateMarkupHtml: flags duplicate ids", () => {
  const html = `<!DOCTYPE html><html><head><title>T</title></head><body><div id="a"></div><div id="a"></div></body></html>`;
  const problems = validateMarkupHtml(html, "index.html");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no-dup-id/);
});

test("validateMarkupHtml: does not flag missing alt text — that's a11y-validate's job", () => {
  const html = `<!DOCTYPE html><html><head><title>T</title></head><body><img src="x.png"></body></html>`;
  assert.deepEqual(validateMarkupHtml(html, "index.html"), []);
});

test("validateDist: walks nested dist/ and aggregates problems across files", () => {
  const dir = mkdtempSync(join(tmpdir(), "markup-validate-test-"));
  try {
    mkdirSync(join(dir, "about"), { recursive: true });
    writeFileSync(join(dir, "index.html"), GOOD);
    writeFileSync(join(dir, "about", "index.html"), `<!DOCTYPE html><html><head><title></title></head><body></body></html>`);

    const problems = validateDist(dir);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^about\/index\.html:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateDist: returns no problems for an absent directory", () => {
  assert.deepEqual(validateDist(join(tmpdir(), "markup-validate-test-does-not-exist")), []);
});
