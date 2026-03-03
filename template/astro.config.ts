/**
 * Astro configuration for an Anglesite-managed website.
 *
 * Reads site identity from `.site-config` (written by `/anglesite:start`).
 * In dev mode, enables Keystatic CMS, local HTTPS via mkcert, and server
 * output. In production, builds static HTML with no client JavaScript.
 *
 * @see https://docs.astro.build/en/reference/configuration-reference/
 * @module
 */

import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import markdoc from "@astrojs/markdoc";
import keystatic from "@keystatic/astro";
import sitemap from "@astrojs/sitemap";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** True when running `astro dev`, false during `astro build`. */
const isDev =
  process.argv[1]?.includes("astro") && process.argv.includes("dev");

/**
 * Read a value from `.site-config` (KEY=value format, one per line).
 *
 * @param key - The config key to look up (e.g. `"SITE_DOMAIN"`)
 * @returns The trimmed value, or `undefined` if the file or key is missing
 */
function readConfig(key: string): string | undefined {
  const configPath = resolve(process.cwd(), ".site-config");
  if (!existsSync(configPath)) return undefined;
  const content = readFileSync(configPath, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

/**
 * Load mkcert TLS certificates for local HTTPS.
 *
 * Looks for `cert.pem` and `key.pem` in the `.certs/` directory
 * (created by `scripts/setup.sh`). Returns `undefined` if either
 * file is missing, which disables HTTPS in the dev server.
 *
 * @returns Vite HTTPS config object, or `undefined`
 */
function getHttpsConfig() {
  const dir = resolve(process.cwd(), ".certs");
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
  devToolbar: { enabled: false },
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
