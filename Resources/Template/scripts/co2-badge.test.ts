import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import co2Badge, {
  CO2_PLACEHOLDER,
  byteLength,
  estimateGramsPerByte,
  estimatedFinalByteLength,
  formatGrams,
  patchHtml,
  patchDist,
} from "./co2-badge";

test("byteLength: counts UTF-8 bytes, not JS string length", () => {
  assert.equal(byteLength("abc"), 3);
  // "café" has 4 JS characters but 5 UTF-8 bytes (é is 2 bytes).
  assert.equal(byteLength("café"), 5);
});

test("estimateGramsPerByte: returns a positive estimate, larger for more bytes", () => {
  const small = estimateGramsPerByte(100_000);
  const large = estimateGramsPerByte(500_000);
  assert.ok(small > 0, "expected a positive grams estimate");
  assert.ok(large > small, "expected a larger page to estimate more CO2 than a smaller one");
});

test("estimateGramsPerByte: green hosting produces a lower estimate than the same bytes without it", () => {
  const notGreen = estimateGramsPerByte(100_000, false);
  const green = estimateGramsPerByte(100_000, true);
  assert.ok(green < notGreen, "green hosting should reduce the estimate");
});

test("formatGrams: renders two decimal places", () => {
  assert.equal(formatGrams(0.3456), "0.35");
  assert.equal(formatGrams(1), "1.00");
  assert.equal(formatGrams(0), "0.00");
});

test("patchHtml: replaces every occurrence of the placeholder with the formatted grams value", () => {
  const html = `<p>~${CO2_PLACEHOLDER}g CO2</p><footer>~${CO2_PLACEHOLDER}g CO2</footer>`;
  const out = patchHtml(html, 0.5);
  assert.equal(out, `<p>~0.50g CO2</p><footer>~0.50g CO2</footer>`);
});

test("patchHtml: is a no-op when the placeholder is absent", () => {
  const html = "<p>no badge here</p>";
  assert.equal(patchHtml(html, 0.5), html);
});

test("estimatedFinalByteLength: is smaller than raw byteLength when the placeholder is present", () => {
  const html = `<p>~${CO2_PLACEHOLDER}g CO2</p>`;
  assert.ok(
    estimatedFinalByteLength(html) < byteLength(html),
    "the placeholder's own bytes shouldn't count toward the estimate — they won't ship",
  );
});

test("estimatedFinalByteLength: equals raw byteLength when the placeholder is absent", () => {
  const html = "<p>no badge here</p>";
  assert.equal(estimatedFinalByteLength(html), byteLength(html));
});

function makeTempDist(): string {
  return mkdtempSync(join(tmpdir(), "co2-badge-dist-"));
}

// A real page is tens of KB, not a few dozen bytes — at true micro-page sizes the estimate
// legitimately (and correctly) rounds to "0.00" at 2 decimal places, which would make these
// tests unable to tell "worked" from "didn't run". Padding to ~100KB keeps the assertions
// meaningful without pinning an exact expected float (see co2-badge's other tests for why).
const FILLER = "x".repeat(100_000);

test("patchDist: replaces the placeholder in a nested HTML file with a real numeric estimate", () => {
  const dist = makeTempDist();
  const sub = join(dist, "blog");
  mkdirSync(sub, { recursive: true });
  const withBadge = join(sub, "index.html");
  writeFileSync(withBadge, `<html><body>${FILLER}~${CO2_PLACEHOLDER}g CO2</body></html>`);

  patchDist(dist);

  const patched = readFileSync(withBadge, "utf-8");
  assert.ok(!patched.includes(CO2_PLACEHOLDER), "placeholder should be gone");
  const match = patched.match(/~(\d+\.\d{2})g CO2/);
  assert.ok(match, `expected a formatted grams value, got: ${patched}`);
  assert.ok(Number(match![1]) > 0, "expected a positive grams estimate");
});

