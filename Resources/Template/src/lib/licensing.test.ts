import test from "node:test";
import assert from "node:assert/strict";
import {
  headLicense,
  mayBlockAICrawlers,
  NO_USAGE,
  normalizePolicy,
  normalizeUsage,
  NON_ASSERTING_COLLECTIONS,
  resolveLicense,
  type LicensingPolicy,
} from "./licensing.ts";

const CC_BY: LicensingPolicy["default"] = {
  url: "https://creativecommons.org/licenses/by/4.0/",
  name: "CC BY 4.0",
};

test("resolveLicense: an asserting collection inherits the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {}, usage: NO_USAGE };
  assert.deepEqual(resolveLicense(policy, "notes"), CC_BY);
  assert.deepEqual(resolveLicense(policy, "blog"), CC_BY);
});

test("resolveLicense: non-asserting collections return null despite a site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {}, usage: NO_USAGE };
  for (const collection of NON_ASSERTING_COLLECTIONS) {
    assert.equal(resolveLicense(policy, collection), null, `${collection} must not assert`);
  }
});

test("resolveLicense: an explicit override beats the non-asserting default", () => {
  const policy: LicensingPolicy = { default: null, collections: { likes: CC_BY }, usage: NO_USAGE };
  assert.deepEqual(resolveLicense(policy, "likes"), CC_BY);
});

test("resolveLicense: an explicit null override beats the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: { notes: null }, usage: NO_USAGE };
  assert.equal(resolveLicense(policy, "notes"), null);
});

test("resolveLicense: no site default and no override yields null", () => {
  assert.equal(resolveLicense({ default: null, collections: {}, usage: NO_USAGE }, "articles"), null);
});

test("normalizePolicy: undefined input yields an empty policy", () => {
  assert.deepEqual(normalizePolicy(undefined), { default: null, collections: {}, usage: NO_USAGE });
});

test("normalizePolicy: reads a well-formed document", () => {
  const raw = {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
  };
  assert.deepEqual(normalizePolicy(raw), {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
    usage: NO_USAGE,
  });
});

test("normalizePolicy: preserves an explicit null collection override", () => {
  const out = normalizePolicy({ default: null, collections: { notes: null } });
  assert.equal(Object.hasOwn(out.collections, "notes"), true);
  assert.equal(out.collections.notes, null);
});

test("normalizePolicy: drops a license with a missing or non-string url", () => {
  assert.equal(normalizePolicy({ default: { name: "No URL" } }).default, null);
  assert.equal(normalizePolicy({ default: { url: 42, name: "Bad" } }).default, null);
});

test("normalizePolicy: drops an unknown collection key", () => {
  const out = normalizePolicy({
    collections: { nonsense: { url: "https://example.com/x", name: "X" } },
  });
  assert.deepEqual(out.collections, {});
});

test("normalizePolicy: falls back to the url when name is absent", () => {
  const out = normalizePolicy({ default: { url: "https://example.com/l" } });
  assert.deepEqual(out.default, { url: "https://example.com/l", name: "https://example.com/l" });
});

