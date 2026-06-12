/**
 * Minimal YAML frontmatter reader for the content tools (#140 / A.6).
 *
 * The plugin has no YAML dependency, and `list_content` only needs a handful of scalar/array
 * fields (`title`, `slug`, `draft`, `publishDate`, `date`, `tags`) off article-like collection
 * entries. This parses exactly that subset — quoted/unquoted scalars, booleans, and string
 * arrays in both inline (`[a, b]`) and block (`- a`) form. It is deliberately NOT a general
 * YAML parser; anything it doesn't recognize is left out of the returned object rather than
 * guessed at.
 *
 * @param {string} source full file contents (frontmatter + body)
 * @returns {Record<string, string | boolean | string[]>} parsed scalar/array fields
 */
export function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};

  const out = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // Only top-level keys (no indentation) start a new field.
    if (/^\s/.test(line)) continue;

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rawValue = kv[2].trim();

    if (rawValue === "") {
      // Possible block array on the following indented `- item` lines.
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^\s*-\s+/, "").trim()));
        j++;
      }
      if (items.length) {
        out[key] = items;
        i = j - 1;
      } else {
        out[key] = "";
      }
      continue;
    }

    out[key] = parseScalarOrArray(rawValue);
  }
  return out;
}

function parseScalarOrArray(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Inline array: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => unquote(s.trim()));
  }
  return unquote(raw);
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
