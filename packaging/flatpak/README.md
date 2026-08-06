# Flatpak packaging for AnglesiteLinux

**Status: unverified scaffold.** This directory was added to resolve the cross-platform port
design's [§12 open question](../../docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md#12-open-questions-deferred-non-blocking)
about the Flatpak sandbox / rootless-podman interaction — see
[`docs/superpowers/specs/2026-08-06-flatpak-packaging-investigation.md`](../../docs/superpowers/specs/2026-08-06-flatpak-packaging-investigation.md)
for the design rationale. It has **not** been built or run: no `flatpak`, `flatpak-builder`,
`podman`, or GTK4/libadwaita/webkitgtk toolchain was available in the environment this was
written in.

## Files

- `io.dwk.anglesite.linux.yml` — the `flatpak-builder` manifest.
- `io.dwk.anglesite.linux.desktop` — desktop entry.
- `io.dwk.anglesite.linux.metainfo.xml` — AppStream metadata (placeholder release entry).
- `icons/io.dwk.anglesite.linux.svg` — placeholder app icon, not final brand art.

## Before trusting this manifest, verify on a real Linux box

1. Install Flatpak + `flatpak-builder`, and add Flathub for the `org.gnome.Platform`/
   `org.gnome.Sdk` runtime and the `org.freedesktop.Sdk.Extension.swift6` extension:
   ```sh
   flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
   flatpak install flathub org.gnome.Platform//50 org.gnome.Sdk//50 org.freedesktop.Sdk.Extension.swift6
   ```
   Confirm the runtime/extension version numbers above are still current — they weren't verified
   against a real install.
2. Build the edit overlay first (the manifest installs its output, but doesn't build it —
   building it needs npm, which a real Flathub-submittable build can't reach; see the manifest's
   own comment on this):
   ```sh
   scripts/build-overlay.sh
   ```
3. From the repo root:
   ```sh
   flatpak-builder --user --install --force-clean \
     packaging/flatpak/build-dir packaging/flatpak/io.dwk.anglesite.linux.yml
   ```
4. `flatpak run io.dwk.anglesite.linux`, open a `.anglesite` package via the folder picker, and
   confirm the preview actually boots — this exercises the two unverified risks the investigation
   doc calls out: whether the document-portal-picked path resolves for the host-side podman
   bind-mount (§6), and whether `podman run -d` boots promptly through `flatpak-spawn --host`
   rather than hanging (§5).

## Known gaps (see the investigation doc §8-9 for the full list)

- No CI lane builds this manifest yet.
- No path exists yet for an end user to obtain the `localhost/anglesite-dev:latest` image this
  app requires — today it's only produced by a developer running
  `scripts/build-podman-image.sh` against a sibling checkout.
- No MIME-type association for `.anglesite` packages is registered (Linux has no direct
  equivalent of macOS's `io.dwk.anglesite.site` package UTI without a separate
  `shared-mime-info` XML registration) — "Open Site…" via the in-app folder picker works
  regardless; double-click-to-open from a file manager doesn't yet.
- Icon is a placeholder, not final brand art.
- Not submitted to Flathub — this is a locally-buildable manifest only.
