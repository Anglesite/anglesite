import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRobotsTxt,
  buildSecurityTxt,
  aiCrawlers,
  contentSignalDirective,
  readLicensingUsage,
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
  isValidAtprotoDid,
  isAtprotoDidOwned,
  planAtprotoDid,
} from "./edge-artifacts";
import { NO_USAGE, type AIUsage } from "../src/lib/licensing.ts";
import type { RobotsConfigEntry } from "../src/lib/robots-config.ts";

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

const BLOCKING: AIUsage = { search: "yes", aiInput: "no", aiTrain: "no", blockAICrawlers: true };

test("buildRobotsTxt(blocking usage): blocks every crawler in aiCrawlers", () => {
  const out = buildRobotsTxt(BLOCKING);
  assert.match(out, /^User-agent: \*$/m, "still has the allow-all baseline");
  for (const bot of aiCrawlers) {
    assert.match(out, new RegExp(`User-agent: ${bot}\\nDisallow: /`), `${bot} has Disallow: /`);
  }
});

test("buildRobotsTxt(blocking usage): names licensing.json in the section comment", () => {
  assert.match(
    buildRobotsTxt(BLOCKING),
    /# AI crawler \/ training bot directives \(usage\.blockAICrawlers in src\/data\/licensing\.json\)/,
  );
});

test("buildRobotsTxt: omits Content-Signal when no purpose is stated", () => {
  assert.doesNotMatch(buildRobotsTxt(), /Content-Signal/);
  assert.doesNotMatch(buildRobotsTxt(NO_USAGE), /Content-Signal/);
});

test("buildRobotsTxt: emits Content-Signal in the default group, in canonical order", () => {
  const out = buildRobotsTxt({ search: "yes", aiInput: "unset", aiTrain: "no", blockAICrawlers: false });
  assert.match(out, /^User-agent: \*$/m);
  assert.match(out, /^Content-Signal: search=yes, ai-train=no$/m);
});

test("buildRobotsTxt: Content-Signal precedes any AI-blocking User-agent groups", () => {
  const out = buildRobotsTxt(BLOCKING);
  const signalIndex = out.indexOf("Content-Signal:");
  const secondUserAgentIndex = out.indexOf("User-agent:", out.indexOf("User-agent:") + 1);
  assert.ok(signalIndex > -1 && secondUserAgentIndex > -1);
  assert.ok(signalIndex < secondUserAgentIndex, "Content-Signal must stay in the User-agent: * group");
});

test("buildRobotsTxt: a usage block that permits AI never emits the blocklist", () => {
  const out = buildRobotsTxt({ search: "yes", aiInput: "yes", aiTrain: "yes", blockAICrawlers: false });
  assert.doesNotMatch(out, /GPTBot/);
});

test("buildRobotsTxt: gates the blocklist on mayBlockAICrawlers even given an unclamped usage directly", () => {
  // main() only ever passes output normalizeUsage has already clamped, but buildRobotsTxt is
  // exported and must not trust its own argument — the blocklist-never-exceeds-permissions rule
  // is the whole point of #991, so it has to hold even for a caller that skips normalizeUsage
  // (#991 review finding 3).
  const out = buildRobotsTxt({ search: "unset", aiInput: "yes", aiTrain: "no", blockAICrawlers: true });
  assert.doesNotMatch(out, /GPTBot/);
  for (const bot of aiCrawlers) {
    assert.doesNotMatch(out, new RegExp(bot));
  }
});

test("contentSignalDirective: one pair per stated purpose, undefined when none are stated", () => {
  assert.equal(contentSignalDirective(NO_USAGE), undefined);
  assert.equal(
    contentSignalDirective({ search: "no", aiInput: "yes", aiTrain: "no", blockAICrawlers: false }),
    "search=no, ai-input=yes, ai-train=no",
  );
});

