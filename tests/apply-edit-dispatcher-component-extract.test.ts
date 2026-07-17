import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse } from "@astrojs/compiler";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { buildTemplateNodeIndex } from "../server/component-node-index.mjs";
import { recordEdit } from "../server/edit-history.mjs";
import { undoEdit } from "../server/undo-edit.mjs";
import { fileVersion } from "../server/file-version.mjs";

const HERO = `---
---
<section class="hero">
  <h2 class="title">Welcome</h2>
  <img src="/hero.jpg" alt="Nice photo" />
</section>
`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

async function findTag(source, tag) {
  const { ast } = await parse(source, { position: true });
  const { byId, rootId } = buildTemplateNodeIndex(ast, source);
  const section = byId.get(byId.get(rootId).childIds[0]);
  const node = section.childIds.map((id) => byId.get(id)).find((n) => n.tag === tag);
  return node;
}

describe("applyEdit — extract-component (no git repo)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-ce-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Hero.astro"), HERO);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects extract-component with no component payload", async () => {
    const response = await applyEdit(tmpDir, { id: "1", path: "x", op: "extract-component" });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("invalid-input");
  });

  it("writes BOTH files' on-disk content and reports newFile, with no onApplied hook (no commit)", async () => {
    const baseVersion = fileVersion(HERO);
    const h2 = await findTag(HERO, "h2");

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Hero.astro",
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.file).toBe("src/components/Hero.astro");
    expect(body.newFile).toBe("src/components/CardTitle.astro");
    expect(body.commit).toBeUndefined();
    expect(body.model).toBeDefined();

    const newFileOnDisk = readFileSync(join(tmpDir, "src/components/CardTitle.astro"), "utf-8");
    expect(newFileOnDisk).toContain("interface Props");
    expect(newFileOnDisk).toContain("classValue: string");
    expect(newFileOnDisk).toContain("text1: string");

    const originalOnDisk = readFileSync(join(tmpDir, "src/components/Hero.astro"), "utf-8");
    expect(originalOnDisk).toContain('import CardTitle from "./CardTitle.astro";');
    expect(originalOnDisk).toContain('<CardTitle classValue="title" text1="Welcome" />');
    expect(originalOnDisk).not.toContain("<h2");
    // The refetched model reflects the NEW state of the source file (the instance, not the h2).
    expect(body.model.path).toBe("src/components/Hero.astro");
  });

  it("surfaces stale as a failed reply and touches neither file", async () => {
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Hero.astro",
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion: "sha256:000000000000", nodeId: "n1", newName: "CardTitle" },
    });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("stale");
    expect(existsSync(join(tmpDir, "src/components/CardTitle.astro"))).toBe(false);
    expect(readFileSync(join(tmpDir, "src/components/Hero.astro"), "utf-8")).toBe(HERO);
  });

  it("refuses already-exists and writes nothing when the target file appears between resolve and write", async () => {
    const baseVersion = fileVersion(HERO);
    const h2 = await findTag(HERO, "h2");
    // Simulate the race the dispatcher's own pre-write existsSync re-check guards: the resolver
    // saw no file, but by the time applyExtractComponent runs its own check, one exists.
    // (In a single-threaded test this just means: the file is already there before the call.)
    writeFileSync(join(tmpDir, "src/components/CardTitle.astro"), "---\n---\n<p>taken</p>\n");

    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Hero.astro",
      op: "extract-component",
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("already-exists");
    // Pre-existing file is untouched, and the original source file is untouched too.
    expect(readFileSync(join(tmpDir, "src/components/CardTitle.astro"), "utf-8")).toBe("---\n---\n<p>taken</p>\n");
    expect(readFileSync(join(tmpDir, "src/components/Hero.astro"), "utf-8")).toBe(HERO);
  });

  it("rejects dry_run with not-implemented and touches no file", async () => {
    const baseVersion = fileVersion(HERO);
    const h2 = await findTag(HERO, "h2");
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Hero.astro",
      op: "extract-component",
      dry_run: true,
      component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
    });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("not-implemented");
    expect(existsSync(join(tmpDir, "src/components/CardTitle.astro"))).toBe(false);
  });

  it("rolls back the new file if the second (source-patch) write fails", async () => {
    // Put the SOURCE component in its own subdirectory, separate from src/components/ (where
    // the new file always lands per component-extract-edit.mjs's fixed `src/components/<newName>
    // .astro` convention) — that lets this test chmod ONLY the source's directory read-only,
    // isolating a second-write failure from the first write (which lands in a still-writable
    // directory) instead of failing both writes at once.
    rmSync(join(tmpDir, "src/components/Hero.astro"));
    mkdirSync(join(tmpDir, "src/components/nested"), { recursive: true });
    writeFileSync(join(tmpDir, "src/components/nested/Hero.astro"), HERO);

    const baseVersion = fileVersion(HERO);
    const h2 = await findTag(HERO, "h2");
    const nestedDir = join(tmpDir, "src/components/nested");
    const originalMode = statSync(nestedDir).mode;
    chmodSync(nestedDir, 0o555);
    try {
      const response = await applyEdit(tmpDir, {
        id: "1",
        path: "src/components/nested/Hero.astro",
        op: "extract-component",
        component: { path: "src/components/nested/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
      });
      expect(response.isError).toBe(true);
      expect(parseContent(response).reason).toBe("write-failed");
    } finally {
      chmodSync(nestedDir, originalMode);
    }
    // The new file's write succeeded first, then got rolled back when the source patch failed —
    // proving a failed extract never leaves an orphaned new component with no source reference.
    expect(existsSync(join(tmpDir, "src/components/CardTitle.astro"))).toBe(false);
    expect(readFileSync(join(tmpDir, "src/components/nested/Hero.astro"), "utf-8")).toBe(HERO);
  });
});

describe("applyEdit — extract-component (real git repo: commit + undo)", () => {
  let repo;

  function git(args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "anglesite-aed-ce-git-"));
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    mkdirSync(join(repo, "src", "components"), { recursive: true });
    writeFileSync(join(repo, "src/components/Hero.astro"), HERO);
    git(["add", "."]);
    git(["commit", "-q", "-m", "initial"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("commits both files onto ONE anglesite/edits commit, and a single undo_edit call reverts the whole extraction", async () => {
    const baseVersion = fileVersion(HERO);
    const h2 = await findTag(HERO, "h2");

    const response = await applyEdit(
      repo,
      {
        id: "1",
        path: "src/components/Hero.astro",
        op: "extract-component",
        component: { path: "src/components/Hero.astro", baseVersion, nodeId: h2.id, newName: "CardTitle" },
      },
      {
        onApplied: ({ file, range, files, message }) =>
          files
            ? recordEdit(repo, { files, message })
            : recordEdit(repo, { file, range, message: `anglesite: edit ${file}` }),
      },
    );

    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);

    // Exactly one commit was created for this op — parents has [sha, oneParent].
    const parents = git(["rev-list", "--parents", "-n", "1", body.commit]).split(/\s+/);
    expect(parents).toHaveLength(2);
    expect(git(["show", `${body.commit}:src/components/CardTitle.astro`])).toContain("interface Props");
    expect(git(["show", `${body.commit}:src/components/Hero.astro`])).toContain("<CardTitle");

    const undone = await undoEdit(repo, {});
    expect(undone.status).toBe("undone");
    expect(existsSync(join(repo, "src/components/CardTitle.astro"))).toBe(false);
    expect(readFileSync(join(repo, "src/components/Hero.astro"), "utf-8")).toBe(HERO);
  });
});
