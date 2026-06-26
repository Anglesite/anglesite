import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createPage, createPost, createTyped } from "../server/create-content.mjs";
import { parseFrontmatter } from "../server/content-frontmatter.mjs";

/** ISO 8601 date-time with millisecond fraction + Z — must match Swift's `.withFractionalSeconds`. */
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

describe("createTyped", () => {
  /** Pull the raw `publishDate:` (or other dt) value from a frontmatter line. */
  function dtValue(content, field) {
    const m = content.match(new RegExp(`^${field}: (.+)$`, "m"));
    return m && m[1];
  }

  it("scaffolds a note into its collection, omits the markdown field from frontmatter, and commits", () => {
    const result = createTyped(repo, { type: "note", title: "Quick thought" });

    expect(result.type).toBe("note");
    expect(result.collection).toBe("notes");
    expect(result.slug).toBe("quick-thought");
    expect(result.filePath).toBe("src/content/notes/quick-thought.md");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    // Byte-faithful to ContentScaffold.renderEntry: a note has no title field, body (markdown)
    // becomes the placeholder body, datetime uses ISO-8601 with milliseconds + Z.
    const content = readFileSync(join(repo, result.filePath), "utf-8");
    const publishDate = dtValue(content, "publishDate");
    expect(publishDate).toMatch(ISO_MS);
    expect(content).toBe(`---\npublishDate: ${publishDate}\ntags: []\n---\n\nWrite your note here.\n`);

    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("renders an article: title/name fields take the title, other strings stay empty, dt fields share one timestamp", () => {
    const result = createTyped(repo, { type: "article", title: 'He said "hi"' });

    expect(result.slug).toBe("he-said-hi");
    const content = readFileSync(join(repo, result.filePath), "utf-8");
    const publishDate = dtValue(content, "publishDate");
    const updated = dtValue(content, "updated");
    expect(publishDate).toMatch(ISO_MS);
    expect(updated).toBe(publishDate); // single `now` for every datetime field
    expect(content).toBe(
      `---\ntitle: "He said \\"hi\\""\nsummary: ""\npublishDate: ${publishDate}\nupdated: ${updated}\ntags: []\n---\n\nWrite your article here.\n`,
    );
  });

  it("uses the `name` field (not `title`) for types that declare it", () => {
    const result = createTyped(repo, { type: "event", title: "Launch Party" });
    const content = readFileSync(join(repo, result.filePath), "utf-8");
    const start = dtValue(content, "start");
    const end = dtValue(content, "end");
    expect(content).toBe(
      `---\nname: "Launch Party"\nstart: ${start}\nend: ${end}\nlocation: ""\n---\n\nWrite your event here.\n`,
    );
  });

  it("emits frontmatter-only (no body) for a type without a markdown field", () => {
    const result = createTyped(repo, { type: "like", title: "" });
    // Empty title → slug falls back to the descriptor id, matching NativeContentOperations.
    expect(result.slug).toBe("like");
    const content = readFileSync(join(repo, result.filePath), "utf-8");
    const publishDate = dtValue(content, "publishDate");
    expect(content).toBe(`---\nlikeOf: ""\npublishDate: ${publishDate}\n---\n`);
  });

  it("renders number fields as 0 and leaves non-title string fields empty even when a title is given", () => {
    // `review.itemReviewed` is a plain string field (not `title`/`name`), so it stays empty;
    // `rating` (number) renders as 0.
    const result = createTyped(repo, { type: "review", title: "My Gadget" });
    const content = readFileSync(join(repo, result.filePath), "utf-8");
    const publishDate = dtValue(content, "publishDate");
    expect(content).toBe(
      `---\nitemReviewed: ""\nrating: 0\npublishDate: ${publishDate}\n---\n\nWrite your review here.\n`,
    );
  });

  it("rejects an unknown content type", () => {
    expect(() => createTyped(repo, { type: "nope", title: "x" })).toThrow(/unknown content type/i);
  });

  it("rejects a page-stored type (not yet supported)", () => {
    expect(() => createTyped(repo, { type: "businessProfile", title: "Acme" })).toThrow(/page-stored/i);
  });

  it("refuses to overwrite an existing typed entry", () => {
    createTyped(repo, { type: "note", title: "Dup" });
    expect(() => createTyped(repo, { type: "note", title: "Dup" })).toThrow(/exists/i);
  });

  it("still writes the file when the project is not a git repo (commit is null)", () => {
    const plain = mkdtempSync(join(tmpdir(), "create-content-nogit-"));
    try {
      const result = createTyped(plain, { type: "note", title: "Solo" });
      expect(existsSync(join(plain, result.filePath))).toBe(true);
      expect(result.commit).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
