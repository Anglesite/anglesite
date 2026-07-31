# Robots.txt and noindex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app's page inspector two independent per-page controls — "Hide from search results" (`noindex`) and "Block crawling entirely" (`disallowCrawl`) — backed by one shared, git-tracked config file that the Astro template reads at build time to emit the `noindex` meta tag, the `X-Robots-Tag` header, and `robots.txt` `Disallow` lines.

**Architecture:** A new `src/data/robots-config.json` (parallel to the existing `src/data/licensing.json`) is the single source of truth for both directives, keyed by path with a `source` back-reference to the page/collection that set it. The Swift app reads/writes it directly through a new pure `RobotsConfigStore` type; nothing at build time scans page files. `BaseLayout.astro`, `edge-artifacts.ts`, and `csp.ts` all read the same file independently.

**Tech Stack:** Swift 6.4 / Swift Testing (`AnglesiteCore`, `AnglesiteApp`/`AnglesiteAppCore`), TypeScript / `node:test` (Astro template scripts), Astro components.

**Spec:** [docs/superpowers/specs/2026-07-30-robots-noindex-design.md](../specs/2026-07-30-robots-noindex-design.md)

## Global Constraints

- Two independent toggles (`noindex`, `disallowCrawl`) — never collapse them into one control or one code path; a page can have either, both, or neither.
- `robots.txt` generation is one-way: `robots-config.json` → `robots.txt`. Nothing reads `public/robots.txt` back into the config or the inspector.
- Entries in `robots-config.json` with `source: null`/absent are hand-authored and MUST NOT be touched by any app-driven upsert/remove operation.
- Swift: keep the pure-transform / thin-I/O-wrapper split this codebase already uses (`PageMetadataEditor` pure + `PageMetadataModel` does I/O) — `RobotsConfigStore` is pure, `RobotsConfigFile` is the only I/O-aware layer.
- TypeScript: `readRobotsConfig` must be tolerant of a missing or malformed file (never throws), matching `readLicensingUsage`'s existing tolerance for `licensing.json`.
- Swift tests use Swift Testing (`@Suite`/`@Test`/`#expect`), not XCTest — matches every file this plan touches or adds to.
- TS tests use the `node:test` + `node:assert/strict` style already used in `scripts/*.test.ts`, run via `tsx --test` (`npm test` in `Resources/Template/`).
- Commit subjects ≤72 characters, Conventional Commits, referencing `#1093` per `CONTRIBUTING.md`.
- Run `swift test --package-path .` before any task that touches `Resources/Template/` is considered done (per `CONTRIBUTING.md` — template changes couple to Swift tests).

---

## Task 1: `RobotsConfigStore` + `RobotsConfigFile` (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/RobotsConfigStore.swift`
- Test: `Tests/AnglesiteCoreTests/RobotsConfigStoreTests.swift`

**Interfaces:**
- Produces (used by Tasks 6-8): `RobotsConfigSource` (`.page(file:)`, `.collection(_:id:)` factories), `RobotsConfigEntry`, `RobotsConfig`, `RobotsDirective` (`.noindex`, `.disallowCrawl`), `RobotsConfigStore.{read,contains,upserting,removing,serialized}`, `RobotsConfigFile.{url,read,write,flags,apply}`.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/RobotsConfigStoreTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("RobotsConfigStore")
struct RobotsConfigStoreTests {
    @Test("read: empty/malformed input yields an empty config")
    func readMalformed() {
        #expect(RobotsConfigStore.read("") == RobotsConfig())
        #expect(RobotsConfigStore.read("not json") == RobotsConfig())
    }

    @Test("read: parses a valid config")
    func readValid() {
        let json = """
        {"noindex":[{"path":"/a/","source":{"kind":"page","file":"src/pages/a.astro"}}],"disallow":[],"extra":["User-agent: Foo\\nDisallow: /bar/"]}
        """
        let config = RobotsConfigStore.read(json)
        #expect(config.noindex == [RobotsConfigEntry(path: "/a/", source: .page(file: "src/pages/a.astro"))])
        #expect(config.extra == ["User-agent: Foo\nDisallow: /bar/"])
    }

    @Test("contains: true only for a matching source in the right directive")
    func containsMatchesSourceAndDirective() {
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        let config = RobotsConfig(noindex: [RobotsConfigEntry(path: "/a/", source: source)])
        #expect(RobotsConfigStore.contains(source: source, directive: .noindex, in: config))
        #expect(!RobotsConfigStore.contains(source: source, directive: .disallowCrawl, in: config))
        #expect(!RobotsConfigStore.contains(source: .page(file: "src/pages/b.astro"), directive: .noindex, in: config))
    }

    @Test("upserting: appends a new entry")
    func upsertAppends() {
        let source = RobotsConfigSource.collection("blog", id: "post-1")
        let config = RobotsConfigStore.upserting(path: "/blog/post-1/", source: source, directive: .noindex, into: RobotsConfig())
        #expect(config.noindex == [RobotsConfigEntry(path: "/blog/post-1/", source: source)])
    }

    @Test("upserting: updates the path in place rather than duplicating")
    func upsertUpdatesInPlace() {
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        var config = RobotsConfigStore.upserting(path: "/old/", source: source, directive: .disallowCrawl, into: RobotsConfig())
        config = RobotsConfigStore.upserting(path: "/new/", source: source, directive: .disallowCrawl, into: config)
        #expect(config.disallow == [RobotsConfigEntry(path: "/new/", source: source)])
    }

    @Test("upserting: leaves other directives and sourceless entries untouched")
    func upsertLeavesOthersAlone() {
        let manual = RobotsConfigEntry(path: "/manual/", source: nil)
        var config = RobotsConfig(disallow: [manual])
        config = RobotsConfigStore.upserting(
            path: "/a/", source: .page(file: "src/pages/a.astro"), directive: .noindex, into: config
        )
        #expect(config.disallow == [manual])
        #expect(config.noindex.count == 1)
    }

    @Test("removing: removes only the matching source")
    func removingMatchingSource() {
        let a = RobotsConfigSource.page(file: "src/pages/a.astro")
        let b = RobotsConfigSource.page(file: "src/pages/b.astro")
        var config = RobotsConfig(noindex: [
            RobotsConfigEntry(path: "/a/", source: a),
            RobotsConfigEntry(path: "/b/", source: b),
        ])
        config = RobotsConfigStore.removing(source: a, directive: .noindex, from: config)
        #expect(config.noindex == [RobotsConfigEntry(path: "/b/", source: b)])
    }

    @Test("removing: never matches a sourceless entry")
    func removingIgnoresManualEntries() {
        let manual = RobotsConfigEntry(path: "/manual/", source: nil)
        let config = RobotsConfig(disallow: [manual])
        let neverMatches = RobotsConfigSource(kind: "page", file: nil, collection: nil, id: nil)
        let after = RobotsConfigStore.removing(source: neverMatches, directive: .disallowCrawl, from: config)
        #expect(after.disallow == [manual])
    }

    @Test("serialized: sorts entries by path and round-trips through read")
    func serializedRoundTrips() {
        let config = RobotsConfig(noindex: [
            RobotsConfigEntry(path: "/z/", source: .page(file: "src/pages/z.astro")),
            RobotsConfigEntry(path: "/a/", source: .page(file: "src/pages/a.astro")),
        ])
        let text = RobotsConfigStore.serialized(config)
        #expect(text.hasSuffix("\n"))
        #expect(RobotsConfigStore.read(text).noindex.map(\.path) == ["/a/", "/z/"])
    }
}

@Suite("RobotsConfigFile")
struct RobotsConfigFileTests {
    private func tempSiteDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("RobotsConfigFileTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("read: missing file yields an empty config")
    func readMissing() throws {
        let dir = try tempSiteDir()
        #expect(RobotsConfigFile.read(under: dir) == RobotsConfig())
    }

    @Test("apply then flags: enabling a directive round-trips")
    func applyThenFlags() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/secret.astro")
        try RobotsConfigFile.apply(source: source, noindex: true, disallowCrawl: false, path: "/secret/", under: dir)
        let flags = RobotsConfigFile.flags(for: source, under: dir)
        #expect(flags.noindex)
        #expect(!flags.disallowCrawl)
    }

