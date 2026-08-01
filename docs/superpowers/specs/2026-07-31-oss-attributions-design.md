# Open-source attributions framework

Status: draft. Not yet implemented.

## Problem

Anglesite ships third-party open-source code through three distinct channels, and none of it is currently attributed anywhere in the app:

1. **App binary** — ~40 SwiftPM packages linked directly into `Anglesite.app` (STTextView, SwiftNIO, gRPC-Swift, SwiftGit2, apple/containerization, etc. — see `Package.resolved`).
2. **Container image** — the vendored container image (`Resources/container-image/`) bundles Node.js and the `anglesite-skills` sidecar's npm dependencies (`server/node_modules`), staged by `scripts/lib/stage-dev-image-context.sh` and shipped to every user.
3. **Website template** — `Resources/Template/package.json` scaffolds ~32 npm dependencies into every new user site's `Source/`.

None of these are attributed today: there's no acknowledgments UI, no generated license manifest, and no notice file in scaffolded sites. Respecting these licenses requires disclosing them; this spec defines a framework to do that and keep it current as dependencies change.

Out of scope: license *compatibility* policy (e.g. flagging copyleft licenses as unsuitable for static linking). This spec is about disclosure, not enforcement — a future spec can layer policy checks on top of the same manifests if needed.

## Data model

A single Swift type represents one attributed package, shared across all three sources:

```swift
public struct OSSAttribution: Codable, Sendable, Identifiable, Hashable {
    public var id: String { "\(name)@\(version)" }
    public let name: String
    public let version: String
    public let licenseSPDXId: String?   // nil for a non-standard/custom license
    public let licenseText: String      // full text, embedded — no runtime network/SPDX lookup
    public let homepage: URL?
}

public enum AttributionSource: String, CaseIterable, Codable, Sendable {
    case appBinary
    case containerImage
    case websiteTemplate

    public var displayName: String {
        switch self {
        case .appBinary: "App"
        case .containerImage: "Container & Sidecar"
        case .websiteTemplate: "Website Template"
        }
    }
}
```

`OSSAttribution` and `AttributionSource` live in `AnglesiteCore` (new file `Sources/AnglesiteCore/OSSAttribution.swift`) so both the app's Acknowledgments window and the site-scaffolder's notice generator can use the same types.

License text is stored **in full**, not just an SPDX identifier looked up against a bundled or fetched license-text table. This keeps the About window fully offline and avoids drift between a package's actual bundled `LICENSE` file and a generic SPDX template that might not match (e.g. a project that adds a copyright-holder line to the standard MIT text). The cost is a somewhat larger resource bundle (~3.0MB combined across the three manifests, 918 entries total: 43 app-binary, 110 container-image, 765 website-template), which is negligible next to the container image.

### Catalog loading

```swift
public enum AttributionCatalogError: Error {
    case resourceMissing(AttributionSource)
    case decodingFailed(AttributionSource, underlying: Error)
}

public enum AttributionCatalog {
    /// Loads `Resources/Attributions/<source>.json` from the app bundle.
    /// Mirrors `TemplateRuntime`'s `bundle.resourceURL` resolution, including
    /// its Settings-based override for development builds.
    public static func load(_ source: AttributionSource, bundle: Bundle = .main) throws -> [OSSAttribution]
}
```

Each source's JSON file is a flat `[OSSAttribution]` array, sorted by package name (generation script's responsibility — keeps diffs small and the UI list pre-sorted).

## Generation pipeline

Two scripts, because the two ecosystems need different tooling:

### `scripts/generate-swift-attributions.mjs`

- Parses `Package.resolved` for each pin's identity, resolved version, and repository URL.
- For each pin, looks for a license file (`LICENSE`, `LICENSE.md`, `LICENSE.txt`, `COPYING`) under `.build/checkouts/<name>/` — populated by `swift package resolve` / `swift build`, both of which CI already runs before this script would need to.
- Writes `Resources/Attributions/app-binary.json`.

### `scripts/generate-npm-attributions.mjs <node_modules-root> <output.json>`

- Walks a resolved `node_modules` tree (must be run after `npm ci` in that root).
- For each package, reads `package.json`'s `license`/`repository`/`homepage` fields and its `LICENSE*` file text.
- Deduplicates by name+version (a tree can contain multiple versions of the same package via nested `node_modules`).
- Run twice by the wrapper script below:
  - against `Resources/Template/node_modules` → `Resources/Attributions/website-template.json`
  - against `$ANGLESITE_SIDECAR_SRC/server/node_modules` → `Resources/Attributions/container-image.json`

### Overrides and failure mode

`scripts/attributions-overrides.json` is a checked-in, hand-maintained map keyed by `name@version` supplying `licenseText`/`licenseSPDXId`/`homepage` for the rare package that doesn't ship a discoverable license file (e.g. license text only in a README, or a package renamed/forked without carrying its LICENSE file forward).

If a package has **neither** an auto-detected license **nor** an override entry, generation **fails** (non-zero exit, package name printed) rather than emitting an entry with an empty or placeholder license. This is a legal-disclosure list; a silent gap is worse than a loud one. Fixing a failure means either the package genuinely lacks a discoverable license (add an override once a human confirms the correct text) or the extraction heuristic missed a real file (fix the script).

### Wrapper script and CI drift check

