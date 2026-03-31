import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseSkillFrontmatter,
  classifySkill,
  generateRegistry,
  scanSkills,
  validateSkillFrontmatter,
  type SkillMeta,
} from "../bin/generate-skill-registry.js";

// ---------------------------------------------------------------------------
// parseSkillFrontmatter
// ---------------------------------------------------------------------------

describe("parseSkillFrontmatter", () => {
  it("extracts name and description from YAML frontmatter", () => {
    const content = `---
name: deploy
description: "Build, security scan, and deploy to Cloudflare Pages"
disable-model-invocation: true
---

Build and deploy the site.`;
    const meta = parseSkillFrontmatter(content);
    expect(meta.name).toBe("deploy");
    expect(meta.description).toBe(
      "Build, security scan, and deploy to Cloudflare Pages",
    );
  });

  it("extracts disable-model-invocation flag", () => {
    const content = `---
name: start
description: "First-time setup"
disable-model-invocation: true
---`;
    const meta = parseSkillFrontmatter(content);
    expect(meta.disableModelInvocation).toBe(true);
  });

  it("extracts user-invokable flag", () => {
    const content = `---
name: animate
description: "CSS animations"
user-invokable: false
---`;
    const meta = parseSkillFrontmatter(content);
    expect(meta.userInvokable).toBe(false);
  });

  it("defaults flags to undefined when absent", () => {
    const content = `---
name: check
description: "Health audit"
---`;
    const meta = parseSkillFrontmatter(content);
    expect(meta.disableModelInvocation).toBeUndefined();
    expect(meta.userInvokable).toBeUndefined();
  });

  it("handles description without quotes", () => {
    const content = `---
name: test
description: A plain description
---`;
    const meta = parseSkillFrontmatter(content);
    expect(meta.description).toBe("A plain description");
  });
});

// ---------------------------------------------------------------------------
// classifySkill
// ---------------------------------------------------------------------------

describe("classifySkill", () => {
  it("classifies disable-model-invocation: true as user-facing", () => {
    expect(
      classifySkill({ disableModelInvocation: true } as SkillMeta),
    ).toBe("user-facing");
  });

  it("classifies user-invokable: false as model-only", () => {
    expect(classifySkill({ userInvokable: false } as SkillMeta)).toBe(
      "model-only",
    );
  });

  it("classifies skills with neither flag as both", () => {
    expect(classifySkill({} as SkillMeta)).toBe("both");
  });
});

// ---------------------------------------------------------------------------
// generateRegistry — produce markdown from skill metadata
// ---------------------------------------------------------------------------

describe("generateRegistry", () => {
  const skills: SkillMeta[] = [
    {
      name: "deploy",
      description: "Build and deploy",
      disableModelInvocation: true,
    },
    {
      name: "start",
      description: "First-time setup",
      disableModelInvocation: true,
    },
    {
      name: "animate",
      description: "CSS animations",
      userInvokable: false,
    },
    {
      name: "check",
      description: "Health audit",
    },
  ];

  it("produces markdown with three sections", () => {
    const md = generateRegistry(skills);
    expect(md).toContain("## User-facing");
    expect(md).toContain("## Model-only");
    expect(md).toContain("## Both");
  });

  it("includes a total count in the header", () => {
    const md = generateRegistry(skills);
    expect(md).toContain("4 skills");
  });

  it("sorts skills alphabetically within each section", () => {
    const md = generateRegistry(skills);
    const deployIdx = md.indexOf("| `deploy`");
    const startIdx = md.indexOf("| `start`");
    expect(deployIdx).toBeLessThan(startIdx);
  });

  it("puts user-facing skills in the user-facing table", () => {
    const md = generateRegistry(skills);
    const userSection = md.split("## Model-only")[0];
    expect(userSection).toContain("deploy");
    expect(userSection).toContain("start");
    expect(userSection).not.toContain("animate");
  });

  it("puts model-only skills in the model-only table", () => {
    const md = generateRegistry(skills);
    const modelSection = md.split("## Model-only")[1].split("## Both")[0];
    expect(modelSection).toContain("animate");
    expect(modelSection).not.toContain("deploy");
  });

  it("omits a section when no skills match", () => {
    const onlyUser: SkillMeta[] = [
      {
        name: "deploy",
        description: "Build",
        disableModelInvocation: true,
      },
    ];
    const md = generateRegistry(onlyUser);
    expect(md).toContain("## User-facing");
    expect(md).not.toContain("## Model-only");
    expect(md).not.toContain("## Both");
  });

  it("includes auto-generated warning comment", () => {
    const md = generateRegistry(skills);
    expect(md).toContain("Auto-generated");
  });
});

