import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EmbedSnapshot } from "./types";
import {
  embedSlug,
  collectRemoteAssets,
  assetFilename,
  localizeAssets,
  writeSnapshot,
  loadAllSnapshots,
  SNAPSHOT_DIR,
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

test("localizeAssets: a src that isn't a /embeds/ path is dropped and reported", () => {
  const snap = sample();
  snap.media = [{ src: "/uploads/not-ours.png", alt: "x" }, { src: "/embeds/abc/asset-0.png", alt: "ok" }];

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  let out;
  try {
    out = localizeAssets(snap, {});
  } finally {
    console.warn = original;
  }

  assert.deepEqual(out.media, [{ src: "/embeds/abc/asset-0.png", alt: "ok" }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\/uploads\/not-ours\.png/);
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

test("loadAllSnapshots: a hand-authored url is keyed canonically, not verbatim", () => {
  // The Instagram escape hatch tells owners to write this file themselves, so `url` arrives
  // however they pasted it. Keying it through `snapshotKey` is what lets the renderers find it.
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const snap = localizeAssets(sample(), {});
  snap.url = "https://mobile.twitter.com/jack/status/20/?s=20&t=abc";
  writeSnapshot(cwd, snap);

  const all = loadAllSnapshots(cwd);
  assert.deepEqual([...all.keys()], ["https://x.com/jack/status/20"]);
});

test("loadAllSnapshots: an unparseable snapshot is skipped with a warning, never thrown", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));
  // A trailing comma — the realistic hand-authoring mistake.
  writeFileSync(join(resolve(cwd, SNAPSHOT_DIR), "broken.json"), `{"version": 1, "url": "https://e.example/x",}`, "utf-8");

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  try {
    const all = loadAllSnapshots(cwd);
    assert.equal(all.size, 1);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken\.json/);
});

test("loadAllSnapshots: caches per directory, does not re-read the disk", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));
  const first = loadAllSnapshots(cwd);
  assert.equal(first.size, 1);

  // Add a second snapshot straight to disk, bypassing writeSnapshot (and thus its
  // cache invalidation). A live cache must not see this file.
  const other = localizeAssets(sample(), {});
  other.url = "https://x.com/jack/status/21";
  writeFileSync(
    join(resolve(cwd, SNAPSHOT_DIR), `${embedSlug(other.url)}.json`),
    `${JSON.stringify(other, null, 2)}\n`,
    "utf-8",
  );

  const second = loadAllSnapshots(cwd);
  assert.equal(second.size, 1);
  assert.equal(second.has(other.url), false);
});

test("writeSnapshot invalidates the cache for the directory it wrote to", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));
  assert.equal(loadAllSnapshots(cwd).size, 1);

  const second = localizeAssets(sample(), {});
  second.url = "https://x.com/jack/status/21";
  writeSnapshot(cwd, second);

  const all = loadAllSnapshots(cwd);
  assert.equal(all.size, 2);
  assert.equal(all.has(second.url), true);
});

test("loadAllSnapshots: two different directories do not share cached entries", () => {
  const cwdA = mkdtempSync(join(tmpdir(), "embeds-"));
  const cwdB = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwdA, localizeAssets(sample(), {}));

  assert.equal(loadAllSnapshots(cwdA).size, 1);
  assert.equal(loadAllSnapshots(cwdB).size, 0);
});

test("loadAllSnapshots: returned Map is a copy, safe for callers to mutate", () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  writeSnapshot(cwd, localizeAssets(sample(), {}));

  const first = loadAllSnapshots(cwd);
  first.clear();
  assert.equal(first.size, 0);

  const second = loadAllSnapshots(cwd);
  assert.equal(second.size, 1);
});
