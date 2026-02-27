import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import markdoc from "@astrojs/markdoc";
import keystatic from "@keystatic/astro";
import sitemap from "@astrojs/sitemap";

const isDev = process.argv[1]?.includes("astro") &&
  process.argv.includes("dev");

export default defineConfig({
  site: "http://localhost:4321", // Updated by /deploy when domain is known
  output: isDev ? "server" : "static",
  integrations: [
    react(),
    markdoc(),
    ...(isDev ? [keystatic()] : []),
    sitemap(),
  ],
});
