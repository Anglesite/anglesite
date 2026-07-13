import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { resolveComponentStructure } from "../server/component-structure-edit.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---
interface Props { title: string; }
---
<article class="card" data-size="lg">
  <h2>{title}</h2>
</article>
`;

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("resolveComponentStructure — set-attr", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cse2-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function apply(resolution) {
    const source = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
    return source.slice(0, resolution.range.start) + resolution.replacement + source.slice(resolution.range.end);
  }

  it("refuses invalid-input with no component payload", async () => {
    const result = await resolveComponentStructure(tmpDir, { op: "set-attr" });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses stale when baseVersion does not match", async () => {
    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", nodeId: "n1", name: "class", value: "x" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("replaces an existing attribute's value in place", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "class", value: "card--big" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(apply(result)).toContain('class="card--big"');
    expect(apply(result)).toContain('data-size="lg"');
  });

  it("adds a new attribute when absent", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "id", value: "hero-card" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(apply(result)).toMatch(/<article class="card" data-size="lg" id="hero-card">/);
  });

  it("removes an attribute when value is null", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "data-size", value: null } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(apply(result)).not.toContain("data-size");
    expect(apply(result)).toContain('class="card"');
  });

  it("refuses no-match when the nodeId no longer exists", async () => {
    const baseVersion = fileVersion(CARD);
    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: "n999", name: "class", value: "x" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("escapes double quotes and ampersands in an attribute value", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const edit = {
      op: "set-attr",
      component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "title", value: 'Say "hi" to us & co' },
    };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result);

    // Re-parse the patched source and confirm exactly one "title" attribute exists
    // (an unescaped quote would break out of the attribute and produce phantom
    // extra attributes instead), and that its unescaped value round-trips.
    const { ast } = await parse(next, { position: true });
    const { byId: nextById, rootId: nextRootId } = buildTemplateNodeIndex(ast, next);
    const nextArticle = nextById.get(nextById.get(nextRootId).childIds[0]);
    const titleAttrs = nextArticle.attrs.filter((a) => a.name === "title");
    expect(titleAttrs).toHaveLength(1);
    expect(titleAttrs[0].value).toBe('Say "hi" to us & co');
  });

  it("removes an attribute from a one-per-line-formatted tag without leaving a blank line", async () => {
    const multiline = `---\n---\n<article\n  class="card"\n  data-size="lg"\n  id="hero"\n>\n  <h2>title</h2>\n</article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), multiline);
    const baseVersion = fileVersion(multiline);
    const { byId, rootId } = await nodeIndex(multiline);
    const article = byId.get(byId.get(rootId).childIds[0]);

    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "data-size", value: null } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result);

    expect(next).not.toContain("data-size");
    // Exclude the final split segment: it's the empty string after the file's own
    // trailing newline, not a blank line the removal introduced.
    const lines = next.split("\n");
    expect(lines.slice(0, -1).some((line) => line.trim() === "")).toBe(false);
    expect(next).toContain('  class="card"\n  id="hero"');
  });

  it("adds an attribute to an element with no existing attributes", async () => {
    const bare = `---\n---\n<article><p></p></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), bare);
    const baseVersion = fileVersion(bare);
    const { byId, rootId } = await nodeIndex(bare);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const p = byId.get(article.childIds[0]);

    const edit = { op: "set-attr", component: { path: "src/components/Card.astro", baseVersion, nodeId: p.id, name: "class", value: "lead" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    const source = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
    const next = source.slice(0, result.range.start) + result.replacement + source.slice(result.range.end);
    expect(next).toContain('<p class="lead"></p>');
  });
});

describe("resolveComponentStructure — remove-node", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cse3-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function apply(resolution, before) {
    return before.slice(0, resolution.range.start) + resolution.replacement + before.slice(resolution.range.end);
  }

  it("removes a plain element subtree", async () => {
    const src = `---\n---\n<article><h2>Title</h2><p>Body</p></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const p = byId.get(article.childIds[1]);

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: p.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    const next = apply(result, src);
    expect(next).not.toContain("Body");
    expect(next).toContain("<h2>Title</h2>");
  });

  it("removing the last usage of a component prunes its import", async () => {
    const src = `---\nimport Badge from "./Badge.astro";\n---\n<article><Badge label="new" /></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const badge = byId.get(article.childIds[0]);

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: badge.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    const next = apply(result, src);
    expect(next).not.toContain("Badge");
    expect(next).not.toContain("import Badge");
  });

  it("keeps the import when another usage remains", async () => {
    const src = `---\nimport Badge from "./Badge.astro";\n---\n<article><Badge label="a" /><Badge label="b" /></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const article = byId.get(byId.get(rootId).childIds[0]);
    const firstBadge = byId.get(article.childIds[0]);

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: firstBadge.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    const next = apply(result, src);
    expect(next).toContain("import Badge");
    expect(next).toContain('label="b"');
    expect(next).not.toContain('label="a"');
  });

  it("refuses no-match for an unknown nodeId", async () => {
    const src = `---\n---\n<article></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: "n999" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("refuses invalid-input when trying to remove the fragment root", async () => {
    const src = `---\n---\n<article></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: "n0" } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("removes an expression node as a single opaque unit (spec §2.2: move/remove as a unit only)", async () => {
    const src = `---\n---\n<ul>{items.map((i) => (<li>{i}</li>))}</ul>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const ul = byId.get(byId.get(rootId).childIds[0]);
    const expr = byId.get(ul.childIds[0]);
    expect(expr.kind).toBe("expression");

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: expr.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    const next = apply(result, src);
    // The whole {items.map(...)} block is gone in one piece — not just the <li> JSX inside it.
    expect(next).not.toContain("items.map");
    expect(next).not.toContain("<li>");
    expect(next).toContain("<ul></ul>");
  });

  it("correctly removes the target expression node when Unicode precedes it, without touching a different expression", async () => {
    const src = `---\n---\n<p>🎉 emoji {first} then {second}</p>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const p = byId.get(byId.get(rootId).childIds[0]);
    const firstExpr = byId.get(p.childIds.find((id) => byId.get(id).kind === "expression"));

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: firstExpr.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result, src);
    expect(next).not.toContain("{first}");
    expect(next).toContain("{second}");
  });

  it("correctly removes a plain element when Unicode precedes it, without corrupting a later sibling", async () => {
    const src = `---\n---\n<div>🎉 emoji before <p>Body</p><span>Keep</span></div>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const div = byId.get(byId.get(rootId).childIds[0]);
    const p = byId.get(div.childIds.find((id) => byId.get(id).tag === "p"));

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: p.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result, src);
    expect(next).not.toContain("Body");
    expect(next).toContain("<span>Keep</span>");
    const { ast } = await parse(next, { position: true });
    expect(ast).toBeDefined(); // re-parses cleanly, no tag-soup corruption
  });

  it("does not confuse a nested same-tag descendant with a later top-level sibling", async () => {
    const src = `---\n---\n<div><div>Inner</div></div><div>Target</div>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const topLevelDivs = byId.get(rootId).childIds.map((id) => byId.get(id));
    const targetDiv = topLevelDivs[1]; // the second top-level <div>, containing "Target"

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: targetDiv.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result, src);
    expect(next).not.toContain("Target");
    expect(next).toContain("Inner");
  });

  it("does not confuse a nested expression with a sibling expression at a shallower depth", async () => {
    const src = `---\n---\n<div>{a}<span>{b}</span></div>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), src);
    const baseVersion = fileVersion(src);
    const { byId, rootId } = await nodeIndex(src);
    const div = byId.get(byId.get(rootId).childIds[0]);
    const span = byId.get(div.childIds.find((id) => byId.get(id).tag === "span"));
    const bExpr = byId.get(span.childIds.find((id) => byId.get(id).kind === "expression"));

    const edit = { op: "remove-node", component: { path: "src/components/Card.astro", baseVersion, nodeId: bExpr.id } };
    const result = await resolveComponentStructure(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    const next = apply(result, src);
    expect(next).not.toContain("{b}");
    expect(next).toContain("{a}");
  });
});
