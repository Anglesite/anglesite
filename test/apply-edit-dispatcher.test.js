import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync, rmSync, chmodSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { execSync } from "node:child_process";
import sharp from "sharp";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";

const FIXTURE = resolvePath(import.meta.dirname, "fixtures/patcher");
let root;

function makeEdit(overrides = {}) {
  return {
    id: "e-1",
    path: "/",
    selector: { tag: "H1", classes: [], nthChild: 1, textContent: "Welcome to Our Shop" },
    op: "replace-text",
    value: "Welcome to Our New Shop",
    ...overrides,
  };
}

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dispatcher-"));
  cpSync(FIXTURE, root, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("applyEdit — happy path", () => {
  it("patches the file at the resolved range and returns edit-applied", async () => {
    const indexPath = join(root, "src/pages/index.astro");
    const before = readFileSync(indexPath, "utf-8");

    const response = await applyEdit(root, makeEdit());
    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.id).toBe("e-1");
    expect(body.file).toBe("src/pages/index.astro");
    expect(body.range).toEqual(expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }));

    const after = readFileSync(indexPath, "utf-8");
    // Byte-precise splice: prefix + replacement + suffix.
    const expected = before.slice(0, body.range.start) + "Welcome to Our New Shop" + before.slice(body.range.end);
    expect(after).toBe(expected);
    // And it actually contains the new text.
    expect(after).toContain("Welcome to Our New Shop");
    expect(after).not.toContain("Welcome to Our Shop</h1>");
  });

  it("invokes the onApplied hook and threads its return value into commit", async () => {
    let captured = null;
    const response = await applyEdit(root, makeEdit(), {
      onApplied: async ({ file, range }) => {
        captured = { file, range };
        return "deadbeef";
      },
    });
    expect(captured?.file).toBe("src/pages/index.astro");
    expect(captured?.range.start).toBeTypeOf("number");
    const body = parseContent(response);
    expect(body.commit).toBe("deadbeef");
  });

  it("omits commit when no onApplied hook is provided (Phase-5 history not wired yet)", async () => {
    const response = await applyEdit(root, makeEdit());
    const body = parseContent(response);
    expect(body.commit).toBeUndefined();
  });
});

describe("applyEdit — refusal mapping", () => {
  it("returns edit-failed when the resolver refuses (no-match)", async () => {
    const response = await applyEdit(
      root,
      makeEdit({ selector: { tag: "P", classes: [], nthChild: 1, textContent: "no such text anywhere" } }),
    );
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-failed");
    expect(body.id).toBe("e-1");
    expect(body.reason).toBe("no-match");
  });

  it("passes through dynamic-expression refusals from the resolver", async () => {
    const response = await applyEdit(
      root,
      makeEdit({
        path: "/about/",
        selector: { tag: "P", classes: [], nthChild: 1, textContent: "Our team of 12 experts is here to help you." },
      }),
    );
    expect(response.isError).toBe(true);
    const body = parseContent(response);
    expect(body.reason).toBe("dynamic-expression");
  });
});

describe("applyEdit — write-failed surface", () => {
  // Atomic write goes through write-tmp + rename, which under POSIX only needs write access on
  // the *parent directory* — chmod'ing the file 0444 isn't enough to fail the write. We chmod
  // the directory instead, which is what an actually-locked filesystem looks like.
  it("returns edit-failed reason: write-failed when the target directory isn't writable", async () => {
    const pagesDir = join(root, "src/pages");
    const originalMode = statSync(pagesDir).mode;
    chmodSync(pagesDir, 0o555);
    try {
      const response = await applyEdit(root, makeEdit());
      expect(response.isError).toBe(true);
      const body = parseContent(response);
      expect(body.type).toBe("anglesite:edit-failed");
      expect(body.reason).toBe("write-failed");
      expect(body.detail).toBeTruthy();
    } finally {
      chmodSync(pagesDir, originalMode);
    }
  });

  it("does not invoke onApplied when the write fails", async () => {
    const pagesDir = join(root, "src/pages");
    const originalMode = statSync(pagesDir).mode;
    chmodSync(pagesDir, 0o555);
    let called = false;
    try {
      const response = await applyEdit(root, makeEdit(), {
        onApplied: async () => { called = true; return "should-not-appear"; },
      });
      expect(called).toBe(false);
      const body = parseContent(response);
      expect(body.reason).toBe("write-failed");
    } finally {
      chmodSync(pagesDir, originalMode);
    }
  });
});

