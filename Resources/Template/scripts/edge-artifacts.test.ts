import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRobotsTxt,
  buildSecurityTxt,
  aiCrawlers,
  normalizeContentSignal,
  normalizeSecurityContact,
  normalizeSecurityContacts,
  resolveSecurityTxtMode,
  isSecurityTxtMarkerOwned,
  planSecurityTxt,
  SECURITY_TXT_MARKER,
  buildMTAStsPolicy,
  isMTAStsMarkerOwned,
  MTA_STS_MARKER,
  normalizeMTAStsMX,
  planMTAStsPolicy,
  resolveMTAStsMode,
} from "./edge-artifacts";

test("buildRobotsTxt: allows all crawlers by default and ends with a newline", () => {
  const out = buildRobotsTxt();
  assert.match(out, /^User-agent: \*$/m);
  assert.match(out, /^Disallow:\s*$/m);
  assert.match(out, /\n$/);
  assert.doesNotMatch(out, /GPTBot/);
});

test("committed public/robots.txt is byte-identical to buildRobotsTxt()", () => {
  const committed = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../public/robots.txt"),
    "utf-8",
  );
  assert.equal(buildRobotsTxt(), committed);
});

test("buildRobotsTxt(blockAI=true): blocks every crawler in aiCrawlers", () => {
  const out = buildRobotsTxt(true);
  assert.match(out, /^User-agent: \*$/m, "still has the allow-all baseline");
  for (const bot of aiCrawlers) {
    assert.match(out, new RegExp(`User-agent: ${bot}\\nDisallow: /`), `${bot} has Disallow: /`);
  }
});

