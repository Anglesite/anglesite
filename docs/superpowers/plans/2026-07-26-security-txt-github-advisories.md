# `security.txt` → GitHub advisories Implementation Plan (#843)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site whose `Source/` repo has a GitHub `origin` publish that repo's private advisory form as its `security.txt` contact, verified and offered from Website Settings.

**Architecture:** `SECURITY_CONTACT` becomes a comma-separated, preference-ordered list so the template's generator can emit multiple RFC 9116 `Contact:` lines. A new `SecurityReportingAsset` in `AnglesiteCore` owns those `.site-config` keys (the `MTAStsPolicyAsset` pattern), a pure `SecurityReportingReadiness` evaluator decides what to offer, and `HTTPGitHubClient` gains the repo-visibility and private-vulnerability-reporting (PVR) calls behind a protocol seam. A new Security Reports tab in `PlistEditorView` drives it, and a build-free `SecurityTxtAuditRunner` emits a non-blocking hint.

**Tech Stack:** Swift 6.4 / SwiftUI (macOS 27+), Swift Testing, TypeScript run under `npx tsx --test` (`node:test`), GitHub REST API `2022-11-28`.

**Spec:** [`docs/superpowers/specs/2026-07-26-security-txt-github-advisories-design.md`](../specs/2026-07-26-security-txt-github-advisories-design.md)

## Global Constraints

- **Read `CONTRIBUTING.md` in this worktree before making any repository change.** It is the source of truth for workflow, testing, and commit/PR format.
- **Worktree:** all work happens in this worktree, never the main checkout. Run `xcodegen generate` before any `xcodebuild` — `Anglesite.xcodeproj` is gitignored.
- **Apple frameworks only.** No new third-party dependencies. Plain SwiftUI + actors.
- **Conventional commits**, subject ≤ 72 characters, referencing `(#843)`.
- **`swift test --package-path .` must pass** after any change under `Resources/Template/` — some Swift suites string-match template output.
- **Never call `Process()` from a view**; process spawning is centralized in `ProcessSupervisor`.
- **Anglesite never disables PVR.** Only the enable path is implemented.
- **The template is the single authority on RFC 9116 contact validity.** Swift normalizes shape (trim, drop blanks, dedupe) and never re-implements URI validation.
- **New user-visible strings** require the `Localizable.xcstrings` merge documented in `CONTRIBUTING.md` ▸ "Development setup".
- **Serialize full `swift test` runs** — concurrent runs cause spurious FoundationModels failures.

---

## File Structure

| File | Responsibility |
|---|---|
| `Resources/Template/scripts/edge-artifacts.ts` (modify) | Parse `SECURITY_CONTACT` as an ordered list; emit one `Contact:` per entry |
| `Resources/Template/scripts/edge-artifacts.test.ts` (modify) | `node:test` coverage for the list parsing and multi-contact body |
| `Sources/AnglesiteCore/SecurityReportingAsset.swift` (create) | `.site-config` read/write for `SECURITY_CONTACT` + `SECURITY_TXT_MODE`; advisory-URL derivation |
| `Sources/AnglesiteCore/SecurityReportingReadiness.swift` (create) | Pure evaluator: what the UI should offer, given repo facts |
| `Sources/AnglesiteCore/RepoSecurity.swift` (create) | `RepoSecurityReading` / `RepoSecurityWriting` protocol seam |
| `Sources/AnglesiteCore/HTTPGitHubClient.swift` (modify) | REST calls for repo visibility + PVR read/enable; conform to the seam |
| `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift` (create) | Build-free `AuditRunner` emitting the `.info` hint |
| `Sources/AnglesiteCore/AuditCommand.swift` (modify) | Register the runner in `defaultRunners` |
| `Sources/AnglesiteApp/PlistEditorModel.swift` (modify) | Security-reporting facet: load, save, readiness refresh, PVR enable |
| `Sources/AnglesiteApp/PlistEditorView.swift` (modify) | Security Reports tab |

---

## Task 1: Template — ordered `SECURITY_CONTACT` list

**Files:**
- Modify: `Resources/Template/scripts/edge-artifacts.ts:120-165` (`normalizeSecurityContact` / `buildSecurityTxt`) and `:256-262` (`planSecurityTxt` params)
- Test: `Resources/Template/scripts/edge-artifacts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `normalizeSecurityContacts(raw: string | undefined): string[]` and a `buildSecurityTxt(contacts: string | undefined, siteUrl: string | undefined, now: Date): string | null` that emits one `Contact:` line per normalized entry. Task 2's Swift side mirrors the comma-separated on-disk format; nothing imports these symbols across languages.

**Context the implementer needs:**
- `.site-config` is a flat `KEY=value` file with no escaping. Comma-separated lists are the house convention (`SCRIPT_ALLOW`, `MTA_STS_MX`).
- `resolveSecurityTxtMode` is **deliberately not changed**. It infers `generated` from a non-empty raw string, not a successfully-normalized one — tightening it would silence today's "SECURITY_CONTACT is unset or unusable" build note for a set-but-garbage contact. Leave it alone.
- Existing behavior that must not regress: a single-value `SECURITY_CONTACT` must produce a **byte-identical** file to today.

- [ ] **Step 1: Write the failing tests**

Add to `Resources/Template/scripts/edge-artifacts.test.ts`. Add `normalizeSecurityContacts` to the existing import block at the top of the file (alongside `normalizeSecurityContact`).

```ts
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
  assert.deepEqual(
    normalizeSecurityContacts("https://example.com/report?ref=a%2Cb"),
    ["https://example.com/report?ref=a,b"],
  );
});

test("normalizeSecurityContacts: an escaped comma survives alongside real list separators", () => {
  assert.deepEqual(
    normalizeSecurityContacts("https://example.com/r?ref=a%2Cb,security@example.com"),
    ["https://example.com/r?ref=a,b", "mailto:security@example.com"],
  );
});

