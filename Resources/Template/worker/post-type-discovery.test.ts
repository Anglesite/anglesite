// Resources/Template/worker/post-type-discovery.test.ts
import { describe, expect, test } from "vitest";
import { discoverCollection, generateSlug } from "./post-type-discovery.ts";
import type { Mf2Object, MicropubCommands } from "@dwk/micropub";

function mf2(type: string, properties: Record<string, unknown[]> = {}): Mf2Object {
  return { type: [type], properties };
}

function commands(overrides: Partial<MicropubCommands> = {}): MicropubCommands {
  return { syndicateTo: [], ...overrides };
}

describe("discoverCollection", () => {
  test("h-event maps to events", () => {
    expect(discoverCollection(mf2("h-event", { name: ["Meetup"] }))).toBe("events");
  });

  test("h-review maps to reviews", () => {
    expect(discoverCollection(mf2("h-review", { "item-reviewed": ["A Book"] }))).toBe("reviews");
  });

  test("an unrecognized h-* type returns null", () => {
    expect(discoverCollection(mf2("h-card", { name: ["Jane"] }))).toBeNull();
  });

  test("bookmark-of maps to bookmarks", () => {
    expect(discoverCollection(mf2("h-entry", { "bookmark-of": ["https://example.com"] }))).toBe("bookmarks");
  });

  test("like-of maps to likes", () => {
    expect(discoverCollection(mf2("h-entry", { "like-of": ["https://example.com"] }))).toBe("likes");
  });

  test("in-reply-to maps to replies", () => {
    expect(discoverCollection(mf2("h-entry", { "in-reply-to": ["https://example.com"] }))).toBe("replies");
  });

  test("exactly one photo maps to photos", () => {
    expect(discoverCollection(mf2("h-entry", { photo: ["https://example.com/a.jpg"] }))).toBe("photos");
  });

  test("two or more photos maps to albums", () => {
    expect(discoverCollection(mf2("h-entry", {
      photo: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    }))).toBe("albums");
  });

  test("a name whose content doesn't start with it maps to articles", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["My Big Announcement"],
      content: ["Today I'm launching something new..."],
    }))).toBe("articles");
  });

  test("a name that is just the start of the content (auto-derived) maps to notes", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["Hello world"],
      content: ["Hello world"],
    }))).toBe("notes");
  });

  test("no name at all maps to notes", () => {
    expect(discoverCollection(mf2("h-entry", { content: ["Just a quick note"] }))).toBe("notes");
  });

  test("rich-text content object is read via its plain-text value", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["My Announcement"],
      content: [{ html: "<p>Something else entirely</p>", value: "Something else entirely" }],
    }))).toBe("articles");
  });

  test("rich-text content object with only an html key (the standard Micropub create shape, no value key) is read via html", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["My Announcement"],
      content: [{ html: "<p>Something else entirely</p>" }],
    }))).toBe("articles");
  });

  test("absent mf2 type ([]) is treated as h-entry", () => {
    expect(discoverCollection({ type: [], properties: { content: ["hi"] } })).toBe("notes");
  });

  test("empty content does not trigger the article check even with a name present", () => {
    expect(discoverCollection(mf2("h-entry", { name: ["Untitled"] }))).toBe("notes");
  });

  test("repost-of returns null", () => {
    expect(discoverCollection(mf2("h-entry", { "repost-of": ["https://example.com/post"] }))).toBeNull();
  });

  test("rsvp returns null", () => {
    expect(discoverCollection(mf2("h-entry", { rsvp: ["yes"] }))).toBeNull();
  });

  test("an RSVP (rsvp + in-reply-to together — the standard RSVP shape) returns null, not replies", () => {
    expect(discoverCollection(mf2("h-entry", {
      "in-reply-to": ["https://example.com/event"],
      rsvp: ["yes"],
    }))).toBeNull();
  });

  test("checkin returns null", () => {
    expect(discoverCollection(mf2("h-entry", { checkin: [{ type: ["h-card"], properties: { name: ["Venue"] } }] }))).toBeNull();
  });

  test("video returns null", () => {
    expect(discoverCollection(mf2("h-entry", { video: ["https://example.com/video.mp4"] }))).toBeNull();
  });

  test("a name that is a prefix of longer content (not the whole content) still maps to notes", () => {
    expect(discoverCollection(mf2("h-entry", {
      name: ["Hello world"],
      content: ["Hello world and much more than that"],
    }))).toBe("notes");
  });
});

describe("generateSlug", () => {
  test("prefers an explicit mp-slug command", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands({ slug: "my-slug" }));
    expect(slug).toBe("my-slug");
  });

  test("falls back to a slugified name", () => {
    const slug = generateSlug(mf2("h-entry", { name: ["Hello, World!"] }), commands());
    expect(slug).toBe("hello-world");
  });

  test("falls back to a random timestamp-based slug when there is no slug or name", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands());
    expect(slug).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
  });

  test("an mp-slug containing a slash is sanitized to a single path segment", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands({ slug: "notes/x" }));
    expect(slug).not.toContain("/");
    expect(slug).toBe("notes-x");
  });

  test("an mp-slug that sluggifies to empty falls through to the name-derived slug", () => {
    const slug = generateSlug(mf2("h-entry", { name: ["Hello"] }), commands({ slug: "///" }));
    expect(slug).toBe("hello");
  });

  test("an mp-slug that sluggifies to empty with no name falls through to a random slug", () => {
    const slug = generateSlug(mf2("h-entry", { content: ["hi"] }), commands({ slug: "///" }));
    expect(slug).toMatch(/^[0-9a-z]+-[0-9a-z]{4}$/);
  });
});
