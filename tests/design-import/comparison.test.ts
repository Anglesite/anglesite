import { describe, it, expect } from "vitest";
import { comparisonPaths } from "../../scripts/design-import/comparison.mjs";

describe("comparisonPaths", () => {
  it("maps / to home slug", () => {
    const result = comparisonPaths("/");
    expect(result.original).toBe(
      "docs/design-import/comparison/home-original.png"
    );
    expect(result.generated).toBe(
      "docs/design-import/comparison/home-generated.png"
    );
  });

  it("maps /services to services slug", () => {
    const result = comparisonPaths("/services");
    expect(result.original).toBe(
      "docs/design-import/comparison/services-original.png"
    );
    expect(result.generated).toBe(
      "docs/design-import/comparison/services-generated.png"
    );
  });

  it("maps /about/team to about-team slug (replaces / with -)", () => {
    const result = comparisonPaths("/about/team");
    expect(result.original).toBe(
      "docs/design-import/comparison/about-team-original.png"
    );
    expect(result.generated).toBe(
      "docs/design-import/comparison/about-team-generated.png"
    );
  });

  it("strips trailing slash before converting", () => {
    const result = comparisonPaths("/trailing/");
    expect(result.original).toBe(
      "docs/design-import/comparison/trailing-original.png"
    );
    expect(result.generated).toBe(
      "docs/design-import/comparison/trailing-generated.png"
    );
  });
});
