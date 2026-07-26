import { z } from "astro/zod";

/**
 * Schemas that need to be unit-testable with plain `npx tsx --test`, which can't resolve the
 * `astro:content` virtual module `content.config.ts` otherwise depends on (confirmed: importing
 * `astro:content` outside Astro's Vite pipeline throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`). Kept
 * deliberately narrow to `notes`/`articles` — the two collections V-5.2a (#369) touches — rather
 * than relocating every collection schema.
 */

// Shared outbound-social metadata. POSSE is explicit per entry; `syndication` is written back by
// Anglesite after the remote APIs return and is projected as u-syndication by the layouts.
export const socialFields = {
  posse: z.array(z.string()).optional(),
  syndicateTo: z.array(z.string()).optional(),
  "syndicate-to": z.array(z.string()).optional(),
  posseText: z.string().optional(),
  socialText: z.string().optional(),
  syndication: z.array(z.string().url()).optional(),
};

/**
 * `audience` (a Group actor IRI) is optional and carries no mf2/schema.org projection — it only
 * affects federation once the V-4 outbox (#363) exists (V-5, #339, Stage 1: #369). A site built
 * outside Anglesite renders identically with or without it.
 */
export const notesSchema = z.object({
  ...socialFields,
  publishDate: z.coerce.date(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();

export const articlesSchema = z.object({
  ...socialFields,
  title: z.string(),
  summary: z.string().optional(),
  publishDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).optional(),
  audience: z.string().url().optional(),
  draft: z.boolean().default(false),
}).strict();
