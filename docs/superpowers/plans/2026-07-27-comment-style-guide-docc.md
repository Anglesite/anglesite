# Comment Style Guide + DocC Catalog + CI Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Anglesite-app a written comment style guide, a working DocC catalog, and a CI check that fails the build on broken doc comments — so `swift package generate-documentation` (and, locally, `xcodebuild docbuild`) produce a real, browsable Xcode docset.

**Architecture:** Add `swift-docc-plugin` as a build-time-only SwiftPM dependency (pinned to an exact commit, matching this repo's existing dependency-pinning convention). Add one umbrella `.docc` landing-page catalog inside `Sources/AnglesiteApp/Anglesite.docc/`, auto-adopted by the existing `AnglesiteAppCore` SwiftPM target. Fix a finite, already-existing list of broken doc comments (found by actually running the tool against this repo, not guessed) so the new check can be strict from day one. Add a new `docs-docc` CI job that runs `swift package generate-documentation --warnings-as-errors` against an explicit list of our own SwiftPM library targets (never the whole dependency graph — vendored third-party packages have their own doc-comment issues we don't own) and fails the build on any DocC warning or error. Write `docs/comment-style-guide.md` describing the doc-comment conventions this enforces, linked from `CONTRIBUTING.md`.

**Important process note:** every fact below (CLI flags, exit codes, which files are broken and why, the exact correct fix for each) was confirmed by actually running `swift package generate-documentation` against this real repository in a throwaway local edit, not inferred from documentation or static reading. Do not "simplify" any step below based on how DocC *should* behave — several of these findings (cross-module links failing without `--enable-experimental-combined-documentation`, `--target`-less runs sweeping in dependencies, parameter-validation being a warning by default but promoted to an error by `--warnings-as-errors`) contradicted the first-pass assumption and were only caught by running the real command.

**Tech Stack:** Swift 6.4 / SwiftPM, Apple's `swift-docc-plugin`, GitHub Actions.

## Global Constraints

- Pin `swift-docc-plugin` to an exact `revision:`, not a `from:` semver range — this repo's established policy (see `SwiftGit2`/`STTextView` entries in `Package.swift`) after a floating version once shipped an unreviewed breaking API change (#774/#781/#783).
- Do not retrofit existing doc comments across the ~500 already-documented files. The stricter `- Parameter:`/`- Returns:`/`- Throws:` tagging rule applies to new/changed public API going forward only. (Task 4 fixes a finite, already-broken list of ~15 files found by testing — that's bug-fixing, not the retrofit this line declines.)
- Do not add a documentation-coverage CI gate. Only DocC build errors/warnings fail the new job.
- `AnglesiteContainer`/`AnglesiteContainerProbe` are excluded from the new CI job the same way they're excluded from every other Swift CI lane (the workflow-level `ANGLESITE_SKIP_CONTAINER=1` env var already drops them from the SwiftPM manifest entirely — no extra logic needed in the new job). `AnglesiteLANHost` is also excluded — its symbol-graph extraction fails with an unrelated tooling issue (confirmed: `.build/.../AnglesiteLANHost.symbolgraphs doesn't exist`), not a doc-comment problem.
- No per-module `.docc` catalogs. One umbrella catalog only.
- The CI job must pass an explicit `--target` list of our own targets. Never run `generate-documentation` with no `--target` filter — confirmed it sweeps in every dependency package too (it tried to document the vendored `MarkdownEngine` package and hit that package's own broken doc comments, which we don't own and can't fix here).
- Every step below was verified directly against a real Swift 6.4 toolchain — either in a scratch package or (for Task 4's fixes and the CI command itself) against this actual repository in a throwaway local edit that was reverted before writing this plan down. The exact CLI flags, exit codes, file-naming conventions, and the list of already-broken files are confirmed, not guessed.

---

### Task 1: Add `swift-docc-plugin` dependency

**Files:**
- Modify: `Package.swift` (add one `.package(...)` entry to `packageDependencies`)

**Interfaces:**
- Produces: `swift package generate-documentation` becomes available as a plugin command for every target in the package. No new Swift symbols.

- [ ] **Step 1: Add the dependency**

Open `Package.swift` and find this block (currently around line 305-314):

```swift
var packageDependencies: [Package.Dependency] = []

#if canImport(Darwin)
// Anglesite's patched fork of mbernson/SwiftGit2 — see #640 and Spikes/GitPackageSpike. Pinned
// to a commit rather than a tag or branch: SwiftGit2 upstream has no tagged SPM release yet, and
// pinning to anglesite/main's tip would silently pick up unreviewed future commits. Bump
// deliberately.
packageDependencies.append(
    .package(url: "https://github.com/Anglesite/SwiftGit2.git", revision: "446d4777ae4413c2faaa88425693ff29981e4b07")
)
```

Add a new entry immediately before that `#if canImport(Darwin)` block (this dependency is a
build-time plugin only, needed on every platform that runs `swift package generate-documentation`,
so it does not need Darwin-gating):

```swift
var packageDependencies: [Package.Dependency] = []

// Apple's official DocC generation plugin (#1041) — build-time only, never linked into the
// shipped app. Pinned to tag 1.5.0's commit, matching the revision-pin policy below (SwiftGit2 /
// STTextView): a floating `from:` requirement previously shipped an unreviewed breaking change
// (#774/#781/#783), so every dependency here is bumped deliberately.
packageDependencies.append(
    .package(url: "https://github.com/swiftlang/swift-docc-plugin.git", revision: "647c708be89f834fa6a6d4945442793a77ddf5b6")
)

#if canImport(Darwin)
// Anglesite's patched fork of mbernson/SwiftGit2 — see #640 and Spikes/GitPackageSpike. Pinned
// to a commit rather than a tag or branch: SwiftGit2 upstream has no tagged SPM release yet, and
// pinning to anglesite/main's tip would silently pick up unreviewed future commits. Bump
// deliberately.
packageDependencies.append(
    .package(url: "https://github.com/Anglesite/SwiftGit2.git", revision: "446d4777ae4413c2faaa88425693ff29981e4b07")
)
```

- [ ] **Step 2: Verify it resolves and builds**

Run: `swift build -c debug`
Expected: Build succeeds; output includes `Fetching https://github.com/swiftlang/swift-docc-plugin.git` and `Working copy of https://github.com/swiftlang/swift-docc-plugin.git resolved at 647c708be89f834fa6a6d4945442793a77ddf5b6` (or a cached-resolution equivalent on a second run), ending in `Build complete!`.

