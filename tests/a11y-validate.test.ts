import { describe, it, expect } from "vitest";
import {
  validateHeadingHierarchy,
  validateLinkText,
  validateImageAlt,
  validateHtml,
  type A11yIssue,
} from "../template/scripts/a11y-validate.js";

// ---------------------------------------------------------------------------
// validateHeadingHierarchy
// ---------------------------------------------------------------------------

describe("validateHeadingHierarchy", () => {
  it("returns no issues for correct hierarchy", () => {
    const html = "<h1>Title</h1><h2>Section</h2><h3>Sub</h3>";
    expect(validateHeadingHierarchy(html)).toEqual([]);
  });

  it("flags skipped heading levels", () => {
    const html = "<h1>Title</h1><h3>Skipped h2</h3>";
    const issues = validateHeadingHierarchy(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("heading-skip");
    expect(issues[0].message).toContain("h3");
  });

  it("flags multiple h1 elements", () => {
    const html = "<h1>First</h1><h1>Second</h1>";
    const issues = validateHeadingHierarchy(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("heading-multiple-h1");
  });

  it("allows heading level to go back up (h3 → h2 is fine)", () => {
    const html = "<h1>Title</h1><h2>A</h2><h3>A1</h3><h2>B</h2>";
    expect(validateHeadingHierarchy(html)).toEqual([]);
  });

  it("flags when first heading is not h1", () => {
    const html = "<h2>Starts at h2</h2><h3>Sub</h3>";
    const issues = validateHeadingHierarchy(html);
    expect(issues.some((i) => i.rule === "heading-skip")).toBe(true);
  });

  it("returns no issues for empty content", () => {
    expect(validateHeadingHierarchy("")).toEqual([]);
    expect(validateHeadingHierarchy("<p>No headings</p>")).toEqual([]);
  });

  it("handles multiple skip violations", () => {
    const html = "<h1>Title</h1><h3>Skip</h3><h6>Big skip</h6>";
    const issues = validateHeadingHierarchy(html);
    expect(issues.filter((i) => i.rule === "heading-skip").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// validateLinkText
// ---------------------------------------------------------------------------

describe("validateLinkText", () => {
  it("returns no issues for descriptive link text", () => {
    const html = '<a href="/about">Learn about our services</a>';
    expect(validateLinkText(html)).toEqual([]);
  });

  it("flags 'click here'", () => {
    const html = '<a href="/about">click here</a>';
    const issues = validateLinkText(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("link-text-generic");
    expect(issues[0].message).toContain("click here");
  });

  it("flags 'read more'", () => {
    const html = '<a href="/post">Read More</a>';
    const issues = validateLinkText(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("link-text-generic");
  });

  it("flags 'here' as link text", () => {
    const html = '<a href="/page">here</a>';
    const issues = validateLinkText(html);
    expect(issues).toHaveLength(1);
  });

  it("flags 'learn more'", () => {
    const html = '<a href="/page">Learn more</a>';
    expect(validateLinkText(html)).toHaveLength(1);
  });

  it("flags 'more info'", () => {
    const html = '<a href="/page">more info</a>';
    expect(validateLinkText(html)).toHaveLength(1);
  });

  it("flags multiple bad links", () => {
    const html =
      '<a href="/a">click here</a> and <a href="/b">read more</a>';
    expect(validateLinkText(html)).toHaveLength(2);
  });

  it("ignores links with aria-label", () => {
    const html = '<a href="/page" aria-label="View our pricing">here</a>';
    expect(validateLinkText(html)).toEqual([]);
  });

  it("flags empty link text", () => {
    const html = '<a href="/page"></a>';
    const issues = validateLinkText(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("link-text-empty");
  });

  it("does not flag empty links with aria-label", () => {
    const html = '<a href="/page" aria-label="Home"></a>';
    expect(validateLinkText(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateImageAlt
// ---------------------------------------------------------------------------

describe("validateImageAlt", () => {
  it("returns no issues for images with alt text", () => {
    const html = '<img src="photo.jpg" alt="A sunset over the mountains" />';
    expect(validateImageAlt(html)).toEqual([]);
  });

  it("allows decorative images with empty alt", () => {
    const html = '<img src="divider.svg" alt="" />';
    expect(validateImageAlt(html)).toEqual([]);
  });

  it("flags images with no alt attribute at all", () => {
    const html = '<img src="photo.jpg" />';
    const issues = validateImageAlt(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("img-alt-missing");
  });

  it("flags images with placeholder alt text", () => {
    const html = '<img src="photo.jpg" alt="image" />';
    const issues = validateImageAlt(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("img-alt-placeholder");
  });

  it("flags 'photo' as placeholder alt text", () => {
    const html = '<img src="team.jpg" alt="photo" />';
    expect(validateImageAlt(html)).toHaveLength(1);
  });

  it("flags 'untitled' as placeholder alt text", () => {
    const html = '<img src="hero.jpg" alt="untitled" />';
    expect(validateImageAlt(html)).toHaveLength(1);
  });

  it("flags multiple images with issues", () => {
    const html =
      '<img src="a.jpg" /><img src="b.jpg" alt="image" /><img src="c.jpg" alt="A dog" />';
    const issues = validateImageAlt(html);
    expect(issues).toHaveLength(2); // missing + placeholder
  });

  it("handles self-closing and non-self-closing img tags", () => {
    const html1 = '<img src="a.jpg" alt="Good alt">';
    const html2 = '<img src="a.jpg" alt="Good alt" />';
    expect(validateImageAlt(html1)).toEqual([]);
    expect(validateImageAlt(html2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A11yIssue shape
// ---------------------------------------------------------------------------

describe("A11yIssue shape", () => {
  it("has rule, message, and severity fields", () => {
    const html = '<img src="x.jpg" />';
    const issues = validateImageAlt(html);
    expect(issues[0]).toHaveProperty("rule");
    expect(issues[0]).toHaveProperty("message");
    expect(issues[0]).toHaveProperty("severity");
    expect(["error", "warning"]).toContain(issues[0].severity);
  });
});

// ---------------------------------------------------------------------------
// validateHtml — unified validator
// ---------------------------------------------------------------------------

describe("validateHtml", () => {
  it("returns all issues from all validators", () => {
    const html =
      '<h1>Title</h1><h3>Skip</h3><a href="/x">click here</a><img src="y.jpg" />';
    const issues = validateHtml(html);
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain("heading-skip");
    expect(rules).toContain("link-text-generic");
    expect(rules).toContain("img-alt-missing");
  });

  it("sorts errors before warnings", () => {
    const html =
      '<h1>Title</h1><a href="/x">click here</a><img src="y.jpg" />';
    const issues = validateHtml(html);
    // img-alt-missing is error, link-text-generic is warning
    const errorIdx = issues.findIndex((i) => i.rule === "img-alt-missing");
    const warnIdx = issues.findIndex((i) => i.rule === "link-text-generic");
    expect(errorIdx).toBeLessThan(warnIdx);
  });

  it("returns empty array for clean HTML", () => {
    const html =
      '<h1>Title</h1><h2>Sub</h2><a href="/about">About us</a><img src="x.jpg" alt="A photo of the team" />';
    expect(validateHtml(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// html-validate edge cases (things regex would miss)
// ---------------------------------------------------------------------------

describe("html-validate integration", () => {
  it("handles nested tags inside links", () => {
    // Regex-based parsers struggle with nested HTML in link text
    const html = '<a href="/x"><span>click here</span></a>';
    const issues = validateLinkText(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("link-text-generic");
  });

  it("recognizes img role=presentation as not needing alt", () => {
    const html = '<img src="spacer.gif" role="presentation" />';
    expect(validateImageAlt(html)).toEqual([]);
  });
});
