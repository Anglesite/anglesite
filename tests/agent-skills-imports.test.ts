// Guard for the Open Agent Skills export (agent-skills/): every relative
// import specifier in a bundled .mjs script must resolve to a file that was
// also bundled. Uses its own specifier regex, independent of the transformer's,
// so a bug in the builder's extraction can't hide from this test.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";

const OUT_DIR = resolve(__dirname, "..", "agent-skills");

// Static imports/re-exports (`from './x.mjs'`), side-effect imports
// (`import './x.mjs'`), and dynamic `import('./x.mjs')`.
const RELATIVE_IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

function walkMjs(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => join(e.parentPath, e.name));
}

describe("agent-skills bundled .mjs relative imports", () => {
  const files = walkMjs(OUT_DIR);

  it("finds bundled .mjs scripts to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(OUT_DIR, f).split(sep).join("/"), f]))(
    "%s resolves all relative imports within the bundle",
    (_label, file) => {
      const source = readFileSync(file, "utf-8");
      for (const m of source.matchAll(RELATIVE_IMPORT_RE)) {
        const spec = m[1];
        const target = resolve(dirname(file), spec);
        expect(
          existsSync(target),
          `imports ${spec} but ${relative(OUT_DIR, target)} is missing from the bundle`,
        ).toBe(true);
        expect(
          relative(OUT_DIR, target).startsWith(".."),
          `imports ${spec} which escapes agent-skills/`,
        ).toBe(false);
      }
    },
  );
});
