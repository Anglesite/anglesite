# anglesite.json Schema + Swift/TS Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the git-tracked declared-intent file `Source/anglesite.json` — a versioned, unknown-key-preserving JSON schema with a Swift `DomainConfig` model + `DomainConfigStore`, a template-side TypeScript reader, and a schema doc. Ships inert: nothing calls the writer or reads a section into the build yet.

**Architecture:** Follows the `redirects.json`/`RedirectsStore` and `robots-config.json`/`RobotsConfigStore` precedent in `Sources/AnglesiteCore/`: a pure Codable data model, a store that owns file I/O rooted at the site's `Source/` directory (not `Config/`), and a template-side TypeScript reader that never fails a build. The one thing neither precedent does — and this schema explicitly requires — is preserving JSON keys the current app binary doesn't model, so a hand edit or a newer app version's field survives being loaded and re-saved by this one. That's implemented as a JSON-tree merge on save, reusing the existing `JSONValue` type (`Sources/AnglesiteCore/MCPClient.swift`) rather than inventing a new one.

**Tech Stack:** Swift 6.4 (Foundation `Codable`, `JSONSerialization`), TypeScript (`node:fs`, `node:test`).

## Global Constraints

- File location/name is settled: `Source/anglesite.json` (investigation doc §7.1) — not `Config/`, not any other name.
- Every top-level section (`domain`/`dns`/`edge`/`email`/`workers`) is optional, and `version` defaults to `1` when absent; an absent file means "no declarations" (§5.6). Fields *within* a present section's array items (a DNS record, a WAF rule) may themselves be required — see the §5.2 sketch and `DomainConfig.swift`'s `DNSRecord`/`WAFRule`.
- Never put secrets, tokens, zone/account IDs, provisioned resource IDs, or unmanaged pre-existing DNS records in this file (§5.2).
- `save(_:)` must preserve unknown keys (both unrecognized top-level sections and unrecognized fields inside a known section); malformed/invalid JSON on `load()` must throw rather than silently degrade (§5.5).
- The `edge` section serializes exactly what the app applied, never an aspirational target (§7.2) — this slice only models the shape; nothing writes to it yet.
- No paired sidecar PR is needed — this is app + template only, no MCP schema change (§5.6).
- Test with `swift test --package-path .` (Swift) and `npm test` from `Resources/Template/` (TypeScript), per `CONTRIBUTING.md` ▸ "Testing".
- Commits: Conventional Commits, subject ≤72 characters, reference `#1169`.

---

## File Structure

- `Sources/AnglesiteCore/DomainConfig.swift` — new. Pure Codable data model: `DomainConfig` + nested `Domain`, `DNS`/`DNSRecord`, `Edge`/`HSTS`/`CloudflareEdge`/`WAFRule`, `Email`, `Workers`.
- `Sources/AnglesiteCore/DomainConfigStore.swift` — new. File I/O rooted at `sourceDirectory`, with the unknown-key-preserving merge-on-save logic.
- `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift` — new. Swift Testing suite covering load/save round-trip, missing file, malformed JSON, missing `version`, and both unknown-key-preservation cases.
- `Resources/Template/scripts/anglesite-config.ts` — new. Template-side reader, mirroring `redirects.ts`'s tolerant read pattern.
- `Resources/Template/scripts/anglesite-config.test.ts` — new. `node:test` suite mirroring `redirects.test.ts`.
- `docs/anglesite-json-schema.md` — new. Schema reference for site owners/tool authors.

No existing file needs modification: both `Package.swift` (globs `Sources/AnglesiteCore` and `Tests/AnglesiteCoreTests` by path) and the template's `package.json` test script (globs `scripts/**/*.test.ts`) already pick up new files automatically.

---

### Task 1: `DomainConfig` model + `DomainConfigStore`

**Files:**
- Create: `Sources/AnglesiteCore/DomainConfig.swift`
- Create: `Sources/AnglesiteCore/DomainConfigStore.swift`
- Test: `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift`

