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
    for (const part of destructure[1].split(",")) {
      const dm = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/s);
      if (!dm) continue;
      const prop = props.find((p) => p.name === dm[1]);
      if (prop && isBalanced(dm[2].trim())) prop.default = dm[2].trim();
    }
  }
  return props;
}

// A comma inside a default (array/object/call/string literal) makes the naive
// comma-split above produce a truncated chunk. Rather than return that
// silently-wrong value, require balanced brackets and quotes and leave
// `default` null (unknown) when the chunk fails the check.
function isBalanced(value) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const open = [];
  for (const ch of value) {
    if (pairs[ch]) open.push(pairs[ch]);
    else if (Object.values(pairs).includes(ch) && open.pop() !== ch) return false;
  }
  const quotesEven = ['"', "'", "`"].every((q) => (value.split(q).length - 1) % 2 === 0);
  return open.length === 0 && quotesEven;
}
