# Anglesite — Development Context

This is the **native macOS app**. The sibling repo at `../anglesite` supplies the **MCP sidecar** (`server/`), which is staged into the container image at build time. Both repos are under the same `github.com/Anglesite/` parent directory.

## Contribution workflow (mandatory)

[`CONTRIBUTING.md`](CONTRIBUTING.md) is the source of truth for contribution workflow. **Read it from the current checkout before planning or making any repository change**, even if you have worked in this repo before; do not rely on this file, a prior session, or a cached summary as a substitute. Apply every requirement relevant to the task, including issue claiming, approval for large changes or new dependencies, generated-file handling, testing, commit format, and pull-request preparation.

Before handing work off, re-check the changed files against `CONTRIBUTING.md`, run the relevant test/build commands it specifies, and report any required check you could not run. When delegating work, explicitly instruct each agent to read `CONTRIBUTING.md` **in its assigned worktree before acting**; the delegating agent remains responsible for verifying compliance.

**Immediately before running the commit or `gh pr create` command**, re-check against `CONTRIBUTING.md` ▸ "Commits and pull requests" instead of falling back to a generic format: commit subject ≤72 characters, and a PR body built from `.github/PULL_REQUEST_TEMPLATE.md`'s actual headings — even for a docs-only or otherwise trivial change — not the generic Summary/Test-plan shape a general tool default falls back to, which silently drops the **Paired PR check** section.

## Two-repo coordination

| Repo | Role |
|---|---|
| `Anglesite/anglesite-skills` | MCP sidecar server (`server/`) — the app's edit/content backend inside the container |
| `Anglesite/Anglesite` *(this repo)* | macOS app: SwiftUI shell, website template, WKWebView preview, edit overlay |

The **website template** (Astro project skeleton, themes, scaffold script, pre-deploy check) lives in this repo at `Resources/Template/`. It is a committed, first-class app resource. `TemplateRuntime` resolves it from the app bundle (with a Settings override for development).