**Interfaces:**
- Produces: `DomainConfig` (public struct, `Codable, Equatable, Sendable`, memberwise `init(version: Int = 1, domain: Domain? = nil, dns: DNS? = nil, edge: Edge? = nil, email: Email? = nil, workers: Workers? = nil)`) and its nested types `DomainConfig.Domain`, `DomainConfig.DNS`, `DomainConfig.DNSRecord`, `DomainConfig.Edge`, `DomainConfig.Edge.HSTS`, `DomainConfig.Edge.CloudflareEdge`, `DomainConfig.Edge.WAFRule`, `DomainConfig.Email`, `DomainConfig.Workers`.
- Produces: `DomainConfigStore` (public struct, `Sendable`, `init(sourceDirectory: URL, fileManager: FileManager = .default)`, `func load() throws -> DomainConfig`, `func save(_ config: DomainConfig) throws`).
- Consumes: `JSONValue` (existing type, `Sources/AnglesiteCore/MCPClient.swift`) — `.object([String: JSONValue])` case, `static func from(_ value: Any) -> JSONValue?`, `var rawValue: Any`. Same module, no import needed.

- [ ] **Step 1: Write the model file**

Create `Sources/AnglesiteCore/DomainConfig.swift`:

```swift
import Foundation

/// The declared-intent model for `Source/anglesite.json` (#1169) — what the app has actually
/// applied to a site's domain, DNS, edge hardening, email, and Workers configuration. Every
/// field is optional except ``version``: an absent file means "no declarations," and each
/// section is only present once something has actually written to it. See the investigation
/// doc (`docs/superpowers/specs/2026-07-31-domain-config-in-git-investigation.md` §5.2) for the
/// schema rationale and the explicit exclusions (secrets, tokens, account/zone/resource IDs,
/// and unmanaged pre-existing DNS records never appear here).
///
/// This type only models the data; ``DomainConfigStore`` owns reading and writing
/// `anglesite.json` itself, including preserving keys this version of the app doesn't know
/// about (git is the source of truth — hand edits and future schema fields must survive a
/// round trip through an app that predates them).
public struct DomainConfig: Equatable, Sendable {
    /// The schema version. Always written; tolerated as absent on read (defaults to `1`) so a
    /// file hand-authored before this field existed still loads.
    public var version: Int
    public var domain: Domain?
    public var dns: DNS?
    public var edge: Edge?
    public var email: Email?
    public var workers: Workers?

    public init(
        version: Int = 1,
        domain: Domain? = nil,
        dns: DNS? = nil,
        edge: Edge? = nil,
        email: Email? = nil,
        workers: Workers? = nil
    ) {
        self.version = version
        self.domain = domain
        self.dns = dns
        self.edge = edge
        self.email = email
        self.workers = workers
    }

    /// The owner's declared hostname and attachment intent — replaces the `DOMAIN`/`DOMAIN_CHOICE`
    /// precedence dance in `.site-config` (see `SiteConfigFile`).
    public struct Domain: Codable, Equatable, Sendable {
        public var hostname: String?
        /// `"buy" | "transfer" | "later"` — kept as an open string (not a closed `enum`) so an
        /// unrecognized value from a future app version or a hand edit degrades gracefully for
        /// the reader instead of failing the whole document to decode.
        public var choice: String?
        public var attach: Bool?

        public init(hostname: String? = nil, choice: String? = nil, attach: Bool? = nil) {
            self.hostname = hostname
            self.choice = choice
            self.attach = attach
        }
    }

    /// DNS records the app created and therefore owns — never a mirror of the owner's whole
    /// zone (investigation doc §5.2/§5.3).
    public struct DNS: Codable, Equatable, Sendable {
        public var managedRecords: [DNSRecord]?

        public init(managedRecords: [DNSRecord]? = nil) {
            self.managedRecords = managedRecords
        }
    }

    /// One app-managed DNS record. `purpose` mirrors the `comment` tag the app stamps on the
    /// live Cloudflare record (e.g. `"email:icloud"`, `"verification:bluesky"`) so declared and
    /// live records can be joined during reconciliation (§5.3).
    public struct DNSRecord: Codable, Equatable, Sendable {
        public var type: String
        public var name: String
        public var content: String
        public var priority: Int?
        public var purpose: String?

        public init(type: String, name: String, content: String, priority: Int? = nil, purpose: String? = nil) {
            self.type = type
            self.name = name
            self.content = content
            self.priority = priority
            self.purpose = purpose
        }
    }

    /// The applied edge-hardening posture — provider-agnostic knobs at this level, Cloudflare-only
    /// ones under ``cloudflare``. Per the owner decision (investigation doc §7.2), this always
    /// serializes exactly the plan the app applied, never an aspirational target.
    public struct Edge: Codable, Equatable, Sendable {
        public var dnssec: Bool?
        public var alwaysUseHTTPS: Bool?
        public var hsts: HSTS?
        public var cloudflare: CloudflareEdge?

        public init(dnssec: Bool? = nil, alwaysUseHTTPS: Bool? = nil, hsts: HSTS? = nil, cloudflare: CloudflareEdge? = nil) {
            self.dnssec = dnssec
            self.alwaysUseHTTPS = alwaysUseHTTPS
            self.hsts = hsts
            self.cloudflare = cloudflare
        }

        public struct HSTS: Codable, Equatable, Sendable {
            public var maxAge: Int?
            public var includeSubdomains: Bool?
            public var preload: Bool?

            public init(maxAge: Int? = nil, includeSubdomains: Bool? = nil, preload: Bool? = nil) {
                self.maxAge = maxAge
                self.includeSubdomains = includeSubdomains
                self.preload = preload
            }
        }

        public struct CloudflareEdge: Codable, Equatable, Sendable {
            public var botFightMode: Bool?
            public var wafRules: [WAFRule]?

            public init(botFightMode: Bool? = nil, wafRules: [WAFRule]? = nil) {
                self.botFightMode = botFightMode
                self.wafRules = wafRules
            }
        }

        /// One Cloudflare WAF custom rule the app applied. Cloudflare-shaped by design —
        /// `cloudflare` is the only provider-specific pocket in the schema (§5.2).
        public struct WAFRule: Codable, Equatable, Sendable {
            public var description: String
            public var expression: String
            public var action: String

            public init(description: String, expression: String, action: String) {
                self.description = description
                self.expression = expression
                self.action = action
            }
        }
    }

    public struct Email: Codable, Equatable, Sendable {
        public var provider: String?
        public var dmarcReportEmail: String?

        public init(provider: String? = nil, dmarcReportEmail: String? = nil) {
            self.provider = provider
            self.dmarcReportEmail = dmarcReportEmail
        }
    }

    /// The owner's active Worker set — moves out of `Config/settings.plist.activeWorkerIDs` in a
    /// later slice (#1172); this slice only models the shape.
    public struct Workers: Codable, Equatable, Sendable {
        public var active: [String]?

        public init(active: [String]? = nil) {
            self.active = active
        }
    }
}

extension DomainConfig: Codable {
    private enum CodingKeys: String, CodingKey {
        case version, domain, dns, edge, email, workers
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        domain = try container.decodeIfPresent(Domain.self, forKey: .domain)
        dns = try container.decodeIfPresent(DNS.self, forKey: .dns)
        edge = try container.decodeIfPresent(Edge.self, forKey: .edge)
        email = try container.decodeIfPresent(Email.self, forKey: .email)
        workers = try container.decodeIfPresent(Workers.self, forKey: .workers)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(domain, forKey: .domain)
        try container.encodeIfPresent(dns, forKey: .dns)
        try container.encodeIfPresent(edge, forKey: .edge)
        try container.encodeIfPresent(email, forKey: .email)
        try container.encodeIfPresent(workers, forKey: .workers)
    }
}
```

