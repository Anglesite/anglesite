import { describe, it, expect } from "vitest";
import { buildSelector, isValidAnglesiteId, buildAnglesiteId, buildSelectorWithHint } from "../server/selector.mjs";

// ---------------------------------------------------------------------------
// buildSelector — generate a unique CSS selector from element metadata
// ---------------------------------------------------------------------------

describe("buildSelector", () => {
  it("returns id selector when element has an id", () => {
    expect(buildSelector({ id: "hero", tag: "h1", classes: [], nthChild: 1 })).toBe(
      "#hero",
    );
  });

  it("returns tag + class selector when classes are present", () => {
    expect(
      buildSelector({ tag: "h1", classes: ["hero", "large"], nthChild: 1 }),
    ).toBe("h1.hero.large");
  });

  it("returns tag + nth-child when no id or classes", () => {
    expect(buildSelector({ tag: "div", classes: [], nthChild: 3 })).toBe(
      "div:nth-child(3)",
    );
  });

  it("builds a path from ancestors", () => {
    expect(
      buildSelector({
        tag: "p",
        classes: ["intro"],
        nthChild: 1,
        ancestors: [
          { tag: "main", id: "content" },
          { tag: "section", classes: ["about"] },
        ],
      }),
    ).toBe("#content > section.about > p.intro");
  });

  it("stops ancestor chain at an id", () => {
    expect(
      buildSelector({
        tag: "span",
        classes: [],
        nthChild: 2,
        ancestors: [
          { tag: "body" },
          { tag: "div", id: "app" },
          { tag: "p", classes: ["text"] },
        ],
      }),
    ).toBe("#app > p.text > span:nth-child(2)");
  });

  it("uses data-anglesite-id when present", () => {
    expect(
      buildSelector({
        tag: "div",
        classes: [],
        nthChild: 1,
        dataAnglesiteId: "cta-banner",
      }),
    ).toBe('[data-anglesite-id="cta-banner"]');
  });

  it("prefers data-anglesite-id over id", () => {
    expect(
      buildSelector({
        tag: "div",
        id: "banner",
        classes: [],
        nthChild: 1,
        dataAnglesiteId: "cta-banner",
      }),
    ).toBe('[data-anglesite-id="cta-banner"]');
  });

  it("handles tag-only elements with nth-child 1", () => {
    expect(buildSelector({ tag: "header", classes: [], nthChild: 1 })).toBe(
      "header:nth-child(1)",
    );
  });

  it("lowercases tag names", () => {
    expect(buildSelector({ tag: "DIV", classes: ["Foo"], nthChild: 1 })).toBe(
      "div.Foo",
    );
  });

  it("filters out astro-* hash classes", () => {
    expect(
      buildSelector({ tag: "div", classes: ["hero", "astro-J7PV25F6"], nthChild: 1 }),
    ).toBe("div.hero");
  });

  it("falls back to nth-child when all classes are unstable", () => {
    expect(
      buildSelector({ tag: "div", classes: ["astro-ABC123"], nthChild: 2 }),
    ).toBe("div:nth-child(2)");
  });

  it("filters unstable classes in ancestor chain too", () => {
    expect(
      buildSelector({
        tag: "p",
        classes: ["intro"],
        nthChild: 1,
        ancestors: [
          { tag: "section", classes: ["about", "astro-XYZ789"] },
        ],
      }),
    ).toBe("section.about > p.intro");
  });

  it("uses role attribute when no id or stable classes", () => {
    expect(
      buildSelector({ tag: "nav", classes: [], nthChild: 1, role: "navigation" }),
    ).toBe('nav[role="navigation"]');
  });

  it("uses aria-label with role for disambiguation", () => {
    expect(
      buildSelector({
        tag: "nav",
        classes: [],
        nthChild: 1,
        role: "navigation",
        ariaLabel: "Main",
      }),
    ).toBe('nav[role="navigation"][aria-label="Main"]');
  });

  it("uses aria-label alone when role is absent", () => {
    expect(
      buildSelector({ tag: "div", classes: [], nthChild: 1, ariaLabel: "Sidebar" }),
    ).toBe('div[aria-label="Sidebar"]');
  });

  it("prefers stable classes over ARIA attributes", () => {
    expect(
      buildSelector({
        tag: "nav",
        classes: ["main-nav"],
        nthChild: 1,
        role: "navigation",
      }),
    ).toBe("nav.main-nav");
  });

  it("uses data-testid when present and no higher-priority selector", () => {
    expect(
      buildSelector({ tag: "button", classes: [], nthChild: 1, dataTestId: "hero-cta" }),
    ).toBe('[data-testid="hero-cta"]');
  });

  it("prefers data-anglesite-id over data-testid", () => {
    expect(
      buildSelector({
        tag: "button",
        classes: [],
        nthChild: 1,
        dataAnglesiteId: "home:cta",
        dataTestId: "hero-cta",
      }),
    ).toBe('[data-anglesite-id="home:cta"]');
  });

  it("prefers data-testid over id", () => {
    expect(
      buildSelector({
        tag: "button",
        id: "cta",
        classes: [],
        nthChild: 1,
        dataTestId: "hero-cta",
      }),
    ).toBe('[data-testid="hero-cta"]');
  });
});

