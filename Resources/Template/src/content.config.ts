import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { readConfig } from "../scripts/config.ts";
import { createContentAPILoader } from "./lib/content-loader";
import { socialFields, notesSchema, articlesSchema } from "./lib/content-schemas.ts";

/**
 * Picks the CMS content-API loader when `.site-config`'s `CMS_CONTENT_API_URL` is set (CMS mode,
 * slice 4), otherwise the existing `glob()` loader (today's behavior, unchanged for every
 * un-provisioned site). Same zod schema validates entries from either loader (#799 §C.4).
 */
function collectionLoader(name: string) {
  const apiURL = readConfig("CMS_CONTENT_API_URL");
  return apiURL ? createContentAPILoader(name, { apiURL }) : glob({ pattern: "**/*.md", base: `./src/content/${name}` });
}

// Blog posts live as Markdown in src/content/blog/. The glob loader derives each
// entry's `id` from its filename (e.g. welcome-to-your-blog.md -> "welcome-to-your-blog"),
// which becomes the /blog/<id>/ URL.
const blog = defineCollection({
  loader: collectionLoader("blog"),
  schema: z.object({
    ...socialFields,
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }).strict(),
});

const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
  schema: notesSchema,
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: articlesSchema,
});

const photos = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/photos" }),
  schema: z.object({
    ...socialFields,
    image: z.string(),
    caption: z.string().optional(),
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }).strict(),
});

const albums = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/albums" }),
  schema: z.object({
    ...socialFields,
    title: z.string(),
    images: z.array(z.string()),
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }).strict(),
});

const bookmarks = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/bookmarks" }),
  schema: z.object({
    ...socialFields,
    bookmarkOf: z.string().url(),
    title: z.string().optional(),
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }).strict(),
});

const replies = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/replies" }),
  schema: z.object({
    ...socialFields,
    inReplyTo: z.string().url(),
    publishDate: z.coerce.date(),
    draft: z.boolean().default(false),
  }).strict(),
});

const likes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/likes" }),
  schema: z.object({
    ...socialFields,
    likeOf: z.string().url(),
    publishDate: z.coerce.date(),
    draft: z.boolean().default(false),
  }).strict(),
});

const announcements = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/announcements" }),
  schema: z.object({
    ...socialFields,
    title: z.string(),
    publishDate: z.coerce.date(),
  }).strict(),
});

const events = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/events" }),
  schema: z.object({
    ...socialFields,
    name: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    location: z.string().optional(),
  }).strict(),
});

const reviews = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/reviews" }),
  schema: z.object({
    ...socialFields,
    itemReviewed: z.string(),
    rating: z.number(),
    publishDate: z.coerce.date(),
  }).strict(),
});

const members = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/members" }),
  schema: z.object({
    ...socialFields,
    name: z.string(),
    role: z.string().optional(),
    joinedDate: z.coerce.date(),
    photo: z.string().optional(),
    links: z.array(z.string()).optional(),
  }).strict(),
});

export const collections = { blog, notes, articles, photos, albums, bookmarks, replies, likes, announcements, events, reviews, members };
