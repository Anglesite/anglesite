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
import cloudflare from "@astrojs/cloudflare";
import anglesiteToolbar from "./src/integrations/anglesite-toolbar";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

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

/**
 * Build a Map<trackedFile, lastCommitISO> from `git log` once, then return a
 * `serialize` function that stamps each sitemap entry with the source file's
 * last-commit time. Falls back to build time when git is unavailable, the file
 * is untracked, or the URL doesn't resolve to a known source path. Existing
 * `lastmod` values on the item (e.g. set by another integration) are preserved.
 */
function makeLastmodSerializer() {
  let cache: Map<string, string> | null = null;
  const buildTime = new Date().toISOString();

  function loadCache(): Map<string, string> {
    const map = new Map<string, string>();
    try {
      const out = execSync("git log --name-only --pretty=format:__C__%aI", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "ignore"],
      });
      let date = "";
      for (const line of out.split("\n")) {
        if (line.startsWith("__C__")) {
          date = line.slice(5);
        } else if (line && date && !map.has(line)) {
          map.set(line, date);
        }
      }
    } catch {
      // git not available, shallow clone with no history, or non-repo build —
      // serializer falls back to build time.
    }
    return map;
  }

  function urlToSourceCandidates(url: string): string[] {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }
    const trimmed = path.replace(/^\/+|\/+$/g, "");
    const exts = [".astro", ".md", ".mdoc", ".mdx", ".html"];
    const out: string[] = [];
    if (trimmed === "") {
      for (const e of exts) out.push(`src/pages/index${e}`);
    } else {
      for (const e of exts) {
        out.push(`src/pages/${trimmed}${e}`);
        out.push(`src/pages/${trimmed}/index${e}`);
        out.push(`src/content/${trimmed}${e}`);
      }
    }
    return out;
  }

  return (item: { url: string; lastmod?: string }) => {
    if (item.lastmod) return item;
    if (!cache) cache = loadCache();
    for (const candidate of urlToSourceCandidates(item.url)) {
      const mtime = cache.get(candidate);
      if (mtime) return { ...item, lastmod: mtime };
    }
    return { ...item, lastmod: buildTime };
  };
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
  devToolbar: { enabled: isDev },
  output: isDev ? "server" : "static",
  integrations: [
    react(),
    markdoc(),
    ...(isDev ? [keystatic(), anglesiteToolbar()] : []),
    sitemap({ serialize: makeLastmodSerializer() }),
  ],
  vite: { server: { https: getHttpsConfig() } },
  adapter: cloudflare(),
});