- [ ] **Step 2: Write the store file**

Create `Sources/AnglesiteCore/DomainConfigStore.swift`:

```swift
import Foundation

/// Reads/writes `Source/anglesite.json` (#1169) — the git-tracked declared-intent file for a
/// site's domain, DNS, edge hardening, email, and Worker configuration. Rooted at
/// `sourceDirectory` (the `Source/` git repo), not `Config/`, following `RedirectsStore`:
/// this is site content the owner's clone must see, not app-private state.
///
/// `save(_:)` preserves any JSON key this version of the app doesn't model — both unrecognized
/// top-level sections and unrecognized fields inside a section it does know — so a hand edit or
/// a field written by a newer app version survives being loaded and re-saved by an older one.
/// This is what "unknown-key-preserving" (investigation doc §7) means in practice: only the
/// exact fields `DomainConfig` declares are ever overwritten; everything else in the existing
/// file rides along untouched.
public struct DomainConfigStore: Sendable {
    private let fileURL: URL
    private let fileManager: FileManager

    /// `fileManager` is injectable for tests.
    public init(sourceDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = sourceDirectory.appendingPathComponent("anglesite.json")
        self.fileManager = fileManager
    }

    /// A default, all-`nil`-sections `DomainConfig` when the file is absent — the normal "no
    /// declarations yet" case (investigation doc §5.6).
    ///
    /// - Throws: The underlying `DecodingError` when the file exists but isn't valid JSON or
    ///   doesn't match the schema — invalid files fail with a fix-it rather than being silently
    ///   dropped (§5.5), unlike the unknown-key tolerance `save(_:)` applies to *valid* JSON.
    public func load() throws -> DomainConfig {
        guard fileManager.fileExists(atPath: fileURL.path) else { return DomainConfig() }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(DomainConfig.self, from: data)
    }

    /// Writes `config`, merging it over whatever is already on disk so unknown keys survive.
    /// Pretty-printed and sorted (matching `RedirectsStore`/`RobotsConfigStore`) so re-saving
    /// unchanged content produces a minimal git diff, and atomic so a crash mid-write can never
    /// leave a truncated `anglesite.json` behind.
    public func save(_ config: DomainConfig) throws {
        let newData = try JSONEncoder().encode(config)
        let newFields = Self.objectFields(fromJSONData: newData)

        var existingFields: [String: JSONValue] = [:]
        if let existingData = try? Data(contentsOf: fileURL) {
            existingFields = Self.objectFields(fromJSONData: existingData)
        }

        let merged = Self.merge(newFields, into: existingFields)
        let mergedData = try JSONSerialization.data(
            withJSONObject: JSONValue.object(merged).rawValue,
            options: [.prettyPrinted, .sortedKeys]
        )
        try mergedData.write(to: fileURL, options: .atomic)
    }

    /// Parses `data` as a JSON object into `JSONValue` fields, or `[:]` for anything that isn't
    /// well-formed JSON object data. Used for both the freshly-encoded `config` (which always
    /// succeeds — a struct with named properties always encodes to a JSON object) and the
    /// existing on-disk file (which may be absent or hand-broken, where "nothing to preserve"
    /// is the correct fallback).
    private static func objectFields(fromJSONData data: Data) -> [String: JSONValue] {
        guard let any = try? JSONSerialization.jsonObject(with: data),
              case .object(let fields)? = JSONValue.from(any) else {
            return [:]
        }
        return fields
    }

    /// Deep-merges `new` over `old`: a key present in both whose values are both JSON objects is
    /// merged recursively; any other key in `new` (scalar, array, or a value whose old
    /// counterpart isn't an object) replaces the old value outright; a key only in `old` is left
    /// untouched. This is the mechanism behind `save(_:)`'s unknown-key preservation.
    private static func merge(_ new: [String: JSONValue], into old: [String: JSONValue]) -> [String: JSONValue] {
        var result = old
        for (key, newValue) in new {
            if case .object(let newNested) = newValue, case .object(let oldNested)? = old[key] {
                result[key] = .object(merge(newNested, into: oldNested))
            } else {
                result[key] = newValue
            }
        }
        return result
    }
}
```

