/**
 * Astro content collection schemas.
 *
 * Validates frontmatter at build time for all Markdoc files in
 * `src/content/`. The Zod schema here must stay in sync with the
 * Keystatic field definitions in `keystatic.config.ts`.
 *
 * @see https://docs.astro.build/en/guides/content-collections/
 * @module
 */

import { defineCollection, z } from "astro:content";

/** Blog posts stored in `src/content/posts/` as `.mdx` / `.mdoc` files. */
const posts = defineCollection({
  type: "content",
  schema: z.object({
    /** Post title (also used as the URL slug source in Keystatic). */
    title: z.string(),
    /** Short summary for search engines and social sharing. */
    description: z.string(),
    /** ISO date string, transformed to a `Date` object at build time. */
    publishDate: z.string().transform((str) => new Date(str)),
    /** Path relative to `public/` (e.g. `/images/blog/photo.webp`). */
    image: z.string().optional(),
    /** Alt text for the post image — required if `image` is set. */
    imageAlt: z.string().optional(),
    /** Categorization tags, customized per business by `/anglesite:design-interview`. */
    tags: z.array(z.string()).default([]),
    /** When true, the post is excluded from the production build and RSS feed. */
    draft: z.boolean().default(false),
    /** URLs where this post was cross-posted (rendered as `u-syndication` links). */
    syndication: z.array(z.string().url()).default([]),
  }),
});

/** All content collections exported for Astro's build pipeline. */
export const collections = { posts };
