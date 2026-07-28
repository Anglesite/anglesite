# GitPackageSpike

Empirical harness for [#640](https://github.com/Anglesite/Anglesite/issues/640): does a
Swift-native, in-process libgit2 binding work from inside a real App Sandbox container, where
`/usr/bin/git` refuses to execute at all (`xcrun: error: cannot be used within an App Sandbox.`)?

Depends on [github.com/Anglesite/SwiftGit2](https://github.com/Anglesite/SwiftGit2) — Anglesite's
fork of [mbernson/SwiftGit2](https://github.com/mbernson/SwiftGit2), carrying the one patch this
spike's own runs proved was needed (see "Result" below and the fork's own README).

```sh
Spikes/GitPackageSpike/scripts/build-and-run.sh
```

Output lands in `results/{control,sandboxed}-result.json`.

## What it tests

One binary, run twice: once unsigned/unsandboxed as a control, once wrapped in a real `.app`
bundle, ad-hoc signed with `com.apple.security.app-sandbox` + file entitlements mirroring
`Resources/Anglesite.entitlements`, and launched via `open` — the same methodology #640's own
repro used, and required per `Spikes/ContainerSpike`'s prior finding that a bare Mach-O binary
with no real `.app` bundle makes `sandboxd` hang instead of attaching a container.

Two tiers, matching the shapes of git write this app performs:

| Tier | What it exercises | Maps to |
|---|---|---|
| A | `Repository.create` + `add` + `commit(message:signature:)` on a **brand-new, unborn-HEAD repo**, using the *unmodified* public API — the fork's patch lives inside `commit(message:signature:)` itself, so callers don't do anything differently | `NativeContentOperations.processGitCommit`'s *first-ever* call for a freshly scaffolded site (see "Does SiteScaffolder avoid this?" below) |
| B | `add` + `commit` on a repo **pre-seeded with one commit** (via real `git`, run unsandboxed by the driver script, before the sandboxed binary launches) | `NativeContentOperations.processGitCommit` — every commit *after* a site's first, which already has history |

Tier B's repo is pre-seeded *outside* the sandbox because the sandboxed binary's own git writes
are exactly what's under test — seeding it via a subprocess `git` call from inside the sandboxed
process would just re-trigger #640's bug. Pre-seeding works because the sandbox container
directory (`~/Library/Containers/<bundle-id>/Data/tmp/`) is an ordinary folder any process
running as the same user can write to ahead of time; the sandbox only restricts what the
*sandboxed app itself* can reach at runtime, not what set up its container beforehand.

Since a GUI-launched (`open`) process has no attached terminal, the binary writes a JSON result
array to `FileManager.default.temporaryDirectory` (which resolves inside the sandbox container
when sandboxed) instead of printing to stdout; the driver script polls for that file and prints
it back out.

## Does `SiteScaffolder` avoid the unborn-HEAD case?

No — checked directly. [`SiteScaffolder.runPipeline`](../../Sources/AnglesiteCore/SiteScaffolder.swift)
runs `git init` (step 2b) and then only writes files to the working tree — theme, homepage, logo,
`.site-config` — it never commits. [`scaffold.sh`](../../Resources/Template/scripts/scaffold.sh)
is a plain `rsync` of the template tree; it doesn't touch git at all. So a freshly scaffolded site
has an initialized-but-commit-less repo until the owner's *first* New Post/Page/Component, at
which point [`NativeContentOperations.processGitCommit`](../../Sources/AnglesiteCore/NativeContentOperations.swift#L374)
runs `git commit` against a genuinely unborn `HEAD`. Real `/usr/bin/git` handles that transparently
(it's normal git behavior — nobody special-cased it because there was nothing to special-case), so
this gap only exists in SwiftGit2's *public* API surface, not in the app's design.

**Pre-baking a `.git` into `Resources/Template/` (the "repo already initialized in the template"
idea) doesn't fix this and adds a real footgun**: `Resources/Template/` is itself tracked inside
Anglesite's own git repo, and a nested `.git/` directory under a tracked tree is a gitlink/
submodule boundary — clones, CI, and diff tooling won't reproduce it the way a plain file would.
It also wouldn't remove the need for an unborn-HEAD-safe commit: `gitInit` runs *before* the
theme/homepage/logo/config writes, so even with a pre-baked initial commit, that first real
content-write would still need to land as a new commit on top — Tier A's problem just moves to a
different commit, it doesn't disappear. Every scaffolded site would also end up sharing byte-
identical initial-commit objects, which is a smell of its own.

## Prior art: this was a known, long-open upstream bug

[SwiftGit2/SwiftGit2#174 "First commit in an empty repo."](https://github.com/SwiftGit2/SwiftGit2/issues/174)
(filed 2020-06-03, still open upstream) is the exact same bug, same error string
(`reference 'refs/heads/master' not found`). Two things from that thread carried forward into the
real fix:

- A 2020-08-22 comment independently landed on the same workaround this investigation considered
  and rejected — "copying an initialized repo into the folder" — so it's a known, if awkward,
  community pattern, not something dismissed unfairly here.
- A 2020-10-07 comment from `stevengharris` had the fix's actual shape: patch
  `commit(message:signature:)` itself to detect a zero `parentID` OID (i.e. unborn HEAD) after
  `git_reference_name_to_id` fails, and fall through to `commit(tree:parents:[],...)` in that
  case. That keeps the existing public API surface unchanged — callers keep calling
  `commit(message:signature:)` exactly as before. No PR was ever opened against the issue in the
  5 years since; [Anglesite/SwiftGit2@d06cd7e](https://github.com/Anglesite/SwiftGit2/commit/d06cd7e5e2c5cc83d69fcb9d9beac51a53fc9014)
  applies that exact shape as a real patch, on Anglesite's fork.

## Result (2026-07-10, actually run in this worktree)

**Both tiers succeed, in the real signed, sandboxed `.app`, against the unmodified public API:**

- **Tier A (fresh repo, first commit)**: `create` → `add` → `commit(message:signature:)` → `HEAD`
  all succeed — a real root commit, zero parents, `HEAD` resolving to `refs/heads/master`. Before
  the fork's patch landed, this step failed identically in both an unsandboxed control run and
  the signed sandboxed run (`reference 'refs/heads/master' not found` / `'refs/heads/main' not
  found`) — same failure in both, which was itself the useful earlier signal that the gap was a
  **binding limitation, not a sandbox effect**: SwiftGit2's public `commit(message:signature:)`
  called `git_reference_name_to_id(..., "HEAD")` unconditionally, which errors on an unborn
  branch, even though the low-level `commit(tree:parents:message:signature:)` overload never
  needed HEAD to exist at all (`git_commit_create` creates the first ref from scratch — that's how
  `git commit` on an empty repo has always worked at the libgit2 level).
- **Tier B (commit onto existing history)**: `open-preseeded-repo` → `add` → `commit-with-parent`
  → `HEAD-after-commit` all completed normally, producing a real commit object (correct oid, tree,
  parent chain, author/committer) and a `HEAD` resolving to `refs/heads/main`. This covers the
  majority real-world path — every commit after a site's first is onto existing history — and
  confirms the core #640 hypothesis: an in-process libgit2 binding has no subprocess to trip App
  Sandbox's container-init block, unlike `/usr/bin/git`.

Raw output in `results/{control,sandboxed}-result.json`.

## Follow-ups if this direction is pursued for real

1. Confirm this on a signed build with the actual `io.dwk.anglesite` bundle id / provisioning,
   not just ad-hoc.
2. Consider upstreaming the fork's patch to `mbernson/SwiftGit2` as a real PR (small,
   self-contained, no API breaks) rather than only carrying it on Anglesite's fork indefinitely —
   would reduce the fork-maintenance surface. Not required before adopting the fork; the fork
   README documents the patch and links back to the upstream issue for whoever eventually does.
3. Push/fetch over HTTPS with a token (for `RepoBootstrap`'s "Publish to GitHub" flow) isn't
   exercised here — SwiftGit2's `Remotes.swift`/`Credentials.swift` look adequate but are
   unverified by this spike.
4. #640's Option 1 (a vendored, non-Apple git binary run as a subprocess) was also spiked — see
   `../VendoredGitSpike` — and worked with *no* binding patch needed at all, but raises a GPLv2
   distribution question for a Mac App Store app that this option (MIT SwiftGit2 / GPLv2-with-
   linking-exception libgit2) doesn't. That trade-off was the deciding factor for picking this
   direction — see the issue/PR discussion for the full comparison.
