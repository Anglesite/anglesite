/**
 * Standard.site (Atmosphere) at-URI derivation — template side of increment 2
 * (docs/superpowers/specs/2026-08-04-atproto-standard-site-design.md §§2, 4). Increment 1's
 * `StandardSitePublishCommand` (`Sources/AnglesiteCore/StandardSitePublishCommand.swift`)
 * publishes `site.standard.publication`/`site.standard.document` records to the owner's PDS under
 * deterministic `POSSEStableKey`-derived rkeys, then persists the session DID and site UUID into
 * `.site-config` (`ATPROTO_DID`/`ATPROTO_SITE_ID`). Because the rkeys are deterministic, this
 * module reconstructs the same at-URIs at build time with no network call and no
 * publish-before-build ordering problem — the well-known generator (`edge-artifacts.ts`) and the
 * base layout's `<link>` tags both import it.
 */

const FNV_OFFSET_BASIS = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Portable FNV-1a hash, ported byte-for-byte from `POSSEStableKey.make` in
 * `Sources/AnglesiteCore/POSSEClients.swift` (64-bit offset basis/prime, `&*=` wraps to 64 bits —
 * mirrored here with a `BigInt` mask) so both sides derive the identical rkey from the identical
 * input. Cross-checked by fixture values shared between `standard-site.test.ts` and
 * `StandardSitePublishTests.swift` — a discovered fixture mismatch means this port has drifted
 * from the Swift original. Not a security hash, only used for deterministic idempotency
 * identifiers.
 */
export function fnv1a(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16);
}

/** Mirrors `StandardSitePublishCommand`'s `"anglesite-\(POSSEStableKey.make(siteID))"`. */
export function standardSitePublicationRkey(siteID: string): string {
  return `anglesite-${fnv1a(siteID)}`;
}

/** Mirrors `StandardSitePublishCommand`'s `"anglesite-\(POSSEStableKey.make("\(siteID)\n\(path)"))"`. */
export function standardSiteDocumentRkey(siteID: string, path: string): string {
  return `anglesite-${fnv1a(`${siteID}\n${path}`)}`;
}

/** The publication record's at-URI, matching what `AtprotoPutRecordClient.putRecord` returns. */
export function standardSitePublicationURI(did: string, siteID: string): string {
  return `at://${did}/site.standard.publication/${standardSitePublicationRkey(siteID)}`;
}

/** One document record's at-URI for the page at `path` (e.g. `/blog/hello-world/`). */
export function standardSiteDocumentURI(did: string, siteID: string, path: string): string {
  return `at://${did}/site.standard.document/${standardSiteDocumentRkey(siteID, path)}`;
}

/**
 * Shape check for "this `.well-known/site.standard.publication` content is Anglesite's own prior
 * output" — the ownership-detection role `isSecurityTxtMarkerOwned`/`isMTAStsMarkerOwned` play for
 * their generators. Unlike those two, the response body here must be *exactly* the at-URI (per
 * the design doc's verification contract), leaving no room for a separate marker line, so
 * ownership is inferred from shape instead — the same tradeoff `/.well-known/atproto-did` makes
 * for its bare-DID body. A reconnected Bluesky account (new DID/siteID) still matches this shape,
 * so the generator can overwrite its own prior output cleanly on redeploy.
 */
const STANDARD_SITE_PUBLICATION_URI_PATTERN = /^at:\/\/[^\s/]+\/site\.standard\.publication\/[^\s/]+$/;
export function isStandardSitePublicationURI(content: string | null): boolean {
  return content !== null && STANDARD_SITE_PUBLICATION_URI_PATTERN.test(content.trim());
}
