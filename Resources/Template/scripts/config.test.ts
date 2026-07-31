import test from "node:test";
import assert from "node:assert/strict";
import { asBookingProvider, asDonationsProvider, asContactProvider, readConfigFromString, resolveLang } from "./config";

test("asBookingProvider: passes through recognized providers", () => {
  assert.equal(asBookingProvider("cal"), "cal");
  assert.equal(asBookingProvider("calendly"), "calendly");
});

test("asBookingProvider: rejects unrecognized or empty values", () => {
  assert.equal(asBookingProvider("zoom"), undefined);
  assert.equal(asBookingProvider(""), undefined);
  assert.equal(asBookingProvider(undefined), undefined);
});

test("asDonationsProvider: passes through recognized providers", () => {
  assert.equal(asDonationsProvider("stripe"), "stripe");
  assert.equal(asDonationsProvider("liberapay"), "liberapay");
  assert.equal(asDonationsProvider("github-sponsors"), "github-sponsors");
});

test("asDonationsProvider: rejects unrecognized or empty values", () => {
  assert.equal(asDonationsProvider("patreon"), undefined);
  assert.equal(asDonationsProvider(""), undefined);
  assert.equal(asDonationsProvider(undefined), undefined);
});

test("asContactProvider: passes through recognized providers", () => {
  assert.equal(asContactProvider("formspree"), "formspree");
  assert.equal(asContactProvider("mailto"), "mailto");
});

test("asContactProvider: rejects unrecognized or empty values", () => {
  assert.equal(asContactProvider("typeform"), undefined);
  assert.equal(asContactProvider(""), undefined);
  assert.equal(asContactProvider(undefined), undefined);
});

// BaseLayout.astro gates `<link rel="webmention">` on this key (#359) — only advertise the
// endpoint once SocialWorkerProvisionCommand has actually provisioned inbound receive.
test("readConfigFromString: WEBMENTION_RECEIVE_ENABLED reads true when present", () => {
  assert.equal(
    readConfigFromString("SITE_URL=https://example.com\nWEBMENTION_RECEIVE_ENABLED=true", "WEBMENTION_RECEIVE_ENABLED"),
    "true",
  );
});

test("readConfigFromString: WEBMENTION_RECEIVE_ENABLED is undefined when absent", () => {
  assert.equal(
    readConfigFromString("SITE_URL=https://example.com", "WEBMENTION_RECEIVE_ENABLED"),
    undefined,
  );
});

test("readConfigFromString: reads COPYRIGHT_HOLDER", () => {
  assert.equal(
    readConfigFromString("SITE_NAME=Acme\nCOPYRIGHT_HOLDER=Ada Lovelace\n", "COPYRIGHT_HOLDER"),
    "Ada Lovelace",
  );
});

test("readConfigFromString: COPYRIGHT_HOLDER is undefined when absent", () => {
  assert.equal(readConfigFromString("SITE_NAME=Acme\n", "COPYRIGHT_HOLDER"), undefined);
});

// BaseLayout.astro sets <html lang> from this (#956, WCAG 2.2 SC 3.1.1).
test("readConfigFromString: reads LANG", () => {
  assert.equal(readConfigFromString("SITE_NAME=Acme\nLANG=fr-CA\n", "LANG"), "fr-CA");
});

test("resolveLang: passes through a configured tag", () => {
  assert.equal(resolveLang("fr-CA"), "fr-CA");
});

test("resolveLang: falls back to en when unset or blank", () => {
  assert.equal(resolveLang(undefined), "en");
  assert.equal(resolveLang(""), "en");
  assert.equal(resolveLang("   "), "en");
});