test("buildRobotsTxt: advertises the sitemap for an https SITE_URL", () => {
  const out = buildRobotsTxt(undefined, "https://example.com");
  assert.match(out, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
});

test("buildRobotsTxt: uses the origin, not a configured SITE_URL path", () => {
  const out = buildRobotsTxt(undefined, "https://example.com/blog/");
  assert.match(out, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
});

test("buildRobotsTxt: omits Sitemap when SITE_URL is unset", () => {
  assert.doesNotMatch(buildRobotsTxt(), /Sitemap:/);
});

test("buildRobotsTxt: omits Sitemap (no http fallback) when SITE_URL is insecure", () => {
  assert.doesNotMatch(buildRobotsTxt(undefined, "http://example.com"), /Sitemap:/);
});

test("buildRobotsTxt: omits Sitemap when SITE_URL is unparseable", () => {
  assert.doesNotMatch(buildRobotsTxt(undefined, "not a url"), /Sitemap:/);
});

test("buildRobotsTxt: Sitemap stands outside every User-agent group", () => {
  const out = buildRobotsTxt(BLOCKING, "https://example.com");
  const before = out.slice(0, out.indexOf("Sitemap:"));
  assert.match(
    before,
    /\n\n$/,
    "a blank line must end the preceding record so Sitemap reads as a non-group field",
  );
  assert.match(out, /Sitemap: https:\/\/example\.com\/sitemap\.xml\n$/);
});

test("buildRobotsTxt: no blank line between Disallow: and Content-Signal (stays in the same group)", () => {
  const out = buildRobotsTxt({ search: "yes", aiInput: "unset", aiTrain: "no", blockAICrawlers: false });
  const between = out.slice(out.indexOf("Disallow:"), out.indexOf("Content-Signal:"));
  assert.doesNotMatch(
    between,
    /\n\n/,
    "a blank line here would end the User-agent: * record under classic robots.txt grouping",
  );
});

function withLicensingDoc(doc: unknown): string {
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  mkdirSync(resolve(dir, "src/data"), { recursive: true });
  writeFileSync(resolve(dir, "src/data/licensing.json"), JSON.stringify(doc), "utf-8");
  return dir;
}

test("readLicensingUsage: an absent document yields NO_USAGE and no clamp", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  assert.deepEqual(readLicensingUsage(dir), { usage: NO_USAGE, clamped: false });
});

test("readLicensingUsage: malformed JSON yields NO_USAGE rather than throwing", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  mkdirSync(resolve(dir, "src/data"), { recursive: true });
  writeFileSync(resolve(dir, "src/data/licensing.json"), "{ not json", "utf-8");
  assert.deepEqual(readLicensingUsage(dir), { usage: NO_USAGE, clamped: false });
});

test("readLicensingUsage: reports a clamp when blockAICrawlers was requested but denied", () => {
  const dir = withLicensingDoc({ usage: { aiTrain: "no", blockAICrawlers: true } });
  const out = readLicensingUsage(dir);
  assert.equal(out.usage.blockAICrawlers, false);
  assert.equal(out.clamped, true);
});

test("readLicensingUsage: no clamp reported when the request was honored", () => {
  const dir = withLicensingDoc({ usage: { aiInput: "no", aiTrain: "no", blockAICrawlers: true } });
  const out = readLicensingUsage(dir);
  assert.equal(out.usage.blockAICrawlers, true);
  assert.equal(out.clamped, false);
});

test("readLicensingUsage: an unreadable path (e.g. a directory) yields NO_USAGE rather than throwing", () => {
  // existsSync passes for a directory, so readFileSync is what actually throws (EISDIR) — this
  // exercises the same "file exists but can't be read" shape as a permissions error or a dangling
  // symlink would, and must degrade the same way a JSON.parse failure does rather than escaping
  // out of prebuild with a raw stack (#991 review finding 4).
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  mkdirSync(resolve(dir, "src/data/licensing.json"), { recursive: true });
  assert.deepEqual(readLicensingUsage(dir), { usage: NO_USAGE, clamped: false });
});

test("readLicensingUsage: logs a syntax-specific message for malformed JSON", (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  mkdirSync(resolve(dir, "src/data"), { recursive: true });
  writeFileSync(resolve(dir, "src/data/licensing.json"), "{ not json", "utf-8");
  const logs: unknown[][] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args);
  });

  readLicensingUsage(dir);

  assert.equal(logs.length, 1);
  assert.match(String(logs[0][0]), /is not valid JSON/);
});

test("readLicensingUsage: logs a read-failure message, not a syntax message, for an unreadable path", (t) => {
  // #991 review finding 4: EACCES/EISDIR aren't a syntax problem, so the log a user sees for them
  // must not say "is not valid JSON" — that sends someone with a permissions error looking for a
  // typo that isn't there.
  const dir = mkdtempSync(resolve(tmpdir(), "edge-artifacts-"));
  mkdirSync(resolve(dir, "src/data/licensing.json"), { recursive: true });
  const logs: unknown[][] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args);
  });

  readLicensingUsage(dir);

  assert.equal(logs.length, 1);
  const message = String(logs[0][0]);
  assert.match(message, /could not be read/);
  assert.doesNotMatch(message, /is not valid JSON/);
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

test("buildRobotsTxt: adds a Disallow line per entry inside the User-agent: * group", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/internal/", source: { kind: "page", file: "src/pages/internal.astro" } }];
  const out = buildRobotsTxt(undefined, undefined, entries);
  // `m` flag: `^` must anchor to the "User-agent: *" line, not the very start of `out` (which
  // begins with the "# robots.txt — generated by…" comment line).
  assert.match(out, /^User-agent: \*\nDisallow:\n# src\/pages\/internal\.astro\nDisallow: \/internal\/\n/m);
});

test("buildRobotsTxt: an entry with no source has no back-reference comment", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/manual/" }];
  const out = buildRobotsTxt(undefined, undefined, entries);
  assert.match(out, /Disallow: \/manual\/\n/);
  assert.doesNotMatch(out, /# .*\nDisallow: \/manual\//);
});