test("patchDist: leaves a page without the placeholder byte-for-byte untouched", () => {
  const dist = makeTempDist();
  const untouched = join(dist, "index.html");
  const original = "<html><body>no badge here</body></html>";
  writeFileSync(untouched, original);

  patchDist(dist);

  assert.equal(readFileSync(untouched, "utf-8"), original);
});

test("patchDist: passes green hosting through to the estimate when GREEN_HOST_VERIFIED=true", () => {
  const dist = makeTempDist();
  const page = join(dist, "index.html");
  const html = `<html><body>${FILLER}~${CO2_PLACEHOLDER}g CO2</body></html>`;
  writeFileSync(page, html);
  const configDir = mkdtempSync(join(tmpdir(), "co2-badge-config-"));
  const greenConfig = join(configDir, ".site-config-green");
  writeFileSync(greenConfig, "GREEN_HOST_VERIFIED=true\n");
  const notGreenConfig = join(configDir, ".site-config-not-green");
  writeFileSync(notGreenConfig, "GREEN_HOST_VERIFIED=false\n");

  patchDist(dist, greenConfig);
  const greenResult = Number(readFileSync(page, "utf-8").match(/~(\d+\.\d{2})g/)![1]);

  writeFileSync(page, html); // reset for the second run
  patchDist(dist, notGreenConfig);
  const notGreenResult = Number(readFileSync(page, "utf-8").match(/~(\d+\.\d{2})g/)![1]);

  assert.ok(greenResult < notGreenResult, "green hosting should produce a lower estimate");
});

test("patchDist: warns and continues past an unreadable file rather than throwing", { skip: process.getuid?.() === 0 }, () => {
  const dist = makeTempDist();
  const unreadable = join(dist, "trap.html");
  writeFileSync(unreadable, `<html><body>~${CO2_PLACEHOLDER}g CO2</body></html>`);
  chmodSync(unreadable, 0o000); // root ignores this, hence the skip above
  const real = join(dist, "index.html");
  writeFileSync(real, `<html><body>~${CO2_PLACEHOLDER}g CO2</body></html>`);

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    assert.doesNotThrow(() => patchDist(dist));
  } finally {
    console.warn = originalWarn;
    chmodSync(unreadable, 0o644); // restore so the temp dir can be cleaned up normally
  }

  assert.ok(warnings.length >= 1, "expected a warning about the unreadable file");
  assert.ok(!readFileSync(real, "utf-8").includes(CO2_PLACEHOLDER), "the real page should still get patched");
});

test("patchDist: warns and continues past a dangling symlink rather than throwing", () => {
  // Unlike the chmod case above, the throw happens in the directory walk's statSync (before the
  // per-file try/catch), and reproduces even as root — so no skip needed.
  const dist = makeTempDist();
  symlinkSync("./does-not-exist.html", join(dist, "broken.html"));
  const real = join(dist, "index.html");
  writeFileSync(real, `<html><body>~${CO2_PLACEHOLDER}g CO2</body></html>`);

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    assert.doesNotThrow(() => patchDist(dist));
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.length >= 1, "expected a warning about the dangling symlink");
  assert.ok(!readFileSync(real, "utf-8").includes(CO2_PLACEHOLDER), "the real page should still get patched");
});

test("co2Badge: the astro:build:done hook patches pages under the emitted dir URL", () => {
  const dist = makeTempDist();
  const page = join(dist, "index.html");
  writeFileSync(page, `<html><body>${FILLER}~${CO2_PLACEHOLDER}g CO2</body></html>`);

  const hook = co2Badge().hooks["astro:build:done"];
  assert.ok(hook, "integration must register an astro:build:done hook");
  (hook as unknown as (opts: { dir: URL }) => void)({ dir: pathToFileURL(dist) });

  const patched = readFileSync(page, "utf-8");
  assert.ok(!patched.includes(CO2_PLACEHOLDER), "placeholder should be gone");
  const match = patched.match(/~(\d+\.\d{2})g CO2/);
  assert.ok(match, `expected a formatted grams value, got: ${patched.slice(-80)}`);
  assert.ok(Number(match![1]) > 0, "expected a positive grams estimate");
});
