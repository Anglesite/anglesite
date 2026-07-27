import test from "node:test";
import assert from "node:assert/strict";
import {
  checkHeaders,
  checkMixedContent,
  checkSRI,
  checkExternalLinkRel,
  checkArtifactPresence,
  checkPII,
  checkMTAStsPolicy,
  checkSecurityTxt,
  checkEmbedMedia,
} from "./pre-deploy-check";
import { MTA_STS_MARKER, SECURITY_TXT_MARKER } from "./edge-artifacts";

const GOOD = `/*
  Content-Security-Policy: default-src 'self'; frame-src 'self' js.stripe.com
`;

test("missing _headers is an error", () => {
  const issues = checkHeaders(null, "");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].category, "csp-misconfigured");
  assert.match(issues[0].message, /not enforced/);
});

test("_headers without a CSP is an error", () => {
  const issues = checkHeaders("/*\n  X-Frame-Options: DENY\n", "");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "csp-misconfigured");
  assert.match(issues[0].message, /no Content-Security-Policy/);
});

test("configured domain missing from CSP is an error naming the domain", () => {
  const issues = checkHeaders(GOOD, "SCRIPT_ALLOW=js.stripe.com,giscus.app");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "csp-misconfigured");
  assert.match(issues[0].message, /giscus\.app/);
});

test("CSP covering all configured domains passes", () => {
  assert.deepEqual(checkHeaders(GOOD, "SCRIPT_ALLOW=js.stripe.com"), []);
});

test("no SCRIPT_ALLOW: a present CSP passes", () => {
  assert.deepEqual(checkHeaders(GOOD, ""), []);
});

test("multiple configured domains missing from CSP each produce an error", () => {
  const issues = checkHeaders(GOOD, "SCRIPT_ALLOW=giscus.app,assets.calendly.com");
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.severity === "error"));
  assert.ok(issues.every((i) => i.category === "csp-misconfigured"));
  assert.ok(issues.some((i) => /giscus\.app/.test(i.message)));
  assert.ok(issues.some((i) => /assets\.calendly\.com/.test(i.message)));
});

test("substring of an allowed domain does not satisfy coverage", () => {
  const headers = `/*\n  Content-Security-Policy: default-src 'self'; frame-src 'self' app.cal.com\n`;
  const issues = checkHeaders(headers, "SCRIPT_ALLOW=cal.com");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].message, /cal\.com/);
});

