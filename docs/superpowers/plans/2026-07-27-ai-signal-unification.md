# AI Signal Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `robots.txt`'s `Content-Signal` directive and its AI-crawler blocklist derived projections of one `usage` block in `licensing.json`, so they can no longer contradict each other or the content license.

**Architecture:** A site-wide `usage` block joins phase 1's `default`/`collections` in `Source/src/data/licensing.json`. Both writers — `licensing.ts` in the template and a new `LicensingStore` in Swift — apply the same clamp: the blocklist toggle survives only when both AI purposes are denied. `edge-artifacts.ts` reads that document instead of two `.site-config` keys, and the Website Settings "Crawlers" facet becomes "Licensing", absorbing the crawler controls alongside a license editor.

**Tech Stack:** TypeScript (`node:test` via `tsx`), Swift 6.4 / SwiftUI 27, Swift Testing, XcodeGen.

**Spec:** [`docs/superpowers/specs/2026-07-27-ai-signal-unification-design.md`](../specs/2026-07-27-ai-signal-unification-design.md)
**Issue:** [#991](https://github.com/Anglesite/Anglesite-app/issues/991)

## Global Constraints

- **Read `CONTRIBUTING.md` in this worktree before the first commit.** Its commit and PR rules govern every task here.
- **Conventional commits, subject ≤72 characters.** Reference `(#991)` in the subject.
- **No new dependencies.** Apple frameworks and the existing template toolchain only.
- **`Anglesite.xcodeproj` is generated.** Run `xcodegen generate` in this worktree before the first `xcodebuild`. New files under `Sources/AnglesiteApp` and `Sources/AnglesiteCore` are picked up by directory glob — `project.yml` needs no edit.
- **`ANGLESITE_SIDECAR_SRC`** must point at the real sidecar checkout (`…/github.com/Anglesite/anglesite`) for container-image scripts to work from a worktree.
- **Clean break, no migration.** `BLOCK_AI` and `CONTENT_SIGNALS` are deleted outright. Do not add a fallback read.
- **Never assert a license on the user's behalf.** The scaffolded default stays `null` (all rights reserved). Only CC0, CC BY, and CC BY-SA are classified as permitting AI use; NC, ND, custom, and none are deliberately unclassified.
- **`swift test` runs serialized.** Two concurrent full-suite runs in this repo cause spurious FoundationModels failures — do not run one while another agent's is in flight.
- **Template test command:** from `Resources/Template/`, `npx tsx --test <file>`.

---

### Task 1: `AIUsage` model and `normalizeUsage`

The pure model layer. `licensing.ts` learns the `usage` block and its clamp; it stays ignorant of `robots.txt`.

**Files:**
- Modify: `Resources/Template/src/lib/licensing.ts`
- Test: `Resources/Template/src/lib/licensing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type UsagePermission = "yes" | "no" | "unset"`; `interface AIUsage { search: UsagePermission; aiInput: UsagePermission; aiTrain: UsagePermission; blockAICrawlers: boolean }`; `const NO_USAGE: AIUsage`; `function normalizeUsage(raw: unknown): AIUsage`; `function mayBlockAICrawlers(usage: Pick<AIUsage, "aiInput" | "aiTrain">): boolean`; and `LicensingPolicy` gains a required `usage: AIUsage` field.

- [ ] **Step 1: Write the failing tests**

Append to `Resources/Template/src/lib/licensing.test.ts`, and add `NO_USAGE`, `mayBlockAICrawlers`, `normalizeUsage` to the existing import block from `./licensing.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd Resources/Template && npx tsx --test src/lib/licensing.test.ts
```

Expected: FAIL — `normalizeUsage`, `NO_USAGE`, and `mayBlockAICrawlers` are not exported from `./licensing.ts`.

- [ ] **Step 3: Implement the model**

In `Resources/Template/src/lib/licensing.ts`, add after the `LicenseRef` interface:

```ts
/**
 * A per-purpose AI usage permission. `"unset"` means the site states no preference — it is the
 * absence of a key in `licensing.json`, never a value written into it, matching how
 * `edge-artifacts.ts` omits an unstated `Content-Signal` sub-directive rather than emitting
 * `key=unset`.
 */
export type UsagePermission = "yes" | "no" | "unset";

/**
 * Site-wide AI usage permissions (#991). Two `robots.txt` projections derive from this and only
 * this: the `Content-Signal` directive and the named-agent blocklist. Keeping them derived is what
 * makes "permits AI training but Disallows GPTBot" unrepresentable rather than merely discouraged.
 *
 * Usage is deliberately site-wide, not per-collection: `robots.txt` addresses the whole origin, so
 * a per-collection permission would have nothing to project onto until RSL's `<content url>`
 * patterns land in phase 3.
 */
export interface AIUsage {
  search: UsagePermission;
  aiInput: UsagePermission;
  aiTrain: UsagePermission;
  /** Refuse the named AI agents outright in `robots.txt`. See `mayBlockAICrawlers`. */
  blockAICrawlers: boolean;
}

export const NO_USAGE: AIUsage = {
  search: "unset",
  aiInput: "unset",
  aiTrain: "unset",
  blockAICrawlers: false,
};

/**
 * Whether the blocklist is allowed to fire. Blocking is *stronger* than signalling, not
 * contradictory — a site may coherently ask crawlers not to train without also refusing them at
 * `robots.txt`. The one rule that must hold is that the blocklist never exceeds what the
 * permissions deny, and the 17-agent list covers both AI answers and AI training, so both must be
 * denied before it can be emitted.
 */
export function mayBlockAICrawlers(usage: Pick<AIUsage, "aiInput" | "aiTrain">): boolean {
  return usage.aiInput === "no" && usage.aiTrain === "no";
}

function toPermission(raw: unknown): UsagePermission {
  return raw === "yes" || raw === "no" ? raw : "unset";
}

/**
 * Parse a hand-edited `usage` block defensively, on the same terms as `normalizePolicy`:
 * unrecognized keys and values become "unset" rather than passing through. The cross-field clamp
 * is applied here so both writers — this module and the app's `LicensingStore` — reject the same
 * documents, and a hand-editor cannot produce a policy the UI could not have produced.
 */
export function normalizeUsage(raw: unknown): AIUsage {
  if (!raw || typeof raw !== "object") return { ...NO_USAGE };
  const { search, aiInput, aiTrain, blockAICrawlers } = raw as Record<string, unknown>;
  const usage: AIUsage = {
    search: toPermission(search),
    aiInput: toPermission(aiInput),
    aiTrain: toPermission(aiTrain),
    blockAICrawlers: false,
  };
  usage.blockAICrawlers = blockAICrawlers === true && mayBlockAICrawlers(usage);
  return usage;
}
```

Add the field to the `LicensingPolicy` interface, after `collections`:

```ts
  /** Site-wide AI usage permissions. See `AIUsage`. */
  usage: AIUsage;
```

And in `normalizePolicy`, change the initial policy literal and read the block:

```ts
  const policy: LicensingPolicy = { default: null, collections: {}, usage: { ...NO_USAGE } };
  if (!raw || typeof raw !== "object") return policy;

  const { default: rawDefault, collections: rawCollections, usage: rawUsage } = raw as {
    default?: unknown;
    collections?: unknown;
    usage?: unknown;
  };

  policy.default = toLicenseRef(rawDefault);
  policy.usage = normalizeUsage(rawUsage);
```

- [ ] **Step 4: Update the existing fixtures for the new required field**

`usage` is required, so the pre-existing literals and `deepEqual` expectations in
`Resources/Template/src/lib/licensing.test.ts` no longer type-check or match. Add `usage: NO_USAGE`
to each — the `LicensingPolicy` literals at lines 17, 23, 30, 35, and 40, and the expected objects
at lines 44, 52, 147, and 148. For example line 44 becomes:

```ts
  assert.deepEqual(normalizePolicy(undefined), { default: null, collections: {}, usage: NO_USAGE });
```

and line 17 becomes:

```ts
  const policy: LicensingPolicy = { default: CC_BY, collections: {}, usage: NO_USAGE };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd Resources/Template && npx tsx --test src/lib/licensing.test.ts src/lib/licensing.build.test.ts
```

Expected: PASS, no failures. `licensing.build.test.ts` writes `{ default: null, collections: {} }`
as a fixture document (line 201) — that still normalizes correctly, since `usage` is optional in
the *document*, only required in the parsed type.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/src/lib/licensing.ts Resources/Template/src/lib/licensing.test.ts
git commit -m "feat(#991): add AI usage permissions to the licensing model"
```

---

### Task 2: Derive `robots.txt` from the policy

`edge-artifacts.ts` stops reading `.site-config` for crawler intent and projects from `licensing.json` instead. The two retired keys leave the scaffold, and the template README documents the replacement.

**Files:**
- Modify: `Resources/Template/scripts/edge-artifacts.ts`
- Modify: `Resources/Template/scripts/scaffold.sh:67-71`
- Modify: `Resources/Template/README.md:10-33`
- Test: `Resources/Template/scripts/edge-artifacts.test.ts`

**Interfaces:**
- Consumes: `AIUsage`, `NO_USAGE`, `normalizePolicy` from Task 1.
- Produces: `function contentSignalDirective(usage: AIUsage): string | undefined`; `function readLicensingUsage(cwd: string): { usage: AIUsage; clamped: boolean }`; `buildRobotsTxt(usage?: AIUsage, siteUrl?: string): string` (signature changed — `blockAI: boolean` and `contentSignal?: string` are gone). `normalizeContentSignal` is deleted.

- [ ] **Step 1: Write the failing tests**

In `Resources/Template/scripts/edge-artifacts.test.ts`, remove `normalizeContentSignal` from the
import list, add `contentSignalDirective` and `readLicensingUsage`, and add an import of the model:

```ts
import { NO_USAGE, type AIUsage } from "../src/lib/licensing.ts";
```

Delete every existing `normalizeContentSignal` test and rewrite the `buildRobotsTxt` tests that
passed `blockAI`/`contentSignal` positionally. The replacements:

```ts
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

test("contentSignalDirective: one pair per stated purpose, undefined when none are stated", () => {
  assert.equal(contentSignalDirective(NO_USAGE), undefined);
  assert.equal(
    contentSignalDirective({ search: "no", aiInput: "yes", aiTrain: "no", blockAICrawlers: false }),
    "search=no, ai-input=yes, ai-train=no",
  );
});
```

And for the document reader — it needs a temp directory, so add `mkdtempSync`, `mkdirSync`, and
`writeFileSync` to the `node:fs` import and `tmpdir` from `node:os`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts
```

Expected: FAIL — `contentSignalDirective` and `readLicensingUsage` are not exported.

- [ ] **Step 3: Rewrite the generator**

In `Resources/Template/scripts/edge-artifacts.ts`, add the import beneath the `readConfig` import:

```ts
import { normalizePolicy, NO_USAGE, type AIUsage } from "../src/lib/licensing.ts";
```

Delete `normalizeContentSignal` entirely and put these in its place:

```ts
/**
 * Renders the `Content-Signal` directive value from the policy's usage block, or undefined when
 * the site states no preference for any purpose — in which case the directive is omitted rather
 * than emitted empty. Order is fixed (search, ai-input, ai-train) so the output is stable across
 * builds; unstated purposes are skipped, never written as `key=unset`.
 */
export function contentSignalDirective(usage: AIUsage): string | undefined {
  const pairs: string[] = [];
  if (usage.search !== "unset") pairs.push(`search=${usage.search}`);
  if (usage.aiInput !== "unset") pairs.push(`ai-input=${usage.aiInput}`);
  if (usage.aiTrain !== "unset") pairs.push(`ai-train=${usage.aiTrain}`);
  return pairs.length > 0 ? pairs.join(", ") : undefined;
}

/**
 * Loads the site's AI usage permissions from `src/data/licensing.json` (#991 — they used to be the
 * `BLOCK_AI`/`CONTENT_SIGNALS` `.site-config` keys). An absent or malformed document yields
 * `NO_USAGE`, matching phase 1's rule that a site with no policy asserts nothing.
 *
 * `clamped` reports that the document asked for the blocklist but did not deny both AI purposes,
 * so `normalizeUsage` refused it. `main()` logs that, since `normalizeUsage` is a pure value
 * function with nowhere to put a note.
 */
export function readLicensingUsage(cwd: string): { usage: AIUsage; clamped: boolean } {
  const path = resolve(cwd, "src/data/licensing.json");
  if (!existsSync(path)) return { usage: NO_USAGE, clamped: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    console.log("src/data/licensing.json is not valid JSON — no AI usage policy applied to robots.txt.");
    return { usage: NO_USAGE, clamped: false };
  }
  const usage = normalizePolicy(raw).usage;
  const requested = (raw as { usage?: { blockAICrawlers?: unknown } })?.usage?.blockAICrawlers === true;
  return { usage, clamped: requested && !usage.blockAICrawlers };
}
```

Replace `buildRobotsTxt` with:

```ts
/**
 * robots.txt body. Allows all crawlers by default. `usage` is the site's AI usage permissions from
 * `src/data/licensing.json`; its `Content-Signal` directive and its named-agent blocklist are both
 * derived from it, so they cannot disagree (#991). `siteUrl` adds the `Sitemap:` discovery line
 * (#982), emitted only for a valid HTTPS origin on the same terms as security.txt's `Canonical`.
 */
export function buildRobotsTxt(usage: AIUsage = NO_USAGE, siteUrl?: string): string {
  let body = `# robots.txt — generated by scripts/edge-artifacts.ts
User-agent: *
Disallow:
`;
  const contentSignal = contentSignalDirective(usage);
  if (contentSignal) {
    // No leading blank line: under the classic (non-Google) robots.txt grouping
    // convention a blank line ends the current record, which would strand this
    // directive outside the `User-agent: *` group it's meant to apply to.
    body += `# Content Signals — usage preferences for crawlers that honor this directive
# https://blog.cloudflare.com/content-signals-policy/
Content-Signal: ${contentSignal}
`;
  }
  if (usage.blockAICrawlers) {
    body += `\n# AI crawler / training bot directives (usage.blockAICrawlers in src/data/licensing.json)\n`;
    for (const bot of aiCrawlers) {
      body += `\nUser-agent: ${bot}\nDisallow: /\n`;
    }
  }
  const origin = httpsOrigin(siteUrl);
  if (origin) {
    // Leading blank line, unlike Content-Signal above: Sitemap is a non-group field, so it must
    // end whichever record precedes it rather than read as a directive belonging to that group.
    body += `\nSitemap: ${origin}/sitemap.xml\n`;
  }
  return body;
}
```

And in `main()`, replace the first four statements:

```ts
  const { usage, clamped } = readLicensingUsage(process.cwd());
  if (clamped) {
    console.log(
      "src/data/licensing.json sets usage.blockAICrawlers but does not deny both aiInput and aiTrain — ignoring it, because blocking the AI crawler list would refuse uses the policy still permits.",
    );
  }
  writeFileSync(
    resolve(publicDir, "robots.txt"),
    buildRobotsTxt(usage, readConfig("SITE_URL")),
    "utf-8",
  );
  console.log("Wrote public/robots.txt");
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts
```

Expected: PASS. The `committed public/robots.txt is byte-identical to buildRobotsTxt()` test must
still pass unchanged — a default `NO_USAGE` produces exactly the allow-all body already committed.

- [ ] **Step 5: Retire the two config keys from the scaffold**

In `Resources/Template/scripts/scaffold.sh`, delete these five lines from the `printf` list
(lines 67-71), leaving the `SCRIPT_ALLOW` line as the last entry before the redirect:

```sh
    "# BLOCK_AI=true                        — block AI training crawlers via robots.txt (off by default;" \
    "#                                        trades away AI-search discoverability)" \
    "# CONTENT_SIGNALS=search=yes,ai-input=no,ai-train=no — Content-Signal directive in robots.txt" \
    "#                                        (Cloudflare Content Signals Policy; keys: search," \
    "#                                        ai-input, ai-train; values: yes/no)" \
