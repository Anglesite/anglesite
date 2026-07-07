import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---\n---\n<article class="card"><slot /></article>\n\n<style>\n  .card { padding: 1rem; }\n</style>\n`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

describe("applyEdit — component-style ops", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a component-style op with no component payload", async () => {
    const response = await applyEdit(tmpDir, { id: "1", path: "x", op: "set-style-property", value: {} });
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("invalid-input");
  });

  it("applies set-style-property and piggybacks a fresh model", async () => {
    const baseVersion = fileVersion(CARD);
    const { indexCssRules } = await import("../server/css-rule-index.mjs");
    const { parse } = await import("@astrojs/compiler");
    const { ast } = await parse(CARD, { position: true });
    const styleEl = ast.children.find((n) => n.type === "element" && n.name === "style");
    const [cardRule] = indexCssRules(styleEl);

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-style-property",
      component: { path: "src/components/Card.astro", baseVersion, ruleSpan: cardRule.span, property: "color", value: "blue" },
    });
    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.model).toBeDefined();
    expect(body.model.styles[0].declarations.some((d) => d.property === "color" && d.value === "blue")).toBe(true);
  });

  it("surfaces stale as a failed reply", async () => {
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-style-property",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", ruleSpan: [0, 1], property: "color", value: "blue" },
    });
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("stale");
  });
});
