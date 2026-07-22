import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---\n---\n<article class="card"><h2>Title</h2></article>\n`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("applyEdit — component-structure ops", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-cs-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a component-structure op with no component payload", async () => {
    const response = await applyEdit(tmpDir, { id: "1", path: "x", op: "set-attr" });
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("invalid-input");
  });

  it("applies set-attr end to end and piggybacks a fresh model", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-attr",
      component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "class", value: "card--big" },
    });
    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    const onDisk = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
    expect(onDisk).toContain('class="card--big"');
    expect(body.model).toBeDefined();
    expect(body.model.template.children[0].attrs).toContainEqual({ name: "class", value: "card--big" });
  });

  it("surfaces stale as a failed reply", async () => {
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-attr",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", nodeId: "n1", name: "class", value: "x" },
    });
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("stale");
  });

  it("re-checks staleness after the resolver's async gap, refusing a concurrent write race", async () => {
    const baseVersion = fileVersion(CARD);
    const { byId, rootId } = await nodeIndex(CARD);
    const article = byId.get(byId.get(rootId).childIds[0]);

    const editPromise = applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-attr",
      component: { path: "src/components/Card.astro", baseVersion, nodeId: article.id, name: "class", value: "card--big" },
    });

    // Simulate a second edit landing while this one is suspended at
    // resolveComponentStructure's `await parse(...)` — mirrors the equivalent
    // component-style race test.
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD.replace("Title", "Renamed"));

    const response = await editPromise;
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("stale");

    const onDisk = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
    expect(onDisk).toContain("Renamed");
  });
});
