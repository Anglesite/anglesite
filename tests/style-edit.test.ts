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

  // Fix 4: when only a <style is:global> block exists, a NEW scoped block is appended
  it("appends a new scoped <style> block when only is:global is present", () => {
    const src = `${FM}<h1 id="t">Hi</h1>\n<style is:global>\n  body { margin: 0; }\n</style>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Hi" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    // Now TWO <style blocks — original global + new scoped
    expect((r.next.match(/<style/g) || []).length).toBe(2);
    // The new rule is in the result
    expect(r.next).toMatch(/#t\s*\{[^}]*color:\s*teal/);
    // The original is:global block is byte-identical (untouched)
    expect(r.next).toContain("<style is:global>\n  body { margin: 0; }\n</style>");
    // The new block is a plain scoped <style>
    expect(r.next).toContain("<style>\n");
  });

  // Fix 4: two blocks — scoped block after global one receives the rule
  it("targets the scoped block when is:global comes first", () => {
    const src = `${FM}<h1 id="t">Hi</h1>\n<style is:global>\n  body { margin: 0; }\n</style>\n<style>\n  p { font-size: 1rem; }\n</style>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Hi" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    // Still two <style blocks
    expect((r.next.match(/<style/g) || []).length).toBe(2);
    // Rule went into the SCOPED block
    expect(r.next).toMatch(/#t\s*\{[^}]*color:\s*teal/);
    // The is:global block is untouched
    expect(r.next).toContain("<style is:global>\n  body { margin: 0; }\n</style>");
  });

  // Bug 2: setting a property that already exists should replace it, not duplicate it
  it("replaces an existing same-property declaration instead of duplicating it", () => {
    const src = `${FM}<h1 id="t">Hi</h1>\n<style>\n  #t { color: red; }\n</style>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", id: "t", classes: [], nthChild: 1, textContent: "Hi" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    expect(r.next).toContain("color: teal");
    expect(r.next).not.toContain("color: red");
    // Only one color declaration in the rule
    const ruleMatch = r.next.match(/#t\s*\{([^}]*)\}/);
    expect(ruleMatch).toBeTruthy();
    expect((ruleMatch![1].match(/color\s*:/g) || []).length).toBe(1);
  });

  // Bug 2 (superset check): a superset property name must not be stripped
  it("preserves background-color when setting color", () => {
    const src = `${FM}<h1 class="c">Hi</h1>\n<style>\n  .c { background-color: blue; }\n</style>\n`;
    const r = rewriteAstroStyle(src, { tag: "h1", classes: ["c"], nthChild: 1, textContent: "Hi" }, "color", "teal");
    expect(r.refused).toBeFalsy();
    expect(r.next).toContain("background-color: blue");
    expect(r.next).toContain("color: teal");
  });

  // Minor #5: multiple ambiguous candidates with no usable text anchor → reason "ambiguous"
  it("refuses with reason ambiguous when multiple candidate tags have no text anchor", () => {
    // Two <h1> tags with different text so textContent won't match either precisely when omitted
    const src = `${FM}<h1>Hello</h1>\n<h1>World</h1>\n`;
    // Selector with no id/class and a textContent that doesn't appear in source → no anchor
    const r = rewriteAstroStyle(src, { tag: "h1", classes: [], nthChild: 1, textContent: "NoSuchText" }, "color", "teal");
    expect(r.refused).toBe(true);
    expect(r.reason).toBe("ambiguous");
  });
});