- [ ] **Step 3: Verify the plugin command is available**

Run: `swift package generate-documentation --help`
Expected: Help text prints, including `--target <target>`, `--warnings-as-errors`, and `PLUGIN OPTIONS:`. No error about an unrecognized subcommand.

- [ ] **Step 4: Commit**

```bash
git add Package.swift
git commit -m "build(#1041): add swift-docc-plugin dependency"
```

---

### Task 2: Add the umbrella `.docc` catalog

**Files:**
- Create: `Sources/AnglesiteApp/Anglesite.docc/AnglesiteAppCore.md`

**Interfaces:**
- Consumes: nothing new — this is content-only, auto-discovered by the existing `AnglesiteAppCore` SwiftPM target (`Package.swift`'s `AnglesiteAppCore` target already declares `path: "Sources/AnglesiteApp"`; any `.docc` folder inside a target's source path is picked up by DocC automatically, no manifest change needed).
- Produces: a landing page for the `AnglesiteAppCore` module's generated documentation.

- [ ] **Step 1: Create the catalog directory and landing page**

**Important — verified constraint:** `AnglesiteAppCore` (all of `Sources/AnglesiteApp/*.swift`
except the two Xcode-only files) has essentially **zero `public`-access declarations** — confirmed
with `grep -rln "public " Sources/AnglesiteApp/*.swift` (excluding those two files) and manually
checking every hit: every match is the word "public" inside prose/comments (e.g. "public URL"),
never the `public` access modifier. This makes sense: it's app-shell code consumed only by the
`Anglesite` application target in the same package, never imported as a library elsewhere. Two
consequences for the landing page:

1. **Do not use double-backtick symbol links** (` ``AnglesiteCore`` `` etc.) to reference *other*
   modules from this landing page. Verified directly in a scratch package: a double-backtick link
   from one target's landing page to another target's module/type name fails to resolve
   (`error: 'Core' doesn't exist at '/AppCore'`) unless the docs are built with
   `--enable-experimental-combined-documentation` (an experimental flag, out of scope here). Use
   plain single backticks for other module/type names instead — they render as code text with no
   link attempt.
2. **No `## Topics` section** listing symbols — there are no real public symbols in this target to
   list, and a Topics entry pointing at a symbol that doesn't exist in the symbol graph fails the
   same way.

Create `Sources/AnglesiteApp/Anglesite.docc/AnglesiteAppCore.md` (the file must be named after the
module it documents — `AnglesiteAppCore`, not `Anglesite` — for DocC to recognize it as that
module's landing page; verified: a `Foo.docc/Foo.md` landing page was correctly picked up when
generating docs for a target literally named `Foo`, in a scratch package built for this plan):

```markdown
# ``AnglesiteAppCore``

The macOS app shell: SwiftUI views, view models, and window/scene coordination for Anglesite.

## Overview

Anglesite is a native macOS app for building and publishing static sites. This module holds
almost all of the app's actual logic — the two Xcode-only entry-point files
(`AnglesiteApp.swift`, `LiveSiteRuntimeFactory.swift`) live alongside it in
`Sources/AnglesiteApp/` but aren't part of this SwiftPM target, since they depend on the
Xcode-project-only `Anglesite` application target.

This module is intentionally free of public API of its own — every type here is `internal`,
consumed only by the app target in this same package. The real public API this app is built on
lives one layer down:

- `AnglesiteCore` — site model, process supervision, MCP client, and most business logic.
- `AnglesiteSiteModel` — the `.anglesite` package format (`Source/` + `Config/`) that every site
  is built from.
- `AnglesiteBridge` — the `WKWebView` preview bridge.
- `AnglesiteIntents` — Siri / Shortcuts / Spotlight integration via App Intents.

Generate documentation for any of those directly to browse their public API — for example
`swift package generate-documentation --target AnglesiteCore`.
```

- [ ] **Step 2: Verify the catalog is picked up**

Run: `swift package generate-documentation --target AnglesiteAppCore --warnings-as-errors`
Expected: Exit code `0`. Output includes `Building documentation for 'AnglesiteAppCore'...` and
`Generated documentation archive at: .../AnglesiteAppCore.doccarchive`. (A `warning: '<package>':
found 1 file(s) which are unhandled` line referencing the `Anglesite.docc` path is expected and
harmless — verified separately that this specific warning comes from the underlying `swift build`
resource scan, not from DocC itself, and does not affect `--warnings-as-errors`'s exit code.)

- [ ] **Step 3: Spot-check the generated landing page**

Run: `grep -l "native macOS app" .build/plugins/Swift-DocC/outputs/AnglesiteAppCore.doccarchive/data/documentation/anglesiteappcore.json`
Expected: Prints the file path (a match) — confirms the landing-page prose made it into the built
archive's JSON data, not just sitting unused on disk. (Default output location verified in a
scratch package: `swift package generate-documentation --target <X>` with no `--output-path`
writes to `.build/plugins/Swift-DocC/outputs/<X>.doccarchive`, and the module's JSON lands at
`data/documentation/<lowercased-module-name>.json` inside it.)

- [ ] **Step 4: Commit**

```bash
git add Sources/AnglesiteApp/Anglesite.docc/
git commit -m "docs(#1041): add Anglesite.docc umbrella landing page"
```

---

### Task 3: Write `docs/comment-style-guide.md`

**Files:**
- Create: `docs/comment-style-guide.md`
- Modify: `CONTRIBUTING.md:67-75` (the "Code guidelines" section)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks — this is the human-facing document.

- [ ] **Step 1: Write the guide**

Create `docs/comment-style-guide.md`:

```markdown
# Comment style guide

This repo generates an Xcode docset from `///` doc comments via DocC (see "Building docs
locally" below). This guide describes how to write comments so that both the generated docset
and the raw source stay useful to the next person (or agent) reading them.

## Philosophy

Comments explain **why**, not **what**. A well-named type or function already says what it does;
repeating that in a comment is noise. Explain the constraint, the rationale, the workaround, or
the non-obvious consequence instead. Most of this codebase already does this well — doc comments
here tend to read like short design notes, often citing the issue that motivated them
(`Sources/AnglesiteCore/NewSiteDraft.swift:90`, for example, explains *why* a field is optional,
not just that it is).

## Doc comments (`///`)

Every `public`/`open` declaration gets a `///` doc comment: a lead sentence stating what the
symbol is or does, followed by prose covering rationale, constraints, or edge cases where they
exist.

**Formal `- Parameter:`/`- Returns:`/`- Throws:` tags are required on new or changed public API**
going forward. They're not required retroactively — most of this codebase's ~500 already-
documented files predate this rule and won't be mass-edited to add them. If you're touching one
of those files for an unrelated reason, bringing its doc comments up to this standard is welcome
opportunistic cleanup, not required.

Example (`Sources/AnglesiteCore/WorkerComposition.swift:109-124`):

```swift
/// Generates a wrangler.toml for a site with the given workers enabled.
///
/// - Parameters:
///   - siteName: The Worker name (used as the Cloudflare Workers project name).
///     Must match `[A-Za-z0-9_-]+`.
///   - workers: The effective active `@dwk/workers` catalog descriptors. Empty = static-only
///     deploy.
///   - routeClaims: The effective active dynamic-route claims (#746), already validated by
///     `WorkerRouteClaims.activeClaims`. Emitted as selective `[assets].run_worker_first`
///     patterns so *only* claimed routes bypass asset-first serving — a static asset can no
///     longer shadow an active dynamic route, while every unclaimed path keeps Cloudflare's
///     asset-first fallback. Omitted entirely when there are no active dynamic routes.
/// - Returns: A complete wrangler.toml string.
/// - Throws: ``ConfigError/invalidSiteName(_:)`` if `siteName` contains
///   characters outside `[A-Za-z0-9_-]`, or ``ConfigError/invalidRouteClaim(path:reason:)``
///   for a claim that never passed `WorkerRouteClaims` validation.
public static func generateWranglerToml(...) -> String
```

Skip the tags when a function has zero or one self-explanatory parameter, no meaningful return
value, and doesn't throw — a bare lead-sentence doc comment is enough there. Use judgment: the
tags exist to add clarity a signature doesn't already give you, not to pad every declaration.

## DocC-specific syntax

- **Symbol links:** double backticks (` ``TypeName`` `` or ` ``TypeName/member(_:)`` ``) create a
  resolved, clickable link in the generated docset. Single backticks (`` `TypeName` ``) render as
  plain code with no link — use those for code that isn't a real symbol in this package (a
  parameter's literal value, a shell command, etc).
- **Callouts:** `- Important:`, `- Note:`, and `- Warning:` render as highlighted callout boxes in
  the docset. Use them sparingly, for things a reader could otherwise miss (a genuinely
  surprising constraint, not routine information already covered in prose).
- **`// MARK: -` vs `// MARK:`:** a `// MARK: -` (with the trailing dash) becomes a Topic section
  divider in the generated docset, in addition to its usual Xcode jump-bar behavior. A plain
  `// MARK:` (no dash) is jump-bar-only — invisible to DocC. Use the dash form when a MARK groups
  related public API that should also read as a group in the docset; use the plain form for
  private/internal organization that shouldn't show up there at all.
- **`.docc` landing pages:** a catalog's landing page is a Markdown file named after the module it
  documents (`AnglesiteAppCore.md` inside a catalog documents the `AnglesiteAppCore` module),
  starting with `# \`\`ModuleName\`\`` and an optional `## Topics` section listing `<doc:>` or
  double-backtick links to group related symbols. See
  `Sources/AnglesiteApp/Anglesite.docc/AnglesiteAppCore.md` for a real example.

## Inline comments (`//`)

Line-level only, and only when the *why* isn't obvious from the code itself: a hidden constraint,
a workaround for a specific bug (link the issue), a non-obvious invariant. If removing the
comment wouldn't leave a future reader confused, don't write it. Don't describe what the next
line does — the code already does that better than a comment can.

## Building docs locally

Two ways to generate documentation, depending on what you need:

- **Fast, single-module iteration**:
  ```sh
  swift package generate-documentation --target AnglesiteCore --warnings-as-errors
  ```
  Add `--warnings-as-errors` to match CI's strictness while iterating locally. **Don't drop
  `--target`** — with no target filter, the plugin documents every target in the whole dependency
  graph, including vendored third-party packages whose doc comments you don't control and can't
  fix. CI passes an explicit list of this repo's own targets; copy that list from
  `.github/workflows/ci.yml`'s `docs-docc` job (or `AGENTS.md`/`CONTRIBUTING.md`) to generate docs
  for everything at once.

- **The full merged docset** — app entry point, every module, and the container runtime, as one
  browsable archive in Xcode's Developer Documentation window (Product ▸ Build Documentation, or
  ⌃⌘⇧D). **Local-only** — this needs `xcodebuild`, `xcodegen generate` to have already run, and a
  Mac that can build `AnglesiteContainer` (the hosted CI runner can't, which is why CI uses the
  `swift package` path above instead):
  ```sh
  xcodebuild docbuild -scheme Anglesite -destination 'platform=macOS'
  ```
