# Comment style guide + DocC catalog + CI check — design (#1041)

- **Date:** 2026-07-27
- **Status:** Proposed
- **Issue:** [#1041 — Add comment style guide + DocC catalog + CI check](https://github.com/Anglesite/Anglesite-app/issues/1041)

## Decision

Add a written comment style guide (`docs/comment-style-guide.md`) that codifies the convention this
codebase already mostly follows — rationale-heavy `///` doc comments, not boilerplate restating the
signature — and wire up real DocC tooling so that convention produces a browsable Xcode docset:

1. A single, unified style guide document (no human/agent split — good comments serve both).
2. A `swift-docc-plugin` dependency + one umbrella `.docc` landing-page catalog.
3. A CI job that fails the build on DocC errors/warnings (broken symbol links, malformed markup),
   scoped to what CI can actually build.

This is guide-and-tooling only. It does **not** retrofit the ~500 files that already have doc
comments to the stricter tagging standard below — that standard applies to new and changed public
API going forward, checked in review, not enforced by an automated coverage gate in this pass.

### Scope

In scope: the style guide document, the DocC catalog, the `swift-docc-plugin` dependency, and one
new CI job validating DocC build health across every SwiftPM library target.

Out of scope: retrofitting existing doc comments; a documentation-coverage CI gate (only build
errors/warnings are checked); fixing the `AnglesiteContainer` CI build wall (tracked implicitly by
every existing `ANGLESITE_SKIP_CONTAINER` reference in `.github/workflows/ci.yml` — not this
issue's problem to solve); per-module `.docc` catalogs (deferred — see Alternatives).

## Background

`Sources/` currently has 542 Swift files; 520 already carry `///` doc comments, mostly prose that
explains *why* a type or function exists (often citing an issue number) rather than restating *what*
the signature already says. Only 11 files use formal `- Parameter:`/`- Returns:`/`- Throws:` tags.
`// MARK:` appears 307 times for jump-bar section grouping. There is no `.docc` catalog anywhere in
the repo, no DocC build step in CI, and no written comment-style doc in `docs/` or
`CONTRIBUTING.md`.

`AnglesiteAppCore` (declared in `Package.swift`) is a real SwiftPM target with `path:
"Sources/AnglesiteApp"`, excluding only `AnglesiteApp.swift` (the `@main` entry point) and
`LiveSiteRuntimeFactory.swift`. So 122 of the app target's 124 files are already SwiftPM-buildable
and DocC-documentable without an Xcode project — the app's substantial logic already lives where
`swift package generate-documentation` can reach it, which is exactly what makes "document the app
target too" tractable without touching `xcodebuild`.

`.github/workflows/ci.yml` sets `ANGLESITE_SKIP_CONTAINER=1` at the workflow level specifically
because the hosted runner "can neither build nor run" the native Apple Containerization graph that
`AnglesiteContainer` depends on. Every existing Swift CI lane either inherits that skip or (in
`appintents-schema`'s case) narrows its build to a single library target to avoid pulling
`AnglesiteContainer` in. No CI lane builds the full `Anglesite` application scheme today. A DocC job
that ran `xcodebuild docbuild -scheme Anglesite` would hit the same wall, since that scheme
depends directly on the `AnglesiteContainer` product (`project.yml`).

## 1. `docs/comment-style-guide.md`

Linked from `CONTRIBUTING.md`'s "Code guidelines" section. Sections:

1. **Philosophy** — comments explain *why*, not *what*; a well-named symbol already says what it
   does. Matches `CLAUDE.md`'s existing "default to no comments" instinct and this repo's own
   history of rationale-heavy prose.
2. **Doc comments (`///`)** — required on every `public`/`open` declaration. Lead sentence, then
   rationale/constraints in prose. Formal `- Parameter:`/`- Returns:`/`- Throws:` tags are
   **required on new or changed public API going forward** — pulled examples from this codebase
   (`WorkerComposition.swift:111`, `SiteContentGraph.swift:196`) rather than invented ones.
3. **DocC syntax** — double-backtick symbol links (` ``TypeName`` `` resolves and links; single
   backtick is plain code with no link), `- Important:`/`- Note:`/`- Warning:` callouts, `// MARK: -`
   (trailing dash — becomes a DocC Topic divider) vs plain `// MARK:` (jump-bar only, invisible to
   DocC), and how to structure a `.docc` catalog's landing page (`Topics` groups, `<doc:Symbol>`
   links).
4. **Inline comments (`//`)** — line-level only, only when the *why* isn't obvious from the code
   (hidden constraint, workaround for a specific bug, non-obvious invariant). Explicitly: don't
   restate what the next line does.
5. **Existing-debt note** — states plainly that the ~500 already-documented files aren't being
   retrofitted by this change, so nobody reads the new stricter tagging rule as "everything here is
   now wrong."
6. **Building docs locally** — two commands, both documented:
   - `swift package generate-documentation --target <TargetName>` — fast, single-module, what CI
     runs.
   - `xcodebuild docbuild -scheme Anglesite -destination 'platform=macOS'` — the full merged
     docset (app entry point + `AnglesiteContainer` + every module) as one browsable archive in
     Xcode's Developer Documentation window. **Local-only** — requires a Mac that can build
     `AnglesiteContainer`, which the hosted CI runner cannot.

## 2. DocC catalog

- Add `swift-docc-plugin` (`github.com/apple/swift-docc-plugin`) to `Package.swift` as a plugin
  dependency. Build-time only — a SwiftPM command plugin, never linked into the shipped app; no
  runtime, binary-size, or App Store review surface. This is a new dependency per
  `CONTRIBUTING.md`'s "new dependencies need explicit approval" rule; approved in chat for this
  issue.
- New `Sources/AnglesiteApp/Anglesite.docc/` catalog directory, auto-adopted by `AnglesiteAppCore`
  (DocC discovers any `.docc` folder inside a target's source tree with no extra configuration).
  One landing page: a short architecture map (app shell → `AnglesiteCore`/`AnglesiteSiteModel` →
  `AnglesiteBridge`/`AnglesiteIntents`/container runtime) with `<doc:>` links into each module's
  key entry-point types.
- No per-module catalogs. One umbrella landing page is the whole curated-content surface; every
  other module's documentation is symbol-only (doc comments alone, no separate landing page to
  maintain and let drift).

## 3. CI job

New `docs-docc` job in `.github/workflows/ci.yml`:

- Gated the same way as `build-test`: `needs: changes`, `if: needs.changes.outputs.swift ==
  'true'`.
- Runs on `macos-26` (matches `build-test`/`concurrency-tsan` — needs a real Swift toolchain, not
  Xcode/xcodegen).
- No `xcodegen generate` step, no `.xcodeproj` — this job never touches the Xcode project. It runs
  `swift package generate-documentation` per SwiftPM library target: `AnglesiteSiteModel`,
  `AnglesiteQuickLookSupport`, `AnglesiteCore`, `AnglesiteBridgeCore`, `AnglesiteBridge`,
  `AnglesiteIOS`, `AnglesiteIntents`, `AnglesiteLANHost`, `AnglesiteAppCore` — with
  `--warnings-as-errors` so a broken symbol link or malformed DocC markup fails the build.
- `AnglesiteContainer`/`AnglesiteContainerProbe` are excluded, consistent with every other CI
  lane's `ANGLESITE_SKIP_CONTAINER=1` exclusion of the native container graph. This is a coverage
  gap only in CI, not locally — `ANGLESITE_SKIP_CONTAINER` is never set on a contributor's own
  machine, so `swift package generate-documentation --target AnglesiteContainer` works there today
  with no extra setup.
- Added to the final `ci` aggregator job's `needs:` list, so it's part of the required-checks
  signal like every other lane.

## Alternatives considered

**Per-module `.docc` catalogs (rejected).** Every library target gets its own landing page +
curated Topics groups. More thorough, but six-plus landing pages is real ongoing upkeep that will
drift the first time a module's shape changes and nobody updates its catalog. The umbrella catalog
gives one real "start here" page without that maintenance surface.

**`xcodebuild docbuild -scheme Anglesite` in CI (rejected).** This was the original plan for
validating "the app target too," but the scheme depends on `AnglesiteContainer`, which the hosted
runner cannot build — every other CI lane already routes around this same wall. Building the docs
job around it would either fail outright or require solving the container-build-in-CI problem
first, which is a separate, larger effort outside this issue's scope.

**Retrofit existing doc comments now (rejected).** Bringing ~500 files up to the new tagging
standard in the same PR that introduces the standard is a large, separate mechanical effort with
its own review burden. The guide states the new bar applies going forward; existing debt is
tracked implicitly (any file touched for other reasons can be brought up to standard opportunistically,
per `CONTRIBUTING.md`'s "opportunistic cleanup near the code you're touching is fine").

## Testing

- `swift build` succeeds with the new `swift-docc-plugin` dependency resolved.
- `swift package generate-documentation --target AnglesiteCore` (and at least one other target)
  succeeds locally and produces a `.doccarchive` with no warnings.
- `swift package generate-documentation --target AnglesiteAppCore` picks up the new
  `Anglesite.docc` landing page.
- The new CI job passes on this PR's own branch (proof the mechanism works, not just the design).
- `xcodebuild docbuild -scheme Anglesite -destination 'platform=macOS'` is exercised manually on a
  real Mac (not CI) to confirm the full merged docset still builds end-to-end, and reported as a
  manual verification step in the PR body since CI cannot run it.
