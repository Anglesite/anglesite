/**
 * Sticky-note badge rendering for annotation overlays.
 *
 * Creates pill-shaped badges pinned to annotated elements. Clicking a badge
 * expands it into a compact card showing all notes for that element.
 * Badges reposition on scroll/resize via requestAnimationFrame.
 *
 * All DOM is built via createElement (no innerHTML) and lives in the
 * document body alongside the Astro dev toolbar overlay.
 */

import { pickerTheme as t } from "./picker-theme.js";
import { computeBadgePosition, computeCardPosition } from "./sticky-position.js";
import { groupAnnotationsBySelector, type AnnotationGroup } from "./sticky-group.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Annotation {
  id: string;
  path: string;
  selector: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

interface BadgeState {
  group: AnnotationGroup;
  badgeEl: HTMLElement;
  expanded: boolean;
  cardEl: HTMLElement | null;
  target: Element;
}

type ResolveCallback = (id: string) => void;

// ---------------------------------------------------------------------------
// Safe DOM helpers (no innerHTML)
// ---------------------------------------------------------------------------

function h(tag: string, attrs?: Record<string, string>, children?: (Node | string)[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "textContent") el.textContent = v;
      else el.setAttribute(k, v);
    }
  }
  if (children) {
    for (const child of children) {
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build a pin icon as an SVG element using safe DOM API (no innerHTML). */
function createPinIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path1 = document.createElementNS(SVG_NS, "path");
  path1.setAttribute("d", "M12 17v5");
  svg.appendChild(path1);

  const path2 = document.createElementNS(SVG_NS, "path");
  path2.setAttribute("d", "M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z");
  svg.appendChild(path2);

  return svg;
}

// ---------------------------------------------------------------------------
// Badge Manager
// ---------------------------------------------------------------------------

export class StickyNoteManager {
  private badges = new Map<string, BadgeState>();
  private rafId: number | null = null;
  private active = true;
  private onResolve: ResolveCallback;

  constructor(onResolve: ResolveCallback) {
    this.onResolve = onResolve;
  }

  /**
   * Render badges for the given annotations on the current page.
   * Clears all existing badges first.
   */
  render(annotations: Annotation[]): void {
    this.clearAll();

    const pageAnnotations = annotations.filter(
      (a) => a.path === window.location.pathname && !a.resolved,
    );
    const groups = groupAnnotationsBySelector(pageAnnotations);

    for (const group of groups) {
      const target = document.querySelector(group.selector);
      if (!target) continue;
      this.createBadge(group, target);
    }

    this.startPositionLoop();
  }

  /**
   * Fade out and remove a specific annotation's badge.
   * If the badge group has other annotations, re-render the badge.
   */
  fadeOutAndRemove(annotationId: string): void {
    for (const [selector, state] of this.badges) {
      const idx = state.group.annotations.findIndex((a) => a.id === annotationId);
      if (idx === -1) continue;

      state.group.annotations.splice(idx, 1);
      state.group.count--;

      if (state.group.count === 0) {
        // Fade out the entire badge
        state.badgeEl.style.transition = `opacity ${t.fadeOutDuration} ease`;
        state.badgeEl.style.opacity = "0";
        state.cardEl?.remove();
        setTimeout(() => {
          state.badgeEl.remove();
          this.badges.delete(selector);
        }, parseFloat(t.fadeOutDuration) * 1000);
      } else {
        // Update badge count and re-render card if expanded
        this.updateBadgeLabel(state);
        if (state.expanded && state.cardEl) {
          state.cardEl.remove();
          state.cardEl = this.createCard(state);
        }
      }
      return;
    }
  }

  /** Set active/inactive state — inactive badges are muted. */
  setActive(active: boolean): void {
    this.active = active;
    for (const [, state] of this.badges) {
      state.badgeEl.style.opacity = active ? "1" : t.inactiveOpacity;
      state.badgeEl.style.transform = active ? "scale(1)" : "scale(0.85)";
      state.badgeEl.style.pointerEvents = active ? "auto" : "none";
      if (!active && state.expanded) {
        this.collapseCard(state);
      }
    }
    if (active) {
      this.startPositionLoop();
    } else {
      this.stopPositionLoop();
    }
  }

  /** Remove all badges and stop the position loop. */
  clearAll(): void {
    for (const [, state] of this.badges) {
      state.badgeEl.remove();
      state.cardEl?.remove();
    }
    this.badges.clear();
    this.stopPositionLoop();
  }

  // -------------------------------------------------------------------------
  // Badge creation
  // -------------------------------------------------------------------------

  private createBadge(group: AnnotationGroup, target: Element): void {
    const badge = h("div", {
      class: "anglesite-sticky-badge",
      role: "button",
      tabindex: "0",
      "aria-label": group.count === 1
        ? `Annotation: ${group.annotations[0].text.slice(0, 60)}`
        : `${group.count} annotations on this element`,
      "aria-expanded": "false",
    });

    badge.style.cssText = `
      position: fixed; z-index: 999998;
      display: inline-flex; align-items: center; gap: 4px;
      height: ${t.badgeHeight}; padding: ${t.badgePadding};
      background: ${t.badgeSurface}; color: ${t.text};
      border: 1px solid ${t.badgeBorder}; border-radius: 999px;
      font-size: 11px; font-family: ${t.fontFamily};
      cursor: pointer; pointer-events: auto;
      box-shadow: ${t.shadow};
      transition: opacity ${t.transitionDuration} ease,
                  transform ${t.transitionDuration} ease;
      user-select: none; white-space: nowrap;
    `;

    // Pin icon (built via DOM API — no innerHTML)
    const icon = h("span");
    icon.style.cssText = `display: inline-flex; align-items: center; color: ${t.accent};`;
    icon.appendChild(createPinIcon());
    badge.appendChild(icon);

    // Label
    const label = h("span", {
      textContent: group.count === 1 ? "1" : String(group.count),
    });
    label.style.cssText = `font-weight: 600; color: ${t.text};`;
    badge.appendChild(label);

    const state: BadgeState = {
      group,
      badgeEl: badge,
      expanded: false,
      cardEl: null,
      target,
    };

    // Click to expand/collapse
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.expanded) {
        this.collapseCard(state);
      } else {
        this.expandCard(state);
      }
    });

    // Keyboard: Enter/Space to toggle, Escape to collapse
    badge.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        badge.click();
      } else if (e.key === "Escape" && state.expanded) {
        e.preventDefault();
        this.collapseCard(state);
      }
    });

    // Position and add to DOM
    this.positionBadge(state);
    document.body.appendChild(badge);
    this.badges.set(group.selector, state);

    // Apply inactive state if toolbar is inactive
    if (!this.active) {
      badge.style.opacity = t.inactiveOpacity;
      badge.style.transform = "scale(0.85)";
      badge.style.pointerEvents = "none";
    }
  }

  private updateBadgeLabel(state: BadgeState): void {
    const label = state.badgeEl.querySelector("span:last-child");
    if (label) {
      label.textContent = state.group.count === 1 ? "1" : String(state.group.count);
    }
    state.badgeEl.setAttribute(
      "aria-label",
      state.group.count === 1
        ? `Annotation: ${state.group.annotations[0].text.slice(0, 60)}`
        : `${state.group.count} annotations on this element`,
    );
  }

  // -------------------------------------------------------------------------
  // Expanded card
  // -------------------------------------------------------------------------

  private expandCard(state: BadgeState): void {
    // Collapse any other expanded cards first
    for (const [, other] of this.badges) {
      if (other.expanded && other !== state) {
        this.collapseCard(other);
      }
    }

    state.expanded = true;
    state.badgeEl.setAttribute("aria-expanded", "true");
    state.cardEl = this.createCard(state);
  }

  private collapseCard(state: BadgeState): void {
    state.expanded = false;
    state.badgeEl.setAttribute("aria-expanded", "false");
    if (state.cardEl) {
      state.cardEl.style.transition = `opacity ${t.transitionDuration} ease`;
      state.cardEl.style.opacity = "0";
      const el = state.cardEl;
      setTimeout(() => el.remove(), parseFloat(t.transitionDuration) * 1000);
      state.cardEl = null;
    }
  }

  private createCard(state: BadgeState): HTMLElement {
    const cardWidth = 260;
    const estimatedHeight = 40 + state.group.annotations.length * 56;
    const cardHeight = Math.min(estimatedHeight, 280);

    const badgeRect = state.badgeEl.getBoundingClientRect();
    const badgePos = { top: badgeRect.top, left: badgeRect.left };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);

    const card = h("div", {
      class: "anglesite-sticky-card",
      role: "region",
      "aria-label": "Annotation details",
    });

    card.style.cssText = `
      position: fixed; z-index: 999999;
      top: ${pos.top}px; left: ${pos.left}px;
      width: ${cardWidth}px; max-height: ${cardHeight}px;
      overflow-y: auto;
      background: ${t.surface}; color: ${t.text};
      border: 1px solid ${t.border}; border-radius: ${t.radius};
      box-shadow: ${t.shadow};
      font-family: ${t.fontFamily};
      padding: 8px 0;
      opacity: 0;
      transition: opacity ${t.transitionDuration} ease;
    `;

    // Animate in
    requestAnimationFrame(() => {
      card.style.opacity = "1";
    });

    for (const annotation of state.group.annotations) {
      const item = h("div");
      item.style.cssText = `
        padding: 6px 12px;
        display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
      `;

      const textEl = h("div", { textContent: annotation.text });
      textEl.style.cssText = `
        font-size: 12px; color: ${t.text}; flex: 1;
        line-height: 1.4;
      `;

      const resolveBtn = h("button", {
        "aria-label": "Resolve annotation",
        textContent: "\u2713",
      });
      resolveBtn.style.cssText = `
        background: none; border: none; cursor: pointer;
        color: ${t.textFaint}; font-size: 14px;
        padding: 2px 4px; border-radius: 4px; flex-shrink: 0;
        transition: color ${t.transitionDuration}, background ${t.transitionDuration};
      `;
      resolveBtn.addEventListener("mouseenter", () => {
        resolveBtn.style.color = t.success;
        resolveBtn.style.background = t.successMuted;
      });
      resolveBtn.addEventListener("mouseleave", () => {
        resolveBtn.style.color = t.textFaint;
        resolveBtn.style.background = "none";
      });
      resolveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onResolve(annotation.id);
      });

      item.appendChild(textEl);
      item.appendChild(resolveBtn);
      card.appendChild(item);
    }

    // Close card when clicking outside
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!card.contains(e.target as Node) && !state.badgeEl.contains(e.target as Node)) {
        this.collapseCard(state);
        document.removeEventListener("click", closeOnOutsideClick, true);
      }
    };
    // Delay to avoid immediately closing from the badge click event
    setTimeout(() => {
      document.addEventListener("click", closeOnOutsideClick, true);
    }, 0);

    document.body.appendChild(card);
    return card;
  }

  // -------------------------------------------------------------------------
  // Positioning loop (scroll/resize)
  // -------------------------------------------------------------------------

  private positionBadge(state: BadgeState): void {
    const rect = state.target.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const pos = computeBadgePosition(
      { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height },
      viewport,
    );
    state.badgeEl.style.top = `${pos.top}px`;
    state.badgeEl.style.left = `${pos.left}px`;

    // Hide badge if target is completely off-screen
    const isVisible = rect.bottom > 0 && rect.top < viewport.height &&
                      rect.right > 0 && rect.left < viewport.width;
    state.badgeEl.style.display = isVisible ? "inline-flex" : "none";
  }

  private positionAllBadges = (): void => {
    for (const [, state] of this.badges) {
      this.positionBadge(state);
    }
    this.rafId = requestAnimationFrame(this.positionAllBadges);
  };

  private startPositionLoop(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.positionAllBadges);
  }

  private stopPositionLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