test("normalizeSecurityContacts: an ordinary percent sequence is left alone", () => {
  // A general percent-decode would corrupt this to "https://example.com/a b".
  assert.deepEqual(
    normalizeSecurityContacts("https://example.com/a%20b"),
    ["https://example.com/a%20b"],
  );
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts
```

Expected: FAIL — `normalizeSecurityContacts is not defined`, and the multi-contact assertions fail because `buildSecurityTxt` emits a single `Contact:` line.

- [ ] **Step 3: Implement `normalizeSecurityContacts`**

Insert immediately after `normalizeSecurityContact` in `Resources/Template/scripts/edge-artifacts.ts`:

```ts
/**
 * Restores the one character the `SECURITY_CONTACT` list escapes.
 *
 * The list is comma-separated, but a contact URI may legally contain a comma — RFC 3986 allows
 * one unescaped in a path or query, and RFC 5321 allows one inside a quoted local part. The app
 * writes such a comma as `%2C`; this puts it back, so splitting the list can never truncate a
 * single contact.
 *
 * Only `%2C` is special. A general percent-decode would turn an ordinary `%20` in a URL into a
 * space and corrupt every contact written before this escaping existed.
 */
function unescapeContactComma(entry: string): string {
  return entry.replace(/%2C/gi, ",");
}

/**
 * Normalizes a comma-separated `SECURITY_CONTACT` into RFC 9116 Contact URIs, preserving the
 * configured preference order (§2.5.3: earlier entries are more preferred). Each entry is
 * unescaped (see `unescapeContactComma`) and then passed through `normalizeSecurityContact`;
 * unusable entries are dropped and duplicates collapsed, mirroring `normalizeMTAStsMX`.
 */
export function normalizeSecurityContacts(raw: string | undefined): string[] {
  const result: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const uri = normalizeSecurityContact(unescapeContactComma(part));
    if (uri !== null && !result.includes(uri)) result.push(uri);
  }
  return result;
}
```

- [ ] **Step 4: Make `buildSecurityTxt` emit the list**

Replace the body and doc comment of `buildSecurityTxt` in `Resources/Template/scripts/edge-artifacts.ts`:

```ts
/**
 * RFC 9116 security.txt body, or null when no usable contact is configured (see
 * `normalizeSecurityContacts`). `contacts` is the raw comma-separated `SECURITY_CONTACT` value;
 * each usable entry becomes its own `Contact:` line, in configured preference order.
 *
 * `Expires` is 180 days from `now` — Anglesite product policy, satisfying RFC 9116 §2.5.1's
 * recommendation that it be under a year without treating that recommendation as a MUST.
 * `Canonical` is emitted only for a valid HTTPS `siteUrl`; an unset, unparseable, or insecure
 * `SITE_URL` omits the field rather than falling back to a placeholder origin.
 */
export function buildSecurityTxt(
  contacts: string | undefined,
  siteUrl: string | undefined,
  now: Date,
): string | null {
  const contactUris = normalizeSecurityContacts(contacts);
  if (contactUris.length === 0) return null;
  const contactLines = contactUris.map((uri) => `Contact: ${uri}`).join("\n");
  const expires = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const origin = httpsOrigin(siteUrl);
  const canonicalLine = origin ? `\nCanonical: ${origin}/.well-known/security.txt` : "";
  return `${SECURITY_TXT_MARKER}\n${contactLines}\nExpires: ${expires}${canonicalLine}\n`;
}
```

- [ ] **Step 5: Rename the now-plural parameter through `planSecurityTxt`**

In `edge-artifacts.ts`, change `planSecurityTxt`'s parameter object so the key reads `contacts` instead of `contact` — the type member, the destructuring line, and the `buildSecurityTxt(contact, …)` call:

```ts
export function planSecurityTxt(params: {
  mode: SecurityTxtMode;
  contacts: string | undefined;
  siteUrl: string | undefined;
  now: Date;
  existingContent: string | null;
}): SecurityTxtPlan {
  const { mode, contacts, siteUrl, now, existingContent } = params;
```

and, further down in the same function:

```ts
  const body = buildSecurityTxt(contacts, siteUrl, now);
```

Then update `applySecurityTxtPlan`'s call site in the same file:

```ts
  const plan = planSecurityTxt({
    mode: resolveSecurityTxtMode(readConfig("SECURITY_TXT_MODE"), readConfig("SECURITY_CONTACT")),
    contacts: readConfig("SECURITY_CONTACT"),
    siteUrl: readConfig("SITE_URL"),
    now: new Date(),
    existingContent,
  });
```

Finally rename the key in the ten existing `planSecurityTxt({…})` literals in the test file. Every occurrence is an indented `contact: ` line belonging to one of those literals, so this is safe:

```bash
perl -pi -e 's/^(\s+)contact: /$1contacts: /' Resources/Template/scripts/edge-artifacts.test.ts
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts
```

Expected: PASS, with no remaining failures — including the pre-existing `buildSecurityTxt`, `planSecurityTxt`, and `resolveSecurityTxtMode` tests, which must still pass unchanged.

- [ ] **Step 7: Run the pre-deploy check's own suite**

`checkSecurityTxt` needs no change (it counts `Contact` lines and only fails on zero), but it shares `resolveSecurityTxtMode` — prove nothing moved:

```bash
cd Resources/Template && npx tsx --test scripts/pre-deploy-check.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the Swift suites that string-match template output**

```bash
swift test --package-path .
```

Expected: PASS. (`CONTRIBUTING.md` requires this for any `Resources/Template/` change. If it appears to hang with no output, check `pgrep -fl swift-test` for a stale process holding the `.build` lock.)

- [ ] **Step 9: Commit**

```bash
git add Resources/Template/scripts/edge-artifacts.ts Resources/Template/scripts/edge-artifacts.test.ts
git commit -m "feat(#843): SECURITY_CONTACT accepts an ordered contact list"
```

---

## Task 2: `SecurityReportingAsset`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityReportingAsset.swift`
- Test: `Tests/AnglesiteCoreTests/SecurityReportingAssetTests.swift`

**Interfaces:**
- Consumes: `SiteConfigFile.value(forKey:in:)` / `.upsert(_:into:)`, `WebsiteAnalyticsAsset.configRelativePath` (`".site-config"`), and `RemoteRepo` (fields `url`, `owner`, `name`) — all existing `AnglesiteCore` types.
- Produces:
  - `SecurityReportingAsset.Mode` (`.generated` / `.manual` / `.disabled`, `String` raw values)
  - `SecurityReportingAsset.Settings { var contacts: String; var mode: Mode }` — `contacts` is newline-separated for the UI
  - `parseSettings(from config: String) -> Settings`
  - `install(_ settings: Settings, siteDirectory: URL) throws`
  - `normalizedContacts(_ raw: String) -> [String]` — shape-only, newline-separated UI text
  - `decodeStored(_ stored: String) -> [String]` / `encodeStored(_ entries: [String]) -> String` — the `.site-config` comma escape, matched pair with the template's `unescapeContactComma`
  - `advisoryURL(for repo: RemoteRepo) -> URL`
  - `usesAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> Bool`
  - `prependingAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> String`

  Tasks 3, 5, 6, and 7 all consume these exact names.

**Context the implementer needs:**
- Model this on `Sources/AnglesiteCore/MTAStsPolicyAsset.swift` — same shape: a `parseSettings`, an `install` that reads the whole `.site-config`, `SiteConfigFile.upsert`s its own keys, and writes back **only when the contents changed**.
- The UI presents one contact per line; `.site-config` stores them comma-joined. `MTAStsPolicyAsset.parseSettings` does the same comma→newline swap for `MTA_STS_MX`.
- `RemoteRepo.parse` already rejects every non-`github.com` host, so a `RemoteRepo` value is GitHub-by-construction. `advisoryURL` needs no host check of its own.
- **Do not re-implement the template's URI validation.** `normalizedContacts` trims, drops blanks, and dedupes — nothing else. An `http://` entry is written through, and the build/pre-deploy signal is what tells the owner.
- **The comma escape is a matched pair with the template.** Task 1 added `unescapeContactComma` in `edge-artifacts.ts`, which replaces `%2C` (case-insensitive) with `,` after splitting and does nothing else. `encodeStored` here is its exact inverse. If you change one, the contract breaks silently — the file still parses, it just publishes a wrong contact.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/SecurityReportingAssetTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityReportingAsset (#843)")
struct SecurityReportingAssetTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")

    @Test("parses a comma-separated contact list into newline-separated UI text")
    func parseSettings() {
        let settings = SecurityReportingAsset.parseSettings(
            from: "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=https://example.com/report,s@example.com\n")
        #expect(settings == .init(contacts: "https://example.com/report\ns@example.com", mode: .generated))
    }

    @Test("an unset mode falls back to the template's inference rule")
    func parseSettingsInfersMode() {
        #expect(SecurityReportingAsset.parseSettings(from: "SECURITY_CONTACT=s@example.com\n").mode == .generated)
        #expect(SecurityReportingAsset.parseSettings(from: "").mode == .disabled)
        #expect(SecurityReportingAsset.parseSettings(from: "SECURITY_TXT_MODE=bogus\n").mode == .disabled)
    }

    @Test("normalizes shape only — trims, drops blanks, dedupes, keeps order and invalid entries")
    func normalizedContacts() {
        #expect(SecurityReportingAsset.normalizedContacts(" a@example.com \n\n b@example.com \n a@example.com ")
            == ["a@example.com", "b@example.com"])
        // Validity is the template's job: an http:// entry survives here and is reported by the build.
        #expect(SecurityReportingAsset.normalizedContacts("http://nope.example") == ["http://nope.example"])
        // A comma is a .site-config list separator, not a UI one — an entry may contain one.
        #expect(SecurityReportingAsset.normalizedContacts("https://example.com/r?ref=a,b")
            == ["https://example.com/r?ref=a,b"])
    }

    @Test("a comma inside one contact round-trips through the stored escape")
    func commaEscapeRoundTrip() {
        let entries = ["https://example.com/r?ref=a,b", "s@example.com"]
        let stored = SecurityReportingAsset.encodeStored(entries)
        #expect(stored == "https://example.com/r?ref=a%2Cb,s@example.com")
        #expect(SecurityReportingAsset.decodeStored(stored) == entries)
    }

    @Test("decodeStored leaves ordinary percent sequences alone")
    func decodeStoredIsNotAGeneralPercentDecode() {
        // A general percent-decode would corrupt this to "https://example.com/a b".
        #expect(SecurityReportingAsset.decodeStored("https://example.com/a%20b")
            == ["https://example.com/a%20b"])
    }

    @Test("a pre-escape single value round-trips byte-identically")
    func legacyValueRoundTrips() {
        #expect(SecurityReportingAsset.decodeStored("security@example.com") == ["security@example.com"])
        #expect(SecurityReportingAsset.encodeStored(["security@example.com"]) == "security@example.com")
    }

    @Test("derives the repo's private advisory form")
    func advisoryURL() {
        #expect(SecurityReportingAsset.advisoryURL(for: Self.repo)
            == URL(string: "https://github.com/acme/site/security/advisories/new"))
    }

    @Test("detects whether the advisory form is already a contact")
    func usesAdvisoryForm() {
        #expect(SecurityReportingAsset.usesAdvisoryForm(
            "https://github.com/acme/site/security/advisories/new\ns@example.com", repo: Self.repo))
        #expect(!SecurityReportingAsset.usesAdvisoryForm("s@example.com", repo: Self.repo))
        #expect(!SecurityReportingAsset.usesAdvisoryForm("", repo: Self.repo))
    }

    @Test("prepends the advisory form, preserving order and never duplicating it")
    func prependingAdvisoryForm() {
        #expect(SecurityReportingAsset.prependingAdvisoryForm("s@example.com\nt@example.com", repo: Self.repo)
            == "https://github.com/acme/site/security/advisories/new\ns@example.com\nt@example.com")
        #expect(SecurityReportingAsset.prependingAdvisoryForm("", repo: Self.repo)
            == "https://github.com/acme/site/security/advisories/new")
        let already = "https://github.com/acme/site/security/advisories/new\ns@example.com"
        #expect(SecurityReportingAsset.prependingAdvisoryForm(already, repo: Self.repo) == already)
    }

    @Test("install writes normalized settings while preserving unrelated config")
    func install() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try "SITE_NAME=Acme\n".write(to: root.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        try SecurityReportingAsset.install(
            .init(contacts: " https://example.com/report \n\n s@example.com ", mode: .generated), siteDirectory: root)

        let config = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SITE_NAME=Acme"))
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
        #expect(config.contains("SECURITY_CONTACT=https://example.com/report,s@example.com"))
    }

    @Test("install leaves the file untouched when nothing changed")
    func installIsIdempotent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configURL = root.appendingPathComponent(".site-config")
        try "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=s@example.com\n".write(to: configURL, atomically: true, encoding: .utf8)
        let before = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date

        try SecurityReportingAsset.install(.init(contacts: "s@example.com", mode: .generated), siteDirectory: root)

        let after = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date
        #expect(before == after)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter SecurityReportingAssetTests
