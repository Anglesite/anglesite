/**
 * Label generation for annotation sticky-note badges.
 *
 * Pure functions — no DOM access. Used by StickyNoteManager to generate
 * accessible ARIA labels and visible badge text.
 */

/** Maximum length of annotation text shown in an ARIA label. */
const MAX_PREVIEW_LENGTH = 60;

/**
 * Generate an ARIA label for a badge based on its annotation count.
 *
 * - Single annotation: "Annotation: <text preview>"
 * - Multiple annotations: "<count> annotations on this element"
 */
export function badgeAriaLabel(count: number, annotations: { text: string }[]): string {
  if (count === 1) {
    return `Annotation: ${annotations[0].text.slice(0, MAX_PREVIEW_LENGTH)}`;
  }
  return `${count} annotations on this element`;
}

/**
 * Generate the visible label text for a badge pill.
 *
 * Always returns the count as a string ("1", "2", etc.).
 */
export function badgeLabelText(count: number): string {
  return String(count);
}
