/**
 * @typedef {{ tag: string, id?: string, classes?: string[], nthChild?: number, role?: string, ariaLabel?: string }} AncestorInfo
 * @typedef {{ tag: string, id?: string, classes: string[], nthChild: number, ancestors?: AncestorInfo[], dataAnglesiteId?: string, dataTestId?: string, role?: string, ariaLabel?: string, textContent?: string }} ElementInfo
 */

/**
 * Build a CSS selector from element metadata collected in the browser.
 *
 * Priority: data-anglesite-id > data-testid > #id > [role]/[aria-label] > tag.stableClasses > tag:nth-child(n)
 * Ancestor chain stops at the first element with an id.
 *
 * @param {ElementInfo} info
 * @returns {string}
 */
export function buildSelector(info) {
  if (info.dataAnglesiteId) {
    return `[data-anglesite-id="${info.dataAnglesiteId}"]`;
  }

  if (info.dataTestId) {
    return `[data-testid="${info.dataTestId}"]`;
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

/**
 * Class name patterns that are unstable across builds and should be
 * filtered out of generated selectors.
 */
const UNSTABLE_CLASS_RE = /^astro-[A-Za-z0-9]+$/;

/** Filter classes to only those that are stable across builds. */
export function filterStableClasses(classes) {
  return (classes || []).filter((c) => !UNSTABLE_CLASS_RE.test(c));
}

/**
 * Validate a data-anglesite-id string.
 * Format: `page:component` where both segments are lowercase kebab-case.
 * @param {string} id
 * @returns {boolean}
 */
const ANGLESITE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidAnglesiteId(id) {
  return ANGLESITE_ID_RE.test(id);
}

/**
 * Build a well-formed data-anglesite-id from page and component names.
 * Trims, lowercases, and replaces spaces with dashes.
 * @param {string} page
 * @param {string} component
 * @returns {string}
 */
export function buildAnglesiteId(page, component) {
  const p = page.trim().toLowerCase().replace(/\s+/g, "-");
  const c = component.trim().toLowerCase().replace(/\s+/g, "-");
  if (!p) throw new Error("page segment must not be empty");
  if (!c) throw new Error("component segment must not be empty");
  return `${p}:${c}`;
}

/** Build selector fragment for a single element. */
function selectorPart(info) {
  if (info.id) {
    return `#${info.id}`;
  }

  const tag = info.tag.toLowerCase();
  const classes = filterStableClasses(info.classes);

  if (classes.length > 0) {
    return `${tag}.${classes.join(".")}`;
  }

  // ARIA attributes provide stable, semantic selectors
  const attrs = [];
  if (info.role) attrs.push(`[role="${info.role}"]`);
  if (info.ariaLabel) attrs.push(`[aria-label="${info.ariaLabel}"]`);
  if (attrs.length > 0) {
    return `${tag}${attrs.join("")}`;
  }

  return `${tag}:nth-child(${info.nthChild || 1})`;
}

const MAX_HINT_LENGTH = 80;

/**
 * Build a selector and an optional truncated text content hint for Claude.
 * The textHint is NOT used in the selector — it's context for source mapping.
 *
 * @param {ElementInfo} info
 * @returns {{ selector: string, textHint: string | null }}
 */
export function buildSelectorWithHint(info) {
  const selector = buildSelector(info);
  let textHint = null;

  if (info.textContent) {
    const normalized = info.textContent.replace(/\s+/g, " ").trim();
    textHint =
      normalized.length > MAX_HINT_LENGTH
        ? normalized.slice(0, MAX_HINT_LENGTH) + "…"
        : normalized;
  }

  return { selector, textHint };
}