    @Test("apply: disabling a previously-enabled directive removes its entry")
    func applyDisables() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/secret.astro")
        try RobotsConfigFile.apply(source: source, noindex: true, disallowCrawl: false, path: "/secret/", under: dir)
        try RobotsConfigFile.apply(source: source, noindex: false, disallowCrawl: false, path: "/secret/", under: dir)
        #expect(!RobotsConfigFile.flags(for: source, under: dir).noindex)
    }

    @Test("apply: a no-op change never creates the file")
    func applyNoopSkipsWrite() throws {
        let dir = try tempSiteDir()
        let source = RobotsConfigSource.page(file: "src/pages/a.astro")
        try RobotsConfigFile.apply(source: source, noindex: false, disallowCrawl: false, path: "/a/", under: dir)
        #expect(!FileManager.default.fileExists(atPath: RobotsConfigFile.url(under: dir).path))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter RobotsConfigStoreTests`
Expected: FAIL to build — `RobotsConfigStore`, `RobotsConfig`, etc. don't exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/RobotsConfigStore.swift`:

```swift
import Foundation

/// One entry's origin: which page or collection entry the app wrote it for (#1093). `nil` when an
/// entry was hand-added directly to the JSON file — `RobotsConfigStore`'s upsert/remove operations
/// only ever match entries by `source`, so a sourceless entry is never touched by app-driven writes.
public struct RobotsConfigSource: Codable, Equatable, Sendable {
    public var kind: String        // "page" | "collection"
    public var file: String?       // set when kind == "page"
    public var collection: String? // set when kind == "collection"
    public var id: String?         // set when kind == "collection"

    public init(kind: String, file: String? = nil, collection: String? = nil, id: String? = nil) {
        self.kind = kind
        self.file = file
        self.collection = collection
        self.id = id
    }

    public static func page(file: String) -> RobotsConfigSource {
        RobotsConfigSource(kind: "page", file: file)
    }

    public static func collection(_ name: String, id: String) -> RobotsConfigSource {
        RobotsConfigSource(kind: "collection", collection: name, id: id)
    }
}

public struct RobotsConfigEntry: Codable, Equatable, Sendable {
    public var path: String
    public var source: RobotsConfigSource?

    public init(path: String, source: RobotsConfigSource? = nil) {
        self.path = path
        self.source = source
    }
}

/// `src/data/robots-config.json` — the site's editable source of truth for per-route
/// noindex/disallow directives (#1093). Entries with a `source` were written by the app; entries
/// without one are hand-authored and are never touched by `RobotsConfigStore`'s write operations.
/// `extra` holds raw robots.txt lines/blocks for directives that don't fit the per-path shape.
public struct RobotsConfig: Codable, Equatable, Sendable {
    public var noindex: [RobotsConfigEntry]
    public var disallow: [RobotsConfigEntry]
    public var extra: [String]

    public init(noindex: [RobotsConfigEntry] = [], disallow: [RobotsConfigEntry] = [], extra: [String] = []) {
        self.noindex = noindex
        self.disallow = disallow
        self.extra = extra
    }
}

/// Which per-route directive an operation targets.
public enum RobotsDirective: Sendable {
    case noindex
    case disallowCrawl
}

/// Pure read/write transforms over `RobotsConfig` — no I/O. `RobotsConfigFile` below owns reading
/// and writing the actual file, the same split `PageMetadataEditor`/`buildRobotsTxt` already use.
public enum RobotsConfigStore {
    /// Missing or malformed JSON reads as an empty config — never throws. Same tolerance
    /// `readLicensingUsage` already applies to a malformed `licensing.json`.
    public static func read(_ contents: String) -> RobotsConfig {
        guard let data = contents.data(using: .utf8),
              let config = try? JSONDecoder().decode(RobotsConfig.self, from: data) else {
            return RobotsConfig()
        }
        return config
    }

    public static func contains(source: RobotsConfigSource, directive: RobotsDirective, in config: RobotsConfig) -> Bool {
        entries(for: directive, in: config).contains { $0.source == source }
    }

    /// Adds or updates the entry for `source` in `directive`'s array. Every other entry — other
    /// directive, other source, sourceless — is left exactly as it was.
    public static func upserting(
        path: String,
        source: RobotsConfigSource,
        directive: RobotsDirective,
        into config: RobotsConfig
    ) -> RobotsConfig {
        var config = config
        var list = entries(for: directive, in: config)
        if let idx = list.firstIndex(where: { $0.source == source }) {
            list[idx].path = path
        } else {
            list.append(RobotsConfigEntry(path: path, source: source))
        }
        setEntries(list, for: directive, in: &config)
        return config
    }

    /// Removes the entry for `source` from `directive`'s array, if present. `source` is never nil
    /// here, so a sourceless (hand-authored) entry can never be matched or removed this way.
    public static func removing(
        source: RobotsConfigSource,
        directive: RobotsDirective,
        from config: RobotsConfig
    ) -> RobotsConfig {
        var config = config
        var list = entries(for: directive, in: config)
        list.removeAll { $0.source == source }
        setEntries(list, for: directive, in: &config)
        return config
    }

    /// Deterministic JSON: sorted keys, entries sorted by path, trailing newline — re-saving
    /// without a real change produces no git diff.
    public static func serialized(_ config: RobotsConfig) -> String {
        var sorted = config
        sorted.noindex.sort { $0.path < $1.path }
        sorted.disallow.sort { $0.path < $1.path }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = (try? encoder.encode(sorted)) ?? Data("{}".utf8)
        let text = String(data: data, encoding: .utf8) ?? "{}"
        return text.hasSuffix("\n") ? text : text + "\n"
    }

    private static func entries(for directive: RobotsDirective, in config: RobotsConfig) -> [RobotsConfigEntry] {
        switch directive {
        case .noindex: return config.noindex
        case .disallowCrawl: return config.disallow
        }
    }

    private static func setEntries(_ entries: [RobotsConfigEntry], for directive: RobotsDirective, in config: inout RobotsConfig) {
        switch directive {
        case .noindex: config.noindex = entries
        case .disallowCrawl: config.disallow = entries
        }
    }
}

/// Disk I/O for `src/data/robots-config.json`, layered on the pure `RobotsConfigStore` transforms.
/// The relative path matches `src/data/licensing.json`'s existing location convention.
public enum RobotsConfigFile {
    public static let relativePath = "src/data/robots-config.json"

    public static func url(under sourceDirectory: URL) -> URL {
        sourceDirectory.appendingPathComponent(relativePath)
    }

    /// Missing file reads as an empty config — same tolerance as `RobotsConfigStore.read`.
    public static func read(under sourceDirectory: URL) -> RobotsConfig {
        guard let text = try? String(contentsOf: url(under: sourceDirectory), encoding: .utf8) else {
            return RobotsConfig()
        }
        return RobotsConfigStore.read(text)
    }

    public static func write(_ config: RobotsConfig, under sourceDirectory: URL) throws {
        let fileURL = url(under: sourceDirectory)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try RobotsConfigStore.serialized(config).write(to: fileURL, atomically: true, encoding: .utf8)
    }

    /// Whether `source` currently has an entry under each directive.
    public static func flags(for source: RobotsConfigSource, under sourceDirectory: URL) -> (noindex: Bool, disallowCrawl: Bool) {
        let config = read(under: sourceDirectory)
        return (
            RobotsConfigStore.contains(source: source, directive: .noindex, in: config),
            RobotsConfigStore.contains(source: source, directive: .disallowCrawl, in: config)
        )
    }

    /// Applies the desired noindex/disallowCrawl state for `source`, writing back only if an entry
    /// was actually added or removed. Re-reads fresh rather than trusting a caller's stale snapshot
    /// — narrows (doesn't eliminate) the window between two saves.
    public static func apply(
        source: RobotsConfigSource,
        noindex: Bool,
        disallowCrawl: Bool,
        path: String,
        under sourceDirectory: URL
    ) throws {
        var config = read(under: sourceDirectory)
        var changed = false
        for (directive, wants) in [(RobotsDirective.noindex, noindex), (.disallowCrawl, disallowCrawl)] {
            let present = RobotsConfigStore.contains(source: source, directive: directive, in: config)
            if wants, !present {
                config = RobotsConfigStore.upserting(path: path, source: source, directive: directive, into: config)
                changed = true
            } else if !wants, present {
                config = RobotsConfigStore.removing(source: source, directive: directive, from: config)
                changed = true
            }
        }
        guard changed else { return }
        try write(config, under: sourceDirectory)
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --package-path . --filter RobotsConfigStoreTests && swift test --package-path . --filter RobotsConfigFileTests`
Expected: PASS (all 12 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/RobotsConfigStore.swift Tests/AnglesiteCoreTests/RobotsConfigStoreTests.swift
git commit -m "feat(#1093): add RobotsConfigStore for robots-config.json"
```

---

## Task 2: `src/lib/robots-config.ts` + default config scaffold file (Astro template)

**Files:**
- Create: `Resources/Template/src/data/robots-config.json`
- Create: `Resources/Template/src/lib/robots-config.ts`
- Test: `Resources/Template/src/lib/robots-config.test.ts`

**Interfaces:**
- Produces (used by Tasks 3-5): `RobotsConfigEntry`, `RobotsConfig` (TS interfaces), `readRobotsConfig(cwd: string): RobotsConfig`, `isNoindexed(pathname: string, config: RobotsConfig): boolean`.

- [ ] **Step 1: Ship the default scaffold file**

Create `Resources/Template/src/data/robots-config.json`:

```json
{
  "noindex": [],
  "disallow": [],
  "extra": []
}
```

This mirrors `src/data/licensing.json` shipping as a default in every new site, so `robots-config.json` always exists from site creation — `readRobotsConfig` below stays tolerant of its absence anyway, for sites that predate this feature.

- [ ] **Step 2: Write the failing test**

Create `Resources/Template/src/lib/robots-config.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readRobotsConfig, isNoindexed, EMPTY_ROBOTS_CONFIG } from "./robots-config";

function tempSite(): string {
  return mkdtempSync(resolve(tmpdir(), "robots-config-test-"));
}

test("readRobotsConfig: missing file yields the empty config", () => {
  const cwd = tempSite();
  assert.deepEqual(readRobotsConfig(cwd), EMPTY_ROBOTS_CONFIG);
});

test("readRobotsConfig: malformed JSON yields the empty config", () => {
  const cwd = tempSite();
  mkdirSync(resolve(cwd, "src/data"), { recursive: true });
  writeFileSync(resolve(cwd, "src/data/robots-config.json"), "not json", "utf-8");
  assert.deepEqual(readRobotsConfig(cwd), EMPTY_ROBOTS_CONFIG);
});

test("readRobotsConfig: parses a valid config", () => {
  const cwd = tempSite();
  mkdirSync(resolve(cwd, "src/data"), { recursive: true });
  writeFileSync(
    resolve(cwd, "src/data/robots-config.json"),
    JSON.stringify({
      noindex: [{ path: "/a/", source: { kind: "page", file: "src/pages/a.astro" } }],
      disallow: [],
      extra: ["User-agent: Foo\nDisallow: /bar/"],
    }),
    "utf-8",
  );
  const config = readRobotsConfig(cwd);
  assert.equal(config.noindex.length, 1);
  assert.equal(config.noindex[0].path, "/a/");
  assert.deepEqual(config.extra, ["User-agent: Foo\nDisallow: /bar/"]);
});

test("isNoindexed: true only for an exact path match", () => {
  const config = { ...EMPTY_ROBOTS_CONFIG, noindex: [{ path: "/blog/private/" }] };
  assert.equal(isNoindexed("/blog/private/", config), true);
  assert.equal(isNoindexed("/blog/other/", config), false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd Resources/Template && npx tsx --test src/lib/robots-config.test.ts`
Expected: FAIL — `./robots-config` module doesn't exist yet.

- [ ] **Step 4: Write the implementation**

Create `Resources/Template/src/lib/robots-config.ts`:

```typescript
/**
 * `src/data/robots-config.json` (#1093) — the site's editable source of truth for per-route
 * noindex/disallow directives, written directly by the Anglesite app when a page's inspector
 * toggle changes. `BaseLayout.astro`, `scripts/csp.ts`, and `scripts/edge-artifacts.ts` all read
 * this file independently at build time; nothing here scans page files to reconstruct it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RobotsConfigSource {
  kind: "page" | "collection";
  file?: string;
  collection?: string;
  id?: string;
}

export interface RobotsConfigEntry {
  path: string;
  source?: RobotsConfigSource | null;
}

export interface RobotsConfig {
  noindex: RobotsConfigEntry[];
  disallow: RobotsConfigEntry[];
  extra: string[];
}

export const EMPTY_ROBOTS_CONFIG: RobotsConfig = { noindex: [], disallow: [], extra: [] };

/** Reads and validates the shape loosely — malformed/missing input reads as empty, never throws. */
export function readRobotsConfig(cwd: string): RobotsConfig {
  const path = resolve(cwd, "src/data/robots-config.json");
  if (!existsSync(path)) return { ...EMPTY_ROBOTS_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      noindex: Array.isArray(raw.noindex) ? raw.noindex : [],
      disallow: Array.isArray(raw.disallow) ? raw.disallow : [],
      extra: Array.isArray(raw.extra) ? raw.extra : [],
    };
  } catch {
    return { ...EMPTY_ROBOTS_CONFIG };
  }
}

/** True when `pathname` exactly matches a `noindex` entry's `path`. */
export function isNoindexed(pathname: string, config: RobotsConfig): boolean {
  return config.noindex.some((entry) => entry.path === pathname);
}

/** A short human-readable label for a `Disallow` line's `# from …` back-reference comment. */
export function sourceLabel(source: RobotsConfigSource | null | undefined): string | null {
  if (!source) return null;
  if (source.kind === "collection") return `${source.collection}/${source.id}`;
  return source.file ?? null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd Resources/Template && npx tsx --test src/lib/robots-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/src/data/robots-config.json Resources/Template/src/lib/robots-config.ts Resources/Template/src/lib/robots-config.test.ts
git commit -m "feat(#1093): add robots-config.json reader + scaffold default"
```

---

## Task 3: `BaseLayout.astro` emits the noindex meta tag

**Files:**
- Modify: `Resources/Template/src/layouts/BaseLayout.astro:1-32` (frontmatter + head)

**Interfaces:**
- Consumes: `readRobotsConfig`, `isNoindexed` from Task 2's `../lib/robots-config.ts`.

- [ ] **Step 1: Add the import and compute `noindex` in the frontmatter**

In `Resources/Template/src/layouts/BaseLayout.astro`, the frontmatter currently reads (lines 1-22):

```astro
---
import "../styles/global.css";
import Hcard from "../components/Hcard.astro";
import Rights from "../components/Rights.astro";
import { readConfig } from "../../scripts/config";
import { siteLicense } from "../lib/licensing-data.ts";
import { headLicense, type LicenseRef } from "../lib/licensing.ts";
// anglesite:imports — integration component imports are injected here on setup

interface Props {
  title: string;
  description?: string;
  /**
   * The license this page advertises in <head>. Omit the prop to inherit the site default
   * (ordinary pages); pass null to advertise nothing (an entry in a non-asserting collection);
   * pass a ref to override (an entry with its own license).
   */
  license?: LicenseRef | null;
}

const { title, description } = Astro.props;
const license = headLicense(Astro.props.license, siteLicense());
---
```

Replace the import block and the two `const` lines with:

```astro
---
import "../styles/global.css";
import Hcard from "../components/Hcard.astro";
import Rights from "../components/Rights.astro";
import { readConfig } from "../../scripts/config";
import { siteLicense } from "../lib/licensing-data.ts";
import { headLicense, type LicenseRef } from "../lib/licensing.ts";
import { readRobotsConfig, isNoindexed } from "../lib/robots-config.ts";
// anglesite:imports — integration component imports are injected here on setup

interface Props {
  title: string;
  description?: string;
  /**
   * The license this page advertises in <head>. Omit the prop to inherit the site default
   * (ordinary pages); pass null to advertise nothing (an entry in a non-asserting collection);
   * pass a ref to override (an entry with its own license).
   */
  license?: LicenseRef | null;
}

const { title, description } = Astro.props;
const license = headLicense(Astro.props.license, siteLicense());
// Read directly by route rather than threaded as a prop (#1093) — every page renders through
// this one layout, so the check lives in exactly one place instead of every call site.
const noindex = isNoindexed(Astro.url.pathname, readRobotsConfig(process.cwd()));
---
```

- [ ] **Step 2: Emit the meta tag**

In the same file, the `<head>` currently has (line 31):

```astro
    {description && <meta name="description" content={description} />}
    <title>{title}</title>
```

Replace with:

```astro
    {description && <meta name="description" content={description} />}
    {noindex && <meta name="robots" content="noindex" />}
    <title>{title}</title>
```

- [ ] **Step 3: Verify the template still builds**

Run: `cd Resources/Template && npm run build`
Expected: build succeeds (no site currently sets a `noindex` entry, so output is otherwise unchanged).

- [ ] **Step 4: Run the Swift template-asset guard suite**

Per `CONTRIBUTING.md`, touching `Resources/Template/` requires the coupled Swift tests:

Run: `swift test --package-path . --filter IntegrationTemplateAssetsTests`
Expected: PASS. If it fails, the failure will name which committed template asset it snapshots — update that expectation, don't work around the guard.

- [ ] **Step 5: Commit**

```bash
git add Resources/Template/src/layouts/BaseLayout.astro
git commit -m "feat(#1093): emit noindex meta tag from robots-config.json"
```

---

## Task 4: `buildRobotsTxt` reads `disallow`/`extra` from the config

**Files:**
- Modify: `Resources/Template/scripts/edge-artifacts.ts:89-122` (`buildRobotsTxt`), `:419-436` (`main`)
- Test: `Resources/Template/scripts/edge-artifacts.test.ts` (append)

**Interfaces:**
- Consumes: `RobotsConfigEntry`, `sourceLabel`, `readRobotsConfig` from Task 2's `../src/lib/robots-config.ts`.
- Produces: `buildRobotsTxt(usage?, siteUrl?, disallowEntries?, extra?): string` (two new optional params, both default `[]`, so every existing call site and the "byte-identical to committed robots.txt" test keep passing unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `Resources/Template/scripts/edge-artifacts.test.ts` (add the import alongside the existing ones at the top):

```typescript
import type { RobotsConfigEntry } from "../src/lib/robots-config.ts";
```

Then append these test cases at the end of the file:

```typescript
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

test("buildRobotsTxt: extra lines are appended verbatim after a blank line", () => {
  const out = buildRobotsTxt(undefined, undefined, [], ["User-agent: SomeBot", "Disallow: /"]);
  assert.match(out, /\n\nUser-agent: SomeBot\nDisallow: \/\n$/);
});

test("buildRobotsTxt: no disallow entries or extra lines leaves output unchanged from today", () => {
  assert.equal(buildRobotsTxt(), buildRobotsTxt(undefined, undefined, [], []));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts`
Expected: FAIL — `buildRobotsTxt` doesn't accept a third/fourth parameter yet, so the new assertions don't match.

- [ ] **Step 3: Update `buildRobotsTxt`**

In `Resources/Template/scripts/edge-artifacts.ts`, add the import near the top (after the existing `licensing.ts` import around line 15):

```typescript
import { readRobotsConfig, sourceLabel, type RobotsConfigEntry } from "../src/lib/robots-config.ts";
```

Replace the `buildRobotsTxt` function (lines 89-122) with:

```typescript
export function buildRobotsTxt(
  usage: AIUsage = NO_USAGE,
  siteUrl?: string,
  disallowEntries: RobotsConfigEntry[] = [],
  extra: string[] = [],
): string {
  let body = `# robots.txt — generated by scripts/edge-artifacts.ts
User-agent: *
Disallow:
`;
  // Stays inside the `User-agent: *` group above — no blank line before it, matching the
  // Content-Signal comment's own note on classic robots.txt grouping.
  for (const entry of disallowEntries) {
    const label = sourceLabel(entry.source);
    if (label) body += `# ${label}\n`;
    body += `Disallow: ${entry.path}\n`;
  }
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
  // Gated on mayBlockAICrawlers too, not just the raw flag: `main()` only ever passes a usage
  // block `normalizeUsage` has already clamped, so this is currently redundant in practice, but
  // `buildRobotsTxt` is exported and the whole point of #991 is that the blocklist never exceeds
  // what the permissions deny — that invariant belongs to this function, not just to its one
  // caller (#991 review finding 3).
  if (usage.blockAICrawlers && mayBlockAICrawlers(usage)) {
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
  if (extra.length > 0) {
    body += `\n${extra.join("\n")}\n`;
  }
  return body;
}
```

- [ ] **Step 4: Wire `main()` to pass the config's entries**

In `main()` (lines 419-436), add the config read and pass its fields through:

```typescript
function main(): void {
  const publicDir = resolve(process.cwd(), "public");
  const { usage, clamped } = readLicensingUsage(process.cwd());
  if (clamped) {
    console.log(
      "src/data/licensing.json sets usage.blockAICrawlers but does not deny both aiInput and aiTrain — ignoring it, because blocking the AI crawler list would refuse uses the policy still permits.",
    );
  }
  const robotsConfig = readRobotsConfig(process.cwd());
  writeFileSync(
    resolve(publicDir, "robots.txt"),
    buildRobotsTxt(usage, readConfig("SITE_URL"), robotsConfig.disallow, robotsConfig.extra),
    "utf-8",
  );
  console.log("Wrote public/robots.txt");

  applySecurityTxtPlan(publicDir);
  applyMTAStsPlan(publicDir);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd Resources/Template && npx tsx --test scripts/edge-artifacts.test.ts`
Expected: PASS, including the pre-existing "committed public/robots.txt is byte-identical to buildRobotsTxt()" test (unaffected, since the default site ships an empty `robots-config.json`).

- [ ] **Step 6: Run the Swift template-asset guard suite**

Run: `swift test --package-path . --filter IntegrationTemplateAssetsTests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Resources/Template/scripts/edge-artifacts.ts Resources/Template/scripts/edge-artifacts.test.ts
git commit -m "feat(#1093): generate robots.txt Disallow lines from robots-config.json"
```

---

## Task 5: `buildHeaders` reads `noindex` entries and emits `X-Robots-Tag`

**Files:**
- Modify: `Resources/Template/scripts/csp.ts:82-132` (`buildHeaders`, `main`)
- Test: `Resources/Template/scripts/csp.test.ts` (append)

**Interfaces:**
- Consumes: `RobotsConfigEntry`, `readRobotsConfig` from Task 2's `../src/lib/robots-config.ts`.
- Produces: `buildHeaders(configContent, serviceWorkerPresent?, noindexEntries?): string` (new optional third param, defaults `[]`).

- [ ] **Step 1: Write the failing test**

Append to `Resources/Template/scripts/csp.test.ts` (add the import alongside the existing ones):

```typescript
import type { RobotsConfigEntry } from "../src/lib/robots-config.ts";
```

Then append:

```typescript
test("buildHeaders: adds an X-Robots-Tag block per noindex entry", () => {
  const entries: RobotsConfigEntry[] = [{ path: "/blog/private/" }];
  const out = buildHeaders("", false, entries);
  assert.match(out, /\n\/blog\/private\/\n  X-Robots-Tag: noindex\n/);
});

test("buildHeaders: no noindex entries leaves output unchanged from today", () => {
  assert.equal(buildHeaders(""), buildHeaders("", false, []));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Resources/Template && npx tsx --test scripts/csp.test.ts`
Expected: FAIL — `buildHeaders` doesn't accept a third parameter yet.

- [ ] **Step 3: Update `buildHeaders` and `main()`**

In `Resources/Template/scripts/csp.ts`, add the import after the existing `./config` import:

```typescript
import { readRobotsConfig, type RobotsConfigEntry } from "../src/lib/robots-config.ts";
```

Change the `buildHeaders` signature and body (lines 82-122) — add the parameter and, right before the `if (serviceWorkerPresent)` block near the end, append the per-route blocks:

```typescript
export function buildHeaders(
  configContent: string,
  serviceWorkerPresent = false,
  noindexEntries: RobotsConfigEntry[] = [],
): string {
  const csp = buildCSP(configContent);
  // Only the exact (case-insensitive) string "true" enables preload — submission to
  // the browser preload lists is hard to reverse, so "1"/"yes"/"on" deliberately do not.
  const hstsPreload =
    (readConfigFromString(configContent, "HSTS_PRELOAD") ?? "").trim().toLowerCase() === "true";
  const hsts = `max-age=31536000; includeSubDomains${hstsPreload ? "; preload" : ""}`;
  // COOP: same-origin-allow-popups (not same-origin) preserves window.opener for
  // popups the site itself opens — OAuth sign-in, Stripe/PayPal checkout — while
  // still isolating attacker-opened windows.
  // CORP: same-site (not same-origin) keeps cross-origin (cross-site) isolation but
  // lets same-site subdomains load shared assets (e.g. a logo on blog.example.com).
  let out = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cross-Origin-Resource-Policy: same-site
  Strict-Transport-Security: ${hsts}
  Content-Security-Policy: ${csp}
  Cache-Control: public, max-age=0, must-revalidate

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/.well-known/security.txt
  Content-Type: text/plain; charset=utf-8

/.well-known/mta-sts.txt
  Content-Type: text/plain; charset=utf-8
`;
  for (const entry of noindexEntries) {
    out += `
${entry.path}
  X-Robots-Tag: noindex
`;
  }
  if (serviceWorkerPresent) {
    out += `
/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /
`;
  }
  return out;
}
```

(Only the added `for` loop and the new parameter are new — the rest of the function body is unchanged from today; the docstring above `buildHeaders` and the `BASE`/`buildCSP` code above it are untouched.)

Update `main()`:

```typescript
function main(): void {
  const configPath = resolve(process.cwd(), ".site-config");
  const config = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const outPath = resolve(process.cwd(), "public", "_headers");
  const serviceWorkerPresent = existsSync(resolve(process.cwd(), "public", "sw.js"));
  const robotsConfig = readRobotsConfig(process.cwd());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildHeaders(config, serviceWorkerPresent, robotsConfig.noindex), "utf-8");
  console.log(`Wrote ${outPath}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Resources/Template && npx tsx --test scripts/csp.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the Swift template-asset guard suite**

Run: `swift test --package-path . --filter IntegrationTemplateAssetsTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Resources/Template/scripts/csp.ts Resources/Template/scripts/csp.test.ts
git commit -m "feat(#1093): emit X-Robots-Tag headers from robots-config.json"
```

---

## Task 6: Wire `PageMetadataModel` to the shared robots config

**Files:**
- Modify: `Sources/AnglesiteApp/PageMetadataModel.swift` (whole file — small, shown in full below)
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:1059` (call site)
- Test: `Tests/AnglesiteAppTests/PageMetadataModelRobotsSettingsTests.swift`

**Interfaces:**
- Consumes: `RobotsConfigFile`, `RobotsConfigSource` from Task 1.
- Produces (used by Task 9): `PageMetadataModel.noindexBinding() -> Binding<Bool>`, `.disallowCrawlBinding() -> Binding<Bool>`. `PageMetadataModel.init` gains a `route: String` parameter.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/PageMetadataModelRobotsSettingsTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("PageMetadataModel robots settings (#1093)")
@MainActor
struct PageMetadataModelRobotsSettingsTests {
    private func makeModel(route: String = "/a-page/") throws -> (PageMetadataModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PageMetadataModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/a-page.md")
        try "---\ntitle: \"A Page\"\ndescription: \"D\"\n---\nBody.\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "a-page.md")
        return (PageMetadataModel(file: file, route: route, sourceDirectory: dir), dir)
    }

    @Test("load: no existing entry reads both toggles as off")
    func loadDefaultsOff() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.noindexBinding().wrappedValue == false)
        #expect(model.disallowCrawlBinding().wrappedValue == false)
        #expect(model.isDirty == false)
    }

    @Test("save: enabling noindex writes an entry keyed to this page's file")
    func saveWritesNoindexEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.noindexBinding().wrappedValue = true
        #expect(model.isDirty)
        let saved = await model.save()
        #expect(saved)
        #expect(!model.isDirty)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.noindex == [RobotsConfigEntry(path: "/a-page/", source: .page(file: "src/pages/a-page.md"))])
    }

    @Test("save: disabling a previously-enabled toggle removes its entry")
    func saveRemovesDisabledEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        _ = await model.save()

        model.disallowCrawlBinding().wrappedValue = false
        #expect(model.isDirty)
        _ = await model.save()

        #expect(RobotsConfigFile.read(under: dir).disallow.isEmpty)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter PageMetadataModelRobotsSettingsTests`
Expected: FAIL to build — `PageMetadataModel.init` doesn't take `route:` yet, and `noindexBinding()`/`disallowCrawlBinding()` don't exist.

- [ ] **Step 3: Update `PageMetadataModel`**

Replace the full contents of `Sources/AnglesiteApp/PageMetadataModel.swift` with:

```swift
// Sources/AnglesiteApp/PageMetadataModel.swift
import Foundation
import SwiftUI
import Observation
import AnglesiteCore

/// Editor state for a plain (non-typed) page's title + description, plus the two shared
/// search/crawling toggles (#1093 — backed by `RobotsConfigFile`, not this page's own frontmatter).
/// Parallels `TypedEntryEditorModel`: loads/saves through `FileDocumentIO`, writes via
/// `PageMetadataEditor` (round-trip-safe), and commits each save. All disk IO runs off the main actor.
@MainActor
@Observable
final class PageMetadataModel: InspectorEditorModel {
    let file: FileRef
    let route: String
    private let sourceDirectory: URL
    private let gitCommit: NativeContentOperations.GitCommit

    var metadata = PageMetadata(title: "", description: "")
    private var savedMetadata = PageMetadata(title: "", description: "")
    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false
    private var fileSession = EditableFileSession()
    private var contents: String { fileSession.savedContents }
    /// Guards against a concurrent second `save()` capturing a stale `contents` base. `private(set)`
    /// so `SiteWindowModel.editCommandInFlight` can read it (PR #532 review).
    private(set) var isSaving = false
    private(set) var loadError: String?
    private(set) var isLoading = false
    var conflictDiskContents: String? {
        get { fileSession.conflictDiskContents }
        set { fileSession.conflictDiskContents = newValue }
    }

    var isDirty: Bool {
        (metadata != savedMetadata || noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled)
            && loadError == nil && !isLoading
    }

    init(file: FileRef,
         route: String,
         sourceDirectory: URL,
         gitCommit: @escaping NativeContentOperations.GitCommit = NativeContentOperations.processGitCommit) {
        self.file = file
        self.route = route
        self.sourceDirectory = sourceDirectory
        self.gitCommit = gitCommit
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        let url = file.url
        do {
            var session = fileSession
            let loaded = try await session.load(from: url)
            fileSession = session
            adopt(loaded)
            loadError = nil
            warnIfNoModificationDate(after: "load")
        } catch {
            loadError = error.localizedDescription
        }
        let flags = RobotsConfigFile.flags(for: robotsSource, under: sourceDirectory)
        noindexEnabled = flags.noindex
        savedNoindexEnabled = flags.noindex
        disallowCrawlEnabled = flags.disallowCrawl
        savedDisallowCrawlEnabled = flags.disallowCrawl
    }

    @discardableResult
    func save() async -> Bool {
        guard isDirty, !isSaving else { return true }
        isSaving = true
        defer { isSaving = false }
        let newContents = PageMetadataEditor.write(metadata, into: contents)
        let url = file.url
        do {
            var session = fileSession
            try await session.save(newContents, to: url)
            fileSession = session
            savedMetadata = metadata
            warnIfNoModificationDate(after: "save")
            try RobotsConfigFile.apply(
                source: robotsSource, noindex: noindexEnabled, disallowCrawl: disallowCrawlEnabled,
                path: route, under: sourceDirectory
            )
            savedNoindexEnabled = noindexEnabled
            savedDisallowCrawlEnabled = disallowCrawlEnabled
            await commit()
            return true
        } catch {
            loadError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    func flushBeforeLeaving() async -> Bool {
        guard isDirty else { return true }
        var session = fileSession
        let canFlush = await session.canFlushBeforeLeaving(file: file.url, bufferIsDirty: true)
        fileSession = session
        guard canFlush else { return false }
        return await save()
    }

    func checkExternalChange() async {
        guard loadError == nil else { return }
        let dirty = isDirty
        var session = fileSession
        let change = await session.externalChange(at: file.url, bufferIsDirty: dirty)
        fileSession = session
        switch change {
        case .some(.reloadable(let disk)):
            adopt(disk)
        case .some(.conflict(let disk)):
            conflictDiskContents = disk
        case .some(.none), nil:
            break
        }
    }

    func keepMyChanges() { fileSession.keepMyChanges() }

    func reloadFromDisk() async {
        var session = fileSession
        guard let disk = await session.reloadFromConflict(file: file.url) else {
            fileSession = session
            return
        }
        fileSession = session
        adopt(disk)
    }

    // `[weak self]` — see the note in TypedEntryEditorModel: view-lifetime bindings on a model that
    // is replaced per selection.
    func titleBinding() -> Binding<String> {
        Binding(get: { [weak self] in self?.metadata.title ?? "" },
                set: { [weak self] in self?.metadata.title = $0 })
    }
    func descriptionBinding() -> Binding<String> {
        Binding(get: { [weak self] in self?.metadata.description ?? "" },
                set: { [weak self] in self?.metadata.description = $0 })
    }
    func noindexBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.noindexEnabled ?? false },
                set: { [weak self] in self?.noindexEnabled = $0 })
    }
    func disallowCrawlBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.disallowCrawlEnabled ?? false },
                set: { [weak self] in self?.disallowCrawlEnabled = $0 })
    }

    private var robotsSource: RobotsConfigSource {
        .page(file: relativePath(of: file.url, under: sourceDirectory))
    }

    private func adopt(_ text: String) {
        let read = PageMetadataEditor.read(text)
        metadata = read
        savedMetadata = read
    }

    private func warnIfNoModificationDate(after op: String) {
        guard fileSession.lastModified == nil else { return }
        let path = file.url.path(percentEncoded: false)
        Task {
            await LogCenter.shared.append(
                source: "editor", stream: .stderr,
                text: EditableFileSession.missingModificationDateWarning(after: op, path: path)
            )
        }
    }

    private func commit() async {
        let rel = relativePath(of: file.url, under: sourceDirectory)
        let slug = file.url.deletingPathExtension().lastPathComponent
        _ = await gitCommit(sourceDirectory, rel, "anglesite: edit page \(slug)")
    }

    private func relativePath(of url: URL, under root: URL) -> String {
        let u = url.standardizedFileURL.path(percentEncoded: false)
        let r = root.standardizedFileURL.path(percentEncoded: false)
        if u.hasPrefix(r) { return String(u.dropFirst(r.count)).drop(while: { $0 == "/" }).description }
        return url.lastPathComponent
    }

}
```

- [ ] **Step 4: Update the call site**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, in `makeInspectorContext(forNavigatorID:)` (around line 1059):

```swift
        if isFrontmatterPage(relPath) {
            return .page(PageMetadataModel(file: file, sourceDirectory: source))
        }
```

becomes:

```swift
        if isFrontmatterPage(relPath) {
            return .page(PageMetadataModel(file: file, route: route, sourceDirectory: source))
        }
```

Grep for any other `PageMetadataModel(` call sites (e.g. previews/tests) and update them the same way:

Run: `grep -rn "PageMetadataModel(" Sources/ Tests/`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `swift test --package-path . --filter PageMetadataModelRobotsSettingsTests`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full AnglesiteApp test suite to catch any other call site**

Run: `swift test --package-path . --filter AnglesiteAppTests`
Expected: PASS (a missed call site fails to build, not fails at runtime — the build itself is the check).

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/PageMetadataModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/PageMetadataModelRobotsSettingsTests.swift
git commit -m "feat(#1093): wire PageMetadataModel to robots-config.json"
```

---

## Task 7: Wire `TypedEntryEditorModel` to the shared robots config

**Files:**
- Modify: `Sources/AnglesiteApp/TypedEntryEditorModel.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:1056` (call site)
- Test: `Tests/AnglesiteAppTests/TypedEntryEditorModelRobotsSettingsTests.swift`

**Interfaces:**
- Consumes: `RobotsConfigFile`, `RobotsConfigSource` from Task 1; `ContentTypeDescriptor.collection` (existing).
- Produces (used by Task 9): `TypedEntryEditorModel.noindexBinding() -> Binding<Bool>`, `.disallowCrawlBinding() -> Binding<Bool>`. `TypedEntryEditorModel.init` gains a `route: String` parameter.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/TypedEntryEditorModelRobotsSettingsTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("TypedEntryEditorModel robots settings (#1093)")
@MainActor
struct TypedEntryEditorModelRobotsSettingsTests {
    private func makeModel(route: String = "/notes/my-note/") throws -> (TypedEntryEditorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("TypedEntryEditorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/content/notes"), withIntermediateDirectories: true)
        let entryURL = dir.appendingPathComponent("src/content/notes/my-note.md")
        try "---\npublishDate: 2026-01-01\n---\nBody.\n".write(to: entryURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: entryURL, group: .posts, name: "my-note.md")
        let descriptor = ContentTypeRegistry().descriptor(id: "note")!
        return (TypedEntryEditorModel(file: file, descriptor: descriptor, route: route, sourceDirectory: dir), dir)
    }

    @Test("load: no existing entry reads both toggles as off")
    func loadDefaultsOff() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.noindexBinding().wrappedValue == false)
        #expect(model.disallowCrawlBinding().wrappedValue == false)
    }

    @Test("save: enabling noindex writes a collection-sourced entry")
    func saveWritesCollectionEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.noindexBinding().wrappedValue = true
        let saved = await model.save()
        #expect(saved)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.noindex == [RobotsConfigEntry(path: "/notes/my-note/", source: .collection("notes", id: "my-note"))])
    }

    @Test("save: disabling a previously-enabled toggle removes its entry")
    func saveRemovesDisabledEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        _ = await model.save()

        model.disallowCrawlBinding().wrappedValue = false
        _ = await model.save()

        #expect(RobotsConfigFile.read(under: dir).disallow.isEmpty)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter TypedEntryEditorModelRobotsSettingsTests`
Expected: FAIL to build — `TypedEntryEditorModel.init` doesn't take `route:` yet.

- [ ] **Step 3: Update `TypedEntryEditorModel`**

In `Sources/AnglesiteApp/TypedEntryEditorModel.swift`, make these changes:

Add stored properties (after `let descriptor: ContentTypeDescriptor` near the top of the class):

```swift
    let descriptor: ContentTypeDescriptor
    let route: String
```

Add dirty-tracked robots state (near `var values: TypedContentEditor.Values = .init()`):

```swift
    var values: TypedContentEditor.Values = .init()
    private var savedValues: TypedContentEditor.Values = .init()
    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false
```

Update `isDirty`:

```swift
    var isDirty: Bool {
        (values != savedValues || noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled)
            && loadError == nil && !isLoading
    }
```

Update the initializer:

```swift
    init(file: FileRef,
         descriptor: ContentTypeDescriptor,
         route: String,
         sourceDirectory: URL,
         gitCommit: @escaping NativeContentOperations.GitCommit = NativeContentOperations.processGitCommit) {
        self.file = file
        self.descriptor = descriptor
        self.route = route
        self.sourceDirectory = sourceDirectory
        self.gitCommit = gitCommit
    }
```

Update `load()` — after the existing `do { ... } catch { ... }` block (i.e. after `warnIfNoModificationDate(after: "load")`, still inside `func load()`), add:

```swift
        let flags = RobotsConfigFile.flags(for: robotsSource, under: sourceDirectory)
        noindexEnabled = flags.noindex
        savedNoindexEnabled = flags.noindex
        disallowCrawlEnabled = flags.disallowCrawl
        savedDisallowCrawlEnabled = flags.disallowCrawl
```

Update `save()` — insert the robots apply call right after `warnIfNoModificationDate(after: "save")` and before `await commit()`:

```swift
    @discardableResult
    func save() async -> Bool {
        guard isDirty, !isSaving else { return true }
        isSaving = true
        defer { isSaving = false }
        let descriptor = self.descriptor
        let base = contents
        let edited = values
        let newContents = TypedContentEditor.write(edited, into: base, descriptor: descriptor)
        let url = file.url
        do {
            var session = fileSession
            try await session.save(newContents, to: url)
            fileSession = session
            savedValues = edited
            warnIfNoModificationDate(after: "save")
            try RobotsConfigFile.apply(
                source: robotsSource, noindex: noindexEnabled, disallowCrawl: disallowCrawlEnabled,
                path: route, under: sourceDirectory
            )
            savedNoindexEnabled = noindexEnabled
            savedDisallowCrawlEnabled = disallowCrawlEnabled
            await commit()
            return true
        } catch {
            loadError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }
```

Add the two bindings and the source computation (near the other `*Binding` methods):

```swift
    func noindexBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.noindexEnabled ?? false },
                set: { [weak self] in self?.noindexEnabled = $0 })
    }
    func disallowCrawlBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.disallowCrawlEnabled ?? false },
                set: { [weak self] in self?.disallowCrawlEnabled = $0 })
    }

    private var robotsSource: RobotsConfigSource {
        let slug = file.url.deletingPathExtension().lastPathComponent
        if let collection = descriptor.collection {
            return .collection(collection, id: slug)
        }
        return .page(file: relativePath(of: file.url, under: sourceDirectory))
    }
```

- [ ] **Step 4: Update the call site**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, in `makeInspectorContext(forNavigatorID:)` (around line 1056):

```swift
        if let descriptor = ContentTypeResolver.descriptor(forRelativePath: relPath) {
            return .typed(TypedEntryEditorModel(file: file, descriptor: descriptor, sourceDirectory: source))
        }
```

becomes:

```swift
        if let descriptor = ContentTypeResolver.descriptor(forRelativePath: relPath) {
            return .typed(TypedEntryEditorModel(file: file, descriptor: descriptor, route: route, sourceDirectory: source))
        }
```

Grep for any other call sites:

Run: `grep -rn "TypedEntryEditorModel(" Sources/ Tests/`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `swift test --package-path . --filter TypedEntryEditorModelRobotsSettingsTests`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full AnglesiteApp test suite**

Run: `swift test --package-path . --filter AnglesiteAppTests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/TypedEntryEditorModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/TypedEntryEditorModelRobotsSettingsTests.swift
git commit -m "feat(#1093): wire TypedEntryEditorModel to robots-config.json"
```

---

## Task 8: `GenericPageInspectorModel` becomes editable for these two toggles only

**Files:**
- Modify: `Sources/AnglesiteApp/GenericPageInspectorModel.swift` (whole file — shown in full below)
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift:1063` (call site)
- Test: `Tests/AnglesiteAppTests/GenericPageInspectorModelRobotsSettingsTests.swift`

**Interfaces:**
- Consumes: `RobotsConfigFile`, `RobotsConfigSource` from Task 1.
- Produces (used by Task 9): same `noindexBinding()`/`disallowCrawlBinding()` shape as Tasks 6-7. `GenericPageInspectorModel.init` gains a `sourceDirectory: URL` parameter.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/GenericPageInspectorModelRobotsSettingsTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
import AnglesiteCore

@Suite("GenericPageInspectorModel robots settings (#1093)")
@MainActor
struct GenericPageInspectorModelRobotsSettingsTests {
    private func makeModel(route: String = "/") throws -> (GenericPageInspectorModel, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("GenericPageInspectorModelRobotsSettingsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        let pageURL = dir.appendingPathComponent("src/pages/index.astro")
        try "---\nconst title = \"Home\";\n---\n<h1>{title}</h1>\n".write(to: pageURL, atomically: true, encoding: .utf8)
        let file = FileRef(url: pageURL, group: .pages, name: "index.astro")
        return (GenericPageInspectorModel(file: file, route: route, sourceDirectory: dir), dir)
    }

    @Test("load: no existing entry reads both toggles as off, isDirty false")
    func loadDefaultsOff() async throws {
        let (model, _) = try makeModel()
        await model.load()
        #expect(model.noindexBinding().wrappedValue == false)
        #expect(model.disallowCrawlBinding().wrappedValue == false)
        #expect(model.isDirty == false)
    }

    @Test("save: enabling disallowCrawl writes an entry for this .astro page")
    func saveWritesEntry() async throws {
        let (model, dir) = try makeModel()
        await model.load()
        model.disallowCrawlBinding().wrappedValue = true
        #expect(model.isDirty)
        let saved = await model.save()
        #expect(saved)
        #expect(!model.isDirty)
        let config = RobotsConfigFile.read(under: dir)
        #expect(config.disallow == [RobotsConfigEntry(path: "/", source: .page(file: "src/pages/index.astro"))])
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `swift test --package-path . --filter GenericPageInspectorModelRobotsSettingsTests`
Expected: FAIL to build — `GenericPageInspectorModel.init` doesn't take `sourceDirectory:` yet.

- [ ] **Step 3: Replace `GenericPageInspectorModel`**

Replace the full contents of `Sources/AnglesiteApp/GenericPageInspectorModel.swift` with:

```swift
// Sources/AnglesiteApp/GenericPageInspectorModel.swift
import Foundation
import SwiftUI
import Observation
import AnglesiteCore

/// Inspector for a selected page/entry that isn't a registered content type (`ContentTypeResolver`)
/// or a plain frontmatter page (`.md`/`.mdx`/`.markdown`) — most commonly a hand-authored `.astro`
/// page. There's no safe generic way to parse and rewrite an Astro component's script frontmatter
/// (it's JS, not YAML), so title/description/body stay permanently read-only (#1100). The two
/// search/crawling toggles are the one exception (#1093): they're backed by the shared
/// `RobotsConfigFile`, never by this page's own file, so editing them needs no Astro-aware parsing.
@MainActor
@Observable
final class GenericPageInspectorModel: InspectorEditorModel {
    let file: FileRef
    let route: String
    private let sourceDirectory: URL

    var noindexEnabled = false
    private var savedNoindexEnabled = false
    var disallowCrawlEnabled = false
    private var savedDisallowCrawlEnabled = false

    private(set) var isSaving = false
    let loadError: String? = nil
    private(set) var isLoading = false
    var conflictDiskContents: String? {
        get { nil }
        set { }
    }

    var isDirty: Bool {
        noindexEnabled != savedNoindexEnabled || disallowCrawlEnabled != savedDisallowCrawlEnabled
    }

    init(file: FileRef, route: String, sourceDirectory: URL) {
        self.file = file
        self.route = route
        self.sourceDirectory = sourceDirectory
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        let flags = RobotsConfigFile.flags(for: robotsSource, under: sourceDirectory)
        noindexEnabled = flags.noindex
        savedNoindexEnabled = flags.noindex
        disallowCrawlEnabled = flags.disallowCrawl
        savedDisallowCrawlEnabled = flags.disallowCrawl
    }

    @discardableResult
    func save() async -> Bool {
        guard isDirty, !isSaving else { return true }
        isSaving = true
        defer { isSaving = false }
        do {
            try RobotsConfigFile.apply(
                source: robotsSource, noindex: noindexEnabled, disallowCrawl: disallowCrawlEnabled,
                path: route, under: sourceDirectory
            )
            savedNoindexEnabled = noindexEnabled
            savedDisallowCrawlEnabled = disallowCrawlEnabled
            return true
        } catch {
            return false
        }
    }

    func flushBeforeLeaving() async -> Bool { await save() }
    func checkExternalChange() async {}
    func keepMyChanges() {}
    func reloadFromDisk() async {}

    func noindexBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.noindexEnabled ?? false },
                set: { [weak self] in self?.noindexEnabled = $0 })
    }
    func disallowCrawlBinding() -> Binding<Bool> {
        Binding(get: { [weak self] in self?.disallowCrawlEnabled ?? false },
                set: { [weak self] in self?.disallowCrawlEnabled = $0 })
    }

    private var robotsSource: RobotsConfigSource {
        .page(file: relativePath(of: file.url, under: sourceDirectory))
    }

    private func relativePath(of url: URL, under root: URL) -> String {
        let u = url.standardizedFileURL.path(percentEncoded: false)
        let r = root.standardizedFileURL.path(percentEncoded: false)
        if u.hasPrefix(r) { return String(u.dropFirst(r.count)).drop(while: { $0 == "/" }).description }
        return url.lastPathComponent
    }
}
```

- [ ] **Step 4: Update the call site**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, in `makeInspectorContext(forNavigatorID:)` (around line 1063):

```swift
        // Plain .astro / other: no safe generic way to parse or rewrite its frontmatter (JS, not
        // YAML), so the panel stays read-only rather than staying unavailable (#1100).
        return .generic(GenericPageInspectorModel(file: file, route: route))
```

becomes:

```swift
        // Plain .astro / other: no safe generic way to parse or rewrite its frontmatter (JS, not
        // YAML), so title/description/body stay read-only (#1100) — the search/crawling toggles
        // are the one exception (#1093), backed by the shared robots config, not this file.
        return .generic(GenericPageInspectorModel(file: file, route: route, sourceDirectory: source))
```

Grep for any other call sites:

Run: `grep -rn "GenericPageInspectorModel(" Sources/ Tests/`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `swift test --package-path . --filter GenericPageInspectorModelRobotsSettingsTests`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full AnglesiteApp test suite**

Run: `swift test --package-path . --filter AnglesiteAppTests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Sources/AnglesiteApp/GenericPageInspectorModel.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/GenericPageInspectorModelRobotsSettingsTests.swift
git commit -m "feat(#1093): make GenericPageInspectorModel's robots toggles editable"
```

---

## Task 9: Shared `RobotsSettingsSection` view, wired into all three forms

**Files:**
- Modify: `Sources/AnglesiteApp/PageInspectorView.swift` (add the shared view; update `PageMetadataForm` and `GenericPageInfoForm`)
- Modify: `Sources/AnglesiteApp/TypedEntryEditorView.swift` (update `TypedEntryForm`)

**Interfaces:**
- Consumes: `noindexBinding()`/`disallowCrawlBinding()` from Tasks 6-8 on all three model types.

- [ ] **Step 1: Add the shared view and wire `PageMetadataForm` + `GenericPageInfoForm`**

In `Sources/AnglesiteApp/PageInspectorView.swift`, replace the two form structs (`GenericPageInfoForm` and `PageMetadataForm`, currently lines 25-57) with:

```swift
/// Identity + the two shared search/crawling toggles for a page with no other editable metadata
/// (e.g. a plain `.astro` page) — see `GenericPageInspectorModel` (#1100, #1093).
private struct GenericPageInfoForm: View {
    @Bindable var model: GenericPageInspectorModel

    var body: some View {
        Form {
            LabeledContent("Route", value: model.route)
            RobotsSettingsSection(noindex: model.noindexBinding(), disallowCrawl: model.disallowCrawlBinding())
            Section {
                Text("Title, description, and body can't be edited for this page type yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

/// The form for a plain (non-typed) frontmatter page: title, description, and the two shared
/// search/crawling toggles.
private struct PageMetadataForm: View {
    @Bindable var model: PageMetadataModel

    var body: some View {
        Form {
            TextField("Title", text: model.titleBinding())
            VStack(alignment: .leading) {
                Text("Description").font(.caption).foregroundStyle(.secondary)
                TextField("", text: model.descriptionBinding(), axis: .vertical).lineLimit(2...6)
            }
            RobotsSettingsSection(noindex: model.noindexBinding(), disallowCrawl: model.disallowCrawlBinding())
        }
        .formStyle(.grouped)
    }
}

/// Two independent per-page controls, shared by all three inspector form variants (#1093).
/// `noindex` and `disallowCrawl` are intentionally separate toggles, not one checkbox — see
/// docs/superpowers/specs/2026-07-30-robots-noindex-design.md for why combining them is a known
/// SEO anti-pattern (a crawler blocked by `disallowCrawl` never sees a `noindex` tag it can't fetch).
struct RobotsSettingsSection: View {
    @Binding var noindex: Bool
    @Binding var disallowCrawl: Bool

    var body: some View {
        Section("Search & Crawling") {
            Toggle("Hide from search results", isOn: $noindex)
            Toggle("Block crawling entirely", isOn: $disallowCrawl)
                .help("Stronger than \"Hide from search results\" — well-behaved crawlers won't fetch this page at all, so a noindex tag on it would never be seen.")
        }
    }
}
```

- [ ] **Step 2: Wire `TypedEntryForm`**

In `Sources/AnglesiteApp/TypedEntryEditorView.swift`, the `body` of `TypedEntryForm` currently is:

```swift
    var body: some View {
        Form {
            ForEach(scalarFields, id: \.name) { field in
                control(for: field)
            }
            if let body = bodyField {
                Section("Body") {
                    MarkdownTextView(
                        text: model.textBinding(body.name),
                        controller: model.markdownController,
                        // Distinct from the main-pane editor of the same file (different text
                        // scope — body-only vs whole file), so their undo stacks never mix.
                        documentId: model.file.id + "#body",
                        fitsContent: true
                    )
                    .frame(minHeight: 160)
                }
            }
        }
        .formStyle(.grouped)
    }
```

Replace with:

```swift
    var body: some View {
        Form {
            ForEach(scalarFields, id: \.name) { field in
                control(for: field)
            }
            RobotsSettingsSection(noindex: model.noindexBinding(), disallowCrawl: model.disallowCrawlBinding())
            if let body = bodyField {
                Section("Body") {
                    MarkdownTextView(
                        text: model.textBinding(body.name),
                        controller: model.markdownController,
                        // Distinct from the main-pane editor of the same file (different text
                        // scope — body-only vs whole file), so their undo stacks never mix.
                        documentId: model.file.id + "#body",
                        fitsContent: true
                    )
                    .frame(minHeight: 160)
                }
            }
        }
        .formStyle(.grouped)
    }
```

- [ ] **Step 3: Build the app target**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: build succeeds. (This codebase has no SwiftUI view-snapshot test infrastructure — a clean build plus the manual verification in Task 10 is this task's test, matching how `PageInspectorView.swift`/`TypedEntryEditorView.swift` are verified today.)

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/PageInspectorView.swift Sources/AnglesiteApp/TypedEntryEditorView.swift
git commit -m "feat(#1093): add search/crawling toggles to the page inspector"
```

---

## Task 10: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Swift suite**

Run: `swift test --package-path .`
Expected: PASS.

- [ ] **Step 2: Run the full template test suite**

Run: `cd Resources/Template && npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Build the app**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification in the running app**

1. Launch the built app, open (or create) a site.
2. Select a plain page (e.g. the home page) in the Navigator — confirm the inspector shows "Hide from search results" / "Block crawling entirely" toggles alongside the read-only route.
3. Select `about.md` (or any frontmatter/typed page) — confirm the same two toggles appear alongside Title/Description or the typed fields.
4. Toggle "Hide from search results" on for one page, click Save. Confirm `Source/src/data/robots-config.json` in that site's package now has a `noindex` entry with a `source` pointing at that page.
5. Start the site's dev server, load that page, and confirm `<meta name="robots" content="noindex">` is present in the rendered `<head>` (view source or inspect element).
6. Toggle "Block crawling entirely" on for a different page, save, and run a production build (or the site's deploy pre-check) — confirm `public/robots.txt` contains a `Disallow:` line for that page's route with a `# ` back-reference comment above it, and `public/_headers` contains an `X-Robots-Tag: noindex` block for the page from step 4.
7. Toggle both back off and save — confirm both entries are removed from `robots-config.json`.

- [ ] **Step 5: Remove the issue's in-progress label**

Run: `gh issue edit 1093 --remove-label "🛠️ In Progress"`

(Per `CONTRIBUTING.md`, the label comes off once a PR is open — do this as part of opening the PR, not before.)
