/**
 * Positioning logic for annotation sticky-note badges and expanded cards.
 *
 * Pure functions — no DOM access. Accepts rects and viewport dimensions,
 * returns { top, left } coordinates for fixed-position placement.
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

/** Badge pill dimensions (matches rendering in sticky-notes.ts) */
const BADGE_HEIGHT = 24;
/** Offset: badge overlaps the element edge by this many pixels */
const BADGE_OVERLAP = 12;
/** Gap between badge and expanded card */
const CARD_GAP = 6;
/** Minimum distance from viewport edge */
const MIN_PADDING = 8;

/**
 * Compute the position of a collapsed pill badge relative to its target element.
 *
 * Places the badge at the top-right corner of the element, offset so it
 * sits half above the element's top edge and overlaps the right edge slightly.
 * Clamps to viewport bounds.
 */
export function computeBadgePosition(rect: Rect, viewport: Viewport): Position {
  let top = rect.top - BADGE_OVERLAP;
  let left = rect.right - BADGE_OVERLAP;

  // Clamp to viewport
  top = Math.max(0, top);
  left = Math.max(0, Math.min(left, viewport.width - 4));

  return { top, left };
}

/**
 * Compute the position of an expanded annotation card relative to a badge.
 *
 * Prefers below the badge; flips above if insufficient space.
 * Clamps horizontally and vertically to stay within the viewport.
 */
export function computeCardPosition(
  badgePos: Position,
  viewport: Viewport,
  cardWidth: number,
  cardHeight: number,
): Position {
  const belowTop = badgePos.top + BADGE_HEIGHT + CARD_GAP;
  const aboveTop = badgePos.top - cardHeight - CARD_GAP;

  // Vertical: prefer below, flip above if not enough space
  let top: number;
  if (belowTop + cardHeight <= viewport.height) {
    top = belowTop;
  } else if (aboveTop >= 0) {
    top = aboveTop;
  } else {
    // Neither fits — pick the side with more room, clamp
    top = belowTop + cardHeight <= viewport.height ? belowTop : aboveTop;
  }
  top = Math.max(0, Math.min(top, viewport.height - cardHeight));

  // Horizontal: align with badge, clamp to viewport
  let left = badgePos.left;
  left = Math.max(MIN_PADDING, Math.min(left, viewport.width - cardWidth - MIN_PADDING));

  return { top, left };
}
