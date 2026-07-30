/**
 * schema.org JSON-LD projection for the routed content collections (V-1.8, #350).
 *
 * Each typed object already carries microformats2 classes in its layout (V-1.7); this is the
 * machine-readable twin emitted as `<script type="application/ld+json">` for search engines.
 * Keeping the mapping here — rather than inline in each layout — means the route, the layouts,
 * and this projection can't drift from `content.config.ts`.
 *
 * Coverage mirrors the collections that exist today. `LocalBusiness` (the `businessProfile`
 * singleton, #388) and `Recipe` (no V-1 content type) are intentionally absent — wire them in
 * when those types land. `likes` emit no JSON-LD: a like is an interaction, not a CreativeWork
 * with a meaningful schema.org rich-result type.
 */
import type {
  WithContext,
  Thing,
  Article,
  BlogPosting,
  SocialMediaPosting,
  ImageObject,
  ImageGallery,
  Event,
  Review,
  WebPage,
  Comment,
  Person,
  Role,
  Occupation,
} from "schema-dts";
import type { EntryCollection } from "./collections.ts";

/** Page-level context the projection needs that isn't in the entry's frontmatter. */
export interface SchemaContext {
  /** Canonical absolute URL of the page being rendered (`Astro.url`). */
  url: string;
  /** Site origin (`Astro.site`), used to resolve root-relative asset paths to absolute URLs. */
  site?: URL;
  /** Site owner's name (from `src/data/profile.json`), used as the `author` of Article/BlogPosting. */
  authorName?: string;
  /**
   * Canonical URL of the license applying to this entry (#689), from `licenseFor()`.
   * Undefined means assert nothing — `clean()` drops the property entirely.
   * Only set on CreativeWork types; `Event` has no `license` property in schema.org.
   */
  license?: string;
}

/** Flattened union of the h-entry collections' frontmatter — every field optional. */
export interface HentryData {
  title?: string;
  summary?: string;
  caption?: string;
  publishDate?: Date;
  updated?: Date;
  image?: string;
  images?: string[];
  tags?: string[];
  bookmarkOf?: string;
  inReplyTo?: string;
  likeOf?: string;
}

export interface EventData {
  name?: string;
  start?: Date;
  end?: Date;
  location?: string;
}

export interface ReviewData {
  itemReviewed?: string;
  rating?: number;
  publishDate?: Date;
}

export interface BlogData {
  title?: string;
  description?: string;
  pubDate?: Date;
}