```

- [ ] **Step 2: Link it from CONTRIBUTING.md**

In `CONTRIBUTING.md`, the "Code guidelines" section currently reads (lines 67-75):

```markdown
## Code guidelines

- **Swift/SwiftUI with Apple frameworks only** — plain SwiftUI + actors, no TCA or third-party state libraries. New dependencies need explicit approval in an issue first.
- **Process spawning is centralized** in `AnglesiteCore/ProcessSupervisor` — never call `Process()` from a view.
- **Logs are sacred** — every spawned subprocess streams stdout+stderr to the debug pane. Don't silently discard output.
- **Git is the source of truth for sites** — the app must never become the only way to edit a site. A site's `Source/` repo stays clonable and editable outside the app.
- **The app cannot bypass the template security gate** — `pre-deploy-check.ts` runs before every deploy; surface failures, don't add overrides.
- **JS/TypeScript** (edit overlay) uses ES modules, vanilla APIs, and the existing oxlint/tsc/vitest toolchain.
```

Add one line at the end of that list:

```markdown
- **Comment and doc-comment conventions** are in [`docs/comment-style-guide.md`](docs/comment-style-guide.md) — read it before writing `///` doc comments on public API; CI fails on broken DocC symbol links or markup.
```

- [ ] **Step 3: Verify the links resolve**

Run: `test -f docs/comment-style-guide.md && grep -q "comment-style-guide.md" CONTRIBUTING.md && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add docs/comment-style-guide.md CONTRIBUTING.md
git commit -m "docs(#1041): add comment style guide, link from CONTRIBUTING.md"
```

---

### Task 4: Fix pre-existing DocC diagnostics (a finite, already-broken list)

**Files:**
- Modify: `Sources/AnglesiteCore/ApplyEditTool.swift:9`
- Modify: `Sources/AnglesiteCore/SearchContentTool.swift:8`
- Modify: `Sources/AnglesiteCore/FoundationModelAssistant.swift:70,145,299,374`
- Modify: `Sources/AnglesiteCore/LinkGraph.swift:4`
- Modify: `Sources/AnglesiteCore/ContentUndoCoordinator.swift:42,86`
- Modify: `Sources/AnglesiteCore/SyncEngine.swift:206`
- Modify: `Sources/AnglesiteCore/SiteGraphAugmentedAssistant.swift:15,16`
- Modify: `Sources/AnglesiteCore/SuggestLinksTool.swift:10`
- Modify: `Sources/AnglesiteBridge/AnglesiteScriptHandler.swift:7,14,50`
- Modify: `Sources/AnglesiteBridge/WebViewBridge.swift:13,49`
- Modify: `Sources/AnglesiteCore/ACPAgentStore.swift:11-14`
- Modify: `Sources/AnglesiteCore/ExperimentStats.swift:67-74`
- Modify: `Sources/AnglesiteCore/InboxSubmissionCommitter.swift:76-88`
- Modify: `Sources/AnglesiteCore/SiteContentGraph.swift:192-207`
- Modify: `Sources/AnglesiteCore/SiteSearchDestination.swift:17-25`
- Modify: `Sources/AnglesiteCore/SiteSearchIndex.swift:83-92`
- Modify: `Sources/AnglesiteCore/WorkerComposition.swift:109-139`

**Why these and only these:** every one of these was found by actually running
`swift package generate-documentation` (with `--target` scoped to just this repo's own targets,
excluding vendored dependencies) against this real repository — not by grepping for a pattern.
There are two categories:

**Category A — broken double-backtick links.** A `` ``Symbol`` `` link is a real attempt to
resolve a cross-reference; DocC hard-fails (unconditionally, with no flag needed to trigger it)
when the target isn't in the local symbol graph. That happens for four different reasons here,
each with a different correct fix:

1. **Apple SDK framework symbols** (`Tool`, `Generable`, `LanguageModelSession`) — not part of
   this package's own symbol graph, can't resolve without extra SDK symbol-graph setup that's out
   of scope here. Fix: single backtick (plain code, no link attempt).
2. **`private`/`internal` symbols** (`perform(_:)`, `reconcileDivergence(...)`, `maxSeedNodes`,
   `facts(...)`) — DocC's symbol graph only includes `public`+ access levels by default; a link to
   a non-public symbol can never resolve. Fix: single backtick. (Not: raise their access level —
   that's a real API-surface change with its own review, out of scope for a doc-comment fix.)
3. **Cross-module links** (`AnglesiteMessageDispatcher`, `AnglesiteOverlayBundle`, both defined in
   `AnglesiteBridgeCore` but referenced from doc comments in the *different* `AnglesiteBridge`
   target) — verified separately that a double-backtick link across target boundaries doesn't
   resolve without `--enable-experimental-combined-documentation` (an experimental flag, out of
   scope). Fix: single backtick.
4. **Wrong DocC path syntax** (`Document.internalLinks`, `SemanticRanker.related` — using Swift's
   dot-member-access notation instead of DocC's own `/`-separated link path) — these *are* real,
   public, same-module symbols; the link syntax itself is just wrong. Fix: correct the syntax to
   the real slash-separated path so the link actually resolves, rather than downgrading to plain
   text.

**Category B — stale `- Parameters:` blocks.** `--enable-parameters-and-returns-validation` (on by
default) flags any function whose doc comment's `- Parameter(s):` list doesn't cover every
parameter in the real signature — these seven functions grew parameters after their doc comment
was last touched. Fix: add the missing entries.

- [ ] **Step 1: Fix `ApplyEditTool.swift` and `SearchContentTool.swift` (Apple SDK symbol links)**

In `Sources/AnglesiteCore/ApplyEditTool.swift`, change:

```swift
/// A FoundationModels ``Tool`` that lets the on-device model apply a structured edit to an element
```
to:
```swift
/// A FoundationModels `Tool` that lets the on-device model apply a structured edit to an element
```

In `Sources/AnglesiteCore/SearchContentTool.swift`, change:

```swift
/// A FoundationModels ``Tool`` that lets the on-device model search the current site's pages and
```
to:
```swift
/// A FoundationModels `Tool` that lets the on-device model search the current site's pages and
```

- [ ] **Step 2: Fix `FoundationModelAssistant.swift` (Apple SDK symbols + ambiguous sibling refs)**

Four separate one-line changes in this file:

Line 70, change:
```swift
/// and produces ``Generable`` structured output via guided generation.
```
to:
```swift
/// and produces `Generable` structured output via guided generation.
```

Line 145 (inside the `init`'s doc comment — `` ``generate``/``generateStructured`` `` fail to
resolve as bare unqualified names from that scope, even though both are real public sibling
methods; `generateStructured` is additionally overloaded), change:
```swift
    /// one-shot ``generate``/``generateStructured`` paths carry no Spotlight tool, preserving their
