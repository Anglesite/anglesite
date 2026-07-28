# VendoredGitSpike

Empirical harness for [#640](https://github.com/Anglesite/Anglesite/issues/640)'s Option 1:
does a **vendored, non-Apple** git binary (no Xcode Command Line Tools license-gate) execute as a
subprocess from inside a real App Sandbox container, where Apple's own `/usr/bin/git` refuses to
run at all (`xcrun: error: cannot be used within an App Sandbox.`)?

Companion to [`../GitPackageSpike`](../GitPackageSpike) (Option 2 — SwiftGit2, an in-process
libgit2 binding). This spike tests the other branch of #640's "Suggested direction."

```sh
brew install git   # if not already installed — the vendor source
Spikes/VendoredGitSpike/scripts/build-and-run.sh
```

Output lands in `results/sandboxed-result.json`.

## What it tests

One `.app` bundle, wrapped and ad-hoc signed with `com.apple.security.app-sandbox` (mirroring
`Resources/Anglesite.entitlements`) and launched via `open` — same methodology #640 itself used,
and required per `Spikes/ContainerSpike`'s prior finding that a bare Mach-O binary with no real
`.app` bundle makes `sandboxd` hang instead of attaching a container.

Deliberately **no extra entitlement** beyond plain `app-sandbox` + the file entitlements — the
question is whether a vendored binary needs anything special at all, the same as any other
bundled helper tool a sandboxed Mac app ships.

Inside that one sandboxed process, the same `init` → `rev-parse --git-dir` → `add` → `commit` →
`rev-parse HEAD` sequence (mirroring #640's own repro exactly) runs through **two** git binaries,
back to back, for a direct comparison:

| Tier | Binary | Purpose |
|---|---|---|
| V-vendored | Homebrew-built `git` (`/opt/homebrew/opt/git/bin/git`), copied into `Contents/Resources/git-vendor/`, `install_name_tool`-rewritten to `@executable_path`-relative dylib paths, and re-signed — fully self-contained, no dependency on `/opt/homebrew` existing on the target machine | The actual proposal: a git binary genuinely bundled inside the app |
| S-system | Apple's `/usr/bin/git`, run unmodified | In-harness reproduction of #640, for a same-process, same-run comparison rather than trusting the issue's own repro on faith |

Homebrew's `git` links only two non-system dylibs (`libpcre2-8.0.dylib`, `libintl.8.dylib` — both
vendored alongside it); `init`/`add`/`commit`/`rev-parse` are all compiled-in builtins in the git
binary itself (confirmed via `ls -li`: `libexec/git-core/git-{init,add,commit,rev-parse}` are all
symlinks to the same `bin/git`), so no separate helper-script dispatch is needed for this
sequence — the vendored `libexec/git-core/` symlink farm is just for shape-parity with a real git
install, not functionally required here.

## Result (2026-07-10, actually run in this worktree)

**Tier V-vendored: full success.** All five steps passed, including a real root-commit:

```
init                  → "Initialized empty Git repository in .../vendoredgitspike-V-vendored-.../.git/"
rev-parse --git-dir   → ".git"
add                    → (silent success)
commit                 → "[master (root-commit) 6e12d7b] Tier V-vendored: first commit"
rev-parse HEAD         → "6e12d7bb2f3880ad806f33253a4747f7596f578a"
```

Notably, `commit` succeeded on a genuinely unborn `HEAD` (first-ever commit in a fresh repo) with
**zero special-casing** — real git has always handled that case natively. This is the exact
scenario `GitPackageSpike`'s Tier A found SwiftGit2's public API couldn't do without a patch.

**Tier S-system: reproduces #640 exactly**, in the same process, same run: `init` fails
immediately with `xcrun: error: cannot be used within an App Sandbox.`

**The first run surfaced a real, informative side note**, not a sandbox blocker: Tier V initially
failed too, but with a completely different error — `fatal: unable to access
'/opt/homebrew/etc/gitconfig': Operation not permitted`. Homebrew's git build has a compile-time
default *system* config path baked in (`/opt/homebrew/etc/gitconfig`), which sits outside the
sandbox container and is unreadable — an ordinary sandbox file-read restriction, unrelated to
`xcrun`/CLT gating. Setting `GIT_CONFIG_NOSYSTEM=1` (skip system config entirely) fixed it
immediately. A binary actually built for vendoring (statically, with no baked-in external default
paths) wouldn't hit this at all — Homebrew's build just happens to bake in a path that assumes a
normal, non-sandboxed Homebrew install. Worth remembering as the class of gotcha to expect when
building the real vendored binary (any compile-time default path — templates, system config,
`.gitattributes` macros — needs to either not exist or resolve inside the bundle).

## Why this succeeds where Apple's git fails

`/usr/bin/git`'s failure is specific to Apple's own toolchain distribution: the error text
(`xcrun: error: ...`) is characteristic of Xcode Command Line Tools' license-gating IPC, which
Apple's own dev-tools binaries (git, clang, swift, etc.) are wired into regardless of what
`file`/`strings` reports about the binary itself (see #640's own investigation, which ruled out a
literal xcrun *stub* but still hit an xcrun-originated error). That gate is not a general "App
Sandbox blocks all subprocess exec" rule — sandboxed Mac apps routinely bundle and exec their own
helper tools (that's the *entire premise* of Option 1). A git binary with no relationship to
Apple's CLT distribution simply never touches that gate.

## Comparison with GitPackageSpike (Option 2)

| | Option 1: vendored git binary | Option 2: SwiftGit2 (in-process) |
|---|---|---|
| Sandbox result | ✅ full success, no patch needed | ✅ success, but needs a ~15-line patch for first-commit ([SwiftGit2/SwiftGit2#174](https://github.com/SwiftGit2/SwiftGit2/issues/174), open since 2020) |
| Unborn-HEAD first commit | Works natively — real git has always handled this | Requires the patch above |
| Feature parity | Full real git (SSH, hooks, worktrees, LFS if ever needed) | Whatever SwiftGit2's API surface covers; SSH untested/likely absent in the pinned fork |
| Ongoing maintenance surface | A vendored binary + build/update pipeline (like `container-image`/`container-kernel` already are) | A patch carried against a small (8★), single-maintainer Swift binding |
| Integration shape | Subprocess — `ProcessSupervisor`/`GitInitRunner`/`NativeContentOperations` keep their current shape almost unchanged (just point at a bundled path instead of `/usr/bin/git`) | Rewrite of every git call site to libgit2 API calls |
| Gotchas found | Compile-time default paths (system gitconfig) must be neutralized for a sandboxed bundle | Public API gap on unborn HEAD |

## Follow-ups if this direction is pursued for real

1. Don't ship Homebrew's build as-is — it bakes in `/opt/homebrew` assumptions (system config
   path, likely others under load). Build git from source with `--prefix` pointed at a bundle-
   relative path (or otherwise verify no other baked-in absolute paths survive), the way
   `Resources/container-image/`, `Resources/container-kernel/` are already vendored via
   `scripts/vendor-container-image.sh`/`scripts/vendor-container-kernel.sh`.
2. Confirm this on a signed build with the actual `io.dwk.anglesite` bundle id / provisioning,
   not just ad-hoc.
3. `NativeContentOperations`/`GitInitRunner` already shell out via `ProcessSupervisor` with an
   injected `executable: URL` — swapping `/usr/bin/git` for a bundled path is a small, contained
   change to those call sites, not a rewrite.
4. Binary size/build-time cost: a statically-linked git (with zlib/pcre2/iconv/gettext) adds
   real weight to the app bundle — worth measuring against SwiftGit2's compiled-libgit2 footprint
   (`Spikes/GitPackageSpike` already builds that for comparison).
5. Licensing: git is GPLv2. Bundling a GPLv2 binary inside a Mac App Store app has real license
   implications (distribution terms, source-availability obligations) that need review before
   this direction is chosen for real — unlike SwiftGit2/libgit2, which is MIT/GPLv2-with-linking-
   exception respectively and was already the less legally-encumbered path.
