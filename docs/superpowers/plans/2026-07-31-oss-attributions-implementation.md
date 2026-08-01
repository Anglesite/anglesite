# Open-Source Attributions Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Anglesite an "Open Source Acknowledgments" window (reachable from the App menu, next to About) that discloses every third-party package shipped in the app binary, the container image/sidecar, and the website template — backed by generated, CI-verified manifests, plus a generated notice file in every new site.

**Architecture:** Two small dependency-free generator scripts (one Python/bash for SwiftPM's `Package.resolved`, one Node for npm `node_modules` trees) produce three checked-in JSON manifests under `Resources/Attributions/`. `AnglesiteCore` exposes a typed `OSSAttribution` model and a bundle-resource loader. A `swift test`-covered `AcknowledgmentsViewModel` + SwiftUI view present the data in a new window. `SiteScaffolder` writes a rendered notice file into every new site from the website-template manifest. CI regenerates and diffs each manifest to catch drift.

**Tech Stack:** Swift 6.4 (AnglesiteCore/AnglesiteAppCore), Python 3 (stdlib only, invoked from bash — matches `check-xcodeproj-sync.sh`/`check-localization-catalog.sh`), Node.js (stdlib only, ESM, no new npm dependency), `node:test` for the Node script's unit tests, XCTest/Swift Testing per the existing per-target convention.

Spec: [`docs/superpowers/specs/2026-07-31-oss-attributions-design.md`](../specs/2026-07-31-oss-attributions-design.md)

## Global Constraints

- **No new dependencies, Swift or npm.** Both generator scripts use only stdlib (Python's `json`/`os`/`sys`; Node's `node:fs`/`node:path`). CONTRIBUTING.md requires explicit approval for new dependencies — this plan avoids the question entirely.
- **License text is stored in full** in the generated JSON, never just an SPDX id looked up against a bundled/fetched template — keeps the About window fully offline and avoids drift between a package's actual license text and a generic stand-in.
- **A package with no discoverable license file and no override entry MUST fail generation loudly** (non-zero exit, package name printed) — never emit an entry with empty/placeholder license text.
- **`AttributionSource` raw values are the exact manifest file stems**: `app-binary`, `container-image`, `website-template` (i.e. `Resources/Attributions/<rawValue>.json`).
- **Swift Testing, not XCTest, for new tests under `Tests/AnglesiteAppTests/`** (existing convention there); **XCTest for new tests under `Tests/AnglesiteCoreTests/`** (existing convention there — see `SiteScaffolderTests.swift`, `TemplateRuntimeTests.swift` uses Swift Testing actually for `AnglesiteCoreTests` too — check the specific file being extended and match its existing style, since this target mixes both per CLAUDE.md ("remaining XCTest holdouts")).
- **`swift test` locally needs `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`** exported first if `xcode-select -p` doesn't already point at a working Xcode 27 toolchain (`xcode-select -p` currently reports `/Applications/Xcode-beta.app/Contents/Developer` in this environment — verify before assuming you need to export it).
- **Conventional commits**, subject ≤72 characters, referencing this work's context in the body (no issue number exists for this feature — it was scoped directly with the user, not claimed from `gh issue list`).
- **Read `CONTRIBUTING.md` before making any repository change**, per this repo's standing CLAUDE.md instruction, even though you've read this plan.

---

### Task 1: `OSSAttribution` and `AttributionSource` types

**Files:**
- Create: `Sources/AnglesiteCore/OSSAttribution.swift`
- Test: `Tests/AnglesiteCoreTests/OSSAttributionTests.swift`

**Interfaces:**
- Produces: `OSSAttribution` (public struct: `name: String`, `version: String`, `licenseSPDXId: String?`, `licenseText: String`, `homepage: String?`; `Codable, Sendable, Identifiable, Hashable`; `id` = `"\(name)@\(version)"`); `AttributionSource` (public enum, `String, CaseIterable, Codable, Sendable`, cases `appBinary = "app-binary"`, `containerImage = "container-image"`, `websiteTemplate = "website-template"`, computed `displayName: String`).

- [ ] **Step 1: Write the failing test**

```swift
// Tests/AnglesiteCoreTests/OSSAttributionTests.swift
import XCTest
@testable import AnglesiteCore

final class OSSAttributionTests: XCTestCase {
    func testIdentityCombinesNameAndVersion() {
        let attribution = OSSAttribution(
            name: "swift-nio", version: "2.65.0", licenseSPDXId: "Apache-2.0",
            licenseText: "Apache License", homepage: "https://github.com/apple/swift-nio"
        )
        XCTAssertEqual(attribution.id, "swift-nio@2.65.0")
    }

    func testCodableRoundTrips() throws {
        let original = OSSAttribution(
            name: "SwiftGit2", version: "abc1234", licenseSPDXId: nil,
            licenseText: "Custom license text.", homepage: nil
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(OSSAttribution.self, from: data)
        XCTAssertEqual(decoded, original)
    }

    func testAttributionSourceRawValuesMatchManifestFileStems() {
        XCTAssertEqual(AttributionSource.appBinary.rawValue, "app-binary")
        XCTAssertEqual(AttributionSource.containerImage.rawValue, "container-image")
        XCTAssertEqual(AttributionSource.websiteTemplate.rawValue, "website-template")
    }

    func testDisplayNames() {
        XCTAssertEqual(AttributionSource.appBinary.displayName, "App")
        XCTAssertEqual(AttributionSource.containerImage.displayName, "Container & Sidecar")
        XCTAssertEqual(AttributionSource.websiteTemplate.displayName, "Website Template")
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter OSSAttributionTests`
Expected: FAIL — "cannot find 'OSSAttribution' in scope" (type doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/OSSAttribution.swift
import Foundation

/// One third-party package Anglesite discloses in the Acknowledgments window — see
/// docs/superpowers/specs/2026-07-31-oss-attributions-design.md. `licenseText` is the package's
/// full, actual license text (never just an SPDX id looked up against a generic template), so the
/// window stays fully correct offline. `homepage` is a plain string, not `URL`, because generator
/// scripts source it from raw `Package.resolved`/`package.json` values that don't always parse as
/// a strict `URL` (e.g. `git+https://…` before stripping); consumers that need a `URL` construct
/// one with `URL(string:)` and treat failure as "no link".
public struct OSSAttribution: Codable, Sendable, Identifiable, Hashable {
    public var id: String { "\(name)@\(version)" }
    public let name: String
    public let version: String
    public let licenseSPDXId: String?
    public let licenseText: String
    public let homepage: String?

    public init(name: String, version: String, licenseSPDXId: String?, licenseText: String, homepage: String?) {
        self.name = name
        self.version = version
        self.licenseSPDXId = licenseSPDXId
        self.licenseText = licenseText
        self.homepage = homepage
    }
}

/// One of the three channels Anglesite distributes third-party code through. The raw value is
/// also the manifest file stem: `Resources/Attributions/<rawValue>.json`.
public enum AttributionSource: String, CaseIterable, Codable, Sendable {
    /// SwiftPM packages linked directly into `Anglesite.app` (see `Package.resolved`).
    case appBinary = "app-binary"
    /// npm packages inside the vendored container image's MCP sidecar (`server/node_modules`).
    case containerImage = "container-image"
    /// npm packages scaffolded into every new site from `Resources/Template/package.json`.
    case websiteTemplate = "website-template"

    public var displayName: String {
        switch self {
        case .appBinary: "App"
        case .containerImage: "Container & Sidecar"
        case .websiteTemplate: "Website Template"
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter OSSAttributionTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/OSSAttribution.swift Tests/AnglesiteCoreTests/OSSAttributionTests.swift
git commit -m "feat(attributions): add OSSAttribution and AttributionSource types"
```

---

### Task 2: `AttributionCatalog` bundle-resource loader

**Files:**
- Create: `Sources/AnglesiteCore/AttributionCatalog.swift`
- Test: `Tests/AnglesiteCoreTests/AttributionCatalogTests.swift`

**Interfaces:**
- Consumes: `OSSAttribution`, `AttributionSource` (Task 1).
- Produces: `AttributionCatalogError` (public enum, `Error, Equatable`, cases `resourceMissing(AttributionSource)`, `decodingFailed(AttributionSource)`); `AttributionCatalog.load(_ source: AttributionSource, bundle: Bundle = .main) throws -> [OSSAttribution]` (public); `AttributionCatalog.decode(_ data: Data, source: AttributionSource) throws -> [OSSAttribution]` (internal — used by tests via `@testable import` and by `load`).

- [ ] **Step 1: Write the failing test**

```swift
// Tests/AnglesiteCoreTests/AttributionCatalogTests.swift
import XCTest
@testable import AnglesiteCore

final class AttributionCatalogTests: XCTestCase {
    func testDecodeRoundTripsAFixtureEntry() throws {
        let json = """
        [{"name":"swift-nio","version":"2.65.0","licenseSPDXId":"Apache-2.0","licenseText":"Apache License text…","homepage":"https://github.com/apple/swift-nio"}]
        """
        let entries = try AttributionCatalog.decode(Data(json.utf8), source: .appBinary)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].name, "swift-nio")
        XCTAssertEqual(entries[0].licenseSPDXId, "Apache-2.0")
    }

    func testDecodeToleratesNilHomepageAndSPDXId() throws {
        let json = """
        [{"name":"some-fork","version":"abc1234","licenseSPDXId":null,"licenseText":"Custom license text.","homepage":null}]
        """
        let entries = try AttributionCatalog.decode(Data(json.utf8), source: .containerImage)
        XCTAssertEqual(entries.count, 1)
        XCTAssertNil(entries[0].licenseSPDXId)
        XCTAssertNil(entries[0].homepage)
    }

    func testDecodeThrowsDecodingFailedOnMalformedJSON() {
        XCTAssertThrowsError(try AttributionCatalog.decode(Data("not json".utf8), source: .websiteTemplate)) { error in
            XCTAssertEqual(error as? AttributionCatalogError, .decodingFailed(.websiteTemplate))
        }
    }

    func testLoadThrowsResourceMissingWhenBundleHasNoAttributionsFolder() {
        // Bundle.main inside `swift test` is the xctest runner, which has no
        // Resources/Attributions — same "missing bundled resource" shape TemplateRuntime
        // exercises for Resources/Template (TemplateRuntimeTests.resolveReportsMissingWhenNoSourceFound).
        XCTAssertThrowsError(try AttributionCatalog.load(.appBinary)) { error in
            XCTAssertEqual(error as? AttributionCatalogError, .resourceMissing(.appBinary))
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter AttributionCatalogTests`
Expected: FAIL — "cannot find 'AttributionCatalog' in scope".

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteCore/AttributionCatalog.swift
import Foundation

public enum AttributionCatalogError: Error, Equatable {
    /// The app bundle has no `Resources/Attributions/<source>.json` (missing resource, or the
    /// process's `Bundle.main` isn't the app bundle at all — e.g. inside `swift test`).
    case resourceMissing(AttributionSource)
    /// The manifest file exists but isn't valid `[OSSAttribution]` JSON.
    case decodingFailed(AttributionSource)
}

/// Loads the generated, checked-in attribution manifests (see
/// docs/superpowers/specs/2026-07-31-oss-attributions-design.md). Manifests are generated by
/// `scripts/generate-attributions.sh` and committed under `Resources/Attributions/`.
public enum AttributionCatalog {
    /// Loads `Resources/Attributions/<source>.json` from `bundle`'s resource directory.
    public static func load(_ source: AttributionSource, bundle: Bundle = .main) throws -> [OSSAttribution] {
        guard let resourceURL = bundle.resourceURL,
              let data = try? Data(contentsOf: resourceURL.appendingPathComponent("Attributions/\(source.rawValue).json"))
        else {
            throw AttributionCatalogError.resourceMissing(source)
        }
        return try decode(data, source: source)
    }

    static func decode(_ data: Data, source: AttributionSource) throws -> [OSSAttribution] {
        do {
            return try JSONDecoder().decode([OSSAttribution].self, from: data)
        } catch {
            throw AttributionCatalogError.decodingFailed(source)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter AttributionCatalogTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AttributionCatalog.swift Tests/AnglesiteCoreTests/AttributionCatalogTests.swift
git commit -m "feat(attributions): add AttributionCatalog bundle-resource loader"
```

---

### Task 3: `generate-swift-attributions.sh` (Package.resolved → manifest)

This mirrors `scripts/check-xcodeproj-sync.sh`/`scripts/check-localization-catalog.sh`'s convention (a bash script with an inline `python3 - <<'PY'` heredoc, stdlib only) — that convention has no dedicated unit-test file in this repo; correctness is verified by running it against the real repo (Task 6) and by CI's `--check` mode (Task 8) against real data, not fixtures. Two facts, verified against this repo's actual `.build/checkouts/` before writing this task: (1) SwiftPM names a checkout directory after the **last path segment of the pin's `location` URL** (stripped of a trailing `.git`), not the lowercase `identity` — confirmed exactly matching all 43 current pins; (2) one dependency (HighlighterSwift) ships `LICENCE.md` (British spelling) instead of `LICENSE.md`, so the filename list below must include both spellings — confirmed this covers all 43 current checkouts with zero overrides needed today.

**Files:**
- Create: `scripts/generate-swift-attributions.sh`

**Interfaces:**
- Consumes: `Package.resolved` (v3 schema: `pins[].identity`, `.location`, `.state.{version,branch,revision}`), `.build/checkouts/<dir>/LICEN[SC]E*`, an overrides JSON file (Task 5) keyed by `"name@version"` or plain `"name"`, each value optionally `{"licenseText", "licenseSPDXId", "homepage"}`.
- Produces: a JSON file at the given output path containing `[OSSAttribution]`-shaped objects (keys `name`, `version`, `licenseSPDXId`, `licenseText`, `homepage`), sorted case-insensitively by `name`. CLI: `scripts/generate-swift-attributions.sh <repo-root> <output.json> <overrides.json>`. Exits non-zero (no output written) if any pin has neither a discoverable license file nor an override.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Generates the app-binary OSS attribution manifest from Package.resolved + the license files
# already checked out under .build/checkouts/ (populated by `swift package resolve` / `swift build`).
#
# Usage: scripts/generate-swift-attributions.sh <repo-root> <output.json> <overrides.json>
#
# See docs/superpowers/specs/2026-07-31-oss-attributions-design.md for the overrides format and
# the "fail loudly on an undisclosed license" rule this enforces.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <repo-root> <output.json> <overrides.json>" >&2
    exit 2
fi

REPO_ROOT="$1"
OUTPUT="$2"
OVERRIDES="$3"

if [[ ! -d "$REPO_ROOT/.build/checkouts" ]]; then
    echo "error: $REPO_ROOT/.build/checkouts not found — run 'swift package resolve' first." >&2
    exit 1
fi

python3 - "$REPO_ROOT" "$OUTPUT" "$OVERRIDES" <<'PY'
import json
import os
import sys

repo_root, output_path, overrides_path = sys.argv[1], sys.argv[2], sys.argv[3]

# Both spellings: one current dependency (HighlighterSwift) ships LICENCE.md, not LICENSE.md.
LICENSE_NAMES = [
    "LICENSE", "LICENSE.md", "LICENSE.txt",
    "LICENCE", "LICENCE.md", "LICENCE.txt",
    "COPYING", "COPYING.md", "COPYING.txt",
]


def find_license_text(directory):
    try:
        entries = {name.lower(): name for name in os.listdir(directory)}
    except FileNotFoundError:
        return None
    for candidate in LICENSE_NAMES:
        real_name = entries.get(candidate.lower())
        if real_name:
            with open(os.path.join(directory, real_name), encoding="utf-8", errors="replace") as f:
                return f.read()
    return None


def checkout_dir_name(location):
    # SwiftPM names .build/checkouts/<dir> after the repo name in the URL, not the (often
    # lowercased/hyphenated) `identity` field — verified against all pins in this repo.
    name = location.rstrip("/").split("/")[-1]
    return name[:-4] if name.endswith(".git") else name


with open(os.path.join(repo_root, "Package.resolved"), encoding="utf-8") as f:
    resolved = json.load(f)

with open(overrides_path, encoding="utf-8") as f:
    overrides = json.load(f)

checkouts_root = os.path.join(repo_root, ".build", "checkouts")
entries = []
failures = []

for pin in resolved["pins"]:
    name = checkout_dir_name(pin["location"])
    state = pin.get("state", {})
    version = state.get("version") or state.get("branch") or state.get("revision", "unknown")[:12]
    override = overrides.get(f"{name}@{version}") or overrides.get(name) or {}

    license_text = override.get("licenseText") or find_license_text(os.path.join(checkouts_root, name))
    if not license_text:
        failures.append(name)
        continue

    entries.append({
        "name": name,
        "version": version,
        "licenseSPDXId": override.get("licenseSPDXId"),
        "licenseText": license_text,
        "homepage": override.get("homepage") or pin["location"],
    })

if failures:
    sys.stderr.write(
        "error: no license file found and no override for: " + ", ".join(sorted(failures)) + "\n"
        "       Add an entry to " + overrides_path + " once a human confirms the license.\n"
    )
    sys.exit(1)

entries.sort(key=lambda e: e["name"].lower())
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=2)
    f.write("\n")

print(f"Wrote {len(entries)} app-binary attribution(s) to {output_path}")
PY
```

- [ ] **Step 2: Make it executable and dry-run it against this repo**

Run:
```bash
chmod +x scripts/generate-swift-attributions.sh
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift package resolve
scripts/generate-swift-attributions.sh "$PWD" /tmp/app-binary.json <(echo '{}')
```
Expected: `Wrote 43 app-binary attribution(s) to /tmp/app-binary.json` (count may differ slightly if `Package.resolved` has changed since this plan was written — any count with **zero** entries in the `failures` error output is correct; a fresh failure list, if any, is a real gap to override, not a bug in the script).

- [ ] **Step 3: Inspect the output**

Run: `python3 -m json.tool /tmp/app-binary.json | head -20`
Expected: a JSON array of objects with `name`, `version`, `licenseSPDXId`, `licenseText`, `homepage` keys, sorted alphabetically by `name`.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-swift-attributions.sh
git commit -m "feat(attributions): add generate-swift-attributions.sh"
```

---

### Task 4: `generate-npm-attributions.mjs` (node_modules → manifest)

Unlike Task 3, this gets a dedicated fixture-based test file — Node has this repo's existing precedent for real unit tests (`Resources/Template`'s `node:test` suites), and this script's logic (recursive tree walk, three legacy npm `license` field shapes, override-merging, loud-failure) is substantial enough to warrant it. It runs directly via Node's built-in test runner (`node --test`) — no `package.json`, no `tsx`, no new tooling, since this script lives at the repo root where none of that exists today.

**Files:**
- Create: `scripts/generate-npm-attributions.mjs`
- Test: `scripts/generate-npm-attributions.test.mjs`

**Interfaces:**
- Produces (all named exports, plus a CLI when run directly): `findLicenseText(dir) -> string | null`, `extractLicenseId(pkg) -> string | null`, `extractHomepage(pkg) -> string | null`, `collectPackages(nodeModulesRoot) -> Map<"name@version", {dir, pkg}>`, `loadOverrides(overridesPath) -> object`, `generate(nodeModulesRoot, overridesPath) -> Array<{name, version, licenseSPDXId, licenseText, homepage}>` (throws `Error` listing every package with neither a license file nor an override).

- [ ] **Step 1: Write the failing tests**

```javascript
// scripts/generate-npm-attributions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findLicenseText, extractLicenseId, extractHomepage, collectPackages, generate,
} from "./generate-npm-attributions.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "attr-npm-test-"));
}

function writePackage(root, name, { version = "1.0.0", license, licenses, homepage, repository, licenseFile } = {}) {
  const dir = name.startsWith("@") ? join(root, ...name.split("/")) : join(root, name);
  mkdirSync(dir, { recursive: true });
  const pkg = { name, version };
  if (license !== undefined) pkg.license = license;
  if (licenses !== undefined) pkg.licenses = licenses;
  if (homepage !== undefined) pkg.homepage = homepage;
  if (repository !== undefined) pkg.repository = repository;
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (licenseFile) writeFileSync(join(dir, licenseFile.name), licenseFile.text);
  return dir;
}

test("findLicenseText finds LICENSE and both LICENCE spellings, else null", () => {
  const root = makeTempDir();
  try {
    const withLicense = join(root, "a");
    mkdirSync(withLicense);
    writeFileSync(join(withLicense, "LICENSE"), "MIT text");
    assert.equal(findLicenseText(withLicense), "MIT text");

    const withLicence = join(root, "b");
    mkdirSync(withLicence);
    writeFileSync(join(withLicence, "LICENCE.md"), "British spelling text");
    assert.equal(findLicenseText(withLicence), "British spelling text");

    const withNeither = join(root, "c");
    mkdirSync(withNeither);
    assert.equal(findLicenseText(withNeither), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractLicenseId handles string, object, and legacy array shapes", () => {
  assert.equal(extractLicenseId({ license: "MIT" }), "MIT");
  assert.equal(extractLicenseId({ license: { type: "Apache-2.0" } }), "Apache-2.0");
  assert.equal(extractLicenseId({ licenses: [{ type: "ISC" }] }), "ISC");
  assert.equal(extractLicenseId({}), null);
});

test("extractHomepage prefers homepage, falls back to repository, strips git+ and .git", () => {
  assert.equal(extractHomepage({ homepage: "https://example.com" }), "https://example.com");
  assert.equal(extractHomepage({ repository: "https://github.com/a/b" }), "https://github.com/a/b");
  assert.equal(
    extractHomepage({ repository: { url: "git+https://github.com/a/b.git" } }),
    "https://github.com/a/b"
  );
  assert.equal(extractHomepage({}), null);
});

test("collectPackages walks scoped and nested node_modules and dedupes by name@version", () => {
  const root = makeTempDir();
  try {
    writePackage(join(root, "node_modules"), "left-pad", { version: "1.3.0" });
    writePackage(join(root, "node_modules"), "@scope/thing", { version: "2.0.0" });
    // Nested (unhoisted) transitive dependency:
    writePackage(join(root, "node_modules", "left-pad", "node_modules"), "nested-dep", { version: "0.1.0" });

    const found = collectPackages(join(root, "node_modules"));
    assert.equal(found.size, 3);
    assert.ok(found.has("left-pad@1.3.0"));
    assert.ok(found.has("@scope/thing@2.0.0"));
    assert.ok(found.has("nested-dep@0.1.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate produces sorted entries with license text, id, and homepage", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "zeta-pkg", {
      version: "1.0.0", license: "MIT", homepage: "https://zeta.example",
      licenseFile: { name: "LICENSE", text: "MIT License text for zeta" },
    });
    writePackage(nm, "alpha-pkg", {
      version: "2.0.0", license: { type: "Apache-2.0" },
      licenseFile: { name: "LICENCE.md", text: "Apache text for alpha" },
    });
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, "{}");

    const entries = generate(nm, overridesPath);
    assert.deepEqual(entries.map((e) => e.name), ["alpha-pkg", "zeta-pkg"]);
    assert.equal(entries[0].licenseSPDXId, "Apache-2.0");
    assert.equal(entries[1].licenseText, "MIT License text for zeta");
    assert.equal(entries[1].homepage, "https://zeta.example");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate throws listing packages with no license file and no override", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "no-license-pkg", { version: "1.0.0" }); // no license field, no LICENSE file
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, "{}");

    assert.throws(() => generate(nm, overridesPath), /no-license-pkg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an override supplies license text for a package that ships none", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "no-license-pkg", { version: "1.0.0" });
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, JSON.stringify({
      "no-license-pkg@1.0.0": { licenseText: "Confirmed MIT text.", licenseSPDXId: "MIT" },
    }));

    const entries = generate(nm, overridesPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].licenseText, "Confirmed MIT text.");
    assert.equal(entries[0].licenseSPDXId, "MIT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/generate-npm-attributions.test.mjs`
Expected: FAIL — the import fails because `scripts/generate-npm-attributions.mjs` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Save as `scripts/generate-npm-attributions.mjs` — the shebang below must be the file's literal first line (no leading comment above it), so the script stays executable after `chmod +x`:

```javascript
#!/usr/bin/env node
// Generates an OSS attribution manifest from a resolved node_modules tree.
// Usage: node generate-npm-attributions.mjs <node_modules-root> <output.json> [overrides.json]
//
// See docs/superpowers/specs/2026-07-31-oss-attributions-design.md for the overrides format and
// the "fail loudly on an undisclosed license" rule `generate` enforces.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

// Both spellings: npm packages occasionally ship the British "LICENCE" spelling.
const LICENSE_NAMES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt",
  "LICENCE", "LICENCE.md", "LICENCE.txt",
  "COPYING", "COPYING.md", "COPYING.txt",
];

export function findLicenseText(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const byLowerName = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const candidate of LICENSE_NAMES) {
    const realName = byLowerName.get(candidate.toLowerCase());
    if (realName) return readFileSync(join(dir, realName), "utf8");
  }
  return null;
}

/** Handles the three shapes npm's `license`/`licenses` field has taken over the registry's history. */
export function extractLicenseId(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0] && typeof pkg.licenses[0].type === "string") {
    return pkg.licenses[0].type;
  }
  return null;
}

export function extractHomepage(pkg) {
  if (typeof pkg.homepage === "string") return pkg.homepage;
  const repo = pkg.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo.url === "string") return repo.url.replace(/^git\+/, "").replace(/\.git$/, "");
  return null;
}

/**
 * Recursively finds every package directory under a node_modules tree — including nested
 * node_modules from unhoisted transitive dependencies — keyed by "name@version" to dedupe.
 */
export function collectPackages(nodeModulesRoot) {
  const found = new Map();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".bin") continue;
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      if (entry.startsWith("@")) {
        walk(entryPath); // scoped packages live one level deeper (@scope/name)
        continue;
      }

      const pkgJsonPath = join(entryPath, "package.json");
      if (existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (pkg.name && pkg.version) {
          found.set(`${pkg.name}@${pkg.version}`, { dir: entryPath, pkg });
        }
      }
      const nested = join(entryPath, "node_modules");
      if (existsSync(nested)) walk(nested);
    }
  }

  walk(nodeModulesRoot);
  return found;
}

export function loadOverrides(overridesPath) {
  if (!overridesPath || !existsSync(overridesPath)) return {};
  return JSON.parse(readFileSync(overridesPath, "utf8"));
}

/**
 * Builds the sorted attribution list for one node_modules tree. Throws (naming every offending
 * package) if any package has neither a discoverable license file nor an override entry — a
 * legal-disclosure gap must never resolve silently.
 */
export function generate(nodeModulesRoot, overridesPath) {
  const overrides = loadOverrides(overridesPath);
  const packages = collectPackages(nodeModulesRoot);
  const entries = [];
  const failures = [];

  for (const [key, { dir, pkg }] of packages) {
    const override = overrides[key] || overrides[pkg.name] || {};
    const licenseText = override.licenseText || findLicenseText(dir);
    if (!licenseText) {
      failures.push(key);
      continue;
    }
    entries.push({
      name: pkg.name,
      version: pkg.version,
      licenseSPDXId: override.licenseSPDXId ?? extractLicenseId(pkg),
      licenseText,
      homepage: override.homepage ?? extractHomepage(pkg),
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `no license file found and no override for: ${failures.sort().join(", ")}\n` +
      `       Add an entry to ${overridesPath} once a human confirms the license.`
    );
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function main() {
  const [, , nodeModulesRoot, outputPath, overridesPath] = process.argv;
  if (!nodeModulesRoot || !outputPath) {
    console.error("usage: generate-npm-attributions.mjs <node_modules-root> <output.json> [overrides.json]");
    process.exit(2);
  }
  const entries = generate(nodeModulesRoot, overridesPath);
  writeFileSync(outputPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`Wrote ${entries.length} attribution(s) to ${outputPath}`);
}

if (process.argv[1] && basename(process.argv[1]) === "generate-npm-attributions.mjs") {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/generate-npm-attributions.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/generate-npm-attributions.mjs
git add scripts/generate-npm-attributions.mjs scripts/generate-npm-attributions.test.mjs
git commit -m "feat(attributions): add generate-npm-attributions.mjs"
```

---

### Task 5: Overrides file + `generate-attributions.sh` wrapper + resource wiring

**Files:**
- Create: `scripts/attributions-overrides.json`
- Create: `scripts/generate-attributions.sh`
- Modify: `project.yml` (add `Resources/Attributions` as a resource folder on the `Anglesite` target)

**Interfaces:**
- Consumes: `scripts/generate-swift-attributions.sh` (Task 3), `scripts/generate-npm-attributions.mjs` (Task 4).
- Produces: `scripts/generate-attributions.sh [--check]` — the single entry point Task 6 (real generation) and Task 8 (CI) both use.

- [ ] **Step 1: Create the starter overrides file**

```json
{}
```
Save as `scripts/attributions-overrides.json`.

- [ ] **Step 2: Write the wrapper script**

```bash
#!/usr/bin/env bash
# Regenerates the checked-in OSS attribution manifests under Resources/Attributions/ from the
# app's three dependency sources. See
# docs/superpowers/specs/2026-07-31-oss-attributions-design.md.
#
# Usage:
#   scripts/generate-attributions.sh          # regenerate and overwrite Resources/Attributions/*.json
#   scripts/generate-attributions.sh --check  # regenerate into a temp dir and diff against the
#                                              # committed files; exits non-zero on any drift (CI mode).
#
# Requires: `swift package resolve` already run (app-binary), `npm ci` in Resources/Template
# (website-template), and — only for the container-image bucket — a sidecar checkout with
# `npm ci` already run at $ANGLESITE_SIDECAR_SRC (falls back to ../anglesite, same convention as
# scripts/lib/stage-dev-image-context.sh). Missing sidecar is a warning, not a failure: this
# script must still succeed for contributors who don't have the sidecar checked out.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERRIDES="$ROOT/scripts/attributions-overrides.json"
OUT_DIR="$ROOT/Resources/Attributions"

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
    CHECK=1
elif [[ $# -gt 0 ]]; then
    echo "unknown argument: $1" >&2
    exit 2
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> app-binary (Package.resolved)"
"$ROOT/scripts/generate-swift-attributions.sh" "$ROOT" "$WORK_DIR/app-binary.json" "$OVERRIDES"

echo "==> website-template (Resources/Template/node_modules)"
if [[ ! -d "$ROOT/Resources/Template/node_modules" ]]; then
    echo "error: Resources/Template/node_modules not found — run 'npm ci' in Resources/Template first." >&2
    exit 1
fi
node "$ROOT/scripts/generate-npm-attributions.mjs" "$ROOT/Resources/Template/node_modules" "$WORK_DIR/website-template.json" "$OVERRIDES"

SIDECAR_SRC="${ANGLESITE_SIDECAR_SRC:-${ANGLESITE_PLUGIN_SRC:-$(cd "$ROOT/.." && pwd)/anglesite}}"
if [[ -d "$SIDECAR_SRC/node_modules" ]]; then
    echo "==> container-image ($SIDECAR_SRC/node_modules)"
    node "$ROOT/scripts/generate-npm-attributions.mjs" "$SIDECAR_SRC/node_modules" "$WORK_DIR/container-image.json" "$OVERRIDES"
else
    echo "warning: $SIDECAR_SRC/node_modules not found — skipping container-image attributions." >&2
    echo "         Set ANGLESITE_SIDECAR_SRC and run 'npm ci' there to include it." >&2
fi

if [[ $CHECK -eq 1 ]]; then
    STATUS=0
    shopt -s nullglob
    for f in "$WORK_DIR"/*.json; do
        name="$(basename "$f")"
        if [[ ! -f "$OUT_DIR/$name" ]]; then
            echo "missing committed manifest: Resources/Attributions/$name" >&2
            STATUS=1
        elif ! diff -u "$OUT_DIR/$name" "$f"; then
            echo "stale committed manifest: Resources/Attributions/$name (run scripts/generate-attributions.sh to refresh)" >&2
            STATUS=1
        fi
    done
    exit $STATUS
else
    mkdir -p "$OUT_DIR"
    cp "$WORK_DIR"/*.json "$OUT_DIR/"
    echo "Wrote manifests to $OUT_DIR"
fi
```

- [ ] **Step 3: Add `Resources/Attributions` as an app resource in `project.yml`**

Find this block (the `Anglesite` target's `sources:` list, right after the `Resources/Template` entry):
```yaml
      - path: Resources/Template
        type: folder
        buildPhase: resources
      - path: Resources/edit-overlay
```
Change to:
```yaml
      - path: Resources/Template
        type: folder
        buildPhase: resources
      - path: Resources/Attributions
        type: folder
        buildPhase: resources
      - path: Resources/edit-overlay
```

- [ ] **Step 4: Commit**

```bash
chmod +x scripts/generate-attributions.sh
git add scripts/attributions-overrides.json scripts/generate-attributions.sh project.yml
git commit -m "feat(attributions): add generate-attributions.sh wrapper and resource wiring"
```

---

### Task 6: Generate and commit the real manifests

**Files:**
- Create: `Resources/Attributions/app-binary.json`
- Create: `Resources/Attributions/website-template.json`
- Create: `Resources/Attributions/container-image.json` (only if a sidecar checkout is available — see below)

**Interfaces:**
- Consumes: `scripts/generate-attributions.sh` (Task 5).

- [ ] **Step 1: Ensure prerequisites are in place**

Run:
```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift package resolve
(cd Resources/Template && npm ci --no-audit --no-fund)
```
Expected: both complete with exit 0. `.build/checkouts/` and `Resources/Template/node_modules/` now exist.

- [ ] **Step 2: Run the generator**

Run: `scripts/generate-attributions.sh`
Expected: `==> app-binary …` and `==> website-template …` sections each print `Wrote N attribution(s) to …`, ending with `Wrote manifests to <repo>/Resources/Attributions`. If `ANGLESITE_SIDECAR_SRC` isn't set and no sibling `../anglesite` checkout exists, you'll see the container-image warning and only two files are written — that's expected and acceptable; a follow-up run with the sidecar available fills in the third.

- [ ] **Step 3: Handle any generation failure**

If step 2 exits non-zero naming one or more packages: for each named package, look up its actual license (its repository's `LICENSE` file, or its npm registry page's "License" field) and add an entry to `scripts/attributions-overrides.json`, e.g.:
```json
{
  "some-package@1.2.3": {
    "licenseText": "<paste the real, complete license text here>",
    "licenseSPDXId": "MIT"
  }
}
```
Re-run `scripts/generate-attributions.sh` until it succeeds. (Note: as of writing this plan, all 43 current SwiftPM dependencies resolve cleanly with an empty overrides file — a failure here means either a new dependency was added since, or the npm side needs a genuine override.)

- [ ] **Step 4: Sanity-check file sizes and content**

Run: `ls -la Resources/Attributions/ && python3 -c "import json; print(len(json.load(open('Resources/Attributions/app-binary.json'))))"`
Expected: non-trivial file sizes (tens to hundreds of KB is normal for embedded license text) and a package count matching `Package.resolved`'s pin count.

- [ ] **Step 5: Regenerate the Xcode project and commit**

```bash
xcodegen generate
git add Resources/Attributions/ scripts/attributions-overrides.json
git commit -m "feat(attributions): generate initial attribution manifests"
```

---

### Task 7: Real-manifest sanity test

**Files:**
- Modify: `Tests/AnglesiteCoreTests/AttributionCatalogTests.swift` (append one test)

**Interfaces:**
- Consumes: `AttributionCatalog.decode` (Task 2), the real files committed in Task 6.

- [ ] **Step 1: Write the failing test**

Append to `Tests/AnglesiteCoreTests/AttributionCatalogTests.swift`:
```swift
    /// Guards the checked-in manifests directly, independent of the generator scripts'
    /// correctness: every committed Resources/Attributions/*.json (that exists) must decode and
    /// be non-empty. Reads by repo-root-relative path (not `Bundle.main`) since the xctest host
    /// has no Attributions resources — same convention as
    /// `SiteScaffolderTests.realScaffoldScriptURL()`.
    func testCommittedManifestsThatExistDecodeAndAreNonEmpty() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        var checkedAtLeastOne = false
        for source in AttributionSource.allCases {
            let url = repoRoot.appendingPathComponent("Resources/Attributions/\(source.rawValue).json")
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            let data = try Data(contentsOf: url)
            let entries = try AttributionCatalog.decode(data, source: source)
            XCTAssertFalse(entries.isEmpty, "\(source.rawValue).json decoded but is empty")
            checkedAtLeastOne = true
        }
        XCTAssertTrue(checkedAtLeastOne, "expected at least one Resources/Attributions/*.json to exist")
    }
```

- [ ] **Step 2: Run test to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter AttributionCatalogTests`
Expected: PASS (5 tests total in this file). If it fails, Task 6 didn't actually commit valid manifests — go back and fix that before continuing.

- [ ] **Step 3: Commit**

```bash
git add Tests/AnglesiteCoreTests/AttributionCatalogTests.swift
git commit -m "test(attributions): verify committed manifests decode"
```

---

### Task 8: CI drift checks

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/generate-swift-attributions.sh` (Task 3), `scripts/generate-npm-attributions.mjs` (Task 4), `scripts/attributions-overrides.json` (Task 5), the committed manifests (Task 6).

- [ ] **Step 1: Widen the `changes` job's path filters**

Find (in the `changes` job's `Detect changed paths` step):
```bash
          swift=false; js=false; template=false; helpBook=false
          matches 'Package.swift' 'Package.resolved' 'project.yml' 'Sources/**' 'Tests/**' 'Resources/Template/**' 'scripts/**' '.github/workflows/ci.yml' && swift=true
          matches 'JS/edit-overlay/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && js=true
          matches 'Resources/Template/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && template=true
          matches 'Resources/Anglesite.help/**' 'scripts/check-help-links.sh' '.github/workflows/ci.yml' && helpBook=true
```
Replace with:
```bash
          swift=false; js=false; template=false; helpBook=false
          matches 'Package.swift' 'Package.resolved' 'project.yml' 'Sources/**' 'Tests/**' 'Resources/Template/**' 'Resources/Attributions/**' 'scripts/**' '.github/workflows/ci.yml' && swift=true
          matches 'JS/edit-overlay/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && js=true
          matches 'Resources/Template/**' 'scripts/node-version.txt' 'scripts/generate-npm-attributions.mjs' 'scripts/attributions-overrides.json' '.github/workflows/ci.yml' && template=true
          matches 'Resources/Anglesite.help/**' 'scripts/check-help-links.sh' '.github/workflows/ci.yml' && helpBook=true
```
(`scripts/**` already covers the new scripts for the `swift` filter — only the `template` filter needs the explicit additions, since it doesn't match `scripts/**` broadly.)

- [ ] **Step 2: Add the app-binary and container-image checks to `build-test`**

Find (in the `build-test` job, right after `Install plugin dependencies`):
```yaml
      - name: Install plugin dependencies
        working-directory: anglesite-plugin
        run: npm ci --no-audit --no-fund

      - name: Select latest available Xcode
```
Replace with:
```yaml
      - name: Install plugin dependencies
        working-directory: anglesite-plugin
        run: npm ci --no-audit --no-fund

      - name: Check container-image attributions manifest
        env:
          ANGLESITE_SIDECAR_SRC: ${{ github.workspace }}/anglesite-plugin
        run: |
          set -euo pipefail
          node scripts/generate-npm-attributions.mjs "$ANGLESITE_SIDECAR_SRC/node_modules" /tmp/container-image.json scripts/attributions-overrides.json
          diff -u Resources/Attributions/container-image.json /tmp/container-image.json

      - name: Select latest available Xcode
```

Find (in the same job, right after `Build (debug)`):
```yaml
      - name: Build (debug)
        run: swift build -c debug

      - name: Test
```
Replace with:
```yaml
      - name: Build (debug)
        run: swift build -c debug

      - name: Check app-binary attributions manifest
        run: |
          set -euo pipefail
          scripts/generate-swift-attributions.sh "$PWD" /tmp/app-binary.json scripts/attributions-overrides.json
          diff -u Resources/Attributions/app-binary.json /tmp/app-binary.json

      - name: Test
```

- [ ] **Step 3: Add the website-template check to `template-worker`**

Find (in the `template-worker` job):
```yaml
      - run: npm ci --no-audit --no-fund
      # The template's node:test suites had no CI lane at all — the `.well-known` design doc
```
Replace with:
```yaml
      - run: npm ci --no-audit --no-fund

      - name: Check website-template attributions manifest
        run: |
          set -euo pipefail
          node ../../scripts/generate-npm-attributions.mjs node_modules /tmp/website-template.json ../../scripts/attributions-overrides.json
          diff -u ../../Resources/Attributions/website-template.json /tmp/website-template.json
      # The template's node:test suites had no CI lane at all — the `.well-known` design doc
```
(This job's `defaults.run.working-directory` is `Resources/Template`, hence the `../../` prefixes back to the repo root.)

- [ ] **Step 4: Validate the YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: no output (valid YAML). If `pyyaml` isn't installed, instead run `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml')"` or open the file and re-read the three diffs above carefully for indentation.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(attributions): verify manifests stay in sync with dependencies"
```

---

### Task 9: `AcknowledgmentsViewModel`

**Files:**
- Create: `Sources/AnglesiteApp/AcknowledgmentsViewModel.swift`
- Test: `Tests/AnglesiteAppTests/AcknowledgmentsViewModelTests.swift`

**Interfaces:**
- Consumes: `OSSAttribution`, `AttributionSource`, `AttributionCatalog.load` (Task 1/2).
- Produces: `AcknowledgmentsViewModel` (public, `@MainActor @Observable` final class): `catalogs: [AttributionSource: [OSSAttribution]]` (read-only outside), `searchText: String`, `selection: OSSAttribution.ID?`, `unavailableSources: Set<AttributionSource>` (read-only outside), `init(load:log:)` with production defaults, `loadAll()`, `filtered(_ source: AttributionSource) -> [OSSAttribution]`, `attribution(withID id: OSSAttribution.ID) -> OSSAttribution?`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteAppTests/AcknowledgmentsViewModelTests.swift
import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

@Suite("AcknowledgmentsViewModel")
@MainActor
struct AcknowledgmentsViewModelTests {
    private func makeCatalogs() -> [AttributionSource: [OSSAttribution]] {
        [
            .appBinary: [
                OSSAttribution(name: "swift-nio", version: "2.65.0", licenseSPDXId: "Apache-2.0", licenseText: "…", homepage: nil),
                OSSAttribution(name: "SwiftGit2", version: "abc123", licenseSPDXId: "MIT", licenseText: "…", homepage: nil),
            ],
            .containerImage: [
                OSSAttribution(name: "express", version: "4.19.0", licenseSPDXId: "MIT", licenseText: "…", homepage: nil),
            ],
            .websiteTemplate: [],
        ]
    }

    @Test("loadAll populates every source")
    func loadAllPopulatesEverySource() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.catalogs[.appBinary]?.count == 2)
        #expect(model.catalogs[.containerImage]?.count == 1)
        #expect(model.catalogs[.websiteTemplate]?.count == 0)
        #expect(model.unavailableSources.isEmpty)
    }

    @Test("filtered matches case-insensitively by substring")
    func filteredMatchesCaseInsensitiveSubstring() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        model.searchText = "swift"
        #expect(model.filtered(.appBinary).map(\.name).sorted() == ["SwiftGit2", "swift-nio"])
        #expect(model.filtered(.containerImage).isEmpty)
    }

    @Test("empty search returns everything for a source")
    func emptySearchReturnsEverythingForSource() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.filtered(.appBinary).count == 2)
    }

    @Test("a load failure marks its source unavailable without losing the others")
    func loadFailureMarksSourceUnavailableWithoutLosingOthers() {
        struct Boom: Error {}
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(
            load: { source in
                if source == .containerImage { throw Boom() }
                return catalogs[source] ?? []
            },
            log: { _ in }
        )
        model.loadAll()
        #expect(model.unavailableSources.contains(.containerImage))
        #expect(model.catalogs[.containerImage] == nil)
        #expect(model.catalogs[.appBinary]?.count == 2)
    }

    @Test("attribution(withID:) finds an entry across sources")
    func attributionByIDFindsAcrossSources() {
        let catalogs = makeCatalogs()
        let model = AcknowledgmentsViewModel(load: { catalogs[$0] ?? [] }, log: { _ in })
        model.loadAll()
        #expect(model.attribution(withID: "express@4.19.0")?.name == "express")
        #expect(model.attribution(withID: "nonexistent@0.0.0") == nil)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter AcknowledgmentsViewModelTests`
Expected: FAIL — "cannot find 'AcknowledgmentsViewModel' in scope".

- [ ] **Step 3: Write the implementation**

```swift
// Sources/AnglesiteApp/AcknowledgmentsViewModel.swift
import Foundation
import AnglesiteCore

/// Backs the Acknowledgments window (App menu, next to About). Kept separate from the SwiftUI
/// view so grouping/search/error-handling logic is unit-testable without a rendering harness —
/// same split as `TokenOnboarding`/`DeployModel`.
@MainActor
@Observable
public final class AcknowledgmentsViewModel {
    public private(set) var catalogs: [AttributionSource: [OSSAttribution]] = [:]
    public var searchText: String = ""
    public var selection: OSSAttribution.ID?
    public private(set) var unavailableSources: Set<AttributionSource> = []

    private let load: (AttributionSource) throws -> [OSSAttribution]
    private let log: (String) -> Void

    public init(
        load: @escaping (AttributionSource) throws -> [OSSAttribution] = { try AttributionCatalog.load($0) },
        log: @escaping (String) -> Void = { message in
            Task { await LogCenter.shared.append(source: "acknowledgments", stream: .stderr, text: message) }
        }
    ) {
        self.load = load
        self.log = log
    }

    /// Loads all three sources independently — one source failing to decode must not hide the
    /// other two (see `AttributionCatalogError`).
    public func loadAll() {
        for source in AttributionSource.allCases {
            do {
                catalogs[source] = try load(source)
            } catch {
                unavailableSources.insert(source)
                log("Failed to load \(source.rawValue) attributions: \(error)")
            }
        }
    }

    public func filtered(_ source: AttributionSource) -> [OSSAttribution] {
        let entries = catalogs[source] ?? []
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return entries }
        return entries.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    public func attribution(withID id: OSSAttribution.ID) -> OSSAttribution? {
        catalogs.values.flatMap { $0 }.first { $0.id == id }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter AcknowledgmentsViewModelTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/AcknowledgmentsViewModel.swift Tests/AnglesiteAppTests/AcknowledgmentsViewModelTests.swift
git commit -m "feat(attributions): add AcknowledgmentsViewModel"
```

---

### Task 10: `AcknowledgmentsView` + menu/window wiring

No new automated test in this task: the view is a thin composition over the already-tested `AcknowledgmentsViewModel` (Task 9), matching this codebase's convention of testing extracted view *logic* rather than SwiftUI view bodies (e.g. `CitationRowView`'s `handleTap` is tested, not the view itself). Manual verification happens in Task 12.

**Files:**
- Create: `Sources/AnglesiteApp/AcknowledgmentsView.swift`
- Modify: `Sources/AnglesiteApp/AnglesiteApp.swift`

**Interfaces:**
- Consumes: `AcknowledgmentsViewModel` (Task 9), `OSSAttribution`, `AttributionSource`.

- [ ] **Step 1: Write the view**

```swift
// Sources/AnglesiteApp/AcknowledgmentsView.swift
import SwiftUI
import AnglesiteCore

/// The "Open Source Acknowledgments…" window (App menu, next to About). Two-pane: a searchable
/// list grouped by ``AttributionSource`` on the left, the selected package's full license text
/// on the right.
struct AcknowledgmentsView: View {
    @State private var model = AcknowledgmentsViewModel()

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selection) {
                ForEach(AttributionSource.allCases, id: \.self) { source in
                    Section(source.displayName) {
                        if model.unavailableSources.contains(source) {
                            Text("Acknowledgments unavailable for this source.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(model.filtered(source)) { attribution in
                                VStack(alignment: .leading) {
                                    Text(attribution.name)
                                    Text(attribution.version)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(
                                    "\(attribution.name), version \(attribution.version), \(attribution.licenseSPDXId ?? "custom license")"
                                )
                                .tag(attribution.id)
                            }
                        }
                    }
                }
            }
            .searchable(text: $model.searchText)
            .navigationTitle("Acknowledgments")
        } detail: {
            if let id = model.selection, let attribution = model.attribution(withID: id) {
                AcknowledgmentDetailView(attribution: attribution)
            } else {
                ContentUnavailableView("Select a package to view its license.", systemImage: "doc.text")
            }
        }
        .task { model.loadAll() }
        .frame(minWidth: 640, minHeight: 420)
    }
}

private struct AcknowledgmentDetailView: View {
    let attribution: OSSAttribution

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(attribution.name)
                    .font(.title2.bold())
                Text(attribution.version)
                    .foregroundStyle(.secondary)
                Text(attribution.licenseSPDXId ?? "Custom License")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15), in: Capsule())
                if let homepage = attribution.homepage, let url = URL(string: homepage) {
                    Link("View homepage", destination: url)
                }
                Divider()
                Text(attribution.licenseText)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
```

- [ ] **Step 2: Wire the menu item and window scene into `AnglesiteApp.swift`**

Find:
```swift
            CommandGroup(replacing: .appInfo) {
                Button("About Anglesite") { showAboutPanel() }
            }
```
Replace with:
```swift
            CommandGroup(replacing: .appInfo) {
                Button("About Anglesite") { showAboutPanel() }
                Button("Open Source Acknowledgments…") { openWindow(id: "acknowledgments") }
            }
```

Find:
```swift
        Window("Anglesite Debug", id: "debug") {
            DebugPaneView()
        }
        .windowResizability(.contentSize)
        .defaultPosition(.bottomTrailing)
        .defaultSize(width: 900, height: 500)

        Settings {
```
Replace with:
```swift
        Window("Anglesite Debug", id: "debug") {
            DebugPaneView()
        }
        .windowResizability(.contentSize)
        .defaultPosition(.bottomTrailing)
        .defaultSize(width: 900, height: 500)

        Window("Acknowledgments", id: "acknowledgments") {
            AcknowledgmentsView()
        }
        .defaultSize(width: 760, height: 520)

        Settings {
```

- [ ] **Step 3: Confirm `AnglesiteAppCore` picks up the new file**

`AcknowledgmentsView.swift` is not named `AnglesiteApp.swift` or `LiveSiteRuntimeFactory.swift`, so Package.swift's existing `exclude: ["AnglesiteApp.swift", "LiveSiteRuntimeFactory.swift"]` on the `AnglesiteAppCore` target already includes it automatically — no `Package.swift` edit needed. Verify:

Run: `grep -n 'exclude:' Package.swift`
Expected: only `AnglesiteApp.swift` and `LiveSiteRuntimeFactory.swift` are excluded.

- [ ] **Step 4: Build to confirm it compiles**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift build -c debug --target AnglesiteAppCore`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteApp/AcknowledgmentsView.swift Sources/AnglesiteApp/AnglesiteApp.swift
git commit -m "feat(attributions): add Acknowledgments window and menu item"
```

---

### Task 11: Generated site notice file

**Files:**
- Create: `Sources/AnglesiteCore/ThirdPartyNoticeRenderer.swift`
- Test: `Tests/AnglesiteCoreTests/ThirdPartyNoticeRendererTests.swift`
- Modify: `Sources/AnglesiteCore/SiteScaffolder.swift`
- Modify: `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift`

**Interfaces:**
- Consumes: `OSSAttribution`, `AttributionCatalog`, `AttributionCatalogError` (Task 1/2).
- Produces: `ThirdPartyNoticeRenderer.render(_ attributions: [OSSAttribution]) -> String` (public); `SiteScaffolder.AttributionsLoader` typealias and a new `attributionsLoader:` init parameter (default `{ try AttributionCatalog.load($0) }`), matching the existing `appVersion`/`hostLanguage` injectable-dependency pattern in that type.

- [ ] **Step 1: Write the failing renderer tests**

```swift
// Tests/AnglesiteCoreTests/ThirdPartyNoticeRendererTests.swift
import XCTest
@testable import AnglesiteCore

final class ThirdPartyNoticeRendererTests: XCTestCase {
    func testRendersNameVersionLicenseAndHomepage() {
        let attribution = OSSAttribution(
            name: "astro", version: "7.1.3", licenseSPDXId: "MIT",
            licenseText: "MIT License\n\nCopyright (c) …", homepage: "https://astro.build"
        )
        let markdown = ThirdPartyNoticeRenderer.render([attribution])
        XCTAssertTrue(markdown.contains("## astro 7.1.3"))
        XCTAssertTrue(markdown.contains("License: MIT"))
        XCTAssertTrue(markdown.contains("Homepage: https://astro.build"))
        XCTAssertTrue(markdown.contains("MIT License"))
    }

    func testOmitsMissingFieldsGracefully() {
        let attribution = OSSAttribution(
            name: "some-fork", version: "abc123", licenseSPDXId: nil,
            licenseText: "Custom text.", homepage: nil
        )
        let markdown = ThirdPartyNoticeRenderer.render([attribution])
        XCTAssertFalse(markdown.contains("License: "))
        XCTAssertFalse(markdown.contains("Homepage: "))
        XCTAssertTrue(markdown.contains("Custom text."))
    }

    func testEmptyListRendersJustTheHeader() {
        let markdown = ThirdPartyNoticeRenderer.render([])
        XCTAssertTrue(markdown.hasPrefix("# Third-Party Notices"))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter ThirdPartyNoticeRendererTests`
Expected: FAIL — "cannot find 'ThirdPartyNoticeRenderer' in scope".

- [ ] **Step 3: Write the renderer**

```swift
// Sources/AnglesiteCore/ThirdPartyNoticeRenderer.swift
import Foundation

/// Renders a website-template attribution catalog into the Markdown notice file
/// `SiteScaffolder` writes into every new site's `Source/THIRD-PARTY-NOTICES.md`.
public enum ThirdPartyNoticeRenderer {
    public static func render(_ attributions: [OSSAttribution]) -> String {
        var lines = [
            "# Third-Party Notices", "",
            "This site's build tooling includes the following open-source packages.", "",
        ]
        for attribution in attributions {
            lines.append("## \(attribution.name) \(attribution.version)")
            lines.append("")
            if let spdx = attribution.licenseSPDXId {
                lines.append("License: \(spdx)")
                lines.append("")
            }
            if let homepage = attribution.homepage {
                lines.append("Homepage: \(homepage)")
                lines.append("")
            }
            lines.append("```")
            lines.append(attribution.licenseText.trimmingCharacters(in: .whitespacesAndNewlines))
            lines.append("```")
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter ThirdPartyNoticeRendererTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit the renderer**

```bash
git add Sources/AnglesiteCore/ThirdPartyNoticeRenderer.swift Tests/AnglesiteCoreTests/ThirdPartyNoticeRendererTests.swift
git commit -m "feat(attributions): add ThirdPartyNoticeRenderer"
```

- [ ] **Step 6: Write the failing SiteScaffolder integration tests**

Append to `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift` (inside the `SiteScaffolderTests` class, near `testHappyPathWritesADependencyBaselineAndStampsTheRealAppVersion`):
```swift
    func testHappyPathWritesThirdPartyNoticesFileFromTemplateAttributions() async throws {
        let root = tmpDir()
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: CallRecorder()),
            gitInit: { _ in },
            gitCommit: { _ in },
            register: { pkg in try SiteStore.Site.make(package: pkg) },
            attributionsLoader: { source in
                guard source == .websiteTemplate else { return [] }
                return [OSSAttribution(name: "astro", version: "7.1.3", licenseSPDXId: "MIT",
                                       licenseText: "MIT License text", homepage: "https://astro.build")]
            }
        )
        for await _ in scaffolder.scaffold(makeDraft()) {}

        let pkgURL = root.appendingPathComponent("acme-co.anglesite")
        let notice = try String(contentsOf: pkgURL.appendingPathComponent("Source/THIRD-PARTY-NOTICES.md"), encoding: .utf8)
        XCTAssertTrue(notice.contains("astro 7.1.3"))
        XCTAssertTrue(notice.contains("MIT License text"))
    }

    func testMissingAttributionsCatalogWarnsButStillRegisters() async throws {
        let root = tmpDir()
        let scaffolder = SiteScaffolder(
            sitesRoot: root, templateURL: URL(fileURLWithPath: "/template"), catalog: ThemeCatalog(themes: [theme]),
            run: fakeRunner(calls: CallRecorder()),
            gitInit: { _ in },
            gitCommit: { _ in },
            register: { pkg in try SiteStore.Site.make(package: pkg) },
            attributionsLoader: { _ in throw AttributionCatalogError.resourceMissing(.websiteTemplate) }
        )
        var steps: [SiteScaffolder.ScaffoldStep] = []
        for await s in scaffolder.scaffold(makeDraft()) { steps.append(s) }

        XCTAssertTrue(steps.contains {
            if case .warning(let s, let m) = $0 { return s == "copyingTemplate" && m.contains("Third-party notice") }
            return false
        })
        guard case .done? = steps.last else { return XCTFail("expected .done despite missing attributions catalog") }
    }
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter SiteScaffolderTests`
Expected: FAIL to compile — `SiteScaffolder.init` has no `attributionsLoader:` parameter yet.

- [ ] **Step 8: Add the injectable loader and pipeline step to `SiteScaffolder`**

In `Sources/AnglesiteCore/SiteScaffolder.swift`, add the typealias next to the other typealiases:
```swift
    /// Register a freshly-scaffolded package and return the Site (production: SiteStore.shared.record).
    public typealias Register = @Sendable (_ package: AnglesitePackage) async throws -> SiteStore.Site
    /// Loads one attribution source's catalog (production: `AttributionCatalog.load`). Injectable
    /// so tests don't depend on `Bundle.main` having real `Resources/Attributions/*.json`.
    public typealias AttributionsLoader = @Sendable (_ source: AttributionSource) throws -> [OSSAttribution]
```

Add the stored property next to the other closures:
```swift
    private let register: Register
    private let attributionsLoader: AttributionsLoader
```

Add the init parameter (after `register:`, before `fileManager:`) and assign it:
```swift
    public init(sitesRoot: URL, templateURL: URL, catalog: ThemeCatalog,
                run: @escaping CommandRunner, gitInit: @escaping GitInit,
                gitCommit: @escaping GitCommit,
                register: @escaping Register,
                attributionsLoader: @escaping AttributionsLoader = { try AttributionCatalog.load($0) },
                fileManager: FileManager = .default,
                appVersion: @escaping @Sendable () -> String? = { AppVersion.current() },
                hostLanguage: @escaping @Sendable () -> String = { SiteLanguageAsset.hostLanguageTag() }) {
        self.sitesRoot = sitesRoot
        self.templateURL = templateURL
        self.catalog = catalog
        self.run = run
        self.gitInit = gitInit
        self.gitCommit = gitCommit
        self.register = register
        self.attributionsLoader = attributionsLoader
        self.fileManager = fileManager
        self.appVersion = appVersion
        self.hostLanguage = hostLanguage
    }
```

Add the pipeline step right after "2b. git init in Source/" and before "3. Theme":
```swift
        // 2b. git init in Source/ (non-fatal — coordinates with #68).
        do { try await gitInit(siteDir) }
        catch { emit(.warning(step: "copyingTemplate", message: "git init skipped: \(humanize(error))")) }

        // 2c. Third-party notice for the template's own npm dependencies (non-fatal, same
        // handling as the dependency baseline above — the site is still viable without it).
        do {
            let attributions = try attributionsLoader(.websiteTemplate)
            let notice = ThirdPartyNoticeRenderer.render(attributions)
            try notice.write(to: siteDir.appendingPathComponent("THIRD-PARTY-NOTICES.md"), atomically: true, encoding: .utf8)
        } catch {
            emit(.warning(step: "copyingTemplate", message: "Third-party notice file not written: \(humanize(error))"))
        }
```
(Replace the existing "2b." block with this — it's the same `gitInit` code plus the new "2c." block appended after it.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test --filter SiteScaffolderTests`
Expected: PASS — all tests in this file, including the two new ones. The pre-existing tests (which don't pass `attributionsLoader:`) now also emit an extra "Third-party notice file not written" warning (their default `templateURL` is `/template`, so the real `AttributionCatalog.load` call would fail even if it worked, but more importantly `Bundle.main` inside `swift test` has no Attributions resources) — confirm no existing test asserts an *exclusive* list of warnings (they all use `.contains { … }`, which tolerates the extra warning).

- [ ] **Step 10: Commit**

```bash
git add Sources/AnglesiteCore/SiteScaffolder.swift Tests/AnglesiteCoreTests/SiteScaffolderTests.swift
git commit -m "feat(attributions): write THIRD-PARTY-NOTICES.md when scaffolding a site"
```

---

### Task 12: End-to-end manual verification

No automated test — this is a manual UI pass, the macOS-app equivalent of "start the dev server and use the feature in a browser" for a native app feature with no browser to drive.

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer swift test`
Expected: all suites pass, including every test added in Tasks 1, 2, 7, 9, 11.

- [ ] **Step 2: Build the app**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: build succeeds (this also runs `xcodegen generate` first, picking up the `Resources/Attributions` resource folder from Task 5).

- [ ] **Step 3: Launch and exercise the feature**

Launch the built `Anglesite.app` (from Xcode, ⌘R, or `open` the built product). Then:
1. Open the app menu (labeled "Anglesite"). Confirm "About Anglesite" and "Open Source Acknowledgments…" appear together, in that order, with no unrelated items between them.
2. Choose "Open Source Acknowledgments…". Confirm a new window opens titled "Acknowledgments" with a left-hand list grouped into "App", "Container & Sidecar" (if that manifest was generated in Task 6), and "Website Template" sections, and a right-hand pane prompting "Select a package to view its license."
3. Click a package (e.g. any App-section entry). Confirm the right pane shows its name, version, a license badge, and full license text that scrolls and is selectable.
4. Type into the search field. Confirm the list filters to matching names across all visible sections.
5. If the package has a homepage link, click it and confirm it opens in the default browser.
6. Close the window and reopen it from the menu again — confirm it reloads without error (no crash, no duplicate window if already open — standard SwiftUI `Window` scene behavior).

- [ ] **Step 4: Verify the generated-site notice file**

Use the app's New Site flow to scaffold a throwaway site. Confirm `Source/THIRD-PARTY-NOTICES.md` exists inside the new `.anglesite` package and contains at least one recognizable template dependency name (e.g. "astro").

- [ ] **Step 5: Report results**

If every check in Steps 3–4 passes, the feature is complete. If any step fails, treat it as a new bug to fix before considering this plan done — do not report success without having actually performed Steps 1–4.
