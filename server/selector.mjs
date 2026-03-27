/**
 * @typedef {{ tag: string, id?: string, classes?: string[], nthChild?: number }} AncestorInfo
 * @typedef {{ tag: string, id?: string, classes: string[], nthChild: number, ancestors?: AncestorInfo[], dataAnglesiteId?: string }} ElementInfo
 */

/**
 * Build a CSS selector from element metadata collected in the browser.
 *
 * Priority: data-anglesite-id > id > tag.classes > tag:nth-child(n)
 * Ancestor chain stops at the first element with an id.
 *
 * @param {ElementInfo} info
 * @returns {string}
 */
export function buildSelector(info) {
  if (info.dataAnglesiteId) {
    return `[data-anglesite-id="${info.dataAnglesiteId}"]`;
  }

  const selfPart = selectorPart(info);
  if (!info.ancestors || info.ancestors.length === 0) {
    return selfPart;
  }

  // Walk ancestors, stop at first id
  const parts = [];
  for (const ancestor of info.ancestors) {
    if (ancestor.id) {
      parts.push(`#${ancestor.id}`);
      // Include remaining ancestors after this id
      const idx = info.ancestors.indexOf(ancestor);
      for (let i = idx + 1; i < info.ancestors.length; i++) {
        parts.push(selectorPart(info.ancestors[i]));
      }
      break;
    }
  }

  // If no ancestor had an id, use all ancestors
  if (parts.length === 0) {
    for (const ancestor of info.ancestors) {
      parts.push(selectorPart(ancestor));
    }
  }

  parts.push(selfPart);
  return parts.join(" > ");
}

/** Build selector fragment for a single element. */
function selectorPart(info) {
  if (info.id) {
    return `#${info.id}`;
  }

  const tag = info.tag.toLowerCase();
  const classes = info.classes || [];

  if (classes.length > 0) {
    return `${tag}.${classes.join(".")}`;
  }

  return `${tag}:nth-child(${info.nthChild || 1})`;
}
