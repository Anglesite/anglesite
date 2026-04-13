/**
 * Popover positioning logic for the annotation picker.
 *
 * Handles edge cases: elements near viewport edges, small viewports,
 * and flipping above/below as needed.
 */

interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 8;
const MIN_PADDING = 8;

export function computePopoverPosition(
  rect: Rect,
  viewport: Viewport,
  popoverWidth: number,
  popoverHeight: number,
): Position {
  // Vertical: prefer below, flip above if not enough space
  const spaceBelow = viewport.height - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;

  let top: number;
  if (spaceBelow >= popoverHeight) {
    top = rect.bottom + GAP;
  } else if (spaceAbove >= popoverHeight) {
    top = rect.top - popoverHeight - GAP;
  } else {
    // Neither fits perfectly — pick the side with more space
    top = spaceBelow >= spaceAbove
      ? rect.bottom + GAP
      : rect.top - popoverHeight - GAP;
  }

  // Clamp vertical to stay on screen
  top = Math.max(0, Math.min(top, viewport.height - popoverHeight));

  // Horizontal: align with element left, clamp to viewport
  let left = rect.left;
  left = Math.max(MIN_PADDING, Math.min(left, viewport.width - popoverWidth - MIN_PADDING));

  return { top, left };
}
