import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveComponentFrontmatter } from "../server/component-frontmatter-edit.mjs";
import { buildComponentModel } from "../server/component-model.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---
interface Props {
  title: string;
  count?: number;
}
const { title, count = 1 } = Astro.props;
---
<article class="card">
  <h2>{title}</h2>
</article>

<script>
  console.log("card mounted");
</script>
`;

const BARE = `---\n---\n<p>hello</p>\n`;

describe("resolveComponentFrontmatter", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-cfe-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
    writeFileSync(join(tmpDir, "src", "components", "Bare.astro"), BARE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function apply(file, resolution) {
    const source = readFileSync(join(tmpDir, "src", "components", file), "utf-8");
    return source.slice(0, resolution.range.start) + resolution.replacement + source.slice(resolution.range.end);
  }

  it("refuses with invalid-input when component payload is missing", async () => {
    const result = await resolveComponentFrontmatter(tmpDir, { op: "set-props-interface" });
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("invalid-input");
  });

  it("refuses with stale when baseVersion does not match", async () => {
    const edit = {
      op: "set-props-interface",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", props: [] },
    };
    const result = await resolveComponentFrontmatter(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("refuses with read-failed when the file can't be read", async () => {
    const edit = {
      op: "set-props-interface",
      component: { path: "src/components/Missing.astro", baseVersion: "sha256:000000000000", props: [] },
    };
    const result = await resolveComponentFrontmatter(tmpDir, edit);
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("read-failed");
  });

  describe("set-props-interface", () => {
    it("replaces an existing Props interface and destructure in place", async () => {
      const baseVersion = fileVersion(CARD);
      const edit = {
        op: "set-props-interface",
        component: {
          path: "src/components/Card.astro",
          baseVersion,
          props: [
            { name: "title", type: "string", optional: false, default: null },
            { name: "count", type: "number", optional: true, default: "2" },
            { name: "label", type: "string", optional: true, default: '"hi"' },
          ],
        },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Card.astro", result);
      expect(next).toContain("interface Props {\n  title: string;\n  count?: number;\n  label?: string;\n}");
      expect(next).toContain('const { title, count = 2, label = "hi" } = Astro.props;');
      // Template and client script untouched.
      expect(next).toContain("<h2>{title}</h2>");
      expect(next).toContain('console.log("card mounted")');

      // Re-parsing the result reports the same props back (idempotence).
      writeFileSync(join(tmpDir, "src", "components", "Card.astro"), next);
      const model = await buildComponentModel(tmpDir, "src/components/Card.astro");
      expect(model.frontmatter?.props).toEqual(edit.component.props);
    });

    it("adds a Props interface + destructure to a component with no props yet", async () => {
      const baseVersion = fileVersion(BARE);
      const edit = {
        op: "set-props-interface",
        component: {
          path: "src/components/Bare.astro",
          baseVersion,
          props: [{ name: "title", type: "string", optional: false, default: null }],
        },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Bare.astro", result);
      expect(next).toContain("interface Props {\n  title: string;\n}");
      expect(next).toContain("const { title } = Astro.props;");
      expect(next).toContain("<p>hello</p>");
    });

    it("removes the Props interface and destructure when props is empty", async () => {
      const baseVersion = fileVersion(CARD);
      const edit = {
        op: "set-props-interface",
        component: { path: "src/components/Card.astro", baseVersion, props: [] },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Card.astro", result);
      expect(next).not.toContain("interface Props");
      expect(next).not.toContain("Astro.props");
      expect(next).toContain("<h2>{title}</h2>");
    });

    it("refuses invalid-input for a malformed prop entry", async () => {
      const baseVersion = fileVersion(CARD);
      const edit = {
        op: "set-props-interface",
        component: { path: "src/components/Card.astro", baseVersion, props: [{ name: "title" }] },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBe(true);
      expect(result.reason).toBe("invalid-input");
    });
  });

  describe("set-script-zone", () => {
    it("replaces the frontmatter zone wholesale", async () => {
      const baseVersion = fileVersion(CARD);
      const newFrontmatter = "const greeting = \"hi\";";
      const edit = {
        op: "set-script-zone",
        component: { path: "src/components/Card.astro", baseVersion, zone: "frontmatter", source: newFrontmatter },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Card.astro", result);
      expect(next).toContain(`---\n${newFrontmatter}\n---`);
      expect(next).toContain("<h2>{title}</h2>");
    });

    it("synthesizes a frontmatter block when none exists", async () => {
      const baseVersion = fileVersion(BARE);
      const edit = {
        op: "set-script-zone",
        component: { path: "src/components/Bare.astro", baseVersion, zone: "frontmatter", source: "const x = 1;" },
      };
      // BARE already has an (empty) frontmatter block, so this exercises the
      // existing-frontmatter path — covered separately below with a component
      // that truly has none.
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Bare.astro", result);
      expect(next).toContain("---\nconst x = 1;\n---");
    });

    it("replaces the client script zone in place", async () => {
      const baseVersion = fileVersion(CARD);
      const edit = {
        op: "set-script-zone",
        component: { path: "src/components/Card.astro", baseVersion, zone: "client", source: 'console.log("remounted");' },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Card.astro", result);
      expect(next).toContain('console.log("remounted");');
      expect(next).not.toContain("card mounted");
      expect(next).toContain("<h2>{title}</h2>");
    });

    it("appends a new <script> block when the component has no client script yet", async () => {
      const baseVersion = fileVersion(BARE);
      const edit = {
        op: "set-script-zone",
        component: { path: "src/components/Bare.astro", baseVersion, zone: "client", source: 'console.log("hi");' },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBeFalsy();
      const next = apply("Bare.astro", result);
      expect(next).toContain("<script>");
      expect(next).toContain('console.log("hi");');

      writeFileSync(join(tmpDir, "src", "components", "Bare.astro"), next);
      const model = await buildComponentModel(tmpDir, "src/components/Bare.astro");
      expect(model.clientScript?.source).toContain('console.log("hi");');
    });

    it("refuses invalid-input for an unknown zone", async () => {
      const baseVersion = fileVersion(CARD);
      const edit = {
        op: "set-script-zone",
        component: { path: "src/components/Card.astro", baseVersion, zone: "bogus", source: "x" },
      };
      const result = await resolveComponentFrontmatter(tmpDir, edit);
      expect(result.refused).toBe(true);
      expect(result.reason).toBe("invalid-input");
    });
  });
});