describe("replace-image-src", () => {
  let projectRoot;

  beforeEach(() => {
    // Set up a tmpdir as a git repo so applyEdit's onApplied (recordEdit) hook can commit.
    projectRoot = mkdtempSync(join(tmpdir(), "anglesite-img-drop-"));
    execSync("git init -q -b main", { cwd: projectRoot });
    execSync("git config user.email test@example.com", { cwd: projectRoot });
    execSync("git config user.name Test", { cwd: projectRoot });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes bytes, optimizes, patches <img>, and returns result.src+srcset", async () => {
    mkdirSync(join(projectRoot, "src/pages"), { recursive: true });
    mkdirSync(join(projectRoot, "public/images"), { recursive: true });
    writeFileSync(
      join(projectRoot, "src/pages/about.astro"),
      `<img src="/images/hero.jpg" alt="Hero" />`,
    );
    await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .jpeg()
      .toFile(join(projectRoot, "public/images/hero.jpg"));
    execSync("git add .", { cwd: projectRoot });
    execSync("git commit -q -m fixture", { cwd: projectRoot });

    const dropped = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 255, g: 128, b: 0 } } })
      .jpeg()
      .toBuffer();
    const dataURL = `data:image/jpeg;base64,${dropped.toString("base64")}`;

    const result = await applyEdit(projectRoot, {
      id: "e-img-1",
      path: "/about/",
      selector: { tag: "IMG", classes: [], nthChild: 1, textContent: "/images/hero.jpg" },
      op: "replace-image-src",
      value: { filename: "vacation.jpg", mimeType: "image/jpeg", dataURL },
    });

    expect(result.isError).toBeUndefined();
    const reply = JSON.parse(result.content[0].text);
    expect(reply.type).toBe("anglesite:edit-applied");
    expect(reply.result.src).toBe("/images/hero.webp");
    expect(reply.result.srcset).toContain("/images/hero-480w.webp 480w");

    const astro = readFileSync(join(projectRoot, "src/pages/about.astro"), "utf-8");
    expect(astro).toContain('src="/images/hero.webp"');
    expect(astro).toContain('srcset="/images/hero-480w.webp');

    expect(existsSync(join(projectRoot, "public/images/hero.webp"))).toBe(true);
    expect(existsSync(join(projectRoot, "public/images/hero-480w.webp"))).toBe(true);
    expect(existsSync(join(projectRoot, "public/images/originals/hero.jpg"))).toBe(true);

    // Verify originals/hero.jpg contains the OLD (blue 100x100) bytes, not the
    // new (orange 2000x1500) bytes. This guards against a regression where
    // the optimize call's preserveOriginalsDir overwrites the preserved file.
    const preserved = await sharp(join(projectRoot, "public/images/originals/hero.jpg")).metadata();
    expect(preserved.width).toBe(100);
  });

  it("falls back to dropped filename when target src is external", async () => {
    mkdirSync(join(projectRoot, "src/pages"), { recursive: true });
    mkdirSync(join(projectRoot, "public/images"), { recursive: true });
    writeFileSync(
      join(projectRoot, "src/pages/about.astro"),
      `<img src="https://cdn.example.com/photo.jpg" alt="External" />`,
    );
    execSync("git add .", { cwd: projectRoot });
    execSync("git commit -q -m fixture", { cwd: projectRoot });

    const dropped = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r: 0, g: 200, b: 50 } } })
      .jpeg()
      .toBuffer();
    const dataURL = `data:image/jpeg;base64,${dropped.toString("base64")}`;

    const result = await applyEdit(projectRoot, {
      id: "e-img-ext",
      path: "/about/",
      selector: { tag: "IMG", classes: [], nthChild: 1, textContent: "https://cdn.example.com/photo.jpg" },
      op: "replace-image-src",
      value: { filename: "trip-sunset.jpg", mimeType: "image/jpeg", dataURL },
    });

    expect(result.isError).toBeUndefined();
    const reply = JSON.parse(result.content[0].text);
    expect(reply.result.src).toBe("/images/trip-sunset.webp");
  });

  it("returns image-optimize-failed when the dataURL bytes are corrupt", async () => {
    mkdirSync(join(projectRoot, "src/pages"), { recursive: true });
    mkdirSync(join(projectRoot, "public/images"), { recursive: true });
    writeFileSync(join(projectRoot, "src/pages/about.astro"), `<img src="/images/hero.jpg" />`);
    execSync("git add .", { cwd: projectRoot });
    execSync("git commit -q -m fixture", { cwd: projectRoot });

    const result = await applyEdit(projectRoot, {
      id: "e-img-bad",
      path: "/about/",
      selector: { tag: "IMG", classes: [], nthChild: 1, textContent: "/images/hero.jpg" },
      op: "replace-image-src",
      value: {
        filename: "broken.jpg",
        mimeType: "image/jpeg",
        dataURL: "data:image/jpeg;base64,bm90LWFuLWltYWdl",
      },
    });

    expect(result.isError).toBe(true);
    const reply = JSON.parse(result.content[0].text);
    expect(reply.reason).toBe("image-optimize-failed");
  });
});
