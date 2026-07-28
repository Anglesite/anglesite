import { getCollection } from "astro:content";
import { TAGGED_COLLECTIONS } from "./collections.ts";
import type { TaggedEntry } from "./tags.ts";

/**
 * Fetches every entry across `TAGGED_COLLECTIONS` that carries at least one tag, flattened into
 * the plain-object shape `tags.ts`'s pure helpers (`groupByTag`, `tagCounts`, …) operate on.
 * Lives in its own `astro:content`-importing file — separate from `tags.ts` — so that file can
 * stay importable (and unit-testable with plain `node:test`) outside Astro's Vite pipeline,
 * same rationale as `content-schemas.ts`. Shared by both `tags/index.astro` and
 * `tags/[tag]/index.astro` so the two pages can't drift on which fields matter or how drafts
 * are filtered.
 *
 * Drafts are excluded in PROD, matching `blog/index.astro` and `[collection]/[...slug].astro`'s
 * convention — a draft's tags shouldn't surface (or inflate counts) on a page whose own entry
 * page isn't built.
 */
export async function collectTaggedEntries(): Promise<TaggedEntry[]> {
  const entries: TaggedEntry[] = [];
  for (const collection of TAGGED_COLLECTIONS) {
    const items = await getCollection(collection, ({ data }) =>
      import.meta.env.PROD ? !(data as { draft?: boolean }).draft : true,
    );
    for (const item of items) {
      const data = item.data as {
        tags?: string[];
        title?: string;
        summary?: string;
        caption?: string;
        publishDate: Date;
      };
      const tags = Array.isArray(data.tags) ? data.tags : [];
      if (tags.length === 0) continue;
      entries.push({
        id: item.id,
        collection,
        tags,
        title: data.title,
        summary: data.summary,
        caption: data.caption,
        body: item.body,
        publishDate: data.publishDate,
      });
    }
  }
  return entries;
}