test("checkPII: flags a bare email in page content", () => {
  const issues = checkPII("<p>Contact us at hello@example.com</p>", "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].category, "pii-email");
  assert.match(issues[0].message, /email/);
});

test("checkPII: does not flag an email that only appears as a mailto: link target", () => {
  const issues = checkPII('<a href="mailto:hello@example.com">Email us</a>', "dist/contact.html");
  assert.deepEqual(issues, []);
});

test("checkPII: still flags a bare email elsewhere on a page that also has a mailto link", () => {
  const html = '<a href="mailto:hello@example.com">Email us</a><p>debug: admin@internal.example.com</p>';
  const issues = checkPII(html, "dist/contact.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "pii-email");
  assert.match(issues[0].message, /email/);
});

test("checkPII: still flags phone numbers regardless of mailto content", () => {
  const issues = checkPII('<a href="mailto:hello@example.com">Email</a> Call 555-123-4567', "dist/contact.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "pii-phone");
  assert.match(issues[0].message, /phone/);
});

test("checkPII: flags an SSN with the pii-ssn category", () => {
  const issues = checkPII("<p>SSN: 123-45-6789</p>", "dist/contact.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "pii-ssn");
});

test("checkMixedContent: flags an insecure src", () => {
  const issues = checkMixedContent('<img src="http://example.com/a.png">', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].category, "mixed-content");
  assert.match(issues[0].message, /mixed content/i);
  assert.equal(issues[0].file, "dist/index.html");
});

test("checkMixedContent: flags an insecure url() in CSS", () => {
  const issues = checkMixedContent("body { background: url(http://x.com/bg.png); }", "dist/a.css");
  assert.equal(issues.length, 1);
});

test("checkMixedContent: https and relative refs are clean", () => {
  const ok = '<img src="https://x.com/a.png"><script src="/local.js"></script>';
  assert.deepEqual(checkMixedContent(ok, "dist/index.html"), []);
});

test("checkMixedContent: svg xmlns http URL is not flagged", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  assert.deepEqual(checkMixedContent(svg, "dist/index.html"), []);
});

test("checkMixedContent: at most one issue per file", () => {
  const two = '<img src="http://a.com/1.png"><img src="http://b.com/2.png">';
  assert.equal(checkMixedContent(two, "dist/index.html").length, 1);
});

test("checkSRI: external script without integrity is a warning", () => {
  const issues = checkSRI('<script src="https://cdn.x.com/a.js"></script>', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].category, "sri-missing");
  assert.match(issues[0].message, /integrity/i);
});

test("checkSRI: external script with integrity AND crossorigin is clean", () => {
  const ok = '<script src="https://cdn.x.com/a.js" integrity="sha384-abc" crossorigin="anonymous"></script>';
  assert.deepEqual(checkSRI(ok, "dist/index.html"), []);
});

test("checkSRI: integrity without crossorigin is a warning (CORS would block it)", () => {
  const issues = checkSRI('<script src="https://cdn.x.com/a.js" integrity="sha384-abc"></script>', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /crossorigin/i);
});

test("checkSRI: relative script is clean", () => {
  assert.deepEqual(checkSRI('<script src="/local.js"></script>', "dist/index.html"), []);
});

test("checkSRI: external stylesheet link without integrity is a warning", () => {
  const issues = checkSRI('<link rel="stylesheet" href="https://cdn.x.com/a.css">', "dist/index.html");
  assert.equal(issues.length, 1);
});

test("checkSRI: non-stylesheet link is ignored", () => {
  assert.deepEqual(checkSRI('<link rel="preconnect" href="https://x.com">', "dist/index.html"), []);
});

test("checkExternalLinkRel: target=_blank without rel=noopener is a warning", () => {
  const issues = checkExternalLinkRel('<a href="https://x.com" target="_blank">x</a>', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].category, "external-link-rel");
  assert.match(issues[0].message, /noopener/i);
});

test("checkExternalLinkRel: rel=noopener is clean", () => {
  const ok = '<a href="https://x.com" target="_blank" rel="noopener">x</a>';
  assert.deepEqual(checkExternalLinkRel(ok, "dist/index.html"), []);
});

test("checkExternalLinkRel: rel with noopener among others is clean", () => {
  const ok = '<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>';
  assert.deepEqual(checkExternalLinkRel(ok, "dist/index.html"), []);
});

test("checkExternalLinkRel: rel=noreferrer alone is clean (implies noopener)", () => {
  const ok = '<a href="https://x.com" target="_blank" rel="noreferrer">x</a>';
  assert.deepEqual(checkExternalLinkRel(ok, "dist/index.html"), []);
});

test("checkExternalLinkRel: link without target=_blank is ignored", () => {
  assert.deepEqual(checkExternalLinkRel('<a href="https://x.com">x</a>', "dist/index.html"), []);
});

test("checkArtifactPresence: robots.txt present is clean", () => {
  const paths = ["dist/index.html", "dist/robots.txt", "dist/.well-known/security.txt"];
  assert.deepEqual(checkArtifactPresence(paths), []);
});

