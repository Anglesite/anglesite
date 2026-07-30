import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowedDomains, buildCSP, buildHeaders } from "./csp";
import type { RobotsConfigEntry } from "../src/lib/robots-config.ts";

test("parseAllowedDomains: empty config yields no domains", () => {
  assert.deepEqual(parseAllowedDomains(""), []);
});

test("parseAllowedDomains: dedupes, trims, sorts, drops blanks", () => {
  const cfg = "SCRIPT_ALLOW=js.stripe.com, app.cal.com ,,js.stripe.com, ";
  assert.deepEqual(parseAllowedDomains(cfg), ["app.cal.com", "js.stripe.com"]);
});

test("buildCSP: baseline when no integrations configured", () => {
  assert.equal(
    buildCSP(""),
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' static.cloudflareinsights.com; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
      "connect-src 'self' cloudflareinsights.com; frame-src 'self'; object-src 'none'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
  );
});

test("buildCSP: a configured domain lands in script/frame/connect/img/form-action only", () => {
  const csp = buildCSP("SCRIPT_ALLOW=giscus.app");
  // present in the five embed directives
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' static\.cloudflareinsights\.com giscus\.app;/);
  assert.match(csp, /img-src 'self' data: giscus\.app;/);
  assert.match(csp, /connect-src 'self' cloudflareinsights\.com giscus\.app;/);
  assert.match(csp, /frame-src 'self' giscus\.app;/);
  assert.match(csp, /form-action 'self' giscus\.app/);
  // absent from non-embed directives
  assert.match(csp, /style-src 'self' 'unsafe-inline';/);
  assert.ok(!/style-src[^;]*giscus\.app/.test(csp));
  assert.match(csp, /object-src 'none';/);
  assert.ok(!/object-src[^;]*giscus\.app/.test(csp));
});

// A contact form POSTing to a third-party provider (e.g. Formspree) needs its own domain
// in form-action, or the browser's own CSP blocks the submission — see #469 review.
test("buildCSP: a configured domain allows the browser to submit forms to it", () => {
  const csp = buildCSP("SCRIPT_ALLOW=formspree.io");
  assert.match(csp, /form-action 'self' formspree\.io/);
});

test("buildHeaders: includes security headers, CSP, and astro caching", () => {
  const out = buildHeaders("SCRIPT_ALLOW=js.stripe.com");
  assert.match(out, /^\/\*\n/);
  assert.match(out, /X-Frame-Options: DENY/);
  assert.match(out, /X-Content-Type-Options: nosniff/);
  assert.match(out, /Content-Security-Policy: .*js\.stripe\.com/);
  assert.match(out, /\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable\n/);
});

test("buildHeaders: security.txt gets its exact RFC 9116 media type", () => {
  const out = buildHeaders("");
  assert.match(out, /\n\/\.well-known\/security\.txt\n  Content-Type: text\/plain; charset=utf-8\n/);
});

test("buildHeaders: includes cross-origin isolation headers", () => {
  const out = buildHeaders("");
  assert.match(out, /Cross-Origin-Opener-Policy: same-origin-allow-popups\n/);
  assert.match(out, /Cross-Origin-Resource-Policy: same-site\n/);
});

test("buildHeaders: HSTS present without preload by default", () => {
  const out = buildHeaders("");
  assert.match(out, /Strict-Transport-Security: max-age=31536000; includeSubDomains\n/);
  assert.ok(!/Strict-Transport-Security:[^\n]*preload/.test(out));
});

test("buildHeaders: HSTS_PRELOAD=true appends preload", () => {
  const out = buildHeaders("HSTS_PRELOAD=true");
  assert.match(out, /Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n/);
});

test("buildHeaders: near-true HSTS_PRELOAD values do not enable preload", () => {
  for (const v of ["yes", "1", "on", "TRUE "]) {
    // "TRUE " (trailing space) trims+lowercases to "true" — so only it should opt in.
    const out = buildHeaders(`HSTS_PRELOAD=${v}`);
    const hasPreload = /Strict-Transport-Security:[^\n]*preload/.test(out);
    assert.equal(hasPreload, v.trim().toLowerCase() === "true", `value=${JSON.stringify(v)}`);
  }
});

test("buildCSP: upgrade-insecure-requests survives custom SCRIPT_ALLOW config", () => {
  const csp = buildCSP("SCRIPT_ALLOW=js.stripe.com");
  assert.match(csp, /upgrade-insecure-requests$/);
});

test("buildHeaders: no sw.js rule by default", () => {
  const out = buildHeaders("");
  assert.ok(!/\/sw\.js/.test(out));
});

// The pwa integration doesn't append its own rule to _headers — this function regenerates the
// whole file on every prebuild, so anything appended outside it would be wiped on the next
// build. main() derives this flag from whether public/sw.js exists on disk instead.
test("buildHeaders: serviceWorkerPresent adds a no-cache rule for /sw.js", () => {
  const out = buildHeaders("", true);
  assert.match(out, /\n\/sw\.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: \/\n/);
});

test("committed public/_headers is byte-identical to buildHeaders(\"\")", () => {
  const committed = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../public/_headers"),
    "utf-8",
  );
  assert.equal(buildHeaders(""), committed);
});

test("buildCSP: EMBED_VIDEO_INLINE=true allows youtube-nocookie in frame-src only", () => {
  const csp = buildCSP("EMBED_VIDEO_INLINE=true");
  assert.match(csp, /frame-src 'self' www\.youtube-nocookie\.com;/);
  assert.ok(!/script-src[^;]*youtube/.test(csp));
  assert.ok(!/img-src[^;]*youtube/.test(csp));
  assert.ok(!/connect-src[^;]*youtube/.test(csp));
});

test("buildCSP: EMBED_VIDEO_INLINE defaults off, and only exact 'true' enables it", () => {
  for (const cfg of ["", "EMBED_VIDEO_INLINE=false", "EMBED_VIDEO_INLINE=1", "EMBED_VIDEO_INLINE=yes"]) {
    assert.match(buildCSP(cfg), /frame-src 'self';/, cfg);
  }
});

test("buildHeaders: adds an X-Robots-Tag block per noindex entry", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/blog/private/" }];
  const out = buildHeaders("", false, entries);
  assert.match(out, /\n\/blog\/private\/\n  X-Robots-Tag: noindex\n/);
});

test("buildHeaders: no noindex entries leaves output unchanged from today", () => {
  assert.equal(buildHeaders(""), buildHeaders("", false, []));
});

test("buildHeaders: a newline in a path can't open an extra header block", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/evil/\n/*\n  X-Frame-Options: ALLOWALL" }];
  const out = buildHeaders("", false, entries);
  // The whole path collapses onto the single route line it was meant to be.
  assert.match(out, /\n\/evil\/\/\*  X-Frame-Options: ALLOWALL\n  X-Robots-Tag: noindex\n/);
  assert.doesNotMatch(out, /^ {2}X-Frame-Options: ALLOWALL$/m);
});
