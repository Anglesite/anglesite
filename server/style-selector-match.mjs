// Purpose-built pattern matching against the outline tree's own tag/class/id
// data — NOT a general CSS-selector-vs-DOM engine. Bounded to the "obvious"
// case (a class or tag styling a node directly), consistent with this
// codebase's "deliberately regex/heuristic, refuse rather than guess"
// discipline (props-interface.mjs, frontmatter-imports.mjs). Anything with a
// combinator, pseudo-class, :global(), or attribute selector is "complex"
// and never matched here — callers treat that as "leave behind, warn."

const TAG_CLASS_RE = /^[a-zA-Z][\w-]*(\.[\w-]+)*$/;
const CLASS_ONLY_RE = /^(\.[\w-]+)+$/;
const ID_RE = /^#[\w-]+$/;

export function isSimpleSelector(selector) {
  const s = selector.trim();
  if (!s) return false;
  return TAG_CLASS_RE.test(s) || CLASS_ONLY_RE.test(s) || ID_RE.test(s);
}

export function selectorMatchesNode(selector, node) {
  const s = selector.trim();
  if (ID_RE.test(s)) {
    const id = node.attrs?.find((a) => a.name === "id")?.value;
    return id === s.slice(1);
  }
  if (!isSimpleSelector(s)) return false;
  const parts = s.split(".");
  const tag = parts[0]; // "" when the selector starts with "."
  const classes = parts.slice(1);
  if (tag && node.tag !== tag) return false;
  if (classes.length > 0) {
    const nodeClasses = (node.attrs?.find((a) => a.name === "class")?.value ?? "").split(/\s+/).filter(Boolean);
    if (!classes.every((c) => nodeClasses.includes(c))) return false;
  }
  return true;
}