```

- [ ] **Step 6: Document `usage` in the template README**

In `Resources/Template/README.md`, extend the "Content licensing" section. Replace the JSON example
(lines 15-23) with one that includes the block, and append the bullets after line 28:

````markdown
```json
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": {
    "photos": { "url": "https://creativecommons.org/licenses/by-nc/4.0/", "name": "CC BY-NC 4.0" },
    "notes": null
  },
  "usage": { "search": "yes", "aiInput": "no", "aiTrain": "no", "blockAICrawlers": true }
}
```
````

```markdown
The `usage` block states, site-wide, what AI systems may do with your content. Each of `search`,
`aiInput`, and `aiTrain` is `"yes"` or `"no"`; omit a key to state no preference. `robots.txt`
derives both of its crawler signals from this block and nothing else:

- The `Content-Signal` directive gets one `key=value` pair per stated purpose.
- `"blockAICrawlers": true` adds `Disallow: /` records for 17 named AI agents. It only takes effect
  when `aiInput` and `aiTrain` are **both** `"no"` — blocking a crawler while permitting the use it
  performs would be self-contradictory, so the build ignores it and says so.
```

- [ ] **Step 7: Verify the whole template suite**

```bash
cd Resources/Template && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Resources/Template/scripts/edge-artifacts.ts Resources/Template/scripts/edge-artifacts.test.ts \
        Resources/Template/scripts/scaffold.sh Resources/Template/README.md
