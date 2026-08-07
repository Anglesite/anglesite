// Unit tests for ShellModel.overlayCandidates — the pure, no-I/O half of overlaySource's
// resolution logic (Flatpak packaging investigation, #567). Split into its own testTarget
// because AnglesiteLinux is only in the package graph under ANGLESITE_LINUX_SHELL=1 (see
// Package.swift's gating comment) — this file needs none of the GTK/Adwaita toolchain that
// gate exists for, but @testable import AnglesiteLinux still pulls in the whole target.
import Testing
@testable import AnglesiteLinux

@Suite("ShellModel.overlayCandidates")
struct ShellModelOverlaySourceTests {
    @Test("env override wins over every other candidate")
    func envOverrideWinsFirst() {
        let candidates = ShellModel.overlayCandidates(environment: [
            "ANGLESITE_OVERLAY_JS": "/custom/overlay.js",
            "FLATPAK_ID": "io.dwk.anglesite.linux",
        ])
        #expect(candidates.first == "/custom/overlay.js")
    }

    @Test("outside a Flatpak sandbox, the /app path is never a candidate")
    func flatpakPathAbsentOutsideSandbox() {
        let candidates = ShellModel.overlayCandidates(environment: [:])
        #expect(!candidates.contains("/app/share/anglesite/edit-overlay/overlay.js"))
        #expect(candidates == ["Resources/edit-overlay/overlay.js"])
    }

    @Test("inside a Flatpak sandbox, the /app path is tried before the dev-relative fallback")
    func flatpakPathPrecedesDevFallback() {
        let candidates = ShellModel.overlayCandidates(environment: ["FLATPAK_ID": "io.dwk.anglesite.linux"])
        #expect(candidates == [
            "/app/share/anglesite/edit-overlay/overlay.js",
            "Resources/edit-overlay/overlay.js",
        ])
    }

    static let nonOverridingEnvironments: [[String: String]] = [
        [:], ["FLATPAK_ID": "x"], ["ANGLESITE_OVERLAY_JS": "/y"],
    ]

    @Test("the dev-relative fallback is always present, last", arguments: nonOverridingEnvironments)
    func devFallbackAlwaysPresentLast(environment: [String: String]) {
        #expect(ShellModel.overlayCandidates(environment: environment).last == "Resources/edit-overlay/overlay.js")
    }
}
