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
    /** When true, send this post to newsletter subscribers on deploy. */
    sendNewsletter: z.boolean().default(false),
    /** URLs where this post was cross-posted (rendered as `u-syndication` links). */
    syndication: z.array(z.string().url()).default([]),
  }),
});

/** Services or menu items stored in `src/content/services/`. */
const services = defineCollection({
  type: "content",
  schema: z.object({
    /** Service name (also used as the URL slug source in Keystatic). */
    name: z.string(),
    /** Short description for listings and search engines. */
    description: z.string(),
    /** Price or price range (free-text, e.g. "$50", "$25–$75", "Free"). */
    price: z.string().optional(),
    /** Path relative to `public/` (e.g. `/images/services/photo.webp`). */
    image: z.string().optional(),
    /** Alt text for the service image. */
    imageAlt: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Team or staff members stored in `src/content/team/`. */
const team = defineCollection({
  type: "content",
  schema: z.object({
    /** Person's name. */
    name: z.string(),
    /** Job title or role. */
    role: z.string().optional(),
    /** Short biography for listings. */
    bio: z.string().optional(),
    /** Path relative to `public/` (e.g. `/images/team/photo.webp`). */
    photo: z.string().optional(),
    /** Alt text for the team photo. */
    photoAlt: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Customer testimonials stored in `src/content/testimonials/`. */
const testimonials = defineCollection({
  type: "content",
  schema: z.object({
    /** Name of the person giving the testimonial. */
    author: z.string(),
    /** The testimonial quote (short version for listings). */
    quote: z.string(),
    /** Author's business name or role for attribution. */
    attribution: z.string().optional(),
    /** Date the testimonial was given. */
    date: z.string().transform((str) => new Date(str)).optional(),
    /** Star rating (1–5). */
    rating: z.number().min(1).max(5).optional(),
  }),
});

/** Gallery images stored in `src/content/gallery/`. */
const gallery = defineCollection({
  type: "content",
  schema: z.object({
    /** Path relative to `public/` (e.g. `/images/gallery/photo.webp`). */
    image: z.string(),
    /** Alt text describing the image (required for accessibility). */
    alt: z.string(),
    /** Optional caption shown below the image. */
    caption: z.string().optional(),
    /** Category for filtering (e.g. "Interior", "Food", "Events"). */
    category: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Events stored in `src/content/events/`. */
const events = defineCollection({
  type: "content",
  schema: z.object({
    /** Event title. */
    title: z.string(),
    /** Event date as ISO string. */
    date: z.string().transform((str) => new Date(str)),
    /** Start time (e.g. "7:00 PM"). */
    time: z.string().optional(),
    /** End time (e.g. "9:00 PM"). */
    endTime: z.string().optional(),
    /** Location name or address. */
    location: z.string().optional(),
    /** Short description for listings and search engines. */
    description: z.string(),
    /** Whether the event repeats (e.g. "weekly", "monthly"). */
    recurring: z.string().optional(),
    /** Path relative to `public/` (e.g. `/images/events/photo.webp`). */
    image: z.string().optional(),
    /** Alt text for the event image. */
    imageAlt: z.string().optional(),
  }),
});

/** Menus stored in `src/content/menus/` (e.g. "Lunch", "Dinner", "Drinks"). */
const menus = defineCollection({
  type: "content",
  schema: z.object({
    /** Menu name (e.g. "Lunch", "Dinner", "Drinks"). */
    name: z.string(),
    /** When this menu is available (e.g. "Available weekdays 11am–3pm"). */
    description: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Menu sections stored in `src/content/menuSections/` (e.g. "Appetizers", "Entrees"). */
const menuSections = defineCollection({
  type: "content",
  schema: z.object({
    /** Section name (e.g. "Appetizers", "Entrees", "Desserts"). */
    name: z.string(),
    /** Slug of the parent menu this section belongs to. */
    menu: z.string().optional(),
    /** Optional section description. */
    description: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Menu items stored in `src/content/menuItems/`. */
const menuItems = defineCollection({
  type: "content",
  schema: z.object({
    /** Item name. */
    name: z.string(),
    /** Slug of the parent section this item belongs to. */
    section: z.string().optional(),
    /** Dish description. */
    description: z.string().optional(),
    /** Price or range (free-text, e.g. "$12", "$12–$16", "Market Price"). */
    price: z.string().optional(),
    /** Path relative to `public/` (e.g. `/images/menu/photo.webp`). */
    image: z.string().optional(),
    /** Alt text for the item image — required if `image` is set. */
    imageAlt: z.string().optional(),
    /** Standardized dietary tags. */
    dietary: z.array(z.string()).default([]),
    /** Restaurant-specific tags (spice levels, house specialties, etc.). */
    customTags: z
      .array(
        z.object({
          label: z.string(),
          icon: z.string().optional(),
          color: z.string().optional(),
        }),
      )
      .default([]),
    /** Whether this item is currently available (false hides seasonal/sold-out items). */
    available: z.boolean().default(true),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** FAQ entries stored in `src/content/faq/`. */
const faq = defineCollection({
  type: "content",
  schema: z.object({
    /** The question. */
    question: z.string(),
    /** The answer (short version for listings; full answer in the content body). */
    answer: z.string(),
    /** Category for grouping related questions. */
    category: z.string().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** Products for Snipcart ecommerce stored in `src/content/products/`. */
const products = defineCollection({
  type: "content",
  schema: z.object({
    /** Product name (also used as the URL slug source in Keystatic). */
    name: z.string(),
    /** Short description for listings and search engines. */
    description: z.string(),
    /** Price in cents (e.g., 4500 = $45.00). */
    price: z.number(),
    /** Path relative to `public/` (e.g. `/images/products/photo.webp`). */
    image: z.string().optional(),
    /** Alt text for the product image. */
    imageAlt: z.string().optional(),
    /** Weight in grams (for shipping calculation). */
    weight: z.number().optional(),
    /** Display order (lower numbers appear first). */
    order: z.number().default(0),
  }),
});

/** All content collections exported for Astro's build pipeline. */
export const collections = { posts, services, team, testimonials, gallery, events, menus, menuSections, menuItems, faq, products };
