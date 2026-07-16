import { describe, it, expect } from "vitest";
import { parseProps, generatePropsInterface, generatePropsDestructure } from "../server/props-interface.mjs";

describe("generatePropsInterface / generatePropsDestructure", () => {
  it("returns null for an empty props array", () => {
    expect(generatePropsInterface([])).toBeNull();
    expect(generatePropsDestructure([])).toBeNull();
  });

  it("codegens a multi-prop interface and destructure", () => {
    const props = [
      { name: "title", type: "string", optional: false, default: null },
      { name: "count", type: "number", optional: true, default: "1" },
    ];
    expect(generatePropsInterface(props)).toBe("interface Props {\n  title: string;\n  count?: number;\n}");
    expect(generatePropsDestructure(props)).toBe('const { title, count = 1 } = Astro.props;');
  });

  it("round-trips through parseProps", () => {
    const props = [
      { name: "title", type: "string", optional: false, default: null },
      { name: "count", type: "number", optional: true, default: "1" },
      { name: "label", type: "string", optional: true, default: '"hello, world"' },
    ];
    const source = `${generatePropsInterface(props)}\n${generatePropsDestructure(props)}`;
    expect(parseProps(source)).toEqual(props);
  });

  it("omits a prop's default segment from the destructure when default is null", () => {
    const props = [{ name: "title", type: "string", optional: false, default: null }];
    expect(generatePropsDestructure(props)).toBe("const { title } = Astro.props;");
  });
});
