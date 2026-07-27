import test from "node:test";
import assert from "node:assert/strict";
import {
  headLicense,
  NON_ASSERTING_COLLECTIONS,
  normalizePolicy,
  resolveLicense,
  type LicensingPolicy,
} from "./licensing.ts";

const CC_BY: LicensingPolicy["default"] = {
  url: "https://creativecommons.org/licenses/by/4.0/",
  name: "CC BY 4.0",
};

test("resolveLicense: an asserting collection inherits the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {} };
  assert.deepEqual(resolveLicense(policy, "notes"), CC_BY);
  assert.deepEqual(resolveLicense(policy, "blog"), CC_BY);
});

test("resolveLicense: non-asserting collections return null despite a site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: {} };
  for (const collection of NON_ASSERTING_COLLECTIONS) {
    assert.equal(resolveLicense(policy, collection), null, `${collection} must not assert`);
  }
});

test("resolveLicense: an explicit override beats the non-asserting default", () => {
  const policy: LicensingPolicy = { default: null, collections: { likes: CC_BY } };
  assert.deepEqual(resolveLicense(policy, "likes"), CC_BY);
});

test("resolveLicense: an explicit null override beats the site default", () => {
  const policy: LicensingPolicy = { default: CC_BY, collections: { notes: null } };
  assert.equal(resolveLicense(policy, "notes"), null);
});

test("resolveLicense: no site default and no override yields null", () => {
  assert.equal(resolveLicense({ default: null, collections: {} }, "articles"), null);
});

test("normalizePolicy: undefined input yields an empty policy", () => {
  assert.deepEqual(normalizePolicy(undefined), { default: null, collections: {} });
});

test("normalizePolicy: reads a well-formed document", () => {
  const raw = {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
  };
  assert.deepEqual(normalizePolicy(raw), {
    default: { url: "https://example.com/l", name: "Example" },
    collections: { photos: { url: "https://example.com/p", name: "Photos" } },
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

test("normalizePolicy: a non-object document yields an empty policy", () => {
  assert.deepEqual(normalizePolicy("nope"), { default: null, collections: {} });
  assert.deepEqual(normalizePolicy(null), { default: null, collections: {} });
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
