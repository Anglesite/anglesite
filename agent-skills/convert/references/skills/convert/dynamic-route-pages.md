# Dynamic route pages

## Tag pages

If the source site had tag pages, create two files:

**`src/pages/tags/index.astro`** — lists all tags with post counts:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { getCollection } from "astro:content";

export const prerender = true;

const allPosts = await getCollection("posts", ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});

const tags = [...new Set(allPosts.flatMap((post) => post.data.tags ?? []))].sort();
const tagCounts = Object.fromEntries(
  tags.map((tag) => [
    tag,
    allPosts.filter((post) => post.data.tags?.includes(tag)).length,
  ]),
);
---

<BaseLayout title="Tags" description="Browse posts by tag">
  <h1>Tags</h1>
  <ul class="tag-list">
    {
      tags.map((tag) => (
        <li>
          <a href={`/tags/${tag}/`}>
            {tag} ({tagCounts[tag]})
          </a>
        </li>
      ))
    }
  </ul>
</BaseLayout>
```

**`src/pages/tags/[tag].astro`** — lists posts for a single tag:

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
import { getCollection } from "astro:content";

export const prerender = true;

export async function getStaticPaths() {
  const allPosts = await getCollection("posts", ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  const tags = [...new Set(allPosts.flatMap((post) => post.data.tags ?? []))];

  return tags.map((tag) => ({
    params: { tag },
    props: {
      posts: allPosts
        .filter((post) => post.data.tags?.includes(tag))
        .sort(
          (a, b) =>
            b.data.publishDate.getTime() - a.data.publishDate.getTime(),
        ),
    },
  }));
}

const { tag } = Astro.params;
const { posts } = Astro.props;
---

<BaseLayout title={`Posts tagged "${tag}"`} description={`All posts tagged "${tag}"`}>
  <h1>Posts tagged &ldquo;{tag}&rdquo;</h1>
  <ul class="post-list">
    {
      posts.map((post) => (
        <li class="h-entry">
          <a href={`/POST_URL_PREFIX/${post.id}/`} class="u-url">
            <h2 class="p-name">{post.data.title}</h2>
          </a>
          <time
            class="dt-published"
            datetime={post.data.publishDate.toISOString()}
          >
            {post.data.publishDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <p class="p-summary">{post.data.description}</p>
        </li>
      ))
    }
  </ul>
</BaseLayout>
```

Replace `POST_URL_PREFIX` in the href with the value from `.site-config`
(same logic as Step 4.5).

## Category pages

If the source site had category pages, create the same structure under
`src/pages/categories/`:
- `src/pages/categories/index.astro` — lists all categories
- `src/pages/categories/[category].astro` — lists posts per category

Use the same pattern as tag pages but filter on `post.data.categories`
instead of `post.data.tags`. If the Keystatic content schema doesn't have
a `categories` field, check whether the source used categories and add the
field to `keystatic.config.ts` and `src/content.config.ts` if needed.

## Author pages

If the source site had author pages and posts have an `author` field,
create `src/pages/authors/[author].astro` using the same pattern.

## Date archive pages

If the source site had year or month archive pages (e.g., `/2025/` or
`/2025/01/`), create:
- `src/pages/archive/[year].astro` — lists posts for a year
- Optionally `src/pages/archive/[year]/[month].astro` — lists posts for a month

## Custom pagination pages

For any other pagination types discovered, create equivalent Astro dynamic
routes following the same pattern: `export const prerender = true`,
`getStaticPaths()` that returns all possible values, and a listing template.

## Redirects for pagination pages

If the source site served tag pages at a different path than `/tags/{tag}/`
(e.g., Hugo's default `/tags/{tag}/` vs. a custom taxonomy path), add
redirect rules in Step 4.
