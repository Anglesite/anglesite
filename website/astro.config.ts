import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import markdoc from "@astrojs/markdoc";
import keystatic from "@keystatic/astro";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://www.pairadocs.farm",
  output: "hybrid",
  integrations: [react(), markdoc(), keystatic(), sitemap()],
});
