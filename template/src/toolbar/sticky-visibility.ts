/**
 * Visibility detection for annotation badge targets.
 *
 * Pure function — no DOM access. Accepts a bounding rect and viewport
 * dimensions, returns whether the element intersects the viewport.
 */

interface VisibilityRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface Viewport {
  width: number;
  height: number;
}

/**
 * Determine whether an element is at least partially visible within the viewport.
 *
 * Returns false if the element is completely off-screen in any direction.
 * Boundary-exclusive: an element whose edge exactly touches the viewport
 * boundary (e.g. bottom === 0) is considered off-screen.
 */
export function isElementVisible(rect: VisibilityRect, viewport: Viewport): boolean {
  return rect.bottom > 0 && rect.top < viewport.height &&
         rect.right > 0 && rect.left < viewport.width;
}
