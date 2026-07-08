import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveComponentStyle } from "../server/component-style-edit.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---
interface Props { title: string; }
---
<article class="card">
  <h2>{title}</h2>
</article>

<style>
  .card { padding: 1rem; color: red; }
  @media (max-width: 600px) {
    .card { padding: 0.5rem; }
  }
</style>
`;

describe("resolveComponentStyle", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cse-"));
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

  it("refuses with stale when baseVersion does not match", async () => {
    const edit = { op: "set-style-property", component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", ruleSpan: [0, 1], property: "color", value: "blue" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("refuses with read-failed (not no-match) when the file can't be read", async () => {
    const edit = { op: "set-style-property", component: { path: "src/components/Missing.astro", baseVersion: "sha256:000000000000", ruleSpan: [0, 1], property: "color", value: "blue" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(result.refused).toBe(true);
    // Distinct from "no-match" (a rule span that doesn't resolve within a file that
    // DID read and parse successfully) — matches buildComponentModel's ComponentModelError
    // reason for the same failure mode on the same file.
    expect(result.reason).toBe("read-failed");
  });

  it("set-style-property updates an existing declaration in place", async () => {
    const baseVersion = fileVersion(CARD);
    // Recompute the real span via the resolver's own indexing to avoid hand-counting offsets:
    const { indexCssRules } = await import("../server/css-rule-index.mjs");
    const { parse } = await import("@astrojs/compiler");
    const { ast } = await parse(CARD, { position: true });
    const styleEl = ast.children.find((n) => n.type === "element" && n.name === "style");
    const [cardRule] = indexCssRules(styleEl);

    const edit = { op: "set-style-property", component: { path: "src/components/Card.astro", baseVersion, ruleSpan: cardRule.span, property: "color", value: "blue" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(result.refused).toBeFalsy();
    expect(apply(result)).toContain("color: blue");
    expect(apply(result)).not.toContain("color: red");
  });

  it("set-style-property inserts a new declaration when the property is absent", async () => {
    const baseVersion = fileVersion(CARD);
    const { indexCssRules } = await import("../server/css-rule-index.mjs");
    const { parse } = await import("@astrojs/compiler");
    const { ast } = await parse(CARD, { position: true });
    const styleEl = ast.children.find((n) => n.type === "element" && n.name === "style");
    const [cardRule] = indexCssRules(styleEl);

    const edit = { op: "set-style-property", component: { path: "src/components/Card.astro", baseVersion, ruleSpan: cardRule.span, property: "margin", value: "0" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(apply(result)).toMatch(/margin: 0;\s*}/);
  });

  it("remove-style-property deletes the declaration and its semicolon", async () => {
    const baseVersion = fileVersion(CARD);
    const { indexCssRules } = await import("../server/css-rule-index.mjs");
    const { parse } = await import("@astrojs/compiler");
    const { ast } = await parse(CARD, { position: true });
    const styleEl = ast.children.find((n) => n.type === "element" && n.name === "style");
    const [cardRule] = indexCssRules(styleEl);

    const edit = { op: "remove-style-property", component: { path: "src/components/Card.astro", baseVersion, ruleSpan: cardRule.span, property: "color" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(apply(result)).not.toContain("color");
    expect(apply(result)).toContain("padding: 1rem");
  });

  it("set-rule-selector renames only the prelude", async () => {
    const baseVersion = fileVersion(CARD);
    const { indexCssRules } = await import("../server/css-rule-index.mjs");
    const { parse } = await import("@astrojs/compiler");
    const { ast } = await parse(CARD, { position: true });
    const styleEl = ast.children.find((n) => n.type === "element" && n.name === "style");
    const [cardRule] = indexCssRules(styleEl);

    const edit = { op: "set-rule-selector", component: { path: "src/components/Card.astro", baseVersion, ruleSpan: cardRule.span, selector: ".card--big" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(apply(result)).toContain(".card--big {");
    expect(apply(result)).toContain("padding: 1rem");
  });

  it("add-style-rule appends a new rule before the closing </style>", async () => {
    const baseVersion = fileVersion(CARD);
    const edit = { op: "add-style-rule", component: { path: "src/components/Card.astro", baseVersion, selector: "h2", declarations: [{ property: "font-weight", value: "bold" }] } };
    const result = await resolveComponentStyle(tmpDir, edit);
    const next = apply(result);
    expect(next).toMatch(/h2\s*{\s*font-weight: bold;\s*}/);
    expect(next.indexOf("h2 {")).toBeGreaterThan(next.indexOf(".card {"));
  });

  it("add-style-rule creates a <style> block when none exists", async () => {
    const noStyle = `---\n---\n<article class="card"><slot /></article>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), noStyle);
    const baseVersion = fileVersion(noStyle);
    const edit = { op: "add-style-rule", component: { path: "src/components/Card.astro", baseVersion, selector: ".card", declarations: [{ property: "padding", value: "1rem" }] } };
    const result = await resolveComponentStyle(tmpDir, edit);
    const next = apply(result);
    expect(next).toContain("<style>");
    expect(next).toMatch(/\.card\s*{\s*padding: 1rem;\s*}/);
  });

  it("add-style-rule appends inside an existing but empty <style></style> block", async () => {
    const emptyStyle = `---\n---\n<article class="card"><slot /></article>\n\n<style></style>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), emptyStyle);
    const baseVersion = fileVersion(emptyStyle);
    const edit = { op: "add-style-rule", component: { path: "src/components/Card.astro", baseVersion, selector: ".card", declarations: [{ property: "padding", value: "1rem" }] } };
    const result = await resolveComponentStyle(tmpDir, edit);
    const next = apply(result);
    // The new rule must land inside the <style> tags, not after them.
    expect(next.indexOf(".card {")).toBeGreaterThan(next.indexOf("<style>"));
    expect(next.indexOf(".card {")).toBeLessThan(next.indexOf("</style>"));
    expect(next).toMatch(/\.card\s*{\s*padding: 1rem;\s*}/);
  });

  it("refuses no-match when the rule span no longer exists", async () => {
    const baseVersion = fileVersion(CARD);
    const edit = { op: "set-style-property", component: { path: "src/components/Card.astro", baseVersion, ruleSpan: [9999, 10010], property: "color", value: "blue" } };
    const result = await resolveComponentStyle(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });
});
