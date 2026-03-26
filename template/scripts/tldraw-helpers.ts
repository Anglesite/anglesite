/**
 * Tldraw visualization helpers.
 *
 * Generates tldraw shape arrays for common in-conversation visualizations:
 * progress checklists, bar charts, comparison tables, sitemap trees, and timelines.
 *
 * Used by skills to communicate visually with the site owner during
 * design, analytics, and planning conversations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TldrawShape {
  _type: string;
  shapeId: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  fill?: string;
  size?: string;
  font?: string;
  anchor?: string;
  maxWidth?: number | null;
  fromId?: string;
  toId?: string;
  [key: string]: unknown;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface BarDatum {
  label: string;
  value: number;
}

export interface ComparisonCriterion {
  name: string;
  values: string[];
}

export interface SitemapPage {
  name: string;
  path: string;
  children?: string[];
}

export interface TimelineEvent {
  label: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function uid(prefix: string): string {
  return `${prefix}-${++_id}`;
}

/** Reset ID counter (for deterministic tests if needed). */
export function resetIds(): void {
  _id = 0;
}

// ---------------------------------------------------------------------------
// progressChecklist
// ---------------------------------------------------------------------------

/**
 * Visual checklist with check-box shapes for done items.
 */
export function progressChecklist(
  items: ChecklistItem[],
  title?: string,
): TldrawShape[] {
  if (items.length === 0) return [];

  const shapes: TldrawShape[] = [];
  let yOffset = 0;

  if (title) {
    shapes.push({
      _type: "text",
      shapeId: uid("title"),
      x: 0,
      y: 0,
      text: title,
      color: "black",
      size: "l",
      font: "sans",
      anchor: "top-left",
    });
    yOffset = 60;
  }

  for (const item of items) {
    const boxId = uid("box");
    const labelId = uid("label");

    shapes.push({
      _type: item.done ? "check-box" : "rectangle",
      shapeId: boxId,
      x: 0,
      y: yOffset,
      w: 40,
      h: 40,
      color: item.done ? "green" : "grey",
      fill: item.done ? "tint" : "none",
    });

    shapes.push({
      _type: "text",
      shapeId: labelId,
      x: 60,
      y: yOffset + 8,
      text: item.label,
      color: item.done ? "black" : "grey",
      size: "m",
      font: "sans",
      anchor: "top-left",
    });

    yOffset += 60;
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// barChart
// ---------------------------------------------------------------------------

/**
 * Horizontal bar chart. Bar widths are proportional to values.
 */
export function barChart(
  data: BarDatum[],
  title: string,
): TldrawShape[] {
  const shapes: TldrawShape[] = [];

  shapes.push({
    _type: "text",
    shapeId: uid("title"),
    x: 0,
    y: 0,
    text: title,
    color: "black",
    size: "l",
    font: "sans",
    anchor: "top-left",
  });

  if (data.length === 0) return shapes;

  const maxValue = Math.max(...data.map((d) => d.value));
  const maxBarWidth = 400;
  const barHeight = 36;
  const gap = 16;
  const labelWidth = 140;
  let yOffset = 60;

  for (const datum of data) {
    const barWidth =
      maxValue > 0 ? Math.max(4, (datum.value / maxValue) * maxBarWidth) : 4;

    shapes.push({
      _type: "text",
      shapeId: uid("label"),
      x: labelWidth - 8,
      y: yOffset + 6,
      text: datum.label,
      color: "black",
      size: "s",
      font: "sans",
      anchor: "top-right",
    });

    shapes.push({
      _type: "rectangle",
      shapeId: uid("bar"),
      x: labelWidth,
      y: yOffset,
      w: barWidth,
      h: barHeight,
      color: "blue",
      fill: "solid",
    });

    shapes.push({
      _type: "text",
      shapeId: uid("val"),
      x: labelWidth + barWidth + 8,
      y: yOffset + 6,
      text: String(datum.value),
      color: "grey",
      size: "s",
      font: "mono",
      anchor: "top-left",
    });

    yOffset += barHeight + gap;
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// comparisonTable
// ---------------------------------------------------------------------------

/**
 * Side-by-side comparison table with headers and criteria rows.
 */
export function comparisonTable(
  options: string[],
  criteria: ComparisonCriterion[],
): TldrawShape[] {
  const shapes: TldrawShape[] = [];
  const colWidth = 200;
  const rowHeight = 50;
  const headerX = 0;
  const dataStartX = 160;

  // Column headers (option names)
  for (let i = 0; i < options.length; i++) {
    shapes.push({
      _type: "text",
      shapeId: uid("hdr"),
      x: dataStartX + i * colWidth + colWidth / 2,
      y: 0,
      text: options[i],
      color: "blue",
      size: "m",
      font: "sans",
      anchor: "top-center",
    });
  }

  // Criteria rows
  for (let r = 0; r < criteria.length; r++) {
    const y = (r + 1) * rowHeight;
    const criterion = criteria[r];

    // Row label
    shapes.push({
      _type: "text",
      shapeId: uid("row"),
      x: headerX,
      y,
      text: criterion.name,
      color: "black",
      size: "s",
      font: "sans",
      anchor: "top-left",
    });

    // Cell values
    for (let c = 0; c < criterion.values.length; c++) {
      shapes.push({
        _type: "text",
        shapeId: uid("cell"),
        x: dataStartX + c * colWidth + colWidth / 2,
        y,
        text: criterion.values[c],
        color: "grey",
        size: "s",
        font: "sans",
        anchor: "top-center",
      });
    }
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// sitemapTree
// ---------------------------------------------------------------------------

/**
 * Site navigation tree with boxes for pages and arrows for hierarchy.
 */
export function sitemapTree(pages: SitemapPage[]): TldrawShape[] {
  const shapes: TldrawShape[] = [];
  const pageMap = new Map<string, { id: string; x: number; y: number }>();

  const boxW = 160;
  const boxH = 60;
  const gapX = 40;
  const gapY = 100;

  // Find root pages (those with children or the first page)
  const roots = pages.filter((p) => p.children && p.children.length > 0);
  const rootPage = roots.length > 0 ? roots[0] : pages[0];
  if (!rootPage) return shapes;

  // Place root
  const rootId = uid("page");
  const rootX = 0;
  const rootY = 0;
  shapes.push({
    _type: "rectangle",
    shapeId: rootId,
    x: rootX,
    y: rootY,
    w: boxW,
    h: boxH,
    color: "blue",
    fill: "tint",
    text: rootPage.name,
    font: "sans",
    size: "s",
  });
  pageMap.set(rootPage.name, { id: rootId, x: rootX, y: rootY });

  // Place children
  if (rootPage.children) {
    const totalWidth =
      rootPage.children.length * boxW +
      (rootPage.children.length - 1) * gapX;
    const startX = rootX + boxW / 2 - totalWidth / 2;

    for (let i = 0; i < rootPage.children.length; i++) {
      const childName = rootPage.children[i];
      const childId = uid("page");
      const childX = startX + i * (boxW + gapX);
      const childY = rootY + boxH + gapY;

      shapes.push({
        _type: "rectangle",
        shapeId: childId,
        x: childX,
        y: childY,
        w: boxW,
        h: boxH,
        color: "light-blue",
        fill: "tint",
        text: childName,
        font: "sans",
        size: "s",
      });
      pageMap.set(childName, { id: childId, x: childX, y: childY });

      // Arrow from root to child
      shapes.push({
        _type: "arrow",
        shapeId: uid("arrow"),
        x: rootX + boxW / 2,
        y: rootY + boxH,
        x1: rootX + boxW / 2,
        y1: rootY + boxH,
        x2: childX + boxW / 2,
        y2: childY,
        color: "grey",
        fromId: rootId,
        toId: childId,
      });
    }
  }

  // Place remaining pages that aren't already placed
  let nextY =
    (pageMap.size > 1 ? rootY + boxH + gapY + boxH + gapY : rootY + boxH + gapY);
  for (const page of pages) {
    if (pageMap.has(page.name)) continue;
    const pageId = uid("page");
    shapes.push({
      _type: "rectangle",
      shapeId: pageId,
      x: 0,
      y: nextY,
      w: boxW,
      h: boxH,
      color: "light-blue",
      fill: "tint",
      text: page.name,
      font: "sans",
      size: "s",
    });
    pageMap.set(page.name, { id: pageId, x: 0, y: nextY });
    nextY += boxH + gapY;
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

/**
 * Horizontal timeline with circles for events and labels above/below.
 */
export function timeline(events: TimelineEvent[]): TldrawShape[] {
  if (events.length === 0) return [];

  const shapes: TldrawShape[] = [];
  const spacing = 240;
  const lineY = 100;
  const dotSize = 20;

  // Connecting line
  if (events.length > 1) {
    shapes.push({
      _type: "line",
      shapeId: uid("line"),
      x: 0,
      y: lineY + dotSize / 2,
      x1: 0,
      y1: lineY + dotSize / 2,
      x2: (events.length - 1) * spacing,
      y2: lineY + dotSize / 2,
      color: "grey",
      dash: "solid",
      size: "m",
    });
  }

  for (let i = 0; i < events.length; i++) {
    const x = i * spacing;
    const event = events[i];

    // Dot
    shapes.push({
      _type: "ellipse",
      shapeId: uid("dot"),
      x: x - dotSize / 2,
      y: lineY,
      w: dotSize,
      h: dotSize,
      color: "blue",
      fill: "solid",
    });

    // Date label (below)
    shapes.push({
      _type: "text",
      shapeId: uid("date"),
      x,
      y: lineY + dotSize + 16,
      text: event.date,
      color: "grey",
      size: "s",
      font: "mono",
      anchor: "top-center",
    });

    // Event label (above)
    shapes.push({
      _type: "text",
      shapeId: uid("event"),
      x,
      y: lineY - 12,
      text: event.label,
      color: "black",
      size: "s",
      font: "sans",
      anchor: "bottom-center",
      maxWidth: spacing - 20,
    });
  }

  return shapes;
}