git commit -m "feat(#991): derive robots.txt crawler signals from licensing.json"
```

---

### Task 3: `LicensingStore`

The Swift half of the same document. Its Codable layer preserves the absent-key vs explicit-null distinction that `resolveLicense` depends on, and applies the same clamp as `normalizeUsage`.

**Files:**
- Create: `Sources/AnglesiteCore/LicensingStore.swift`
- Test: `Tests/AnglesiteCoreTests/LicensingStoreTests.swift`

**Interfaces:**
- Consumes: nothing from earlier tasks (it mirrors Task 1's rules in Swift; the two are kept in agreement by their tests, not by shared code).
- Produces: `struct LicenseRef: Sendable, Equatable, Hashable, Codable { var url: String; var name: String }` with `static func isSafeLicenseURL(_ url: String) -> Bool`; `enum UsagePermission: String, Sendable, CaseIterable, Identifiable { case unset, yes, no }`; `struct AIUsage: Sendable, Equatable` with `search`/`aiInput`/`aiTrain`/`blockAICrawlers`, `var mayBlockAICrawlers: Bool`, `var clamped: AIUsage`; `enum LicensableCollection: String, Sendable, CaseIterable, Identifiable` with `var assertsNothingByDefault: Bool`; `enum CollectionLicenseRule: Sendable, Equatable, Hashable { case inherit, assertNothing, license(LicenseRef) }`; `struct LicensingPolicy: Sendable, Equatable, Codable` with `defaultLicense`/`collections`/`usage`; `struct LicensingStore: Sendable` with `init(sourceDirectory:fileManager:)`, `load() throws -> LicensingPolicy`, `save(_:) throws`, and `enum ValidationError: Error, Equatable { case unsafeLicenseURL(String) }`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/LicensingStoreTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("LicensingStore (#991)")
struct LicensingStoreTests {
    private func makeDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("LicensingStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func write(_ json: String, to directory: URL) throws {
        let dataDir = directory.appendingPathComponent("src/data", isDirectory: true)
        try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try json.write(to: dataDir.appendingPathComponent("licensing.json"), atomically: true, encoding: .utf8)
    }

    private let ccBY = LicenseRef(url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")

    @Test("load() returns an empty policy when the file is absent")
    func loadAbsent() throws {
        let dir = try makeDirectory()
        #expect(try LicensingStore(sourceDirectory: dir).load() == LicensingPolicy())
    }

    @Test("load() distinguishes an absent collection key from an explicit null")
    func loadAbsentVersusNull() throws {
        let dir = try makeDirectory()
        try write(#"{"default":null,"collections":{"notes":null}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections[.notes] == .assertNothing)
        #expect(policy.collections[.articles] == nil)
        #expect(policy.rule(for: .articles) == .inherit)
    }

    @Test("save() then load() round-trips every rule kind and the usage block")
    func roundTrip() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.defaultLicense = ccBY
        policy.collections[.notes] = .assertNothing
        policy.collections[.photos] = .license(ccBY)
        policy.usage = AIUsage(search: .yes, aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        try LicensingStore(sourceDirectory: dir).save(policy)
        #expect(try LicensingStore(sourceDirectory: dir).load() == policy)
    }

    @Test("save() omits unset purposes so the JSON never carries key=unset")
    func saveOmitsUnset() throws {
        let dir = try makeDirectory()
        try LicensingStore(sourceDirectory: dir).save(LicensingPolicy())
        let json = try String(
            contentsOf: dir.appendingPathComponent("src/data/licensing.json"), encoding: .utf8)
        #expect(!json.contains("unset"))
    }

    @Test("the clamp survives a hand-edited document that permits AI but asks to block")
    func loadClamps() throws {
        let dir = try makeDirectory()
        try write(#"{"usage":{"aiInput":"yes","aiTrain":"no","blockAICrawlers":true}}"#, to: dir)
        #expect(try LicensingStore(sourceDirectory: dir).load().usage.blockAICrawlers == false)
    }

    @Test("save() clamps rather than writing a contradictory document")
    func saveClamps() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.usage = AIUsage(search: .unset, aiInput: .unset, aiTrain: .no, blockAICrawlers: true)
        try LicensingStore(sourceDirectory: dir).save(policy)
        #expect(try LicensingStore(sourceDirectory: dir).load().usage.blockAICrawlers == false)
    }

    @Test("load() throws on a malformed document rather than silently discarding it")
    func loadMalformed() throws {
        let dir = try makeDirectory()
        try write("{ not json", to: dir)
        #expect(throws: (any Error).self) { try LicensingStore(sourceDirectory: dir).load() }
    }

    @Test("an unrecognized collection key is dropped")
    func loadDropsUnknownCollection() throws {
        let dir = try makeDirectory()
        try write(#"{"collections":{"bogus":null,"likes":null}}"#, to: dir)
        let policy = try LicensingStore(sourceDirectory: dir).load()
        #expect(policy.collections.count == 1)
        #expect(policy.collections[.likes] == .assertNothing)
    }

    @Test("save() rejects a license URL the template would refuse to render")
    func saveRejectsUnsafeURL() throws {
        let dir = try makeDirectory()
        var policy = LicensingPolicy()
        policy.defaultLicense = LicenseRef(url: "javascript:alert(1)", name: "Evil")
        #expect(throws: LicensingStore.ValidationError.unsafeLicenseURL("javascript:alert(1)")) {
            try LicensingStore(sourceDirectory: dir).save(policy)
        }
    }

    @Test("isSafeLicenseURL matches licensing.ts's hasSafeLicenseScheme")
    func schemeGuard() {
        #expect(LicenseRef.isSafeLicenseURL("https://example.com/l"))
        #expect(LicenseRef.isSafeLicenseURL("http://example.com/l"))
        #expect(LicenseRef.isSafeLicenseURL("/license/"))
        #expect(!LicenseRef.isSafeLicenseURL("//evil.example/x"))
        #expect(!LicenseRef.isSafeLicenseURL("license.html"))
        #expect(!LicenseRef.isSafeLicenseURL("javascript:alert(1)"))
        #expect(!LicenseRef.isSafeLicenseURL("JavaScript:alert(1)"))
        #expect(!LicenseRef.isSafeLicenseURL("data:text/html,x"))
        #expect(!LicenseRef.isSafeLicenseURL(""))
    }

    @Test("mayBlockAICrawlers requires both AI purposes denied")
    func mayBlock() {
        #expect(AIUsage(search: .unset, aiInput: .no, aiTrain: .no, blockAICrawlers: false).mayBlockAICrawlers)
        #expect(!AIUsage(search: .no, aiInput: .no, aiTrain: .unset, blockAICrawlers: false).mayBlockAICrawlers)
        #expect(!AIUsage(search: .no, aiInput: .yes, aiTrain: .no, blockAICrawlers: false).mayBlockAICrawlers)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter LicensingStoreTests
```

Expected: FAIL to compile — no such type `LicensingStore`.

- [ ] **Step 3: Implement the store**

Create `Sources/AnglesiteCore/LicensingStore.swift`:

