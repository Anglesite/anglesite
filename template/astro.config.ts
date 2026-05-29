/**
 * Astro configuration for an Anglesite-managed website.
 *
 * Reads site identity from `.site-config` (written by `/anglesite:start`).
 * In dev mode, enables local HTTPS via mkcert and the Anglesite annotations
 * toolbar; in both dev and production, builds static HTML with no client
 * JavaScript. The Cloudflare adapter is wired only for production builds —
 * its dev-mode behavior conflicts with Astro 6.3.x's SSR routing (see the
 * `adapter` block below for the full justification).
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
  // Was: `isDev ? "server" : "static"`. The server-mode dev option requires
  // the Cloudflare adapter to be loaded too, but @astrojs/cloudflare 13.5.0
  // + Astro 6.3.1 intercepts dev-mode routing through the workerd shim and
  // 404s every SSR request. Static + hot-reload gives a working preview
  // without the adapter. The Keystatic `/keystatic` admin UI still works in
  // dev: the keystatic() integration (added to `integrations` above only when
  // isDev) injects its own route that Astro's dev server renders on demand,
  // independent of this build-time `output` mode.
  output: "static",
  integrations: [
    react(),
    markdoc(),
    ...(isDev ? [keystatic(), anglesiteToolbar()] : []),
    sitemap({ serialize: makeLastmodSerializer() }),
  ],
  vite: {
    server: { https: getHttpsConfig() },
    // DO NOT add @keystatic/core or @keystatic/astro to optimizeDeps.exclude.
    //
    // The /keystatic admin UI is a client-rendered React app whose dependency
    // tree is largely CommonJS (slate, slate-react, slate-history, is-hotkey,
    // use-sync-external-store, @markdoc/markdoc, js-yaml, …). Vite must
    // pre-bundle that tree into ESM, or the browser fails to resolve named
    // exports and surfaces errors like:
    //   SyntaxError: Importing binding name 'isKeyHotkey' is not found.
    //   SyntaxError: Importing binding name 'useSyncExternalStore' is not found.
    // one at a time, leaving /keystatic a blank white page (seen on
    // Node 22+/Vite 6). Excluding the Keystatic packages stops Vite from
    // discovering and pre-bundling that CJS tree, which is exactly what breaks
    // hydration. The canonical Keystatic + Astro setup needs no optimizeDeps
    // config at all, so we keep this empty and let Vite's default dependency
    // discovery do its job. (Excluding them only silenced a cosmetic, non-fatal
    // "Could not resolve 'virtual:keystatic-config'" scan warning at startup —
    // not worth a broken CMS.)
  },
  // prerenderEnvironment: "node" keeps the prerender step in Node so the
  // adapter doesn't spin up a workerd-based preview server that conflicts
  // with the custom worker entry in worker/site-entry.js.
  //
  // Skipped in dev — @astrojs/cloudflare 13.5.0 + Astro 6.3.1 intercepts SSR
  // routing during `astro dev` and 404s every request. The adapter is only
  // needed at build/deploy time. Pair this with `output: "static"` in dev
  // (set above) since `output: "server"` requires an adapter.
  adapter: isDev ? undefined : cloudflare({ prerenderEnvironment: "node" }),
});
