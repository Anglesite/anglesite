// Run: npx tsx --test scripts/scaffold.test.ts
//
// Hermetic guard for scaffold.sh's rsync exclude list: packs/ and scaffold
// infrastructure must never ship inside a scaffolded site.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const realScaffold = join(dirname(fileURLToPath(import.meta.url)), "scaffold.sh");

test("scaffold.sh copies the site tree but excludes packs/ and scaffold infrastructure", () => {
  const base = mkdtempSync(join(tmpdir(), "anglesite-scaffold-test-"));
  try {
    const template = join(base, "template");
    mkdirSync(join(template, "scripts"), { recursive: true });
    mkdirSync(join(template, "src", "pages"), { recursive: true });
    mkdirSync(join(template, "packs", "demo", "src"), { recursive: true });
    copyFileSync(realScaffold, join(template, "scripts", "scaffold.sh"));
    writeFileSync(join(template, "scripts", "themes.json"), "[]");
    writeFileSync(join(template, "scripts", "check-pack.ts"), "export {};");
    writeFileSync(join(template, "scripts", "build-packs.sh"), "#!/usr/bin/env zsh\n");
    writeFileSync(join(template, "src", "pages", "index.astro"), "<h1>Welcome</h1>");
    writeFileSync(join(template, "packs", "demo", "src", "x.css"), ":root {}");

    const target = join(base, "site");
    execFileSync("/bin/zsh", [join(template, "scripts", "scaffold.sh"), "--yes", target], { stdio: "pipe" });

    assert.ok(existsSync(join(target, "src", "pages", "index.astro")), "site tree copied");
    assert.ok(existsSync(join(target, ".site-config")), ".site-config written");
    assert.ok(!existsSync(join(target, "packs")), "packs/ must not ship in sites");
    assert.ok(!existsSync(join(target, "scripts", "scaffold.sh")), "scaffold.sh excluded");
    assert.ok(!existsSync(join(target, "scripts", "themes.json")), "themes.json excluded");
    assert.ok(!existsSync(join(target, "scripts", "check-pack.ts")), "check-pack.ts excluded");
    assert.ok(!existsSync(join(target, "scripts", "build-packs.sh")), "build-packs.sh excluded");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
