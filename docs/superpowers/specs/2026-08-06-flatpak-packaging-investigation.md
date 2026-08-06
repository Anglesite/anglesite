# Investigation: Flatpak packaging for `AnglesiteLinux`

**Date:** 2026-08-06
**Issue:** [#567 — Cross-platform P2: Linux MVP](https://github.com/Anglesite/Anglesite/issues/567), last checklist item
**Resolves:** cross-platform port design §12 open question — "Flatpak sandbox vs.
rootless-podman-from-Flatpak interaction (may require `flatpak-spawn` or a host-side helper;
investigate at Linux MVP)"
**Status:** Investigation complete; recommended design implemented in this PR for the
sandbox/podman interaction and resource bundling. Manifest scaffold added but **not yet built or
run** — no `flatpak-builder`/GTK toolchain is available in this environment (see §9). CI lane and
end-user image distribution are explicitly deferred (§8).

## 1. Where things stand

`AnglesiteLinux` (`Sources/AnglesiteLinux/`) is a GTK4/libadwaita executable (via
[adwaita-swift](https://codeberg.org/aparoksha/adwaita-swift)) with a WebKitGTK preview. It talks
to `PodmanContainerControl` (`Sources/AnglesiteCore/Platform/PodmanContainerControl.swift`), which
drives rootless podman **entirely as CLI subprocess invocations** through `ProcessSupervisor` (one
exception: `podman run -d`, which bypasses `Process` for a `conmon`-hang workaround via raw
`posix_spawn` — see that function's doc comment). There is no dependency anywhere on the podman
REST/unix-socket API, which simplifies this investigation to a single question: **can the app exec
`podman` at all from inside a Flatpak sandbox**, not "can it reach a socket."

`AnglesiteLinux` is gated behind `ANGLESITE_LINUX_SHELL=1` in `Package.swift` and excluded from the
default Linux CI leg (`swift:6.3.3-noble` lacks libadwaita ≥ 1.7 and webkitgtk-6.0 dev headers) —
Package.swift's own comment names a Flatpak-based CI lane as the thing that unblocks that. This doc
doesn't build that lane (§8); it resolves the sandbox-interaction design question a CI lane and a
real manifest both depend on.

## 2. Why this is hard: Flatpak's sandbox vs. a CLI-driven container runtime

A Flatpak app runs inside `bubblewrap` (`bwrap`) — a private mount/PID/user namespace with no
general ability to exec arbitrary host binaries. `podman` is not (and should not be) installed
inside that sandbox: rootless podman itself creates user namespaces and manages `pasta`
network-namespace plumbing, cgroups, and `$XDG_RUNTIME_DIR/containers` state that assume it's
running as a normal host process for the user's session — nesting a second layer of user-namespace
creation inside `bwrap`'s own is exactly the "rootless-in-rootless" problem Flatpak's sandbox is
designed to prevent, and is not realistically viable for this app to take on.

So the question is how a sandboxed `AnglesiteLinux` reaches the **host's** already-installed
podman.

## 3. Options considered

**a. `flatpak-spawn --host` (recommended, implemented in this PR).** Flatpak ships a CLI,
`flatpak-spawn`, that sandboxed apps can call to run a command outside the sandbox via the
`org.freedesktop.Flatpak` D-Bus portal — the manifest declares `--talk-name=org.freedesktop.Flatpak`
in `finish-args`, and the app runs `flatpak-spawn --host podman <args>` in place of `podman <args>`.
This is the established pattern for exactly this class of problem: VS Code's Flatpak build uses it
(directly or via the community `host-spawn` reimplementation) to let the Dev Containers extension
reach host podman/docker, and it needs no `--filesystem=host` grant — the command crosses the
sandbox boundary over D-Bus, not a widened filesystem view. Cost: `flatpak-spawn --host` can run
*any* host command the manifest's `--talk-name` unlocks, not just `podman` — Flatpak has no
built-in per-command allowlist for this yet ([flatpak/flatpak#5538](https://github.com/flatpak/flatpak/issues/5538)
is an open feature request for one). That's a real, if usual-for-this-pattern, widening of what a
compromised app process could do; noted here rather than glossed over.

**b. Bundle a `podman-remote` client, expose the host's podman API socket.** VS Code's Flatpak
ecosystem also has a companion extension (`com.visualstudio.code.tool.podman`) that ships
`podman-remote` inside the sandbox and talks to the host's podman REST socket via a narrower
filesystem grant (e.g. `--filesystem=xdg-run/podman:create`) instead of the broader "any host
command" surface of (a). This is a **materially bigger change** for `PodmanContainerControl` than
(a): its whole design is built around the plain CLI's argv shape (`podman run -d ...`, `podman exec
... sh -lc ...`), and `podman-remote` doesn't support every one of those verbs identically (notably,
detached long-running `exec` process management and the `conmon`-detach behavior this file already
works around would need to be re-verified against the remote client's process model). It also
requires the host to have `podman.socket` active (`systemctl --user enable --now podman.socket`),
which rootless podman doesn't enable by default — an extra host-side setup step for every user,
which the current CLI-driven design avoids entirely. Rejected **for this phase**: worth
reconsidering only if Flathub review pushes back on `--talk-name=org.freedesktop.Flatpak`'s breadth
(see the open item in §9).

**c. A host-side systemd/D-Bus helper service, installed separately (deb/rpm/etc.).** Narrowest
possible sandbox surface, but requires a second install step outside the Flatpak (`sudo apt install
anglesite-helper` or similar) before the app works at all — directly against
`docs/linux-assed-app-spec.md` §6's "do not tell users to weaken sandboxing... to compensate for
packaging defects" *and* its adjacent expectation that the packaged app is the whole product
surface. Rejected.

**Decision: (a), `flatpak-spawn --host`.** It's the precedent other GUI-apps-that-drive-podman
already use, requires no changes to `PodmanContainerControl`'s command construction beyond a
prefix, and needs no additional host-side setup. The broader-permission cost in (a) is accepted for
now and flagged for Flathub review (§9) rather than solved speculatively — narrowing to (b) is a
mechanical follow-up if it turns out to matter, not a redesign.

## 4. Implemented: routing podman invocations through `flatpak-spawn --host`

`PodmanContainerControl` gained:

- `flatpakHostSpawn: Bool`, defaulting to `ProcessInfo.processInfo.environment["FLATPAK_ID"] !=
  nil` — `FLATPAK_ID` is the documented, stable env var Flatpak sets for every process running
  inside one of its sandboxes (also used by `flatpak-spawn` itself and countless sandboxed apps to
  self-detect). Injectable so tests can force either path.
- `flatpakSpawnExecutable: URL`, defaulting to `/usr/bin/flatpak-spawn` — kept as its own
  injectable parameter (the same "common-path default, overridable" shape as `podmanExecutable`)
  rather than hardcoded inline, so tests exercise the actual injection seam instead of just
  matching a coincidental default.
- `podmanInvocation(_ arguments: [String]) -> (executable: URL, arguments: [String])` — the single
  seam every podman call now routes through. Outside a sandbox it's a passthrough
  (`podmanExecutable`, unchanged args). Inside one, it rewrites to
  `(flatpakSpawnExecutable, ["--host", podmanExecutable.path] + arguments)`.

Every call site that used to pass `podmanExecutable` straight to `ProcessSupervisor.run`/`.launch`
(the boot-time `spawnDetachedPodmanRun`, `exec`/`execInteractive`, `execOneShot`, `resolvedHostPort`,
`stopContainer`) now resolves through `podmanInvocation` first. No call site needed its own
sandbox-awareness — the rewrite is centralized. Two unit tests
(`PodmanContainerControlTests.podmanInvocationPassesThroughOutsideFlatpak` /
`...RoutesThroughFlatpakSpawn`) cover the pure argv rewrite, but **don't currently run in CI** —
`AnglesiteCoreTests` isn't in `Package.swift`'s off-Darwin `portableTargets` filter, so the whole
target (and this file's own `#if canImport(Glibc)` gate) never builds in either the Linux or
macOS CI leg today. Pre-existing, not introduced by this PR (see §9) — tracked as a follow-up in
[#1284](https://github.com/Anglesite/Anglesite/issues/1284) rather than left as only a PR-footnote
disclosure, since it means `podmanInvocation`'s rewrite logic is currently unverified by any CI
run, only reviewed by hand.

The manifest (`packaging/flatpak/io.dwk.anglesite.linux.yml`, §7) grants exactly
`--talk-name=org.freedesktop.Flatpak` for this — no `--filesystem=host`.

## 5. Unverified risk: does the `conmon`-detach workaround survive `flatpak-spawn`?

`start()`'s step 1 (`podman run -d`) deliberately bypasses `ProcessSupervisor`/Foundation's
`Process` via raw `posix_spawn`+`waitpid`, because `conmon` (podman's forked monitor process,
which outlives the `podman` CLI invocation) was empirically found to hang `Process.waitUntilExit()`
on Linux. That workaround was verified against a **direct** `podman run -d` child process.

Under Flatpak, the locally-spawned process is `flatpak-spawn`, not `podman` itself —
`flatpak-spawn --host podman run -d ...` makes a D-Bus call to the host-side `org.freedesktop.Flatpak`
service, which executes `podman run -d` as a child of a *different* process tree (the portal /
session-helper), then streams that remote process's stdout/stderr/exit-status back to the local
`flatpak-spawn` process, which exits once the **host podman CLI invocation** (not `conmon`) exits.
This is architecturally the same "the daemonizing grandchild doesn't hold the exit-detecting
process open" shape the current `posix_spawn` workaround exploits, since `flatpak-spawn` sits
locally in exactly the position `podman` itself used to. It should carry over unchanged, but this
is inference, not verification — the existing code's own convention is to say "verified
empirically" only after testing against a real process tree, and this PR can't do that: no
`flatpak`, `flatpak-builder`, `podman`, or GTK toolchain is available in the environment this
investigation was written in (§9). **Needs a live check on a real Flatpak-packaged build before
this is trusted.** If it doesn't hold, the fix is mechanical: apply the same raw
`posix_spawn`+`waitpid` bypass to `flatpak-spawn` instead of `podman` directly — the code path
already isolates this to `spawnDetachedPodmanRun`'s one caller.

## 5b. Unverified risk: does interactive `exec` stdio survive `flatpak-spawn --host`?

`execInteractive` launches `podman exec -i` as a long-running supervised process with
`attachStdin: true` — the ACP-style path that keeps writing to the process's stdin after launch
(`PodmanContainerControl.execInteractive`, and `InteractiveExecHandle.write`). Once routed through
`podmanInvocation`, this becomes `flatpak-spawn --host podman exec -i ...`, which — unlike the
one-shot `run -d`/`exec`/`port`/`stop` calls elsewhere in this file — depends on stdio staying
live and bidirectional for the whole session, not just an exit code and captured output.

`flatpak-spawn --host` proxies the child over a D-Bus call to `org.freedesktop.Flatpak` rather
than being a direct local child process — a different I/O path than the one `ProcessSupervisor`
was built against. Flatpak's own documentation says stdio is forwarded by default, so this should
work, but per this doc's own standard for §5/§6 ("this is inference, not verification"), that
claim hasn't been exercised here: no live Flatpak+podman environment was available to open an
actual interactive `exec` session and confirm writes/reads round-trip correctly (latency, buffering,
and EOF-on-terminate behavior are all plausible places a D-Bus-proxied pipe could diverge from a
direct one). Added to the §9 verification checklist below.

## 6. Unverified risk: does the sandboxed app's picked-folder path resolve on the host?

`AnglesiteLinuxApp`'s "Open Site…" button uses Adwaita's `.folderImporter`, which — like every
GTK4 file chooser running inside a Flatpak sandbox — transparently routes through the
`org.freedesktop.portal.FileChooser` portal rather than a raw dialog, so no `--filesystem=host`
grant is needed for the picker itself (this already matches `docs/linux-assed-app-spec.md` §4's
portal expectation, no change needed). The portal grants the sandboxed process access to the
picked path through `xdg-document-portal`'s FUSE filesystem, typically surfaced at
`/run/user/$UID/doc/<id>/<name>` — a real path visible *inside* the sandbox.

`PodmanContainerControl.start()` then bind-mounts that path into the container:
`-v "\(cloneSource.path):/run/anglesite-source:ro"`. Under `flatpak-spawn --host`, podman itself
runs as a normal host process (outside the sandbox) — the question is whether the **document
portal's FUSE path is visible to that host process** at all, since `xdg-document-portal` is itself
a host/system service (not sandbox-namespace-scoped), so in principle a same-session host process
should see the same `/run/user/$UID/doc/...` mount non-sandboxed processes already do. This is
plausible but **not verified** here — no live Flatpak+podman environment was available to test the
actual bind-mount succeeding end-to-end.

Two fallbacks if it doesn't hold, to try in this order when a real Flatpak build is verified:

1. Have the app resolve the **real** host path for a document-portal file via
   `org.freedesktop.portal.Documents`'s host-path-resolution affordances (available to processes
   with the right access) instead of passing the FUSE path to `podman -v`.
2. If that's not viable, scope a narrower `--filesystem=` grant to a known Sites directory (e.g.
   `xdg-data/anglesite/Sites:create`, mirroring how the macOS app defaults new sites into an
   app-owned location) so at least the common "new site" path never needs the document portal's
   FUSE indirection, while `.folderImporter`-picked sites elsewhere keep depending on (1).

This risk is independent of §5 and should be tested first, since a failed bind-mount blocks the
Exit Criterion entirely (open → edit → preview), while a `conmon`-detach hang is "boot is slow" at
worst.

## 7. Implemented: resource bundling + the manifest scaffold

`ShellModel.overlaySource` used to resolve the edit-overlay JS from a `cwd`-relative
`"Resources/edit-overlay/overlay.js"` — meaningless once the binary runs from `/app/bin/` inside a
Flatpak install. It now tries, in order: `ANGLESITE_OVERLAY_JS` env override (dev loop unchanged);
`/app/share/anglesite/edit-overlay/overlay.js` (the Flatpak-installed location, below); then the
original cwd-relative path (unpackaged dev builds run from the repo root). A missing overlay stays
non-fatal in every case, matching the existing behavior.

`packaging/flatpak/` (new) holds:

- `io.dwk.anglesite.linux.yml` — the `flatpak-builder` manifest. Modeled directly on
  [adwaita-swift's own template manifest](https://codeberg.org/aparoksha/adwaita-template/raw/branch/main/io.github.AparokshaUI.AdwaitaTemplate.json)
  (`AparokshaUI/adwaita-swift`'s reference app), since it's a real, working precedent for this
  exact stack (Swift + libadwaita via `adwaita-swift` + a GNOME runtime, built with
  `swift build --static-swift-stdlib`). Confirmed `org.gnome.Platform` bundles WebKitGTK
  (`libwebkitgtk-6.0`), so `org.gnome.Sdk` should carry the `webkitgtk-6.0` pkg-config dev files
  `CWebKitGTK`'s system-library target needs — no separate WebKit module required. Differences
  from the adwaita-swift template: adds `--talk-name=org.freedesktop.Flatpak` (§4) and
  `--share=network` (the app itself, not just podman, needs a network namespace so its own
  WebKitGTK preview and HTTP client can reach podman's host-loopback-published ports — this is a
  functional requirement of a live-preview browser, not a sandboxing shortcut for a packaging
  defect). Like `--talk-name=org.freedesktop.Flatpak` (§3(a)), this is a real, broader-than-
  strictly-needed grant, not a free one: Flatpak has no loopback-only network permission, so
  `--share=network` gives the sandboxed WebKitGTK/HTTP-client process unrestricted outbound
  network access generally, not just reachability to `127.0.0.1:4321`/`4399`. Accepted for the
  same reason as `--talk-name` — no narrower Flatpak primitive exists for this — and worth the
  same Flathub-review scrutiny that permission gets (§9); installs `overlay.js` to
  `/app/share/anglesite/edit-overlay/overlay.js` (§ above); and builds the `anglesite-linux`
  product instead of a generic template binary.
- `io.dwk.anglesite.linux.desktop` — reuses the app ID already chosen in code
  (`AdwaitaApp(id: "io.dwk.anglesite.linux")`, `AnglesiteLinuxApp.swift`), so no new identifier is
  introduced.
- `io.dwk.anglesite.linux.metainfo.xml` — minimal AppStream metadata (summary/description drawn
  from `README.md`'s own framing, ISC license per `LICENSE`).
- `icons/io.dwk.anglesite.linux.svg` — a placeholder lettermark, not final brand art (§9).
- `README.md` — states the scaffold's unverified status up front and lists the manual steps a
  GTK-provisioned Linux box needs to run to actually build and smoke-test it.

## 8. Explicitly deferred (not attempted in this PR)

Consistent with the design doc's own "Open questions (deferred, non-blocking)" framing for items
that don't block the phase they're filed under:

- **End-user dev-server image distribution.** `PodmanContainerControl` boots
  `localhost/anglesite-dev:latest`, which today only exists after a developer runs
  `scripts/build-podman-image.sh` against a sibling MCP-sidecar checkout
  (`scripts/lib/stage-dev-image-context.sh`). A Flathub end user has neither the sibling repo nor
  a reason to run a build script. Closing this gap needs its own design decision (pull a
  registry-hosted image, mirroring the already-existing `ghcr.io/anglesite/anglesite-devserver`
  pipeline in `scripts/build-container-image.sh`, vs. vendoring a prebuilt OCI layout the way
  macOS's `Resources/container-image/` does) and is a large enough change to warrant its own
  tracked issue rather than folding it into this one silently.
- **A Flatpak-based CI lane.** Package.swift's own comment names this as the blocker for
  un-gating `AnglesiteLinux` from `ANGLESITE_LINUX_SHELL=1` in the default Linux CI leg. Building
  one (and deciding whether it also becomes the `PodmanContainerControlTests`/`AnglesiteCoreTests`
  Linux runner — see the CI-target gap noted in §4) is follow-up work once the manifest itself is
  live-verified per §9's checklist.
- **Actual Flathub submission and review.** Everything here targets a locally-buildable
  `flatpak-builder` manifest, not a submitted-and-reviewed Flathub listing (icon art, screenshots,
  a stable release/update channel, and Flathub's own manifest-review process — including likely
  scrutiny of `--talk-name=org.freedesktop.Flatpak`'s breadth, see §3(b) — all still need to
  happen).

## 9. What still needs a real Flatpak/podman/GTK environment to verify

This investigation was written in a container with no `flatpak`, `flatpak-builder`, `podman`, or
GTK4/libadwaita/webkitgtk dev headers available — the same constraint Package.swift's own comment
already documents for `AnglesiteLinux` itself ("a GTK-provisioned Linux box is the real
verification"). Before treating this design as load-bearing, a real Ubuntu/Fedora box with Flatpak
+ podman installed needs to:

1. `flatpak-builder --user --install --force-clean build-dir packaging/flatpak/io.dwk.anglesite.linux.yml`
   and confirm it actually builds (Swift SDK extension version, GNOME runtime version, and
   webkitgtk-6.0 pkg-config availability are all inferred from the adwaita-swift precedent and web
   research in this doc, not confirmed against this repo's exact dependency pins).
2. Run the installed Flatpak, open a `.anglesite` package via the folder picker, and confirm the
   bind-mount in §6 actually works end-to-end (this is the highest-priority unknown — it blocks
   the Exit Criterion entirely if it fails).
3. Confirm `podman run -d` boots promptly through `flatpak-spawn --host` (§5) rather than hanging.
4. Confirm the overlay JS actually loads from `/app/share/anglesite/edit-overlay/overlay.js` (§7).
5. Open an interactive `exec` session (the ACP-agent path, `PodmanContainerControl.
   execInteractive`) and confirm stdin writes and stdout/stderr reads round-trip correctly through
   `flatpak-spawn --host` for the life of the session, not just at launch/exit (§5b).

None of this PR's Swift changes are behind a new feature flag — `flatpakHostSpawn` only activates
when `FLATPAK_ID` is set, which is never true outside an actual Flatpak sandbox, so the existing
non-Flatpak (bare Linux, direct `podman` on PATH) path is unchanged and already covered by
`PodmanContainerControlIntegrationTests`.
