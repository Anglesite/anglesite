# Contributing to Anglesite (Mac app)

Thanks for your interest in contributing! This repo is the native macOS app that consumes the MCP server from the published [Anglesite Claude Skill](https://github.com/Anglesite/anglesite-skills). It's pre-release and moving fast, so a quick read of this page will save you time.

## Before you start

- **Issues are the source of truth.** Check [`gh issue list`](https://github.com/Anglesite/Anglesite/issues) and [`docs/build-plan.md`](docs/build-plan.md) for what's planned and in flight.
- **Claim your issue.** Multiple contributors (and agents) work this repo concurrently. Before starting on a tracked issue, check it isn't already claimed (`gh issue list --label "🛠️ In Progress"`), then add the `🛠️ In Progress` label. Remove the label once your PR is open — the PR is the signal from then on.
- **Discuss big changes first.** For anything beyond a bug fix or small improvement, open an issue before writing code. In particular, new features should not add `claude --print` / markdown-skill paths — that dependency is being retired under epic [#459](https://github.com/Anglesite/Anglesite/issues/459).

For architecture and project direction, read [`AGENTS.md`](AGENTS.md) — it's the canonical development-context document (mirrored as `CLAUDE.md` for Claude Code users). For the module layout, read [`Package.swift`](Package.swift) and `Sources/`.

## Development setup

Prerequisites and full build instructions live in the [README](README.md#requirements). The short version:

```sh
git clone https://github.com/Anglesite/Anglesite.git
cd Anglesite

# One-shot environment check/bootstrap: verifies prerequisites, generates the
# Xcode project, and enables the git hooks that keep it regenerated.
scripts/setup-dev-env.sh

# Build (ad-hoc signed — no Apple account required). Use scripts/build-app.sh
# instead of a raw `xcodebuild` — it regenerates the project first, so a checkout
# that went stale without tripping the git hooks above never builds a stale one (#123).
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Key things to know:

- **macOS 27+ and Xcode 27+ (Swift 6.4)** are required for the app itself. The `.xcodeproj` is gitignored and generated from [`project.yml`](project.yml) with [XcodeGen](https://github.com/yonaskolb/XcodeGen) — never edit or commit the project file; edit `project.yml`.
- **Open `Anglesite.xcodeproj`, not `xed .`** — the latter opens `Package.swift`, which has no runnable target.
- **Commit String Catalog updates.** App builds extract SwiftUI and `String(localized:)` literals into `Sources/AnglesiteApp/Localizable.xcstrings` because `SWIFT_EMIT_LOC_STRINGS` is enabled — but that catalog merge only happens in the **Xcode IDE**. A CLI-only `xcodebuild build` (the only option in a headless/agent workflow) still emits `.stringsdata` per file, it just never merges them into the `.xcstrings` catalog. If you add, remove, or rename user-visible text without an interactive Xcode session, run the merge yourself after building:
  ```sh
  scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
  BUILD_DIR=$(xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug -showBuildSettings 2>/dev/null | awk '/ BUILD_DIR =/{print $3}')
  xcrun xcstringstool sync Sources/AnglesiteApp/Localizable.xcstrings \
    --stringsdata $(find "$(dirname "$BUILD_DIR")/Intermediates.noindex/Anglesite.build/Debug/Anglesite.build/Objects-normal/arm64" -name "*.stringsdata") \
    --skip-marking-strings-stale
  ```
  Derive the `.stringsdata` path from `-showBuildSettings` rather than globbing `~/Library/Developer/Xcode/DerivedData/Anglesite-*` — this repo's workflow puts every feature/agent task in its own worktree (see `AGENTS.md` ▸ "Worktrees"), so a machine running several agents concurrently accumulates one `Anglesite-*` DerivedData directory per worktree, and the glob pulls `.stringsdata` from all of them. Confirmed the hard way: a sync scoped to the wrong worktree pulled `.stringsdata` from 13 sibling worktrees and produced a 76-line diff with ~25 keys belonging to unrelated in-flight branches. Always pass `--skip-marking-strings-stale`: without it, `sync` deletes any catalog key it can't find in the given `.stringsdata` files, and unless every one of them came from the exact same complete build, that silently nukes real entries — confirmed the hard way while writing this: a from-scratch `-derivedDataPath` build's `.stringsdata` set made `sync` empty the entire 700+-key catalog. This CLI recipe is only known-good against the `DerivedData` your own machine has already accumulated from normal `xcodebuild`/Xcode use — there is no known way yet to make it work reliably from an isolated, from-scratch build (e.g. in CI); review the `.xcstrings` diff yourself and include it in the same commit. Do not blindly restore the catalog when it appears after a build. If the diff contains keys you didn't add or touch — not just missing ones — discard it and re-sync scoped to this worktree's own `BUILD_DIR` as above; a bare `Anglesite-*` glob is the usual cause. If extraction looks incomplete or unexpectedly large, run a clean build first (`xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug clean build`) and review the stabilized result before committing it. CI's `localization-catalog` lane (`scripts/check-localization-catalog.sh`, #811) is a static backstop, not a substitute: it heuristically scans `Sources/AnglesiteApp` for common SwiftUI call sites (`Text`, `Button`, `Label`, …) and `String(localized:)`/`LocalizedStringKey(...)` literals with no matching catalog key, but it doesn't type-check call sites and can't catch every extraction vector Xcode recognizes.
- **Linux contributors welcome.** The portable SwiftPM targets build and test on Linux (Swift 6.3+, no Xcode or Node needed) — see [Developing on Linux](README.md#developing-on-linux). The cross-platform port ([#571](https://github.com/Anglesite/Anglesite/issues/571)) is an active track.
- **Plugin sibling checkout (optional).** Some end-to-end tests expect the Anglesite plugin repo checked out next to this one (`../anglesite`); they skip cleanly when it's absent.

## Testing

Run the relevant suites before opening a PR:

```sh
# Swift package tests (AnglesiteSiteModel, AnglesiteCore, AnglesiteBridge, AnglesiteIntents)
swift test --package-path .

# App target builds
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build

# JS edit overlay (from JS/edit-overlay/, Node 22+)
npm run lint && npm run typecheck && npm test
```

Notes:

- Container runtime tests are opt-in: `ANGLESITE_CONTAINER_TESTS=1` (plus `ANGLESITE_CONTAINER_E2E=1` for end-to-end cases).
- MCP/apply-edit e2e tests run only when `ANGLESITE_PLUGIN_PATH` points at an Anglesite plugin checkout; otherwise they skip.
- If you touch `Resources/Template/`, run `swift test` too — some Swift tests couple to the template markup.
- CI runs the JS overlay checks, Linux portable-target builds, macOS `swift test` (including ThreadSanitizer lanes), an `Anglesite.xcodeproj` ↔ `project.yml` sync check, and an AppIntents schema check. All must pass.

## Code guidelines

- **Swift/SwiftUI with Apple frameworks only** — plain SwiftUI + actors, no TCA or third-party state libraries. New dependencies need explicit approval in an issue first.
- **Process spawning is centralized** in `AnglesiteCore/ProcessSupervisor` — never call `Process()` from a view.
- **Logs are sacred** — every spawned subprocess streams stdout+stderr to the debug pane. Don't silently discard output.
- **Git is the source of truth for sites** — the app must never become the only way to edit a site. A site's `Source/` repo stays clonable and editable outside the app.
- **The app cannot bypass the template security gate** — `pre-deploy-check.ts` runs before every deploy; surface failures, don't add overrides.
- **JS/TypeScript** (edit overlay) uses ES modules, vanilla APIs, and the existing oxlint/tsc/vitest toolchain.
- **Comment and doc-comment conventions** are in [`docs/comment-style-guide.md`](docs/comment-style-guide.md) — read it before writing `///` doc comments on public API; CI fails on broken DocC symbol links or markup.

## Commits and pull requests

- **Conventional commits** — `feat(scope): …`, `fix(scope): …`, `ci: …`, etc. Reference the issue number in the subject when there is one (see `git log` for examples). Keep the whole subject line to **72 characters or fewer** (aim for ~50) — `type(scope): summary (#123)` adds up faster than it looks, and an over-length subject gets silently wrapped or split across `git log --oneline`, GitHub's commit/PR views, and `gh`'s own output. If it doesn't fit, shorten the summary and put the extra detail in the commit body, not the subject.
- **Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) as-is.** Open the file and copy its exact section headings into the PR body — **Summary**, **Paired PR check**, and **Test plan** — even for a trivial change. Don't substitute a generic "Summary / Test plan" body from a different tool's default PR format: that shape silently drops the Paired PR check. Extra sections (Design notes, screenshots, etc.) are welcome appended after the template's own sections — never in place of them.
- **Paired PRs.** Changes to the MCP message schema need a paired PR in [`Anglesite/anglesite-skills`](https://github.com/Anglesite/anglesite-skills): the sidecar PR ships first in a tagged release, then the app PR consumes it. Template changes (`Resources/Template/`) are app-only. See `AGENTS.md` ▸ "Two-repo coordination".
- **`@dwk/workers` catalog coordination.** The Worker catalog (`WorkerCatalog.swift` and friends) consumes `catalog.json` published by the separate [`davidwkeith/workers`](https://github.com/davidwkeith/workers) monorepo — a third repo outside the `Anglesite/anglesite-skills` pairing above. Schema extensions there land the same way: keep the app-side decoding **backward-compatible** (new manifest fields optional, feature inert until the catalog publishes them) so the app PR can merge first, and note the pending catalog change in the PR body. Example: the #746 route-claims PR ([#829](https://github.com/Anglesite/Anglesite/pull/829)) shipped an optional `routes` field the catalog can adopt later.
- Keep PRs focused; opportunistic cleanup near the code you're touching is fine, drive-by refactors of unrelated code are not.

## License

By contributing, you agree that your contributions are licensed under the [ISC License](LICENSE) that covers this project.
