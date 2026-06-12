import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createPage, createPost } from "../server/create-content.mjs";
import { parseFrontmatter } from "../server/content-frontmatter.mjs";

let repo;

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo() {
  repo = mkdtempSync(join(tmpdir(), "create-content-"));
  execFileSync("git", ["init", "--initial-branch=main", repo], { stdio: "ignore" });
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  // BaseLayout target so the scaffolded import resolves against a real file.
  mkdirSync(join(repo, "src", "layouts"), { recursive: true });
  writeFileSync(join(repo, "src", "layouts", "BaseLayout.astro"), "layout");
  writeFileSync(join(repo, "README.md"), "seed\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
}

beforeEach(initRepo);
afterEach(() => repo && rmSync(repo, { recursive: true, force: true }));

describe("createPage", () => {
  it("scaffolds a top-level page, derives the route from the name, and commits", () => {
    const result = createPage(repo, { name: "About Us" });

    expect(result.route).toBe("/about-us");
    expect(result.filePath).toBe("src/pages/about-us.astro");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    const body = readFileSync(join(repo, result.filePath), "utf-8");
    expect(body).toContain("../layouts/BaseLayout.astro");
    expect(body).toContain('title="About Us"');

    // The file is committed at HEAD with nothing left staged.
    expect(git(["status", "--porcelain"])).toBe("");
    expect(git(["log", "-1", "--name-only", "--format="]).trim()).toContain("src/pages/about-us.astro");
  });

  it("honors an explicit nested route with the correct relative import depth", () => {
    const result = createPage(repo, { name: "Web Design", route: "/services/web" });
    expect(result.filePath).toBe("src/pages/services/web.astro");
    const body = readFileSync(join(repo, result.filePath), "utf-8");
    expect(body).toContain("../../layouts/BaseLayout.astro");
  });

  it("refuses to overwrite an existing page", () => {
    createPage(repo, { name: "About" });
    expect(() => createPage(repo, { name: "About" })).toThrow(/exists/i);
  });

  it("refuses to scaffold the site root", () => {
    expect(() => createPage(repo, { name: "Home", route: "/" })).toThrow(/root/i);
  });

  it("still writes the file when the project is not a git repo (commit is null)", () => {
    const plain = mkdtempSync(join(tmpdir(), "create-content-nogit-"));
    try {
      const result = createPage(plain, { name: "Solo" });
      expect(existsSync(join(plain, result.filePath))).toBe(true);
      expect(result.commit).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("createPost", () => {
  it("scaffolds a draft post in the posts collection, derives the slug, and commits", () => {
    const result = createPost(repo, { title: "Hello, World!" });

    expect(result.collection).toBe("posts");
    expect(result.slug).toBe("hello-world");
    expect(result.filePath).toBe("src/content/posts/hello-world.md");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    const fm = parseFrontmatter(readFileSync(join(repo, result.filePath), "utf-8"));
    expect(fm.title).toBe("Hello, World!");
    expect(fm.draft).toBe(true);
    expect(typeof fm.publishDate).toBe("string");
    expect(() => new Date(fm.publishDate).toISOString()).not.toThrow();
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("honors explicit collection and slug", () => {
    const result = createPost(repo, { title: "A Note", collection: "notes", slug: "my-note" });
    expect(result.collection).toBe("notes");
    expect(result.slug).toBe("my-note");
    expect(result.filePath).toBe("src/content/notes/my-note.md");
  });

  it("refuses to overwrite an existing entry", () => {
    createPost(repo, { title: "Dup" });
    expect(() => createPost(repo, { title: "Dup" })).toThrow(/exists/i);
  });

  it("rejects a collection that would escape src/content (path traversal)", () => {
    expect(() => createPost(repo, { title: "Evil", collection: "../../../etc" })).toThrow(/invalid collection/i);
    // Nothing was written outside the project.
    expect(existsSync(join(repo, "..", "..", "..", "etc", "evil.md"))).toBe(false);
  });
});
