import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRslDocument,
  feedRslContent,
  httpsOrigin,
  paymentForLicense,
  rslActive,
  rslFileUrl,
  RSL_NAMESPACE,
} from "./rsl.ts";
import { NO_USAGE, type AIUsage, type LicensingPolicy } from "./licensing.ts";

const CC0 = { url: "https://creativecommons.org/publicdomain/zero/1.0/", name: "CC0 1.0" };
const CC_BY = { url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0" };
const CC_BY_NC = { url: "https://creativecommons.org/licenses/by-nc/4.0/", name: "CC BY-NC 4.0" };
const CUSTOM = { url: "https://example.com/my-terms", name: "My Terms" };

function policy(overrides: Partial<LicensingPolicy> = {}): LicensingPolicy {
  return { default: null, collections: {}, usage: { ...NO_USAGE }, publishRSL: true, ...overrides };
}

test("paymentForLicense: CC0 is free, other CC variants require attribution", () => {
  assert.equal(paymentForLicense(CC0), "free");
  assert.equal(paymentForLicense(CC_BY), "attribution");
  assert.equal(paymentForLicense(CC_BY_NC), "attribution");
});

test("paymentForLicense: an unclassified custom license and null are both unclassified", () => {
  assert.equal(paymentForLicense(CUSTOM), null);
  assert.equal(paymentForLicense(null), null);
});

test("httpsOrigin: accepts only a valid https URL", () => {
  assert.equal(httpsOrigin("https://example.com/"), "https://example.com");
  assert.equal(httpsOrigin("http://example.com/"), null);
  assert.equal(httpsOrigin(undefined), null);
  assert.equal(httpsOrigin("not a url"), null);
});

test("rslActive: requires both publishRSL and a usable https SITE_URL", () => {
  assert.equal(rslActive(policy({ publishRSL: true }), "https://example.com"), true);
  assert.equal(rslActive(policy({ publishRSL: false }), "https://example.com"), false);
  assert.equal(rslActive(policy({ publishRSL: true }), undefined), false);
  assert.equal(rslActive(policy({ publishRSL: true }), "http://example.com"), false);
});

test("rslFileUrl: joins the https origin with /rsl.xml, or null when inactive", () => {
  assert.equal(rslFileUrl("https://example.com/"), "https://example.com/rsl.xml");
  assert.equal(rslFileUrl("http://example.com/"), null);
  assert.equal(rslFileUrl(undefined), null);
});

test("buildRslDocument: publishRSL off yields null even with a full policy", () => {
  assert.equal(buildRslDocument(policy({ publishRSL: false, default: CC_BY })), null);
});

test("buildRslDocument: publishRSL on but nothing to declare yields null", () => {
  assert.equal(buildRslDocument(policy()), null);
});

test("buildRslDocument: emits a root <rsl> with the RSL namespace", () => {
  const xml = buildRslDocument(policy({ default: CC_BY }));
  assert.match(xml!, new RegExp(`<rsl xmlns="${RSL_NAMESPACE}">`));
  assert.match(xml!, /<\/rsl>\s*$/);
});

test("buildRslDocument: site default CC BY emits attribution payment and terms", () => {
  const xml = buildRslDocument(policy({ default: CC_BY }))!;
  assert.match(xml, /<content url="\/">/);
  assert.match(xml, /<payment type="attribution">\s*<standard>https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/<\/standard>\s*<\/payment>/);
  assert.match(xml, /<terms>https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/<\/terms>/);
});

test("buildRslDocument: site default CC0 emits a self-closing free payment", () => {
  const xml = buildRslDocument(policy({ default: CC0 }))!;
  assert.match(xml, /<payment type="free"\/>/);
  assert.doesNotMatch(xml, /<standard>/);
});

test("buildRslDocument: a custom license has no <payment> but still has <terms>", () => {
  const xml = buildRslDocument(policy({ default: CUSTOM }))!;
  assert.doesNotMatch(xml, /<payment/);
  assert.match(xml, /<terms>https:\/\/example\.com\/my-terms<\/terms>/);
});

test("buildRslDocument: usage permits/prohibits render as one space-separated element each", () => {
  const usage: AIUsage = { search: "yes", aiInput: "yes", aiTrain: "no", blockAICrawlers: false };
  const xml = buildRslDocument(policy({ default: CC_BY, usage }))!;
  assert.match(xml, /<permits type="usage">search ai-input<\/permits>/);
  assert.match(xml, /<prohibits type="usage">ai-train<\/prohibits>/);
});

test("buildRslDocument: no license and no usage stated omits the site-wide block", () => {
  // A collection override still needs a block even when the site-wide block has nothing to say.
  const xml = buildRslDocument(policy({ collections: { notes: CC_BY } }))!;
  assert.doesNotMatch(xml, /<content url="\/">/);
  assert.match(xml, /<content url="\/notes\/\*">/);
});

test("buildRslDocument: emits a copyright element from holder, and omits it when absent", () => {
  const withHolder = buildRslDocument(policy({ default: CC_BY }), "Jane Q. Author")!;
  assert.match(withHolder, /<copyright>Jane Q\. Author<\/copyright>/);
  const withoutHolder = buildRslDocument(policy({ default: CC_BY }))!;
  assert.doesNotMatch(withoutHolder, /<copyright>/);
});

test("buildRslDocument: an inheriting collection gets no block of its own", () => {
  const xml = buildRslDocument(policy({ default: CC_BY }))!;
  assert.doesNotMatch(xml, /notes/);
  assert.doesNotMatch(xml, /articles/);
});

test("buildRslDocument: an explicit license override gets its own narrower block", () => {
  const xml = buildRslDocument(policy({ default: CC_BY, collections: { photos: CC_BY_NC } }))!;
  assert.match(xml, /<content url="\/photos\/\*">/);
  assert.match(xml, /<standard>https:\/\/creativecommons\.org\/licenses\/by-nc\/4\.0\/<\/standard>/);
});

test("buildRslDocument: non-asserting collections withhold everything, regardless of site usage", () => {
  const usage: AIUsage = { search: "yes", aiInput: "yes", aiTrain: "yes", blockAICrawlers: false };
  const xml = buildRslDocument(policy({ default: CC_BY, usage }))!;
  for (const collection of ["bookmarks", "replies", "likes", "reviews"]) {
    const block = xml.match(new RegExp(`<content url="/${collection}/\\*">[\\s\\S]*?</content>`));
    assert.ok(block, `${collection} must have its own withholding block`);
    assert.match(block![0], /<prohibits type="usage">all<\/prohibits>/);
    assert.doesNotMatch(block![0], /<permits/, `${collection} must not inherit the site-wide grant`);
  }
});

test("buildRslDocument: an explicit null override on an otherwise-asserting collection also withholds", () => {
  const xml = buildRslDocument(policy({ default: CC_BY, collections: { notes: null } }))!;
  const block = xml.match(/<content url="\/notes\/\*">[\s\S]*?<\/content>/);
  assert.ok(block);
  assert.match(block![0], /<prohibits type="usage">all<\/prohibits>/);
});

test("feedRslContent: null license and no usage on an asserting collection yields null", () => {
  assert.equal(feedRslContent("https://example.com/notes/x/", null, false, { ...NO_USAGE }, undefined), null);
});

test("feedRslContent: a non-asserting item withholds even when site usage permits everything", () => {
  const usage: AIUsage = { search: "yes", aiInput: "yes", aiTrain: "yes", blockAICrawlers: false };
  const xml = feedRslContent("https://example.com/bookmarks/x/", null, true, usage, undefined)!;
  assert.match(xml, /<rsl:content url="\/bookmarks\/x\/">/);
  assert.match(xml, /<rsl:prohibits type="usage">all<\/rsl:prohibits>/);
  assert.doesNotMatch(xml, /<rsl:permits/);
});

test("feedRslContent: uses the rsl: prefix on every element, including nested payment children", () => {
  const xml = feedRslContent("https://example.com/notes/x/", CC_BY, false, { ...NO_USAGE }, "Jane")!;
  assert.match(xml, /<rsl:content url="\/notes\/x\/">/);
  assert.match(xml, /<rsl:license>/);
  assert.match(xml, /<rsl:payment type="attribution">/);
  assert.match(xml, /<rsl:standard>/);
  assert.match(xml, /<rsl:terms>/);
  assert.match(xml, /<rsl:copyright>Jane<\/rsl:copyright>/);
  assert.doesNotMatch(xml, /<payment/); // never the unprefixed form
});

test("feedRslContent: uses the item's URL pathname, not its full absolute URL", () => {
  const xml = feedRslContent("https://example.com/notes/hello/", CC_BY, false, { ...NO_USAGE }, undefined)!;
  assert.match(xml, /url="\/notes\/hello\/"/);
  assert.doesNotMatch(xml, /url="https:/);
});
