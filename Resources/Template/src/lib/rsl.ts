/**
 * RSL (Really Simple Licensing) — the fourth projection of the content licensing model (#992,
 * phase 3 of docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md). Pure XML
 * construction only; every consumer (`scripts/edge-artifacts.ts`'s `rsl.xml` and robots.txt
 * `License:` line, `scripts/csp.ts`'s `Link:` header, `BaseLayout.astro`'s `<link>`, and the
 * RSS/Atom feed renderers' `<rsl:content>`) reads the site's already-resolved
 * `LicensingPolicy`/`AIUsage` and calls into this module; nothing here touches the filesystem or
 * `.site-config`.
 *
 * As the spike's §Q1 finding puts it: no AI crawler is confirmed to honor RSL. This module's
 * output is declaratory, not enforcement — `LicensingPolicy.publishRSL` is an opt-in disclosure
 * toggle, and every projection below is gated on `rslActive` (the toggle plus a usable
 * `SITE_URL`) or, for the two projections that point *at* the generated `rsl.xml` rather than
 * just declaring RSL data inline (the `Link:` header and the `<link>` tag), the stronger
 * `rslPublished` — `rslActive` alone doesn't know whether the policy has anything to declare, and
 * `rsl.xml` is only written when it does (PR #1290 review).
 *
 * Design rule, per the spike's §Q3 and the issue's hard exclusions: never emit `<legal
 * type="warranty">`/`<legal type="attestation">`, never emit `<reporting>`, and never emit a
 * `<payment type>` other than `free` or `attribution` — the app has no license server, no key
 * management, and no payment rails, and asserting ownership/authority over content it can't
 * verify (bookmarks, replies, likes, reviews) is exactly what the spike forbids.
 */
import {
  assertsNothingExplicitly,
  LICENSABLE_COLLECTIONS,
  type AIUsage,
  type LicenseRef,
  type LicensableCollection,
  type LicensingPolicy,
} from "./licensing.ts";

export const RSL_NAMESPACE = "https://rslstandard.org/rsl";

/** The two payment types Anglesite ever emits — see the module doc's hard exclusion. */
export type RslPaymentType = "free" | "attribution";

/**
 * Classifies a catalog license's RSL payment type by the license's own terms — CC0 requires
 * nothing, every other Creative Commons 4.0 variant (including the NC/ND restrictions) requires
 * attribution. This is a narrower, more factual claim than `LicenseCatalog.permitsAIUse` in the
 * Swift app (which is about AI-training ambiguity): "does this license require attribution" has
 * one answer per CC deed, not a live legal question. A custom URL isn't in this table and
 * classifies as `null` — Anglesite doesn't know its terms well enough to assert a payment type,
 * so `<payment>` is omitted for it (the license's `<terms>` link still carries the real terms).
 */
const PAYMENT_BY_LICENSE_URL: Readonly<Record<string, RslPaymentType>> = Object.freeze({
  "https://creativecommons.org/publicdomain/zero/1.0/": "free",
  "https://creativecommons.org/licenses/by/4.0/": "attribution",
  "https://creativecommons.org/licenses/by-sa/4.0/": "attribution",
  "https://creativecommons.org/licenses/by-nc/4.0/": "attribution",
  "https://creativecommons.org/licenses/by-nd/4.0/": "attribution",
  "https://creativecommons.org/licenses/by-nc-sa/4.0/": "attribution",
  "https://creativecommons.org/licenses/by-nc-nd/4.0/": "attribution",
});

export function paymentForLicense(license: LicenseRef | null): RslPaymentType | null {
  return license ? (PAYMENT_BY_LICENSE_URL[license.url] ?? null) : null;
}

/** A valid HTTPS absolute URL's origin, or null when `url` is unset, unparseable, or insecure.
 * Deliberately mirrors `edge-artifacts.ts`'s private `httpsOrigin` rather than importing it —
 * this module stays free of any dependency on the `scripts/` generators that consume it (see the
 * module doc), the same tradeoff `LicenseRef.isSafeLicenseURL` already makes against
 * `hasSafeLicenseScheme` in the Swift app. */
