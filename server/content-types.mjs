/**
 * Built-in typed content objects (V-1 / epic #334), mirrored from the app's
 * `AnglesiteCore/ContentTypeRegistry.swift` built-in catalog.
 *
 * **Source of truth is Swift.** This is the scaffolding-relevant projection only — each
 * descriptor's `id`, `displayName`, `storage`, and ordered `fields` (name + kind). The
 * microformats2 / schema.org projections that the Swift descriptors also carry are NOT
 * mirrored here: scaffolding (`renderEntry`) never reads them, and the template/JSON-LD
 * layers that do live app-side. Keep this list byte-faithful to the Swift catalog so the
 * native and MCP create paths produce identical files (no git churn when the backend swaps).
 *
 * Field `kind` values match `ContentTypeField.Kind`: string, text, markdown, bool, date,
 * datetime, url, image, number, stringArray, imageArray.
 *
 * @module
 */

/**
 * @typedef {{ name: string, kind: string }} ContentTypeField
 * @typedef {{ id: string, displayName: string, collection: string | null, fields: ContentTypeField[] }} ContentTypeDescriptor
 */

/** @type {ContentTypeDescriptor[]} */
const PERSONAL_TYPES = [
  {
    id: "note",
    displayName: "Note",
    collection: "notes",
    fields: [
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
      { name: "tags", kind: "stringArray" },
    ],
  },
  {
    id: "article",
    displayName: "Article",
    collection: "articles",
    fields: [
      { name: "title", kind: "string" },
      { name: "summary", kind: "text" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
      { name: "updated", kind: "datetime" },
      { name: "tags", kind: "stringArray" },
    ],
  },
  {
    id: "photo",
    displayName: "Photo",
    collection: "photos",
    fields: [
      { name: "image", kind: "image" },
      { name: "caption", kind: "text" },
      { name: "publishDate", kind: "datetime" },
      { name: "tags", kind: "stringArray" },
    ],
  },
  {
    id: "album",
    displayName: "Album",
    collection: "albums",
    fields: [
      { name: "title", kind: "string" },
      { name: "images", kind: "imageArray" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
      { name: "tags", kind: "stringArray" },
    ],
  },
  {
    id: "bookmark",
    displayName: "Bookmark",
    collection: "bookmarks",
    fields: [
      { name: "bookmarkOf", kind: "url" },
      { name: "title", kind: "string" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
      { name: "tags", kind: "stringArray" },
    ],
  },
  {
    id: "reply",
    displayName: "Reply",
    collection: "replies",
    fields: [
      { name: "inReplyTo", kind: "url" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
    ],
  },
  {
    id: "like",
    displayName: "Like",
    collection: "likes",
    fields: [
      { name: "likeOf", kind: "url" },
      { name: "publishDate", kind: "datetime" },
    ],
  },
];

/** @type {ContentTypeDescriptor[]} */
const BUSINESS_TYPES = [
  {
    id: "businessProfile",
    displayName: "Business Profile",
    collection: null, // page-stored (#345); not scaffoldable via createTyped yet
    fields: [
      { name: "name", kind: "string" },
      { name: "description", kind: "text" },
      { name: "telephone", kind: "string" },
      { name: "email", kind: "string" },
      { name: "streetAddress", kind: "string" },
      { name: "locality", kind: "string" },
      { name: "region", kind: "string" },
      { name: "postalCode", kind: "string" },
      { name: "hours", kind: "stringArray" },
      { name: "url", kind: "url" },
    ],
  },
  {
    id: "announcement",
    displayName: "Announcement",
    collection: "announcements",
    fields: [
      { name: "title", kind: "string" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
    ],
  },
  {
    id: "event",
    displayName: "Event",
    collection: "events",
    fields: [
      { name: "name", kind: "string" },
      { name: "body", kind: "markdown" },
      { name: "start", kind: "datetime" },
      { name: "end", kind: "datetime" },
      { name: "location", kind: "string" },
    ],
  },
  {
    id: "review",
    displayName: "Review",
    collection: "reviews",
    fields: [
      { name: "itemReviewed", kind: "string" },
      { name: "rating", kind: "number" },
      { name: "body", kind: "markdown" },
      { name: "publishDate", kind: "datetime" },
    ],
  },
];

/**
 * All built-in content types in registration order (personal h-entry family, then business),
 * mirroring `ContentTypeRegistry.builtIns`.
 * @type {ContentTypeDescriptor[]}
 */
export const contentTypes = [...PERSONAL_TYPES, ...BUSINESS_TYPES];

/** All built-in content-type ids, in order. */
export const contentTypeIds = contentTypes.map((t) => t.id);

const byID = new Map(contentTypes.map((t) => [t.id, t]));

/**
 * Look up a content-type descriptor by its stable `id` (e.g. `note`, `businessProfile`).
 * @param {string} id
 * @returns {ContentTypeDescriptor | undefined}
 */
export function descriptorById(id) {
  return byID.get(id);
}
