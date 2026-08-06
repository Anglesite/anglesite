import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommunityMembers, roster } from "./communityMembers.ts";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "member-abc123",
    actorURL: "https://member.example/actor",
    name: "Jane Doe",
    photo: "https://member.example/photo.jpg",
    ...overrides,
  };
}

/** Build a glob-shaped module map (JSON eager glob wraps each file in `{ default }`). */
function mods(...files: Record<string, unknown>[]): Record<string, unknown> {
  return Object.fromEntries(files.map((f, i) => [`../../data/community-members/f${i}.json`, { default: f }]));
}

test("parses a valid community member from a glob module map", () => {
  const all = parseCommunityMembers(mods(raw()));
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "member-abc123");
  assert.equal(all[0].name, "Jane Doe");
});

test("accepts a bare (non-default-wrapped) module value", () => {
  const all = parseCommunityMembers({ "../../data/community-members/x.json": raw() });
  assert.equal(all.length, 1);
});

test("name and photo are optional", () => {
  const all = parseCommunityMembers(mods(raw({ name: undefined, photo: undefined })));
  assert.equal(all.length, 1);
  assert.equal(all[0].name, undefined);
  assert.equal(all[0].photo, undefined);
});

test("skips malformed files with a warning instead of throwing", () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const all = parseCommunityMembers(
      mods(
        raw(),
        raw({ id: "../evil" }), // fails the [A-Za-z0-9_-]+ id rule
        raw({ actorURL: undefined }), // missing required field
        raw({ actorURL: "javascript:alert(1)" }), // non-http(s) scheme
      ),
    );
    assert.equal(all.length, 1);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0], /communityMembers/);
  } finally {
    console.warn = origWarn;
  }
});

test("roster sorts alphabetically by name, case-insensitively", () => {
  const all = parseCommunityMembers(
    mods(raw({ id: "b", name: "bob" }), raw({ id: "a", name: "Alice" }), raw({ id: "c", name: "Carol" })),
  );
  const sorted = roster(all);
  assert.deepEqual(sorted.map((m) => m.id), ["a", "b", "c"]);
});

test("roster falls back to the actor's hostname when name is absent", () => {
  const all = parseCommunityMembers(
    mods(raw({ id: "a", name: undefined, actorURL: "https://zzz.example/actor" }), raw({ id: "b", name: "Alice" })),
  );
  const sorted = roster(all);
  assert.deepEqual(sorted.map((m) => m.id), ["b", "a"]);
});