export interface ResumeExperienceData {
  title?: string;
  organization?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ResumeEducationData {
  degree?: string;
  institution?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ResumeData {
  name?: string;
  summary?: string;
  experience?: ResumeExperienceData[];
  education?: ResumeEducationData[];
  skills?: string[];
}

function iso(d: Date | undefined): string | undefined {
  return d ? new Date(d).toISOString() : undefined;
}

/**
 * Author for Article/BlogPosting. Google treats `author` as required for the rich result, so we
 * prefer the site owner's name (from the h-card profile) and fall back to a bare site-origin
 * Person when no name is configured. Returns undefined only when there's nothing to point at.
 */
function authorOf(ctx: SchemaContext): Person | undefined {
  if (ctx.authorName) {
    return { "@type": "Person", name: ctx.authorName, url: ctx.site?.href };
  }
  return ctx.site ? { "@type": "Person", url: ctx.site.href } : undefined;
}

/** Resolve a possibly root-relative path against the site origin; pass full URLs through. */
function abs(pathOrUrl: string | undefined, site: URL | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  try {
    return new URL(pathOrUrl, site).href;
  } catch {
    return pathOrUrl;
  }
}

/** Recursively drop `undefined` values and empty arrays so the JSON-LD stays tidy. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clean).filter((v) => v !== undefined) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = clean(v);
      // Skip undefined and empty arrays (e.g. an album with no images would emit `"image":[]`).
      if (c === undefined || (Array.isArray(c) && c.length === 0)) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

const CONTEXT = "https://schema.org" as const;

function keywordsOf(tags: string[] | undefined): string | undefined {
  return tags && tags.length > 0 ? tags.join(", ") : undefined;
}

/** Map an h-entry collection's frontmatter to its schema.org type, or `null` when none applies. */
function hentrySchema(
  collection: EntryCollection,
  d: HentryData,
  ctx: SchemaContext,
): WithContext<Thing> | null {
  const datePublished = iso(d.publishDate);
  const keywords = keywordsOf(d.tags);

  switch (collection) {
    case "articles":
      return clean<WithContext<Article>>({
        "@context": CONTEXT,
        "@type": "Article",
        headline: d.title,
        description: d.summary,
        author: authorOf(ctx),
        datePublished,
        dateModified: iso(d.updated),
        keywords,
        license: ctx.license,
        url: ctx.url,
      });
    case "announcements":
      return clean<WithContext<Article>>({
        "@context": CONTEXT,
        "@type": "Article",
        headline: d.title,
        author: authorOf(ctx),
        datePublished,
        license: ctx.license,
        url: ctx.url,
      });
    case "notes":
      return clean<WithContext<SocialMediaPosting>>({
        "@context": CONTEXT,
        "@type": "SocialMediaPosting",
        datePublished,
        keywords,
        license: ctx.license,
        url: ctx.url,
      });
    case "photos":
      return clean<WithContext<ImageObject>>({
        "@context": CONTEXT,
        "@type": "ImageObject",
        contentUrl: abs(d.image, ctx.site),
        caption: d.caption,
        datePublished,
        keywords,
        license: ctx.license,
        url: ctx.url,
      });
    case "albums":
      return clean<WithContext<ImageGallery>>({
        "@context": CONTEXT,
        "@type": "ImageGallery",
        name: d.title,
        datePublished,
        keywords,
        license: ctx.license,
        url: ctx.url,
        image: (d.images ?? []).map((src) => abs(src, ctx.site)).filter((s): s is string => !!s),
      });
    case "bookmarks":
      return clean<WithContext<WebPage>>({
        "@context": CONTEXT,
        "@type": "WebPage",
        name: d.title,
        datePublished,
        keywords,
        license: ctx.license,
        url: ctx.url,
        relatedLink: d.bookmarkOf,
      });
    case "replies":
      return clean<WithContext<Comment>>({
        "@context": CONTEXT,
        "@type": "Comment",
        datePublished,
        license: ctx.license,
        url: ctx.url,
        about: d.inReplyTo ? { "@type": "WebPage", url: d.inReplyTo } : undefined,
      });
    case "likes":
      return null;
    default:
      return null;
  }
}

function eventSchema(d: EventData, ctx: SchemaContext): WithContext<Event> {
  return clean<WithContext<Event>>({
    "@context": CONTEXT,
    "@type": "Event",
    name: d.name,
    startDate: iso(d.start),
    endDate: iso(d.end),
    location: d.location ? { "@type": "Place", name: d.location } : undefined,
    url: ctx.url,
  });
}

function reviewSchema(d: ReviewData, ctx: SchemaContext): WithContext<Review> {
  return clean<WithContext<Review>>({
    "@context": CONTEXT,
    "@type": "Review",
    name: d.itemReviewed ? `Review of ${d.itemReviewed}` : undefined,
    itemReviewed: d.itemReviewed ? { "@type": "Thing", name: d.itemReviewed } : undefined,
    reviewRating:
      d.rating !== undefined ? { "@type": "Rating", ratingValue: d.rating } : undefined,
    datePublished: iso(d.publishDate),
    license: ctx.license,
    url: ctx.url,
  });
}

/**
 * Single entry point for the routed `[collection]/[...slug]` page. `events` and `reviews` have
 * their own frontmatter shapes; everything else is an h-entry. Returns `null` when a type has no
 * meaningful schema.org projection (e.g. likes), so the layout can skip emitting a script.
 */
export function entrySchema(
  collection: EntryCollection,
  data: HentryData & EventData & ReviewData,
  ctx: SchemaContext,
): WithContext<Thing> | null {
  if (collection === "events") return eventSchema(data, ctx);
  if (collection === "reviews") return reviewSchema(data, ctx);
  return hentrySchema(collection, data, ctx);
}

/** Blog posts route through their own layout with bespoke props rather than a CollectionEntry. */
export function blogPostingSchema(d: BlogData, ctx: SchemaContext): WithContext<BlogPosting> {
  return clean<WithContext<BlogPosting>>({
    "@context": CONTEXT,
    "@type": "BlogPosting",
    headline: d.title,
    description: d.description,
    author: authorOf(ctx),
    datePublished: iso(d.pubDate),
    license: ctx.license,
    url: ctx.url,
  });
}

/**
 * schema.org JSON-LD for the `resume` singleton (#964). schema.org has no dedicated "work
 * history" vocabulary, so each `experience` entry uses schema.org's own documented `Role`-
 * wrapping pattern (https://schema.org/Person, `hasOccupation` worked example): the property
 * points at a `Role` node carrying `startDate`/`endDate`/`roleName` rather than a bare
 * `Occupation` node, which has no properties for dates or the employing organization. Education
 * uses the simpler, directly-documented `alumniOf` -> `EducationalOrganization` mapping; degree
 * and dates have no clean schema.org home on that relationship and are left to the mf2
 * projection (`Hresume.astro`), which carries the full shape.
 */
export function resumeSchema(d: ResumeData, ctx: SchemaContext): WithContext<Person> {
  const experience = d.experience ?? [];
  const education = d.education ?? [];
  const skills = d.skills ?? [];
  return clean<WithContext<Person>>({
    "@context": CONTEXT,
    "@type": "Person",
    name: d.name,
    description: d.summary,
    url: ctx.url,
    knowsAbout: skills,
    // schema-dts's `Role<TContent, TProperty>` generic requires the role node to *also* nest a
    // property literally named `TProperty` pointing back at an actual `Occupation` — the
    // self-referential shape from schema-dts's own `Role` worked example, not the flatter
    // roleName/dates/worksFor node schema.org's own docs recommend for `hasOccupation` (see the
    // doc comment above). Cast at this property boundary rather than contorting the emitted
    // JSON-LD to satisfy a generic that models a different (also-valid) pattern.
    hasOccupation: experience.map((e) => ({
      "@type": "Role",
      roleName: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      description: e.description,
      worksFor: e.organization ? { "@type": "Organization", name: e.organization } : undefined,
    })) as unknown as Role<Occupation, "hasOccupation">[],
    alumniOf: education.map((e) => ({
      "@type": "EducationalOrganization",
      name: e.institution,
    })),
  });
}
