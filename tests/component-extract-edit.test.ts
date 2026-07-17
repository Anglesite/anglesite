import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { resolveComponentExtract } from "../server/component-extract-edit.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const HERO = `---
---
<section class="hero">
  <h2 class="title">Welcome</h2>
  <img src="/hero.jpg" alt="Nice photo" />
  <p>Same text</p>
  <p>Same text</p>
</section>
`;

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

async function findTag(source, tag) {
  const { byId, rootId } = await nodeIndex(source);
  const section = byId.get(byId.get(rootId).childIds[0]);
  const node = section.childIds.map((id) => byId.get(id)).find((n) => n.tag === tag);
  return { byId, rootId, section, node };
}

describe("resolveComponentExtract", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cee-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), HERO);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refuses invalid-input with no component payload", async () => {
    const result = await resolveComponentExtract(tmpDir, { op: "extract-component" });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses invalid-input when newName isn't PascalCase", async () => {
    const baseVersion = fileVersion(HERO);
    const { node: h2 } = await findTag(HERO, "h2");
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "cardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses stale when baseVersion doesn't match", async () => {
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion: "sha256:000000000000", nodeId: "n1", newName: "CardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("refuses no-match when nodeId doesn't exist", async () => {
    const baseVersion = fileVersion(HERO);
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: "n999", newName: "CardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("refuses invalid-input when the node is the component's own (synthetic fragment) root", async () => {
    const baseVersion = fileVersion(HERO);
    const { rootId } = await nodeIndex(HERO);
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: rootId, newName: "CardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("allows extracting a top-level element (its parent is the synthetic root, not the root itself)", async () => {
    const baseVersion = fileVersion(HERO);
    const { byId, rootId } = await nodeIndex(HERO);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: section.id, newName: "HeroBlock" },
    });
    expect(result.refused).toBeFalsy();
    expect(result.newFile.path).toBe("src/components/HeroBlock.astro");
  });

  it("refuses already-exists when the target file is already on disk", async () => {
    writeFileSync(join(tmpDir, "src", "components", "CardTitle.astro"), "---\n---\n<h2>x</h2>\n");
    const baseVersion = fileVersion(HERO);
    const { node: h2 } = await findTag(HERO, "h2");
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("already-exists");
  });

  it("refuses invalid-input when newName collides with an existing, unrelated import's local name", async () => {
    const WITH_IMPORT = `---
import CardTitle from "../shared/CardTitle.astro";
---
<section class="hero">
  <h2 class="title">Welcome</h2>
