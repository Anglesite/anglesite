/**
 * Current-membership snapshots (`data/community-members/{id}.json`) — the render half of V-5.1b
 * (#907). The schema mirrors `CommunityMember.swift` (the authoritative contract, see
 * `docs/superpowers/specs/2026-07-22-v5-communities-design.md` §4.2): one file per current member
 * of a hosted community, snapshotted from the Group actor's own Worker followers collection into
 * the site's git repo. Members = followers (design doc §2 D3) — a member who leaves or is banned
 * simply drops out of the fetched set, and their snapshot file is removed on the next reconcile.
 *
 * Pure logic only — the `import.meta.glob` call lives in `CommunityMembers.astro` (the
 * `communityPosts.ts`/`CommunityTimeline.astro` pattern) so these functions stay testable under
 * `npx tsx --test`.
 *
 * These files are third-party-derived (any fediverse member of the community can be a follower),
 * so a malformed one is skipped with a warning, never a build failure — same contract as
 * `communityPosts.ts`.
 */
import { z } from "astro/zod";

/**
 * `z.string().url()` accepts any scheme `new URL()` can parse, including `javascript:`. These
 * fields flow straight into `href`/`src` in `CommunityMembers.astro`, so scheme must be
 * restricted to http(s) to close the stored-XSS vector. Mirrors `communityPosts.ts`'s `httpUrl`.
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

const communityMemberSchema = z.object({
  /// Path-traversal guard: same rule as CommunityMember.swift's init.
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  actorURL: httpUrl,
  name: z.string().optional(),
  photo: httpUrl.optional(),
});

export type CommunityMember = z.infer<typeof communityMemberSchema>;

/**
 * Validates a glob module map (path → JSON module) into community members. Eager JSON globs wrap
 * each file in `{ default }`; bare values are accepted too. Invalid files are skipped with a
 * `console.warn` naming the file — mirrors `communityPosts.ts`'s `parseCommunityPosts`.
 */
export function parseCommunityMembers(mods: Record<string, unknown>): CommunityMember[] {
  const out: CommunityMember[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const value = mod && typeof mod === "object" && "default" in mod ? (mod as { default: unknown }).default : mod;
    const parsed = communityMemberSchema.safeParse(value);
    if (!parsed.success) {
      console.warn(`[communityMembers] skipping invalid snapshot ${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

/** Alphabetical by display name (falling back to the actor host) — a membership roster, not a
 * timeline, so there's no natural chronological order to sort by (see CommunityMember.swift's
 * "no joinedAt" note). */
export function roster(members: CommunityMember[]): CommunityMember[] {
  return [...members].sort((a, b) => memberSortKey(a).localeCompare(memberSortKey(b)));
}

function memberSortKey(member: CommunityMember): string {
  return (member.name ?? new URL(member.actorURL).hostname).toLowerCase();
}
