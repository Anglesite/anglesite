import { describe, it, expect } from "vitest";
import { fileVersion } from "../server/file-version.mjs";

describe("fileVersion", () => {
  it("is deterministic for identical content", () => {
    expect(fileVersion("a")).toBe(fileVersion("a"));
  });

  it("changes when content changes", () => {
    expect(fileVersion("a")).not.toBe(fileVersion("b"));
  });

  it("matches the sha256:<12 hex> format", () => {
    expect(fileVersion("hello")).toMatch(/^sha256:[0-9a-f]{12}$/);
  });
});
