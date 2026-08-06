import Foundation
import AnglesiteCore

/// Owns the site lifecycle behind the Linux shell: open a `.anglesite` package, compose the
/// Linux runtime stack (`LocalContainerSiteRuntime` over `PodmanContainerControl`, per the
/// cross-platform port design §7 and #647), and hand the UI everything it needs to render the
/// preview and route overlay edits. One site at a time, matching the one-window MVP — opening
/// a second package stops the first site's container.
///
/// An `actor`, not `@MainActor`: `current`/`inFlightStop` are mutated from GTK callbacks *and*
/// detached tasks, so they need real isolation — and on Linux `MainActor` rides the libdispatch
/// main queue, which a GTK app's `g_main_loop`-parked main thread never drains, so main-actor
/// work would starve. Actor isolation runs on the cooperative pool and is prompt regardless of
/// what the main thread is doing.
///
/// UI-free by design: state reaches the shell through `SiteRuntime.observe()`, which the app
/// layer drains and marshals onto the GTK main loop itself (`Idle`).
actor ShellModel {
    struct OpenedSite {
        let displayName: String
        let siteID: String
        let runtime: LocalContainerSiteRuntime
        let router: MCPApplyEditRouter
    }

    private var current: OpenedSite?

    /// The chain of not-yet-finished `runtime.stop()` calls from previous opens. Kept (rather
    /// than fire-and-forgotten) for two reasons: `stopCurrent()` awaits it so process exit
    /// can't race past an in-flight teardown and leak that container, and each new site's
    /// `start()` is gated on it so re-opening the *same* package can't hit a podman
    /// container-name collision with its own not-yet-removed predecessor.
    private var inFlightStop: Task<Void, Never>?

    /// Reads the package marker (site identity, #242), stops any previously-open site, and
    /// kicks off the container boot. Returns as soon as identity is known — `start()` runs
    /// detached (gated on the previous teardown) and the caller watches `runtime.observe()`
    /// for `.starting` → `.ready`/`.failed`.
    func open(packageURL: URL) throws -> OpenedSite {
        let package = AnglesitePackage(url: packageURL)
        let marker = try package.readMarker()

        if let previous = current {
            let priorStops = inFlightStop
            inFlightStop = Task {
                await priorStops?.value
                await previous.runtime.stop()
            }
        }

        let client = MCPClient(supervisor: .shared)
        let runtime = LocalContainerSiteRuntime(
            ref: "HEAD",
            control: PodmanContainerControl(),
            mcpClient: client
        )
        let site = OpenedSite(
            displayName: marker.displayName,
            siteID: marker.siteID.uuidString,
            runtime: runtime,
            router: MCPApplyEditRouter(mcpClient: { client })
        )
        current = site

        let sourceURL = package.sourceURL
        let stopGate = inFlightStop
        Task {
            await stopGate?.value
            await runtime.start(siteID: site.siteID, siteDirectory: sourceURL)
        }
        return site
    }

    /// Stops the open site's container, if any, after draining any earlier in-flight
    /// teardowns. Called on window close and on SIGINT/SIGTERM so quitting the shell never
    /// leaks a running podman container (`podman stop` on a `--rm` container tears the whole
    /// guest down, astro/MCP included) — even when the quit lands mid-site-switch.
    func stopCurrent() async {
        await inFlightStop?.value
        inFlightStop = nil
        guard let site = current else { return }
        current = nil
        await site.runtime.stop()
    }

    /// The edit-overlay JS to inject into the preview. On macOS this rides the app bundle
    /// (`AnglesiteOverlayBundle`); on Linux resolution tries, in order: `ANGLESITE_OVERLAY_JS`
    /// env override (dev loop); `/app/share/anglesite/edit-overlay/overlay.js`, the path the
    /// Flatpak manifest installs it to (`packaging/flatpak/io.dwk.anglesite.linux.yml` — see
    /// docs/superpowers/specs/2026-08-06-flatpak-packaging-investigation.md §7), tried only when
    /// `FLATPAK_ID` indicates a Flatpak sandbox — same detection `PodmanContainerControl.
    /// flatpakHostSpawn` uses, so a stray `/app` directory on a non-Flatpak Linux box can't
    /// silently shadow the dev-relative fallback below it; then the repo-relative
    /// `scripts/build-overlay.sh` output beside the binary's cwd, for an unpackaged dev build run
    /// from the repo root. Missing overlay is non-fatal — the preview loads without edit
    /// affordances, matching `WebViewBridge`'s behavior when the bundle wasn't produced.
    static func overlaySource(environment: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        let candidates = [
            environment["ANGLESITE_OVERLAY_JS"],
            environment["FLATPAK_ID"] != nil ? "/app/share/anglesite/edit-overlay/overlay.js" : nil,
            "Resources/edit-overlay/overlay.js",
        ]
        for case let path? in candidates {
            if let source = try? String(contentsOf: URL(fileURLWithPath: path), encoding: .utf8) {
                return source
            }
        }
        return nil
    }
}