test("buildRobotsTxt(blockAI=true): includes BLOCK_AI comment", () => {
  const out = buildRobotsTxt(true);
  assert.match(out, /# AI crawler \/ training bot directives \(BLOCK_AI=true in \.site-config\)/);
});

test("buildRobotsTxt: omits Content-Signal when contentSignal is undefined", () => {
  assert.doesNotMatch(buildRobotsTxt(), /Content-Signal/);
});

test("buildRobotsTxt: emits Content-Signal directive in the default group", () => {
  const out = buildRobotsTxt(false, "search=yes, ai-train=no");
  assert.match(out, /^User-agent: \*$/m);
  assert.match(out, /^Content-Signal: search=yes, ai-train=no$/m);
});

test("buildRobotsTxt: Content-Signal directive precedes any AI-blocking User-agent groups", () => {
  const out = buildRobotsTxt(true, "search=yes, ai-train=no");
  const signalIndex = out.indexOf("Content-Signal:");
  const secondUserAgentIndex = out.indexOf("User-agent:", out.indexOf("User-agent:") + 1);
  assert.ok(signalIndex > -1 && secondUserAgentIndex > -1);
  assert.ok(signalIndex < secondUserAgentIndex, "Content-Signal must stay in the User-agent: * group");
});

test("buildRobotsTxt: advertises the sitemap for an https SITE_URL", () => {
  const out = buildRobotsTxt(false, undefined, "https://example.com");
  assert.match(out, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
});

test("buildRobotsTxt: uses the origin, not a configured SITE_URL path", () => {
  const out = buildRobotsTxt(false, undefined, "https://example.com/blog/");
  assert.match(out, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
});

test("buildRobotsTxt: omits Sitemap when SITE_URL is unset", () => {
  assert.doesNotMatch(buildRobotsTxt(), /Sitemap:/);
});

test("buildRobotsTxt: omits Sitemap (no http fallback) when SITE_URL is insecure", () => {
  assert.doesNotMatch(buildRobotsTxt(false, undefined, "http://example.com"), /Sitemap:/);
});

test("buildRobotsTxt: omits Sitemap when SITE_URL is unparseable", () => {
  assert.doesNotMatch(buildRobotsTxt(false, undefined, "not a url"), /Sitemap:/);
});

test("buildRobotsTxt: Sitemap stands outside every User-agent group", () => {
  const out = buildRobotsTxt(true, "search=yes", "https://example.com");
  const before = out.slice(0, out.indexOf("Sitemap:"));
  assert.match(
    before,
    /\n\n$/,
    "a blank line must end the preceding record so Sitemap reads as a non-group field",
  );
  assert.match(out, /Sitemap: https:\/\/example\.com\/sitemap\.xml\n$/);
});

test("buildRobotsTxt: no blank line between Disallow: and Content-Signal (stays in the same group)", () => {
  const out = buildRobotsTxt(false, "search=yes, ai-train=no");
  const between = out.slice(out.indexOf("Disallow:"), out.indexOf("Content-Signal:"));
  assert.doesNotMatch(
    between,
    /\n\n/,
    "a blank line here would end the User-agent: * record under classic robots.txt grouping",
  );
});

test("normalizeContentSignal: undefined/empty input yields undefined", () => {
  assert.equal(normalizeContentSignal(undefined), undefined);
  assert.equal(normalizeContentSignal(""), undefined);
  assert.equal(normalizeContentSignal("   "), undefined);
});

test("normalizeContentSignal: normalizes whitespace around valid pairs", () => {
  assert.equal(
    normalizeContentSignal(" search=yes ,  ai-input=no,ai-train=no "),
    "search=yes, ai-input=no, ai-train=no",
  );
});

test("normalizeContentSignal: drops unrecognized keys and values", () => {
  assert.equal(normalizeContentSignal("search=yes, bogus=no, ai-train=maybe"), "search=yes");
});

test("normalizeContentSignal: all-invalid input yields undefined", () => {
  assert.equal(normalizeContentSignal("bogus=yes, ai-train=maybe"), undefined);
});

test("normalizeContentSignal: a later duplicate key wins, keeping first-seen key order", () => {
  assert.equal(normalizeContentSignal("search=yes, search=no"), "search=no");
  assert.equal(
    normalizeContentSignal("search=yes, ai-train=no, search=no"),
    "search=no, ai-train=no",
  );
});

const NOW = new Date("2026-06-28T12:00:00Z");

test("buildSecurityTxt: returns null when no contact configured", () => {
  assert.equal(buildSecurityTxt(undefined, "https://example.com", NOW), null);
  assert.equal(buildSecurityTxt("  ", "https://example.com", NOW), null);
});

test("buildSecurityTxt: unrecognized contact (no scheme, no @) returns null", () => {
  // Neither a URI nor an email — skip rather than emit an invalid RFC 9116 Contact.
  assert.equal(buildSecurityTxt("example.com", "https://example.com", NOW), null);
  assert.equal(buildSecurityTxt("+15005550006", "https://example.com", NOW), null);
});

test("buildSecurityTxt: bare email gets a mailto: scheme", () => {
  const out = buildSecurityTxt("security@example.com", "https://example.com", NOW);
  assert.ok(out !== null);
  assert.match(out, /^Contact: mailto:security@example\.com$/m);
});

test("buildSecurityTxt: a URL or mailto contact is used as-is", () => {
  const url = buildSecurityTxt("https://example.com/report", "https://example.com", NOW);
  assert.ok(url !== null);
  assert.match(url, /^Contact: https:\/\/example\.com\/report$/m);
  const mailto = buildSecurityTxt("mailto:s@example.com", "https://example.com", NOW);
  assert.ok(mailto !== null);
  assert.match(mailto, /^Contact: mailto:s@example\.com$/m);
});

test("buildSecurityTxt: an insecure http:// web contact is rejected", () => {
  assert.equal(buildSecurityTxt("http://example.com/report", "https://example.com", NOW), null);
});

test("buildSecurityTxt: Expires is 180 days out", () => {
  const out = buildSecurityTxt("security@example.com", "https://example.com", NOW);
  assert.ok(out !== null);
  assert.match(out, /^Expires: 2026-12-25T12:00:00\.000Z$/m);
});

test("buildSecurityTxt: includes a Canonical URL and trailing newline", () => {
  const out = buildSecurityTxt("security@example.com", "https://example.com", NOW);
  assert.ok(out !== null);
  assert.match(out, /^Canonical: https:\/\/example\.com\/\.well-known\/security\.txt$/m);
  assert.match(out, /\n$/);
});

test("buildSecurityTxt: starts with the ownership marker", () => {
  const out = buildSecurityTxt("security@example.com", "https://example.com", NOW);
  assert.ok(out !== null);
  assert.equal(out.split("\n")[0], SECURITY_TXT_MARKER);
});

test("buildSecurityTxt: omits Canonical when SITE_URL is unset", () => {
  const out = buildSecurityTxt("security@example.com", undefined, NOW);
  assert.ok(out !== null);
  assert.doesNotMatch(out, /Canonical:/);
});

test("buildSecurityTxt: omits Canonical (no example.com fallback) when SITE_URL is insecure", () => {
  const out = buildSecurityTxt("security@example.com", "http://example.com", NOW);
  assert.ok(out !== null);
  assert.doesNotMatch(out, /Canonical:/);
  assert.doesNotMatch(out, /example\.com\/\.well-known/);
});

test("normalizeSecurityContact: rejects http:// but accepts https:// and mailto:/tel:", () => {
  assert.equal(normalizeSecurityContact("http://example.com/report"), null);
  assert.equal(normalizeSecurityContact("https://example.com/report"), "https://example.com/report");
  assert.equal(normalizeSecurityContact("mailto:s@example.com"), "mailto:s@example.com");
  assert.equal(normalizeSecurityContact("tel:+15005550006"), "tel:+15005550006");
  assert.equal(normalizeSecurityContact("s@example.com"), "mailto:s@example.com");
  assert.equal(normalizeSecurityContact(undefined), null);
});

test("normalizeSecurityContacts: preserves order, drops invalid entries, collapses duplicates", () => {
  assert.deepEqual(
    normalizeSecurityContacts("https://example.com/report, s@example.com, http://nope.example, s@example.com"),
    ["https://example.com/report", "mailto:s@example.com"],
  );
});

test("normalizeSecurityContacts: an empty, blank, or undefined value yields no contacts", () => {
  assert.deepEqual(normalizeSecurityContacts(undefined), []);
  assert.deepEqual(normalizeSecurityContacts(""), []);
  assert.deepEqual(normalizeSecurityContacts("  ,  "), []);
});

test("normalizeSecurityContacts: a single value behaves exactly like the old scalar key", () => {
  assert.deepEqual(normalizeSecurityContacts("security@example.com"), ["mailto:security@example.com"]);
});

test("normalizeSecurityContacts: %2C restores a comma inside one contact instead of splitting it", () => {
  // Without the escape this truncates to https://example.com/report?ref=a and drops "b".
  assert.deepEqual(normalizeSecurityContacts("https://example.com/report?ref=a%2Cb"), [
    "https://example.com/report?ref=a,b",
  ]);
});

test("normalizeSecurityContacts: an escaped comma survives alongside real list separators", () => {
  assert.deepEqual(normalizeSecurityContacts("https://example.com/r?ref=a%2Cb,security@example.com"), [
    "https://example.com/r?ref=a,b",
    "mailto:security@example.com",
  ]);
});

test("normalizeSecurityContacts: an ordinary percent sequence is left alone", () => {
  // A general percent-decode would corrupt this to "https://example.com/a b".
  assert.deepEqual(normalizeSecurityContacts("https://example.com/a%20b"), ["https://example.com/a%20b"]);
});

test("buildSecurityTxt: emits one Contact line per entry, in configured preference order", () => {
  const out = buildSecurityTxt(
    "https://github.com/acme/site/security/advisories/new,security@example.com",
    "https://example.com",
    NOW,
  );
  assert.ok(out !== null);
  const contacts = out.split("\n").filter((l) => l.startsWith("Contact:"));
  assert.deepEqual(contacts, [
    "Contact: https://github.com/acme/site/security/advisories/new",
    "Contact: mailto:security@example.com",
  ]);
});

test("buildSecurityTxt: a single-contact list is byte-identical to the pre-list output", () => {
  const expected = `${SECURITY_TXT_MARKER}\nContact: mailto:security@example.com\nExpires: 2026-12-25T12:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n`;
  assert.equal(buildSecurityTxt("security@example.com", "https://example.com", NOW), expected);
});

test("buildSecurityTxt: a list whose entries are all unusable returns null", () => {
  assert.equal(buildSecurityTxt("http://a.example, not-a-uri", "https://example.com", NOW), null);
});

test("buildSecurityTxt: keeps the usable entries when only some are rejected", () => {
  const out = buildSecurityTxt("http://a.example, security@example.com", "https://example.com", NOW);
  assert.ok(out !== null);
  assert.deepEqual(
    out.split("\n").filter((l) => l.startsWith("Contact:")),
    ["Contact: mailto:security@example.com"],
  );
});

test("resolveSecurityTxtMode: an explicit mode always wins over SECURITY_CONTACT", () => {
  assert.equal(resolveSecurityTxtMode("manual", "s@example.com"), "manual");
  assert.equal(resolveSecurityTxtMode("disabled", "s@example.com"), "disabled");
  assert.equal(resolveSecurityTxtMode("generated", undefined), "generated");
});

test("resolveSecurityTxtMode: unset mode infers from SECURITY_CONTACT (legacy behavior)", () => {
  assert.equal(resolveSecurityTxtMode(undefined, "s@example.com"), "generated");
  assert.equal(resolveSecurityTxtMode(undefined, undefined), "disabled");
  assert.equal(resolveSecurityTxtMode(undefined, "  "), "disabled");
});

test("resolveSecurityTxtMode: an unrecognized raw value falls back to inference", () => {
  assert.equal(resolveSecurityTxtMode("bogus", "s@example.com"), "generated");
});

test("isSecurityTxtMarkerOwned: true only for content whose first line is the exact marker", () => {
  assert.ok(isSecurityTxtMarkerOwned(`${SECURITY_TXT_MARKER}\nContact: mailto:s@example.com\n`));
  assert.equal(isSecurityTxtMarkerOwned("Contact: mailto:s@example.com\n"), false);
  assert.equal(isSecurityTxtMarkerOwned(null), false);
});

test("planSecurityTxt: disabled + absent is silent", () => {
  const plan = planSecurityTxt({
    mode: "disabled",
    contacts: undefined,
    siteUrl: undefined,
    now: NOW,
    existingContent: null,
  });
  assert.deepEqual(plan.action, { kind: "none" });
  assert.equal(plan.note, undefined);
});

test("planSecurityTxt: disabled + present is a contradiction that is not deleted", () => {
  const plan = planSecurityTxt({
    mode: "disabled",
    contacts: undefined,
    siteUrl: undefined,
    now: NOW,
    existingContent: "Contact: mailto:s@example.com\n",
  });
  assert.deepEqual(plan.action, { kind: "none" });
  assert.match(plan.note ?? "", /disabled but public\/\.well-known\/security\.txt exists/);
});

test("planSecurityTxt: manual mode never writes or deletes, present or absent", () => {
  const absent = planSecurityTxt({
    mode: "manual",
    contacts: "s@example.com",
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: null,
  });
  assert.deepEqual(absent.action, { kind: "none" });
  const present = planSecurityTxt({
    mode: "manual",
    contacts: undefined,
    siteUrl: undefined,
    now: NOW,
    existingContent: "Contact: mailto:hand-authored@example.com\n",
  });
  assert.deepEqual(present.action, { kind: "none" });
});

test("planSecurityTxt: generated mode with a valid contact writes when absent or marker-owned", () => {
  const absent = planSecurityTxt({
    mode: "generated",
    contacts: "s@example.com",
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: null,
  });
  assert.equal(absent.action.kind, "write");
  const markerOwned = planSecurityTxt({
    mode: "generated",
    contacts: "s@example.com",
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: `${SECURITY_TXT_MARKER}\nContact: mailto:old@example.com\nExpires: 2020-01-01T00:00:00.000Z\n`,
  });
  assert.equal(markerOwned.action.kind, "write");
});

test("planSecurityTxt: generated mode refuses to overwrite an unmarked hand-authored file", () => {
  const plan = planSecurityTxt({
    mode: "generated",
    contacts: "s@example.com",
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: "Contact: mailto:hand-authored@example.com\n",
  });
  assert.deepEqual(plan.action, { kind: "none" });
  assert.match(plan.note ?? "", /refusing to overwrite it/);
});

test("planSecurityTxt: generated mode with an invalid contact deletes only marker-owned stale output", () => {
  const deletesOwned = planSecurityTxt({
    mode: "generated",
    contacts: undefined,
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: `${SECURITY_TXT_MARKER}\nContact: mailto:old@example.com\n`,
  });
  assert.deepEqual(deletesOwned.action, { kind: "delete-stale" });
  const leavesUnmarkedAlone = planSecurityTxt({
    mode: "generated",
    contacts: undefined,
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: "Contact: mailto:hand-authored@example.com\n",
  });
  assert.deepEqual(leavesUnmarkedAlone.action, { kind: "none" });
  const noPriorFile = planSecurityTxt({
    mode: "generated",
    contacts: undefined,
    siteUrl: "https://example.com",
    now: NOW,
    existingContent: null,
  });
  assert.deepEqual(noPriorFile.action, { kind: "none" });
});

test("normalizeMTAStsMX: accepts exact and left-most wildcard DNS names, normalizes, and deduplicates", () => {
  assert.deepEqual(
    normalizeMTAStsMX(" MX1.Example.com., *.mail.example.net, mx1.example.com, invalid, *.*.example.com "),
    ["mx1.example.com", "*.mail.example.net"],
  );
});

test("normalizeMTAStsMX: accepts Punycode A-labels required for internationalized domains", () => {
  assert.deepEqual(normalizeMTAStsMX("mx.xn--bcher-kva.example, mx.example.xn--p1ai"), ["mx.xn--bcher-kva.example", "mx.example.xn--p1ai"]);
});

test("resolveMTAStsMode: only testing and enforce enable generation", () => {
  assert.equal(resolveMTAStsMode("testing"), "testing");
  assert.equal(resolveMTAStsMode("enforce"), "enforce");
  assert.equal(resolveMTAStsMode("none"), "disabled");
  assert.equal(resolveMTAStsMode(undefined), "disabled");
});

test("buildMTAStsPolicy: emits RFC 8461 fields, one mx line per host, and a valid ownership extension", () => {
  const out = buildMTAStsPolicy("testing", "mx1.example.com, *.mail.example.net");
  assert.ok(out !== null);
  assert.equal(
    out,
    "version: STSv1\nmode: testing\nmx: mx1.example.com\nmx: *.mail.example.net\nmax_age: 604800\nx-anglesite: generated\n",
  );
  assert.ok(isMTAStsMarkerOwned(out));
  assert.equal(out.split("\n").at(-2), MTA_STS_MARKER);
});

test("buildMTAStsPolicy: refuses enabled policies without a valid MX host", () => {
  assert.equal(buildMTAStsPolicy("enforce", "not a hostname"), null);
  assert.equal(buildMTAStsPolicy("disabled", "mx.example.com"), null);
});

test("planMTAStsPolicy: preserves hand-authored policies and reports disabled/file contradictions", () => {
  const manual = planMTAStsPolicy({
    mode: "enforce",
    mxRaw: "mx.example.com",
    existingContent: "version: STSv1\nmode: enforce\nmx: mx.example.com\nmax_age: 604800\n",
  });
  assert.deepEqual(manual.action, { kind: "none" });
  assert.match(manual.note ?? "", /refusing to overwrite/);

  const disabled = planMTAStsPolicy({ mode: "disabled", mxRaw: undefined, existingContent: "old" });
  assert.match(disabled.note ?? "", /disabled/);
});