```

Expected: FAIL to compile — `cannot find 'SecurityReportingAsset' in scope`. (Note: `--filter` restricts what *runs*, not what *compiles*; the whole package still builds.)

- [ ] **Step 3: Implement the asset**

Create `Sources/AnglesiteCore/SecurityReportingAsset.swift`:

```swift
import Foundation

/// The site-settings representation of the RFC 9116 `security.txt` generated by the template.
///
/// Owns exactly two `.site-config` keys — `SECURITY_CONTACT` (a preference-ordered,
/// comma-separated contact list) and `SECURITY_TXT_MODE`. Contact *validity* stays the
/// template generator's job (`normalizeSecurityContact` in `scripts/edge-artifacts.ts`): this
/// type normalizes shape only, so an entry the generator would reject is written through and
/// reported by the build rather than silently deleted on save.
public enum SecurityReportingAsset {
    /// Mirrors the template's `SecurityTxtMode`.
    public enum Mode: String, Sendable, CaseIterable, Identifiable, Equatable {
        case generated
        case manual
        case disabled

        public var id: Self { self }
    }

    public struct Settings: Sendable, Equatable {
        /// Preference-ordered contacts, one per line in the UI; comma-joined in `.site-config`.
        public var contacts: String
        public var mode: Mode

        public init(contacts: String = "", mode: Mode = .disabled) {
            self.contacts = contacts
            self.mode = mode
        }
    }

    public static func parseSettings(from config: String) -> Settings {
        let stored = SiteConfigFile.value(forKey: "SECURITY_CONTACT", in: config) ?? ""
        // An unset or unrecognized mode mirrors the template's `resolveSecurityTxtMode`: infer
        // from whether a contact is configured at all, so a site scaffolded before the key
        // existed doesn't appear to have silently turned security.txt off.
        let mode = Mode(rawValue: SiteConfigFile.value(forKey: "SECURITY_TXT_MODE", in: config) ?? "")
            ?? (stored.trimmingCharacters(in: .whitespaces).isEmpty ? .disabled : .generated)
        return Settings(contacts: decodeStored(stored).joined(separator: "\n"), mode: mode)
    }

    public static func install(_ settings: Settings, siteDirectory: URL) throws {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([
            ("SECURITY_CONTACT", encodeStored(normalizedContacts(settings.contacts))),
            ("SECURITY_TXT_MODE", settings.mode.rawValue),
        ], into: config)
        guard updated != config else { return }
        try updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Shape normalization of the UI's newline-separated text: trim, drop blanks, collapse
    /// duplicates, preserve order. Deliberately does not judge whether an entry is a usable
    /// RFC 9116 contact URI — see this type's doc comment.
    ///
    /// Splits on newlines only. A comma is a list separator in `.site-config`, not in the UI,
    /// and an entry may legitimately contain one — splitting here would break it apart.
    public static func normalizedContacts(_ raw: String) -> [String] {
        var result: [String] = []
        for part in raw.split(whereSeparator: { $0.isNewline }) {
            let value = part.trimmingCharacters(in: .whitespaces)
            if !value.isEmpty, !result.contains(value) { result.append(value) }
        }
        return result
    }

    /// Splits the stored `.site-config` value into entries, restoring escaped commas.
    ///
    /// Only `%2C` is decoded — a general percent-decode would turn an ordinary `%20` in a URL
    /// into a space and corrupt every contact written before this escaping existed. This is the
    /// exact inverse of `encodeStored`, and matches the template's `unescapeContactComma`.
    public static func decodeStored(_ stored: String) -> [String] {
        var result: [String] = []
        for part in stored.split(separator: ",", omittingEmptySubsequences: true) {
            let value = part.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "%2C", with: ",", options: [.caseInsensitive])
            if !value.isEmpty, !result.contains(value) { result.append(value) }
        }
        return result
    }

    /// Joins entries into the stored `.site-config` value, escaping any comma inside an entry so
    /// the split can never truncate a contact URI. A comma is legal in a URI path or query
    /// (RFC 3986) and inside a quoted local part (RFC 5321).
    public static func encodeStored(_ entries: [String]) -> String {
        entries
            .map { $0.replacingOccurrences(of: ",", with: "%2C") }
            .joined(separator: ",")
    }

    /// The repo's private advisory form. `RemoteRepo` is GitHub-by-construction
    /// (`RemoteRepo.parse` rejects every other host), so this needs no host check of its own.
    public static func advisoryURL(for repo: RemoteRepo) -> URL {
        repo.url.appendingPathComponent("security/advisories/new")
    }

    /// True when `contacts` already lists this repo's advisory form.
    public static func usesAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> Bool {
        normalizedContacts(contacts).contains(advisoryURL(for: repo).absoluteString)
    }

    /// `contacts` with the advisory form as the most-preferred entry, preserving the rest in
    /// order and never duplicating a form that is already listed.
    public static func prependingAdvisoryForm(_ contacts: String, repo: RemoteRepo) -> String {
        let form = advisoryURL(for: repo).absoluteString
        return ([form] + normalizedContacts(contacts).filter { $0 != form }).joined(separator: "\n")
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
swift test --package-path . --filter SecurityReportingAssetTests
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SecurityReportingAsset.swift Tests/AnglesiteCoreTests/SecurityReportingAssetTests.swift
git commit -m "feat(#843): add SecurityReportingAsset for security.txt config"
```

---

## Task 3: `SecurityReportingReadiness`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityReportingReadiness.swift`
- Test: `Tests/AnglesiteCoreTests/SecurityReportingReadinessTests.swift`

**Interfaces:**
- Consumes: `RemoteRepo`, and `SecurityReportingAsset.usesAdvisoryForm(_:repo:)` from Task 2.
- Produces: `SecurityReportingReadiness` — an enum with cases `.notGitHub`, `.alreadyConfigured`, `.ready`, `.needsPVR`, `.repoPrivate`, and a static `evaluate(repo: RemoteRepo?, isPrivate: Bool, pvrEnabled: Bool, contacts: String) -> SecurityReportingReadiness`. Tasks 6 and 7 consume both.

**Context the implementer needs:**
- The advisory form only works for an outside reporter when the repo is **public** *and* **private vulnerability reporting** is enabled.
- Precedence, in order: `notGitHub` → `alreadyConfigured` → `repoPrivate` → `needsPVR` → `ready`.
- `alreadyConfigured` outranking `repoPrivate` is deliberate: an owner who published the form and *then* made the repo private should be told the channel is configured (and warned about visibility by the UI), not offered a setup they already completed.
- This is a pure function so every branch is testable with no fakes and no network.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/SecurityReportingReadinessTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityReportingReadiness (#843)")
struct SecurityReportingReadinessTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")
    private static let form = "https://github.com/acme/site/security/advisories/new"

    @Test("no repo means nothing to offer")
    func notGitHub() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: nil, isPrivate: false, pvrEnabled: true, contacts: "s@example.com") == .notGitHub)
    }

    @Test("a public repo with private reporting on is ready to offer")
    func ready() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: false, pvrEnabled: true, contacts: "s@example.com") == .ready)
    }

    @Test("a public repo with private reporting off needs it enabled first")
    func needsPVR() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: false, pvrEnabled: false, contacts: "s@example.com") == .needsPVR)
    }

    @Test("a private repo offers nothing — outside reporters can't reach the form")
    func repoPrivate() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: true, pvrEnabled: true, contacts: "s@example.com") == .repoPrivate)
        #expect(SecurityReportingReadiness.evaluate(
            repo: Self.repo, isPrivate: true, pvrEnabled: false, contacts: "s@example.com") == .repoPrivate)
    }

    @Test("an already-listed form reports configured, whatever the repo state")
    func alreadyConfigured() {
        for (isPrivate, pvr) in [(false, true), (false, false), (true, true), (true, false)] {
            #expect(SecurityReportingReadiness.evaluate(
                repo: Self.repo, isPrivate: isPrivate, pvrEnabled: pvr,
                contacts: "\(Self.form)\ns@example.com") == .alreadyConfigured)
        }
    }

    @Test("no repo outranks an already-listed form — a stale contact isn't a GitHub offer")
    func notGitHubOutranksConfigured() {
        #expect(SecurityReportingReadiness.evaluate(
            repo: nil, isPrivate: false, pvrEnabled: true, contacts: Self.form) == .notGitHub)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter SecurityReportingReadinessTests
