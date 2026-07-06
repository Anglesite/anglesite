import { describe, it, expect } from "vitest";
import { transform } from "@astrojs/compiler";

// Pins the `data-astro-source-loc` annotation convention that the Component
// Editor's selection-sync depends on (Anglesite-app `ComponentOutline.node(atLine:column:in:)`
// and `JS/edit-overlay/src/component-canvas.ts`'s `highlight`/`findByLoc`): Astro's dev
// server (via `transform(..., { annotateSourceFile: true })`) stamps the annotation at the
// END of an element's opening tag, not at its parse position. An element parsed at line L
// column 1 is annotated `L:C` for some `C > 1` — line matches, column never does exactly.
// If a future `@astrojs/compiler` version changes this convention, this test fails first,
// before the symptom shows up as broken selection sync in the app.
describe("data-astro-source-loc annotation convention", () => {
  it("stamps the end-of-opening-tag position, with a column strictly greater than the parse column", async () => {
    const source = `<div>\n  <h2>Hi</h2>\n</div>\n`;
    const result = await transform(source, {
      annotateSourceFile: true,
      filename: "Test.astro",
    });

    // <div> parses at line 1, column 1.
    const divMatch = result.code.match(/<div[^>]*data-astro-source-loc="(\d+):(\d+)"/);
    expect(divMatch).not.toBeNull();
    const [, divLine, divColumn] = divMatch!;
    expect(Number(divLine)).toBe(1);
    expect(Number(divColumn)).toBeGreaterThan(1);

    // <h2> parses at line 2, column 3 (after the two-space indent).
    const h2Match = result.code.match(/<h2[^>]*data-astro-source-loc="(\d+):(\d+)"/);
    expect(h2Match).not.toBeNull();
    const [, h2Line, h2Column] = h2Match!;
    expect(Number(h2Line)).toBe(2);
    expect(Number(h2Column)).toBeGreaterThan(3);
  });
});
