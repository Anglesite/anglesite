/**
 * Received-interaction snapshots (`data/interactions/{id}.json`) — the render half of
 * V-3.4. The schema mirrors `ReceivedInteraction.swift` (the authoritative contract, see
 * `docs/specs/2026-06-29-c3-received-interaction-canonicality.md`): one file per verified
 * interaction, snapshotted from the Worker's inbox into the site's git repo.
 *
 * Pure logic only — the `import.meta.glob` call lives in `Interactions.astro` (the
 * `feeds.ts` pattern) so these functions stay testable under `npx tsx --test`.
 *
 * These files are third-party-derived and user-editable (moderation = delete the file),
 * so a malformed one is skipped with a warning, never a build failure.
 */
import { z } from "astro/zod";

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "not an ISO 8601 date" });

/**
 * `z.string().url()` accepts any scheme `new URL()` can parse, including `javascript:`.
 * These fields are attacker-controlled (any anonymous webmention/ActivityPub sender) and
 * flow straight into `href`/`src` in Interactions.astro, so scheme must be restricted to
 * http(s) to close the stored-XSS vector.
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

const interactionSchema = z.object({
  /// Path-traversal guard: same rule as ReceivedInteraction.swift's init.
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(["webmention", "activitypub", "micropub"]),
  source: httpUrl,
  target: httpUrl,
  interactionType: z.enum(["reply", "like", "repost", "bookmark", "mention"]),
  author: z
    .object({
      name: z.string().optional(),
      url: httpUrl.optional(),
      photo: httpUrl.optional(),
    })
    .optional(),
  content: z.string().optional(),
  published: isoDate,
  verified: isoDate,
  verificationStatus: z.enum(["verified", "pending", "failed"]),
});

export type ReceivedInteraction = z.infer<typeof interactionSchema>;

export interface GroupedInteractions {
  /** Replies, sorted by `published` ascending — the threaded comment section. */
  comments: ReceivedInteraction[];
  /** Likes and reposts — rendered as avatar facepiles. */
  facepile: { likes: ReceivedInteraction[]; reposts: ReceivedInteraction[] };
  /** Mentions and bookmarks — the "mentioned by" line. */
  mentions: ReceivedInteraction[];
  total: number;
}

/**
 * Validates a glob module map (path → JSON module) into verified interactions.
 * Eager JSON globs wrap each file in `{ default }`; bare values are accepted too.
 * Invalid files are skipped with a `console.warn` naming the file.
 */
export function parseInteractions(mods: Record<string, unknown>): ReceivedInteraction[] {
  const out: ReceivedInteraction[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const value = mod && typeof mod === "object" && "default" in mod ? (mod as { default: unknown }).default : mod;
    const parsed = interactionSchema.safeParse(value);
    if (!parsed.success) {
      console.warn(`[interactions] skipping invalid snapshot ${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    if (parsed.data.verificationStatus !== "verified") continue;
    out.push(parsed.data);
  }
  return out;
}

/** Trailing-slash-insensitive URL comparison key (origin lowercased, query/hash ignored). */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return u.origin.toLowerCase() + u.pathname.replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Groups the interactions whose `target` is `canonicalUrl` for rendering. */
export function interactionsFor(canonicalUrl: string, all: ReceivedInteraction[]): GroupedInteractions {
  const key = urlKey(canonicalUrl);
  const matching = all.filter((i) => urlKey(i.target) === key);
  const comments = matching
    .filter((i) => i.interactionType === "reply")
    .sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  return {
    comments,
    facepile: {
      likes: matching.filter((i) => i.interactionType === "like"),
      reposts: matching.filter((i) => i.interactionType === "repost"),
    },
    mentions: matching.filter((i) => i.interactionType === "mention" || i.interactionType === "bookmark"),
    total: matching.length,
  };
}
