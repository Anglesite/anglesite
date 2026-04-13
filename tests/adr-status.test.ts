import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const decisionsDir = resolve(__dirname, "../docs/decisions");

const adrFiles = readdirSync(decisionsDir).filter(
  (f) => f.match(/^\d{4}-/) && f.endsWith(".md"),
);

describe("ADR status", () => {
  it("finds at least one ADR file", () => {
    expect(adrFiles.length).toBeGreaterThan(0);
  });

  it.each(adrFiles)("%s has status: accepted", (file) => {
    const content = readFileSync(join(decisionsDir, file), "utf-8");
    const match = content.match(/^status:\s*(.+)$/m);
    expect(match, `${file} is missing a status field`).not.toBeNull();
    expect(match![1].trim()).toBe("accepted");
  });
});