test("buildRobotsTxt: a collection source's back-reference is collection/id", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/blog/private/", source: { kind: "collection", collection: "blog", id: "private" } }];
  const out = buildRobotsTxt(undefined, undefined, entries);
  assert.match(out, /# blog\/private\nDisallow: \/blog\/private\/\n/);
});

test("buildRobotsTxt: a malformed collection source gets no back-reference comment", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/orphan/", source: { kind: "collection" } }];
  const out = buildRobotsTxt(undefined, undefined, entries);
  assert.match(out, /Disallow: \/orphan\/\n/);
  assert.doesNotMatch(out, /undefined/);
});

test("buildRobotsTxt: a newline in a path can't inject an extra directive", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/evil/\nAllow: /" }];
  const out = buildRobotsTxt(undefined, undefined, entries);
  assert.match(out, /Disallow: \/evil\/Allow: \/\n/);
  assert.doesNotMatch(out, /^Allow: \/$/m);
});

test("buildRobotsTxt: extra lines are appended verbatim after a blank line", () => {
  const out = buildRobotsTxt(undefined, undefined, [], ["User-agent: SomeBot", "Disallow: /"]);
  assert.match(out, /\n\nUser-agent: SomeBot\nDisallow: \/\n$/);
});

test("buildRobotsTxt: no disallow entries or extra lines leaves output unchanged from today", () => {
  assert.equal(buildRobotsTxt(), buildRobotsTxt(undefined, undefined, [], []));
});

const PLC_DID = "did:plc:z72i7hdynmk6r22z27h6tvur";
const WEB_DID = "did:web:example.com";

test("isValidAtprotoDid: accepts did:plc and did:web, rejects non-DIDs", () => {
  assert.ok(isValidAtprotoDid(PLC_DID));
  assert.ok(isValidAtprotoDid(WEB_DID));
  assert.ok(isValidAtprotoDid(`  ${PLC_DID}  `), "trims surrounding whitespace");
  assert.equal(isValidAtprotoDid(""), false);
  assert.equal(isValidAtprotoDid("not-a-did"), false);
  assert.equal(isValidAtprotoDid("did:plc:"), false);
  assert.equal(isValidAtprotoDid(`${PLC_DID}\nContact: mailto:s@example.com`), false, "no room for extra lines");
});

test("isAtprotoDidOwned: true only for content that is itself a valid DID", () => {
  assert.ok(isAtprotoDidOwned(PLC_DID));
  assert.equal(isAtprotoDidOwned("hand-authored content"), false);
  assert.equal(isAtprotoDidOwned(null), false);
});

test("planAtprotoDid: unset ATPROTO_DID with no existing file is a no-op", () => {
  const plan = planAtprotoDid({ did: undefined, existingContent: null });
  assert.deepEqual(plan.action, { kind: "none" });
});

test("planAtprotoDid: unset ATPROTO_DID deletes only a previously generated (DID-shaped) file", () => {
  const deletesOwned = planAtprotoDid({ did: undefined, existingContent: PLC_DID });
  assert.deepEqual(deletesOwned.action, { kind: "delete-stale" });

  const leavesHandAuthoredAlone = planAtprotoDid({ did: "", existingContent: "hand-authored, not a DID" });
  assert.deepEqual(leavesHandAuthoredAlone.action, { kind: "none" });
});

test("planAtprotoDid: a syntactically invalid ATPROTO_DID generates nothing", () => {
  const plan = planAtprotoDid({ did: "not-a-did", existingContent: null });
  assert.deepEqual(plan.action, { kind: "none" });
  assert.match(plan.note ?? "", /not a syntactically valid DID/);
});

test("planAtprotoDid: writes the bare DID plus a trailing newline when absent or previously generated", () => {
  const absent = planAtprotoDid({ did: PLC_DID, existingContent: null });
  assert.deepEqual(absent.action, { kind: "write", content: `${PLC_DID}\n` });

  const previouslyGenerated = planAtprotoDid({ did: WEB_DID, existingContent: PLC_DID });
  assert.deepEqual(
    previouslyGenerated.action,
    { kind: "write", content: `${WEB_DID}\n` },
    "reconnecting a different Bluesky account overwrites a prior DID-shaped file on redeploy",
  );

  const alreadyCurrent = planAtprotoDid({ did: PLC_DID, existingContent: `${PLC_DID}\n` });
  assert.deepEqual(alreadyCurrent.action, { kind: "write", content: `${PLC_DID}\n` });
});

test("planAtprotoDid: refuses to overwrite hand-authored content that isn't a valid DID", () => {
  const plan = planAtprotoDid({ did: PLC_DID, existingContent: "hand-authored, not a DID" });
  assert.deepEqual(plan.action, { kind: "none" });
  assert.match(plan.note ?? "", /refusing to overwrite it/);
});
