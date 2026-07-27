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

/**
 * A per-purpose AI usage permission. `"unset"` means the site states no preference — it is the
 * absence of a key in `licensing.json`, never a value written into it, matching how
 * `edge-artifacts.ts` omits an unstated `Content-Signal` sub-directive rather than emitting
 * `key=unset`.
 */
export type UsagePermission = "yes" | "no" | "unset";

/**
 * Site-wide AI usage permissions (#991). Two `robots.txt` projections derive from this and only
 * this: the `Content-Signal` directive and the named-agent blocklist. Keeping them derived is what
 * makes "permits AI training but Disallows GPTBot" unrepresentable rather than merely discouraged.
 *
 * Usage is deliberately site-wide, not per-collection: `robots.txt` addresses the whole origin, so
 * a per-collection permission would have nothing to project onto until RSL's `<content url>`
 * patterns land in phase 3.
 */
export interface AIUsage {
  search: UsagePermission;
  aiInput: UsagePermission;
  aiTrain: UsagePermission;
  /** Refuse the named AI agents outright in `robots.txt`. See `mayBlockAICrawlers`. */
  blockAICrawlers: boolean;
}

export const NO_USAGE: AIUsage = {
  search: "unset",
  aiInput: "unset",
  aiTrain: "unset",
  blockAICrawlers: false,
};

/**
 * Whether the blocklist is allowed to fire. Blocking is *stronger* than signalling, not
 * contradictory — a site may coherently ask crawlers not to train without also refusing them at
 * `robots.txt`. The one rule that must hold is that the blocklist never exceeds what the
 * permissions deny, and the 17-agent list covers both AI answers and AI training, so both must be
 * denied before it can be emitted.
 */
export function mayBlockAICrawlers(usage: Pick<AIUsage, "aiInput" | "aiTrain">): boolean {
  return usage.aiInput === "no" && usage.aiTrain === "no";
}

function toPermission(raw: unknown): UsagePermission {
  return raw === "yes" || raw === "no" ? raw : "unset";
}

/**
 * Parse a hand-edited `usage` block defensively, on the same terms as `normalizePolicy`:
 * unrecognized keys and values become "unset" rather than passing through. The cross-field clamp
 * is applied here so both writers — this module and the app's `LicensingStore` — reject the same
 * documents, and a hand-editor cannot produce a policy the UI could not have produced.
 */