- [ ] **Step 3: Write the test suite**

Create `Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("DomainConfigStore")
struct DomainConfigStoreTests {
    private func tempSourceDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DomainConfigStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("load on a missing file returns a default config, not a throw")
    func loadMissingReturnsDefault() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = DomainConfigStore(sourceDirectory: dir)
        #expect(try store.load() == DomainConfig())
    }

    @Test("save then load round-trips a fully populated config")
    func saveLoadRoundTrips() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = DomainConfigStore(sourceDirectory: dir)
        let config = DomainConfig(
            version: 1,
            domain: .init(hostname: "example.com", choice: "transfer", attach: true),
            dns: .init(managedRecords: [
                .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud"),
            ]),
            edge: .init(
                dnssec: true,
                alwaysUseHTTPS: true,
                hsts: .init(maxAge: 31536000, includeSubdomains: true, preload: false),
                cloudflare: .init(botFightMode: true, wafRules: [
                    .init(description: "Block bad bots", expression: "cf.client.bot", action: "block"),
                ])
            ),
            email: .init(provider: "icloud", dmarcReportEmail: "postmaster@example.com"),
            workers: .init(active: ["webmention-receive", "micropub"])
        )
        try store.save(config)
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("anglesite.json").path))
        #expect(try store.load() == config)
    }

    @Test("load throws on malformed JSON")
    func loadThrowsOnMalformedJSON() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try "not json {".write(to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8)
        let store = DomainConfigStore(sourceDirectory: dir)
        #expect(throws: (any Error).self) { try store.load() }
    }

    @Test("load defaults version to 1 when the file omits it")
    func loadDefaultsMissingVersion() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try #"{"domain":{"hostname":"example.com"}}"#.write(
            to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8
        )
        let store = DomainConfigStore(sourceDirectory: dir)
        let config = try store.load()
        #expect(config.version == 1)
        #expect(config.domain?.hostname == "example.com")
    }

    @Test("save preserves an unrecognized top-level key")
    func savePreservesUnknownTopLevelKey() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("anglesite.json")
        try #"{"version":1,"futureSection":{"foo":"bar"}}"#.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = DomainConfigStore(sourceDirectory: dir)
        try store.save(DomainConfig(domain: .init(hostname: "example.com")))

        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [String: Any]
        let future = raw?["futureSection"] as? [String: Any]
        #expect(future?["foo"] as? String == "bar")
        #expect((raw?["domain"] as? [String: Any])?["hostname"] as? String == "example.com")
    }

    @Test("save preserves an unrecognized key nested inside a known section")
    func savePreservesUnknownNestedKey() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("anglesite.json")
        try #"{"version":1,"domain":{"hostname":"old.example.com","futureField":"x"}}"#.write(
            to: fileURL, atomically: true, encoding: .utf8
        )

        let store = DomainConfigStore(sourceDirectory: dir)
        try store.save(DomainConfig(domain: .init(hostname: "new.example.com")))

        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [String: Any]
        let domain = raw?["domain"] as? [String: Any]
        #expect(domain?["hostname"] as? String == "new.example.com")
        #expect(domain?["futureField"] as? String == "x")
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `swift test --package-path . --filter DomainConfigStoreTests`
Expected: All 7 tests in `DomainConfigStoreTests` PASS. (Per repo convention, `--filter` still compiles the whole package — a pre-existing unrelated failure elsewhere is not this task's concern, but every `DomainConfigStoreTests` case must be green.)

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DomainConfig.swift Sources/AnglesiteCore/DomainConfigStore.swift Tests/AnglesiteCoreTests/DomainConfigStoreTests.swift
git commit -m "feat(#1169): add DomainConfig model and DomainConfigStore"
```