```

Expected: FAIL to compile — `cannot find 'SecurityReportingReadiness' in scope`.

- [ ] **Step 3: Implement the evaluator**

Create `Sources/AnglesiteCore/SecurityReportingReadiness.swift`:

```swift
import Foundation

/// What Website Settings ▸ Security Reports should offer for a site, given its GitHub repo facts.
///
/// Pure by design: the network reads (repo visibility, private-vulnerability-reporting state)
/// happen in the model layer, and every branch of the decision is unit-testable without fakes.
public enum SecurityReportingReadiness: Sendable, Equatable {
    /// No `origin`, or an origin that isn't GitHub.
    case notGitHub
    /// The repo's advisory form is already one of the published contacts.
    case alreadyConfigured
    /// Public with private vulnerability reporting on — the form is usable, offer to publish it.
    case ready
    /// Public but private vulnerability reporting is off — offer to enable it, then publish.
    case needsPVR
    /// A private repo: outside reporters cannot reach the advisory form at all.
    case repoPrivate

    /// Precedence: `notGitHub` → `alreadyConfigured` → `repoPrivate` → `needsPVR` → `ready`.
    ///
    /// `alreadyConfigured` deliberately outranks `repoPrivate`: an owner who published the form
    /// and later made the repo private has already done the setup, so the UI should confirm the
    /// channel and warn about visibility rather than re-offer configuration.
    public static func evaluate(
        repo: RemoteRepo?,
        isPrivate: Bool,
        pvrEnabled: Bool,
        contacts: String
    ) -> SecurityReportingReadiness {
        guard let repo else { return .notGitHub }
        if SecurityReportingAsset.usesAdvisoryForm(contacts, repo: repo) { return .alreadyConfigured }
        if isPrivate { return .repoPrivate }
        return pvrEnabled ? .ready : .needsPVR
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
swift test --package-path . --filter SecurityReportingReadinessTests
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SecurityReportingReadiness.swift Tests/AnglesiteCoreTests/SecurityReportingReadinessTests.swift
git commit -m "feat(#843): add SecurityReportingReadiness evaluator"
```

---

## Task 4: GitHub repo-security API calls

**Files:**
- Create: `Sources/AnglesiteCore/RepoSecurity.swift`
- Modify: `Sources/AnglesiteCore/HTTPGitHubClient.swift` (append methods + conformance)
- Test: `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift` (append)

**Interfaces:**
- Consumes: `GitHubAPITokenVerifier.Transport` (`@Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)`) and `GitHubRepoAPIError` — both existing in `AnglesiteCore`.
- Produces:
  - `protocol RepoSecurityReading: Sendable` with `isPrivate(owner:name:token:) async throws -> Bool` and `privateVulnerabilityReporting(owner:name:token:) async throws -> Bool`
  - `protocol RepoSecurityWriting: Sendable` with `enablePrivateVulnerabilityReporting(owner:name:token:) async throws`
  - `HTTPGitHubClient` conforms to both.

  Task 6 injects `any RepoSecurityReading & RepoSecurityWriting`.

**Context the implementer needs:**

Verified against the GitHub REST docs, API version `2022-11-28`:

| Purpose | Request | Response |
|---|---|---|
| Repo visibility | `GET /repos/{owner}/{repo}` | JSON with a `private` boolean |
| PVR state | `GET /repos/{owner}/{repo}/private-vulnerability-reporting` | JSON with a required `enabled` boolean |
| Enable PVR | `PUT /repos/{owner}/{repo}/private-vulnerability-reporting` | 204, no body |

- The write requires **admin access to the repository**. A token without it returns 403, which maps to `.unauthorized` and is rendered by Task 6 as a missing-permission message — never retried.
- **No disable path.** GitHub also exposes `DELETE` on that route; Anglesite deliberately does not implement it. Turning off a reporting channel it didn't create would be a surprising outward-facing side effect from a website editor.
- Follow `createRepo`'s existing request shape exactly: `Authorization: Bearer …`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, transport throw → `.network`, 401/403 → `.unauthorized`, other non-2xx → `.http(status:)`, undecodable body → `.malformedResponse`.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift`, inside the existing `HTTPGitHubClientTests` struct:

```swift
    /// Records the request the client built, so path/method/header assertions are possible.
    private static func recordingTransport(
        status: Int,
        json: String,
        into box: RequestBox
    ) -> GitHubAPITokenVerifier.Transport {
        { request in
            await box.record(request)
            let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(json.utf8), http)
        }
    }

    actor RequestBox {
        private(set) var last: URLRequest?
        func record(_ request: URLRequest) { last = request }
    }

    @Test("isPrivate reads the repo's private flag")
    func repoVisibility() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(
            status: 200, json: #"{"private":true}"#, into: box))
        #expect(try await client.isPrivate(owner: "acme", name: "site", token: "tok"))
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site")
        #expect(request?.httpMethod == "GET")
    }

    @Test("privateVulnerabilityReporting reads the enabled flag")
    func pvrState() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(
            status: 200, json: #"{"enabled":true}"#, into: box))
        #expect(try await client.privateVulnerabilityReporting(owner: "acme", name: "site", token: "tok"))
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site/private-vulnerability-reporting")
        #expect(request?.httpMethod == "GET")
    }

    @Test("enablePrivateVulnerabilityReporting PUTs and accepts a 204 with no body")
    func enablePVR() async throws {
        let box = RequestBox()
        let client = HTTPGitHubClient(transport: Self.recordingTransport(status: 204, json: "", into: box))
        try await client.enablePrivateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        let request = await box.last
        #expect(request?.url?.path == "/repos/acme/site/private-vulnerability-reporting")
        #expect(request?.httpMethod == "PUT")
        #expect(request?.value(forHTTPHeaderField: "X-GitHub-Api-Version") == "2022-11-28")
    }

    @Test("a 403 on the PVR write maps to .unauthorized — the token lacks repo admin")
    func enablePVRWithoutAdmin() async {
        let client = HTTPGitHubClient(transport: Self.transport(
            status: 403, json: #"{"message":"Must have admin rights to Repository."}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            try await client.enablePrivateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("a transport failure on a repo-security read maps to .network")
    func repoSecurityTransportFailure() async {
        let client = HTTPGitHubClient(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: GitHubRepoAPIError.network) {
            _ = try await client.privateVulnerabilityReporting(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("an undecodable body maps to .malformedResponse")
    func repoSecurityMalformedBody() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: "not json"))
        await #expect(throws: GitHubRepoAPIError.malformedResponse) {
            _ = try await client.isPrivate(owner: "acme", name: "site", token: "tok")
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter HTTPGitHubClientTests
```

Expected: FAIL to compile — `value of type 'HTTPGitHubClient' has no member 'isPrivate'`.

- [ ] **Step 3: Create the protocol seam**

Create `Sources/AnglesiteCore/RepoSecurity.swift`:

```swift
import Foundation

/// Read-only access to the GitHub repository settings that decide whether a repo's private
/// advisory form is usable by an outside reporter. Split read/write following the
/// `CloudflareReading`/`CloudflareWriting` pattern, so a UI that only inspects state can't
/// accidentally be handed a writer.
public protocol RepoSecurityReading: Sendable {
    /// `GET /repos/{owner}/{repo}` → the `private` flag. A private repo's advisory form is
    /// invisible to anyone without repo access.
    func isPrivate(owner: String, name: String, token: String) async throws -> Bool

    /// `GET /repos/{owner}/{repo}/private-vulnerability-reporting` → the `enabled` flag.
    func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool
}

/// Write access to a repository's private-vulnerability-reporting setting.
///
/// Enable only. GitHub also exposes a `DELETE` on the same route, but Anglesite never disables a
/// reporting channel it didn't create — that would be a surprising outward-facing side effect
/// from a website editor.
public protocol RepoSecurityWriting: Sendable {
    /// `PUT /repos/{owner}/{repo}/private-vulnerability-reporting`. Requires admin access to the
    /// repository; a token without it throws `GitHubRepoAPIError.unauthorized`.
    func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws
}
```

- [ ] **Step 4: Implement the client methods**

Append to `Sources/AnglesiteCore/HTTPGitHubClient.swift`, after `createRepo` and before the private nested types:

```swift
    /// Shared request builder for the repo-security calls — same headers and auth as `createRepo`.
    private func repoRequest(method: String, path: String, token: String) throws -> URLRequest {
        guard let url = URL(string: Self.base + path) else { throw GitHubRepoAPIError.malformedResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        return request
    }

    /// Sends `request`, mapping transport and status failures the same way `createRepo` does.
    /// Returns the body for callers that need to decode one.
    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            throw GitHubRepoAPIError.network
        }
        if http.statusCode == 401 || http.statusCode == 403 { throw GitHubRepoAPIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw GitHubRepoAPIError.http(status: http.statusCode) }
        return data
    }

    private struct RepositoryResponse: Decodable {
        let isPrivate: Bool
        enum CodingKeys: String, CodingKey { case isPrivate = "private" }
    }

    private struct PVRResponse: Decodable {
        let enabled: Bool
    }
}

extension HTTPGitHubClient: RepoSecurityReading, RepoSecurityWriting {
    public func isPrivate(owner: String, name: String, token: String) async throws -> Bool {
        let data = try await send(repoRequest(method: "GET", path: "/repos/\(owner)/\(name)", token: token))
        guard let repo = try? JSONDecoder().decode(RepositoryResponse.self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return repo.isPrivate
    }

    public func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool {
        let data = try await send(repoRequest(
            method: "GET", path: "/repos/\(owner)/\(name)/private-vulnerability-reporting", token: token))
        guard let state = try? JSONDecoder().decode(PVRResponse.self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return state.enabled
    }

    public func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws {
        // A 204 with an empty body is the documented success response — nothing to decode.
        _ = try await send(repoRequest(
            method: "PUT", path: "/repos/\(owner)/\(name)/private-vulnerability-reporting", token: token))
    }
}
```

Note the closing `}` placement: `send`, `repoRequest`, and the two response structs are members of `HTTPGitHubClient`; the protocol conformances live in the extension that follows it. The existing `CreateRepoBody`/`CreatedRepoResponse`/`GitHubErrorResponse` structs stay inside the struct — place the new private members above them and move the struct's closing brace accordingly.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
swift test --package-path . --filter HTTPGitHubClientTests
```

Expected: PASS — the six new tests plus the pre-existing `createRepo` tests.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/RepoSecurity.swift Sources/AnglesiteCore/HTTPGitHubClient.swift Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift
git commit -m "feat(#843): read repo visibility and private vuln reporting"
```

---

## Task 5: `SecurityTxtAuditRunner`

**Files:**
- Create: `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift`
- Modify: `Sources/AnglesiteCore/AuditCommand.swift:187-189` (`defaultRunners`)
- Test: `Tests/AnglesiteCoreTests/SecurityTxtAuditRunnerTests.swift`

**Interfaces:**
- Consumes: `AuditRunner` (protocol: `var category`, `func run(siteDirectory:supervisor:logCenter:source:) async throws -> [AuditReport.Finding]`), `AuditReport.Finding`, `BackupCommand.GitRunner` + `BackupCommand.defaultRunner`, `ProcessSupervisor.RunResult`, `RemoteRepo.parse(remoteURL:)`, and from Task 2 `SecurityReportingAsset.parseSettings(from:)` / `.usesAdvisoryForm(_:repo:)`.
- Produces: `SecurityTxtAuditRunner(gitRunner:)` — the initializer's single parameter defaults to `BackupCommand.defaultRunner`.

**Context the implementer needs:**
- **The runner must not spawn anything and must not use a GitHub token.** An audit shouldn't make authenticated network calls to decide whether to show an informational hint; the expensive verification (visibility + PVR) belongs in Settings, where the owner is acting. The accepted consequence is that the hint can fire for a repo that turns out to be private — the Settings tab then explains why the offer isn't available.
- Use `BackupCommand.GitRunner` and `BackupCommand.defaultRunner` rather than calling `InProcessGit` directly. `InProcessGit` is `#if canImport(Darwin)`-gated (SwiftGit2 has no Linux platform) and `defaultRunner` already carries the Darwin/non-Darwin split. Injecting it is also how the tests avoid needing a real repository.
- `RemoteRepo.parse` returns `nil` for a missing, unparseable, or non-GitHub remote — so one `guard let` covers all three "no offer" cases.
- A throwing git runner (no repo, git unavailable) must produce **no findings**, not a runner failure: `AuditCommand` records a throwing runner in `runnersSkipped`, and "this site has no git remote" is a normal state, not a skipped audit.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/SecurityTxtAuditRunnerTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityTxtAuditRunner (#843)")
struct SecurityTxtAuditRunnerTests {
    private static func siteDirectory(config: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("SecurityTxtAuditRunnerTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try config.write(to: root.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return root
    }

    private static func gitRunner(remote: String) -> BackupCommand.GitRunner {
        { _, _ in ProcessSupervisor.RunResult(stdout: remote, stderr: "", exitCode: 0) }
    }

    private static func run(config: String, gitRunner: @escaping BackupCommand.GitRunner) async throws -> [AuditReport.Finding] {
        let root = try siteDirectory(config: config)
        defer { try? FileManager.default.removeItem(at: root) }
        return try await SecurityTxtAuditRunner(gitRunner: gitRunner).run(
            siteDirectory: root, supervisor: .shared, logCenter: .shared, source: "test")
    }

    @Test("flags a GitHub-backed site that isn't routing reports to its advisory form")
    func flagsUnconfiguredSite() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.count == 1)
        #expect(findings[0].category == .security)
        #expect(findings[0].severity == .info)
        #expect(findings[0].remediation?.contains("Security Reports") == true)
        #expect(findings[0].detail.contains("acme/site"))
    }

    @Test("flags a GitHub-backed site with no contact configured at all")
    func flagsSiteWithNoContact() async throws {
        let findings = try await Self.run(
            config: "SITE_NAME=Acme\n",
            gitRunner: Self.gitRunner(remote: "git@github.com:acme/site.git\n"))
        #expect(findings.count == 1)
    }

    @Test("says nothing when the advisory form is already a contact")
    func silentWhenConfigured() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new,s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://github.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing for a non-GitHub origin")
    func silentForNonGitHubOrigin() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: Self.gitRunner(remote: "https://gitlab.com/acme/site.git\n"))
        #expect(findings.isEmpty)
    }

    @Test("says nothing when there is no origin")
    func silentWithoutOrigin() async throws {
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: "", stderr: "no such remote", exitCode: 2) })
        #expect(findings.isEmpty)
    }

    @Test("a throwing git runner yields no findings rather than failing the audit")
    func silentWhenGitUnavailable() async throws {
        struct Boom: Error {}
        let findings = try await Self.run(
            config: "SECURITY_CONTACT=s@example.com\n",
            gitRunner: { _, _ in throw Boom() })
        #expect(findings.isEmpty)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter SecurityTxtAuditRunnerTests
```

Expected: FAIL to compile — `cannot find 'SecurityTxtAuditRunner' in scope`.

- [ ] **Step 3: Implement the runner**

Create `Sources/AnglesiteCore/SecurityTxtAuditRunner.swift`:

```swift
import Foundation

/// `AuditRunner` that notices when a GitHub-backed site publishes a `security.txt` that doesn't
/// route reports to the repo's private advisory form (#843).
///
/// Deliberately spawns nothing and uses no GitHub token: an audit shouldn't make authenticated
/// network calls to decide whether to show an informational hint. The real verification — repo
/// visibility and private-vulnerability-reporting state — happens in Website Settings ▸ Security
/// Reports, where the owner is actually acting. The accepted consequence is that this hint can
/// fire for a repo that turns out to be private; the Settings tab then explains why the offer
/// isn't available. A hint that resolves to "not applicable" costs nothing, whereas skipping it
/// silently would hide the feature from exactly the owners it targets.
public struct SecurityTxtAuditRunner: AuditRunner {
    public let category: AuditReport.Finding.Category = .security

    private let gitRunner: BackupCommand.GitRunner

    /// `gitRunner` defaults to `BackupCommand.defaultRunner`, which already carries the
    /// Darwin (in-process SwiftGit2) / non-Darwin (subprocess `git`) split — `InProcessGit`
    /// itself is Darwin-only, so this runner must not reference it directly.
    public init(gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner) {
        self.gitRunner = gitRunner
    }

    public func run(
        siteDirectory: URL,
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
        guard let repo = await remoteRepo(in: siteDirectory) else { return [] }
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let contacts = SecurityReportingAsset.parseSettings(from: config).contacts
        guard !SecurityReportingAsset.usesAdvisoryForm(contacts, repo: repo) else { return [] }

        return [AuditReport.Finding(
            category: .security,
            severity: .info,
            title: "Vulnerability reports aren’t routed to GitHub",
            detail: "This site is backed by \(repo.owner)/\(repo.name), but security.txt doesn’t list that repository’s private advisory form as a contact.",
            remediation: "Open Website Settings ▸ Security Reports to route vulnerability reports to the repository’s private advisory form.",
            location: WebsiteAnalyticsAsset.configRelativePath
        )]
    }

    /// The site's GitHub `origin`, or nil when there is no remote, git can't run, or the remote
    /// isn't GitHub (`RemoteRepo.parse` rejects every other host). None of those is an audit
    /// failure — a site without a GitHub remote is a normal state, so this never throws.
    private func remoteRepo(in siteDirectory: URL) async -> RemoteRepo? {
        guard let result = try? await gitRunner(siteDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }
}
```

- [ ] **Step 4: Register the runner**

In `Sources/AnglesiteCore/AuditCommand.swift`, replace the `defaultRunners` list:

```swift
    public static let defaultRunners: [any AuditRunner] = [
        A11yAuditRunner(),
        SecurityTxtAuditRunner()
    ]
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
swift test --package-path . --filter SecurityTxtAuditRunnerTests
```

Expected: PASS — 6 tests.

- [ ] **Step 6: Run the whole Core suite for regressions**

`defaultRunners` is now two runners, so any test asserting on the audit pipeline's runner set will surface here:

```bash
swift test --package-path .
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteCore/SecurityTxtAuditRunner.swift Sources/AnglesiteCore/AuditCommand.swift Tests/AnglesiteCoreTests/SecurityTxtAuditRunnerTests.swift
git commit -m "feat(#843): audit hint for unrouted GitHub security reports"
```

---

## Task 6: `PlistEditorModel` security-reporting facet

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift` — stored properties (~`:44-49`), dirty computed vars (~`:51-55`), `init` (~`:81-94`), `load()` (~`:137-141`), a new `saveSecurityReporting()` next to `saveMtaSts()` (~`:320-345`), and `dirtyFacets` (~`:519-528`)
- Test: `Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsTests.swift`

**Interfaces:**
- Consumes: `SecurityReportingAsset` (Task 2), `SecurityReportingReadiness` (Task 3), `RepoSecurityReading & RepoSecurityWriting` + `HTTPGitHubClient` (Task 4), `BackupCommand.GitRunner`/`defaultRunner`, `RemoteRepo`, `GitHubRepoAPIError`, and `KeychainStore().readGitHubToken()` (a `SecretStore` protocol default).
- Produces, for Task 7's view:
  - `var securityReportingSettings: SecurityReportingAsset.Settings`
  - `private(set) var securityReportingError: String?`
  - `private(set) var isSavingSecurityReporting: Bool`
  - `private(set) var isCheckingRepoSecurity: Bool`
  - `private(set) var securityReportingReadiness: SecurityReportingReadiness`
  - `private(set) var securityReportingRepo: RemoteRepo?`
  - `private(set) var securityReportingRepoIsPrivate: Bool`
  - `var isSecurityReportingDirty: Bool`
  - `func saveSecurityReporting() async -> Bool`
  - `func refreshRepoSecurityState() async`
  - `func adoptAdvisoryForm() async`

**Context the implementer needs:**
- Mirror the `mtaSts*` members exactly — they are the house pattern for a settings facet (`Sources/AnglesiteApp/PlistEditorModel.swift`, and `Tests/AnglesiteAppTests/PlistEditorModelMTAStsTests.swift` for the test shape).
- **Register the facet in `dirtyFacets`** (the generic aggregation added in #741) so unsaved-changes prompts and `saveAllDirty` pick it up with no per-pane branching.
- `refreshRepoSecurityState()` reads the git remote, then — only for a GitHub remote and only when a token exists — the two GitHub reads. Readiness refreshes on tab load and after a successful PVR enable, never on a timer.
- **Never degrade silently.** A network failure must leave the previous readiness and set `securityReportingError`; it must not fall through to `.notGitHub`, which would falsely claim the site has no GitHub remote.
- `adoptAdvisoryForm()` enables PVR first when readiness is `.needsPVR`, then prepends the form and saves. The view is responsible for confirming before calling it — this method performs the write.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsTests.swift`:

```swift
import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel security reports (#843)")
@MainActor
struct PlistEditorModelSecurityReportsTests {
    /// Records PVR writes and serves canned repo facts. Read and write failures are separate
    /// (a token can read a repo fine and still lack admin to change its settings) and mutable
    /// after construction, so a test can refresh into a good state and *then* break the network.
    actor FakeRepoSecurity: RepoSecurityReading, RepoSecurityWriting {
        private let privateRepo: Bool
        private var pvr: Bool
        private var readFailure: GitHubRepoAPIError?
        private let writeFailure: GitHubRepoAPIError?
        private(set) var enableCalls = 0

        init(
            privateRepo: Bool = false,
            pvr: Bool = true,
            readFailure: GitHubRepoAPIError? = nil,
            writeFailure: GitHubRepoAPIError? = nil
        ) {
            self.privateRepo = privateRepo
            self.pvr = pvr
            self.readFailure = readFailure
            self.writeFailure = writeFailure
        }

        func setReadFailure(_ error: GitHubRepoAPIError?) { readFailure = error }

        func isPrivate(owner: String, name: String, token: String) async throws -> Bool {
            if let readFailure { throw readFailure }
            return privateRepo
        }

        func privateVulnerabilityReporting(owner: String, name: String, token: String) async throws -> Bool {
            if let readFailure { throw readFailure }
            return pvr
        }

        func enablePrivateVulnerabilityReporting(owner: String, name: String, token: String) async throws {
            if let writeFailure { throw writeFailure }
            enableCalls += 1
            pvr = true
        }
    }

    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(
        config: String? = nil,
        remote: String = "https://github.com/acme/site.git\n",
        repoSecurity: any RepoSecurityReading & RepoSecurityWriting = FakeRepoSecurity(),
        token: String? = "tok"
    ) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelSecurityReportsTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        if let config { try config.write(to: directory.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8) }
        return PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test Site",
            sourceDirectory: directory,
            repoSecurity: repoSecurity,
            gitRunner: { _, _ in ProcessSupervisor.RunResult(exitCode: 0, stdout: remote, stderr: "") },
            githubToken: { token })
    }

    @Test("loads the contact list and mode from .site-config")
    func load() async throws {
        let model = try makeModel(config: "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=a@example.com,b@example.com\n")
        await model.load()
        #expect(model.securityReportingSettings == .init(contacts: "a@example.com\nb@example.com", mode: .generated))
        #expect(!model.isSecurityReportingDirty)
    }

    @Test("saves a dirty facet and normalizes what it saved")
    func save() async throws {
        let model = try makeModel()
        await model.load()
        model.securityReportingSettings = .init(contacts: " a@example.com \n\n a@example.com ", mode: .generated)
        #expect(model.isSecurityReportingDirty)
        #expect(await model.saveSecurityReporting())
        #expect(model.securityReportingSettings.contacts == "a@example.com")
        #expect(!model.isSecurityReportingDirty)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_CONTACT=a@example.com"))
    }

    @Test("a dirty facet participates in the aggregate unsaved-changes state")
    func participatesInDirtyFacets() async throws {
        let model = try makeModel()
        await model.load()
        #expect(!model.hasAnyUnsavedEdits)
        model.securityReportingSettings.contacts = "a@example.com"
        #expect(model.hasAnyUnsavedEdits)
    }

    @Test("a public repo with private reporting on is ready")
    func readinessReady() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n")
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .ready)
        #expect(model.securityReportingError == nil)
    }

    @Test("a public repo with private reporting off needs it enabled")
    func readinessNeedsPVR() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(pvr: false))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
    }

    @Test("a private repo offers nothing")
    func readinessPrivateRepo() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(privateRepo: true))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .repoPrivate)
    }

    @Test("a configured-then-privated repo stays configured but records the visibility")
    func readinessConfiguredButPrivate() async throws {
        let model = try makeModel(
            config: "SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new\n",
            repoSecurity: FakeRepoSecurity(privateRepo: true))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(model.securityReportingRepoIsPrivate)
    }

    @Test("a non-GitHub origin is notGitHub and makes no API call")
    func readinessNonGitHubOrigin() async throws {
        let fake = FakeRepoSecurity(readFailure: .network)
        let model = try makeModel(remote: "https://gitlab.com/acme/site.git\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .notGitHub)
        #expect(model.securityReportingError == nil)
    }

    @Test("adopting the form on a ready repo prepends it and saves, without a PVR write")
    func adoptWhenReady() async throws {
        let fake = FakeRepoSecurity()
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        await model.adoptAdvisoryForm()
        #expect(model.securityReportingSettings.contacts
            == "https://github.com/acme/site/security/advisories/new\na@example.com")
        #expect(model.securityReportingReadiness == .alreadyConfigured)
        #expect(await fake.enableCalls == 0)
        let config = try String(contentsOf: model.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_CONTACT=https://github.com/acme/site/security/advisories/new,a@example.com"))
    }

    @Test("adopting the form when PVR is off enables it first")
    func adoptEnablesPVR() async throws {
        let fake = FakeRepoSecurity(pvr: false)
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
        await model.adoptAdvisoryForm()
        #expect(await fake.enableCalls == 1)
        #expect(model.securityReportingReadiness == .alreadyConfigured)
    }

    @Test("a 403 on the PVR write names the missing repo permission and changes nothing")
    func adoptWithoutAdminPermission() async throws {
        // Reads succeed (so readiness lands on .needsPVR); only the write is forbidden — exactly
        // what a token without repo admin looks like.
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n",
                                  repoSecurity: FakeRepoSecurity(pvr: false, writeFailure: .unauthorized))
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .needsPVR)
        await model.adoptAdvisoryForm()
        #expect(model.securityReportingError?.contains("admin") == true)
        #expect(model.securityReportingSettings.contacts == "a@example.com")
        #expect(model.securityReportingReadiness == .needsPVR)
    }

    @Test("a network failure reports the error and keeps the previous readiness")
    func networkFailureKeepsReadiness() async throws {
        let fake = FakeRepoSecurity()
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", repoSecurity: fake)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness == .ready)

        await fake.setReadFailure(.network)
        await model.refreshRepoSecurityState()
        // Must NOT fall through to .notGitHub — that would falsely claim the site has no remote.
        #expect(model.securityReportingReadiness == .ready)
        #expect(model.securityReportingError != nil)
    }

    @Test("no stored token reports the problem rather than claiming there's no GitHub remote")
    func missingToken() async throws {
        let model = try makeModel(config: "SECURITY_CONTACT=a@example.com\n", token: nil)
        await model.load()
        await model.refreshRepoSecurityState()
        #expect(model.securityReportingReadiness != .notGitHub)
        #expect(model.securityReportingError != nil)
    }
}
```

Every test reaches its state through `refreshRepoSecurityState()` rather than assigning `securityReportingReadiness` — that property is `private(set)`, which `@testable` does not open for writing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
swift test --package-path . --filter PlistEditorModelSecurityReportsTests
```

