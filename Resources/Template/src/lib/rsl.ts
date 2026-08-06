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
 * toggle, and every projection below is gated on it (`rslActive`).
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
 * Whether RSL should be emitted at all this build. Requires both the opt-in toggle and a usable
 * HTTPS `SITE_URL` — the `License:` robots.txt directive and the `Link:` header need an absolute
 * URI (RSL's own syntax, and RFC 8288), so a site with no configured origin has nowhere to point
 * either at. Every RSL projection (`rsl.xml`, the robots directive, the header, the `<link>`, and
 * the feeds' `<rsl:content>`) gates on this one function, so they can never partially activate.
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

/**
 * The `<license>`/`<rsl:license>` element's children, one line per element, indented by `indent`
 * and with tag names prefixed by `prefix` (`""` for the standalone `rsl.xml` document's default
 * namespace, `"rsl:"` for a feed item's namespaced module). Returns `[]` when there is nothing to
 * assert — no stated usage purpose, no license, no holder — so the caller can skip the wrapping
 * `<content>`/`<rsl:content>` element entirely rather than emit an empty license.
 */
function licenseChildren(input: LicenseBlockInput, prefix: string, indent: string): string[] {
  const tag = (name: string) => `${prefix}${name}`;
  if (input.assertsNothing) {
    return [`${indent}<${tag("prohibits")} type="usage">all</${tag("prohibits")}>`];
  }
  const lines: string[] = [];
  const { permits, prohibits } = usagePermitsProhibits(input.usage);
  if (permits.length > 0) {
    lines.push(`${indent}<${tag("permits")} type="usage">${permits.join(" ")}</${tag("permits")}>`);
  }
  if (prohibits.length > 0) {
    lines.push(`${indent}<${tag("prohibits")} type="usage">${prohibits.join(" ")}</${tag("prohibits")}>`);
  }
  if (input.license) {
    const payment = paymentForLicense(input.license);
    if (payment === "free") {
      lines.push(`${indent}<${tag("payment")} type="free"/>`);
    } else if (payment === "attribution") {
      lines.push(`${indent}<${tag("payment")} type="attribution">`);
      lines.push(`${indent}  <${tag("standard")}>${escapeXml(input.license.url)}</${tag("standard")}>`);
      lines.push(`${indent}</${tag("payment")}>`);
    }
    // Unclassified (custom URL): no <payment> — see PAYMENT_BY_LICENSE_URL's doc comment — but
    // <terms> still points at it, since the URL itself was already validated as safe to emit.
    lines.push(`${indent}<${tag("terms")}>${escapeXml(input.license.url)}</${tag("terms")}>`);
  }
  if (input.holder) {
    lines.push(`${indent}<${tag("copyright")}>${escapeXml(input.holder)}</${tag("copyright")}>`);
  }
  return lines;
}

function contentBlock(url: string, children: string[]): string {
  return `  <content url="${escapeXml(url)}">\n    <license>\n${children.join("\n")}\n    </license>\n  </content>`;
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

  const siteChildren = licenseChildren(
    { usage: policy.usage, license: policy.default, assertsNothing: false, holder },
    "",
    "      ",
  );
  const siteWideHasAGrant = siteChildren.length > 0;
  if (siteWideHasAGrant) blocks.push(contentBlock("/", siteChildren));

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
        contentBlock(url, licenseChildren({ usage: policy.usage, license: null, assertsNothing: true, holder }, "", "      ")),
      );
    } else {
      const children = licenseChildren(
        { usage: policy.usage, license: decision.ref, assertsNothing: false, holder },
        "",
        "      ",
      );
      if (children.length > 0) blocks.push(contentBlock(url, children));
    }
  }

  if (blocks.length === 0) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsl xmlns="${RSL_NAMESPACE}">\n${blocks.join("\n")}\n</rsl>\n`;
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
  const children = licenseChildren({ usage, license, assertsNothing, holder }, "rsl:", `${indent}  `);
  if (children.length === 0) return null;
  let pathname: string;
  try {
    pathname = new URL(itemUrl).pathname;
  } catch {
    pathname = itemUrl;
  }
  return (
    `${indent}<rsl:content url="${escapeXml(pathname)}">\n` +
    `${indent}  <rsl:license>\n${children.join("\n")}\n${indent}  </rsl:license>\n` +
    `${indent}</rsl:content>`
  );
}