---

### Task 2: Template-side TypeScript reader

**Files:**
- Create: `Resources/Template/scripts/anglesite-config.ts`
- Test: `Resources/Template/scripts/anglesite-config.test.ts`

**Interfaces:**
- Produces: `readAnglesiteConfig(siteRoot: string): AnglesiteConfig` and the exported types `AnglesiteConfig`, `AnglesiteDomainConfig`, `AnglesiteDNSRecord`, `AnglesiteDNSConfig`, `AnglesiteHSTSConfig`, `AnglesiteWAFRule`, `AnglesiteCloudflareEdgeConfig`, `AnglesiteEdgeConfig`, `AnglesiteEmailConfig`, `AnglesiteWorkersConfig`.
- Consumes: nothing from Task 1 (independent language, mirrors the same schema by hand — same relationship `redirects.ts`'s `RedirectEntry` has to Swift's `RedirectsStore.RedirectEntry`).

- [ ] **Step 1: Write the failing test**

Create `Resources/Template/scripts/anglesite-config.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAnglesiteConfig } from "./anglesite-config";

/// Temporarily replaces `console.warn` for the duration of `fn`, recording calls, then restores it.
function withWarnSpy<T>(fn: (calls: unknown[][]) => T): T {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    return fn(calls);
  } finally {
    console.warn = original;
  }
}

function makeTempSiteRoot(): string {
  return mkdtempSync(join(tmpdir(), "anglesite-config-test-"));
}

test("readAnglesiteConfig: missing file returns the default config quietly, without warning", () => {
  const siteRoot = makeTempSiteRoot();
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.equal(calls.length, 0, "console.warn should not be called when anglesite.json is simply absent");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: present-but-invalid JSON returns the default and warns", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), "not json {");
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.ok(calls.length >= 1, "console.warn should be called when anglesite.json exists but fails to parse");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: a JSON array root returns the default and warns", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), "[]");
  try {
    const calls = withWarnSpy((calls) => {
      const result = readAnglesiteConfig(siteRoot);
      assert.deepEqual(result, { version: 1 });
      return calls;
    });
    assert.ok(calls.length >= 1, "console.warn should be called when anglesite.json isn't a JSON object");
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: returns declared sections as-is", () => {
  const siteRoot = makeTempSiteRoot();
  const raw = JSON.stringify({
    version: 1,
    domain: { hostname: "example.com", choice: "transfer", attach: true },
    workers: { active: ["webmention-receive"] },
  });
  writeFileSync(join(siteRoot, "anglesite.json"), raw);
  try {
    const result = readAnglesiteConfig(siteRoot);
    assert.deepEqual(result, {
      version: 1,
      domain: { hostname: "example.com", choice: "transfer", attach: true },
      workers: { active: ["webmention-receive"] },
    });
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});

test("readAnglesiteConfig: defaults version to 1 when the file omits it", () => {
  const siteRoot = makeTempSiteRoot();
  writeFileSync(join(siteRoot, "anglesite.json"), JSON.stringify({ domain: { hostname: "example.com" } }));
  try {
    const result = readAnglesiteConfig(siteRoot);
    assert.equal(result.version, 1);
    assert.deepEqual(result.domain, { hostname: "example.com" });
  } finally {
    rmSync(siteRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `Resources/Template/`): `npx tsx --test scripts/anglesite-config.test.ts`
Expected: FAIL — `Cannot find module './anglesite-config'` (the module doesn't exist yet).

- [ ] **Step 3: Write the reader**

Create `Resources/Template/scripts/anglesite-config.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AnglesiteDomainConfig {
  hostname?: string;
  choice?: string;
  attach?: boolean;
}

