// Heuristic Props extraction from Astro frontmatter TypeScript. Deliberately
// regex-based (no TS compiler in the container): supports `interface Props`
// or `type Props = { ... }` with one `name?: type;` member per line, and
// defaults from `const { name = value } = Astro.props`. Anything fancier
// yields [] — the editor treats that as "no knobs", never an error.
export function parseProps(frontmatterSource) {
  const block = frontmatterSource.match(/(?:interface\s+Props|type\s+Props\s*=)\s*\{([\s\S]*?)\n\}/);
  if (!block) return [];
  const props = [];
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(\w+)(\?)?\s*:\s*([^;]+);?\s*(?:\/\/.*)?$/);
    if (m) props.push({ name: m[1], type: m[3].trim(), optional: Boolean(m[2]), default: null });
  }
  const destructure = frontmatterSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*Astro\.props/);
  if (destructure) {
    for (const part of splitTopLevel(destructure[1])) {
      const dm = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/s);
      if (!dm) continue;
      const prop = props.find((p) => p.name === dm[1]);
      if (prop) prop.default = dm[2].trim();
    }
  }
  return props;
}

// Split the destructure body on commas at bracket depth zero, outside string
// literals, so defaults like ["a", "b"] or { x: 1, y: 2 } survive whole.
function splitTopLevel(source) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}
