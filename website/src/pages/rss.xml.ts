import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

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
        link: `/blog/${post.id}/`,
      })),
  });
}
