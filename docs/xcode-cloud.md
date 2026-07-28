> **[Build + test only]** This doc scopes an Xcode Cloud workflow to Debug build + `swift test` on
> pushes/PRs, alongside the existing GitHub Actions CI (`.github/workflows/ci.yml`) — it does not
> archive or upload to TestFlight/App Store Connect. See [release.md](release.md) for the App
> Store release pipeline, which stays a separate, manual (`scripts/release.sh`) flow.

# Xcode Cloud

Xcode Cloud gives PRs/branches a build+test signal from a real Xcode toolchain, complementing the
GitHub Actions lanes in `.github/workflows/ci.yml` (which run `swift test` and `xcodebuild build`
on GitHub's runner images — see [`docs/build-plan.md`](build-plan.md) and issue #128 for why those
runners can lag behind the Xcode version this repo targets).

Xcode Cloud workflows themselves are configured in Xcode / App Store Connect, not in files
committed to this repo — there is no declarative workflow-as-code file format. What *is*
repo-side, and what this doc covers, is:

- [`ci_scripts/ci_post_clone.sh`](../ci_scripts/ci_post_clone.sh) — the one piece Xcode Cloud
  reads directly from the repo.
- The one-time workflow setup steps you still have to click through in Xcode / App Store Connect.

## Why a post-clone script is required

`Anglesite.xcodeproj` is gitignored and generated from [`project.yml`](../project.yml) via
XcodeGen (see [`xcode-setup.md`](xcode-setup.md)). A fresh Xcode Cloud clone has no project file
at all, so without help Xcode Cloud has nothing to build.

Xcode Cloud auto-detects and runs any executable script under a `ci_scripts/` directory at the
repo root, at fixed points in the pipeline (`ci_post_clone.sh` → resolve package dependencies →
`ci_pre_xcodebuild.sh` → build/test/archive → `ci_post_xcodebuild.sh`). `ci_post_clone.sh` here
installs the same pinned XcodeGen release used by `.github/workflows/ci.yml`
(`scripts/check-xcodeproj-sync.sh`'s `MIN_XCODEGEN` too — bump all three together) and runs
`xcodegen generate`, so the project exists before Xcode Cloud tries to resolve the scheme.

Everything else the app build needs is already handled without Xcode Cloud-specific work:

- **Container image/kernel/initfs vendoring** (`scripts/vendor-container-image.sh` /
  `vendor-container-kernel.sh`) is not run in CI. `scripts/check-container-resources.sh` (wired
  into `project.yml` as a `preBuildScripts` entry) only **warns** on missing container resources
  in **Debug** builds — it **fails** in Release. Since this workflow builds Debug only, no
  Xcode Cloud environment variable or extra step is needed here. (A future Release/TestFlight
  workflow would need to either vendor those artifacts on the Xcode Cloud VM — untested, and the
  `container` CLI's availability there is unconfirmed — or set
  `ANGLESITE_ALLOW_UNPROVISIONED_CONTAINER=1` as a workflow environment variable and accept that
  the resulting build's local-container preview won't work.)
- **JS edit-overlay build** (`scripts/build-overlay.sh`) and **Help index build**
  (`scripts/build-help-index.sh`) are both best-effort: they warn and exit `0` when `npm`/`hiutil`
  isn't available, rather than failing the build.

## One-time setup (Xcode / App Store Connect)

This part has to be done interactively — from a Mac with access to the Apple Developer team, not
from this repo:

1. Locally, make sure the project generates cleanly: `xcodegen generate && open Anglesite.xcodeproj`.
2. In Xcode: **Product ▸ Xcode Cloud ▸ Create Workflow**. Sign in with the Apple Developer account
   for this app's team and grant Xcode Cloud access to the `Anglesite/Anglesite` GitHub repo
   if prompted.
3. Configure the workflow:
   - **Scheme:** `Anglesite`.
   - **Start Conditions:** Branch Changes (`main`) and Pull Request Changes into `main` — mirrors
     the `on: push`/`on: pull_request` triggers in `.github/workflows/ci.yml`.
   - **Actions:** Build (Debug), then Test (Debug/Test destination on the same Mac runner
     platform this repo targets — macOS 27+/Xcode 27+, per the deployment target in `project.yml`).
     Do **not** add an Archive action for this workflow — that's out of scope here (see the note
     at the top of this doc).
   - **Environment:** pick an Xcode version ≥ 27 to match `MACOSX_DEPLOYMENT_TARGET: "27.0"` and
     the Swift 6.4 toolchain requirement (see the root [`CLAUDE.md`](../CLAUDE.md) "Build" section).
     If Xcode Cloud's environment picker doesn't yet offer Xcode 27, the workflow isn't usable
     until it does — there's no override the app can build against an older SDK.
4. Save. Xcode Cloud pushes the workflow definition to App Store Connect (Settings tab there is
   the durable place to review/edit it afterward — Xcode itself is just an editor for it).
5. Trigger a build (push a commit, or **Product ▸ Xcode Cloud ▸ Manage Workflows ▸ Start Build**)
   and confirm `ci_post_clone.sh` ran (visible in the build's log) and the `Anglesite` scheme built
   and tested successfully.

## Notes

- No signing setup is needed for a Debug build/test workflow — Xcode Cloud handles Debug
  ad-hoc/automatic signing itself; there's no provisioning profile or certificate to install here
  (contrast with the manual Release flow in [`release.md`](release.md), which does need those).
- If `swift test`'s Package.swift-level suites should also run under Xcode Cloud (rather than
  relying on GitHub Actions for that), add a **Test** action against the `Anglesite-Package`
  scheme too — this doc only scopes the app-target `Anglesite` scheme.
