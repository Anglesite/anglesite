/**
 * Plugin-side tests for the IndieWeb static wiring (issue #337, design §7):
 *
 *   - Discovery-link injection in BaseLayout.astro is gated per-endpoint on
 *     the .site-config flags — each <link> renders only when its flag is set.
 *   - wrangler.jsonc carries the full binding union after the skill wires it.
 *   - The Keystatic `notes` collection shape, and a .mdoc rendered from a
 *     sample mf2 record by the bridge, agree with that shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderMdoc } from "../template/worker/indieweb-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const baseLayout = readFileSync(
  join(root, "template", "src", "layouts", "BaseLayout.astro"),
  "utf-8",
);
const wranglerRaw = readFileSync(
  join(root, "template", "wrangler.jsonc"),
  "utf-8",
);
const contentConfig = readFileSync(
  join(root, "template", "src", "content.config.ts"),
  "utf-8",
);
const keystatic = readFileSync(
  join(root, "template", "keystatic.config.ts"),
  "utf-8",
);

// The notes collection's full field set — the contract the bridge's .mdoc
// output must stay within.
const NOTES_FIELDS = [
  "slug",
  "publishDate",
  "title",
  "image",
  "imageAlt",
  "inReplyTo",
  "bookmarkOf",
  "likeOf",
  "repostOf",
  "syndication",
  "draft",
];

describe("BaseLayout discovery-link gating", () => {
  it("derives each endpoint flag from .site-config", () => {
    expect(baseLayout).toMatch(/INDIEWEB_INDIEAUTH=true/);
    expect(baseLayout).toMatch(/INDIEWEB_MICROPUB=true/);
    expect(baseLayout).toMatch(/INDIEWEB_WEBMENTION=true/);
    expect(baseLayout).toMatch(/indieauthEnabled\s*=/);
    expect(baseLayout).toMatch(/micropubEnabled\s*=/);
    expect(baseLayout).toMatch(/webmentionEnabled\s*=/);
  });

  it("gates each IndieAuth discovery link on indieauthEnabled", () => {
    expect(baseLayout).toContain(
      '{indieauthEnabled && <link rel="indieauth-metadata"',
    );
    expect(baseLayout).toContain(
      '{indieauthEnabled && <link rel="authorization_endpoint"',
    );
    expect(baseLayout).toContain(
      '{indieauthEnabled && <link rel="token_endpoint"',
    );
  });

  it("gates the Micropub discovery link on micropubEnabled", () => {
    expect(baseLayout).toContain('{micropubEnabled && <link rel="micropub"');
  });

  it("gates the Webmention discovery link on webmentionEnabled", () => {
    expect(baseLayout).toContain(
      '{webmentionEnabled && <link rel="webmention"',
    );
  });

  it("never emits an IndieWeb discovery link unconditionally", () => {
    // Every rel must appear behind a `{flag && <link ...` guard, so a site
    // that hasn't run the skill ships none of them.
    const rels = [
      "indieauth-metadata",
      "authorization_endpoint",
      "token_endpoint",
      "micropub",
      "webmention",
    ];
    for (const rel of rels) {
      const matches = baseLayout.match(
        new RegExp(`<link rel="${rel}"`, "g"),
      ) ?? [];
      const guarded =
        baseLayout.match(
          new RegExp(`Enabled && <link rel="${rel}"`, "g"),
        ) ?? [];
      expect(matches.length, rel).toBe(guarded.length);
    }
  });
});

describe("wrangler.jsonc binding union after wiring", () => {
  // wrangler.jsonc only uses full-line // comments and no trailing commas,
  // so stripping comment lines yields parseable JSON.
  const config = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, ""));

  it("targets the composed worker entry and the ASSETS binding", () => {
    expect(config.main).toBe("worker/site-entry.js");
    expect(config.assets.binding).toBe("ASSETS");
  });

  it("declares all three IndieWeb D1 databases", () => {
    const byBinding = Object.fromEntries(
      config.d1_databases.map((d: any) => [d.binding, d]),
    );
    expect(byBinding.AUTH_DB.database_name).toBe("indieauth");
    expect(byBinding.MICROPUB_DB.database_name).toBe("micropub");
    expect(byBinding.WEBMENTION_INBOX.database_name).toBe("webmention");
  });

  it("declares the SITE_URL var (@dwk/webmention baseUrl source)", () => {
    expect(config.vars).toBeTruthy();
    expect("SITE_URL" in config.vars).toBe(true);
  });

  it("declares the Micropub MEDIA R2 bucket", () => {
    const media = config.r2_buckets.find((b: any) => b.binding === "MEDIA");
    expect(media).toBeTruthy();
  });

  it("wires the webmention queue as both producer and consumer", () => {
    const producer = config.queues.producers.find(
      (p: any) => p.binding === "WEBMENTION_QUEUE",
    );
    expect(producer.queue).toBe("webmention-queue");
    const consumer = config.queues.consumers.find(
      (c: any) => c.queue === "webmention-queue",
    );
    expect(consumer).toBeTruthy();
  });

  it("schedules a cron trigger for the bridge/verification retries", () => {
    expect(Array.isArray(config.triggers.crons)).toBe(true);
    expect(config.triggers.crons.length).toBeGreaterThan(0);
  });
});

describe("notes collection shape", () => {
  it("defines the notes collection in both config files", () => {
    expect(contentConfig).toMatch(/const notes = defineCollection\(/);
    expect(keystatic).toContain("notes: collection({");
  });

  it("is titleless-friendly: title is optional, slug is the slug field", () => {
    const schema =
      contentConfig.match(
        /const notes = defineCollection\(\{[\s\S]*?\}\);/,
      )?.[0] ?? "";
    expect(schema).toMatch(/title:\s*z\.string\(\)\.optional\(\)/);
    expect(keystatic).toMatch(/slugField:\s*"slug"/);
    expect(keystatic).toContain('path: "src/content/notes/*"');
  });

  it("declares every notes field in the Zod schema", () => {
    const schema =
      contentConfig.match(
        /const notes = defineCollection\(\{[\s\S]*?\}\);/,
      )?.[0] ?? "";
    for (const field of NOTES_FIELDS) {
      expect(schema, `content.config missing: ${field}`).toContain(field);
    }
  });
});

describe("bridge renders a .mdoc from a sample mf2 record", () => {
  // A realistic Micropub h-entry: titled note with a reply target, a photo,
  // body content, and a syndication link.
  const row = {
    slug: "2026-06-09-x7y8",
    properties: JSON.stringify({
      published: ["2026-06-09T14:30:00Z"],
      name: ["Hello IndieWeb"],
      content: [{ value: "First note via Micropub." }],
      photo: [{ value: "/images/notes/sky.webp", alt: "A blue sky" }],
      "in-reply-to": ["https://example.org/post/42"],
      syndication: ["https://fosstodon.org/@me/123"],
    }),
    created_at: "2026-06-09T14:30:00Z",
    updated_at: null,
  };
  const mdoc = renderMdoc(row);

  it("emits frontmatter delimited by --- with a trailing body", () => {
    expect(mdoc).toMatch(/^---\n[\s\S]*\n---\n/);
    expect(mdoc).toContain("First note via Micropub.");
  });

  it("maps mf2 properties onto the notes schema fields", () => {
    expect(mdoc).toContain("slug: 2026-06-09-x7y8");
    expect(mdoc).toContain('publishDate: "2026-06-09T14:30:00Z"');
    expect(mdoc).toContain("title: Hello IndieWeb");
    expect(mdoc).toContain("image: /images/notes/sky.webp");
    expect(mdoc).toContain("imageAlt: A blue sky");
    expect(mdoc).toContain('inReplyTo: "https://example.org/post/42"');
    expect(mdoc).toContain("syndication:");
    expect(mdoc).toContain('  - "https://fosstodon.org/@me/123"');
    expect(mdoc).toContain("draft: false");
  });

  it("emits no frontmatter key outside the notes collection shape", () => {
    const fm = mdoc.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const keys = [...fm.matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(NOTES_FIELDS, `unexpected frontmatter key: ${key}`).toContain(key);
    }
  });
});