Expected: FAIL to compile — the `repoSecurity:`/`gitRunner:`/`githubToken:` init parameters don't exist.

- [ ] **Step 3: Add the stored properties and dirty flag**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, after the `mtaSts` properties (~line 48):

```swift
    var securityReportingSettings = SecurityReportingAsset.Settings()
    private(set) var savedSecurityReportingSettings = SecurityReportingAsset.Settings()
    private(set) var securityReportingError: String?
    private(set) var isSavingSecurityReporting = false
    private(set) var isCheckingRepoSecurity = false
    private(set) var securityReportingReadiness: SecurityReportingReadiness = .notGitHub
    private(set) var securityReportingRepo: RemoteRepo?
    /// Last known repo visibility. `.alreadyConfigured` doesn't distinguish public from private
    /// (deliberately — the setup is done either way), so the view needs this to warn an owner who
    /// published the advisory form and *then* made the repository private.
    private(set) var securityReportingRepoIsPrivate = false
    private let repoSecurity: any RepoSecurityReading & RepoSecurityWriting
    private let gitRunner: BackupCommand.GitRunner
    private let githubToken: @Sendable () throws -> String?
```

and beside the other dirty flags (~line 55):

```swift
    var isSecurityReportingDirty: Bool {
        securityReportingSettings != savedSecurityReportingSettings && loadError == nil && !isLoading
    }
```

