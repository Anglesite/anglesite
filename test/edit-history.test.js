import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordEdit } from "../server/edit-history.mjs";

let repo;

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function initRepo() {
  repo = mkdtempSync(join(tmpdir(), "edit-history-"));
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(join(repo, "README.md"), "initial\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "initial"]);
}

beforeEach(initRepo);
afterEach(() => repo && rmSync(repo, { recursive: true, force: true }));

describe("recordEdit", () => {
  it("creates anglesite/edits on first call and commits the post-edit file content", async () => {
    expect(() => git(["show-ref", "--verify", "refs/heads/anglesite/edits"])).toThrow();

    writeFileSync(join(repo, "README.md"), "edited\n");
    const sha = await recordEdit(repo, {
      file: "README.md",
      range: { start: 0, end: 7 },
      message: "anglesite: edit README.md",
    });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(["rev-parse", "refs/heads/anglesite/edits"])).toBe(sha);
    expect(git(["show", `${sha}:README.md`])).toBe("edited");
  });

  it("leaves the user's HEAD, current branch, and working tree untouched", async () => {
    const headBefore = git(["rev-parse", "HEAD"]);
    const branchBefore = git(["symbolic-ref", "--short", "HEAD"]);

    writeFileSync(join(repo, "README.md"), "edited\n");
    await recordEdit(repo, { file: "README.md", range: { start: 0, end: 7 }, message: "edit" });

    expect(git(["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(["symbolic-ref", "--short", "HEAD"])).toBe(branchBefore);
    // Working-tree file content is whatever the dispatcher wrote (we mutated it; recordEdit
    // must not have undone that mutation).
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("edited\n");
    // The user's main branch tip is unchanged (no edit commits sneak onto it).
    expect(git(["rev-parse", "main"])).toBe(headBefore);
  });

  it("accumulates: a second recordEdit commits on top of the first", async () => {
    writeFileSync(join(repo, "README.md"), "one\n");
    const a = await recordEdit(repo, { file: "README.md", range: { start: 0, end: 4 }, message: "a" });

    writeFileSync(join(repo, "README.md"), "two\n");
    const b = await recordEdit(repo, { file: "README.md", range: { start: 0, end: 4 }, message: "b" });

    expect(a).not.toBe(b);
    const parents = git(["rev-list", "--parents", "-n", "1", b]).split(/\s+/);
    expect(parents[0]).toBe(b);
    expect(parents[1]).toBe(a);
    expect(git(["show", `${b}:README.md`])).toBe("two");
  });

  it("captures an untracked new file too (not just files already tracked)", async () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/new.txt"), "fresh content\n");
    const sha = await recordEdit(repo, { file: "src/new.txt", range: { start: 0, end: 0 }, message: "add" });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(["show", `${sha}:src/new.txt`])).toBe("fresh content");
  });

  it("returns undefined when projectRoot is not a git repository", async () => {
    const notRepo = mkdtempSync(join(tmpdir(), "not-a-repo-"));
    try {
      writeFileSync(join(notRepo, "x.txt"), "y\n");
      const sha = await recordEdit(notRepo, { file: "x.txt", range: { start: 0, end: 0 }, message: "x" });
      expect(sha).toBeUndefined();
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});
