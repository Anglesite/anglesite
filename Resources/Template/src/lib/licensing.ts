/**
 * Per-content-type content licensing (#689 phase 1).
 *
 * A site declares one default license plus per-collection overrides in
 * `src/data/licensing.json`. This module is the pure resolver; `licensing-data.ts`
 * loads the document. Three projections consume the result — schema.org `license`
 * (schema.ts), Microformats2 `u-license` (the entry layouts), and `<link rel="license">`
 * (BaseLayout.astro).
 *
 * Design rule, per docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md §Q3:
 * never assert a license on the user's behalf. Collections that are by construction
 * *about someone else's work* assert nothing unless the user explicitly overrides them,
 * and the absence of any policy resolves to null (all rights reserved — the legal default),
 * never to a permissive license.
 */
import { ENTRY_COLLECTIONS, type EntryCollection } from "./collections.ts";

/** A license the site can point at: a canonical URL plus a human-readable label. */
export interface LicenseRef {
  url: string;
  name: string;
}

/** Every collection that can carry a license — the routed collections plus `blog`. */
export type LicensableCollection = EntryCollection | "blog";

export interface LicensingPolicy {
  /** Site-wide default, or null for "assert nothing". */
  default: LicenseRef | null;
  /**
   * Per-collection overrides. A key present with a null value means "assert nothing here"
   * and beats the site default; a key that is absent falls through to the default rules.
   */
  collections: Partial<Record<LicensableCollection, LicenseRef | null>>;
}

/**
 * Collections whose entries are responses to, or quotations of, third-party work. A site
 * owner cannot license someone else's article by bookmarking it, so these assert nothing
 * unless explicitly overridden.
 */
export const NON_ASSERTING_COLLECTIONS: readonly LicensableCollection[] = [
  "bookmarks",
  "replies",
  "likes",
  "reviews",
];

const LICENSABLE_COLLECTIONS: readonly LicensableCollection[] = [...ENTRY_COLLECTIONS, "blog"];

function isLicensable(key: string): key is LicensableCollection {
  return (LICENSABLE_COLLECTIONS as readonly string[]).includes(key);
}

/**
 * Coerce one raw JSON value into a LicenseRef, or null when it can't be trusted.
 * `url` is mandatory — a license reference with no URL points nowhere and would emit an
 * empty href. `name` falls back to the URL so there is always something to render.
 */
function toLicenseRef(raw: unknown): LicenseRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { url, name } = raw as { url?: unknown; name?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;
  return { url, name: typeof name === "string" && name.length > 0 ? name : url };
}

/**
 * Parse a hand-edited `licensing.json` defensively. Unrecognized collection keys and
 * malformed license refs are dropped rather than passed through, matching how
 * `edge-artifacts.ts`'s `normalizeContentSignal` treats a typo'd config value.
 */
export function normalizePolicy(raw: unknown): LicensingPolicy {
  const policy: LicensingPolicy = { default: null, collections: {} };
  if (!raw || typeof raw !== "object") return policy;

  const { default: rawDefault, collections: rawCollections } = raw as {
    default?: unknown;
    collections?: unknown;
  };

  policy.default = toLicenseRef(rawDefault);

  if (rawCollections && typeof rawCollections === "object") {
    for (const [key, value] of Object.entries(rawCollections as Record<string, unknown>)) {
      if (!isLicensable(key)) continue;
      // An explicit null is meaningful ("assert nothing here"), so it is recorded as a
      // present key rather than dropped — that is what distinguishes it from an absent key.
      policy.collections[key] = value === null ? null : toLicenseRef(value);
    }
  }

  return policy;
}

/**
 * The license that applies to `collection`, or null when nothing should be asserted.
 *
 * Precedence: an explicit per-collection entry (including null) wins; then the
 * non-asserting rule; then the site default.
 */
export function resolveLicense(
  policy: LicensingPolicy,
  collection: LicensableCollection,
): LicenseRef | null {
  if (Object.hasOwn(policy.collections, collection)) {
    return policy.collections[collection] ?? null;
  }
  if (NON_ASSERTING_COLLECTIONS.includes(collection)) return null;
  return policy.default;
}
