import { defineConfig } from "astro/config";
import keystatic from "@keystatic/astro";
import react from "@astrojs/react";
import { readConfig } from "./scripts/config.ts";
import anglesiteHarness from "./scripts/anglesite-harness.ts";
import redirects from "./scripts/redirects.ts";
import co2Badge from "./scripts/co2-badge.ts";
import { isKeystaticDev } from "./scripts/keystatic-gate.ts";

// The deploy step writes the real domain into `.site-config` (SITE_URL=…) before build.
// Absent that, feeds carry a placeholder host — fine for a not-yet-deployed scaffold.
const site = readConfig("SITE_URL") ?? "https://example.com";

// Keystatic's /keystatic admin UI is dev-only (see scripts/keystatic-gate.ts, unit-tested):
// gated on the `astro dev` CLI subcommand via process.argv (Astro's own defineConfig doesn't
// support a function-form config in this version — see git history for why that approach was
// tried and reverted). This keeps production builds pure static output with no server adapter:
// `react()`/`keystatic()` are never registered outside `astro dev`, so `astro build` (with any
// --mode) never sees their routes at all.
const isDev = isKeystaticDev(process.argv);

export default defineConfig({
  site,
  integrations: [anglesiteHarness(), redirects(), co2Badge(), ...(isDev ? [react(), keystatic()] : [])],
});
