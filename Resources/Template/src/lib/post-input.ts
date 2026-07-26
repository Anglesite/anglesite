/**
 * Maps a note/article entry's `audience` field (a Group actor IRI) to the shape the V-4 outbox
 * Worker's `PostInput` expects for community federation (V-5.2a, #369 — Stage 1, inert until the
 * V-4 outbox lands, #363).
 *
 * `PostInput` itself is defined in the sibling `davidwkeith/workers` repo, gated behind a
 * conformant `@dwk/workers` release (AGENTS.md "Personal Publishing OS pivot"). Nothing here
 * calls a Worker — this only locks the mapping contract from the design spike
 * (docs/superpowers/specs/2026-07-22-v5-communities-design.md §3): "audience set, Group in `to`,
 * and `kind: 'page'` + title for Lemmy-style targets that require a `name`."
 */

/** The subset of the Worker's `PostInput` this projection populates. */
export interface PostInput {
  audience: string;
  kind: "note" | "page";
  name?: string;
  content: string;
}

/** The fields of a note/article entry this projection reads. */
export interface AudiencePostEntry {
  audience?: string;
  title?: string;
  body: string;
}

/**
 * `null` when the entry has no `audience` — the common case until a member actually posts to a
 * community. Title-bearing entries (articles) map to `kind: "page"` + `name` so Lemmy-style
 * targets requiring a title accept the post; untitled entries (notes) stay `kind: "note"`.
 */
export function postInputFor(entry: AudiencePostEntry): PostInput | null {
  if (!entry.audience) return null;
  if (entry.title) {
    return { audience: entry.audience, kind: "page", name: entry.title, content: entry.body };
  }
  return { audience: entry.audience, kind: "note", content: entry.body };
}