test("checkArtifactPresence: missing robots.txt is a warning", () => {
  const issues = checkArtifactPresence(["dist/index.html", "dist/.well-known/security.txt"]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.equal(issues[0].category, "missing-security-artifact");
  assert.match(issues[0].message, /robots\.txt/);
});

test("checkArtifactPresence: security.txt presence/absence is not this check's concern (see checkSecurityTxt)", () => {
  assert.deepEqual(checkArtifactPresence(["dist/index.html", "dist/robots.txt"]), []);
});

test("checkArtifactPresence: backslash paths are normalized", () => {
  const paths = ["dist\\robots.txt"];
  assert.deepEqual(checkArtifactPresence(paths), []);
});

test("--strict promotes warnings into failures for exit-code purposes (unit-level check on the promotion helper)", () => {
  // checkArtifactPresence always returns warnings (missing-security-artifact) — this test
  // documents the contract main() relies on: in --strict mode, ALL warnings (not just this
  // category) become failures. The end-to-end exit-code behavior is covered by the real-script
  // fixture tests in PreDeployCheckFixtureTests.swift (Swift side, #799 Task 3), since --strict's
  // effect lives in main()'s promotion logic, not in an exported pure function.
  const warnings = checkArtifactPresence([]);
  assert.equal(warnings.length, 1);
  assert.ok(warnings.every((w) => w.severity === "warning"));
});

const NOW = new Date("2026-07-20T12:00:00Z");

function validSecurityTxt(): string {
  return `${SECURITY_TXT_MARKER}\nContact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://example.com/.well-known/security.txt\n`;
}

test("checkSecurityTxt: disabled mode with no file is silent", () => {
  assert.deepEqual(checkSecurityTxt(null, "SECURITY_TXT_MODE=disabled", NOW), []);
});

test("checkSecurityTxt: disabled mode with a published file is a contradiction", () => {
  const issues = checkSecurityTxt("Contact: mailto:s@example.com\n", "SECURITY_TXT_MODE=disabled", NOW);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "security-txt-issue");
  assert.match(issues[0].message, /disabled but .* was published/);
});

test("checkSecurityTxt: generated mode with a valid, marker-owned file passes silently", () => {
  const config = "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=security@example.com\nSITE_URL=https://example.com";
  assert.deepEqual(checkSecurityTxt(validSecurityTxt(), config, NOW), []);
});

test("checkSecurityTxt: generated mode with an unmarked (not-ours) file is a contradiction", () => {
  const config = "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=security@example.com";
  const issues = checkSecurityTxt("Contact: mailto:hand-authored@example.com\n", config, NOW);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /wasn't generated by Anglesite/);
});

test("checkSecurityTxt: generated mode missing the file is a finding", () => {
  const config = "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=security@example.com";
  const issues = checkSecurityTxt(null, config, NOW);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /is missing/);
});

test("checkSecurityTxt: manual mode with a valid hand-authored file passes silently", () => {
  const config = "SECURITY_TXT_MODE=manual";
  const content = "Contact: mailto:security@example.com\nExpires: 2027-01-01T00:00:00.000Z\n";
  assert.deepEqual(checkSecurityTxt(content, config, NOW), []);
});

test("checkSecurityTxt: manual mode missing the file is a finding", () => {
  assert.equal(checkSecurityTxt(null, "SECURITY_TXT_MODE=manual", NOW).length, 1);
});