export function normalizeUsage(raw: unknown): AIUsage {
  if (!raw || typeof raw !== "object") return { ...NO_USAGE };
  const { search, aiInput, aiTrain, blockAICrawlers } = raw as Record<string, unknown>;
  const usage: AIUsage = {
    search: toPermission(search),
    aiInput: toPermission(aiInput),
    aiTrain: toPermission(aiTrain),
    blockAICrawlers: false,
  };
  usage.blockAICrawlers = blockAICrawlers === true && mayBlockAICrawlers(usage);
  return usage;
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
  /** Site-wide AI usage permissions. See `AIUsage`. */
  usage: AIUsage;
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
 * Mirrors the input-sanitization step the WHATWG URL parser runs before parsing: strip every
 * ASCII tab/CR/LF wherever it occurs, then trim leading/trailing C0 control characters or space.
 * `new URL()` performs this internally, so a manual string check run *before* handing the value
 * to `new URL()` — like the leading-slash fast path below — has to replicate it, or it can
 * disagree with what the browser actually resolves the URL to.
 */
function whatwgTrim(url: string): string {
  const withoutTabsOrNewlines = url.replace(/[\t\r\n]/g, "");
  const isC0OrSpace = (ch: string): boolean => ch.charCodeAt(0) <= 0x20;
  let start = 0;
  let end = withoutTabsOrNewlines.length;
  while (start < end && isC0OrSpace(withoutTabsOrNewlines[start])) start++;
  while (end > start && isC0OrSpace(withoutTabsOrNewlines[end - 1])) end--;
  return withoutTabsOrNewlines.slice(start, end);
}

/**
 * Whether `url` is safe to emit unguarded into `href`/`rel="license"` (LicenseLink.astro,
 * BaseLayout.astro, Rights.astro). Matches the scheme-guard convention already used for
 * user-supplied URLs elsewhere in the template (`src/lib/interactions.ts`'s `httpUrl`,
 * `scripts/edge-artifacts.ts`'s `httpsOrigin`): parse with `new URL()` and allow-list the
 * scheme rather than deny-list dangerous ones, so an unanticipated scheme (`vbscript:`, a
 * future browser quirk) is rejected by default instead of needing its own denial rule.
 *
 * A root-relative URL (`/license/`) is also accepted — a site-local license page is a
 * legitimate thing to point at, and `licensing.json` is intended to support that, not just
 * external license URLs. `new URL()` can't parse a bare path without a base, so that case is
 * checked separately and deliberately narrowed to a *leading single slash*: a protocol-relative
 * URL (`//host/x`) is rejected because it hands an attacker-chosen host to href, and a bare
 * relative path (`license.html`) is rejected because its resolution depends on which page
 * renders it, which isn't the "site-local page" case this exists for.
 *
 * The leading-slash check runs against the *sanitized* string (`whatwgTrim`), not the raw one:
 * a browser strips ASCII tab/CR/LF before parsing, so `"/\t/evil.com"` has only one leading
 * slash to an unsanitized check (passing as root-relative) but resolves as `//evil.com` — a
 * protocol-relative URL — once the browser's own parser strips the tab. Checking the sanitized
 * string is what keeps this guard's protocol-relative rejection real (#991 review finding 2).
 */
function hasSafeLicenseScheme(url: string): boolean {
  const sanitized = whatwgTrim(url);
  if (sanitized.startsWith("/") && !sanitized.startsWith("//")) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Coerce one raw JSON value into a LicenseRef, or null when it can't be trusted.
 * `url` is mandatory — a license reference with no URL points nowhere and would emit an
 * empty href. `name` falls back to the URL so there is always something to render.
 *
 * `url`'s scheme is checked here (not left to the caller) so every consumer — the site
 * default, every per-collection override — gets the guard for free. `licensing.json` is
 * hand-authored today, but a planned Settings UI will write it, so a `javascript:`/`data:`
 * value must degrade to "assert nothing" (null), never reach `href`/`rel="license"` unguarded.
 */
function toLicenseRef(raw: unknown): LicenseRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { url, name } = raw as { url?: unknown; name?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;
  if (!hasSafeLicenseScheme(url)) return null;
  return { url, name: typeof name === "string" && name.length > 0 ? name : url };
}

/**
 * Parse a hand-edited `licensing.json` defensively. Unrecognized collection keys and
 * malformed license refs are dropped rather than passed through, matching how
 * `normalizeUsage` and `edge-artifacts.ts`'s `readLicensingUsage` treat typo'd config values.
 */
export function normalizePolicy(raw: unknown): LicensingPolicy {
  const policy: LicensingPolicy = { default: null, collections: {}, usage: { ...NO_USAGE } };
  if (!raw || typeof raw !== "object") return policy;

  const { default: rawDefault, collections: rawCollections, usage: rawUsage } = raw as {
    default?: unknown;
    collections?: unknown;
    usage?: unknown;
  };

  policy.default = toLicenseRef(rawDefault);
  policy.usage = normalizeUsage(rawUsage);

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

/**
 * Resolve the `license` prop `BaseLayout.astro` receives against the site default, for the
 * `<link rel="license">` head tag (and, via the shared `license` local, the footer rights
 * statement too — that sharing is what keeps head and footer from disagreeing).
 *
 * `undefined` and `null` must stay distinct here: `undefined` means the caller didn't pass a
 * `license` prop at all (an ordinary page, which should inherit the site default), while an
 * explicit `null` means the caller — an entry in a non-asserting collection — deliberately
 * suppressed the license. Collapsing that distinction with `prop ?? siteDefault` is WRONG: `??`
 * treats `null` the same as `undefined` and would silently re-assert the site default on a page
 * that explicitly opted out, reintroducing the two-different-licenses contradiction this function
 * exists to prevent. Use `===` against `undefined`, not `??`, and do not "simplify" this later.
 */
export function headLicense(
  prop: LicenseRef | null | undefined,
  siteDefault: LicenseRef | null,
): LicenseRef | null {
  return prop === undefined ? siteDefault : prop;
}
