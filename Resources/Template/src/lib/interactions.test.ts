import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInteractions, interactionsFor, type ReceivedInteraction } from "./interactions.ts";

const TARGET = "https://example.com/blog/hello-world/";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wm-abc123",
    type: "webmention",
    source: "https://other.example/post/42",
    target: TARGET,
    interactionType: "reply",
    author: { name: "Jane Doe", url: "https://other.example", photo: "https://other.example/photo.jpg" },
    content: "Great post!",
    published: "2026-06-28T14:30:00Z",
    verified: "2026-06-28T14:35:12Z",
    verificationStatus: "verified",
    ...overrides,
  };
}

/** Build a glob-shaped module map (JSON eager glob wraps each file in `{ default }`). */
function mods(...files: Record<string, unknown>[]): Record<string, unknown> {
  return Object.fromEntries(files.map((f, i) => [`../../data/interactions/f${i}.json`, { default: f }]));
}

test("parses a valid interaction from a glob module map", () => {
  const all = parseInteractions(mods(raw()));
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "wm-abc123");
  assert.equal(all[0].author?.name, "Jane Doe");
});

test("accepts a bare (non-default-wrapped) module value", () => {
  const all = parseInteractions({ "../../data/interactions/x.json": raw() });
  assert.equal(all.length, 1);
});

test("skips malformed files with a warning instead of throwing", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const all = parseInteractions(
      mods(
        raw(),
        raw({ id: "../evil" }), // fails the [A-Za-z0-9_-]+ id rule
        raw({ target: undefined }), // missing required field
        raw({ interactionType: "poke" }), // unknown enum value
      ),
    );
    assert.equal(all.length, 1);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /interactions/);
  } finally {
    console.warn = origWarn;
  }
});

test("skips non-verified interactions", () => {
  const all = parseInteractions(
    mods(raw(), raw({ id: "wm-2", verificationStatus: "pending" }), raw({ id: "wm-3", verificationStatus: "failed" })),
  );
  assert.deepEqual(
    all.map((i) => i.id),
    ["wm-abc123"],
  );
});

test("rejects non-http(s) URL schemes on source/target/author fields", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const all = parseInteractions(
      mods(
        raw({ id: "a", source: "javascript:alert(document.cookie)" }),
        raw({ id: "b", target: "javascript:alert(1)" }),
        raw({ id: "c", author: { name: "Evil", url: "javascript:alert(1)" } }),
        raw({ id: "d", author: { name: "Evil", photo: "javascript:alert(1)" } }),
      ),
    );
    assert.equal(all.length, 0);
    assert.equal(warnings.length, 4);
  } finally {
    console.warn = origWarn;
  }
});

test("author and content are optional", () => {
  const all = parseInteractions(mods(raw({ author: undefined, content: undefined })));
  assert.equal(all.length, 1);
  assert.equal(all[0].author, undefined);
  assert.equal(all[0].content, undefined);
});

test("interactionsFor matches targets regardless of trailing slash", () => {
  const all = parseInteractions(
    mods(
      raw({ id: "a", target: "https://example.com/blog/hello-world" }),
      raw({ id: "b", target: "https://example.com/blog/hello-world/" }),
      raw({ id: "c", target: "https://example.com/blog/other/" }),
    ),
  );
  const grouped = interactionsFor("https://example.com/blog/hello-world/", all);
  assert.deepEqual(grouped.comments.map((i: ReceivedInteraction) => i.id).sort(), ["a", "b"]);
  const groupedNoSlash = interactionsFor("https://example.com/blog/hello-world", all);
  assert.equal(groupedNoSlash.comments.length, 2);
});

test("interactionsFor groups by interaction type and sorts comments by published", () => {
  const all = parseInteractions(
    mods(
      raw({ id: "later", published: "2026-07-02T00:00:00Z" }),
      raw({ id: "earlier", published: "2026-07-01T00:00:00Z" }),
      raw({ id: "like1", interactionType: "like" }),
      raw({ id: "repost1", interactionType: "repost" }),
      raw({ id: "mention1", interactionType: "mention" }),
      raw({ id: "bookmark1", interactionType: "bookmark" }),
    ),
  );
  const g = interactionsFor(TARGET, all);
  assert.deepEqual(
    g.comments.map((i) => i.id),
    ["earlier", "later"],
  );
  assert.deepEqual(
    g.facepile.likes.map((i) => i.id),
    ["like1"],
  );
  assert.deepEqual(
    g.facepile.reposts.map((i) => i.id),
    ["repost1"],
  );
  assert.deepEqual(g.mentions.map((i) => i.id).sort(), ["bookmark1", "mention1"]);
  assert.equal(g.total, 6);
});

test("empty input yields empty groups", () => {
  assert.deepEqual(parseInteractions({}), []);
  const g = interactionsFor(TARGET, []);
  assert.equal(g.total, 0);
  assert.equal(g.comments.length, 0);
  assert.equal(g.facepile.likes.length, 0);
  assert.equal(g.facepile.reposts.length, 0);
  assert.equal(g.mentions.length, 0);
});