- [ ] **Step 4: Extend `init`**

Add three parameters to `PlistEditorModel.init` after `domainOperations`, and assign them:

```swift
         domainOperations: any DomainOperationsService = DomainOperations(),
         repoSecurity: any RepoSecurityReading & RepoSecurityWriting = HTTPGitHubClient(),
         gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner,
         githubToken: @escaping @Sendable () throws -> String? = { try KeychainStore().readGitHubToken() }) {
```

```swift
        self.repoSecurity = repoSecurity
        self.gitRunner = gitRunner
        self.githubToken = githubToken
```

- [ ] **Step 5: Load the facet**

In `load()`, immediately after the `mtaSts` block:

```swift
            let securityReporting = SecurityReportingAsset.parseSettings(from: config)
            securityReportingSettings = securityReporting
            savedSecurityReportingSettings = securityReporting
            securityReportingError = nil
```

- [ ] **Step 6: Implement save, readiness refresh, and adoption**

Add after `saveMtaSts()`:

```swift
    @discardableResult
    func saveSecurityReporting() async -> Bool {
        guard isSecurityReportingDirty else { return true }
        guard !isSavingSecurityReporting else { return false }
        isSavingSecurityReporting = true
        securityReportingError = nil
        defer { isSavingSecurityReporting = false }
        let sourceDirectory = sourceDirectory
        let settings = securityReportingSettings
        do {
            try await Task.detached(priority: .userInitiated) {
                try SecurityReportingAsset.install(settings, siteDirectory: sourceDirectory)
            }.value
            let canonical = SecurityReportingAsset.Settings(
                contacts: SecurityReportingAsset.normalizedContacts(settings.contacts).joined(separator: "\n"),
                mode: settings.mode)
            securityReportingSettings = canonical
            savedSecurityReportingSettings = canonical
            return true
        } catch {
            securityReportingError = "Couldn’t save security reporting settings: \(error.localizedDescription)"
            return false
        }
    }

    /// Re-reads the site's GitHub remote and the repo settings that decide whether its private
    /// advisory form is usable. Called when the tab loads and after a successful enable — never
    /// on a timer, and never as a side effect of saving.
    func refreshRepoSecurityState() async {
        guard !isCheckingRepoSecurity else { return }
        isCheckingRepoSecurity = true
        defer { isCheckingRepoSecurity = false }
        securityReportingError = nil

        let repo = await currentRemoteRepo()
        securityReportingRepo = repo
        guard let repo else {
            securityReportingReadiness = .notGitHub
            return
        }

        let token: String?
        do {
            token = try githubToken()
        } catch {
            securityReportingError = "Couldn’t read the GitHub token from the Keychain: \(error.localizedDescription)"
            return
        }
        guard let token, !token.isEmpty else {
            securityReportingError = "Connect a GitHub account in Settings to check this repository’s reporting setup."
            return
        }

        do {
            // A failure here must not fall through to `.notGitHub` — that would falsely claim the
            // site has no GitHub remote when the truth is "we couldn't check".
            let isPrivate = try await repoSecurity.isPrivate(owner: repo.owner, name: repo.name, token: token)
            let pvrEnabled = try await repoSecurity.privateVulnerabilityReporting(
                owner: repo.owner, name: repo.name, token: token)
            securityReportingRepoIsPrivate = isPrivate
            securityReportingReadiness = .evaluate(
                repo: repo, isPrivate: isPrivate, pvrEnabled: pvrEnabled,
                contacts: securityReportingSettings.contacts)
        } catch {
            securityReportingError = repoSecurityMessage(for: error)
        }
    }

    /// Publishes the repo's advisory form as the most-preferred contact, enabling private
    /// vulnerability reporting first when it's off. The view confirms before calling this —
    /// enabling PVR changes a GitHub repository setting.
    func adoptAdvisoryForm() async {
        guard let repo = securityReportingRepo else { return }
        securityReportingError = nil

        if securityReportingReadiness == .needsPVR {
            let token: String?
            do { token = try githubToken() } catch {
                securityReportingError = "Couldn’t read the GitHub token from the Keychain: \(error.localizedDescription)"
                return
            }
            guard let token, !token.isEmpty else {
                securityReportingError = "Connect a GitHub account in Settings to enable private vulnerability reporting."
                return
            }
            do {
                try await repoSecurity.enablePrivateVulnerabilityReporting(
                    owner: repo.owner, name: repo.name, token: token)
            } catch {
                securityReportingError = repoSecurityMessage(for: error)
                return
            }
        }

        securityReportingSettings.contacts = SecurityReportingAsset.prependingAdvisoryForm(
            securityReportingSettings.contacts, repo: repo)
        if securityReportingSettings.mode == .disabled { securityReportingSettings.mode = .generated }
        guard await saveSecurityReporting() else { return }
        securityReportingReadiness = .alreadyConfigured
    }

    private func currentRemoteRepo() async -> RemoteRepo? {
        guard let result = try? await gitRunner(sourceDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }

    private func repoSecurityMessage(for error: any Error) -> String {
        guard let apiError = error as? GitHubRepoAPIError else {
            return "Couldn’t check this repository’s reporting setup: \(error.localizedDescription)"
        }
        switch apiError {
        case .unauthorized:
            return "Your GitHub token doesn’t have admin access to this repository. Enable private vulnerability reporting in the repository’s Settings ▸ Advanced Security, or use a token with Administration: Read and write."
        case .network:
            return "Couldn’t reach GitHub. Check your connection and try again."
        case .http(let status):
            return "GitHub returned an unexpected response (HTTP \(status))."
        case .api(let message):
            return "GitHub rejected the request: \(message)"
        case .malformedResponse, .nameAlreadyExists:
            return "GitHub returned an unexpected response."
        }
    }
```

