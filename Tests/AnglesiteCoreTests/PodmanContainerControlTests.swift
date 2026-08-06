// Unit tests for PodmanContainerControl's pure helpers. Gated the same as the type under test —
// podman-driven containers are Linux-only (cross-platform port design §7).
#if canImport(Glibc)
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("PodmanContainerControl")
struct PodmanContainerControlTests {
    @Test("container name prefixes and passes through a well-formed site ID")
    func containerNamePassesThroughUUID() {
        let name = PodmanContainerControl.containerName(for: "3F2504E0-4F89-11D3-9A0C-0305E82C3301")
        #expect(name == "anglesite-3F2504E0-4F89-11D3-9A0C-0305E82C3301")
    }

    @Test("container name sanitizes characters podman would reject")
    func containerNameSanitizesInvalidCharacters() {
        let name = PodmanContainerControl.containerName(for: "weird id/with:bad*chars")
        #expect(name == "anglesite-weird-id-with-bad-chars")
    }

    @Test("parses a single podman port line")
    func parseHostPortSingleLine() {
        #expect(PodmanContainerControl.parseHostPort(from: "0.0.0.0:34521\n") == 34521)
    }

    @Test("parses the first of multiple podman port lines (dual-stack publish)")
    func parseHostPortMultipleLines() {
        #expect(PodmanContainerControl.parseHostPort(from: "0.0.0.0:34521\n[::]:34521\n") == 34521)
    }

    @Test("parses a bare host:port line without a trailing newline")
    func parseHostPortNoTrailingNewline() {
        #expect(PodmanContainerControl.parseHostPort(from: "127.0.0.1:8080") == 8080)
    }

    @Test("returns nil for empty or unparseable output")
    func parseHostPortInvalidInput() {
        #expect(PodmanContainerControl.parseHostPort(from: "") == nil)
        #expect(PodmanContainerControl.parseHostPort(from: "not-a-port-line\n") == nil)
    }

    @Test("outside a Flatpak sandbox, podman invocations exec podmanExecutable directly")
    func podmanInvocationPassesThroughOutsideFlatpak() {
        let control = PodmanContainerControl(
            podmanExecutable: URL(fileURLWithPath: "/usr/bin/podman"),
            flatpakHostSpawn: false
        )
        let invocation = control.podmanInvocation(["stop", "-t", "5", "anglesite-test"])
        #expect(invocation.executable.path == "/usr/bin/podman")
        #expect(invocation.arguments == ["stop", "-t", "5", "anglesite-test"])
    }

    @Test("inside a Flatpak sandbox, podman invocations route through the injected flatpak-spawn")
    func podmanInvocationRoutesThroughFlatpakSpawn() {
        let control = PodmanContainerControl(
            podmanExecutable: URL(fileURLWithPath: "/usr/bin/podman"),
            flatpakHostSpawn: true,
            flatpakSpawnExecutable: URL(fileURLWithPath: "/some/other/prefix/bin/flatpak-spawn")
        )
        let invocation = control.podmanInvocation(["stop", "-t", "5", "anglesite-test"])
        #expect(invocation.executable.path == "/some/other/prefix/bin/flatpak-spawn")
        #expect(invocation.arguments == ["--host", "/usr/bin/podman", "stop", "-t", "5", "anglesite-test"])
    }
}
#endif