</section>
`;
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), WITH_IMPORT);
    const baseVersion = fileVersion(WITH_IMPORT);
    const { ast } = await parse(WITH_IMPORT, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, WITH_IMPORT);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const h2 = byId.get(section.childIds[0]);

    // Would otherwise append a SECOND `import CardTitle from "./CardTitle.astro";` alongside the
    // existing, unrelated one — a duplicate-declaration syntax error at build time.
    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("extracts the h2 subtree, hoisting its class attr (renamed classValue — reserved word) and its text into string props", async () => {
    const baseVersion = fileVersion(HERO);
    const { node: h2 } = await findTag(HERO, "h2");

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });

    expect(result.refused).toBeFalsy();
    expect(result.extract).toBe(true);
    expect(result.newFile.path).toBe("src/components/CardTitle.astro");
    expect(result.newFile.content).toContain("interface Props");
    // "class" is a reserved word as a destructured shorthand binding — renamed classValue.
    expect(result.newFile.content).toContain("classValue: string");
    expect(result.newFile.content).toContain("text1: string");
    expect(result.newFile.content).toContain("const { classValue, text1 } = Astro.props;");
    expect(result.newFile.content).toContain("<h2 class={classValue}>{text1}</h2>");
    expect(result.newFile.content).not.toContain("Welcome");
  });

  it("does not hoist a value duplicated within the same extracted subtree", async () => {
    const DUPLICATE = `---\n---\n<section><div><p>Same</p><p>Same</p></div></section>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), DUPLICATE);
    const baseVersion = fileVersion(DUPLICATE);
    const { ast } = await parse(DUPLICATE, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, DUPLICATE);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(section.childIds[0]);

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: div.id, newName: "SamePair" },
    });

    expect(result.refused).toBeFalsy();
    // Neither <p>'s "Same" text got hoisted — both occurrences remain literal.
    expect(result.newFile.content).not.toContain("interface Props");
    expect(result.newFile.content).toContain("<p>Same</p><p>Same</p>");
  });

  it("hoists an element's own attrs when it IS the extracted node (src/alt on <img>)", async () => {
    const baseVersion = fileVersion(HERO);
    const { node: img } = await findTag(HERO, "img");

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: img.id, newName: "HeroImage" },
    });

    expect(result.refused).toBeFalsy();
    expect(result.newFile.content).toContain("src: string");
    expect(result.newFile.content).toContain("alt: string");
    expect(result.newFile.content).toContain("<img src={src} alt={alt} />");
  });

  it("replaces the original selection with an instance tag carrying the original literal values as attrs, plus a matching import", async () => {
    const baseVersion = fileVersion(HERO);
    const { node: h2 } = await findTag(HERO, "h2");

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });

    expect(result.original.file).toBe("src/components/Hero.astro");
    expect(result.original.range).toEqual({ start: 0, end: HERO.length });
    expect(result.original.replacement).toContain('import CardTitle from "./CardTitle.astro";');
    expect(result.original.replacement).toContain('<CardTitle classValue="title" text1="Welcome" />');
    expect(result.original.replacement).not.toContain("<h2");
    // Untouched siblings still present.
    expect(result.original.replacement).toContain('<img src="/hero.jpg" alt="Nice photo" />');
  });

  it("synthesizes a frontmatter fence with the import when the source file has none yet", async () => {
    const NO_FM = `<section><h2 class="title">Welcome</h2></section>\n`;
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), NO_FM);
    const baseVersion = fileVersion(NO_FM);
    const { ast } = await parse(NO_FM, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, NO_FM);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const h2 = byId.get(section.childIds[0]);

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });

    expect(result.refused).toBeFalsy();
    expect(result.original.replacement.startsWith("---\nimport CardTitle from")).toBe(true);
  });

  it("extracts a component-kind node (an existing component instance), hoisting its own props too", async () => {
    const WRAPPED = `---
import Badge from "./Badge.astro";
---
<section>
  <div class="wrap">
    <Badge label="New" />
  </div>
</section>
`;
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), WRAPPED);
    writeFileSync(join(tmpDir, "src", "components", "Badge.astro"), "---\ninterface Props { label: string; }\nconst { label } = Astro.props;\n---\n<span>{label}</span>\n");
    const baseVersion = fileVersion(WRAPPED);
    const { ast } = await parse(WRAPPED, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, WRAPPED);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(section.childIds[0]);
    const badge = byId.get(div.childIds[0]);
    expect(badge.kind).toBe("component");

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: badge.id, newName: "BadgeWrap" },
    });

    expect(result.refused).toBeFalsy();
    // The new file gets its OWN import of Badge — without this it would reference an undefined
    // component. Both files live directly in src/components/, so the specifier is unchanged.
    expect(result.newFile.content).toContain('import Badge from "./Badge.astro";');
    expect(result.newFile.content).toContain("label: string");
    expect(result.newFile.content).toContain("<Badge label={label} />");
    expect(result.original.replacement).toContain('<BadgeWrap label="New" />');
  });

  it("carries a bare/aliased import specifier through UNCHANGED rather than mis-rewriting it as a relative path", async () => {
    const WRAPPED = `---
import Icon from "some-astro-lib/Icon.astro";
import Button from "@components/Button.astro";
---
<section>
  <div class="wrap">
    <Icon />
    <Button label="Go" />
  </div>
</section>
`;
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), WRAPPED);
    const baseVersion = fileVersion(WRAPPED);
    const { ast } = await parse(WRAPPED, { position: true });
    const { byId, rootId } = buildTemplateNodeIndex(ast, WRAPPED);
    const section = byId.get(byId.get(rootId).childIds[0]);
    const div = byId.get(section.childIds[0]);

    const result = await resolveComponentExtract(tmpDir, {
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: div.id, newName: "IconButtonWrap" },
    });

    expect(result.refused).toBeFalsy();
    // Bare package specifier and tsconfig path alias both pass through verbatim — rewriting them
    // through dirname(relPath) as if they were relative paths would point nowhere.
    expect(result.newFile.content).toContain('import Icon from "some-astro-lib/Icon.astro";');
    expect(result.newFile.content).toContain('import Button from "@components/Button.astro";');
  });
});
