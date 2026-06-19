import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../server/patcher.mjs";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ang-style-"));
  mkdirSync(join(root, "src/pages"), { recursive: true });
  writeFileSync(join(root, "src/pages/about.astro"), "---\n---\n<h1 id=\"t\">Welcome</h1>\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("patcher resolve() for edit-style", () => {
  it("returns whole-file replacement with the merged style", () => {
    const r = resolve(root, {
      path: "/about/",
      selector: { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Welcome" },
      op: "edit-style",
      value: { property: "color", value: "teal" },
    });
    expect(r.refused).toBeFalsy();
    expect(r.range).toEqual({ start: 0, end: expect.any(Number) });
    expect(r.replacement).toMatch(/#t\s*\{[^}]*color:\s*teal/);
  });
});