```swift
import Foundation

/// A license the site can point at: a canonical URL plus a human-readable label. Mirrors
/// `LicenseRef` in `Resources/Template/src/lib/licensing.ts`.
public struct LicenseRef: Sendable, Equatable, Hashable, Codable {
    public var url: String
    public var name: String

    public init(url: String, name: String) {
        self.url = url
        self.name = name
    }

    /// Whether `url` is safe to emit unguarded into `href`/`rel="license"`. A Swift mirror of
    /// `hasSafeLicenseScheme` in `licensing.ts`: allow-list `http`/`https` so an unanticipated
    /// scheme is rejected by default, and additionally accept a root-relative path for a
    /// site-local license page. A protocol-relative URL is rejected because it hands an
    /// attacker-chosen host to `href`; a bare relative path is rejected because its resolution
    /// depends on which page renders it.
    ///
    /// The template checks this too, at read time. This copy exists because the app is now a
    /// *writer* of `licensing.json`, and a write path that can store a `javascript:` URL is a
    /// worse failure than one that renders it — the file outlives the session that wrote it.
    public static func isSafeLicenseURL(_ url: String) -> Bool {
        if url.hasPrefix("/") && !url.hasPrefix("//") { return true }
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
}

/// A per-purpose AI usage permission. `unset` means the site states no preference; it is never
/// written to `licensing.json`, matching `UsagePermission` in `licensing.ts`.
public enum UsagePermission: String, Sendable, Equatable, CaseIterable, Identifiable {
    case unset
    case yes
    case no
    public var id: Self { self }
}

/// Site-wide AI usage permissions (#991). `robots.txt`'s `Content-Signal` directive and its
/// named-agent blocklist are both derived from this by `scripts/edge-artifacts.ts`, so they cannot
/// disagree with each other.
public struct AIUsage: Sendable, Equatable {
    public var search: UsagePermission
    public var aiInput: UsagePermission
    public var aiTrain: UsagePermission
    public var blockAICrawlers: Bool

    public init(
        search: UsagePermission = .unset,
        aiInput: UsagePermission = .unset,
        aiTrain: UsagePermission = .unset,
        blockAICrawlers: Bool = false
    ) {
        self.search = search
        self.aiInput = aiInput
        self.aiTrain = aiTrain
        self.blockAICrawlers = blockAICrawlers
    }

    /// Whether the blocklist may fire. Blocking is stronger than signalling, not contradictory, so
    /// the only rule is that it never exceed what the permissions deny — and the 17-agent list
    /// covers both AI answers and AI training. Mirrors `mayBlockAICrawlers` in `licensing.ts`.
    public var mayBlockAICrawlers: Bool { aiInput == .no && aiTrain == .no }

    /// This policy with an unpermitted blocklist turned off. Applied on both load and save so
    /// neither a hand-edited document nor a UI race can persist a contradiction.
    public var clamped: AIUsage {
        var copy = self
        copy.blockAICrawlers = blockAICrawlers && mayBlockAICrawlers
        return copy
    }
}

extension AIUsage: Codable {
    private enum CodingKeys: String, CodingKey {
        case search, aiInput, aiTrain, blockAICrawlers
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func permission(_ key: CodingKeys) -> UsagePermission {
            // decodeIfPresent(String:) rather than the enum: an unrecognized value must degrade to
            // `unset` the way normalizeUsage drops it, not fail the whole document.
            let raw = (try? container.decodeIfPresent(String.self, forKey: key)) ?? nil
            return UsagePermission(rawValue: raw ?? "") ?? .unset
        }
        self.init(
            search: permission(.search),
            aiInput: permission(.aiInput),
            aiTrain: permission(.aiTrain),
            blockAICrawlers: ((try? container.decodeIfPresent(Bool.self, forKey: .blockAICrawlers)) ?? nil) ?? false
        )
        self = clamped
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let usage = clamped
        if usage.search != .unset { try container.encode(usage.search.rawValue, forKey: .search) }
        if usage.aiInput != .unset { try container.encode(usage.aiInput.rawValue, forKey: .aiInput) }
        if usage.aiTrain != .unset { try container.encode(usage.aiTrain.rawValue, forKey: .aiTrain) }
        try container.encode(usage.blockAICrawlers, forKey: .blockAICrawlers)
    }
}

/// Every collection that can carry a license — the routed collections plus `blog`. Mirrors
/// `LicensableCollection` in `licensing.ts`; the order here is the order the settings facet lists.
public enum LicensableCollection: String, Sendable, Equatable, CaseIterable, Identifiable, Codable {
    case notes, articles, photos, albums, bookmarks, replies, likes, announcements, events, reviews, blog
    public var id: Self { self }

    /// Collections whose entries are responses to, or quotations of, third-party work. A site
    /// owner cannot license someone else's article by bookmarking it, so these assert nothing
    /// unless explicitly overridden. Mirrors `NON_ASSERTING_COLLECTIONS` in `licensing.ts`.
    public var assertsNothingByDefault: Bool {
        switch self {
        case .bookmarks, .replies, .likes, .reviews: true
        default: false
        }
    }
}

/// What one collection does about licensing. The three cases are exactly the three states
/// `licensing.json` can express, and the distinction is load-bearing: `inherit` (the key is
/// absent) falls through to the site default or the non-asserting rule, while `assertNothing`
/// (an explicit `null`) beats both.
public enum CollectionLicenseRule: Sendable, Equatable, Hashable {
    case inherit
    case assertNothing
    case license(LicenseRef)
}

/// The whole content licensing policy: `Source/src/data/licensing.json`.
public struct LicensingPolicy: Sendable, Equatable {
    /// Site-wide default, or nil for "assert nothing" (all rights reserved — the legal default).
    public var defaultLicense: LicenseRef?
    /// Only non-`inherit` rules are stored; an absent key *is* `inherit`.
    public var collections: [LicensableCollection: CollectionLicenseRule]
    public var usage: AIUsage

    public init(
        defaultLicense: LicenseRef? = nil,
        collections: [LicensableCollection: CollectionLicenseRule] = [:],
        usage: AIUsage = AIUsage()
    ) {
        self.defaultLicense = defaultLicense
        self.collections = collections
        self.usage = usage
    }

    public func rule(for collection: LicensableCollection) -> CollectionLicenseRule {
        collections[collection] ?? .inherit
    }

    public mutating func setRule(_ rule: CollectionLicenseRule, for collection: LicensableCollection) {
        if rule == .inherit {
            collections.removeValue(forKey: collection)
        } else {
            collections[collection] = rule
        }
    }
}

extension LicensingPolicy: Codable {
    private enum CodingKeys: String, CodingKey {
        case `default`, collections, usage
    }

    /// `collections` is a free-form object whose values are either null or a license, so it needs
    /// dynamic keys. `JSONDecoder`'s dictionary support would collapse the null case into an
    /// absent key, losing the distinction `rule(for:)` depends on.
    private struct CollectionKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaultLicense = try container.decodeIfPresent(LicenseRef.self, forKey: .default)
        let usage = try container.decodeIfPresent(AIUsage.self, forKey: .usage) ?? AIUsage()
        var collections: [LicensableCollection: CollectionLicenseRule] = [:]
        if container.contains(.collections) {
            let sub = try container.nestedContainer(keyedBy: CollectionKey.self, forKey: .collections)
            for key in sub.allKeys {
                // Unrecognized collection keys are dropped rather than passed through, matching
                // normalizePolicy's treatment of a typo'd key.
                guard let collection = LicensableCollection(rawValue: key.stringValue) else { continue }
                if try sub.decodeNil(forKey: key) {
                    collections[collection] = .assertNothing
                } else if let ref = try? sub.decode(LicenseRef.self, forKey: key) {
                    collections[collection] = .license(ref)
                }
            }
        }
        self.init(defaultLicense: defaultLicense, collections: collections, usage: usage.clamped)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Always written, including as an explicit null: `"default": null` is the scaffolded value
        // and says "all rights reserved" out loud rather than by omission.
        try container.encode(defaultLicense, forKey: .default)
        try container.encode(usage.clamped, forKey: .usage)
        var sub = container.nestedContainer(keyedBy: CollectionKey.self, forKey: .collections)
        // Sorted so a save produces a stable diff in the site's git repo.
        for collection in LicensableCollection.allCases {
            guard let key = CollectionKey(stringValue: collection.rawValue) else { continue }
            switch collections[collection] {
            case .none, .inherit: continue
            case .assertNothing: try sub.encodeNil(forKey: key)
            case .license(let ref): try sub.encode(ref, forKey: key)
            }
        }
    }
}

/// Reads/writes `Source/src/data/licensing.json` — the git-tracked content licensing policy the
/// template's `licensing.ts` and `edge-artifacts.ts` consume at build time. Rooted at
/// `sourceDirectory` (the `Source/` git repo), not `Config/`, on the same reasoning as
/// `RedirectsStore`: the policy is site content and travels with the repo.
public struct LicensingStore: Sendable {
    public enum ValidationError: Error, Equatable {
        /// A URL the template's own scheme guard would reject at render time. Refusing it here
        /// keeps it out of the file entirely.
        case unsafeLicenseURL(String)
    }

    public static let relativePath = "src/data/licensing.json"

    private let fileURL: URL
    private let fileManager: FileManager

    public init(sourceDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = sourceDirectory.appendingPathComponent(Self.relativePath)
        self.fileManager = fileManager
    }

    /// An empty policy (not a throw) when the file is absent — the normal state of a site
    /// scaffolded before it had one.
    public func load() throws -> LicensingPolicy {
        guard fileManager.fileExists(atPath: fileURL.path) else { return LicensingPolicy() }
        return try JSONDecoder().decode(LicensingPolicy.self, from: try Data(contentsOf: fileURL))
    }

    public func save(_ policy: LicensingPolicy) throws {
        try Self.validate(policy)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(policy)
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
    }

    public static func validate(_ policy: LicensingPolicy) throws {
        var refs: [LicenseRef] = []
        if let defaultLicense = policy.defaultLicense { refs.append(defaultLicense) }
        for rule in policy.collections.values {
            if case .license(let ref) = rule { refs.append(ref) }
        }
        for ref in refs where !LicenseRef.isSafeLicenseURL(ref.url) {
            throw ValidationError.unsafeLicenseURL(ref.url)
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
swift test --package-path . --filter LicensingStoreTests
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/LicensingStore.swift Tests/AnglesiteCoreTests/LicensingStoreTests.swift
git commit -m "feat(#991): add LicensingStore for the app's write path"
```

