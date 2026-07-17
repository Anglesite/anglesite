import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "@astrojs/compiler";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { fileVersion } from "../server/file-version.mjs";

const PAGE = `---\ninterface Props { title: string; }\nconst { title } = Astro.props;\n---\n<main>\n  <div class="hero">\n    <h1>{title}</h1>\n  </div>\n</main>\n`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

async function nodeIndex(source) {
  const { ast } = await parse(source, { position: true });
  return buildTemplateNodeIndex(ast, source);
}

describe("applyEdit — extract-component", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-ext-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function findDiv() {
    const { byId, rootId } = await nodeIndex(PAGE);
    const main = byId.get(byId.get(rootId).childIds[0]);
    return byId.get(main.childIds[0]);
  }

  it("writes both files, commits once, and returns componentPath/hoistedProps/warnings in result", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.result.componentPath).toBe("src/components/Hero.astro");
    expect(body.result.hoistedProps).toEqual(["title"]);
    expect(body.result.warnings).toEqual([]);
    expect(body.model).toBeDefined();
    expect(body.model.path).toBe("src/components/Page.astro");

    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(true);
    const newFileOnDisk = readFileSync(join(tmpDir, "src", "components", "Hero.astro"), "utf-8");
    expect(newFileOnDisk).toContain("<h1>{title}</h1>");
    const originalOnDisk = readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8");
    expect(originalOnDisk).toContain("<Hero title={title} />");
  });

  it("refuses exists without writing anything when newComponentPath is already taken", async () => {
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), "<p>taken</p>\n");
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("exists");
    const originalOnDisk = readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8");
    expect(originalOnDisk).toBe(PAGE); // untouched
  });

  it("dry_run returns both previews and writes neither file", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
      dry_run: true,
    });

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-preview");
    expect(body.newFile.path).toBe("src/components/Hero.astro");
    expect(body.newFile.after).toContain("<h1>{title}</h1>");
    expect(body.after).toContain("<Hero title={title} />");
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
    expect(readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8")).toBe(PAGE);
  });

  it("commits both files in one hidden-branch commit and undo_edit reverts both", async () => {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "--initial-branch=main", tmpDir], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpDir, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", tmpDir, "config", "user.name", "T"]);
    execFileSync("git", ["-C", tmpDir, "add", "-A"]);
    execFileSync("git", ["-C", tmpDir, "commit", "-m", "initial"]);

    const { recordEdit } = await import("../server/edit-history.mjs");
    const { undoEdit } = await import("../server/undo-edit.mjs");
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const response = await applyEdit(
      tmpDir,
      {
        id: "1",
        path: "src/components/Page.astro",
        op: "extract-component",
        component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
      },
      { onApplied: ({ file, range, newFile }) => recordEdit(tmpDir, { file, range, newFile, message: `extract ${file}` }) },
    );
    const body = parseContent(response);
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(true);

    const undone = await undoEdit(tmpDir, {});
    expect(undone.status).toBe("undone");
    expect(readFileSync(join(tmpDir, "src", "components", "Page.astro"), "utf-8")).toBe(PAGE);
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
  });

  it("re-checks staleness after the resolver's async gap, refusing a concurrent write race", async () => {
    const baseVersion = fileVersion(PAGE);
    const div = await findDiv();

    const editPromise = applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion, nodeId: div.id, newComponentPath: "src/components/Hero.astro" },
    });

    writeFileSync(join(tmpDir, "src", "components", "Page.astro"), PAGE.replace("Welcome", "Renamed").replace("{title}", "{title} "));

    const response = await editPromise;
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("stale");
    expect(existsSync(join(tmpDir, "src", "components", "Hero.astro"))).toBe(false);
  });
});
