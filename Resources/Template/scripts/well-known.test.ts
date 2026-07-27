import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MANIFEST_ENV_VAR,
  MAX_FILE_SIZE_BYTES,
  RESULT_PATH_ENV_VAR,
  claimsCovering,
  classifyStaticPaths,
  mergeSeamResult,
  parseClaimManifest,
  readSeamResult,
  runCheck,
  runVerify,
  scanWellKnown,
  type ClaimEntry,
} from "./well-known";
import { MTA_STS_MARKER, SECURITY_TXT_MARKER } from "./edge-artifacts";

/** A scratch site directory, removed by the caller's `t.after`. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "anglesite-well-known-"));
}

function writeFile(root: string, relPath: string, contents: string): void {
  const full = resolve(root, relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf-8");
}

function entry(overrides: Partial<ClaimEntry> & Pick<ClaimEntry, "path">): ClaimEntry {
  return {
    id: overrides.id ?? overrides.path,
    path: overrides.path,
    match: overrides.match ?? "exact",
    owner: overrides.owner ?? "user-static",
    delivery: overrides.delivery ?? "userStatic",
  };
}

// --- parseClaimManifest ---

test("parseClaimManifest: reads the manifest Swift encodes", () => {
  const json = JSON.stringify({
    entries: [
      { id: "user-static:security.txt", path: "security.txt", match: "exact", owner: "user-static", delivery: "userStatic" },
      { id: "webfinger:webfinger", path: "webfinger", match: "exact", owner: "webfinger", delivery: "dynamic" },
    ],
  });
  const entries = parseClaimManifest(json);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1], {
    id: "webfinger:webfinger",
    path: "webfinger",
    match: "exact",
    owner: "webfinger",
    delivery: "dynamic",
  });
});

test("parseClaimManifest: malformed JSON degrades to no entries instead of throwing", () => {
  assert.deepEqual(parseClaimManifest("not json"), []);
  assert.deepEqual(parseClaimManifest(""), []);
  assert.deepEqual(parseClaimManifest("[1,2,3]"), []);
  assert.deepEqual(parseClaimManifest('{"entries":"nope"}'), []);
});

test("parseClaimManifest: an entry with no delivery defaults to the non-blocking class", () => {
  const entries = parseClaimManifest('{"entries":[{"id":"a","path":"a","match":"exact","owner":"o"}]}');
  assert.equal(entries[0].delivery, "userStatic");
});

test("parseClaimManifest: skips entries missing required fields", () => {
  const entries = parseClaimManifest('{"entries":[{"path":"a"},{"owner":"o"},{"path":"b","owner":"o"}]}');
  assert.deepEqual(entries.map((e) => e.path), ["b"]);
});

// --- scanWellKnown ---

test("scanWellKnown: a missing directory yields nothing and no findings", () => {
  const { paths, findings } = scanWellKnown(join(tmpdir(), "anglesite-does-not-exist-well-known"));
  assert.deepEqual(paths, []);
  assert.deepEqual(findings, []);
});

test("scanWellKnown: lists nested files with POSIX-relative paths, sorted", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "security.txt", "Contact: mailto:x@example.com\n");
  writeFile(root, "acme-challenge/token-b", "b");
  writeFile(root, "acme-challenge/token-a", "a");

  const { paths, findings } = scanWellKnown(root);
  assert.deepEqual(paths, ["acme-challenge/token-a", "acme-challenge/token-b", "security.txt"]);
  assert.deepEqual(findings, []);
});

test("scanWellKnown: excludes a symlink and reports it", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "real.txt", "ok");
  symlinkSync(resolve(root, "real.txt"), resolve(root, "link.txt"));

  const { paths, findings } = scanWellKnown(root);
  assert.deepEqual(paths, ["real.txt"]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "link.txt");
  assert.match(findings[0].message, /symlink/);
});

test("scanWellKnown: excludes a percent-encoded-looking filename", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "%2e%2e", "traversal-ish");

  const { paths, findings } = scanWellKnown(root);
  assert.deepEqual(paths, []);
  assert.match(findings[0].message, /percent-encoded/);
});

test("scanWellKnown: excludes a file over the size cap", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "huge.json", "x".repeat(MAX_FILE_SIZE_BYTES + 1));
  writeFile(root, "small.json", "{}");

  const { paths, findings } = scanWellKnown(root);
  assert.deepEqual(paths, ["small.json"]);
  assert.match(findings[0].message, new RegExp(String(MAX_FILE_SIZE_BYTES)));
});

// --- claimsCovering / classifyStaticPaths ---

test("claimsCovering: an exact claim matches only its own path", () => {
  const entries = [entry({ path: "security.txt" })];
  assert.equal(claimsCovering(entries, "security.txt").length, 1);
  assert.equal(claimsCovering(entries, "security.txt.bak").length, 0);
});

test("claimsCovering: a prefix claim matches its children but not the bare prefix path", () => {
  const entries = [entry({ path: "acme-challenge", match: "prefix" })];
  assert.equal(claimsCovering(entries, "acme-challenge/token").length, 1);
  assert.equal(claimsCovering(entries, "acme-challenge").length, 0);
  assert.equal(claimsCovering(entries, "acme-challenges/token").length, 0);
});

test("classifyStaticPaths: a static file shadowing a dynamic route blocks and names both owners", () => {
  const entries = [entry({ path: "webfinger", owner: "webfinger", delivery: "dynamic" })];
  const { blocking, advisory } = classifyStaticPaths(entries, ["webfinger"]);
  assert.deepEqual(advisory, []);
  assert.equal(blocking.length, 1);
  assert.match(blocking[0].message, /static file in the site source/);
  assert.match(blocking[0].message, /webfinger \(dynamic\)/);
});

test("classifyStaticPaths: a static file inside a runtime-owned prefix blocks", () => {
  const entries = [
    entry({ path: "acme-challenge", match: "prefix", owner: "cloudflare-managed-tls", delivery: "externalRuntime" }),
  ];
  const { blocking } = classifyStaticPaths(entries, ["acme-challenge/token"]);
  assert.equal(blocking.length, 1);
  assert.match(blocking[0].message, /cloudflare-managed-tls \(externalRuntime\)/);
});

test("classifyStaticPaths: user-static and generated claims never block", () => {
  const entries = [
    entry({ path: "humans.txt" }),
    entry({ path: "security.txt", owner: "generator:security-txt", delivery: "generated" }),
  ];
  const { blocking, advisory } = classifyStaticPaths(entries, ["humans.txt", "security.txt"]);
  assert.deepEqual(blocking, []);
  assert.deepEqual(advisory, []);
});

test("classifyStaticPaths: an unclaimed static file is advisory, not blocking", () => {
  const { blocking, advisory } = classifyStaticPaths([], ["surprise.json"]);
  assert.deepEqual(blocking, []);
  assert.equal(advisory.length, 1);
  assert.match(advisory[0].message, /no matching inventory claim/);
});

// --- result-file I/O ---

test("readSeamResult: a missing or malformed file degrades to an empty result", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readSeamResult(join(root, "nope.json")), { observedArtifacts: [], generatedArtifacts: [], findings: [] });
  writeFile(root, "bad.json", "{{{");
  assert.deepEqual(readSeamResult(join(root, "bad.json")), { observedArtifacts: [], generatedArtifacts: [], findings: [] });
});

test("mergeSeamResult: keeps earlier findings and de-duplicates artifacts", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "result.json");

  mergeSeamResult(path, { findings: [{ path: "a", message: "first" }] });
  const merged = mergeSeamResult(path, {
    observedArtifacts: ["b", "a", "a"],
    findings: [{ message: "second" }],
  });

  assert.deepEqual(merged.observedArtifacts, ["a", "b"]);
  assert.deepEqual(merged.findings.map((f) => f.message), ["first", "second"]);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf-8")), merged);
});

// --- runCheck / runVerify ---

test("runCheck: no manifest env var means no seam — succeeds and writes nothing", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "public/.well-known/webfinger", "static");

  assert.equal(runCheck(root, {}), 0);
});

test("runCheck: blocks with exit 1 when a static file shadows a dynamic claim", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "public/.well-known/webfinger", "static shadow");
  writeFile(
    root,
    "manifest.json",
    JSON.stringify({ entries: [{ id: "w", path: "webfinger", match: "exact", owner: "webfinger", delivery: "dynamic" }] }),
  );
  const resultPath = join(root, "result.json");

  const code = runCheck(root, {
    [MANIFEST_ENV_VAR]: join(root, "manifest.json"),
    [RESULT_PATH_ENV_VAR]: resultPath,
  });

  assert.equal(code, 1);
  const result = readSeamResult(resultPath);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /collides with/);
});

test("runCheck: passes when every static file has a compatible claim", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "public/.well-known/security.txt", "Contact: mailto:x@example.com\n");
  writeFile(
    root,
    "manifest.json",
    JSON.stringify({
      entries: [{ id: "s", path: "security.txt", match: "exact", owner: "user-static", delivery: "userStatic" }],
    }),
  );
  const resultPath = join(root, "result.json");

  assert.equal(runCheck(root, { [MANIFEST_ENV_VAR]: join(root, "manifest.json"), [RESULT_PATH_ENV_VAR]: resultPath }), 0);
  assert.deepEqual(readSeamResult(resultPath).findings, []);
});

test("runVerify: records the exact dist/.well-known artifacts the build produced", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "dist/.well-known/security.txt", "Contact: mailto:x@example.com\n");
  writeFile(root, "dist/.well-known/nested/thing.json", "{}");
  writeFile(root, "manifest.json", JSON.stringify({ entries: [] }));
  const resultPath = join(root, "result.json");

  assert.equal(runVerify(root, { [MANIFEST_ENV_VAR]: join(root, "manifest.json"), [RESULT_PATH_ENV_VAR]: resultPath }), 0);
  assert.deepEqual(readSeamResult(resultPath).observedArtifacts, ["nested/thing.json", "security.txt"]);
});

test("runVerify: preserves the findings runCheck already recorded", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "public/.well-known/surprise.json", "{}");
  writeFile(root, "dist/.well-known/surprise.json", "{}");
  writeFile(root, "manifest.json", JSON.stringify({ entries: [] }));
  const env = { [MANIFEST_ENV_VAR]: join(root, "manifest.json"), [RESULT_PATH_ENV_VAR]: join(root, "result.json") };

  assert.equal(runCheck(root, env), 0);
  assert.equal(runVerify(root, env), 0);

  const result = readSeamResult(join(root, "result.json"));
  assert.deepEqual(result.observedArtifacts, ["surprise.json"]);
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].message, /no matching inventory claim/);
});

test("runVerify: reports a marker-owned artifact separately so the host doesn't read it as unclaimed", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "dist/.well-known/security.txt", `${SECURITY_TXT_MARKER}\nContact: mailto:x@example.com\n`);
  writeFile(root, "dist/.well-known/mta-sts.txt", `version: STSv1\n${MTA_STS_MARKER}\n`);
  writeFile(root, "dist/.well-known/hand-written.txt", "not generated\n");
  writeFile(root, "manifest.json", JSON.stringify({ entries: [] }));
  const resultPath = join(root, "result.json");

  runVerify(root, { [MANIFEST_ENV_VAR]: join(root, "manifest.json"), [RESULT_PATH_ENV_VAR]: resultPath });

  const result = readSeamResult(resultPath);
  assert.deepEqual(result.observedArtifacts, ["hand-written.txt", "mta-sts.txt", "security.txt"]);
  assert.deepEqual(result.generatedArtifacts, ["mta-sts.txt", "security.txt"]);
});

test("runCheck: a blocking collision writes only the collisions, not unrelated advisories", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "public/.well-known/webfinger", "static shadow");
  writeFile(root, "public/.well-known/unclaimed.json", "{}");
  writeFile(
    root,
    "manifest.json",
    JSON.stringify({ entries: [{ id: "w", path: "webfinger", match: "exact", owner: "webfinger", delivery: "dynamic" }] }),
  );
  const resultPath = join(root, "result.json");

  assert.equal(runCheck(root, { [MANIFEST_ENV_VAR]: join(root, "manifest.json"), [RESULT_PATH_ENV_VAR]: resultPath }), 1);
  const findings = readSeamResult(resultPath).findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "webfinger");
});

test("runVerify: no seam configured means no result file is written", (t) => {
  const root = scratch();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "dist/.well-known/security.txt", "x");

  assert.equal(runVerify(root, {}), 0);
  assert.deepEqual(readSeamResult(join(root, "result.json")), { observedArtifacts: [], generatedArtifacts: [], findings: [] });
});
