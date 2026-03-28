/**
 * Group annotations by their CSS selector for badge rendering.
 *
 * When multiple annotations target the same element, they're displayed
 * as a single badge with a count. Expanding the badge shows all notes.
 */

interface Annotation {
  id: string;
  path: string;
  selector: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

export interface AnnotationGroup {
  /** CSS selector shared by all annotations in this group */
  selector: string;
  /** Number of annotations targeting this element */
  count: number;
  /** The annotations in this group, in original order */
  annotations: Annotation[];
}

/**
 * Group annotations by their CSS selector.
 *
 * Returns groups in first-occurrence order — the first annotation's selector
 * determines the group's position in the returned array.
 */
export function groupAnnotationsBySelector(annotations: Annotation[]): AnnotationGroup[] {
  const map = new Map<string, AnnotationGroup>();

  for (const annotation of annotations) {
    const existing = map.get(annotation.selector);
    if (existing) {
      existing.annotations.push(annotation);
      existing.count++;
    } else {
      map.set(annotation.selector, {
        selector: annotation.selector,
        count: 1,
        annotations: [annotation],
      });
    }
  }

  return Array.from(map.values());
}
