# Anglesite (Mac app)

A native macOS app that gives non-technical site owners a click-to-edit experience for their website.

Scaffolding, deploys, and design flows are deterministic Swift; generative features run on Apple Intelligence (on-device Foundation Models). Edits and content operations go through the [Anglesite MCP sidecar](https://github.com/Anglesite/anglesite-skills) (`server/` in the sibling repo), which runs inside the app's container runtime. The former Claude Code dependency — the `claude --print` subprocess and the markdown-skill machinery — is fully retired (epic #459).

## Status

**Pre-release.** The v0 → v1 core is built (Phases 0–9): site plumbing, supervised subprocesses, the WKWebView live preview with click-to-edit overlay routed through the MCP sidecar, deploy via `wrangler` (with the mandatory pre-deploy scan), Keychain/`gh` credentials, the per-site chat panel, multi-window, the deploy-readiness health badge, image-drop optimization, and per-edit undo.

In progress (Phase 10, v2 polish):
- **Mac App Store build.** `Anglesite` is the single sandboxed app target (`io.dwk.anglesite`). The old direct-download target has been retired. The host-side embedded Node runtime has been retired (#70); local Apple Containerization is the macOS runtime direction.
- **Apple Help Book** — shipped. 15 hand-authored HTML pages with `hiutil` search index, accessible via Help ▸ Anglesite Help.

Also landed since v1:
- **`SiteRuntime` protocol** (#65) — abstracts the execution substrate so `PreviewModel` is decoupled from how a site runs (in-process subprocess vs. local container vs. Cloudflare).
- **HTTP/Streamable MCP transport** (#64) — `MCPClient` can connect over HTTP in addition to stdio, enabling container-backed runtimes.
- **Containerization** — Apple Containerization is the macOS runtime direction. The active app-bundled image source is `Containers/anglesite-dev/`, exported by `scripts/vendor-container-image.sh` into `Resources/container-image/` and booted by the `AnglesiteContainer` target. Docker/buildx is only used to build that inert OCI root filesystem. The lowercase `container/` directory is the Cloudflare Sandbox / remote-runtime image pipeline for `RemoteSandboxSiteRuntime` and iOS work, not the macOS app image.
- **Xcode 27 migration** (#108) — macOS 27+ deployment target, `@State` macro audit, Swift 6.4 toolchain.
- **macOS 27 platform features** — the first platform wave has shipped: system-wide MCP (#101), Spotlight/App Intents (#102), native chat on Foundation Models (#105), and more.

See [`docs/build-plan.md`](docs/build-plan.md) for the full phased status.

## Documentation

- [Build plan](docs/build-plan.md) — phased implementation roadmap
- [High-level design](../anglesite/docs/dev/mac-app-design.md) — companion design doc in the sidecar repo

## Requirements

These are the requirements for building the macOS app — the primary development flow. For working on the portable core from a Linux machine, see [Developing on Linux](#developing-on-linux).

On either platform, `scripts/setup-dev-env.sh` checks the prerequisites below, fixes what it safely can (generating the Xcode project, enabling git hooks, the Linux libxml2 shim), and prints instructions for the rest.

- macOS 27+
- Xcode 27+ (Swift 6.4; required for the SwiftUI 27 `@State` macro semantics audited in [`docs/specs/2026-06-10-xcode27-state-macro-audit-notes.md`](docs/specs/2026-06-10-xcode27-state-macro-audit-notes.md))
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) — the `.xcodeproj` is generated from [`project.yml`](project.yml)
- The host-side embedded Node runtime has been retired (#70) — dev-server, build, and deploy commands run in a container runtime instead, so users do not need Node installed.

## Building

```sh
# Clone alongside the sidecar repo
git clone https://github.com/Anglesite/Anglesite.git
cd Anglesite

# One-shot environment check/bootstrap (generates the Xcode project, enables the
# git hooks below, and reports anything missing) — or follow the steps manually:
scripts/setup-dev-env.sh

# Generate the Xcode project
xcodegen generate

# (Recommended) Enable git hooks: auto-regenerate the .xcodeproj after
# `git pull` / branch switches / rebases (keeps Xcode in sync with project.yml
# and Sources/ without manual `xcodegen generate` calls), and auto-restore the
# trailing newline Xcode's String Catalog build phase strips from *.xcstrings.
git config core.hooksPath scripts/git-hooks

# (Optional one-time verification) Confirm project.yml hasn't drifted from the
# source tree — regenerates the .xcodeproj and checks every app target compiles all
# of Sources/AnglesiteApp. CI runs this too, so it's not a required setup step.
scripts/check-xcodeproj-sync.sh

# Build via CLI (ad-hoc signed; no Apple account required)
xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build

# Or open in Xcode (note: `open Anglesite.xcodeproj`, NOT `xed .`)
open Anglesite.xcodeproj
```

There is one app target, ad-hoc-signed in Debug so it builds without an Apple account:

| Scheme | Bundle id | Distribution | Sandbox |
|---|---|---|---|
| `Anglesite` | `io.dwk.anglesite` | Mac App Store | on (App Sandbox) |

> **Don't `xed .`** — this repo contains both a `Package.swift` and an `Anglesite.xcodeproj`. `xed .` opens the package, whose scheme picker only shows `Anglesite-Package` (libraries only, no runnable target). Open the `.xcodeproj` explicitly; the scheme picker should then show `Anglesite`, `AnglesiteCore`, `AnglesiteBridge`, `AnglesiteSiteModel`, `AnglesiteIntents`, and `AnglesiteContainer`, and ⌘R should run the app.

The Debug configuration uses ad-hoc signing so contributors can build and run locally without any Apple Developer enrollment. App Store Release builds require a paid Apple Developer account and a provisioning profile with the app's restricted entitlements; see [`docs/release.md`](docs/release.md).

## Developing on Linux

The app shell is macOS-only today, but Anglesite is going multi-platform — Linux first — per the [cross-platform port design](docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md). On Linux, `Package.swift` exposes only the **portable SwiftPM targets** (currently `AnglesiteSiteModel`; the set grows as the "purity phase" lands seam by seam), and CI runs `swift build && swift test` on Ubuntu to enforce that boundary.

```sh
git clone https://github.com/Anglesite/Anglesite.git
cd Anglesite

# Checks for a Swift 6.3+ toolchain (installable via swiftly: https://www.swift.org/install/linux/),
# creates the libxml2 soname shim if your distro needs it (see below), enables git hooks,
# and runs a smoke build of the portable targets.
scripts/setup-dev-env.sh

swift build   # portable targets only
swift test
```

Notes:

- **Toolchain:** Swift 6.3+ (via [swiftly](https://www.swift.org/install/linux/)). No Xcode, XcodeGen, or Node needed on Linux.
- **libxml2 on newer distros:** distros shipping libxml2 ≥ 2.15 (e.g. Ubuntu 26.04) provide `libxml2.so.16`, but the swift.org toolchain links `libxml2.so.2`. The setup script creates a user-level symlink shim and prints the `LD_LIBRARY_PATH` export to activate it; loader warnings about "no version information" are expected and harmless. (CI is unaffected — the `swift:*` container images ship a matching libxml2.)
- **Working on the port itself:** `ANGLESITE_PORT_WIP=1 swift build --target AnglesiteCore` opts the not-yet-portable core into the manifest so in-flight seam work can be compile-checked locally. Apple-only targets (`AnglesiteBridge`, `AnglesiteIntents`, `AnglesiteContainer`, …) never build off-Darwin.
- **Containers:** `podman` is not needed for the purity phase; it becomes relevant with the Linux MVP's `PodmanSiteRuntime`.

## Relationship to the sidecar repo

This repo expects a sibling checkout of the sidecar repo, [`Anglesite/anglesite-skills`](https://github.com/Anglesite/anglesite-skills), in a directory named `anglesite` next to this one (both under the same parent directory) — or set `ANGLESITE_SIDECAR_SRC` to point elsewhere (`ANGLESITE_PLUGIN_SRC` remains a compatibility alias). The sibling repo supplies the **MCP sidecar** (`server/`), which the container-image scripts (`scripts/vendor-container-image.sh`, `scripts/build-podman-image.sh`) stage into the dev-server image; the MCP end-to-end tests also spawn it directly from the checkout (`ANGLESITE_PLUGIN_PATH`). Nothing from the sibling repo is bundled into the app itself anymore (#466).

## License

ISC. See [LICENSE](LICENSE).
