import { describe, it, expect } from "vitest";
import { rewriteAstroStyle } from "../server/style-edit.mjs";

const FM = "---\n---\n";

describe("rewriteAstroStyle", () => {
  it("targets an existing id and creates a scoped <style> block", () => {
    const src = `${FM}<h1 id="title">Welcome</h1>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", id: "title", classes: [], nthChild: 1, textContent: "Welcome" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    expect(r.selectorUsed).toBe("#title");
    expect(r.next).toContain("<style>");
    expect(r.next).toMatch(/#title\s*\{[^}]*color:\s*teal/);
    expect(r.addedMarkerClass).toBeUndefined();
  });

  it("adds a marker class when the element has no id or class", () => {
    const src = `${FM}<h1>Welcome</h1>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", classes: [], nthChild: 1, textContent: "Welcome" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    expect(r.addedMarkerClass).toMatch(/^ang-[0-9a-f]{6}$/);
    expect(r.next).toContain(`class="${r.addedMarkerClass}"`);
    expect(r.next).toMatch(new RegExp(`\\.${r.addedMarkerClass}\\s*\\{[^}]*color:\\s*teal`));
  });

  it("merges into an existing scoped <style> rule for the same selector", () => {
    const src = `${FM}<h1 id="t">Hi</h1>\n<style>\n  #t { font-size: 2rem; }\n</style>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Hi" }, "color", "teal");
    expect(r.next).toMatch(/#t\s*\{[^}]*font-size:\s*2rem/);
    expect(r.next).toMatch(/#t\s*\{[^}]*color:\s*teal/);
    expect((r.next.match(/<style>/g) || []).length).toBe(1); // no duplicate block
  });

  it("refuses when the element cannot be located", () => {
    const src = `${FM}<h1 id="t">Hi</h1>\n`;
    const r = rewriteAstroStyle(src, { tag: "h2", classes: [], nthChild: 1, textContent: "Missing" }, "color", "teal");
    expect(r.refused).toBe(true);
    expect(r.reason).toBe("no-match");
  });
});