---

### Task 4: `LicenseCatalog`

The curated license list and the two rules that relate a license to the AI permissions. Pure, portable, and deliberately narrow: it classifies only the licenses whose grant is unambiguous.

**Files:**
- Create: `Sources/AnglesiteCore/LicenseCatalog.swift`
- Test: `Tests/AnglesiteCoreTests/LicenseCatalogTests.swift`

**Interfaces:**
- Consumes: `LicenseRef`, `AIUsage`, `UsagePermission` from Task 3.
- Produces: `enum LicenseCatalog` with `struct Entry: Sendable, Equatable, Hashable, Identifiable { let id: String; let name: String; let url: String; let permitsAIUse: Bool; var ref: LicenseRef }`, `static let entries: [Entry]`, `static func entry(for: LicenseRef?) -> Entry?`, `static func prefilled(_ usage: AIUsage, for license: LicenseRef?) -> AIUsage`, `static func coherenceWarning(for license: LicenseRef?, usage: AIUsage) -> LicenseCatalog.CoherenceWarning?`, and the nested `enum LicenseCatalog.CoherenceWarning: Sendable, Equatable { case licensePermitsDeniedUse(licenseName: String) }`.

**Deviation from the spec:** the spec put the scheme guard on `LicenseCatalog`. It ships on
`LicenseRef` in Task 3 instead, because `LicensingStore.save` needs it and validating a value is
the value type's own business. `LicenseCatalog` just calls it.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteCoreTests/LicenseCatalogTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("LicenseCatalog (#991)")
struct LicenseCatalogTests {
    private var ccBY: LicenseRef { LicenseCatalog.entries.first { $0.id == "cc-by-4.0" }!.ref }
    private var ccBYNC: LicenseRef { LicenseCatalog.entries.first { $0.id == "cc-by-nc-4.0" }!.ref }
    private let custom = LicenseRef(url: "https://example.com/terms", name: "House terms")

    @Test("every catalog entry has a safe URL and a unique id")
    func entriesWellFormed() {
        #expect(LicenseCatalog.entries.count == 7)
        #expect(Set(LicenseCatalog.entries.map(\.id)).count == LicenseCatalog.entries.count)
        for entry in LicenseCatalog.entries {
            #expect(LicenseRef.isSafeLicenseURL(entry.url), "\(entry.id) has an unsafe URL")
        }
    }

    @Test("only CC0, CC BY, and CC BY-SA are classified as permitting AI use")
    func classification() {
        let permitting = Set(LicenseCatalog.entries.filter(\.permitsAIUse).map(\.id))
        #expect(permitting == ["cc0-1.0", "cc-by-4.0", "cc-by-sa-4.0"])
    }

    @Test("entry(for:) matches by URL and returns nil for a custom or absent license")
    func entryLookup() {
        #expect(LicenseCatalog.entry(for: ccBY)?.id == "cc-by-4.0")
        #expect(LicenseCatalog.entry(for: custom) == nil)
        #expect(LicenseCatalog.entry(for: nil) == nil)
    }

    @Test("prefilled fills only unspecified purposes for a permitting license")
    func prefillFillsUnspecified() {
        let out = LicenseCatalog.prefilled(AIUsage(), for: ccBY)
        #expect(out == AIUsage(search: .yes, aiInput: .yes, aiTrain: .yes, blockAICrawlers: false))
    }

