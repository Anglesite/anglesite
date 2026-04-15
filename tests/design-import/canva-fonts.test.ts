import { describe, it, expect } from "vitest";
import {
  parseCanvaFonts,
  mapToSystemStack,
} from "../../scripts/design-import/canva-fonts.mjs";

// ---------------------------------------------------------------------------
// parseCanvaFonts
// ---------------------------------------------------------------------------

describe("parseCanvaFonts", () => {
  it("filters out Canva system fonts and keeps user fonts", () => {
    const rules = [
      { family: "Montserrat" },
      { family: "Canva Sans" },
      { family: "Open Sans" },
      { family: "Noto Sans" },
    ];
    const result = parseCanvaFonts(rules);
    expect(result).toContain("Montserrat");
    expect(result).toContain("Open Sans");
    expect(result).not.toContain("Canva Sans");
    expect(result).not.toContain("Noto Sans");
  });

  it("deduplicates font families", () => {
    const rules = [
      { family: "Playfair Display" },
      { family: "Playfair Display" },
      { family: "Lato" },
    ];
    const result = parseCanvaFonts(rules);
    expect(result.filter((f) => f === "Playfair Display").length).toBe(1);
    expect(result).toContain("Lato");
  });

  it("returns empty array when only system fonts are present", () => {
    const rules = [
      { family: "Canva Sans" },
      { family: "Canva Sans Text" },
      { family: "Canva Sans Display" },
      { family: "Noto Sans" },
      { family: "Noto Serif" },
      { family: "Noto Color Emoji" },
    ];
    const result = parseCanvaFonts(rules);
    expect(result).toEqual([]);
  });

  it("filters Canva system fonts case-insensitively", () => {
    const rules = [
      { family: "canva sans" },
      { family: "NOTO SANS" },
      { family: "Inter" },
    ];
    const result = parseCanvaFonts(rules);
    expect(result).not.toContain("canva sans");
    expect(result).not.toContain("NOTO SANS");
    expect(result).toContain("Inter");
  });

  it("handles empty input", () => {
    expect(parseCanvaFonts([])).toEqual([]);
  });

  it("filters all Canva Sans variants", () => {
    const rules = [
      { family: "Canva Sans Text" },
      { family: "Canva Sans Display" },
      { family: "Roboto" },
    ];
    const result = parseCanvaFonts(rules);
    expect(result).not.toContain("Canva Sans Text");
    expect(result).not.toContain("Canva Sans Display");
    expect(result).toContain("Roboto");
  });
});

// ---------------------------------------------------------------------------
// mapToSystemStack
// ---------------------------------------------------------------------------

describe("mapToSystemStack", () => {
  it("maps geometric sans (Montserrat) to system-ui stack with category geometric-sans", () => {
    const result = mapToSystemStack("Montserrat");
    expect(result.category).toBe("geometric-sans");
    expect(result.stack).toBe('system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(result.original).toBe("Montserrat");
  });

  it("maps humanist sans (Open Sans) to system-ui stack with category humanist-sans", () => {
    const result = mapToSystemStack("Open Sans");
    expect(result.category).toBe("humanist-sans");
    expect(result.stack).toBe('system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(result.original).toBe("Open Sans");
  });

  it("maps serif (Playfair Display) to Georgia stack with category serif", () => {
    const result = mapToSystemStack("Playfair Display");
    expect(result.category).toBe("serif");
    expect(result.stack).toBe('Georgia, "Times New Roman", "Noto Serif", serif');
    expect(result.original).toBe("Playfair Display");
  });

  it("maps monospace (Fira Code) to monospace stack with category monospace", () => {
    const result = mapToSystemStack("Fira Code");
    expect(result.category).toBe("monospace");
    expect(result.stack).toBe('"SFMono-Regular", "Cascadia Code", "Fira Code", monospace');
    expect(result.original).toBe("Fira Code");
  });

  it("returns default-sans for unknown fonts", () => {
    const result = mapToSystemStack("SomeMadeUpFont");
    expect(result.category).toBe("default-sans");
    expect(result.stack).toBe('system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(result.original).toBe("SomeMadeUpFont");
  });

  it("maps slab serif (Roboto Slab) to slab-serif category", () => {
    const result = mapToSystemStack("Roboto Slab");
    expect(result.category).toBe("slab-serif");
    expect(result.stack).toBe('Georgia, "Rockwell", "Times New Roman", serif');
    expect(result.original).toBe("Roboto Slab");
  });

  it("maps other geometric sans fonts correctly", () => {
    const fonts = ["Poppins", "Raleway", "Nunito", "Outfit", "DM Sans"];
    for (const font of fonts) {
      const result = mapToSystemStack(font);
      expect(result.category).toBe("geometric-sans");
    }
  });

  it("maps other humanist sans fonts correctly", () => {
    const fonts = ["Lato", "Roboto", "Inter", "Work Sans", "Barlow"];
    for (const font of fonts) {
      const result = mapToSystemStack(font);
      expect(result.category).toBe("humanist-sans");
    }
  });

  it("maps other serif fonts correctly", () => {
    const fonts = ["Merriweather", "Lora", "EB Garamond", "DM Serif Display"];
    for (const font of fonts) {
      const result = mapToSystemStack(font);
      expect(result.category).toBe("serif");
    }
  });

  it("maps other monospace fonts correctly", () => {
    const fonts = ["JetBrains Mono", "Source Code Pro", "IBM Plex Mono"];
    for (const font of fonts) {
      const result = mapToSystemStack(font);
      expect(result.category).toBe("monospace");
    }
  });

  it("always returns the original font name in the result", () => {
    const result = mapToSystemStack("Playfair Display");
    expect(result.original).toBe("Playfair Display");
  });
});
