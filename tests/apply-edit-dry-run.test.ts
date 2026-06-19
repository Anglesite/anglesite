import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ang-dry-"));
  mkdirSync(join(root, "src/pages"), { recursive: true });
  writeFileSync(join(root, "src/pages/about.astro"), "---\n---\n<h1>Welcome</h1>\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const baseEdit = {
  id: "1",
  path: "/about/",
  selector: { tag: "h1", classes: [], nthChild: 1, textContent: "Welcome" },
  op: "replace-text",
  value: "Hello",
};

describe("apply_edit dry_run", () => {
  it("returns edit-preview without mutating the file", async () => {
    const file = join(root, "src/pages/about.astro");
    const before = readFileSync(file, "utf-8");
    const res = await applyEdit(root, { ...baseEdit, dry_run: true });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.type).toBe("anglesite:edit-preview");
    expect(body.before).toContain("Welcome");
    expect(body.after).toContain("Hello");
    // critical: file is byte-identical
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  it("still refuses (no-match) under dry_run", async () => {
    const res = await applyEdit(root, {
      ...baseEdit, dry_run: true,
      selector: { tag: "h1", classes: [], nthChild: 1, textContent: "Nonexistent" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).reason).toBe("no-match");
  });

  it("dry_run refuses replace-image-src without writing image files", async () => {
    const res = await applyEdit(root, {
      id: "img1", path: "/about/",
      selector: { tag: "img", classes: [], nthChild: 1, textContent: "/images/hero.jpg" },
      op: "replace-image-src",
      value: { filename: "x.jpg", mimeType: "image/jpeg", dataURL: "data:image/jpeg;base64,AAAA" },
      dry_run: true,
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).reason).toBe("not-implemented");
    // read-only: no public/images dir was created
    const { existsSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    expect(existsSync(pathJoin(root, "public/images"))).toBe(false);
  });
});
