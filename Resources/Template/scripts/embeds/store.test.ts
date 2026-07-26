import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbedSnapshot } from "./types";
import {
  embedSlug,
  collectRemoteAssets,
  assetFilename,
  localizeAssets,
  writeSnapshot,
  loadAllSnapshots,
} from "./store";

function sample(): EmbedSnapshot {
  return {
    version: 1,
    url: "https://x.com/jack/status/20",
    provider: "x",
    author: { name: "jack", handle: "@jack", avatar: "https://cdn.example/avatar.jpg" },
    content: "just setting up my twttr",
    media: [{ src: "https://cdn.example/photo.png", alt: "a photo" }],
    capturedAt: "2026-07-25T00:00:00.000Z",
  };
}

test("embedSlug: 12 lowercase hex chars, stable across calls", () => {
  const a = embedSlug("https://x.com/jack/status/20");
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, embedSlug("https://x.com/jack/status/20"));
});

test("embedSlug: different URLs get different slugs", () => {
  assert.notEqual(embedSlug("https://x.com/jack/status/20"), embedSlug("https://x.com/jack/status/21"));
});

test("collectRemoteAssets: gathers avatar and media, skipping already-local paths", () => {
  assert.deepEqual(collectRemoteAssets(sample()), [
    "https://cdn.example/avatar.jpg",
    "https://cdn.example/photo.png",
  ]);
  const local = sample();
  local.author.avatar = "/embeds/abc/avatar.jpg";
  assert.deepEqual(collectRemoteAssets(local), ["https://cdn.example/photo.png"]);
});

test("assetFilename: keeps a sane extension and never escapes its directory", () => {
  assert.equal(assetFilename("https://cdn.example/photo.png", 0), "asset-0.png");
  assert.equal(assetFilename("https://cdn.example/a/b/c.JPEG?x=1", 2), "asset-2.jpeg");
  // No extension, or a hostile one, falls back to .img rather than trusting the URL.
  assert.equal(assetFilename("https://cdn.example/bafkrei@jpeg", 1), "asset-1.img");
  assert.equal(assetFilename("https://cdn.example/x/../../etc/passwd", 3), "asset-3.img");
});

test("localizeAssets: rewrites every remote reference to its repo-relative path", () => {
  const out = localizeAssets(sample(), {
    "https://cdn.example/avatar.jpg": "/embeds/abc123/asset-0.jpg",
    "https://cdn.example/photo.png": "/embeds/abc123/asset-1.png",
  });
  assert.equal(out.author.avatar, "/embeds/abc123/asset-0.jpg");
  assert.equal(out.media[0].src, "/embeds/abc123/asset-1.png");
  assert.equal(out.media[0].alt, "a photo");
});

test("localizeAssets: an unmapped asset is dropped, never left pointing at the platform", () => {
  const out = localizeAssets(sample(), {});
  assert.equal(out.author.avatar, undefined);
  assert.deepEqual(out.media, []);
});

test("localizeAssets: does not mutate its input", () => {
  const input = sample();
  localizeAssets(input, {});
  assert.equal(input.author.avatar, "https://cdn.example/avatar.jpg");
});

test("writeSnapshot then loadAllSnapshots round-trips, keyed by canonical URL", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const snap = localizeAssets(sample(), {});
  const path = writeSnapshot(cwd, snap);
  assert.match(readFileSync(path, "utf-8"), /"version": 1/);
  const all = loadAllSnapshots(cwd);
  assert.equal(all.size, 1);
  assert.equal(all.get("https://x.com/jack/status/20")?.content, "just setting up my twttr");
});

test("writeSnapshot: re-snapshotting the same URL overwrites rather than duplicating", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));
  const second = localizeAssets(sample(), {});
  second.content = "edited";
  writeSnapshot(cwd, second);
  const all = loadAllSnapshots(cwd);
  assert.equal(all.size, 1);
  assert.equal(all.get("https://x.com/jack/status/20")?.content, "edited");
});

test("loadAllSnapshots: a missing directory is empty, not an error", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  assert.equal(loadAllSnapshots(cwd).size, 0);
});
