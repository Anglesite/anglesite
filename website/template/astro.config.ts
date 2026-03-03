import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import markdoc from "@astrojs/markdoc";
import keystatic from "@keystatic/astro";
import sitemap from "@astrojs/sitemap";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const isDev =
  process.argv[1]?.includes("astro") && process.argv.includes("dev");

/** Read a key from .site-config (KEY=value format). */
function readConfig(key: string): string | undefined {
  const configPath = resolve(process.cwd(), ".site-config");
  if (!existsSync(configPath)) return undefined;
  const content = readFileSync(configPath, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

/** Load mkcert certificates for local HTTPS, if they exist. */
function getHttpsConfig() {
  const certsDir = resolve(process.cwd(), ".certs");
  const nosyncDir = resolve(process.cwd(), ".certs.nosync");
  const dir = existsSync(certsDir) ? certsDir : nosyncDir;
  const cert = resolve(dir, "cert.pem");
  const key = resolve(dir, "key.pem");
  if (existsSync(cert) && existsSync(key)) {
    return { cert: readFileSync(cert), key: readFileSync(key) };
  }
  return undefined;
}

const siteDomain = readConfig("SITE_DOMAIN");
const devHostname = readConfig("DEV_HOSTNAME") ?? "localhost";
const siteUrl = siteDomain
  ? `https://${siteDomain}`
  : isDev
    ? `https://${devHostname}`
    : "http://localhost:4321"; // fallback for build without domain

export default defineConfig({
  site: siteUrl,
  output: isDev ? "server" : "static",
  integrations: [
    react(),
    markdoc(),
    ...(isDev ? [keystatic()] : []),
    sitemap(),
  ],
  vite: isDev
    ? {
        server: {
          https: getHttpsConfig(),
        },
      }
    : {},
});
