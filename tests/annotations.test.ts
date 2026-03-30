import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAnnotations,
  saveAnnotations,
  addAnnotation,
  listAnnotations,
  resolveAnnotation,
} from "../server/annotations.mjs";

// ---------------------------------------------------------------------------
// loadAnnotations
// ---------------------------------------------------------------------------

describe("loadAnnotations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-annot-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when annotations.json does not exist", () => {
    const result = loadAnnotations(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns parsed annotations from versioned file", () => {
    const annotations = [
      {
        id: "abc123",
        path: "/about",
        selector: "h1.hero",
        text: "Fix line-height",
        resolved: false,
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    ];
    writeFileSync(
      join(tmpDir, "annotations.json"),
      JSON.stringify({ version: 1, annotations }, null, 2),
    );
    const result = loadAnnotations(tmpDir);
    expect(result).toEqual(annotations);
  });

  it("handles legacy bare-array format", () => {
    const annotations = [
      {
        id: "abc123",
        path: "/about",
        selector: "h1.hero",
        text: "Fix line-height",
        resolved: false,
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    ];
    writeFileSync(
      join(tmpDir, "annotations.json"),
      JSON.stringify(annotations, null, 2),
    );
    const result = loadAnnotations(tmpDir);
    expect(result).toEqual(annotations);
  });

  it("returns empty array when file contains invalid JSON", () => {
    writeFileSync(join(tmpDir, "annotations.json"), "not json{{{");
    const result = loadAnnotations(tmpDir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// saveAnnotations
// ---------------------------------------------------------------------------

describe("saveAnnotations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-annot-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes versioned wrapper to annotations.json with pretty formatting", () => {
    const annotations = [
      {
        id: "abc123",
        path: "/about",
        selector: "h1.hero",
        text: "Fix line-height",
        resolved: false,
        createdAt: "2026-03-27T00:00:00.000Z",
      },
    ];
    saveAnnotations(tmpDir, annotations);
    const raw = readFileSync(join(tmpDir, "annotations.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ version: 1, annotations });
  });

  it("overwrites existing file", () => {
    writeFileSync(join(tmpDir, "annotations.json"), "[]");
    const annotations = [
      {
        id: "x",
        path: "/",
        selector: "p",
        text: "hello",
        resolved: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    saveAnnotations(tmpDir, annotations);
    const result = JSON.parse(
      readFileSync(join(tmpDir, "annotations.json"), "utf-8"),
    );
    expect(result).toEqual({ version: 1, annotations });
  });
});

// ---------------------------------------------------------------------------
// addAnnotation
// ---------------------------------------------------------------------------

describe("addAnnotation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-annot-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new annotation with generated id and createdAt", () => {
    const result = addAnnotation(tmpDir, {
      path: "/about",
      selector: "h1.hero",
      text: "Fix line-height",
    });

    expect(result.id).toBeTypeOf("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.path).toBe("/about");
    expect(result.selector).toBe("h1.hero");
    expect(result.text).toBe("Fix line-height");
    expect(result.resolved).toBe(false);
    expect(result.createdAt).toBeTypeOf("string");
  });

  it("persists the annotation to disk", () => {
    addAnnotation(tmpDir, {
      path: "/",
      selector: "p.intro",
      text: "Make bolder",
    });
    const stored = loadAnnotations(tmpDir);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe("Make bolder");
  });

  it("appends to existing annotations", () => {
    addAnnotation(tmpDir, { path: "/", selector: "h1", text: "First" });
    addAnnotation(tmpDir, { path: "/about", selector: "h2", text: "Second" });
    const stored = loadAnnotations(tmpDir);
    expect(stored).toHaveLength(2);
  });

  it("generates unique ids", () => {
    const a = addAnnotation(tmpDir, { path: "/", selector: "h1", text: "A" });
    const b = addAnnotation(tmpDir, { path: "/", selector: "h2", text: "B" });
    expect(a.id).not.toBe(b.id);
  });

  it("includes sourceFile when provided", () => {
    const result = addAnnotation(tmpDir, {
      path: "/about",
      selector: "h1",
      text: "Fix this",
      sourceFile: "src/pages/about.astro",
    });
    expect(result.sourceFile).toBe("src/pages/about.astro");
  });

  it("omits sourceFile when not provided", () => {
    const result = addAnnotation(tmpDir, {
      path: "/about",
      selector: "h1",
      text: "Fix this",
    });
    expect(result.sourceFile).toBeUndefined();
  });

  it("generates 8-character URL-safe ids", () => {
    const a = addAnnotation(tmpDir, { path: "/", selector: "h1", text: "A" });
    expect(a.id).toHaveLength(8);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("throws when unresolved annotation count reaches 50", () => {
    for (let i = 0; i < 50; i++) {
      addAnnotation(tmpDir, { path: "/", selector: `h${i}`, text: `Note ${i}` });
    }
    expect(() =>
      addAnnotation(tmpDir, { path: "/", selector: "h50", text: "One too many" }),
    ).toThrow(/limit.*50/i);
  });

  it("allows adding after resolving when at cap", () => {
    for (let i = 0; i < 50; i++) {
      addAnnotation(tmpDir, { path: "/", selector: `h${i}`, text: `Note ${i}` });
    }
    const all = loadAnnotations(tmpDir);
    resolveAnnotation(tmpDir, all[0].id);
    const result = addAnnotation(tmpDir, { path: "/", selector: "p", text: "After resolve" });
    expect(result.text).toBe("After resolve");
  });
});

// ---------------------------------------------------------------------------
// listAnnotations
// ---------------------------------------------------------------------------

describe("listAnnotations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-annot-"));
    addAnnotation(tmpDir, { path: "/", selector: "h1", text: "Home note" });
    addAnnotation(tmpDir, {
      path: "/about",
      selector: "h2",
      text: "About note",
    });
    addAnnotation(tmpDir, {
      path: "/about",
      selector: "p",
      text: "About paragraph",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns all annotations when no path filter", () => {
    const result = listAnnotations(tmpDir);
    expect(result).toHaveLength(3);
  });

  it("filters by path when provided", () => {
    const result = listAnnotations(tmpDir, "/about");
    expect(result).toHaveLength(2);
    expect(result.every((a: { path: string }) => a.path === "/about")).toBe(true);
  });

  it("returns empty array when path has no annotations", () => {
    const result = listAnnotations(tmpDir, "/contact");
    expect(result).toEqual([]);
  });

  it("excludes resolved annotations by default", () => {
    const all = loadAnnotations(tmpDir);
    resolveAnnotation(tmpDir, all[0].id);
    const result = listAnnotations(tmpDir);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// resolveAnnotation
// ---------------------------------------------------------------------------

describe("resolveAnnotation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-annot-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks an annotation as resolved", () => {
    const annotation = addAnnotation(tmpDir, {
      path: "/",
      selector: "h1",
      text: "Fix this",
    });
    const result = resolveAnnotation(tmpDir, annotation.id);
    expect(result.resolved).toBe(true);
  });

  it("persists the resolved state to disk", () => {
    const annotation = addAnnotation(tmpDir, {
      path: "/",
      selector: "h1",
      text: "Fix this",
    });
    resolveAnnotation(tmpDir, annotation.id);
    const stored = loadAnnotations(tmpDir);
    expect(stored[0].resolved).toBe(true);
  });

  it("throws when annotation id is not found", () => {
    expect(() => resolveAnnotation(tmpDir, "nonexistent")).toThrow(
      /not found/i,
    );
  });

  it("sets resolvedAt timestamp when resolving", () => {
    const annotation = addAnnotation(tmpDir, {
      path: "/",
      selector: "h1",
      text: "Fix this",
    });
    const before = new Date().toISOString();
    const result = resolveAnnotation(tmpDir, annotation.id);
    const after = new Date().toISOString();
    expect(result.resolvedAt).toBeTypeOf("string");
    expect(result.resolvedAt! >= before).toBe(true);
    expect(result.resolvedAt! <= after).toBe(true);
  });

  it("does not modify other annotations", () => {
    const a = addAnnotation(tmpDir, {
      path: "/",
      selector: "h1",
      text: "First",
    });
    addAnnotation(tmpDir, { path: "/", selector: "h2", text: "Second" });
    resolveAnnotation(tmpDir, a.id);
    const stored = loadAnnotations(tmpDir);
    expect(stored[1].resolved).toBe(false);
  });
});
