#!/usr/bin/env node
/**
 * Scan src/content/ for entries with `tier: premium` and emit the list
 * of gated routes to worker/_premium-routes.json. The site-entry Worker
 * (worker/site-entry.js) imports this JSON at deploy time and gates
 * matching routes at the edge.
 *
 * Mapping rules:
 *   src/content/posts/<slug>.mdoc         → /blog/<slug>
 *   src/content/<collection>/<slug>.mdoc  → /<collection>/<slug>
 *
 * If a route should be gated by prefix (e.g. an entire section), the
 * owner can hand-edit the JSON to add `"/members/*"`-style entries —
 * this script preserves any entry it didn't generate by reading the
 * existing file's `manual` array.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const projectRoot = process.cwd();
const contentDir = resolve(projectRoot, "src", "content");
const outFile = resolve(projectRoot, "worker", "_premium-routes.json");

const COLLECTION_TO_BASE = {
  posts: "/blog",
  services: "/services",
  team: "/team",
};

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile() && /\.(mdoc|md|mdx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readFrontmatter(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return fm;
}

function readExistingManual() {
  if (!existsSync(outFile)) return [];
  try {
    const data = JSON.parse(readFileSync(outFile, "utf-8"));
    if (Array.isArray(data)) {
      // Preserve any glob-style ("/foo/*") entries — those are owner-managed.
      return data.filter((entry) => typeof entry === "string" && entry.endsWith("/*"));
    }
    return [];
  } catch {
    return [];
  }
}

function generated() {
  const out = [];
  if (!existsSync(contentDir)) return out;
  for (const collection of readdirSync(contentDir, { withFileTypes: true })) {
    if (!collection.isDirectory()) continue;
    const base = COLLECTION_TO_BASE[collection.name] || `/${collection.name}`;
    for (const file of listFiles(join(contentDir, collection.name))) {
      const fm = readFrontmatter(file);
      if (!fm || fm.tier !== "premium") continue;
      const slug = file
        .split(/[\\/]/)
        .pop()
        .replace(/\.(mdoc|md|mdx)$/, "");
      out.push(`${base}/${slug}`);
    }
  }
  return out;
}

const manual = readExistingManual();
const fromContent = generated();
const all = Array.from(new Set([...fromContent, ...manual])).sort();

writeFileSync(outFile, JSON.stringify(all, null, 2) + "\n");

console.log(
  `[membership] wrote ${all.length} premium route(s) to worker/_premium-routes.json`,
);