```
to:
```swift
    /// one-shot `generate`/`generateStructured` paths carry no Spotlight tool, preserving their
```

Line 299, change:
```swift
    /// Unlike ``generate(prompt:context:)``, this reuses a **cached** ``LanguageModelSession`` across
```
to:
```swift
    /// Unlike ``generate(prompt:context:)``, this reuses a **cached** `LanguageModelSession` across
```
(Only `LanguageModelSession` changes here — `` ``generate(prompt:context:)`` `` already resolves
correctly since it's a fully-qualified reference to a real sibling method with no ambiguity.)

Line 374, change:
```swift
    /// Discards the cached ``LanguageModelSession`` (and winds down any in-flight turn) so the next
```
to:
```swift
    /// Discards the cached `LanguageModelSession` (and winds down any in-flight turn) so the next
```

- [ ] **Step 3: Fix `LinkGraph.swift` (wrong DocC path syntax — real fix, not a downgrade)**

`Document` is `SiteKnowledgeIndex.Document` (confirmed: `Sources/AnglesiteCore/SiteKnowledgeIndex.swift:9`), and `internalLinks` is a public property on it. The doc comment used Swift's
dot-member syntax instead of DocC's slash-path syntax. In `Sources/AnglesiteCore/LinkGraph.swift`,
change:

```swift
/// Pure link-graph analysis over ``SiteKnowledgeIndex`` documents. No embeddings, no actors —
/// reads ``Document.internalLinks`` to surface structural linking issues.
```
to:
```swift
/// Pure link-graph analysis over ``SiteKnowledgeIndex`` documents. No embeddings, no actors —
/// reads ``SiteKnowledgeIndex/Document/internalLinks`` to surface structural linking issues.
```

- [ ] **Step 4: Fix `ContentUndoCoordinator.swift` (private-symbol links)**

`perform(_:)` (confirmed: `Sources/AnglesiteCore/ContentUndoCoordinator.swift:169`) is `private`,
so it can never be in the public symbol graph. Two occurrences in the same file:

Line 42, change:
```swift
///   re-apply primitive). See ``register(_:)`` for the ordering that makes it work with an
///   asynchronous applier.
```
to:
```swift
///   re-apply primitive). See ``register(_:)`` for the ordering that makes it work with an
///   asynchronous applier. (`perform(_:)` is the private popped-record apply path.)
```

Line 86, change:
```swift
///   ``EditUndoCoordinator`` uses for its retryable outcome. A failed *redo* can only be dropped;
///   see ``perform(_:)``.
```
to:
```swift
///   ``EditUndoCoordinator`` uses for its retryable outcome. A failed *redo* can only be dropped;
///   see `perform(_:)`.
```

- [ ] **Step 5: Fix `SyncEngine.swift` (private-symbol link)**

`reconcileDivergence(...)` (confirmed: `Sources/AnglesiteCore/SyncEngine.swift:309`) is `private`.
In `Sources/AnglesiteCore/SyncEngine.swift`, change:

```swift
    /// On genuine divergence, hands off to ``reconcileDivergence(repo:package:branchName:branchRefName:localOID:icloudOID:)``
