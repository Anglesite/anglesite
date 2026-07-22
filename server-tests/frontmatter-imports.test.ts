import { describe, it, expect } from "vitest";
import { parseImports, ensureImport, pruneImportIfUnused } from "../server/frontmatter-imports.mjs";

const FM_WITH_IMPORTS = `
import Badge from "./Badge.astro";
import { formatDate } from "../lib/dates";
interface Props { title: string; }
`;

describe("parseImports", () => {
  it("finds default-import lines with local name, specifier, and line span", () => {
    const imports = parseImports(FM_WITH_IMPORTS);
    const badge = imports.find((i) => i.localName === "Badge");
    expect(badge.specifier).toBe("./Badge.astro");
    expect(FM_WITH_IMPORTS.slice(badge.span[0], badge.span[1])).toBe('import Badge from "./Badge.astro";\n');
  });

  it("ignores named imports (not component-shaped)", () => {
    const imports = parseImports(FM_WITH_IMPORTS);
    expect(imports.some((i) => i.specifier === "../lib/dates")).toBe(false);
  });

  it("returns [] for frontmatter with no imports", () => {
    expect(parseImports("interface Props {}\n")).toEqual([]);
  });
});

describe("ensureImport", () => {
  it("appends a new import after the last existing import", () => {
    const { source, added } = ensureImport(FM_WITH_IMPORTS, { localName: "Callout", specifier: "./Callout.astro" });
    expect(added).toBe(true);
    expect(source).toContain('import Callout from "./Callout.astro";');
    expect(source.indexOf('import Callout')).toBeGreaterThan(source.indexOf('import Badge'));
    expect(source.indexOf('import Callout')).toBeLessThan(source.indexOf('interface Props'));
  });

  it("inserts at the very start when there are no existing imports", () => {
    const { source, added } = ensureImport("interface Props {}\n", { localName: "Callout", specifier: "./Callout.astro" });
    expect(added).toBe(true);
    expect(source.indexOf('import Callout')).toBeLessThan(source.indexOf('interface Props'));
  });

  it("is a no-op when an import for the same specifier already exists", () => {
    const { source, added } = ensureImport(FM_WITH_IMPORTS, { localName: "Badge", specifier: "./Badge.astro" });
    expect(added).toBe(false);
    expect(source).toBe(FM_WITH_IMPORTS);
  });
});

describe("pruneImportIfUnused", () => {
  it("removes the import line when the tag no longer appears in the template", () => {
    const { source, removed } = pruneImportIfUnused(FM_WITH_IMPORTS, "<article><h2>gone</h2></article>", "Badge");
    expect(removed).toBe(true);
    expect(source).not.toContain("Badge");
  });

  it("keeps the import when the tag is still used", () => {
    const { source, removed } = pruneImportIfUnused(FM_WITH_IMPORTS, "<article><Badge label=\"x\" /></article>", "Badge");
    expect(removed).toBe(false);
    expect(source).toBe(FM_WITH_IMPORTS);
  });

  it("is a no-op when there is no import for that name", () => {
    const { source, removed } = pruneImportIfUnused(FM_WITH_IMPORTS, "<article></article>", "Nope");
    expect(removed).toBe(false);
    expect(source).toBe(FM_WITH_IMPORTS);
  });
});