    @Test("prefilled never overwrites a purpose the user already set")
    func prefillPreservesChoices() {
        let existing = AIUsage(search: .unset, aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        let out = LicenseCatalog.prefilled(existing, for: ccBY)
        #expect(out.search == .yes)
        #expect(out.aiInput == .no)
        #expect(out.aiTrain == .no)
        #expect(out.blockAICrawlers == true)
    }

    @Test("prefilled leaves usage untouched for an unclassified or absent license")
    func prefillSkipsUnclassified() {
        #expect(LicenseCatalog.prefilled(AIUsage(), for: ccBYNC) == AIUsage())
        #expect(LicenseCatalog.prefilled(AIUsage(), for: custom) == AIUsage())
        #expect(LicenseCatalog.prefilled(AIUsage(), for: nil) == AIUsage())
    }

    @Test("coherenceWarning fires when a permitting license is paired with a denial")
    func warningFires() {
        let denyTrain = AIUsage(aiTrain: .no)
        #expect(
            LicenseCatalog.coherenceWarning(for: ccBY, usage: denyTrain)
                == .licensePermitsDeniedUse(licenseName: "CC BY 4.0"))
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(aiInput: .no)) != nil)
    }

    @Test("coherenceWarning stays silent for permitted use, denied search, or an unclassified license")
    func warningSilent() {
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(aiInput: .yes, aiTrain: .yes)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: ccBY, usage: AIUsage(search: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: ccBYNC, usage: AIUsage(aiTrain: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: custom, usage: AIUsage(aiTrain: .no)) == nil)
        #expect(LicenseCatalog.coherenceWarning(for: nil, usage: AIUsage(aiTrain: .no)) == nil)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter LicenseCatalogTests
```

Expected: FAIL to compile — no such type `LicenseCatalog`.

- [ ] **Step 3: Implement the catalog**

Create `Sources/AnglesiteCore/LicenseCatalog.swift`:

```swift
import Foundation

/// The licenses the Content Licensing facet offers, and the two rules relating a chosen license to
/// the site's AI usage permissions (#991).
///
/// The classification is deliberately narrow. Whether model training is a "derivative work" or a
/// "commercial use" is a live legal question, so only licenses whose grant unambiguously covers
/// any use are marked `permitsAIUse`; NC and ND variants, custom URLs, and all-rights-reserved are
/// left unclassified rather than interpreted. That follows the spike's rule that Anglesite never
/// asserts on the user's behalf — see
/// docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md §Q3.
public enum LicenseCatalog {
    public struct Entry: Sendable, Equatable, Hashable, Identifiable {
        /// Stable across releases — it is the SwiftUI picker tag, not display text.
        public let id: String
        public let name: String
        public let url: String
        /// True when the license's grant unambiguously covers AI training and AI answers.
        public let permitsAIUse: Bool

        public var ref: LicenseRef { LicenseRef(url: url, name: name) }
    }

    public static let entries: [Entry] = [
        Entry(id: "cc0-1.0", name: "CC0 1.0",
              url: "https://creativecommons.org/publicdomain/zero/1.0/", permitsAIUse: true),
        Entry(id: "cc-by-4.0", name: "CC BY 4.0",
              url: "https://creativecommons.org/licenses/by/4.0/", permitsAIUse: true),
        Entry(id: "cc-by-sa-4.0", name: "CC BY-SA 4.0",
              url: "https://creativecommons.org/licenses/by-sa/4.0/", permitsAIUse: true),
        Entry(id: "cc-by-nc-4.0", name: "CC BY-NC 4.0",
              url: "https://creativecommons.org/licenses/by-nc/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nd-4.0", name: "CC BY-ND 4.0",
              url: "https://creativecommons.org/licenses/by-nd/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nc-sa-4.0", name: "CC BY-NC-SA 4.0",
              url: "https://creativecommons.org/licenses/by-nc-sa/4.0/", permitsAIUse: false),
        Entry(id: "cc-by-nc-nd-4.0", name: "CC BY-NC-ND 4.0",
              url: "https://creativecommons.org/licenses/by-nc-nd/4.0/", permitsAIUse: false),
    ]

    /// The catalog entry a stored license refers to, matched on URL — a hand-edited `name` should
    /// not stop the picker recognizing a standard license. nil means custom or none.
    public static func entry(for license: LicenseRef?) -> Entry? {
        guard let license else { return nil }
        return entries.first { $0.url == license.url }
    }

    /// Suggests AI permissions consistent with a newly-chosen license, filling **only** purposes
    /// the user has not stated. Overwriting a stated purpose would silently discard a deliberate
    /// choice, so this never does; an unclassified license suggests nothing at all.
    public static func prefilled(_ usage: AIUsage, for license: LicenseRef?) -> AIUsage {
        guard entry(for: license)?.permitsAIUse == true else { return usage }
        var filled = usage
        if filled.search == .unset { filled.search = .yes }
        if filled.aiInput == .unset { filled.aiInput = .yes }
        if filled.aiTrain == .unset { filled.aiTrain = .yes }
        return filled
    }

    /// Why the facet should show an inline note, or nil when there is nothing to say. The typed
    /// case (rather than a `String`) keeps user-facing copy in the app module where Xcode's string
    /// extraction can reach it.
    public enum CoherenceWarning: Sendable, Equatable {
        /// The site default license already grants an AI use the policy asks crawlers not to make.
        case licensePermitsDeniedUse(licenseName: String)
    }

    /// Fires only for a classified license against a denied AI purpose — the one contradiction
    /// detectable without interpreting license text. Permitting *more* than a restrictive license
    /// requires is never flagged: it is the user's own content, and they may grant what they like.
    /// `search` is not an AI purpose and never triggers this.
    public static func coherenceWarning(for license: LicenseRef?, usage: AIUsage) -> CoherenceWarning? {
        guard let entry = entry(for: license), entry.permitsAIUse else { return nil }
        guard usage.aiInput == .no || usage.aiTrain == .no else { return nil }
        return .licensePermitsDeniedUse(licenseName: entry.name)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
swift test --package-path . --filter LicenseCatalogTests
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/LicenseCatalog.swift Tests/AnglesiteCoreTests/LicenseCatalogTests.swift
git commit -m "feat(#991): add the curated license catalog and coherence rules"
```

---

### Task 5: Swap the model facet

`PlistEditorModel` stops reading `.site-config` for crawler intent and owns a licensing policy instead. `CrawlerPolicyAsset` and its tests are deleted. The view still refers to the old properties after this task, so it is fixed in Task 6 — the app target does not build in between, which is why these two tasks are adjacent.

**Files:**
- Delete: `Sources/AnglesiteCore/CrawlerPolicyAsset.swift`
- Delete: `Tests/AnglesiteCoreTests/CrawlerPolicyAssetTests.swift`
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift`
- Modify: `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift:279`
- Modify: `Tests/AnglesiteAppTests/PlistEditorModelDirtyFacetsTests.swift`
- Rename + rewrite: `Tests/AnglesiteAppTests/PlistEditorModelCrawlerPolicyTests.swift` → `Tests/AnglesiteAppTests/PlistEditorModelLicensingTests.swift`

**Interfaces:**
- Consumes: `LicensingStore`, `LicensingPolicy`, `AIUsage`, `LicensableCollection`, `CollectionLicenseRule` from Task 3.
- Produces: on `PlistEditorModel` — `var licensingPolicy: LicensingPolicy`, `var savedLicensingPolicy: LicensingPolicy`, `var licensingError: String?`, `var isSavingLicensing: Bool`, `var licensingLoadFailed: Bool`, `var isLicensingDirty: Bool`, `func saveLicensing() async -> Bool`.

- [ ] **Step 1: Write the failing test**

Create `Tests/AnglesiteAppTests/PlistEditorModelLicensingTests.swift` (and delete
`PlistEditorModelCrawlerPolicyTests.swift`):

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel content licensing (#991)")
@MainActor
struct PlistEditorModelLicensingTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private let ccBY = LicenseRef(url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")

    /// Builds a `PlistEditorModel` against a fresh temp `sourceDirectory` with a minimal
    /// `Info.plist` and, when given, a `src/data/licensing.json`.
    private func makeModel(licensingJSON: String? = nil) throws -> PlistEditorModel {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelLicensingTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let plistURL = dir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let licensingJSON {
            let dataDir = dir.appendingPathComponent("src/data", isDirectory: true)
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try licensingJSON.write(
                to: dataDir.appendingPathComponent("licensing.json"), atomically: true, encoding: .utf8)
        }
        let file = FileRef(url: plistURL, group: .metadata, name: "Info.plist")
        return PlistEditorModel(file: file, websiteTitle: "Test Site", sourceDirectory: dir)
    }

    @Test("load() yields an empty policy when licensing.json is absent")
    func loadDefaultsWhenAbsent() async throws {
        let model = try makeModel()
        await model.load()
        #expect(model.licensingPolicy == LicensingPolicy())
        #expect(model.isLicensingDirty == false)
        #expect(model.licensingLoadFailed == false)
    }

    @Test("load() populates the policy from an existing licensing.json")
    func loadPopulates() async throws {
        let model = try makeModel(
            licensingJSON: #"{"default":{"url":"https://creativecommons.org/licenses/by/4.0/","name":"CC BY 4.0"},"collections":{"notes":null},"usage":{"search":"yes","aiTrain":"no"}}"#)
        await model.load()
        #expect(model.licensingPolicy.defaultLicense == ccBY)
        #expect(model.licensingPolicy.rule(for: .notes) == .assertNothing)
        #expect(model.licensingPolicy.rule(for: .photos) == .inherit)
        #expect(model.licensingPolicy.usage.search == .yes)
        #expect(model.licensingPolicy.usage.aiTrain == .no)
        #expect(model.isLicensingDirty == false)
    }

    @Test("isLicensingDirty flips true after an edit, false after save, and the write lands on disk")
    func dirtyTrackingAndSave() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = ccBY
        #expect(model.isLicensingDirty == true)

        let saved = await model.saveLicensing()

        #expect(saved == true)
        #expect(model.isLicensingDirty == false)
        let reloaded = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(reloaded.defaultLicense == ccBY)
    }

    @Test("permitting an AI purpose clears a blocklist toggle that is no longer allowed")
    func editingUsageClearsBlocklist() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.usage = AIUsage(aiInput: .no, aiTrain: .no, blockAICrawlers: true)
        #expect(model.licensingPolicy.usage.blockAICrawlers == true)

        model.licensingPolicy.usage.aiTrain = .yes

        #expect(model.licensingPolicy.usage.blockAICrawlers == false)
    }

    @Test("a malformed licensing.json blocks the save rather than overwriting it")
    func refusesToSaveOverUnreadableFile() async throws {
        let model = try makeModel(licensingJSON: "{ not json")
        await model.load()
        #expect(model.licensingLoadFailed == true)
        #expect(model.licensingError != nil)

        model.licensingPolicy.defaultLicense = ccBY
        let saved = await model.saveLicensing()

        #expect(saved == false)
        let onDisk = try String(
            contentsOf: model.sourceDirectory.appendingPathComponent("src/data/licensing.json"),
            encoding: .utf8)
        #expect(onDisk == "{ not json")
    }

    @Test("an unsafe license URL surfaces an error instead of being written")
    func rejectsUnsafeURL() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(url: "javascript:alert(1)", name: "Evil")

        let saved = await model.saveLicensing()

        #expect(saved == false)
        #expect(model.licensingError != nil)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
swift test --package-path . --filter PlistEditorModelLicensingTests
```

Expected: FAIL to compile — `licensingPolicy` is not a member of `PlistEditorModel`.

- [ ] **Step 3: Delete the retired asset**

```bash
git rm Sources/AnglesiteCore/CrawlerPolicyAsset.swift \
       Tests/AnglesiteCoreTests/CrawlerPolicyAssetTests.swift \
       Tests/AnglesiteAppTests/PlistEditorModelCrawlerPolicyTests.swift
```

- [ ] **Step 4: Swap the model's facet state**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, replace the four `crawlerPolicy` properties
(lines 40-43) with:

```swift
    var licensingPolicy = LicensingPolicy() {
        didSet {
            // The clamp lives here rather than in each picker's binding so there is exactly one
            // place a permit-and-block contradiction can be introduced, and it cannot survive.
            // Assigning inside `didSet` does not re-enter it.
            licensingPolicy.usage = licensingPolicy.usage.clamped
        }
    }
    private(set) var savedLicensingPolicy = LicensingPolicy()
    private(set) var licensingError: String?
    private(set) var isSavingLicensing = false
    private(set) var licensingLoadFailed = false
```

Replace the `isCrawlerPolicyDirty` computed property (line 115) with:

```swift
    var isLicensingDirty: Bool { licensingPolicy != savedLicensingPolicy && loadError == nil && !isLoading }
```

In `load()`, replace the `CrawlerPolicyAsset.parseSettings` block (lines 212-218) with:

```swift
            do {
                let policy = try LicensingStore(sourceDirectory: sourceDirectory).load()
                licensingPolicy = policy
                savedLicensingPolicy = policy
                licensingError = nil
                licensingLoadFailed = false
            } catch {
                licensingPolicy = LicensingPolicy()
                savedLicensingPolicy = LicensingPolicy()
                licensingError = "Couldn't load existing licensing.json — it may be corrupted or hand-edited. Fix it externally or your next save will discard it. (\(error.localizedDescription))"
                licensingLoadFailed = true
            }
```

In `saveAll()`, replace the `isCrawlerPolicyDirty` branch (lines 277-279):

```swift
        if isLicensingDirty {
            guard await saveLicensing() else { return false }
        }
```

Replace `saveCrawlerPolicy()` (lines 387-405) with:

```swift
    @discardableResult
    func saveLicensing() async -> Bool {
        guard isLicensingDirty else { return true }
        guard !isSavingLicensing else { return false }
        guard !licensingLoadFailed else {
            licensingError = "Refusing to save: the existing licensing.json failed to load and may contain rules this save would discard. Fix or back up the file, then reload this site's settings."
            return false
        }
        isSavingLicensing = true
        licensingError = nil
        defer { isSavingLicensing = false }
        let sourceDirectory = sourceDirectory
        let policy = licensingPolicy
        do {
            try await Task.detached(priority: .userInitiated) {
                try LicensingStore(sourceDirectory: sourceDirectory).save(policy)
            }.value
            savedLicensingPolicy = policy
            return true
        } catch LicensingStore.ValidationError.unsafeLicenseURL(let url) {
            licensingError = "\"\(url)\" isn't a usable license address. Use an https:// URL or a path on this site starting with /."
            return false
        } catch {
            licensingError = "Couldn't save content licensing: \(error.localizedDescription)"
            return false
        }
    }
```

And in `dirtyFacets` (line 916), replace the crawler-policy entry:

```swift
            DirtyFacet(isDirty: isLicensingDirty, isSaving: isSavingLicensing) { await self.saveLicensing() },
```

- [ ] **Step 5: Update the two collateral test files**

In `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`, delete line 279:

```swift
        XCTAssertTrue(cfg.contains("# BLOCK_AI=true"))
```

In `Tests/AnglesiteAppTests/PlistEditorModelDirtyFacetsTests.swift`, replace the two crawler-policy
tests (lines 107-130) with their licensing equivalents. Note that dirtying via
`usage.blockAICrawlers = true` would **not** work — the clamp turns it straight back off, since no
AI purpose is denied — so these dirty the facet through the license instead:

```swift
    @Test("hasAnyUnsavedEdits reflects content-licensing dirty state alone — the #991 facet added after this seam existed")
    func hasAnyUnsavedEditsReflectsLicensingAlone() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(
            url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")
        #expect(model.isDirty == false)
        #expect(model.isRedirectsDirty == false)
        #expect(model.isAnalyticsDirty == false)
        #expect(model.hasAnyUnsavedEdits == true)
    }

    @Test("saveAllDirty saves a dirty licensing policy into licensing.json")
    func saveAllDirtySavesLicensing() async throws {
        let model = try makeModel()
        await model.load()
        model.licensingPolicy.defaultLicense = LicenseRef(
            url: "https://creativecommons.org/licenses/by/4.0/", name: "CC BY 4.0")
        model.licensingPolicy.usage.aiTrain = .no

        await model.saveAllDirty()

        #expect(model.isLicensingDirty == false)
        let onDisk = try LicensingStore(sourceDirectory: model.sourceDirectory).load()
        #expect(onDisk == model.licensingPolicy)
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
swift test --package-path . --filter "PlistEditorModelLicensingTests|PlistEditorModelDirtyFacetsTests|SiteScaffolderTests"
```

Expected: PASS. `--filter` restricts what *runs*, not what compiles, so the whole package must
still build — `PlistEditorView.swift` will not, until Task 6. If the build fails only on
`crawlersTab`/`crawlerPolicySettings` in that file, proceed to Task 6 and run this command again
there.

- [ ] **Step 7: Commit**

```bash
git add -A Sources/AnglesiteApp/PlistEditorModel.swift Sources/AnglesiteCore Tests
git commit -m "feat(#991): replace the crawler-policy facet state with licensing"
```

---

### Task 6: The Content Licensing facet

The user-facing half: a new tab view, the renamed tab, the string catalog, and the spec's phase status.

**Files:**
- Create: `Sources/AnglesiteApp/ContentLicensingTab.swift`
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` (lines 13, 44-45, 121-125, 144-145, 363-403, 720-740)
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (generated — see step 6)
- Modify: `docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md:275-278`

**Interfaces:**
- Consumes: everything produced by Tasks 3, 4, and 5.
- Produces: `struct ContentLicensingTab: View { @Bindable var model: PlistEditorModel }`.

- [ ] **Step 1: Retire the old tab from `PlistEditorView`**

In `Sources/AnglesiteApp/PlistEditorView.swift`:

- Line 13: `case crawlers = "Crawlers"` → `case licensing = "Licensing"`
- Lines 44-45: `} else if oldValue == .crawlers {` → `} else if oldValue == .licensing {`, and
  `await model.saveCrawlerPolicy()` → `await model.saveLicensing()`
- Lines 121-125: `selectedTab != .crawlers, let crawlerPolicyError = model.crawlerPolicyError` →
  `selectedTab != .licensing, let licensingError = model.licensingError`, and the `Label` argument
  likewise
- Lines 144-145: `case .crawlers:` / `crawlersTab` → `case .licensing:` / `ContentLicensingTab(model: model)`
- Delete `crawlersTab` (lines 363-403) and `contentSignalRow` (around lines 720-740) — both move
  into the new file.

- [ ] **Step 2: Create the facet view**

Create `Sources/AnglesiteApp/ContentLicensingTab.swift`:

```swift
import SwiftUI
import AnglesiteCore

/// The Website Settings ▸ Licensing facet (#991). One surface for the whole content licensing
/// policy: the site default license, per-collection overrides, and the AI usage permissions that
/// `robots.txt`'s Content-Signal directive and crawler blocklist are both derived from.
///
/// It absorbed the former Crawlers facet rather than sitting beside it. Two independently-editable
/// controls over the same subject let a site say "you may train on this, if you attribute" and
/// "GPTBot: Disallow: /" at once; deriving both from one policy makes that unrepresentable.
struct ContentLicensingTab: View {
    @Bindable var model: PlistEditorModel

    /// A site default license choice. Tagged by catalog id rather than by `LicenseRef` so a
    /// hand-edited `name` still selects the right row.
    private enum LicenseChoice: Hashable {
        case allRightsReserved
        case catalog(String)
        case custom
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            siteDefaultSection
            Divider()
            perCollectionSection
            Divider()
            aiUsageSection
            if model.isSavingLicensing {
                ProgressView().controlSize(.small)
            }
        }
    }

    // MARK: Site default

    private var siteDefaultSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Site License")
                .font(.headline)
            Text("The license offered for your content. Anglesite never picks one for you — until you choose, your site says all rights reserved.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Picker("Site License", selection: defaultChoice) {
                Text("All rights reserved").tag(LicenseChoice.allRightsReserved)
                ForEach(LicenseCatalog.entries) { entry in
                    Text(entry.name).tag(LicenseChoice.catalog(entry.id))
                }
                Text("Custom…").tag(LicenseChoice.custom)
            }
            .labelsHidden()
            .frame(width: 240, alignment: .leading)

            if defaultChoice.wrappedValue == .custom {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow {
                        Text("Address").frame(minWidth: 100, alignment: .leading)
                        TextField("https://example.com/license", text: customURL)
                            .frame(minWidth: 280)
                    }
                    GridRow {
                        Text("Name").frame(minWidth: 100, alignment: .leading)
                        TextField("My license", text: customName)
                            .frame(minWidth: 280)
                    }
                }
            }

            if let error = model.licensingError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }
        }
    }

    private var defaultChoice: Binding<LicenseChoice> {
        Binding(
            get: {
                guard let ref = model.licensingPolicy.defaultLicense else { return .allRightsReserved }
                if let entry = LicenseCatalog.entry(for: ref) { return .catalog(entry.id) }
                return .custom
            },
            set: { choice in
                switch choice {
                case .allRightsReserved:
                    model.licensingPolicy.defaultLicense = nil
                case .catalog(let id):
                    guard let entry = LicenseCatalog.entries.first(where: { $0.id == id }) else { return }
                    model.licensingPolicy.defaultLicense = entry.ref
                    model.licensingPolicy.usage = LicenseCatalog.prefilled(
                        model.licensingPolicy.usage, for: entry.ref)
                case .custom:
                    // An empty ref keeps `entry(for:)` returning nil, so the picker stays on
                    // Custom while the fields are filled in. Save validates the URL.
                    model.licensingPolicy.defaultLicense = LicenseRef(url: "", name: "")
                }
            })
    }

    private var customURL: Binding<String> {
        Binding(
            get: { model.licensingPolicy.defaultLicense?.url ?? "" },
            set: { model.licensingPolicy.defaultLicense?.url = $0 })
    }

    private var customName: Binding<String> {
        Binding(
            get: { model.licensingPolicy.defaultLicense?.name ?? "" },
            set: { model.licensingPolicy.defaultLicense?.name = $0 })
    }

    // MARK: Per collection

    private var perCollectionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("By Content Type")
                .font(.headline)
            Text("Override the site license for one kind of content. Bookmarks, replies, likes, and reviews assert nothing by default — those entries are about someone else's work.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                ForEach(LicensableCollection.allCases) { collection in
                    GridRow {
                        Text(displayName(collection))
                            .frame(minWidth: 160, alignment: .leading)
                        Picker(displayName(collection), selection: rule(for: collection)) {
                            Text(collection.assertsNothingByDefault
                                 ? "Asserts nothing by default"
                                 : "Use site license")
                                .tag(CollectionLicenseRule.inherit)
                            Text("Assert nothing").tag(CollectionLicenseRule.assertNothing)
                            ForEach(LicenseCatalog.entries) { entry in
                                Text(entry.name).tag(CollectionLicenseRule.license(entry.ref))
                            }
                            // A hand-written override outside the catalog would otherwise have no
                            // matching tag and render as a blank selection — worse, picking any
                            // row would silently discard it.
                            if case .license(let ref) = model.licensingPolicy.rule(for: collection),
                               LicenseCatalog.entry(for: ref) == nil {
                                Text(ref.name).tag(CollectionLicenseRule.license(ref))
                            }
                        }
                        .labelsHidden()
                        .frame(width: 240, alignment: .leading)
                    }
                }
            }
        }
    }

    private func rule(for collection: LicensableCollection) -> Binding<CollectionLicenseRule> {
        Binding(
            get: { model.licensingPolicy.rule(for: collection) },
            set: { model.licensingPolicy.setRule($0, for: collection) })
    }

    private func displayName(_ collection: LicensableCollection) -> LocalizedStringKey {
        switch collection {
        case .notes: "Notes"
        case .articles: "Articles"
        case .photos: "Photos"
        case .albums: "Albums"
        case .bookmarks: "Bookmarks"
        case .replies: "Replies"
        case .likes: "Likes"
        case .announcements: "Announcements"
        case .events: "Events"
        case .reviews: "Reviews"
        case .blog: "Blog"
        }
    }

    // MARK: AI usage

    private var aiUsageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI and Crawlers")
                .font(.headline)
            Text("States a usage preference per purpose in robots.txt, using Cloudflare's Content Signals Policy. It's a signal well-behaved crawlers honor, not an enforced block.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                usageRow(
                    "Search",
                    help: "Show this content in traditional search results.",
                    value: $model.licensingPolicy.usage.search)
                usageRow(
                    "AI Answers",
                    help: "Let AI assistants use this content to answer a live question.",
                    value: $model.licensingPolicy.usage.aiInput)
                usageRow(
                    "AI Training",
                    help: "Let AI systems use this content to train models.",
                    value: $model.licensingPolicy.usage.aiTrain)
            }

            if let warning = LicenseCatalog.coherenceWarning(
                for: model.licensingPolicy.defaultLicense, usage: model.licensingPolicy.usage),
               case .licensePermitsDeniedUse(let licenseName) = warning {
                Label(
                    "\(licenseName) already permits this use. Crawlers reading both your license and these signals will see them disagree.",
                    systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Toggle(
                    "Refuse AI crawlers in robots.txt",
                    isOn: $model.licensingPolicy.usage.blockAICrawlers)
                    .toggleStyle(.switch)
                    .disabled(!model.licensingPolicy.usage.mayBlockAICrawlers)
                Text(model.licensingPolicy.usage.mayBlockAICrawlers
                     ? "Adds robots.txt rules refusing 17 known AI crawlers (GPTBot, ClaudeBot, and others). This reduces your site's visibility to AI assistants and AI-generated search summaries — it does not affect traditional search engines."
                     : "Available once both AI Answers and AI Training are set to Disallow. Refusing a crawler while still permitting what it does would contradict itself.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func usageRow(
        _ title: LocalizedStringKey,
        help: LocalizedStringKey,
        value: Binding<UsagePermission>
    ) -> some View {
        GridRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(help)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(minWidth: 260, alignment: .leading)
            Picker(title, selection: value) {
                Text("Unspecified").tag(UsagePermission.unset)
                Text("Allow").tag(UsagePermission.yes)
                Text("Disallow").tag(UsagePermission.no)
            }
            .labelsHidden()
            .frame(width: 140)
        }
    }
}
```

- [ ] **Step 3: Regenerate the Xcode project and build**

```bash
xcodegen generate && xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Expected: BUILD SUCCEEDED. If the "Check container resources" phase fails, rsync
`Resources/container-{image,kernel,initfs}` from the main checkout — those are gitignored and not
present in a fresh worktree.

- [ ] **Step 4: Run the full Swift suite**

```bash
swift test --package-path .
```

Expected: PASS. Do not start this while another agent is running `swift test` in this repo.

- [ ] **Step 5: Update the spike spec's phasing**

In `docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md`, mark phase 2 shipped by
replacing its list item (lines 275-277):

```markdown
2. **Unify the AI signals.** ✅ Shipped — `BLOCK_AI` and `CONTENT_SIGNALS` are folded into the
   policy's `usage` block as derived projections, and the crawler-policy facet is absorbed into
   Website Settings ▸ Licensing. See
   [the phase 2 design](2026-07-27-ai-signal-unification-design.md).
```

- [ ] **Step 6: Sync the string catalog**

New user-facing text was added, so per `CONTRIBUTING.md` the catalog merge must be run by hand — a
CLI `xcodebuild` never merges `.stringsdata` into `.xcstrings`:

```bash
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings --stringsdata $(find ~/Library/Developer/Xcode/DerivedData/Anglesite-*/Build/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64 -name "*.stringsdata") --skip-marking-strings-stale
```

Then review the diff with `git diff Sources/AnglesiteApp/Localizable.xcstrings`. It should **add**
the new licensing strings and remove the retired crawler ones. If it empties or mass-deletes the
catalog, discard the change and rerun after a clean build — never commit a mass deletion.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp docs/superpowers/specs/2026-07-26-really-simple-licensing-spike.md
git commit -m "feat(#991): add the Content Licensing settings facet"
```

- [ ] **Step 8: Final verification before the PR**

```bash
cd Resources/Template && npm test && cd - && swift test --package-path . && xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Expected: all three PASS. Then confirm nothing still references the retired keys:

```bash
grep -rn "BLOCK_AI\|CONTENT_SIGNALS\|CrawlerPolicyAsset" --include="*.swift" --include="*.ts" --include="*.sh" Sources Tests Resources/Template
```

Expected: no output. (`docs/` still mentions them historically, which is correct.)

- [ ] **Step 9: Open the PR**

Build the body from `.github/PULL_REQUEST_TEMPLATE.md`'s own headings — **Summary**, **Paired PR
check**, **Test plan**. Paired PR check: none needed; this touches no MCP message schema, and
template changes are app-only. Call out in Summary that this is a behavior change to shipped
settings: `BLOCK_AI` and `CONTENT_SIGNALS` are removed with no migration, so a site carrying them
reverts to allow-all until its owner sets a policy in the new facet. Then drop the in-progress
label:

```bash
gh issue edit 991 --remove-label "🛠️ In Progress"
```

---

## Notes for the implementer

- **The two clamps must agree.** `normalizeUsage` (TypeScript) and `AIUsage.clamped` (Swift) encode
  the same rule in two languages with no shared code. If you change one, change the other, and keep
  both test suites asserting the same cases.
- **`usage` is site-wide on purpose.** Do not add per-collection permissions; there is nothing to
  project them onto until RSL lands in phase 3.
- **Do not widen the license classification.** Only CC0, CC BY, and CC BY-SA are marked
  `permitsAIUse`. Marking NC or ND either way would have Anglesite answering a live legal question
  on the user's behalf.