`scripts/generate-attributions.sh`:
- Runs the Swift generator (always).
- Runs the npm generator against `Resources/Template` (always — `npm ci` there is already a normal dev/test step).
- Runs the npm generator against the sidecar's `server/node_modules` only when `$ANGLESITE_SIDECAR_SRC` is set and populated (same convention as `scripts/vendor-container-image.sh`); otherwise prints a warning and skips, consistent with how other sidecar-dependent tooling degrades in its absence.
- Supports `--check`: generates into a temp directory and diffs each output against the committed `Resources/Attributions/*.json`, printing the diff and exiting non-zero on any mismatch. This is the same drift-audit shape already used for `anglesite.json` (#1190).

CI wiring:
- `scripts/generate-attributions.sh --check` runs on every PR for the app-binary and website-template buckets (no extra checkout needed beyond what CI already does).
- The container-image bucket's check runs in CI's existing sidecar e2e job, which already checks out `Anglesite/anglesite-skills` at a pinned release (`.github/workflows/ci.yml:239`) — so that bucket is verified on the same cadence as other sidecar-dependent checks, not on every app-only PR.

## UI

### Menu placement

The existing native About panel (`showAboutPanel()` in `AnglesiteApp.swift`) is untouched. A new item is added as a sibling in the App menu, immediately after About:

```swift
CommandGroup(after: .appInfo) {
    Button("Open Source Acknowledgments…") { openWindow(id: "acknowledgments") }
}
```

This keeps the well-understood native About panel exactly as it is (app icon, version, build-phase credits) and adds acknowledgments as an adjacent, separately-focusable window — the same shape Xcode uses for "Third Party Acknowledgments" (its Help menu), just placed in the App menu here since it's app-identity-adjacent, matching About.

### Acknowledgments window

New file `Sources/AnglesiteApp/AcknowledgmentsView.swift` (excluded from `AnglesiteApp.swift`'s app-target-only exclusion list, so it's compiled into `AnglesiteAppCore` and covered by `swift test`). Registered as:

```swift
Window("Acknowledgments", id: "acknowledgments") {
    AcknowledgmentsView()
}
.windowResizability(.contentSize)
```

Layout: two-pane `NavigationSplitView`.

- **Left pane** — a `List` with three sections, one per `AttributionSource`, each listing that source's packages as `name — version` rows, sorted alphabetically (already sorted in the generated JSON). A `.searchable` modifier filters rows by name across all three sections at once.
- **Right pane** — detail for the selected package: name, version, an SPDX badge (or "Custom License" when `licenseSPDXId` is nil), a homepage link (`Button` that opens the URL via `NSWorkspace.shared.open`, matching the existing feedback-link pattern in `AnglesiteApp.swift`), and the full license text in a scrollable, selectable, monospaced `Text` view. No selection yet: "Select a package to view its license."

Data loads lazily in `.task` when the window first appears (not at app launch, to avoid adding three JSON decodes to startup). A decode failure for any one source logs to `LogCenter` (per "logs are sacred") and that source's section shows "Acknowledgments unavailable for this source" instead of crashing or losing the other two sources.

Accessibility: list rows carry a combined accessibility label ("STTextView, version 2.3.10, MIT License"); the detail pane's license text is real selectable/VoiceOver-readable text, never rendered as an image; the window supports standard keyboard navigation (arrow keys through the list, Tab to the search field) as any native macOS list view does by default.

### View model

Grouping and search-filtering logic lives in a plain, non-`View` type:

```swift
@Observable
final class AcknowledgmentsViewModel {
    private(set) var catalogs: [AttributionSource: [OSSAttribution]] = [:]
    var searchText: String = ""
    var selection: OSSAttribution?

    func load() async  // calls AttributionCatalog.load for each source, populates `catalogs`, logs failures
    func filtered(_ source: AttributionSource) -> [OSSAttribution]  // applies searchText
}
```

This keeps the actual `View` body thin and makes the filter/grouping behavior unit-testable without instantiating SwiftUI.

## Generated site notice

`SiteScaffolder.runPipeline` (`Sources/AnglesiteCore/SiteScaffolder.swift`) gets a new step alongside step 2b ("git init in `Source/`"): before the first commit, it loads `AttributionCatalog.load(.websiteTemplate)` and renders it to `Source/THIRD-PARTY-NOTICES.md` — package name, version, license identifier, and full license text, one section per package, plain Markdown. This runs before git init's first commit so the notice file is part of the site's initial commit and travels with the site's `Source/` repo like any other scaffolded file (per "Git is the source of truth for sites").

This file is generated once at scaffold time, not kept in sync afterward — a site's template dependencies can drift from the app's bundled `website-template.json` over time (via `DependencySyncApplier`), and reconciling the notice file on every dependency sync is a separate concern this spec doesn't take on. A future spec can address keeping it current if that turns out to matter in practice.

## Testing

- **`AnglesiteCoreTests/AttributionCatalogTests`**: decodes a small fixture `[OSSAttribution]` JSON and asserts round-trip correctness; separately, a test loads all three *real* checked-in `Resources/Attributions/*.json` files and asserts each decodes without error and is non-empty — a regression guard against a hand-edited or stale committed file, independent of the generation script's own tests.
- **`AnglesiteAppTests/AcknowledgmentsViewModelTests`**: search filtering (case-insensitive substring match on name) and per-source grouping, using fixture catalogs injected directly (no bundle/file I/O).
- **`SiteScaffolderTests`**: scaffolding a new site produces a `Source/THIRD-PARTY-NOTICES.md` containing at least one known template package name.
- **Script tests** (`scripts/generate-attributions.test.ts`, run via `npx tsx --test` per the existing template-lib test convention): the npm `node_modules` parser against a small fixture tree (including a package with no LICENSE file, to verify the loud-failure path and the overrides-merge path), and the `--check` diff logic against a deliberately stale fixture manifest.

## Open questions for implementation

None — the design above resolves the scope, storage format, generation approach, UI placement, and testing strategy discussed during brainstorming. Implementation-time discoveries (e.g. a package whose license can't be auto-extracted) are expected to be handled via the overrides file mechanism already specified, not a design change.
