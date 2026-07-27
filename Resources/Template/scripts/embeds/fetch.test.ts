import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdapter } from "./adapters";
import { fetchSnapshot, downloadAssets, normalizeFor, MAX_ASSET_BYTES } from "./fetch";

const AT = "2026-07-25T00:00:00.000Z";

/** Injected resolver — no test here touches DNS. */
const publicLookup = async () => ["93.184.216.34"];

function redirectTo(location: string) {
  return new Response("", { status: 302, headers: { location } });
}


function jsonResponse(body: unknown, init: { status?: number; type?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/json" },
  });
}

test("normalizeFor: dispatches to the right normalizer per provider", () => {
  const s = normalizeFor("youtube", { title: "T" }, "https://www.youtube.com/watch?v=a", AT);
  assert.equal(s.provider, "youtube");
  assert.equal(s.content, "T");
});

test("fetchSnapshot: parses a platform JSON response into a snapshot", async () => {
  const req = resolveAdapter("https://www.youtube.com/watch?v=dQw4w9WgXcQ")!;
  const snap = await fetchSnapshot(req, AT, async () =>
    jsonResponse({ title: "Never Gonna Give You Up", author_name: "Rick Astley" }), publicLookup,
  );
  assert.equal(snap.content, "Never Gonna Give You Up");
  assert.equal(snap.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("fetchSnapshot: opengraph reads HTML, not JSON", async () => {
  const req = resolveAdapter("https://example.com/post")!;
  const snap = await fetchSnapshot(req, AT, async () =>
    new Response('<meta property="og:title" content="Hello">', {
      status: 200,
      headers: { "content-type": "text/html" },
    }), publicLookup,
  );
  assert.equal(snap.provider, "opengraph");
  assert.equal(snap.content, "Hello");
});

test("fetchSnapshot: opengraph resolves a document-relative og:image against the redirected (post-slash) URL", async () => {
  // The requested apiURL is the trailing-slash-stripped canonicalURL (adapters.ts), but the
  // server redirects it back to the trailing-slash form — fetch's real Response.url reflects
  // that. A hand-built test Response defaults `.url` to "", so it's set explicitly here to
  // stand in for that post-redirect value.
  const req = resolveAdapter("https://example.com/blog/post/")!;
  assert.equal(req.apiURL, "https://example.com/blog/post");

  const snap = await fetchSnapshot(req, AT, async () => {
    const res = new Response(
      '<meta property="og:title" content="Hello"><meta property="og:image" content="img/hero.png">',
      { status: 200, headers: { "content-type": "text/html" } },
    );
    Object.defineProperty(res, "url", { value: "https://example.com/blog/post/" });
    return res;
  }, publicLookup);
  assert.deepEqual(snap.media, [{ src: "https://example.com/blog/post/img/hero.png", alt: "Hello" }]);
});

test("fetchSnapshot: opengraph with no og: tags at all rejects instead of a junk snapshot", async () => {
  // The Instagram shape: HTTP 200, a <title>, and no og:* metadata. normalizeOpenGraph would
  // happily fall back to the title and "succeed" with junk — fetchSnapshot must not let that
  // reach the caller as success, so the CLI's existing "no Open Graph metadata" error path
  // (scripts/embed-snapshot.ts) actually fires instead of a silent write.
  const req = resolveAdapter("https://www.instagram.com/p/CxYZ123/")!;
  await assert.rejects(
    () =>
      fetchSnapshot(req, AT, async () =>
        new Response("<!doctype html><title>Instagram</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }), publicLookup,
      ),
    /no Open Graph metadata/,
  );
});

test("fetchSnapshot: a non-OK response throws with the status, not a silent empty card", async () => {
  const req = resolveAdapter("https://www.youtube.com/watch?v=a")!;
  await assert.rejects(
    () => fetchSnapshot(req, AT, async () => jsonResponse({}, { status: 404 }), publicLookup),
    /404/,
  );
});

test("downloadAssets: writes each asset and returns its repo-relative path", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const map = await downloadAssets(
    ["https://cdn.example/a.png", "https://cdn.example/b.jpg"],
    cwd,
    "slug123",
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    publicLookup,
  );
  assert.deepEqual(map, {
    "https://cdn.example/a.png": "/embeds/slug123/asset-0.png",
    "https://cdn.example/b.jpg": "/embeds/slug123/asset-1.jpg",
  });
  assert.ok(existsSync(join(cwd, "public/embeds/slug123/asset-0.png")));
  assert.deepEqual([...readFileSync(join(cwd, "public/embeds/slug123/asset-0.png"))], [1, 2, 3]);
});

test("downloadAssets: a failed asset is omitted from the map, so localizeAssets drops it", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const map = await downloadAssets(
    ["https://cdn.example/gone.png"],
    cwd,
    "slug123",
    async () => new Response("", { status: 404 }),
    publicLookup,
  );
  assert.deepEqual(map, {});
});

test("downloadAssets: an oversized asset is refused rather than committed to the repo", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const huge = new Uint8Array(MAX_ASSET_BYTES + 1);
  const map = await downloadAssets(
    ["https://cdn.example/huge.png"],
    cwd,
    "slug123",
    async () => new Response(huge, { status: 200 }),
    publicLookup,
  );
  assert.deepEqual(map, {});
  assert.ok(!existsSync(join(cwd, "public/embeds/slug123/asset-0.png")));
});


test("fetchSnapshot: a public page that redirects to a private address is refused", async () => {
  const req = resolveAdapter("https://example.com/post")!;
  let calls = 0;
  await assert.rejects(
    () =>
      fetchSnapshot(req, AT, async () => {
        calls += 1;
        return redirectTo("http://169.254.169.254/latest/meta-data/");
      }, publicLookup),
    /private or reserved address/,
  );
  // The first hop was fetched; the metadata endpoint never was.
  assert.equal(calls, 1);
});

test("fetchSnapshot: a relative redirect is resolved and still checked", async () => {
  const req = resolveAdapter("https://example.com/post")!;
  const seen: string[] = [];
  const snap = await fetchSnapshot(req, AT, async (input) => {
    const url = String(input);
    seen.push(url);
    if (seen.length === 1) return redirectTo("/moved");
    return new Response('<meta property="og:title" content="Moved">', {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }, publicLookup);
  assert.deepEqual(seen, ["https://example.com/post", "https://example.com/moved"]);
  assert.equal(snap.content, "Moved");
});

test("fetchSnapshot: a redirect loop terminates instead of hanging", async () => {
  const req = resolveAdapter("https://example.com/post")!;
  await assert.rejects(
    () => fetchSnapshot(req, AT, async () => redirectTo("https://example.com/post"), publicLookup),
    /too many redirects/,
  );
});

test("downloadAssets: an og:image pointing at a private address is refused, not committed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "embeds-"));
  const map = await downloadAssets(
    ["http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    cwd,
    "slug123",
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    publicLookup,
  );
  assert.deepEqual(map, {});
  assert.ok(!existsSync(join(cwd, "public/embeds/slug123/asset-0.img")));
});