export interface AnglesiteDNSRecord {
  type: string;
  name: string;
  content: string;
  priority?: number;
  purpose?: string;
}

export interface AnglesiteDNSConfig {
  managedRecords?: AnglesiteDNSRecord[];
}

export interface AnglesiteHSTSConfig {
  maxAge?: number;
  includeSubdomains?: boolean;
  preload?: boolean;
}

export interface AnglesiteWAFRule {
  description: string;
  expression: string;
  action: string;
}

export interface AnglesiteCloudflareEdgeConfig {
  botFightMode?: boolean;
  wafRules?: AnglesiteWAFRule[];
}

export interface AnglesiteEdgeConfig {
  dnssec?: boolean;
  alwaysUseHTTPS?: boolean;
  hsts?: AnglesiteHSTSConfig;
  cloudflare?: AnglesiteCloudflareEdgeConfig;
}

export interface AnglesiteEmailConfig {
  provider?: string;
  dmarcReportEmail?: string;
}

export interface AnglesiteWorkersConfig {
  active?: string[];
}

/// The `Source/anglesite.json` shape this reader hands back. Mirrors the Swift `DomainConfig`
/// model (`Sources/AnglesiteCore/DomainConfig.swift`) field-for-field; kept as a hand-written
/// parallel type rather than a generated one, matching how `RedirectEntry` in `redirects.ts`
/// mirrors its Swift counterpart.
export interface AnglesiteConfig {
  version: number;
  domain?: AnglesiteDomainConfig;
  dns?: AnglesiteDNSConfig;
  edge?: AnglesiteEdgeConfig;
  email?: AnglesiteEmailConfig;
  workers?: AnglesiteWorkersConfig;
}

const DEFAULT_CONFIG: AnglesiteConfig = { version: 1 };