```
to:
```swift
    /// On genuine divergence, hands off to `reconcileDivergence(repo:package:branchName:branchRefName:localOID:icloudOID:)`
```

- [ ] **Step 6: Fix `SiteGraphAugmentedAssistant.swift` (internal-symbol links)**

`SiteGraphExplainPrompt.facts(...)` (confirmed: `Sources/AnglesiteCore/SiteGraphNodeExplainer.swift:40`) and this file's own
`maxSeedNodes` (line 22) both have no access modifier, so they default to `internal` — outside the
public symbol graph. In `Sources/AnglesiteCore/SiteGraphAugmentedAssistant.swift`, change:

```swift
/// Reuses #614's per-node fact list (``SiteGraphExplainPrompt/facts(node:impact:dependsOn:referencedBy:)``)
/// for up to ``SiteGraphAugmentedAssistant/maxSeedNodes`` nodes matched against the question's
/// words. Contributes nothing when no node matches, so unrelated chat turns are unaffected.
```
to:
```swift
/// Reuses #614's per-node fact list (`SiteGraphExplainPrompt.facts(node:impact:dependsOn:referencedBy:)`)
/// for up to `SiteGraphAugmentedAssistant.maxSeedNodes` nodes matched against the question's
/// words. Contributes nothing when no node matches, so unrelated chat turns are unaffected.
```

- [ ] **Step 7: Fix `SuggestLinksTool.swift` (wrong DocC path syntax — real fix)**

`SemanticRanker.related` (confirmed: `Sources/AnglesiteCore/SemanticRanker.swift:103`, signature
`related(siteID:toDocID:limit:)`) is a real public method; the dot syntax is just wrong. In
`Sources/AnglesiteCore/SuggestLinksTool.swift`, change:

```swift
/// semantic similarity (``SemanticRanker.related``) filtered by existing links (``LinkGraph``).
```
to:
```swift
/// semantic similarity (``SemanticRanker/related(siteID:toDocID:limit:)``) filtered by existing links (``LinkGraph``).
```

- [ ] **Step 8: Fix `AnglesiteScriptHandler.swift` and `WebViewBridge.swift` (cross-module links)**

`AnglesiteMessageDispatcher` and `AnglesiteOverlayBundle` are both `public enum`s defined in the
`AnglesiteBridgeCore` target (confirmed:
`Sources/AnglesiteBridgeCore/AnglesiteMessageDispatcher.swift:23`,
`Sources/AnglesiteBridgeCore/AnglesiteOverlayBundle.swift:7`), but referenced from doc comments in
the *different* `AnglesiteBridge` target. In `Sources/AnglesiteBridge/AnglesiteScriptHandler.swift`,
change (lines 6-8 and 12-14 of the class-level doc comment):

```swift
/// `WKScriptMessageHandler` adapter for the `anglesite` namespace — the WKWebView-specific thin
/// layer over ``AnglesiteMessageDispatcher`` (cross-platform port design §6 "AnglesiteBridgeCore
/// split"). All the message schema, decoding, and routing logic lives in the portable core; this
/// class's own job is exactly two things `WKScriptMessage` requires: unwrap `message.body`/
/// `.webView`, and evaluate the reply script back into the page.
///
/// **API change vs prior versions:** the primary entry point is now
/// `dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)` (forwarding to
/// ``AnglesiteMessageDispatcher/dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)``).
```
to:
```swift
/// `WKScriptMessageHandler` adapter for the `anglesite` namespace — the WKWebView-specific thin
/// layer over `AnglesiteMessageDispatcher` (cross-platform port design §6 "AnglesiteBridgeCore
/// split"). All the message schema, decoding, and routing logic lives in the portable core; this
/// class's own job is exactly two things `WKScriptMessage` requires: unwrap `message.body`/
/// `.webView`, and evaluate the reply script back into the page.
///
/// **API change vs prior versions:** the primary entry point is now
/// `dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)` (forwarding to
/// `AnglesiteMessageDispatcher.dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)`).
```

And at line 50 (the `dispatch` static method's own doc comment), change:
```swift
    /// Forwards to ``AnglesiteMessageDispatcher/dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)``
    /// — kept here so existing call sites (this class's own `userContentController`, and any
```
to:
```swift
    /// Forwards to `AnglesiteMessageDispatcher.dispatch(body:via:onVisibleElements:onCanvasSelection:onComputedStyles:)`
    /// — kept here so existing call sites (this class's own `userContentController`, and any
```

In `Sources/AnglesiteBridge/WebViewBridge.swift`, line 13, change:
```swift
    /// ``AnglesiteMessageDispatcher/scriptMessageNamespace``.
```
to:
```swift
    /// `AnglesiteMessageDispatcher.scriptMessageNamespace`.
```

Line 49, change:
```swift
    /// via ``AnglesiteOverlayBundle``; only the `WKUserScript` wrapping is WKWebView-specific.
```
to:
```swift
    /// via `AnglesiteOverlayBundle`; only the `WKUserScript` wrapping is WKWebView-specific.