// ---------------------------------------------------------------------------
// validateSkillFrontmatter
// ---------------------------------------------------------------------------

describe("validateSkillFrontmatter", () => {
  it("returns no errors for valid model-only skill", () => {
    const content = `---
name: animate
description: "CSS animations"
user-invokable: false
allowed-tools: Write, Read, Glob
---`;
    expect(validateSkillFrontmatter(content)).toEqual([]);
  });

  it("returns no errors for valid user-facing skill", () => {
    const content = `---
name: deploy
description: "Build and deploy"
disable-model-invocation: true
allowed-tools: Bash(npm run build), Write, Read
---`;
    expect(validateSkillFrontmatter(content)).toEqual([]);
  });

  it("flags user-invocable as a typo of user-invokable", () => {
    const content = `---
name: experiment
description: "A/B tests"
user-invocable: false
allowed-tools: Write, Read
---`;
    const errors = validateSkillFrontmatter(content);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("user-invocable");
    expect(errors[0]).toContain("user-invokable");
  });

  it("flags missing allowed-tools", () => {
    const content = `---
name: experiment
description: "A/B tests"
user-invokable: false
---`;
    const errors = validateSkillFrontmatter(content);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes("allowed-tools"))).toBe(true);
  });

  it("flags unknown frontmatter keys", () => {
    const content = `---
name: test
description: "Test"
allowed-tools: Read
user-invokabel: false
---`;
    const errors = validateSkillFrontmatter(content);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("user-invokabel");
  });

  it("accepts argument-hint as a valid key", () => {
    const content = `---
name: check
description: "Health audit"
argument-hint: "[optional: describe the problem]"
allowed-tools: Read, Write
disable-model-invocation: true
---`;
    expect(validateSkillFrontmatter(content)).toEqual([]);
  });

  it("reports multiple errors at once", () => {
    const content = `---
name: bad-skill
description: "Broken"
user-invocable: false
---`;
    const errors = validateSkillFrontmatter(content);
    // Should flag both the typo and missing allowed-tools
    expect(errors.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Skill frontmatter consistency — all skills on disk pass validation
// ---------------------------------------------------------------------------

describe("skill frontmatter consistency", () => {
  const skillsDir = resolve(__dirname, "..", "skills");

  it("all skills have valid frontmatter", () => {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const errors: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, "utf-8");
      const issues = validateSkillFrontmatter(content);
      for (const issue of issues) {
        errors.push(`${entry.name}: ${issue}`);
      }
    }

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Registry consistency — generated file matches skills on disk
// ---------------------------------------------------------------------------

describe("registry consistency", () => {
  const skillsDir = resolve(__dirname, "..", "skills");
  const registryFile = resolve(__dirname, "..", "docs", "dev", "skill-registry.md");

  it("docs/dev/skill-registry.md matches skills on disk", () => {
    if (!existsSync(registryFile)) {
      throw new Error(
        "docs/dev/skill-registry.md not found — run: npx tsx bin/generate-skill-registry.ts",
      );
    }

    const skills = scanSkills(skillsDir);
    const expected = generateRegistry(skills) + "\n";
    const actual = readFileSync(registryFile, "utf-8");

    expect(actual).toBe(expected);
  });
});