The sibling `Anglesite/anglesite-skills` repo (renamed from `Anglesite/anglesite`; the old slug now redirects to *this* repo instead — see #1059) continues to publish Anglesite as a Claude Skill and standalone project. Its Claude-plugin machinery (markdown skills, `hooks.json`, `.claude-plugin/` manifest) is retired **on the app side** (#466): the app no longer bundles or loads it — `scripts/copy-plugin.sh`, `Resources/plugin/`, and `PluginRuntime` are gone. What the app consumes from that checkout is only `server/` (+ its npm manifests), staged into the container image by `scripts/lib/stage-dev-image-context.sh`. The staging scripts identify that MCP-server boundary by `server/index.mjs` and `package.json`, rather than by the plugin manifest.

Cross-cutting work (e.g. extending the MCP server with new messages) still lands as paired PRs:

1. Sidecar PR adds the server-side support and ships in a tagged release.
2. App PR consumes it (and re-vendors the container image).

Paired PRs are only needed for MCP schema changes — template changes are app-only. The sidecar repo is the source of truth for the MCP message schema; the app owns the template and everything else.

> **Direction note:** the Claude Code dependency is retired app-side (epic #459, slice 7 #466). New feature journeys land as deterministic Swift/TypeScript or Apple Intelligence paths — there is no `claude --print` / markdown-skill path to extend.

## Stack

- **Swift / SwiftUI** — app shell. Targets macOS 27+.
- **Plain SwiftUI + actors** for v0. No TCA, no third-party state libraries.
- **WKWebView** — live preview of the Astro dev server.
- **No host-side Node runtime** — retired (#70). Dev-server, build, and deploy commands run inside a container runtime (local Apple Containerization or the remote Cloudflare sandbox) instead of a bundled host Node.
- **MCP** — talks to the sidecar server (the sibling repo's `server/`) over stdio (local subprocess) or HTTP/Streamable transport (for container-backed runtimes). `MCPClient` abstracts the transport behind an `MCPTransport` seam; `SiteRuntime` (protocol) abstracts the execution substrate so `PreviewModel` doesn't know whether a site runs in-process or in a container.

## Site identity — the `.anglesite` package

A site is a self-contained `.anglesite` **package** (#242) — a directory with the
`io.dwk.anglesite.site` package UTI (`LSTypeIsPackage`). Layout:

- `Info.plist` — marker: format version + **stable site UUID** + display name + created date. Identity is the UUID (path-independent), so moving/renaming a package keeps its identity.
- `Source/` — the Astro project, a git repo. The externally-editable, clonable unit; `cd`/git/VS Code/CLI descend into it.
- `Config/` — app-owned per-site state (`settings.plist` via `SiteConfigStore`, `chat-history.jsonl`, caches). **Never** in git. `.site-config` stays in `Source/` (template-owned).

`AnglesitePackage` (AnglesiteSiteModel, re-exported by AnglesiteCore) is the single source of truth for this layout. The app opens packages explicitly — Finder double-click / `onOpenURL`, **File ▸ Open Site…** (an `NSOpenPanel` filtering on the `io.dwk.anglesite.site` UTI via `UTType.anglesiteSite`), **Open Recent** — and discovers them via a **recents registry** (`SiteStore`, `recents.json`), not by scanning a folder. `SiteStore.Site` carries `packageURL` + computed `sourceDirectory`/`configDirectory` (there is no `path`).

Operationally: **File ▸ Import** copies a plain Anglesite directory into a new package (migrating any legacy `.anglesite/` into `Config/`); **File ▸ Export** copies `Source/` back out. New sites scaffold into `Source/` (with `git init`); the dev server, deploy, and `pre-deploy-check` all run with cwd = `Source/`. On MAS, one security-scoped bookmark per package covers both `Source/` and `Config/`. `~/Sites/` is now just the default save location for new/imported packages — not a discovery root (there is no legacy `sites.json` migration, so Import is the upgrade path for pre-package sites).

## Build target

`Anglesite` is the only app target. It sets `ANGLESITE_MAS` via `SWIFT_ACTIVE_COMPILATION_CONDITIONS`, is sandboxed, holds a per-`SiteWindow` security-scoped bookmark grant, and links `AnglesiteContainer` for the local Apple Containerization runtime. Direct-download distribution is retired.

## Editing guidelines

- **No frameworks beyond Apple's** unless explicitly approved.
- **Process spawning is centralized** in `AnglesiteCore/ProcessSupervisor` — never call `Process()` from a view.
- **Logs are sacred** — every spawned subprocess streams stdout+stderr into the debug pane. Do not silently `>/dev/null`.
- **The app cannot bypass the pre-deploy security gate** — the template's `scripts/pre-deploy-check.ts` runs directly before every deploy (`PreDeployCheck`), and the app surfaces failures rather than allowing override. This is the native replacement for the old plugin `PreToolUse` hook (roadmap §7) — a non-LLM gate can't be prompt-injected or talked out of running.
- **The app advises; it does not delegate the decision.** Anglesite's users are not people who will adjudicate a three-way merge or a conflict marker — they came here to publish a website. Where the app knows the right answer (e.g. app-owned build/security machinery under `scripts/` — see #1053), it applies it without asking. Where it genuinely doesn't, ask a question phrased about consequences to the owner's site, never about git, diffs, or file layout.
- **Git is the source of truth** (#72) — the app must never become the only way to edit a site. A site's canonical, externally-editable copy is its `Source/` **git repo**, clonable anywhere. A site is an `.anglesite` **package** (#242): Finder treats it as opaque (double-click opens it in Anglesite), but `cd`, `git`, VS Code, and the Codex CLI all still descend into `Foo.anglesite/Source/` and keep working, and that repo can be cloned and edited outside the app entirely. App-owned per-site state lives beside it in `Foo.anglesite/Config/`, outside the repo (never in git). The app's own local working copy is not canonical: it lives **inside the site runtime/container** (#66/#69), hydrated from the repo when a site opens and pushed back to it — so any clone of the repo, not the app's working tree, is the unit everything else derives from. See [`docs/superpowers/specs/2026-06-19-anglesite-package-model-design.md`](docs/superpowers/specs/2026-06-19-anglesite-package-model-design.md) §8 (the #72 reconciliation) and the [containerization notes](docs/specs/2026-06-09-containerization-mas-subspike-notes.md).

## Platform UX standards

Every user-facing design and implementation must follow the standard for its target platform. Treat the applicable release acceptance checklist as part of feature definition and QA—not as optional polish—and do not flatten platform behavior into a lowest-common-denominator cross-platform UI.

- **macOS:** [`docs/mac-assed-app-spec.md`](docs/mac-assed-app-spec.md). Current app work must preserve Mac conventions, including menus, keyboard commands, windows, files, Undo/Redo, VoiceOver, and system integration.
- **iOS and iPadOS:** [`docs/ios-ipados-assed-app-spec.md`](docs/ios-ipados-assed-app-spec.md). Mobile work must distinguish the focused iPhone experience from iPad's adaptive multitasking, keyboard, pointer, Apple Pencil, and drag-and-drop context.
- **Android:** [`docs/android-assed-app-spec.md`](docs/android-assed-app-spec.md). Android work must distinguish touch-first phone use from adaptive tablet, foldable, keyboard, pointer, and windowed contexts while preserving Android Back, intents, lifecycle, and accessibility behavior.
- **Windows:** [`docs/windows-assed-app-spec.md`](docs/windows-assed-app-spec.md). Future Windows work must use Windows-native commands, shell integration, accessibility, DPI/multi-monitor behavior, and packaging.
- **Linux (Ubuntu GNOME baseline):** [`docs/linux-assed-app-spec.md`](docs/linux-assed-app-spec.md). Future Linux work must follow Ubuntu GNOME patterns while respecting freedesktop.org interoperability, Wayland, portals, XDG data locations, accessibility, and the shipped package format.

When shared-core constraints conflict with a platform convention, keep the shared behavior deterministic and introduce a thin platform-shell adaptation rather than weakening the native experience on every platform. Document any intentional convention departure in the feature design and verify that it is clearer, accessible, reversible, and justified for the task.

## Worktrees (default for feature/agent work)

Do feature work — and **all** dispatched-agent work — in a git worktree, never directly on the main checkout. Multiple agents run in parallel here, so the main tree must stay clean. Worktrees live under `.claude/worktrees/<name>/`.

- **Run `xcodegen generate` first** — `Anglesite.xcodeproj` is gitignored and regenerated from `project.yml`, so a fresh worktree has no project file until you generate it.
- **Set `ANGLESITE_SIDECAR_SRC`** — its default (`../anglesite`) resolves wrong from inside a worktree; point it at the real sidecar checkout (`…/github.com/Anglesite/anglesite`) so the container-image scripts (`vendor-container-image.sh` / `build-podman-image.sh` / `build-container-image.sh`) can stage the MCP sidecar. `ANGLESITE_PLUGIN_SRC` remains a compatibility alias.
- **Dispatched subagents must `cd` to the worktree** — give them a hard `cd <worktree>` guard before any git op, or they run against the main checkout.

## Build

Toolchain: **Xcode 27+ / Swift 6.4** (required for SwiftUI 27's `@State` macro semantics — see [`docs/specs/2026-06-10-xcode27-state-macro-audit-notes.md`](docs/specs/2026-06-10-xcode27-state-macro-audit-notes.md)).

```sh
# Open the app project (not `xed .` — that opens Package.swift, which only
# has the library scheme `Anglesite-Package` and no runnable target).
open Anglesite.xcodeproj
# Anglesite.xcodeproj is gitignored and generated from project.yml — after a
# fresh clone or in a new worktree, run `xcodegen generate` first.
# ⌘B in Xcode, or:
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

Tests: `swift test --package-path .` runs the SwiftPM test targets (`AnglesiteSiteModelTests`, `AnglesiteCoreTests`, `AnglesiteBridgeTests`, and, on Swift 6.4+/Xcode 27, `AnglesiteIntentsTests`). `AnglesiteContainerLocalTests` is opt-in with `ANGLESITE_CONTAINER_TESTS=1`; its end-to-end cases also require `ANGLESITE_CONTAINER_E2E=1`. Most suites are Swift Testing (#74), with the remaining XCTest holdouts in `AnglesiteCoreTests` and `AnglesiteBridgeTests`. The MCP / apply-edit e2e tests (`AppliesEditEndToEndTests`, `MCPClientHTTPEndToEndTests`) need the sibling sidecar checkout + node; they're gated with Swift Testing's `.enabled(if:)` trait, so they skip cleanly when the checkout is absent — set `ANGLESITE_PLUGIN_PATH` to the sidecar checkout to make them run. If `swift build`/`swift test` seems to hang with no output, a stale SwiftPM process is likely holding the `.build` lock — check `pgrep -fl swift-test` and kill the orphan rather than assuming a bad test.

Note: `swift test` runs on CI's older runners even though `Package.swift` declares `.macOS("27.0")` — a SwiftPM CLI test binary tolerates a high deployment target as long as it doesn't call macOS-27-only symbols at runtime. **Hosted** app tests (`xcodebuild test` with `Anglesite.app` as the test host) do *not* work there: launching a macOS-27 `.app` is blocked on an older-macOS runner by LaunchServices. (The Swift lanes run on macos-26 — bumped from macos-15, whose Swift 6.2.x OS concurrency runtime carried a task-allocator bug that crashed whole `swift test` runs with "freed pointer was not the last allocation", see PR #644/#646.) So app-target logic that needs CI coverage (e.g. `DeployModel`'s token orchestration) is kept thin and pushed into a testable `AnglesiteCore` type (`TokenOnboarding`) rather than tested through a hosted app target.

## Plan

`gh issue list` is the source of truth for what to work on, with [`docs/build-plan.md`](docs/build-plan.md) for the phased roadmap and the per-epic status snapshot (Containerization, Claude Code removal, Component Editor, Personal Publishing OS, cross-platform port, and the rest). Issue numbers in that snapshot are illustrative and may be stale (many are already closed) — confirm against gh before picking up work. Current phase: **Phase 10** — v2 polish (tracking: #34). Phases 0–9 are complete.

**Issue-in-flight signaling.** Multiple agents work this repo concurrently (see "Worktrees" above), so before starting work on a tracked issue, check it isn't already claimed and mark that you're taking it: `gh issue list --label "🛠️ In Progress"` to check, then `gh issue edit <n> --add-label "🛠️ In Progress"` to claim it. Remove the label when a PR opens for it (`gh issue edit <n> --remove-label "🛠️ In Progress"`) — the PR itself is the up-to-date signal from then on. If you find an issue already fixed/merged before you could start (as happens — two agents can pick the same issue in the same window), don't silently redo the work: check for an existing PR/commit first, and if one already landed, close the issue referencing it rather than duplicating the fix.
