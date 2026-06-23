import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseSkill,
  classify,
  rewriteBody,
  buildFrontmatter,
  buildSkill,
  validateSkillName,
  validateSkill,
  inferCompatibility,
  renderIndex,
} from "../bin/build-agent-skills.ts";

const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const OUT_DIR = join(ROOT, "agent-skills");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;

const sample = `---
name: demo
description: "Does a thing"
allowed-tools: Bash(npm run build), Read
disable-model-invocation: true
argument-hint: "[page /about]"
---

Body text.
`;

describe("parseSkill", () => {
  it("extracts frontmatter fields and preserves allowed-tools verbatim", () => {
    const s = parseSkill(sample, VERSION);
    expect(s.name).toBe("demo");
    expect(s.description).toBe("Does a thing");
    expect(s.allowedTools).toBe("Bash(npm run build), Read");
    expect(s.argumentHint).toBe("[page /about]");
    expect(s.disableModelInvocation).toBe(true);
    expect(s.body.trim()).toBe("Body text.");
  });
});

describe("classify", () => {
  it("maps the plugin invocation flags to spec metadata", () => {
    expect(classify(parseSkill(sample, VERSION))).toBe("user-facing");
    expect(
      classify(parseSkill("---\nname: m\ndescription: x\nuser-invocable: false\n---\n", VERSION)),
    ).toBe("model-only");
    expect(classify(parseSkill("---\nname: b\ndescription: x\n---\n", VERSION))).toBe("both");
  });
});

describe("rewriteBody", () => {
  it("turns cross-skill references (bare, backticked, linked) into plain mentions", () => {
    const { body, crossSkillRefs } = rewriteBody(
      "Hand off to ${CLAUDE_PLUGIN_ROOT}/skills/donations/SKILL.md now. " +
        "Read `${CLAUDE_PLUGIN_ROOT}/skills/themes/SKILL.md`. " +
        "[buy-button](${CLAUDE_PLUGIN_ROOT}/skills/buy-button/SKILL.md)",
    );
    expect(body).toContain("the `donations` skill");
    expect(body).toContain("the `themes` skill");
    expect(body).toContain("the `buy-button` skill");
    expect(body).not.toContain("CLAUDE_PLUGIN_ROOT");
    // No nested code spans from the backticked form.
    expect(body).not.toMatch(/`the `/);
    expect(crossSkillRefs).toEqual(["buy-button", "donations", "themes"]);
  });

  it("rewrites doc references to references/<path> and records them", () => {
    const { body, references } = rewriteBody(
      "See [ADR](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro.md) for details.",
    );
    expect(body).toContain("(references/docs/decisions/0001-astro.md)");
    expect(references).toContain("docs/decisions/0001-astro.md");
  });

  it("strips :symbol() annotations from collected paths but keeps them in prose", () => {
    const { body, references } = rewriteBody(
      "Use `${CLAUDE_PLUGIN_ROOT}/template/scripts/booking.ts:extractBrandColor()`.",
    );
    expect(references).toContain("template/scripts/booking.ts");
    expect(references).not.toContain("template/scripts/booking.ts:extractBrandColor()");
    expect(body).toContain("references/template/scripts/booking.ts:extractBrandColor()");
  });
});

describe("validation", () => {
  it("accepts spec-compliant names and rejects invalid ones", () => {
    expect(validateSkillName("buy-button")).toEqual([]);
    expect(validateSkillName("Buy-Button").length).toBeGreaterThan(0);
    expect(validateSkillName("-x").length).toBeGreaterThan(0);
    expect(validateSkillName("a--b").length).toBeGreaterThan(0);
  });

  it("flags out-of-range descriptions", () => {
    const long = parseSkill(`---\nname: x\ndescription: "${"a".repeat(1100)}"\n---\n`, VERSION);
    expect(validateSkill(long).some((e) => /description/.test(e))).toBe(true);
  });
});

describe("buildFrontmatter", () => {
  it("emits only spec fields plus metadata, dropping plugin-only keys", () => {
    const fm = buildFrontmatter(parseSkill(sample, VERSION), VERSION);
    expect(fm).toMatch(/^name: demo$/m);
    expect(fm).toMatch(/^license: ISC$/m);
    expect(fm).toMatch(/^compatibility: /m);
    expect(fm).toMatch(/invocation: "user-facing"/);
    expect(fm).toMatch(/argument-hint: "\[page \/about\]"/);
    // Plugin-only top-level keys must not appear as frontmatter keys.
    expect(fm).not.toMatch(/^disable-model-invocation:/m);
    expect(fm).not.toMatch(/^user-invocable:/m);
  });
});

describe("inferCompatibility", () => {
  it("notes Cloudflare requirements when the skill uses wrangler", () => {
    const s = parseSkill("---\nname: d\ndescription: x\nallowed-tools: Bash(npx wrangler *)\n---\n", VERSION);
    expect(inferCompatibility(s)).toMatch(/Cloudflare/);
  });
});

describe("renderIndex", () => {
  it("lists install commands per skill", () => {
    const md = renderIndex([{ name: "seo", description: "SEO", invocation: "user-facing" }], VERSION);
    expect(md).toContain("npx skills add Anglesite/anglesite/agent-skills/seo");
  });
});

// ---------------------------------------------------------------------------
// Sync guard: committed agent-skills/<name>/SKILL.md must match a fresh build.
// (References are regenerated by the same build; CI also runs a git-diff check.)
// ---------------------------------------------------------------------------

describe("committed output is in sync", () => {
  const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, "SKILL.md")))
    .map((e) => e.name);

  it("has a generated skill for every source skill", () => {
    for (const name of skillNames) {
      expect(existsSync(join(OUT_DIR, name, "SKILL.md")), `missing agent-skills/${name}`).toBe(true);
    }
  });

  it.each(skillNames)("agent-skills/%s/SKILL.md matches the transformer", (name) => {
    const src = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");
    const expected = buildSkill(src, VERSION).skillMd;
    const committed = readFileSync(join(OUT_DIR, name, "SKILL.md"), "utf-8").replace(/\n$/, "");
    expect(committed).toBe(expected.replace(/\n$/, ""));
  });

  it("every generated SKILL.md is free of unresolved plugin variables", () => {
    for (const name of skillNames) {
      const md = readFileSync(join(OUT_DIR, name, "SKILL.md"), "utf-8");
      expect(md.includes("${CLAUDE_PLUGIN_ROOT}"), `${name} leaks CLAUDE_PLUGIN_ROOT`).toBe(false);
    }
  });
});
