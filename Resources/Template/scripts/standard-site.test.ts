import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fnv1a,
  isStandardSitePublicationURI,
  standardSiteDocumentRkey,
  standardSiteDocumentURI,
  standardSitePublicationRkey,
  standardSitePublicationURI,
} from "./standard-site.ts";

// Cross-checked against Swift's `POSSEStableKey.make` (`Sources/AnglesiteCore/POSSEClients.swift`)
// in `Tests/AnglesiteCoreTests/StandardSitePublishTests.swift`'s "fnv1a fixture" test — the same
// four inputs/outputs appear literally in both files. If this port ever drifts from the Swift
// original, one suite starts failing while the fixture in the other stays put, which is the
// signal to compare them side by side.
test("fnv1a matches the Swift POSSEStableKey.make fixture", () => {
  assert.equal(fnv1a(""), "cbf29ce484222325");
  assert.equal(fnv1a("a"), "af63dc4c8601ec8c");
  assert.equal(fnv1a("11111111-2222-3333-4444-555555555555"), "5ff56bf05c1d58f9");
  assert.equal(fnv1a("11111111-2222-3333-4444-555555555555\n/blog/hello-world/"), "2da1b8cd0c953401");
});

test("publication and document rkeys are deterministic and diverge across site/path", () => {
  const rkeyA = standardSitePublicationRkey("site-1");
  const rkeyB = standardSitePublicationRkey("site-1");
  assert.equal(rkeyA, rkeyB);
  assert.equal(rkeyA, `anglesite-${fnv1a("site-1")}`);

  const docA = standardSiteDocumentRkey("site-1", "/notes/hello/");
  const docB = standardSiteDocumentRkey("site-1", "/notes/hello/");
  assert.equal(docA, docB);
  assert.notEqual(docA, standardSiteDocumentRkey("site-1", "/notes/other/"));
  assert.notEqual(docA, standardSiteDocumentRkey("site-2", "/notes/hello/"));
});

test("publication and document at-URIs are well-formed and rkey-consistent", () => {
  const did = "did:plc:owner";
  const publicationURI = standardSitePublicationURI(did, "site-1");
  assert.equal(publicationURI, `at://${did}/site.standard.publication/${standardSitePublicationRkey("site-1")}`);

  const documentURI = standardSiteDocumentURI(did, "site-1", "/notes/hello/");
  assert.equal(
    documentURI,
    `at://${did}/site.standard.document/${standardSiteDocumentRkey("site-1", "/notes/hello/")}`,
  );
});

test("isStandardSitePublicationURI recognizes the generated shape and rejects everything else", () => {
  assert.equal(isStandardSitePublicationURI("at://did:plc:owner/site.standard.publication/anglesite-abc123"), true);
  // Trailing newline (how the generator writes the file) still matches.
  assert.equal(isStandardSitePublicationURI("at://did:plc:owner/site.standard.publication/anglesite-abc123\n"), true);
  assert.equal(isStandardSitePublicationURI(null), false);
  assert.equal(isStandardSitePublicationURI(""), false);
  assert.equal(isStandardSitePublicationURI("hand-authored text"), false);
  // A document (not publication) at-URI must not be mistaken for the publication one.
  assert.equal(isStandardSitePublicationURI("at://did:plc:owner/site.standard.document/anglesite-abc123"), false);
});