export function httpsOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Whether RSL is switched on for this build at all. Requires both the opt-in toggle and a usable
 * HTTPS `SITE_URL` — the `License:` robots.txt directive and the `Link:` header need an absolute
 * URI (RSL's own syntax, and RFC 8288), so a site with no configured origin has nowhere to point
 * either at.
 *
 * This is *not* the same question as "does `rsl.xml` exist" — a site can have `rslActive` true
 * with nothing to declare (no default license, no per-collection override, no stated usage
 * preference), in which case `buildRslDocument` returns null and no file is written. The feeds'
 * `<rsl:content>` and `rsl.xml`'s own generation are fine gating on this alone, since they check
 * per-block/per-item emptiness themselves; the `Link:` header and the `<link>` tag — which point
 * *at* the file rather than declaring anything inline — need the stronger `rslPublished` (PR #1290
 * review).
 */
export function rslActive(policy: LicensingPolicy, siteUrl: string | undefined): boolean {
  return policy.publishRSL && httpsOrigin(siteUrl) !== null;
}

/** The absolute URL of the generated `rsl.xml`, or null when `rslActive` would be false for the
 * same `siteUrl`. Shared by the robots.txt `License:` directive and the CSP `Link:` header so
 * they can never disagree about where the file lives. */
export function rslFileUrl(siteUrl: string | undefined): string | null {
  const origin = httpsOrigin(siteUrl);
  return origin ? `${origin}/rsl.xml` : null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Maps `AIUsage`'s three purposes to the RSL `type="usage"` vocabulary, in the same fixed
 * (search, ai-input, ai-train) order `edge-artifacts.ts`'s `contentSignalDirective` uses, so the
 * two directives read consistently for a human comparing them. */
const USAGE_PURPOSES: readonly { key: "search" | "aiInput" | "aiTrain"; rsl: string }[] = [
  { key: "search", rsl: "search" },
  { key: "aiInput", rsl: "ai-input" },
  { key: "aiTrain", rsl: "ai-train" },
];

function usagePermitsProhibits(usage: AIUsage): { permits: string[]; prohibits: string[] } {
  const permits: string[] = [];
  const prohibits: string[] = [];
  for (const { key, rsl } of USAGE_PURPOSES) {
    if (usage[key] === "yes") permits.push(rsl);
    else if (usage[key] === "no") prohibits.push(rsl);
  }
  return { permits, prohibits };
}

interface LicenseBlockInput {
  usage: AIUsage;
  license: LicenseRef | null;
  /** True for a deliberate non-assertion (see `assertsNothingExplicitly`) — emits a single
   * `<prohibits type="usage">all</prohibits>` and nothing else, regardless of `usage`/`license`,
   * so it can never inherit a permission the site-wide block grants elsewhere. */
  assertsNothing: boolean;
  holder?: string;
}

/** A `<content>`/`<rsl:content>` element's two distinct child groups, per RSL 1.0's schema:
 * `<license>` only ever contains `permits`/`prohibits`/`payment`/`reporting`/`legal` — `terms`
 * and `copyright` are siblings of `<license>`, direct children of `<content>` itself (see the
 * spec's own §3.16/§3.17 examples). Keeping them as two separate arrays here, rather than one
 * flat list `contentBlock`/`feedRslContent` wrap entirely inside `<license>`, is what keeps that
 * structural distinction from collapsing (PR #1290 review). */
interface LicenseBlock {
  /** `<license>`'s own children: permits, prohibits, payment. */
  license: string[];
  /** `<content>`'s other children, siblings of `<license>`: terms, copyright. */
  siblings: string[];
}

/**
 * Builds both of a content block's child groups (see `LicenseBlock`), with tag names prefixed by
 * `prefix` (`""` for the standalone `rsl.xml` document's default namespace, `"rsl:"` for a feed
 * item's namespaced module). `blockIndent` is the indent level of `<license>` itself and its
 * siblings (`terms`/`copyright`) — `<license>`'s own children (`permits`/`prohibits`/`payment`)
 * are one level deeper, `${blockIndent}  `, matching how `contentBlock`/`feedRslContent` nest
 * `<license>` one level inside `<content>`. Both arrays are empty when there is nothing to assert
 * — no stated usage purpose and no license — so the caller can skip the whole
 * `<content>`/`<rsl:content>` element rather than emit an empty one.
 *
 * `holder` never independently makes this non-empty: a bare copyright notice with no permits,
 * prohibits, or license is not something worth publishing a `<content>` block for on its own, and
 * — more importantly — `holder` is resolved differently by different callers (`edge-artifacts.ts`
 * has no `ownerName()` h-card fallback to reach, unlike `BaseLayout.astro`/`feed-data.ts`), so
 * letting it alone decide whether a block exists would let those callers disagree about whether
 * `rsl.xml` has any content at all — exactly the partial-activation bug `rslPublished` exists to
 * prevent (PR #1290 review).
 */
function buildLicenseBlock(input: LicenseBlockInput, prefix: string, blockIndent: string): LicenseBlock {
  const tag = (name: string) => `${prefix}${name}`;
  const childIndent = `${blockIndent}  `;
  if (input.assertsNothing) {
    return {
      license: [`${childIndent}<${tag("prohibits")} type="usage">all</${tag("prohibits")}>`],
      siblings: [],
    };
  }
  const license: string[] = [];
  const siblings: string[] = [];
  const { permits, prohibits } = usagePermitsProhibits(input.usage);
  if (permits.length > 0) {
    license.push(`${childIndent}<${tag("permits")} type="usage">${permits.join(" ")}</${tag("permits")}>`);
  }
  if (prohibits.length > 0) {
    license.push(`${childIndent}<${tag("prohibits")} type="usage">${prohibits.join(" ")}</${tag("prohibits")}>`);
  }
  if (input.license) {
    const payment = paymentForLicense(input.license);
    if (payment === "free") {
      license.push(`${childIndent}<${tag("payment")} type="free"/>`);
    } else if (payment === "attribution") {
      license.push(`${childIndent}<${tag("payment")} type="attribution">`);
      license.push(`${childIndent}  <${tag("standard")}>${escapeXml(input.license.url)}</${tag("standard")}>`);
      license.push(`${childIndent}</${tag("payment")}>`);
    }
    // Unclassified (custom URL): no <payment> — see PAYMENT_BY_LICENSE_URL's doc comment — but
    // <terms> still points at it, since the URL itself was already validated as safe to emit.
    siblings.push(`${blockIndent}<${tag("terms")}>${escapeXml(input.license.url)}</${tag("terms")}>`);
  }
  // Only attached once the block is otherwise non-empty (permits/prohibits/a license) — see this
  // function's own doc comment for why holder must never be the sole reason a block exists.
  if (input.holder && (license.length > 0 || siblings.length > 0)) {
    siblings.push(`${blockIndent}<${tag("copyright")}>${escapeXml(input.holder)}</${tag("copyright")}>`);
  }
  return { license, siblings };
}

/** Whether `buildLicenseBlock` would produce anything at all for `input` — the gate
 * `buildRslDocument`/`feedRslContent` use to decide whether a `<content>` block is worth emitting,
 * computed without `holder` (see `buildLicenseBlock`'s doc comment on why holder can't decide
 * this on its own). */
function hasLicenseContent(input: Omit<LicenseBlockInput, "holder">): boolean {
  const { license, siblings } = buildLicenseBlock({ ...input, holder: undefined }, "", "");
  return license.length > 0 || siblings.length > 0;
}

function contentBlock(url: string, block: LicenseBlock): string {
  const licenseEl =
    block.license.length > 0
      ? `    <license>\n${block.license.join("\n")}\n    </license>`
      : `    <license/>`;
  const siblingsXml = block.siblings.length > 0 ? `\n${block.siblings.join("\n")}` : "";
  return `  <content url="${escapeXml(url)}">\n${licenseEl}${siblingsXml}\n  </content>`;
}

type CollectionDecision =
  | { kind: "inherit" }
  | { kind: "assertNothing" }
  | { kind: "license"; ref: LicenseRef };

/**
 * Whether — and how — `collection` diverges from the site-wide `/` block, so `buildRslDocument`
 * knows whether it needs a block of its own. Deliberately does NOT derive this from
 * `resolveLicense`'s return value: `resolveLicense` returns the *effective* license, which is
 * indistinguishable between "this collection inherited the site default" and "this collection was
 * explicitly overridden to the same license" — exactly the ambiguity that made an earlier version
 * of this function emit a redundant block for every plain-inheriting collection. Checking
 * `policy.collections` directly (via `assertsNothingExplicitly` and `Object.hasOwn`) is what keeps
 * "inherit" and "license" distinct.
 */
function collectionDecision(policy: LicensingPolicy, collection: LicensableCollection): CollectionDecision {
  if (assertsNothingExplicitly(policy, collection)) return { kind: "assertNothing" };
  if (Object.hasOwn(policy.collections, collection)) {
    const ref = policy.collections[collection];
    if (ref) return { kind: "license", ref };
  }
  return { kind: "inherit" };
}

/**
 * The full `rsl.xml` document, or null when there's nothing to publish — `publishRSL` is off, or
 * it's on but the site has no license and no stated usage preference to declare. One `<content
 * url="/">` block projects the site-wide default license plus `usage`; one additional block per
 * collection with its own outcome — either a distinct license override or a deliberate
 * non-assertion (see `assertsNothingExplicitly`) — narrows or withholds that grant for its own
 * `/<collection>/*` path. A collection that merely inherits the site default needs no block of
 * its own: the `/` block already covers it, and RSL's most-restrictive-wins rule means a later,
 * *narrower* prohibition (a non-asserting collection's block) still overrides the broader grant
 * where the two overlap.
 *
 * `holder` is the site's copyright holder (`COPYRIGHT_HOLDER`/h-card fallback, same source as
 * `Rights.astro`'s footer) — optional, since `<copyright>`'s attributes (person/organization,
 * contact) are exactly the sort of unverifiable claim §Q3 says not to assert, so this only ever
 * emits the plain holder name as the element's text content.
 */
export function buildRslDocument(policy: LicensingPolicy, holder?: string): string | null {
  if (!policy.publishRSL) return null;

  const blocks: string[] = [];

  const siteInput = { usage: policy.usage, license: policy.default, assertsNothing: false };
  const siteWideHasAGrant = hasLicenseContent(siteInput);
  if (siteWideHasAGrant) blocks.push(contentBlock("/", buildLicenseBlock({ ...siteInput, holder }, "", "    ")));

  for (const collection of LICENSABLE_COLLECTIONS) {
    const decision = collectionDecision(policy, collection);
    if (decision.kind === "inherit") continue;
    const url = `/${collection}/*`;
    if (decision.kind === "assertNothing") {
      // Only worth a block when the site-wide `/` block actually grants something to withhold
      // from — an entirely empty policy has nothing for a non-asserting collection to override,
      // so `buildRslDocument` stays null rather than publishing four redundant "prohibits all"
      // blocks under a site that isn't declaring anything else either.
      if (!siteWideHasAGrant) continue;
      blocks.push(
        contentBlock(url, buildLicenseBlock({ usage: policy.usage, license: null, assertsNothing: true, holder }, "", "    ")),
      );
    } else {
      const collectionInput = { usage: policy.usage, license: decision.ref, assertsNothing: false };
      if (hasLicenseContent(collectionInput)) {
        blocks.push(contentBlock(url, buildLicenseBlock({ ...collectionInput, holder }, "", "    ")));
      }
    }
  }

  if (blocks.length === 0) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsl xmlns="${RSL_NAMESPACE}">\n${blocks.join("\n")}\n</rsl>\n`;
}

/**
 * Whether `buildRslDocument` would produce a document for `policy` at all — independent of
 * `holder` (see `buildLicenseBlock`'s doc comment). `edge-artifacts.ts`'s `main()` only writes
 * `rsl.xml` when `buildRslDocument` returns non-null; every other projection that points *at*
 * `rsl.xml` — the `Link:` header (`csp.ts`) and the `<link>` tag (`BaseLayout.astro`) — must gate
 * on this stronger check, not `rslActive` alone, or they can advertise a file that was never
 * written (PR #1290 review). The robots.txt `License:` directive already gets this for free: it's
 * driven directly by `edge-artifacts.ts`'s own `rslUrl`, which is only set once the file exists.
 */
export function rslPublished(policy: LicensingPolicy, siteUrl: string | undefined): boolean {
  return rslActive(policy, siteUrl) && buildRslDocument(policy) !== null;
}

/**
 * One feed item's `<rsl:content>` element, or null when there's nothing to declare for it (no
 * stated site-wide usage purpose and no resolved license, and it isn't a deliberate
 * non-assertion). `url` is the item's own path — RSL's `<content url>` follows RFC 9309 path
 * syntax like `robots.txt`, so this uses the item link's pathname rather than its full absolute
 * URL. `assertsNothing` must come from `assertsNothingExplicitly` for the item's collection, not
 * merely from `license === null` — a collection that simply inherits an unset site default is not
 * a deliberate non-assertion, and conflating the two would either wrongly withhold a real grant
 * or (worse) let a bookmarked/liked/replied-to third-party post silently inherit whatever the
 * site's own content grants.
 */
export function feedRslContent(
  itemUrl: string,
  license: LicenseRef | null,
  assertsNothing: boolean,
  usage: AIUsage,
  holder: string | undefined,
  indent = "    ",
): string | null {
  const input = { usage, license, assertsNothing };
  if (!hasLicenseContent(input)) return null;
  const block = buildLicenseBlock({ ...input, holder }, "rsl:", `${indent}  `);
  let pathname: string;
  try {
    pathname = new URL(itemUrl).pathname;
  } catch {
    pathname = itemUrl;
  }
  const licenseEl =
    block.license.length > 0
      ? `${indent}  <rsl:license>\n${block.license.join("\n")}\n${indent}  </rsl:license>`
      : `${indent}  <rsl:license/>`;
  const siblingsXml = block.siblings.length > 0 ? `\n${block.siblings.join("\n")}` : "";
  return (
    `${indent}<rsl:content url="${escapeXml(pathname)}">\n${licenseEl}${siblingsXml}\n` +
    `${indent}</rsl:content>`
  );
}