test("normalizePolicy: rejects a javascript: URL", () => {
  const out = normalizePolicy({ default: { url: "javascript:alert(1)", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a javascript: URL case-insensitively", () => {
  const out = normalizePolicy({ default: { url: "JavaScript:alert(1)", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a data: URL", () => {
  const out = normalizePolicy({
    default: { url: "data:text/html,<script>alert(1)</script>", name: "Evil" },
  });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a vbscript: URL", () => {
  const out = normalizePolicy({ default: { url: "vbscript:msgbox(1)", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: accepts an https: URL", () => {
  const out = normalizePolicy({ default: { url: "https://example.com/l", name: "Example" } });
  assert.deepEqual(out.default, { url: "https://example.com/l", name: "Example" });
});

test("normalizePolicy: accepts an http: URL", () => {
  const out = normalizePolicy({ default: { url: "http://example.com/l", name: "Example" } });
  assert.deepEqual(out.default, { url: "http://example.com/l", name: "Example" });
});

test("normalizePolicy: accepts a root-relative URL (site-local license page)", () => {
  const out = normalizePolicy({ default: { url: "/license/", name: "Site License" } });
  assert.deepEqual(out.default, { url: "/license/", name: "Site License" });
});

test("normalizePolicy: rejects a protocol-relative URL", () => {
  // `//evil.example/x` inherits whatever scheme the page is served over, but it still hands an
  // attacker-chosen host to href/rel="license" — not the "site-local page" case the root-relative
  // allowance exists for, so it is rejected rather than silently treated as same-origin.
  const out = normalizePolicy({ default: { url: "//evil.example/x", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a bare relative URL", () => {
  // Only root-relative ("/...") is accepted; a bare relative path is ambiguous about which
  // directory it resolves against once linked from arbitrary pages, so it is out of scope.
  const out = normalizePolicy({ default: { url: "license.html", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a protocol-relative URL smuggled past the leading-slash guard via a tab", () => {
  // The leading-slash fast path used to run against the raw string: a single leading slash
  // followed by a tab still reads as "starts with / but not //" before sanitization. A browser
  // strips the tab before parsing and resolves this as `//evil.com` — a protocol-relative URL
  // handing an attacker-chosen host to href — so it must be rejected, not accepted as
  // root-relative (#991 review finding 2).
  const out = normalizePolicy({ default: { url: "/\t/evil.com", name: "Evil" } });
  assert.equal(out.default, null);
});

test("normalizePolicy: rejects a protocol-relative URL smuggled via CR or LF", () => {
  assert.equal(normalizePolicy({ default: { url: "/\r/evil.com", name: "Evil" } }).default, null);
  assert.equal(normalizePolicy({ default: { url: "/\n/evil.com", name: "Evil" } }).default, null);
});

test("resolveLicense: a bad-URL collection override resolves to null, not a leaked entry", () => {
  const policy = normalizePolicy({
    default: { url: "https://example.com/l", name: "Default" },
    collections: { photos: { url: "javascript:alert(1)", name: "Evil" } },
  });
  // A malformed override is indistinguishable from an explicit "assert nothing" override — same
  // as an entry with a missing/non-string url already behaved before this change — so the key is
  // present with a null value, and resolution must yield null rather than the bad href leaking
  // through in any form.
  assert.equal(Object.hasOwn(policy.collections, "photos"), true);
  assert.equal(resolveLicense(policy, "photos"), null);
});

test("normalizePolicy: a non-object document yields an empty policy", () => {
  assert.deepEqual(normalizePolicy("nope"), { default: null, collections: {}, usage: NO_USAGE });
  assert.deepEqual(normalizePolicy(null), { default: null, collections: {}, usage: NO_USAGE });
});

test("headLicense: undefined prop falls through to the site default", () => {
  assert.deepEqual(headLicense(undefined, CC_BY), CC_BY);
});

test("headLicense: explicit null prop wins even when a site default exists", () => {
  // This is the case `prop ?? siteDefault` gets wrong: `??` treats null the same as
  // undefined and would fall back to CC_BY here, re-asserting a license the caller
  // explicitly suppressed (e.g. a non-asserting collection entry). headLicense must
  // return null, not CC_BY.
  assert.equal(headLicense(null, CC_BY), null);
});

test("headLicense: an explicit ref overrides the site default", () => {
  const override = { url: "https://example.com/override", name: "Override" };
  assert.deepEqual(headLicense(override, CC_BY), override);
});

test("headLicense: an explicit ref applies even when the site default is null", () => {
  const override = { url: "https://example.com/override", name: "Override" };
  assert.deepEqual(headLicense(override, null), override);
});

test("normalizeUsage: a missing block yields every purpose unset and no blocklist", () => {
  assert.deepEqual(normalizeUsage(undefined), NO_USAGE);
  assert.deepEqual(normalizeUsage(null), NO_USAGE);
  assert.deepEqual(normalizeUsage("nope"), NO_USAGE);
});

test("normalizeUsage: reads a well-formed block", () => {
  assert.deepEqual(normalizeUsage({ search: "yes", aiInput: "no", aiTrain: "no", blockAICrawlers: true }), {
    search: "yes",
    aiInput: "no",
    aiTrain: "no",
    blockAICrawlers: true,
  });
});

test("normalizeUsage: drops unrecognized values and unknown keys", () => {
  assert.deepEqual(normalizeUsage({ search: "maybe", aiTrain: 42, bogus: "yes" }), NO_USAGE);
});

test("normalizeUsage: a non-boolean blockAICrawlers is false", () => {
  const out = normalizeUsage({ aiInput: "no", aiTrain: "no", blockAICrawlers: "true" });
  assert.equal(out.blockAICrawlers, false);
});

test("normalizeUsage: clamps blockAICrawlers unless both AI purposes are denied", () => {
  const cases = [
    { aiInput: "no", aiTrain: "yes" },
    { aiInput: "yes", aiTrain: "no" },
    { aiInput: "no" },
  ];
  for (const partial of cases) {
    const out = normalizeUsage({ ...partial, blockAICrawlers: true });
    assert.equal(out.blockAICrawlers, false, `${JSON.stringify(partial)} must not block`);
  }
});

test("normalizeUsage: search alone never enables the blocklist", () => {
  assert.equal(normalizeUsage({ search: "no", blockAICrawlers: true }).blockAICrawlers, false);
});

test("mayBlockAICrawlers: true only when both AI purposes are denied", () => {
  assert.equal(mayBlockAICrawlers({ aiInput: "no", aiTrain: "no" }), true);
  assert.equal(mayBlockAICrawlers({ aiInput: "no", aiTrain: "unset" }), false);
  assert.equal(mayBlockAICrawlers({ aiInput: "yes", aiTrain: "no" }), false);
});

test("normalizePolicy: a document with no usage block yields NO_USAGE", () => {
  assert.deepEqual(normalizePolicy({ default: null }).usage, NO_USAGE);
});

test("normalizePolicy: carries and clamps the usage block", () => {
  const out = normalizePolicy({
    default: null,
    collections: {},
    usage: { search: "yes", aiInput: "no", aiTrain: "no", blockAICrawlers: true },
  });
  assert.equal(out.usage.blockAICrawlers, true);
  assert.equal(normalizePolicy({ usage: { aiTrain: "no", blockAICrawlers: true } }).usage.blockAICrawlers, false);
});