```

- [ ] **Step 9: Fix `ACPAgentStore.swift` (stale Parameters block)**

`init(persistenceURL:fileManager:)` documents `persistenceURL` but not `fileManager`. In
`Sources/AnglesiteCore/ACPAgentStore.swift`, change:

```swift
    /// - Parameters:
    ///   - persistenceURL: where to read/write `acp-agents.json`. Defaults to
    ///     `~/Library/Application Support/Anglesite/acp-agents.json`. Tests should pass a temp URL.
    public init(persistenceURL: URL? = nil, fileManager: FileManager = .default) {
```
to:
```swift
    /// - Parameters:
    ///   - persistenceURL: where to read/write `acp-agents.json`. Defaults to
    ///     `~/Library/Application Support/Anglesite/acp-agents.json`. Tests should pass a temp URL.
    ///   - fileManager: Injectable for tests; defaults to `.default`.
    public init(persistenceURL: URL? = nil, fileManager: FileManager = .default) {
```

- [ ] **Step 10: Fix `ExperimentStats.swift` (stale Parameter block)**

`analyze(control:treatment:confidenceThreshold:)` documents only `confidenceThreshold`. In
`Sources/AnglesiteCore/ExperimentStats.swift`, change:

```swift
    /// Compare `treatment` against `control` under a Beta-Binomial model with uniform priors.
    ///
    /// - Parameter confidenceThreshold: probability at which a side is declared the winner.
    public static func analyze(
```
to:
```swift
    /// Compare `treatment` against `control` under a Beta-Binomial model with uniform priors.
    ///
    /// - Parameters:
    ///   - control: The control variant's impression/conversion counts.
    ///   - treatment: The treatment variant's impression/conversion counts.
    ///   - confidenceThreshold: probability at which a side is declared the winner.
    public static func analyze(
```

- [ ] **Step 11: Fix `InboxSubmissionCommitter.swift` (stale Parameter block)**

`commit(submissions:into:fileManager:gitCommitBatch:)` documents only `fileManager`. In
`Sources/AnglesiteCore/InboxSubmissionCommitter.swift`, change:

```swift
    /// - Parameter fileManager: Used only to create the `src/content/inbox` directory; per-submission
    ///   file writes go through `Data.write(to:options:)` directly and do not go through this.
    public static func commit(
        submissions: [InboxKVClient.Submission],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = processGitCommitBatch
    ) async -> [String] {
```
to:
```swift
    /// - Parameters:
    ///   - submissions: The inbox submissions to write and commit.
    ///   - siteDirectory: The site's `Source/` directory the submissions are written under.
    ///   - fileManager: Used only to create the `src/content/inbox` directory; per-submission
    ///     file writes go through `Data.write(to:options:)` directly and do not go through this.
    ///   - gitCommitBatch: Injectable for tests; defaults to the real git commit implementation.
    public static func commit(
        submissions: [InboxKVClient.Submission],
        into siteDirectory: URL,
        fileManager: FileManager = .default,
        gitCommitBatch: @Sendable (URL, [String], String) async -> String? = processGitCommitBatch
    ) async -> [String] {
```

- [ ] **Step 12: Fix `SiteContentGraph.swift` (stale Parameter block)**

`load(siteID:pages:posts:images:generation:)` documents only `generation`. In
`Sources/AnglesiteCore/SiteContentGraph.swift`, change:

```swift
    /// - Parameter generation: A token from `beginScan(siteID:)`. When provided, this call is
    ///   silently discarded (no state change, no emit) if a newer scan has since claimed a
    ///   later generation for `siteID` — see `beginScan` (#666). `nil` (the default) skips the
    ///   guard entirely, applying unconditionally; used by incremental/test callers that don't
    ///   participate in the scan-race fence.
    public func load(
        siteID: String,
        pages: [Page],
        posts: [Post],
        images: [Image],
        generation: Int? = nil
    ) async {
```
to:
```swift
    /// - Parameters:
    ///   - siteID: The site whose entries are being replaced.
    ///   - pages: The site's full new page payload.
    ///   - posts: The site's full new post payload.
    ///   - images: The site's full new image payload.
    ///   - generation: A token from `beginScan(siteID:)`. When provided, this call is
    ///     silently discarded (no state change, no emit) if a newer scan has since claimed a
    ///     later generation for `siteID` — see `beginScan` (#666). `nil` (the default) skips the
    ///     guard entirely, applying unconditionally; used by incremental/test callers that don't
    ///     participate in the scan-race fence.
    public func load(
        siteID: String,
        pages: [Page],
        posts: [Post],
        images: [Image],
        generation: Int? = nil
    ) async {
```

- [ ] **Step 13: Fix `SiteSearchDestination.swift` (stale Parameter block)**

`resolve(kind:route:path:navigatorRouteIDs:)` documents only `navigatorRouteIDs`. In
`Sources/AnglesiteCore/SiteSearchDestination.swift`, change:

```swift
    /// - Parameter navigatorRouteIDs: route → navigator node id for the rows currently on
    ///   screen. Empty while a window's tree is still loading, which resolves everything to
    ///   `.file` — a usable destination rather than a dropped hit.
    public static func resolve(
        kind: SiteKnowledgeIndex.Document.Kind,
        route: String?,
        path: String,
        navigatorRouteIDs: [String: String]
    ) -> SiteSearchDestination {
```
to:
```swift
    /// - Parameters:
    ///   - kind: The matched document's kind, used to pick the destination's `FileGroup` when it
    ///     falls back to `.file`.
    ///   - route: The matched document's route, if it has one. `nil` always falls back to `.file`.
    ///   - path: The matched document's path relative to the site's `Source/`, used for `.file`.
    ///   - navigatorRouteIDs: route → navigator node id for the rows currently on
    ///     screen. Empty while a window's tree is still loading, which resolves everything to
    ///     `.file` — a usable destination rather than a dropped hit.
    public static func resolve(
        kind: SiteKnowledgeIndex.Document.Kind,
        route: String?,
        path: String,
        navigatorRouteIDs: [String: String]
    ) -> SiteSearchDestination {
```

- [ ] **Step 14: Fix `SiteSearchIndex.swift` (stale Parameter block)**

`search(_:siteID:query:limit:kinds:)` documents only `limit`. In
`Sources/AnglesiteCore/SiteSearchIndex.swift`, change:

```swift
    /// Searches the index for documents matching the query.
    /// - Parameter limit: Maximum number of results to return. Clamped to a minimum of 1 by
    ///   the underlying `SiteKnowledgeIndex.SearchOptions`, so `limit: 0` still returns one hit.
    public static func search(
        _ index: SiteKnowledgeIndex,
        siteID: String,
        query: String,
        limit: Int = 8,
        kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil
    ) async -> [Hit] {
```
to:
```swift
    /// Searches the index for documents matching the query.
    /// - Parameters:
    ///   - index: The site's knowledge index to search.
    ///   - siteID: The site whose documents are searched.
    ///   - query: The search text.
    ///   - limit: Maximum number of results to return. Clamped to a minimum of 1 by
    ///     the underlying `SiteKnowledgeIndex.SearchOptions`, so `limit: 0` still returns one hit.
    ///   - kinds: Restricts results to these document kinds, or all kinds when `nil`.
    public static func search(
        _ index: SiteKnowledgeIndex,
        siteID: String,
        query: String,
        limit: Int = 8,
        kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil
    ) async -> [Hit] {
```

- [ ] **Step 15: Fix `WorkerComposition.swift` (stale Parameters block + a misplaced doc comment)**

`generateWranglerToml(...)` documents `siteName`/`workers`/`routeClaims` but not `resources`,
`inboxCaptureEnabled`, `inboxKVNamespaceID`, `siteURL`, or `displayName`. `displayName` additionally
has a `///` comment sitting *inside* the parameter list (between `siteURL` and `displayName`),
which DocC never associates with the function's `- Parameters:` block since it isn't in the
leading doc comment — that's why `displayName` still shows up as undocumented despite looking
documented at a glance. In `Sources/AnglesiteCore/WorkerComposition.swift`, change:

```swift
    /// Generates a wrangler.toml for a site with the given workers enabled.
    ///
    /// - Parameters:
    ///   - siteName: The Worker name (used as the Cloudflare Workers project name).
    ///     Must match `[A-Za-z0-9_-]+`.
    ///   - workers: The effective active `@dwk/workers` catalog descriptors. Empty = static-only
    ///     deploy.
    ///   - routeClaims: The effective active dynamic-route claims (#746), already validated by
    ///     `WorkerRouteClaims.activeClaims`. Emitted as selective `[assets].run_worker_first`
    ///     patterns so *only* claimed routes bypass asset-first serving — a static asset can no
    ///     longer shadow an active dynamic route, while every unclaimed path keeps Cloudflare's
    ///     asset-first fallback. Omitted entirely when there are no active dynamic routes.
    /// - Returns: A complete wrangler.toml string.
    /// - Throws: ``ConfigError/invalidSiteName(_:)`` if `siteName` contains
    ///   characters outside `[A-Za-z0-9_-]`, or ``ConfigError/invalidRouteClaim(path:reason:)``
    ///   for a claim that never passed `WorkerRouteClaims` validation.
    public static func generateWranglerToml(
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim] = [],
        resources: ProvisionedResources = .init(),
        inboxCaptureEnabled: Bool = false,
        inboxKVNamespaceID: String? = nil,
        siteURL: String? = nil,
        /// The site's display name (`SiteSettings.displayName`, already falling back to the site
        /// name by the time a caller passes it in — this function stays pure and does no
        /// fallback of its own), threaded into the ActivityPub actor's `AP_DISPLAY_NAME` var.
        /// `nil` when unknown; the composed Worker's actor document then falls back to a fixed
        /// generic name (`worker.ts`'s concern, not this function's).
        displayName: String? = nil
    ) throws -> String {
```
to:
```swift
    /// Generates a wrangler.toml for a site with the given workers enabled.
    ///
    /// - Parameters:
    ///   - siteName: The Worker name (used as the Cloudflare Workers project name).
    ///     Must match `[A-Za-z0-9_-]+`.
    ///   - workers: The effective active `@dwk/workers` catalog descriptors. Empty = static-only
    ///     deploy.
    ///   - routeClaims: The effective active dynamic-route claims (#746), already validated by
    ///     `WorkerRouteClaims.activeClaims`. Emitted as selective `[assets].run_worker_first`
    ///     patterns so *only* claimed routes bypass asset-first serving — a static asset can no
    ///     longer shadow an active dynamic route, while every unclaimed path keeps Cloudflare's
    ///     asset-first fallback. Omitted entirely when there are no active dynamic routes.
    ///   - resources: The site's provisioned Cloudflare resource IDs (D1/KV/R2/queues).
    ///   - inboxCaptureEnabled: Whether the inbox-capture route claim is appended to `routeClaims`.
    ///   - inboxKVNamespaceID: The inbox KV namespace ID, required when `inboxCaptureEnabled`.
    ///   - siteURL: The site's public URL, threaded into the composed Worker's config.
    ///   - displayName: The site's display name (`SiteSettings.displayName`, already falling back
    ///     to the site name by the time a caller passes it in — this function stays pure and does
    ///     no fallback of its own), threaded into the ActivityPub actor's `AP_DISPLAY_NAME` var.
    ///     `nil` when unknown; the composed Worker's actor document then falls back to a fixed
    ///     generic name (`worker.ts`'s concern, not this function's).
    /// - Returns: A complete wrangler.toml string.
    /// - Throws: ``ConfigError/invalidSiteName(_:)`` if `siteName` contains
    ///   characters outside `[A-Za-z0-9_-]`, or ``ConfigError/invalidRouteClaim(path:reason:)``
    ///   for a claim that never passed `WorkerRouteClaims` validation.
    public static func generateWranglerToml(
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim] = [],
        resources: ProvisionedResources = .init(),
        inboxCaptureEnabled: Bool = false,
        inboxKVNamespaceID: String? = nil,
        siteURL: String? = nil,
        displayName: String? = nil
    ) throws -> String {
```

- [ ] **Step 16: Verify everything is now clean**

Run (Task 1's `swift-docc-plugin` dependency must already be committed for this to work):

```sh
swift package generate-documentation \
  --target AnglesiteSiteModel --target AnglesiteQuickLookSupport --target AnglesiteCore \
  --target AnglesiteBridgeCore --target AnglesiteBridge --target AnglesiteIOS \
  --target AnglesiteIntents --target AnglesiteAppCore --target AnglesiteTestSupport \
  --warnings-as-errors
```

Expected: exit code `0`, ending with `Generated 9 documentation archives:`. If anything still
fails, read the new diagnostic's file:line and fix it the same way (single backtick for
unresolvable links, added `- Parameter:` entries for stale docs) before moving on — don't relax
`--warnings-as-errors` to make a stubborn one pass.

- [ ] **Step 17: Commit**

```bash
git add Sources/AnglesiteCore/ApplyEditTool.swift Sources/AnglesiteCore/SearchContentTool.swift \
  Sources/AnglesiteCore/FoundationModelAssistant.swift Sources/AnglesiteCore/LinkGraph.swift \
  Sources/AnglesiteCore/ContentUndoCoordinator.swift Sources/AnglesiteCore/SyncEngine.swift \
  Sources/AnglesiteCore/SiteGraphAugmentedAssistant.swift Sources/AnglesiteCore/SuggestLinksTool.swift \
  Sources/AnglesiteBridge/AnglesiteScriptHandler.swift Sources/AnglesiteBridge/WebViewBridge.swift \
  Sources/AnglesiteCore/ACPAgentStore.swift Sources/AnglesiteCore/ExperimentStats.swift \
  Sources/AnglesiteCore/InboxSubmissionCommitter.swift Sources/AnglesiteCore/SiteContentGraph.swift \
  Sources/AnglesiteCore/SiteSearchDestination.swift Sources/AnglesiteCore/SiteSearchIndex.swift \
  Sources/AnglesiteCore/WorkerComposition.swift
git commit -m "docs(#1041): fix broken DocC links and stale Parameter docs"
```

---

### Task 5: Add the `docs-docc` CI job

**Files:**
- Modify: `.github/workflows/ci.yml` (add a new job after `concurrency-tsan`, before `xcodeproj-sync`; add it to the final `ci` job's `needs:` list)

**Interfaces:**
- Consumes: nothing from earlier tasks except that `Package.swift` (Task 1), the catalog (Task 2),
  and the fixes (Task 4) must already be committed for this job to pass.
- Produces: a new required-check job name `docs-docc` that later branch-protection config (out of
  scope here) could reference.

- [ ] **Step 1: Add the job**

In `.github/workflows/ci.yml`, insert this new job immediately after the `concurrency-tsan` job
(which ends around line 347, right before the `xcodeproj-sync:` job header):

```yaml
  docs-docc:
    name: DocC build (comment/doc-comment health check)
    # No xcodegen/xcodebuild here — this job never touches the Xcode project. It exercises the
    # SwiftPM library targets directly via `swift package generate-documentation`. The --target
    # list below is deliberate and explicit, not "every target" — verified two things: (1) a
    # target-less run sweeps in every dependency package too, including MarkdownEngine's own
    # broken doc comments, which we don't own; (2) AnglesiteLANHost (an executableTarget) fails
    # symbol-graph extraction with an unrelated tooling issue ("AnglesiteLANHost.symbolgraphs
    # doesn't exist"), so it's left out here. AnglesiteContainer/AnglesiteContainerProbe are
    # excluded the same way every other lane excludes them: the workflow-level
    # ANGLESITE_SKIP_CONTAINER=1 already drops those targets from the manifest entirely.
    needs: changes
    if: needs.changes.outputs.swift == 'true'
    runs-on: macos-26
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Select latest available Xcode
        # Same rationale as build-test: this package needs Swift 6.4 (compiler(>=6.4) gates on
        # AnglesiteAppCore), which the runner's default active Xcode may predate.
        run: |
          set -euo pipefail
          ls -d /Applications/Xcode*.app 2>/dev/null | sort -V
          LATEST=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | grep -vE '/Xcode_26\.3(\.app|\.[0-9]+\.app)$' | tail -1)
          echo "Selecting: $LATEST"
          sudo xcode-select -s "$LATEST"

      - name: Show toolchain versions
        run: swift --version

      - name: Build documentation for every module (fails on any DocC error or warning)
        run: |
          swift package generate-documentation \
            --target AnglesiteSiteModel \
            --target AnglesiteQuickLookSupport \
            --target AnglesiteCore \
            --target AnglesiteBridgeCore \
            --target AnglesiteBridge \
            --target AnglesiteIOS \
            --target AnglesiteIntents \
            --target AnglesiteAppCore \
            --target AnglesiteTestSupport \
            --warnings-as-errors
```

- [ ] **Step 2: Register it in the `ci` aggregator job**

In the same file, find the `ci:` job's `needs:` list (around line 493-502):

```yaml
    needs:
      - changes
      - edit-overlay
      - help-book-links
      - linux-build-test
      - build-test
      - concurrency-tsan
      - xcodeproj-sync
      - localization-catalog
      - appintents-schema
```

Add `docs-docc` to it:

```yaml
    needs:
      - changes
      - edit-overlay
      - help-book-links
      - linux-build-test
      - build-test
      - concurrency-tsan
      - docs-docc
      - xcodeproj-sync
      - localization-catalog
      - appintents-schema
```

- [ ] **Step 3: Verify the exact CI command locally**

Run:
```sh
swift package generate-documentation \
  --target AnglesiteSiteModel --target AnglesiteQuickLookSupport --target AnglesiteCore \
  --target AnglesiteBridgeCore --target AnglesiteBridge --target AnglesiteIOS \
  --target AnglesiteIntents --target AnglesiteAppCore --target AnglesiteTestSupport \
  --warnings-as-errors
```
Expected: Exit code `0`. Output ends with `Generated 9 documentation archives:` — no `error:`
lines from `docc convert`. (Confirmed clean at the end of Task 4 — if this fails now, something
regressed between Task 4 and here.)

- [ ] **Step 4: Validate the YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"`
Expected: `YAML OK` (catches indentation mistakes before pushing).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(#1041): add docs-docc job, gate DocC warnings as errors"
```

---

### Task 6: Manual full-docset verification (not CI-automatable)

**Files:** none (verification only).

- [ ] **Step 1: Regenerate the Xcode project**

Run: `xcodegen generate`
Expected: Completes without error; `Anglesite.xcodeproj` is regenerated.

- [ ] **Step 2: Build the full merged docset locally**

Run: `xcodebuild docbuild -scheme Anglesite -destination 'platform=macOS'`
Expected: Succeeds (this exercises `AnglesiteContainer` and the two Xcode-only entry-point files
that the CI job's `swift package generate-documentation` path can't reach). Note any failure here
in the PR body — this step can't run in CI (the hosted runner can't build `AnglesiteContainer`),
so it's the one piece of this plan that stays a manual, PR-body-reported check per the design
spec's Testing section.

- [ ] **Step 3: Note the result in the PR body**

Record whether Step 2 succeeded (and the Xcode/toolchain version used) under the PR's "Test plan"
section, since this is the one verification CI cannot perform on its own.
