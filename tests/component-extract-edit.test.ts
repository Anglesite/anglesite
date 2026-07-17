// tests/component-extract-edit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { resolveComponentExtract } from "../server/component-extract-edit.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const PAGE = `---\n---\n<main>\n  <div class="hero">\n    <h1>Welcome</h1>\n  </div>\n</main>\n`;

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("resolveComponentExtract — core", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cee-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refuses invalid-input with no component payload", async () => {
    const result = await resolveComponentExtract(tmpDir, { op: "extract-component" });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses stale when baseVersion does not match", async () => {
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion: "sha256:000000000000", nodeId: "n1", newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("refuses invalid-input for newComponentPath outside src/components/", async () => {
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/pages/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses invalid-input when extracting the component's root", async () => {
    const baseVersion = fileVersion(PAGE);
    const { rootId } = await nodeIndex(PAGE);
    // rootId IS a real byId entry (the synthetic fragment root, parentId: null) — resolveComponentExtract's
    // parentId === null check refuses it as invalid-input, same as remove-node's "cannot remove the
    // component's root" rule. Extracting a real top-level node like <main> is unaffected by this check
    // (its own parentId is rootId, not null) — already exercised by the "extracts a subtree..." test below,
    // which extracts the doubly-nested <div>.
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: rootId, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses no-match when the nodeId no longer exists", async () => {
    const baseVersion = fileVersion(PAGE);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: "n999", newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("refuses exists when newComponentPath already has a file on disk", async () => {
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), "<p>taken</p>\n");
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("exists");
  });

  it("extracts a subtree with no outer references into a new file and leaves a self-closing instance behind", async () => {
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(result.newFile.path).toBe("src/components/Hero.astro");
    expect(result.newFile.content).toContain('<div class="hero">');
    expect(result.newFile.content).toContain("<h1>Welcome</h1>");
    expect(result.hoistedProps).toEqual([]);
    expect(result.warnings).toEqual([]);

    const next = result.replacement; // whole-file rewrite: range covers [0, source.length]
    expect(result.range).toEqual({ start: 0, end: PAGE.length });
    expect(next).toContain("<Hero />");
    expect(next).not.toContain('<div class="hero">');
    expect(next).toMatch(/import Hero from "\.\/Hero\.astro";/);

    // PAGE's frontmatter is the minimal empty-body, adjacent-fence shape ("---\n---\n"). A prior
    // regex-based frontmatter detector failed to match this shape and prepended a second
    // frontmatter block, leaving a stray "---\n---\n" text node when re-parsed. Guard against
    // regressions by re-parsing the rewritten source and asserting exactly one frontmatter node
    // AND that no stray text nodes contain "---" (which would indicate corruption).
    const { ast: nextAst } = await parse(next, { position: true });
    expect(nextAst.children.filter((n) => n.type === "frontmatter")).toHaveLength(1);
    expect(nextAst.children.some((n) => n.type === "text" && n.value.includes("---"))).toBe(false);
  });

  it("refuses invalid-input when newComponentPath's basename is not capitalized", async () => {
    const baseVersion = fileVersion(PAGE);
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses invalid-input for a text-kind node", async () => {
    const source = `---\n---\n<p>plain text</p>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const p = byId.get(byId.get(rootId).childIds[0]);
    const textNode = byId.get(p.childIds[0]);
    expect(textNode.kind).toBe("text");
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: textNode.id, newComponentPath: "src/components/Hero.astro" } };
    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });
});