- [ ] **Step 7: Register the facet in `dirtyFacets`**

In `dirtyFacets`, add a row after the MTA-STS one:

```swift
            DirtyFacet(isDirty: isSecurityReportingDirty, isSaving: isSavingSecurityReporting) { await self.saveSecurityReporting() },
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
swift test --package-path . --filter PlistEditorModelSecurityReportsTests
```

Expected: PASS — 13 tests.

- [ ] **Step 9: Run the neighboring facet suites for regressions**

```bash
swift test --package-path . --filter PlistEditorModel
```

Expected: PASS — the MTA-STS, crawler-policy, redirects, and dirty-facet suites all still green (the last one asserts the aggregation is generic, so a new facet must not break it).

- [ ] **Step 10: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsTests.swift
git commit -m "feat(#843): security-reporting facet in PlistEditorModel"
```

---

## Task 7: Security Reports tab

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift` — `SettingsTab` enum (`:9-14`), the cross-tab error strip (~`:105-125`), the tab `switch` (`:126-137`), and a new `securityReportsTab` view next to `emailSecurityTab` (~`:392`)
- Modify: `Sources/AnglesiteApp/Localizable.xcstrings` (via the documented merge, not by hand)

**Interfaces:**
- Consumes, from Task 6: `model.securityReportingSettings`, `model.securityReportingError`, `model.isSavingSecurityReporting`, `model.isCheckingRepoSecurity`, `model.securityReportingReadiness`, `model.securityReportingRepo`, `model.securityReportingRepoIsPrivate`, `model.refreshRepoSecurityState()`, `model.adoptAdvisoryForm()`. From Task 2: `SecurityReportingAsset.Mode` and `.advisoryURL(for:)`. From Task 3: `SecurityReportingReadiness`.
- Produces: no API consumed by later tasks.

