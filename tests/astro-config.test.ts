import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read the scaffolded astro.config.ts as text. We assert on source rather than
// importing it because the config pulls in the full Astro/Keystatic/Cloudflare
// integration stack, which isn't installed in the plugin's own node_modules.
const astroConfig = readFileSync(
  resolve(__dirname, "../template/astro.config.ts"),
  "utf-8",
);

describe("template/astro.config.ts — Keystatic dev compatibility", () => {
  // Regression guard for the Keystatic hydration cascade: excluding the
  // Keystatic packages from optimizeDeps stops Vite from pre-bundling their
  // CommonJS dependency tree (slate, is-hotkey, use-sync-external-store,
  // @markdoc/markdoc, …) into ESM, so the browser throws
  // "Importing binding name '…' is not found" and /keystatic renders blank.
  // The canonical Keystatic + Astro setup needs no optimizeDeps config at all.
  it("does not exclude @keystatic packages from Vite optimizeDeps", () => {
    const excludeMatch = astroConfig.match(/exclude\s*:\s*\[([^\]]*)\]/);
    const excluded = excludeMatch?.[1] ?? "";
    expect(excluded).not.toContain("@keystatic/core");
    expect(excluded).not.toContain("@keystatic/astro");
  });

  it("still loads the keystatic integration in dev", () => {
    expect(astroConfig).toContain("keystatic()");
  });
});