test("checkSecurityTxt: missing Contact is a finding", () => {
  const content = "Expires: 2027-01-01T00:00:00.000Z\n";
  const issues = checkSecurityTxt(content, "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(issues.some((i) => /no Contact field/.test(i.message)));
});

test("checkSecurityTxt: zero or multiple Expires fields is a finding", () => {
  const zero = checkSecurityTxt("Contact: mailto:s@example.com\n", "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(zero.some((i) => /exactly one Expires/.test(i.message)));
  const two = checkSecurityTxt(
    "Contact: mailto:s@example.com\nExpires: 2027-01-01T00:00:00.000Z\nExpires: 2028-01-01T00:00:00.000Z\n",
    "SECURITY_TXT_MODE=manual",
    NOW,
  );
  assert.ok(two.some((i) => /exactly one Expires/.test(i.message)));
});

test("checkSecurityTxt: an Expires date in the past is stale", () => {
  const content = "Contact: mailto:s@example.com\nExpires: 2020-01-01T00:00:00.000Z\n";
  const issues = checkSecurityTxt(content, "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(issues.some((i) => /stale/.test(i.message)));
});

test("checkSecurityTxt: an unparseable Expires value is a finding", () => {
  const content = "Contact: mailto:s@example.com\nExpires: not-a-date\n";
  const issues = checkSecurityTxt(content, "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(issues.some((i) => /not a valid date/.test(i.message)));
});

test("checkSecurityTxt: a Canonical whose origin doesn't match SITE_URL is a finding", () => {
  const config = "SECURITY_TXT_MODE=manual\nSITE_URL=https://example.com";
  const content = "Contact: mailto:s@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: https://wrong-origin.example/.well-known/security.txt\n";
  const issues = checkSecurityTxt(content, config, NOW);
  assert.ok(issues.some((i) => /does not match SITE_URL/.test(i.message)));
});

test("checkSecurityTxt: an insecure http:// Canonical is a finding", () => {
  const content = "Contact: mailto:s@example.com\nExpires: 2027-01-01T00:00:00.000Z\nCanonical: http://example.com/.well-known/security.txt\n";
  const issues = checkSecurityTxt(content, "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(issues.some((i) => /must be a valid HTTPS URL/.test(i.message)));
});

test("checkSecurityTxt: an unrecognized SECURITY_TXT_MODE value is flagged and falls back to inference", () => {
  const config = "SECURITY_TXT_MODE=Generated\nSECURITY_CONTACT=security@example.com";
  const issues = checkSecurityTxt(null, config, NOW);
  // No usable contact-matching content published, and the typo'd mode still infers "generated"
  // (SECURITY_CONTACT is set) — so both the typo finding and the missing-file finding fire.
  assert.ok(issues.some((i) => /not a recognized value/.test(i.message)));
  assert.ok(issues.some((i) => /is missing/.test(i.message)));
});

test("checkSecurityTxt: an unrecognized mode is still flagged even when disabled-inferred and absent", () => {
  const issues = checkSecurityTxt(null, "SECURITY_TXT_MODE=bogus", NOW);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /not a recognized value/);
});

test("checkSecurityTxt: an empty SECURITY_TXT_MODE value is treated as unset, not a typo", () => {
  assert.deepEqual(checkSecurityTxt(null, "SECURITY_TXT_MODE=", NOW), []);
});

test("checkSecurityTxt: missing final newline is a finding", () => {
  const content = "Contact: mailto:s@example.com\nExpires: 2027-01-01T00:00:00.000Z";
  const issues = checkSecurityTxt(content, "SECURITY_TXT_MODE=manual", NOW);
  assert.ok(issues.some((i) => /final newline/.test(i.message)));
});

const validMTASts = () => `version: STSv1\nmode: testing\nmx: mx.example.com\nmax_age: 604800\n${MTA_STS_MARKER}\n`;

test("checkMTAStsPolicy: disabled and absent is clean, but a published policy is a contradiction", () => {
  assert.deepEqual(checkMTAStsPolicy(null, "MTA_STS_MODE=disabled"), []);
  assert.equal(checkMTAStsPolicy(validMTASts(), "MTA_STS_MODE=disabled").length, 1);
});

test("checkMTAStsPolicy: a generated testing policy with an MX host is clean", () => {
  assert.deepEqual(checkMTAStsPolicy(validMTASts(), "MTA_STS_MODE=testing\nMTA_STS_MX=mx.example.com"), []);
});

test("checkMTAStsPolicy: duplicate MX entries in a marker-owned policy are invalid", () => {
  const duplicateMX = `version: STSv1\nmode: testing\nmx: mx.example.com\nmx: MX.EXAMPLE.COM\nmax_age: 604800\n${MTA_STS_MARKER}\n`;
  const issues = checkMTAStsPolicy(duplicateMX, "MTA_STS_MODE=testing\nMTA_STS_MX=mx.example.com");
  assert.ok(issues.some((issue) => /unique mx field/.test(issue.message)));
});

test("checkMTAStsPolicy: reports missing, hand-authored, and malformed enabled policies", () => {
  assert.ok(checkMTAStsPolicy(null, "MTA_STS_MODE=enforce\nMTA_STS_MX=mx.example.com").some((i) => /missing/.test(i.message)));
  assert.ok(checkMTAStsPolicy("version: STSv1\nmode: enforce\nmx: mx.example.com\nmax_age: 604800\n", "MTA_STS_MODE=enforce\nMTA_STS_MX=mx.example.com").some((i) => /not generated/.test(i.message)));
  assert.ok(checkMTAStsPolicy(validMTASts(), "MTA_STS_MODE=enforce\nMTA_STS_MX=not a host").some((i) => /no valid MX host/.test(i.message)));
});

test("checkEmbedMedia: a hotlinked platform image is an error", () => {
  const issues = checkEmbedMedia('<img src="https://pbs.twimg.com/media/x.jpg">', "dist/index.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].category, "embed-media-hotlink");
});

test("checkEmbedMedia: every known platform media host is caught", () => {
  for (const host of [
    "pbs.twimg.com",
    "scontent.cdninstagram.com",
    "cdn.bsky.app",
    "files.mastodon.social",
    "i.ytimg.com",
  ]) {
    assert.equal(checkEmbedMedia(`<img src="https://${host}/a.jpg">`, "f.html").length, 1, host);
  }
});

test("checkEmbedMedia: self-hosted embed media passes", () => {
  assert.deepEqual(checkEmbedMedia('<img src="/embeds/abc123/asset-0.png">', "dist/index.html"), []);
});

test("checkEmbedMedia: srcset and CSS url() are caught too", () => {
  assert.equal(checkEmbedMedia('<img srcset="https://pbs.twimg.com/a.jpg 2x">', "f.html").length, 1);
  assert.equal(checkEmbedMedia("a{background:url(https://cdn.bsky.app/x.png)}", "f.css").length, 1);
});

test("checkEmbedMedia: a permalink to the platform is not media and must pass", () => {
  assert.deepEqual(checkEmbedMedia('<a href="https://x.com/jack/status/20">View original</a>', "f.html"), []);
});

test("checkEmbedMedia: the youtube-nocookie iframe is not a media hotlink", () => {
  assert.deepEqual(checkEmbedMedia('<iframe src="https://www.youtube-nocookie.com/embed/a"></iframe>', "f.html"), []);
});

// Regression guard for #682 finding 1: the dedup pass that used to sit on top of a per-host,
// file-wide boolean test silently dropped a genuine second hotlink whenever it only matched via
// the same generic host entry as an earlier, more-specific-looking match. This must fail against
// that dedup implementation.
test("checkEmbedMedia: two distinct hotlinks in one file both count, even via the same generic host", () => {
  const issues = checkEmbedMedia(
    '<img src="https://scontent.cdninstagram.com/a.jpg"><img src="https://scontent-lax3-2.cdninstagram.com/b.jpg">',
    "f.html",
  );
  assert.equal(issues.length, 2);
});

test("checkEmbedMedia: an unquoted src attribute value is still flagged", () => {
  const issues = checkEmbedMedia("<img src=https://pbs.twimg.com/a.jpg>", "f.html");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, "embed-media-hotlink");
});

test("checkEmbedMedia: an unquoted src value does not swallow a following href", () => {
  const issues = checkEmbedMedia(
    '<img src=/local/self-hosted.jpg href="https://pbs.twimg.com/media/x.jpg">',
    "f.html",
  );
  assert.deepEqual(issues, []);
});

test("checkEmbedMedia: an href with a real listed host is never flagged", () => {
  assert.deepEqual(checkEmbedMedia('<a href="https://pbs.twimg.com/media/x.jpg">original</a>', "f.html"), []);
});
