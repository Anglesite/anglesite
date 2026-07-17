import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordEdit } from "../server/edit-history.mjs";
import { undoEdit } from "../server/undo-edit.mjs";

let repo;

function git(args) {
  return execFileSync("git", args, {
    cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo() {
  repo = mkdtempSync(join(tmpdir(), "undo-edit-"));
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(join(repo, "about.md"), "original\n");
  git(["add", "about.md"]);
  git(["commit", "-m", "initial"]);
}

beforeEach(initRepo);
afterEach(() => repo && rmSync(repo, { recursive: true, force: true }));

describe("undoEdit", () => {
  it("rewinds the most-recent edit and advances the branch with a new commit", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    const editSha = await recordEdit(repo, {
      file: "about.md", range: { start: 0, end: 7 }, message: "edit about.md",
    });
    expect(editSha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(["rev-parse", "refs/heads/anglesite/edits"])).toBe(editSha);

    const result = await undoEdit(repo, {});
    expect(result.status).toBe("undone");
    expect(result.newCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.newCommit).not.toBe(editSha);

    expect(readFileSync(join(repo, "about.md"), "utf-8")).toBe("original\n");

    expect(git(["rev-parse", "refs/heads/anglesite/edits"])).toBe(result.newCommit);
    const newTree = git(["rev-parse", `${result.newCommit}^{tree}`]);
    const editTree = git(["rev-parse", `${editSha}^^{tree}`]);
    expect(newTree).toBe(editTree);

    const parent = git(["rev-list", "--parents", "-n", "1", result.newCommit]).split(" ")[1];
    expect(parent).toBe(editSha);
  });

  it("refuses with working-tree-modified when the file drifted on disk", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    await recordEdit(repo, {
      file: "about.md", range: { start: 0, end: 7 }, message: "edit",
    });

    writeFileSync(join(repo, "about.md"), "drift!\n");

    const result = await undoEdit(repo, {});
    expect(result.status).toBe("refused");
    expect(result.reason).toBe("working-tree-modified");
    expect(result.files).toEqual(["about.md"]);

    expect(readFileSync(join(repo, "about.md"), "utf-8")).toBe("drift!\n");
  });

  it("force: true overwrites a drifted file and completes the undo", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    await recordEdit(repo, {
      file: "about.md", range: { start: 0, end: 7 }, message: "edit",
    });
    writeFileSync(join(repo, "about.md"), "drift!\n");

    const result = await undoEdit(repo, { force: true });
    expect(result.status).toBe("undone");
    expect(readFileSync(join(repo, "about.md"), "utf-8")).toBe("original\n");
  });

  it("refuses with no-edits-to-undo when the hidden branch doesn't exist", async () => {
    const result = await undoEdit(repo, {});
    expect(result.status).toBe("refused");
    expect(result.reason).toBe("no-edits-to-undo");
  });

  it("refuses with head-only-mode when commit arg doesn't match HEAD", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    await recordEdit(repo, {
      file: "about.md", range: { start: 0, end: 7 }, message: "edit",
    });
    const result = await undoEdit(repo, { commit: "0000000000000000000000000000000000000000" });
    expect(result.status).toBe("refused");
    expect(result.reason).toBe("head-only-mode");
  });

  it("clean undo when commit arg equals HEAD", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    const editSha = await recordEdit(repo, {
      file: "about.md", range: { start: 0, end: 7 }, message: "edit",
    });
    const result = await undoEdit(repo, { commit: editSha });
    expect(result.status).toBe("undone");
  });

  it("refuses with initial-commit when the hidden branch HEAD has no parent", async () => {
    // Construct a parentless commit on refs/heads/anglesite/edits via git plumbing.
    // This shape is unreachable through normal recordEdit usage (which always commits
    // on top of HEAD); we hand-craft it here so the initial-commit path has coverage.
    const tree = git(["rev-parse", "HEAD^{tree}"]);
    const orphanCommit = execFileSync("git", ["commit-tree", tree, "-m", "orphan"], {
      cwd: repo,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();
    git(["update-ref", "refs/heads/anglesite/edits", orphanCommit]);

    const result = await undoEdit(repo, {});
    expect(result.status).toBe("refused");
    expect(result.reason).toBe("initial-commit");
  });

  it("deletes a newly-added file on undo while restoring the modified primary file", async () => {
    writeFileSync(join(repo, "about.md"), "edited\n");
    writeFileSync(join(repo, "hero.md"), "brand new\n");
    const editSha = await recordEdit(repo, {
      file: "about.md",
      range: { start: 0, end: 7 },
      newFile: { path: "hero.md" },
      message: "extract hero.md",
    });
    expect(editSha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(repo, "hero.md"))).toBe(true);

    const result = await undoEdit(repo, {});
    expect(result.status).toBe("undone");

    expect(readFileSync(join(repo, "about.md"), "utf-8")).toBe("original\n");
    expect(existsSync(join(repo, "hero.md"))).toBe(false);
  });

  it("refuses with no-edits-to-undo when projectRoot is not a git repo", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    try {
      const result = await undoEdit(notARepo, {});
      expect(result.status).toBe("refused");
      expect(result.reason).toBe("no-edits-to-undo");
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