// ---------------------------------------------------------------------------
// isValidAnglesiteId — validate page:component-role format
// ---------------------------------------------------------------------------

describe("isValidAnglesiteId", () => {
  it("accepts page:component format", () => {
    expect(isValidAnglesiteId("about:hero-heading")).toBe(true);
  });

  it("accepts page:component with nested dashes", () => {
    expect(isValidAnglesiteId("contact:form-submit-button")).toBe(true);
  });

  it("accepts single-segment page name", () => {
    expect(isValidAnglesiteId("home:nav")).toBe(true);
  });

  it("rejects missing colon separator", () => {
    expect(isValidAnglesiteId("about-hero")).toBe(false);
  });

  it("rejects empty page segment", () => {
    expect(isValidAnglesiteId(":hero")).toBe(false);
  });

  it("rejects empty component segment", () => {
    expect(isValidAnglesiteId("about:")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidAnglesiteId("about:hero heading")).toBe(false);
  });

  it("rejects uppercase letters", () => {
    expect(isValidAnglesiteId("About:Hero")).toBe(false);
  });

  it("rejects multiple colons", () => {
    expect(isValidAnglesiteId("about:hero:sub")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAnglesiteId — construct well-formed id from page + component
// ---------------------------------------------------------------------------

describe("buildAnglesiteId", () => {
  it("joins page and component with colon", () => {
    expect(buildAnglesiteId("about", "hero-heading")).toBe("about:hero-heading");
  });

  it("lowercases and trims inputs", () => {
    expect(buildAnglesiteId("  About ", " Hero-Heading ")).toBe("about:hero-heading");
  });

  it("replaces spaces with dashes", () => {
    expect(buildAnglesiteId("about us", "hero heading")).toBe("about-us:hero-heading");
  });

  it("throws on empty page", () => {
    expect(() => buildAnglesiteId("", "hero")).toThrow(/page/i);
  });

  it("throws on empty component", () => {
    expect(() => buildAnglesiteId("about", "")).toThrow(/component/i);
  });
});

// ---------------------------------------------------------------------------
// buildSelectorWithHint — selector + truncated text content for Claude
// ---------------------------------------------------------------------------

describe("buildSelectorWithHint", () => {
  it("returns selector and textHint together", () => {
    const result = buildSelectorWithHint({
      tag: "h1",
      classes: ["hero"],
      nthChild: 1,
      textContent: "Welcome to our bakery",
    });
    expect(result.selector).toBe("h1.hero");
    expect(result.textHint).toBe("Welcome to our bakery");
  });

  it("truncates long textContent to 80 chars with ellipsis", () => {
    const long = "A".repeat(120);
    const result = buildSelectorWithHint({
      tag: "p",
      classes: [],
      nthChild: 1,
      textContent: long,
    });
    expect(result.textHint).toBe("A".repeat(80) + "…");
  });

  it("returns null textHint when no textContent", () => {
    const result = buildSelectorWithHint({
      tag: "div",
      classes: ["box"],
      nthChild: 1,
    });
    expect(result.selector).toBe("div.box");
    expect(result.textHint).toBeNull();
  });

  it("trims whitespace from textContent", () => {
    const result = buildSelectorWithHint({
      tag: "p",
      classes: [],
      nthChild: 1,
      textContent: "  hello world  ",
    });
    expect(result.textHint).toBe("hello world");
  });

  it("collapses internal whitespace", () => {
    const result = buildSelectorWithHint({
      tag: "p",
      classes: [],
      nthChild: 1,
      textContent: "hello   \n  world",
    });
    expect(result.textHint).toBe("hello world");
  });
});
