import { describe, it, expect } from "vitest";
import {
  progressChecklist,
  barChart,
  comparisonTable,
  sitemapTree,
  timeline,
  type TldrawShape,
} from "../template/scripts/tldraw-helpers.js";

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

function validateShapes(shapes: TldrawShape[]) {
  for (const shape of shapes) {
    expect(shape.shapeId, "missing shapeId").toBeDefined();
    expect(shape._type, "missing _type").toBeDefined();
    expect(typeof shape.x).toBe("number");
    expect(typeof shape.y).toBe("number");
  }
}

// ---------------------------------------------------------------------------
// progressChecklist
// ---------------------------------------------------------------------------

describe("progressChecklist", () => {
  const items = [
    { label: "Create GitHub repo", done: true },
    { label: "Set up Cloudflare", done: true },
    { label: "Design interview", done: false },
    { label: "Deploy", done: false },
  ];

  it("returns shapes for all items", () => {
    const shapes = progressChecklist(items);
    // Each item needs at least a checkbox shape + label text
    expect(shapes.length).toBeGreaterThanOrEqual(items.length * 2);
  });

  it("returns valid tldraw shapes", () => {
    validateShapes(progressChecklist(items));
  });

  it("uses check-box for completed items", () => {
    const shapes = progressChecklist(items);
    const checkboxes = shapes.filter((s) => s._type === "check-box");
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it("uses rectangle or x-box for incomplete items", () => {
    const shapes = progressChecklist(items);
    const incomplete = shapes.filter(
      (s) => s._type === "rectangle" || s._type === "x-box",
    );
    expect(incomplete.length).toBeGreaterThan(0);
  });

  it("includes title shape", () => {
    const shapes = progressChecklist(items, "Setup Progress");
    const title = shapes.find(
      (s) => s._type === "text" && s.text === "Setup Progress",
    );
    expect(title).toBeDefined();
  });

  it("handles empty list", () => {
    const shapes = progressChecklist([]);
    expect(shapes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// barChart
// ---------------------------------------------------------------------------

describe("barChart", () => {
  const data = [
    { label: "/services", value: 58 },
    { label: "/", value: 45 },
    { label: "/about", value: 30 },
  ];

  it("returns shapes for all bars + labels", () => {
    const shapes = barChart(data, "Top Pages");
    expect(shapes.length).toBeGreaterThanOrEqual(data.length * 2);
  });

  it("returns valid tldraw shapes", () => {
    validateShapes(barChart(data, "Top Pages"));
  });

  it("includes a title", () => {
    const shapes = barChart(data, "Top Pages");
    const title = shapes.find(
      (s) => s._type === "text" && s.text === "Top Pages",
    );
    expect(title).toBeDefined();
  });

  it("bar widths are proportional to values", () => {
    const shapes = barChart(data, "Chart");
    const bars = shapes.filter(
      (s) => s._type === "rectangle" && s.w !== undefined && s.w > 0,
    );
    // First bar (58) should be wider than last bar (30)
    if (bars.length >= 2) {
      expect(bars[0].w).toBeGreaterThan(bars[bars.length - 1].w!);
    }
  });

  it("handles empty data", () => {
    const shapes = barChart([], "Empty");
    expect(shapes.length).toBeLessThanOrEqual(1); // just title or nothing
  });

  it("handles single item", () => {
    const shapes = barChart([{ label: "Home", value: 100 }], "One");
    validateShapes(shapes);
  });
});

// ---------------------------------------------------------------------------
// comparisonTable
// ---------------------------------------------------------------------------

describe("comparisonTable", () => {
  const options = ["Buttondown", "Mailchimp"];
  const criteria = [
    { name: "Free tier", values: ["100 subscribers", "500 contacts"] },
    { name: "Privacy", values: ["Excellent", "Good"] },
    { name: "Ease of use", values: ["Simple", "Complex"] },
  ];

  it("returns valid tldraw shapes", () => {
    validateShapes(comparisonTable(options, criteria));
  });

  it("includes option names as text", () => {
    const shapes = comparisonTable(options, criteria);
    const texts = shapes.filter((s) => s._type === "text").map((s) => s.text);
    expect(texts.some((t) => t?.includes("Buttondown"))).toBe(true);
    expect(texts.some((t) => t?.includes("Mailchimp"))).toBe(true);
  });

  it("includes criteria names", () => {
    const shapes = comparisonTable(options, criteria);
    const texts = shapes.filter((s) => s._type === "text").map((s) => s.text);
    expect(texts.some((t) => t?.includes("Free tier"))).toBe(true);
  });

  it("includes cell values", () => {
    const shapes = comparisonTable(options, criteria);
    const texts = shapes.filter((s) => s._type === "text").map((s) => s.text);
    expect(texts.some((t) => t?.includes("100 subscribers"))).toBe(true);
  });

  it("handles empty criteria", () => {
    const shapes = comparisonTable(["A", "B"], []);
    validateShapes(shapes);
  });
});

// ---------------------------------------------------------------------------
// sitemapTree
// ---------------------------------------------------------------------------

describe("sitemapTree", () => {
  const pages = [
    { name: "Home", path: "/", children: ["Blog", "Services", "About"] },
    { name: "Blog", path: "/blog" },
    { name: "Services", path: "/services" },
    { name: "About", path: "/about" },
  ];

  it("returns valid tldraw shapes", () => {
    validateShapes(sitemapTree(pages));
  });

  it("includes shapes for all pages", () => {
    const shapes = sitemapTree(pages);
    const texts = shapes.filter((s) => s._type === "text" || s.text).map((s) => s.text);
    expect(texts.some((t) => t?.includes("Home"))).toBe(true);
    expect(texts.some((t) => t?.includes("Blog"))).toBe(true);
  });

  it("includes arrows for parent-child relationships", () => {
    const shapes = sitemapTree(pages);
    const arrows = shapes.filter((s) => s._type === "arrow");
    expect(arrows.length).toBeGreaterThan(0);
  });

  it("handles single page", () => {
    const shapes = sitemapTree([{ name: "Home", path: "/" }]);
    validateShapes(shapes);
  });
});

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

describe("timeline", () => {
  const events = [
    { label: "Site created", date: "Jan 2026" },
    { label: "First deploy", date: "Feb 2026" },
    { label: "100 visitors", date: "Mar 2026" },
  ];

  it("returns valid tldraw shapes", () => {
    validateShapes(timeline(events));
  });

  it("includes event labels", () => {
    const shapes = timeline(events);
    const texts = shapes.filter((s) => s._type === "text").map((s) => s.text);
    expect(texts.some((t) => t?.includes("Site created"))).toBe(true);
    expect(texts.some((t) => t?.includes("100 visitors"))).toBe(true);
  });

  it("includes date labels", () => {
    const shapes = timeline(events);
    const texts = shapes.filter((s) => s._type === "text").map((s) => s.text);
    expect(texts.some((t) => t?.includes("Jan 2026"))).toBe(true);
  });

  it("events are positioned left to right", () => {
    const shapes = timeline(events);
    const textShapes = shapes.filter((s) => s._type === "text");
    // Check that x values generally increase
    const xs = textShapes.map((s) => s.x);
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
  });

  it("handles empty events", () => {
    const shapes = timeline([]);
    expect(shapes.length).toBe(0);
  });
});
