import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const skillPath = resolve(
  import.meta.dirname!,
  "..",
  "skills",
  "menu",
  "SKILL.md",
);

// ---------------------------------------------------------------------------
// Skill file existence
// ---------------------------------------------------------------------------

describe("menu skill file", () => {
  it("exists at skills/menu/SKILL.md", () => {
    expect(existsSync(skillPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe("menu skill frontmatter", () => {
  it("has name: menu", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/^---\n[\s\S]*?name:\s*menu/m);
  });

  it("is user-facing (disable-model-invocation: true)", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/disable-model-invocation:\s*true/);
  });

  it("includes allowed-tools with Read, Write, Glob, Grep", () => {
    const content = readFileSync(skillPath, "utf-8");
    for (const tool of ["Read", "Write", "Glob", "Grep"]) {
      expect(content).toMatch(
        new RegExp(`allowed-tools:.*${tool}`),
      );
    }
  });

  it("allows npm run dev and npm run build in Bash", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/Bash\(npm run dev\)/);
    expect(content).toMatch(/Bash\(npm run build\)/);
  });
});

// ---------------------------------------------------------------------------
// Three entry paths
// ---------------------------------------------------------------------------

describe("menu skill entry paths", () => {
  it("supports PDF/image import path", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/PDF|image|photo/i);
    expect(content).toMatch(/import|extract/i);
  });

  it("supports from-scratch creation path", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/from scratch|create.*menu|new menu/i);
  });

  it("supports edit-existing path", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/edit.*existing|update.*menu|modify/i);
  });
});

// ---------------------------------------------------------------------------
// Required UX elements from the issue
// ---------------------------------------------------------------------------

describe("menu skill UX requirements", () => {
  it("includes dietary tag verification step", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/dietary/i);
    expect(content).toMatch(/verify|confirm|verification/i);
  });

  it("asks about menu organization (single page, tabbed, separate)", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/single page|tabbed|separate page/i);
  });

  it("asks about kiosk mode", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/kiosk/i);
  });

  it("offers QR code generation post-creation", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/QR/i);
    expect(content).toMatch(/qr/);
  });

  it("updates site navigation", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/navigation/i);
  });

  it("tells owner about Keystatic CMS editing", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/Keystatic/i);
  });

  it("saves imported files to docs/menu-imports/", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("docs/menu-imports/");
  });

  it("reads EXPLAIN_STEPS from .site-config", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("EXPLAIN_STEPS");
  });
});

// ---------------------------------------------------------------------------
// Cross-references to existing code and skills
// ---------------------------------------------------------------------------

describe("menu skill references", () => {
  it("references the menu extraction script", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/menu-extract/);
  });

  it("references the menu page template", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/menu\.astro|menu page/i);
  });

  it("references the QR skill for post-creation", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/skills\/qr\/SKILL\.md|qr skill/i);
  });

  it("references the restaurant guide", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/docs\/smb\/restaurant\.md/);
  });

  it("references docs to update (architecture.md, content-guide.md)", () => {
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("architecture.md");
    expect(content).toContain("content-guide.md");
  });
});
