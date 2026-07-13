// Regex-based frontmatter import add/remove — deliberately no TS parser in
// the container, same discipline as props-interface.mjs's parseProps.
// Only default imports (`import X from "...";`) are modeled: that's the only
// shape Astro component usage generates (`import Badge from "./Badge.astro"`).

const IMPORT_LINE_RE = /^import\s+(\w+)\s+from\s+["']([^"']+)["'];?\r?\n?/gm;

/** Default-import lines only — named/namespace imports are left alone (never a component). */
export function parseImports(frontmatterSource) {
  const imports = [];
  let m;
  IMPORT_LINE_RE.lastIndex = 0;
  while ((m = IMPORT_LINE_RE.exec(frontmatterSource)) !== null) {
    imports.push({ localName: m[1], specifier: m[2], span: [m.index, m.index + m[0].length] });
  }
  return imports;
}

export function ensureImport(frontmatterSource, { localName, specifier }) {
  const imports = parseImports(frontmatterSource);
  if (imports.some((i) => i.specifier === specifier)) {
    return { source: frontmatterSource, added: false };
  }
  const line = `import ${localName} from "${specifier}";\n`;
  if (imports.length > 0) {
    const insertAt = imports[imports.length - 1].span[1];
    return {
      source: frontmatterSource.slice(0, insertAt) + line + frontmatterSource.slice(insertAt),
      added: true,
    };
  }
  // No existing imports: insert right after the frontmatter's leading newline (or at the very
  // start if the frontmatter source doesn't begin with one), so it lands as the first statement.
  const insertAt = frontmatterSource.startsWith("\n") ? 1 : 0;
  return {
    source: frontmatterSource.slice(0, insertAt) + line + frontmatterSource.slice(insertAt),
    added: true,
  };
}

export function pruneImportIfUnused(frontmatterSource, templateSourceAfterEdit, localName) {
  const imports = parseImports(frontmatterSource);
  const target = imports.find((i) => i.localName === localName);
  if (!target) return { source: frontmatterSource, removed: false };
  const stillUsed = new RegExp(`<${localName}\\b`).test(templateSourceAfterEdit);
  if (stillUsed) return { source: frontmatterSource, removed: false };
  return {
    source: frontmatterSource.slice(0, target.span[0]) + frontmatterSource.slice(target.span[1]),
    removed: true,
  };
}
