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

  it("hoists a bare-identifier attribute expression that is one of the original's own Props", async () => {
    const source = `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero" data-label={title}>\n    <h1>Static</h1>\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(result.hoistedProps).toEqual(["title"]);
    expect(result.newFile.content).toContain("interface Props {\n  title: string;\n}");
    expect(result.newFile.content).toContain("const { title } = Astro.props;");
    expect(result.replacement).toContain("<Hero title={title} />");
  });

  it("hoists a bare-identifier text-content expression that is one of the original's own Props", async () => {
    const source = `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title}</h1>\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.hoistedProps).toEqual(["title"]);
    expect(result.newFile.content).toContain("<h1>{title}</h1>");
  });

  it("does not hoist a bare identifier that is not one of the original's own Props", async () => {
    const source = `---\nconst label = "computed";\n---\n<main>\n  <div class="hero">\n    <h1>{label}</h1>\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.hoistedProps).toEqual([]);
    expect(result.newFile.content).toContain("<h1>{label}</h1>"); // left in place, unhoisted
    expect(result.newFile.content).not.toContain("interface Props");
  });

  it("does not hoist a non-bare-identifier expression even when it references an original Prop", async () => {
    const source = `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title.toUpperCase()}</h1>\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.hoistedProps).toEqual([]);
    expect(result.newFile.content).toContain("<h1>{title.toUpperCase()}</h1>");
  });

  it("dedups the same identifier referenced twice into one hoisted prop", async () => {
    const source = `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero" data-label={title}>\n    <h1>{title}</h1>\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.hoistedProps).toEqual(["title"]);
    expect(result.replacement.match(/title=\{title\}/g)).toHaveLength(1); // one instance attr, not two
  });

  it("copies a nested component's import into the new file, re-based to its directory, and prunes it from the original when unused elsewhere", async () => {
    const source = `---\nimport Badge from "./Badge.astro";\n---\n<main>\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/);
    expect(result.newFile.content).toContain("<Badge />");
    expect(result.replacement).not.toContain("import Badge"); // pruned — no longer used in the original
    expect(result.replacement).toMatch(/import Hero from "\.\/Hero\.astro";/);
  });

  it("keeps a nested component's import in the original when it's also used outside the extracted subtree", async () => {
    const source = `---\nimport Badge from "./Badge.astro";\n---\n<main>\n  <Badge />\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[1]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.replacement).toMatch(/import Badge from "\.\/Badge\.astro";/); // still needed for the sibling <Badge />
    expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/); // also copied — extracted one still needs it
  });

  it("re-bases a nested component's relative import specifier for a new file in a different directory", async () => {
    mkdirSync(join(tmpDir, "src", "components", "sections"), { recursive: true });
    const source = `---\nimport Badge from "../Badge.astro";\n---\n<main>\n  <div class="hero">\n    <Badge />\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "sections", "Page.astro"), source);
    writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/sections/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    // Hero.astro lives directly under src/components/, so its import of Badge.astro (a sibling) is "./Badge.astro",
    // not the "../Badge.astro" that was correct from sections/Page.astro's own directory.
    expect(result.newFile.content).toMatch(/import Badge from "\.\/Badge\.astro";/);
  });

  it("dedups a repeated nested-component import when the same component appears multiple times in the extracted subtree", async () => {
    const source = `---\nimport Badge from "./Badge.astro";\n---\n<main>\n  <div class="hero">\n    <Badge />\n    <Badge />\n  </div>\n</main>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "<span>Badge</span>\n");
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    // The import line should appear exactly once, not twice
    const importMatches = result.newFile.content.match(/import Badge from "\.\/Badge\.astro";/g);
    expect(importMatches).toHaveLength(1);
    // But both <Badge /> usages should still be in the extracted markup
    const badgeUsages = result.newFile.content.match(/<Badge \/>/g);
    expect(badgeUsages).toHaveLength(2);
  });

  it("moves a simple-selector rule that only targets nodes inside the extracted subtree", async () => {
    const source = `---\n---\n<main>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero {\n    color: blue;\n  }\n</style>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.warnings).toEqual([]);
    expect(result.newFile.content).toContain(".hero {\n    color: blue;\n  }");
    expect(result.replacement).not.toContain("color: blue");
    // The rule's own text is gone, but removeMovedRules only strips the {...} block it matched —
    // it does not clean up a now-empty surrounding <style></style> shell (documented limitation,
    // see the note under Step 3 below). Assert the shell is empty rather than asserting it's gone.
    expect(result.replacement).toMatch(/<style>\s*<\/style>/);
  });

  it("keeps a simple-selector rule in the original and reports a warning when it's also used outside the extracted subtree", async () => {
    const source = `---\n---\n<main>\n  <p class="hero">Outside</p>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero {\n    color: blue;\n  }\n</style>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[1]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.warnings).toEqual([".hero not moved: also used outside the extracted markup"]);
    expect(result.replacement).toContain("color: blue"); // stays in the original
    expect(result.newFile.content).not.toContain("<style>");
  });

  it("keeps a complex-selector rule in the original and reports a warning", async () => {
    const source = `---\n---\n<main>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  .hero > h1 {\n    color: blue;\n  }\n</style>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[0]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    // css-tree's generate() (used by indexCssRules, out of scope for this task) normalizes
    // combinator whitespace away — ".hero > h1" round-trips as ".hero>h1", not the
    // source-literal spacing. The warning text is built from that already-normalized
    // rule.selector, so it reflects the normalized form too.
    expect(result.warnings).toEqual([".hero>h1 not moved: selector too complex to analyze automatically"]);
    expect(result.replacement).toContain("color: blue");
  });

  it("splits a media-query block when only some of its rules move", async () => {
    const source = `---\n---\n<main>\n  <p class="kept">Kept</p>\n  <div class="hero">\n    <h1>Hi</h1>\n  </div>\n</main>\n<style>\n  @media (min-width: 40em) {\n    .hero {\n      color: blue;\n    }\n    .kept {\n      color: red;\n    }\n  }\n</style>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), source);
    const baseVersion = fileVersion(source);
    const { byId, rootId } = await nodeIndex(source);
    const main = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(main.childIds[1]);
    const edit = { op: "extract-component", component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" } };

    const result = await resolveComponentExtract(tmpDir, edit);
    expect(result.warnings).toEqual([]);
    expect(result.newFile.content).toMatch(/@media \(min-width: 40em\)[\s\S]*\.hero[\s\S]*color: blue/);
    expect(result.replacement).toMatch(/@media \(min-width: 40em\)[\s\S]*\.kept[\s\S]*color: red/);
    expect(result.replacement).not.toContain(".hero");
  });
});
