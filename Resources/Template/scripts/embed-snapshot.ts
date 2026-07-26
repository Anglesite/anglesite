#!/usr/bin/env npx tsx
/**
 * Snapshot a social post into this site's repo so it can be embedded with no third-party
 * JavaScript and no third-party image requests.
 *
 *   npx tsx scripts/embed-snapshot.ts <url> [<url>…]
 *   npx tsx scripts/embed-snapshot.ts --all      # every un-snapshotted URL in src/content/
 *
 * Writes src/embeds/<slug>.json and public/embeds/<slug>/*. Both are meant to be committed:
 * the build reads them and never makes a network request, so an embed keeps rendering even
 * after the platform deletes the post or retires its API.
 *
 * Exit code 0: every requested URL was snapshotted. Exit code 1: at least one failed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdapter, type AdapterRequest } from "./embeds/adapters";
import { downloadAssets, fetchSnapshot } from "./embeds/fetch";
import { collectRemoteAssets, embedSlug, loadAllSnapshots, localizeAssets, writeSnapshot } from "./embeds/store";

const CONTENT_DIR = "src/content";

/** Bare URLs sitting alone on a line — the same shape the remark plugin turns into a card. */
function bareURLsIn(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (/^<?https?:\/\/\S+>?$/.test(trimmed)) out.push(trimmed.replace(/^<|>$/g, ""));
  }
  return out;
}

function* markdownFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* markdownFiles(full);
    else if (full.endsWith(".md")) yield full;
  }
}

function discoverURLs(cwd: string): string[] {
  const seen = new Set<string>();
  for (const file of markdownFiles(resolve(cwd, CONTENT_DIR))) {
    for (const url of bareURLsIn(readFileSync(file, "utf-8"))) seen.add(url);
  }
  return [...seen];
}

async function capture(cwd: string, request: AdapterRequest, capturedAt: string): Promise<void> {
  const fetched = await fetchSnapshot(request, capturedAt);
  const slug = embedSlug(request.canonicalURL);
  const map = await downloadAssets(collectRemoteAssets(fetched), cwd, slug);
  const path = writeSnapshot(cwd, localizeAssets(fetched, map));
  console.log(`✓ wrote ${path}`);
}

async function snapshot(cwd: string, rawURL: string, capturedAt: string): Promise<boolean> {
  const request = resolveAdapter(rawURL);
  if (!request) {
    console.error(`✗ ${rawURL} — not an http(s) URL`);
    return false;
  }
  console.log(`→ ${request.canonicalURL} (${request.provider})`);
  try {
    await capture(cwd, request, capturedAt);
    return true;
  } catch (error) {
    console.error(`  ${request.provider} adapter failed — ${(error as Error).message}`);
  }

  if (request.provider === "opengraph") {
    console.error(`✗ ${request.canonicalURL} — no Open Graph metadata could be read.`);
    console.error(
      "  If the platform blocks automated requests (Instagram does), snapshot succeeds nowhere:\n" +
        `  save a screenshot to public/embeds/${embedSlug(request.canonicalURL)}/ and add it to\n` +
        "  that snapshot's media[] by hand.",
    );
    return false;
  }

  // Spec §6 step 2: a failed platform adapter degrades to a generic Open Graph link card
  // rather than to nothing. Same canonical URL, so it claims the same slug.
  console.error("  falling back to Open Graph…");
  try {
    await capture(
      cwd,
      { provider: "opengraph", canonicalURL: request.canonicalURL, apiURL: request.canonicalURL },
      capturedAt,
    );
    return true;
  } catch (fallbackError) {
    console.error(`✗ ${request.canonicalURL} — ${(fallbackError as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const capturedAt = new Date().toISOString();

  let urls: string[];
  if (args.includes("--all")) {
    const existing = loadAllSnapshots(cwd);
    urls = discoverURLs(cwd).filter((url) => {
      const request = resolveAdapter(url);
      return request !== null && !existing.has(request.canonicalURL);
    });
    if (urls.length === 0) {
      console.log("Every bare URL in src/content/ already has a snapshot.");
      return;
    }
    console.log(`Found ${urls.length} un-snapshotted URL(s).`);
  } else {
    urls = args.filter((a) => !a.startsWith("--"));
  }

  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/embed-snapshot.ts <url> [<url>…] | --all");
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const url of urls) if (!(await snapshot(cwd, url, capturedAt))) failures += 1;

  if (failures > 0) {
    console.error(`\n${failures} of ${urls.length} failed. Un-snapshotted URLs stay plain links.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
