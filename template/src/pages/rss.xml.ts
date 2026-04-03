/**
 * RSS feed endpoint — generates `/rss.xml` at build time.
 *
 * Includes all published (non-draft) blog posts sorted newest-first.
 * Discovered via `<link rel="alternate">` in the base layout `<head>`.
 *
 * @see https://docs.astro.build/en/guides/rss/
 * @module
 */

import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

/**
 * Astro API route handler that returns the RSS XML document.
 *
 * @param context - Astro API context (provides `site` from `astro.config.ts`)
 * @returns RSS XML response with all published posts
 */
export async function GET(context: APIContext) {
  const posts = await getCollection("posts", ({ data }) => !data.draft);

  return rss({
    title: "Blog",
    description: "Latest posts",
    site: context.site!,
    items: posts
      .sort(
        (a, b) =>
          b.data.publishDate.getTime() - a.data.publishDate.getTime(),
      )
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.publishDate,
        link: `/blog/${post.id.replace(/\.mdoc$/, "")}/`,
      })),
  });
}
