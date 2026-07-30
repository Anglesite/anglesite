/**
 * Announced-post snapshots (`data/community-posts/{id}.json`) — the render half of V-5.2b
 * (#908). The schema mirrors `AnnouncedPost.swift` (the authoritative contract, see
 * `docs/superpowers/specs/2026-07-22-v5-communities-design.md` §4.3): one file per member post
 * a hosted community announced to its membership, snapshotted from the Group actor's own Worker
 * outbox into the site's git repo. FEP-1b12 is author-owns-post — the member's canonical copy
 * stays on their own site; this is only the community's snapshot of what it announced.
 *
 * Pure logic only — the `import.meta.glob` call lives in `CommunityTimeline.astro` (the
 * `feeds.ts`/`interactions.ts` pattern) so these functions stay testable under `npx tsx --test`.
 *
 * These files are third-party-derived and moderator-editable (moderation = delete the file, see
 * #370), so a malformed one is skipped with a warning, never a build failure.
 */
import { z } from "astro/zod";

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "not an ISO 8601 date" });

/**
 * `z.string().url()` accepts any scheme `new URL()` can parse, including `javascript:`. These
 * fields are attacker-controlled (any fediverse member of the community can post), and flow
 * straight into `href`/`src` in `CommunityTimeline.astro`, so scheme must be restricted to
 * http(s) to close the stored-XSS vector. Mirrors `interactions.ts`'s `httpUrl`.
 */
const httpUrl = z.string().url().refine(
  (s) => {
    try {
      return ["http:", "https:"].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL" },
);

const communityPostSchema = z.object({
  /// Path-traversal guard: same rule as AnnouncedPost.swift's init.
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  objectType: z.enum(["note", "article", "page", "video", "event"]),
  sourceURL: httpUrl,
  author: z
    .object({
      name: z.string().optional(),
      url: httpUrl.optional(),
      photo: httpUrl.optional(),
    })
    .optional(),
  content: z.string().optional(),
  published: isoDate,
  announcedAt: isoDate,
});

export type AnnouncedPost = z.infer<typeof communityPostSchema>;

/**
 * Validates a glob module map (path → JSON module) into announced posts. Eager JSON globs wrap
 * each file in `{ default }`; bare values are accepted too. Invalid files are skipped with a
 * `console.warn` naming the file — mirrors `interactions.ts`'s `parseInteractions`.
 */
export function parseCommunityPosts(mods: Record<string, unknown>): AnnouncedPost[] {
  const out: AnnouncedPost[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const value = mod && typeof mod === "object" && "default" in mod ? (mod as { default: unknown }).default : mod;
    const parsed = communityPostSchema.safeParse(value);
    if (!parsed.success) {
      console.warn(`[communityPosts] skipping invalid snapshot ${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

/** Newest-first — the community timeline shows every announced post, unlike a per-entry comment thread. */
export function timeline(posts: AnnouncedPost[]): AnnouncedPost[] {
  return [...posts].sort((a, b) => Date.parse(b.announcedAt) - Date.parse(a.announcedAt));
}
