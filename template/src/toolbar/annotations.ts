/**
 * Anglesite Annotations — Astro Dev Toolbar App
 *
 * Lets users pin visual feedback notes onto page elements.
 * Click the 📌 toolbar button to enter picker mode, click any element
 * to attach a note. Notes are persisted via the server-side integration
 * and exposed as MCP tools for Claude to read and resolve.
 */

import { defineToolbarApp } from "astro/toolbar";
import { pickerTheme as t } from "./picker-theme.js";
import { computePopoverPosition } from "./picker-position.js";
import { StickyNoteManager } from "./sticky-notes.js";

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

interface ElementInfo {
  tag: string;
  id?: string;
  classes: string[];
  nthChild: number;
  dataAnglesiteId?: string;
  ancestors: Array<{ tag: string; id?: string; classes?: string[] }>;
}

// ---------------------------------------------------------------------------
// CSS selector generation (runs in browser)
// ---------------------------------------------------------------------------

function getElementInfo(el: Element): ElementInfo {
  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const classes = Array.from(el.classList);
  const dataAnglesiteId = el.getAttribute("data-anglesite-id") || undefined;

  // Calculate nth-child position
  let nthChild = 1;
  if (el.parentElement) {
    const siblings = Array.from(el.parentElement.children);
    nthChild = siblings.indexOf(el) + 1;
  }

  // Walk ancestors up to body, stopping at first id
  const ancestors: ElementInfo["ancestors"] = [];
  let current = el.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    ancestors.unshift({
      tag: current.tagName.toLowerCase(),
      id: current.id || undefined,
      classes: Array.from(current.classList),
    });
    if (current.id) break;
    current = current.parentElement;
  }

  return { tag, id, classes, nthChild, dataAnglesiteId, ancestors };
}

function buildSelector(info: ElementInfo): string {
  if (info.dataAnglesiteId) {
    return `[data-anglesite-id="${info.dataAnglesiteId}"]`;
  }

  const selfPart = selectorPart(info);
  if (!info.ancestors || info.ancestors.length === 0) return selfPart;

  const parts: string[] = [];
  for (const ancestor of info.ancestors) {
    if (ancestor.id) {
      parts.push(`#${ancestor.id}`);
      const idx = info.ancestors.indexOf(ancestor);
      for (let i = idx + 1; i < info.ancestors.length; i++) {
        parts.push(selectorPart(info.ancestors[i]));
      }
      break;
    }
  }
  if (parts.length === 0) {
    for (const ancestor of info.ancestors) {
      parts.push(selectorPart(ancestor));
    }
  }
  parts.push(selfPart);
  return parts.join(" > ");
}

function selectorPart(info: { tag: string; id?: string; classes?: string[]; nthChild?: number }): string {
  if (info.id) return `#${info.id}`;
  const tag = info.tag.toLowerCase();
  const classes = info.classes || [];
  if (classes.length > 0) return `${tag}.${classes.join(".")}`;
  return `${tag}:nth-child(${info.nthChild || 1})`;
}

// ---------------------------------------------------------------------------
// Safe DOM helpers (no innerHTML — all content built via DOM API)
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

// ---------------------------------------------------------------------------
// Toolbar App
// ---------------------------------------------------------------------------

