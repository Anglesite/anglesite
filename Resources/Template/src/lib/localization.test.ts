// Resources/Template/src/lib/localization.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readConfigFromString } from "../../scripts/config.ts";
import { siteLangFromConfig } from "./localization.ts";

test("siteLangFromConfig: returns SITE_LANG when present", () => {
  assert.equal(siteLangFromConfig("SITE_LANG=fr-CA\n"), "fr-CA");
});

test("siteLangFromConfig: defaults to \"en\" when SITE_LANG is absent", () => {
  assert.equal(siteLangFromConfig("SITE_NAME=Acme\n"), "en");
  assert.equal(siteLangFromConfig(""), "en");
});

test("siteLangFromConfig: an empty SITE_LANG value still defaults to \"en\"", () => {
  // Guards the same "blank means unset" rule used for per-page overrides (see Task 6/7) —
  // the site default itself must never render <html lang="">.
  assert.equal(siteLangFromConfig("SITE_LANG=\n"), "en");
});

// Sanity check that readConfigFromString (used indirectly through readConfig in production)
// agrees with the pure helper's parsing of the same raw text.
test("siteLangFromConfig agrees with readConfigFromString for a present key", () => {
  const raw = "SITE_NAME=Acme\nSITE_LANG=es\n";
  assert.equal(siteLangFromConfig(raw), readConfigFromString(raw, "SITE_LANG"));
});