**Context the implementer needs:**
- Mirror the `mtaStsSection` layout in the same file: a headline + explanatory `Text`, a `Grid` of labelled rows, `TextEditor` for the multi-line field with the same overlay/frame/accessibility treatment, and a callout block with `.padding(10)`, `Color.secondary.opacity(0.06)` background, and a rounded clip shape.
- The tab is named **Security Reports** to distinguish it from the existing **Email Security** tab (SPF/DKIM/DMARC/MTA-STS), which is about mail authentication rather than vulnerability reporting.
- **The PVR enable is confirmed before the write.** Use a `.confirmationDialog` — it changes a setting on a GitHub repository, an outward-facing side effect.
- New user-visible strings mean running the `xcstringstool sync` recipe in `CONTRIBUTING.md` ▸ "Development setup" after building, always with `--skip-marking-strings-stale`, and reviewing the `.xcstrings` diff before committing it.

- [ ] **Step 1: Add the tab case**

In `Sources/AnglesiteApp/PlistEditorView.swift`, extend the enum:

```swift
        case emailSecurity = "Email Security"
        case securityReports = "Security Reports"
```

and the `switch`:

```swift
                    case .emailSecurity:
                        emailSecurityTab
                    case .securityReports:
                        securityReportsTab
```

- [ ] **Step 2: Surface the facet's error from other tabs**

Alongside the existing `selectedTab != .analytics` / `!= .redirects` strips:

```swift
                    if selectedTab != .securityReports, let securityReportingError = model.securityReportingError {
                        Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
```

- [ ] **Step 3: Build the tab**

Add near `emailSecurityTab`:

```swift
    @State private var isConfirmingEnablePVR = false

    private var securityReportsTab: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Vulnerability reports")
                    .font(.headline)
                Text("Publish where security researchers should report problems with this site. Anglesite writes an RFC 9116 security.txt from these settings; the first contact is the one researchers should try first.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                GridRow {
                    Text("Publishing").frame(minWidth: 160, alignment: .leading)
                    Picker("Publishing", selection: $model.securityReportingSettings.mode) {
                        Text("Generated by Anglesite").tag(SecurityReportingAsset.Mode.generated)
                        Text("Hand-authored").tag(SecurityReportingAsset.Mode.manual)
                        Text("Off").tag(SecurityReportingAsset.Mode.disabled)
                    }
                    .labelsHidden()
                    .frame(width: 220, alignment: .leading)
                }
                GridRow(alignment: .top) {
                    Text("Contacts").frame(minWidth: 160, alignment: .leading).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 6) {
                        TextEditor(text: $model.securityReportingSettings.contacts)
                            .font(.body.monospaced())
                            .frame(minWidth: 260, minHeight: 72)
                            .overlay { RoundedRectangle(cornerRadius: 5).stroke(.secondary.opacity(0.25)) }
                            .accessibilityLabel("Security contacts")
                        Text("One per line, most preferred first. An email address, or an https:// page where reports are accepted.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            securityReportsGitHubCallout

            if let securityReportingError = model.securityReportingError {
                Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            if model.isSavingSecurityReporting || model.isCheckingRepoSecurity {
                ProgressView().controlSize(.small)
            }
        }
        .task { await model.refreshRepoSecurityState() }
    }

    @ViewBuilder
    private var securityReportsGitHubCallout: some View {
        if let repo = model.securityReportingRepo {
            VStack(alignment: .leading, spacing: 6) {
                Label("GitHub", systemImage: "shield.lefthalf.filled")
                    .font(.headline)
                switch model.securityReportingReadiness {
                case .alreadyConfigured:
                    Text("Reports go to \(repo.owner)/\(repo.name)’s private advisory form.")
                        .font(.callout)
                    Link("Open the advisory form", destination: SecurityReportingAsset.advisoryURL(for: repo))
                        .font(.callout)
                    if model.securityReportingRepoIsPrivate {
                        Label("\(repo.owner)/\(repo.name) is now private, so researchers outside it can’t reach this form. Make the repository public, or publish a different contact.", systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(.orange)
                    }
                case .ready:
                    Text("\(repo.owner)/\(repo.name) accepts private vulnerability reports. Routing reports there keeps them out of public issues and off your inbox.")
                        .font(.callout)
                    Button("Route Reports to GitHub") { Task { await model.adoptAdvisoryForm() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting)
                case .needsPVR:
                    Text("\(repo.owner)/\(repo.name) has private vulnerability reporting turned off, so its advisory form can’t accept reports yet. Anglesite can turn it on for you.")
                        .font(.callout)
                    Button("Enable Private Reporting and Route Reports") { isConfirmingEnablePVR = true }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.isCheckingRepoSecurity || model.isSavingSecurityReporting)
                case .repoPrivate:
                    Text("\(repo.owner)/\(repo.name) is a private repository, so its advisory form isn’t reachable by anyone outside it. Make the repository public to route reports there.")
                        .font(.callout)
                case .notGitHub:
                    EmptyView()
                }
            }
            .padding(10)
            .background(Color.secondary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .confirmationDialog(
                "Turn on private vulnerability reporting for \(repo.owner)/\(repo.name)?",
                isPresented: $isConfirmingEnablePVR,
                titleVisibility: .visible
            ) {
                Button("Turn On and Route Reports") { Task { await model.adoptAdvisoryForm() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This changes a setting on the GitHub repository. Anglesite never turns it back off.")
            }
        }
    }
```

- [ ] **Step 4: Build the app target**

```bash
xcodegen generate && xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Expected: BUILD SUCCEEDED. (`Anglesite.xcodeproj` is gitignored and must be regenerated in a fresh worktree. If the build fails on "Check container resources", rsync `Resources/container-{image,kernel,initfs}` from the main checkout.)

- [ ] **Step 5: Merge the String Catalog**

Per `CONTRIBUTING.md`, a CLI-only build emits `.stringsdata` but never merges it:

```bash
xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings --stringsdata $(find ~/Library/Developer/Xcode/DerivedData/Anglesite-*/Build/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64 -name "*.stringsdata") --skip-marking-strings-stale
```

Then review the `.xcstrings` diff by hand: it must add the new Security Reports strings and nothing else. If it looks like a mass deletion, do not commit it — run a clean build first and re-review.

- [ ] **Step 6: Verify the tab in the running app**

Open a site, choose **Website Settings**, and check the **Security Reports** tab renders, the contacts editor round-trips a save, and the GitHub callout matches the repo's real state. This is the one step tests can't cover — the model suites verify the logic, not the layout.

- [ ] **Step 7: Run the full suites**

```bash
swift test --package-path .
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorView.swift Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "feat(#843): add Security Reports settings tab"
```

---

## Final verification

- [ ] **Re-check the changed files against `CONTRIBUTING.md`.**

- [ ] **Run every suite the change touches:**

```bash
swift test --package-path .
```

```bash
cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts && npx tsx --test scripts/pre-deploy-check.test.ts
```

```bash
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

- [ ] **Open the PR** using `.github/PULL_REQUEST_TEMPLATE.md`'s **actual** headings — **Summary**, **Paired PR check**, **Test plan** — copied from the file, not a generic Summary/Test-plan body. Under **Paired PR check**, state that this is app-only: `Resources/Template/` changes need no sidecar PR, and no MCP message schema changed.

- [ ] **Remove the in-flight label** once the PR is open:

```bash
gh issue edit 843 --remove-label "🛠️ In Progress"
```