/// Reads `anglesite.json` from the site root. Returns the default (`{ version: 1 }`, no
/// sections) when the file is missing — the normal case for a site with no declarations yet —
/// or when it exists but fails to parse or isn't a JSON object, warning via `console.warn` in
/// the latter two cases so the site owner notices without ever failing the build. This slice
/// ships inert: no template code consumes the returned sections yet, so this function only
/// validates the document's outer shape, not each section's individual fields — the same
/// tolerance `readRedirects` applies to individually malformed entries, one level up.
export function readAnglesiteConfig(siteRoot: string): AnglesiteConfig {
  const path = resolve(siteRoot, "anglesite.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[anglesite-config] anglesite.json exists but is not valid JSON: ${err}`);
    return DEFAULT_CONFIG;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[anglesite-config] anglesite.json must contain a JSON object; ignoring its contents.");
    return DEFAULT_CONFIG;
  }

  const config = parsed as Partial<AnglesiteConfig>;
  return {
    ...config,
    version: typeof config.version === "number" ? config.version : 1,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `Resources/Template/`): `npx tsx --test scripts/anglesite-config.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run lint and typecheck**

Run (from `Resources/Template/`): `npm run lint && npm run typecheck`
Expected: No errors introduced by the new file.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/scripts/anglesite-config.ts Resources/Template/scripts/anglesite-config.test.ts
git commit -m "feat(#1169): add template-side anglesite.json reader"
```

---

### Task 3: Schema doc

**Files:**
- Create: `docs/anglesite-json-schema.md`

**Interfaces:**
- Consumes: the field shapes defined in Task 1 (`DomainConfig` and its nested types) and Task 2 (`AnglesiteConfig`) — this doc must describe exactly those fields, no more, no less.

- [ ] **Step 1: Write the schema doc**

Create `docs/anglesite-json-schema.md`:

```markdown
# `anglesite.json` schema

`Source/anglesite.json` is a git-tracked file recording the domain, DNS, edge-hardening,
email, and Workers configuration Anglesite has actually applied to a site. It lives beside the
site's Astro project, travels with the repo, and is safe to hand-edit — see
[`docs/superpowers/specs/2026-07-31-domain-config-in-git-investigation.md`](superpowers/specs/2026-07-31-domain-config-in-git-investigation.md)
for the full design rationale.

A site with no file, or an empty `{}`, has no declarations — this is the normal state for a
freshly scaffolded site and every field below is optional. As of this writing (schema version
1), nothing in Anglesite reads a decision *from* this file yet, and nothing writes to it either
— it exists so later slices ([#1170](https://github.com/Anglesite/Anglesite/issues/1170)–[#1173](https://github.com/Anglesite/Anglesite/issues/1173))
have a place to declare intent into.

## What never appears in this file

Secrets, API tokens, Cloudflare zone/account IDs, and provisioned resource IDs (D1 database IDs,
KV namespace IDs, R2 bucket names, queue names) are never written here — those stay in the app's
private `Config/` directory or the system Keychain, and are scoped to one account. This file is
portable: it should make sense read on its own, cloned to a different machine or a different
Cloudflare account.

DNS records the owner already had before Anglesite touched the zone are never mirrored into
`dns.managedRecords` — only records Anglesite itself created appear here.

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Schema version. Currently always `1`. Missing is tolerated and treated as `1`. |
| `domain` | object | See [Domain](#domain). |
| `dns` | object | See [DNS](#dns). |
| `edge` | object | See [Edge](#edge). |
| `email` | object | See [Email](#email). |
| `workers` | object | See [Workers](#workers). |

Every section is optional. A field the app has never written is simply absent — never `null`.

## Domain

| Field | Type | Meaning |
|---|---|---|
| `hostname` | string | The owner's declared domain, e.g. `"example.com"`. |
| `choice` | string | How the owner is getting this domain: `"buy"`, `"transfer"`, or `"later"`. Readers should treat any other value as unrecognized rather than erroring — this field intentionally isn't a closed set at the schema level. |
| `attach` | boolean | Whether the owner intends this domain attached to the site's deployment. The Cloudflare-side receipt of *actually* attaching stays in `.site-config`'s `CF_DOMAIN_ATTACHED` key — this field is intent, not confirmation. |

## DNS

| Field | Type | Meaning |
|---|---|---|
| `managedRecords` | array of [DNS record](#dns-record) | DNS records Anglesite created and therefore owns. |

### DNS record

| Field | Type | Meaning |
|---|---|---|
| `type` | string | The DNS record type, e.g. `"MX"`, `"TXT"`. |
| `name` | string | The record name, e.g. `"@"`, `"_atproto"`. |
| `content` | string | The record's value. |
| `priority` | number | Optional. Used by record types like `MX` that carry a priority. |
| `purpose` | string | Optional. A namespaced tag describing why Anglesite created this record, e.g. `"email:icloud"`, `"verification:bluesky"` — mirrors the `comment` field Anglesite stamps on the live Cloudflare record, so declared and live records can be matched up. |

## Edge

The edge-hardening posture Anglesite has applied. Reflects exactly what was applied, never an
aspirational target — if a field is present, the app made that change; if it's absent, the app
hasn't touched that setting (which is different from the app having explicitly turned it off).

| Field | Type | Meaning |
|---|---|---|
| `dnssec` | boolean | Whether DNSSEC is enabled. |
| `alwaysUseHTTPS` | boolean | Whether Always-Use-HTTPS is enabled. |
| `hsts` | object | See [HSTS](#hsts). |
| `cloudflare` | object | See [Cloudflare edge](#cloudflare-edge). Cloudflare-specific settings live under this key rather than at the top level of `edge`, since Cloudflare is the only v1 deploy target but not necessarily the only future one. |

### HSTS

| Field | Type | Meaning |
|---|---|---|
| `maxAge` | number | The `Strict-Transport-Security` `max-age` value, in seconds. |
| `includeSubdomains` | boolean | Whether the `includeSubDomains` directive is set. |
| `preload` | boolean | Whether the `preload` directive is set. |

### Cloudflare edge

| Field | Type | Meaning |
|---|---|---|
| `botFightMode` | boolean | Whether Cloudflare Bot Fight Mode is enabled. |
| `wafRules` | array of [WAF rule](#waf-rule) | Custom WAF rules Anglesite has applied. |

### WAF rule

| Field | Type | Meaning |
|---|---|---|
| `description` | string | A human-readable label for the rule. |
| `expression` | string | The Cloudflare WAF rule expression. |
| `action` | string | The action Cloudflare takes when the expression matches, e.g. `"block"`. |

## Email

| Field | Type | Meaning |
|---|---|---|
| `provider` | string | The email provider the owner chose, e.g. `"icloud"`. |
| `dmarcReportEmail` | string | The address DMARC aggregate reports are sent to. |

## Workers

| Field | Type | Meaning |
|---|---|---|
| `active` | array of string | The catalog IDs of the Workers the owner has activated for this site, e.g. `["webmention-receive", "micropub"]`. |

## Compatibility

Unknown keys — either a whole section this version of Anglesite doesn't recognize, or an extra
field inside a section it does — are preserved when the app rewrites this file. A hand edit, or
a field written by a newer Anglesite version, survives being loaded and re-saved by an older one.

A file that isn't valid JSON, or whose known fields don't match the types above, fails to load
with a specific error rather than being silently ignored.
```

- [ ] **Step 2: Commit**

```bash
git add docs/anglesite-json-schema.md
git commit -m "docs(#1169): add anglesite.json schema reference"
```

---

## Self-Review Notes

- **Spec coverage:** Versioned schema ✅ (Task 1, `version` field + tolerance). Five sections (`domain`, `dns.managedRecords`, `edge`+`cloudflare`, `email`, `workers.active`) ✅ (Task 1, matches §5.2 sketch field-for-field). All fields optional ✅. Swift model + store, round-trip-safe, unknown-key-preserving ✅ (Task 1). Template-side reader ✅ (Task 2). Schema doc ✅ (Task 3). Explicit exclusions documented ✅ (Task 3 "What never appears"). Ships inert (no consumer wired up) ✅ — no task adds a call site.
- **Placeholder scan:** No TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `DomainConfig`/`DomainConfigStore` signatures in Task 1's Interfaces block match the code in Steps 1–2 exactly. `readAnglesiteConfig`/`AnglesiteConfig` in Task 2's Interfaces block match Step 3's code exactly. Task 3 references only fields Task 1/2 actually define.
