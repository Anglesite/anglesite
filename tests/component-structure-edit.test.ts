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
