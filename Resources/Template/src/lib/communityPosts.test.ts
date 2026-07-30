import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommunityPosts, timeline, type AnnouncedPost } from "./communityPosts.ts";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "community-abc123",
    objectType: "note",
    sourceURL: "https://member.example/posts/42",
    author: { name: "Jane Doe", url: "https://member.example", photo: "https://member.example/photo.jpg" },
    content: "Hello, community!",
    published: "2026-06-28T14:30:00Z",
    announcedAt: "2026-06-28T14:30:05Z",
    ...overrides,
  };
}

/** Build a glob-shaped module map (JSON eager glob wraps each file in `{ default }`). */
function mods(...files: Record<string, unknown>[]): Record<string, unknown> {
  return Object.fromEntries(files.map((f, i) => [`../../data/community-posts/f${i}.json`, { default: f }]));
}

test("parses a valid announced post from a glob module map", () => {
  const all = parseCommunityPosts(mods(raw()));
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "community-abc123");
  assert.equal(all[0].author?.name, "Jane Doe");
});

test("accepts a bare (non-default-wrapped) module value", () => {
  const all = parseCommunityPosts({ "../../data/community-posts/x.json": raw() });
  assert.equal(all.length, 1);
});

test("skips malformed files with a warning instead of throwing", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const all = parseCommunityPosts(
      mods(
        raw(),
        raw({ id: "../evil" }), // fails the [A-Za-z0-9_-]+ id rule
        raw({ sourceURL: undefined }), // missing required field
        raw({ objectType: "poke" }), // unknown enum value
      ),
    );
    assert.equal(all.length, 1);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /communityPosts/);
  } finally {
    console.warn = origWarn;
  }
});

test("every AS2 object type parses", () => {
  const all = parseCommunityPosts(
    mods(
      raw({ id: "a", objectType: "note" }),
      raw({ id: "b", objectType: "article" }),
      raw({ id: "c", objectType: "page" }),
      raw({ id: "d", objectType: "video" }),
      raw({ id: "e", objectType: "event" }),
    ),
  );
  assert.equal(all.length, 5);
});

test("rejects non-http(s) URL schemes on sourceURL/author fields", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const all = parseCommunityPosts(
      mods(
        raw({ id: "a", sourceURL: "javascript:alert(document.cookie)" }),
        raw({ id: "b", author: { name: "Evil", url: "javascript:alert(1)" } }),
        raw({ id: "c", author: { name: "Evil", photo: "javascript:alert(1)" } }),
      ),
    );
    assert.equal(all.length, 0);
    assert.equal(warnings.length, 3);
  } finally {
    console.warn = origWarn;
  }
});

test("author and content are optional", () => {
  const all = parseCommunityPosts(mods(raw({ author: undefined, content: undefined })));
  assert.equal(all.length, 1);
  assert.equal(all[0].author, undefined);
  assert.equal(all[0].content, undefined);
});

test("timeline sorts newest announcedAt first", () => {
  const all = parseCommunityPosts(
    mods(
      raw({ id: "earlier", announcedAt: "2026-07-01T00:00:00Z" }),
      raw({ id: "later", announcedAt: "2026-07-02T00:00:00Z" }),
      raw({ id: "middle", announcedAt: "2026-07-01T12:00:00Z" }),
    ),
  );
  const sorted = timeline(all);
  assert.deepEqual(
    sorted.map((p: AnnouncedPost) => p.id),
    ["later", "middle", "earlier"],
  );
});

test("timeline does not mutate its input", () => {
  const all = parseCommunityPosts(
    mods(raw({ id: "a", announcedAt: "2026-07-01T00:00:00Z" }), raw({ id: "b", announcedAt: "2026-07-02T00:00:00Z" })),
  );
  const originalOrder = all.map((p) => p.id);
  timeline(all);
  assert.deepEqual(all.map((p) => p.id), originalOrder);
});

test("empty input yields an empty timeline", () => {
  assert.deepEqual(parseCommunityPosts({}), []);
  assert.deepEqual(timeline([]), []);
});