export default defineToolbarApp({
  init(canvas, app, server) {
    let pickerActive = false;
    let hoveredElement: Element | null = null;
    let highlightOverlay: HTMLElement | null = null;

    // Sticky note badge manager (replaces old Map-based sticky notes)
    const stickyManager = new StickyNoteManager((id) => {
      server.send("anglesite:resolve-annotation", { id });
    });

    // -----------------------------------------------------------------------
    // Main UI — window with controls (built via DOM API)
    // -----------------------------------------------------------------------

    const win = document.createElement("astro-dev-toolbar-window");

    const style = document.createElement("style");
    style.textContent = `
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .header h2 { margin: 0; font-size: 14px; font-weight: 600; color: ${t.text}; font-family: ${t.fontFamily}; }
      .note-count { font-size: 12px; color: ${t.textMuted}; }
      .pick-btn {
        padding: 6px 14px; border-radius: ${t.radiusSmall}; border: 1px solid ${t.border};
        background: ${t.surface}; color: ${t.text}; cursor: pointer; font-size: 12px;
        font-family: ${t.fontFamily}; transition: all 0.15s;
      }
      .pick-btn:hover { background: ${t.accentMuted}; border-color: ${t.accent}; }
      .pick-btn.active { background: ${t.accent}; border-color: ${t.accent}; color: ${t.surface}; }
      .notes-list { max-height: 300px; overflow-y: auto; }
      .note-item {
        padding: 8px 10px; border-radius: ${t.radiusSmall}; margin-bottom: 6px;
        background: ${t.surface}; border: 1px solid ${t.border};
        display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
      }
      .note-text { font-size: 12px; color: ${t.text}; flex: 1; font-family: ${t.fontFamily}; }
      .note-meta { font-size: 10px; color: ${t.textFaint}; margin-top: 2px; }
      .resolve-btn {
        background: none; border: none; cursor: pointer; color: ${t.textFaint};
        font-size: 14px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0;
      }
      .resolve-btn:hover { color: ${t.success}; background: ${t.successMuted}; }
      .empty { text-align: center; padding: 20px; color: ${t.textMuted}; font-size: 12px; font-family: ${t.fontFamily}; }
    `;
    win.appendChild(style);

    // Header
    const header = h("div", { class: "header" });
    const headerLeft = h("div");
    const heading = h("h2", { textContent: "\u{1F4CC} Annotations" });
    const noteCount = h("div", { class: "note-count" });
    headerLeft.appendChild(heading);
    headerLeft.appendChild(noteCount);
    const pickBtn = h("button", { class: "pick-btn", textContent: "Pick Element" });
    header.appendChild(headerLeft);
    header.appendChild(pickBtn);
    win.appendChild(header);

    // Notes list
    const notesList = h("div", { class: "notes-list" });
    win.appendChild(notesList);

    canvas.appendChild(win);

    // -----------------------------------------------------------------------
    // Hover highlight overlay (positioned over hovered elements)
    // -----------------------------------------------------------------------

    function createHighlightOverlay() {
      const el = document.createElement("div");
      el.style.cssText = `
        position: fixed; pointer-events: none; z-index: 999999;
        border: 1.5px solid ${t.highlightBorder}; background: ${t.highlightBackground};
        border-radius: ${t.radiusSmall}; transition: all 0.1s ease;
      `;
      el.id = "anglesite-picker-highlight";
      document.body.appendChild(el);
      return el;
    }

    function moveHighlight(el: Element) {
      if (!highlightOverlay) return;
      const rect = el.getBoundingClientRect();
      highlightOverlay.style.top = `${rect.top}px`;
      highlightOverlay.style.left = `${rect.left}px`;
      highlightOverlay.style.width = `${rect.width}px`;
      highlightOverlay.style.height = `${rect.height}px`;
      highlightOverlay.style.display = "block";
    }

    function hideHighlight() {
      if (highlightOverlay) highlightOverlay.style.display = "none";
    }

    // -----------------------------------------------------------------------
    // Note input popover (built via DOM API)
    // -----------------------------------------------------------------------

    function showNoteInput(el: Element, selector: string) {
      document.getElementById("anglesite-note-input")?.remove();

      const rect = el.getBoundingClientRect();
      const popoverWidth = 280;
      const popoverHeight = 160;
      const pos = computePopoverPosition(
        { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
        popoverWidth,
        popoverHeight,
      );
      const popover = h("div", {
        id: "anglesite-note-input",
        style: `
          position: fixed; z-index: 1000000;
          top: ${pos.top}px; left: ${pos.left}px;
          width: ${popoverWidth}px; padding: 12px; border-radius: ${t.radius};
          background: ${t.surface}; border: 1px solid ${t.border};
          box-shadow: ${t.shadow};
          font-family: ${t.fontFamily};
        `,
      });

      const selectorLabel = h("div", {
        style: `font-size: 11px; color: ${t.textFaint}; margin-bottom: 6px;`,
        textContent: selector.length > 40 ? selector.slice(0, 37) + "..." : selector,
      });

      const textarea = document.createElement("textarea");
      textarea.id = "anglesite-note-text";
      textarea.rows = 3;
      textarea.placeholder = "What should be changed here?";
      textarea.style.cssText = `
        width: 100%; box-sizing: border-box; padding: 8px; border-radius: ${t.radiusSmall};
        border: 1px solid ${t.border}; background: ${t.surfaceMuted};
        color: ${t.text}; font-size: 13px; resize: none; font-family: inherit; outline: none;
      `;

      const btnRow = h("div", {
        style: "display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end;",
      });
      const cancelBtn = h("button", {
        style: `padding: 5px 14px; border-radius: ${t.radiusSmall}; border: 1px solid ${t.border};
                background: transparent; color: ${t.textMuted}; cursor: pointer; font-size: 12px;
                font-family: ${t.fontFamily};`,
        textContent: "Cancel",
      });
      const saveBtn = h("button", {
        style: `padding: 5px 14px; border-radius: ${t.radiusSmall}; border: none;
                background: ${t.accent}; color: ${t.surface}; cursor: pointer; font-size: 12px;
                font-family: ${t.fontFamily};`,
        textContent: "Save Note",
      });
      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      popover.appendChild(selectorLabel);
      popover.appendChild(textarea);
      popover.appendChild(btnRow);
      document.body.appendChild(popover);

      textarea.focus();

      cancelBtn.addEventListener("click", () => popover.remove());

      saveBtn.addEventListener("click", () => {
        const text = textarea.value.trim();
        if (!text) return;
        const path = window.location.pathname;
        server.send("anglesite:add-annotation", { path, selector, text });
        popover.remove();
      });

      textarea.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          saveBtn.click();
        }
        if (e.key === "Escape") {
          popover.remove();
        }
      });
    }

    // -----------------------------------------------------------------------
    // Sticky notes rendered on the page (delegated to StickyNoteManager)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Notes list in the panel
    // -----------------------------------------------------------------------

    function renderNotesList(annotations: Annotation[]) {
      const pageAnnotations = annotations.filter(
        (a) => a.path === window.location.pathname,
      );

      noteCount.textContent =
        annotations.length === 0
          ? "No notes yet"
          : `${pageAnnotations.length} on this page \u00B7 ${annotations.length} total`;

      // Clear list
      while (notesList.firstChild) notesList.removeChild(notesList.firstChild);

      if (annotations.length === 0) {
        notesList.appendChild(
          h("div", { class: "empty", textContent: 'Click "Pick Element" to add your first note.' }),
        );
        return;
      }

      for (const annotation of annotations) {
        const isCurrentPage = annotation.path === window.location.pathname;

        const textDiv = h("div", { class: "note-text", textContent: annotation.text });
        const metaDiv = h("div", {
          class: "note-meta",
          textContent: isCurrentPage
            ? annotation.selector
            : `${annotation.path} \u00B7 ${annotation.selector}`,
        });
        const infoDiv = h("div");
        infoDiv.appendChild(textDiv);
        infoDiv.appendChild(metaDiv);

        const resolveBtn = h("button", {
          class: "resolve-btn",
          title: "Mark as resolved",
          textContent: "\u2713",
        });
        resolveBtn.addEventListener("click", () => {
          server.send("anglesite:resolve-annotation", { id: annotation.id });
        });

        const item = h("div", { class: "note-item" });
        item.appendChild(infoDiv);
        item.appendChild(resolveBtn);
        notesList.appendChild(item);
      }
    }

    // -----------------------------------------------------------------------
    // Picker mode (hover → click → note input)
    // -----------------------------------------------------------------------

    function isToolbarElement(el: Element): boolean {
      return (
        el.closest("astro-dev-toolbar") !== null ||
        el.id === "anglesite-picker-highlight" ||
        el.id === "anglesite-note-input" ||
        el.closest("#anglesite-note-input") !== null ||
        el.classList.contains("anglesite-sticky-badge") ||
        el.classList.contains("anglesite-sticky-card")
      );
    }

    function onMouseMove(e: MouseEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isToolbarElement(el)) {
        hideHighlight();
        hoveredElement = null;
        return;
      }
      hoveredElement = el;
      moveHighlight(el);
    }

    function onMouseClick(e: MouseEvent) {
      if (!hoveredElement || isToolbarElement(hoveredElement)) return;

      e.preventDefault();
      e.stopPropagation();

      const target = hoveredElement;
      const info = getElementInfo(target);
      const selector = buildSelector(info);

      deactivatePicker();
      showNoteInput(target, selector);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        deactivatePicker();
      }
    }

    function preventNavigation(e: Event) {
      e.preventDefault();
      e.stopPropagation();
    }

    function activatePicker() {
      pickerActive = true;
      pickBtn.classList.add("active");
      pickBtn.textContent = "Cancel";
      highlightOverlay = createHighlightOverlay();
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onMouseClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("mousedown", preventNavigation, true);
      document.addEventListener("touchstart", preventNavigation, true);
      document.body.style.cursor = "crosshair";
    }

    function deactivatePicker() {
      pickerActive = false;
      pickBtn.classList.remove("active");
      pickBtn.textContent = "Pick Element";
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onMouseClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", preventNavigation, true);
      document.removeEventListener("touchstart", preventNavigation, true);
      document.body.style.cursor = "";
      hideHighlight();
      highlightOverlay?.remove();
      highlightOverlay = null;
      hoveredElement = null;
    }

    pickBtn.addEventListener("click", () => {
      if (pickerActive) deactivatePicker();
      else activatePicker();
    });

    // -----------------------------------------------------------------------
    // Server communication
    // -----------------------------------------------------------------------

    server.on<{ annotations: Annotation[] }>(
      "anglesite:annotations-response",
      ({ annotations }) => {
        renderNotesList(annotations);
        stickyManager.render(annotations);
      },
    );

    server.on<{ annotation: Annotation }>(
      "anglesite:annotation-response",
      () => {
        // Refresh the list after add/resolve
        server.send("anglesite:list-annotations", {});
      },
    );

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    app.onToggled(({ state }) => {
      if (state) {
        stickyManager.setActive(true);
        server.send("anglesite:list-annotations", {});
      } else {
        deactivatePicker();
        stickyManager.setActive(false);
      }
    });

    // Request initial annotations
    server.send("anglesite:list-annotations", {});
  },
});
