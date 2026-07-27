// Linux implementation of the LocalContainerControl seam, over rootless podman — cross-platform
// port design (docs/superpowers/specs/2026-07-08-cross-platform-swift-port-design.md §7). The
// whole file compiles out on platforms without Glibc (podman-driven containers are the Linux MVP
// substrate; macOS keeps Apple Containerization).
#if canImport(Glibc)
import Foundation
import Glibc
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// `LocalContainerControl` over rootless podman, driven entirely via `ProcessSupervisor` CLI
/// invocations (no podman REST socket dependency). Uses the same OCI image + guest layout
/// `ContainerizationControl` boots on macOS — clone the site's `Source/` repo, start `astro dev`
/// (guest TCP 4321) + the Node MCP sidecar (guest TCP 4399) — but **port-mapping replaces the
/// vsock proxies**: podman publishes both guest ports directly onto host TCP, so `previewURL`/
/// `mcpURL` are plain 127.0.0.1 URLs with no bridge process in between, and the existing HTTP
/// `MCPTransport` connects unchanged.
///
/// Where Apple Containerization exec's *inside* a VM boundary it owns, this type shells out to
/// `podman exec` for every guest operation — one-shot setup (hosts/clone/checkout) via
/// `ProcessSupervisor.run`, and the two long-lived guest processes (astro/mcp) via
/// `ProcessSupervisor.launch` so their output streams through the same live-logging path every
/// other supervised process uses. Tearing down the container (`podman stop`, `--rm` auto-removes)
/// kills everything inside it — including those guest processes — so `stop()` doesn't need to
/// negotiate a graceful per-process shutdown first.
public struct PodmanContainerControl: LocalContainerControl {
    private let image: String
    private let podmanExecutable: URL
    private let supervisor: ProcessSupervisor
    private let live: LivePodmanContainers
    private let astroCommand: String
    private let mcpCommand: String
    private let logCenter: LogCenter

    private static let previewPort = 4321
    private static let mcpPort = 4399
    private static let repoSharePath = "/run/anglesite-source"
    private static let previewReadyTimeout: Duration = .seconds(90)

    /// The production astro-dev guest command: hydrate deps from the image's baked toolchain
    /// (zero-install hardlink when the cloned site's lockfile matches the template; offline-first
    /// npm ci otherwise), then serve. Matches `ContainerizationControl`'s guest command except
    /// for the bind host: rootless podman's port publishing (pasta) forwards to the container's
    /// eth0, NOT guest loopback, so a `127.0.0.1` bind (correct on macOS, where the guest-local
    /// vsock proxies dial loopback from *inside* the guest) yields connection-reset on every
    /// mapped port. Binding `0.0.0.0` here doesn't widen host exposure — `start()` publishes
    /// both ports onto host loopback (`-p 127.0.0.1::…`), and the container's own interface
    /// lives on pasta's private network. Verified live against real podman on Linux (#567,
    /// PR #662 review): `ss -tlnp` shows pasta's host-side listener bound to `127.0.0.1:<port>`
    /// (`podman port`'s `0.0.0.0:<port>` output is cosmetic reporting of the guest-side bind),
    /// loopback connects, and a connect to the host's LAN address is refused.
    public static let defaultAstroCommand =
        "/usr/local/bin/anglesite-hydrate /workspace/site && cd /workspace/site && npx astro dev --port \(previewPort) --host 0.0.0.0"

    /// The production MCP-sidecar guest command: baked into the image at
    /// `/usr/local/lib/anglesite-mcp/` (scripts/vendor-container-image.sh stages the plugin's
    /// `server/` dir). Config rides ENV, not flags — matches `ContainerizationControl` except
    /// for `ANGLESITE_MCP_HOST=0.0.0.0` (the server's default is `127.0.0.1`), for the same
    /// pasta port-forwarding reason as `defaultAstroCommand` above.
    public static let defaultMCPCommand =
        "ANGLESITE_MCP_TRANSPORT=http ANGLESITE_MCP_HOST=0.0.0.0 ANGLESITE_MCP_PORT=\(mcpPort) ANGLESITE_PROJECT_ROOT=/workspace/site node /usr/local/lib/anglesite-mcp/server/index.mjs"

    /// - Parameters:
    ///   - image: The OCI image reference `podman run` boots. Defaults to a locally-tagged image
    ///     (`podman build`/`podman load`, not pulled from a registry — see the Linux MVP image
    ///     provisioning notes) so a fresh checkout fails loudly (`imageUnavailable`) rather than
    ///     silently pulling an unrelated public image on first run.
    ///   - astroCommand: The `sh -lc` command that serves the preview on guest port 4321.
    ///     Injectable so tests can substitute a lightweight fake — the real MCP sidecar/Astro
    ///     toolchain isn't available everywhere `PodmanContainerControl` needs to be exercised.
    ///   - mcpCommand: The `sh -lc` command that serves MCP on guest port 4399. Same rationale.
    public init(
        image: String = "localhost/anglesite-dev:latest",
        podmanExecutable: URL = URL(fileURLWithPath: "/usr/bin/podman"),
        supervisor: ProcessSupervisor = .shared,
        astroCommand: String = PodmanContainerControl.defaultAstroCommand,
        mcpCommand: String = PodmanContainerControl.defaultMCPCommand,
        logCenter: LogCenter = .shared
    ) {
        self.image = image
        self.podmanExecutable = podmanExecutable
        self.supervisor = supervisor
        self.live = LivePodmanContainers()
        self.astroCommand = astroCommand
        self.mcpCommand = mcpCommand
        self.logCenter = logCenter
    }

    public func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        // Resolves the split-repo gitfile layout (#888/#903) — see SourceRepoPrecondition.
        let cloneSource = try SourceRepoPrecondition.cloneSource(for: sourceRepo)
        let name = Self.containerName(for: siteID)

        // 1. Boot a bare, long-lived container (podman's equivalent of Apple Containerization's
        //    "makeBareContainer" step): a no-op main process so `podman exec` has something to
        //    attach to, the host `Source/` repo bind-mounted read-only (`:ro` below — edit
        //    persistence hands commits back over exec stdout, not through this mount), and both
        //    guest ports
        //    published to OS-assigned host ports. `--rm` means `podman stop` alone tears down the
        //    whole thing — no separate `podman rm`.
        //
        //    Deliberately NOT `ProcessSupervisor.run`/Foundation's `Process` here: `podman run -d`
        //    forks `conmon`, a monitor process that outlives the `podman` CLI invocation and — when
        //    spawned through `Process` on Linux — leaves `waitUntilExit()`/the exit-detection path
        //    hanging indefinitely, even with output fully redirected away from any pipe `Process`
        //    holds. Verified empirically on this box: a raw `posix_spawn`+`waitpid()` for the exact
        //    same command returns in well under a second, so `spawnDetachedPodmanRun` below bypasses
        //    `Process` entirely for this one call. Every other podman invocation in this file
        //    (`exec`, `port`, `stop` — none of which daemonize) goes through `ProcessSupervisor`
        //    normally and is unaffected.
        do {
            try Self.spawnDetachedPodmanRun(
                podmanExecutable: podmanExecutable,
                arguments: [
                    "run", "-d", "--rm", "--name", name,
                    "-v", "\(cloneSource.path):\(Self.repoSharePath):ro",
                    "-p", "127.0.0.1::\(Self.previewPort)",
                    "-p", "127.0.0.1::\(Self.mcpPort)",
                    image, "sleep", "infinity",
                ]
            )
        } catch let error as LocalContainerError {
            throw error
        } catch {
            throw LocalContainerError.bootFailed("podman run failed: \(error)")
        }

        // 2. Guest /etc/hosts: the image ships none, and without it even `localhost` becomes a
        //    real DNS query (vite's dns.lookup("localhost") -> EAI_AGAIN at astro config load),
        //    same failure mode ContainerizationControl works around.
        do {
            try await execOneShot(
                name: name, label: "hosts", onOutput: onOutput,
                ["sh", "-c", "printf '127.0.0.1\\tlocalhost\\n::1\\tlocalhost\\n' > /etc/hosts"])
        } catch {
            await stopContainer(name: name)
            throw LocalContainerError.bootFailed("guest /etc/hosts setup failed: \(error)")
        }

        // 3. Clone from the read-only bind-mounted share into a writable /workspace/site, then
        //    check out ref. Two steps (not `git clone --branch`) because that flag rejects
        //    "HEAD"/bare SHAs, which `git checkout` accepts.
        do {
            try await execOneShot(
                name: name, label: "clone", onOutput: onOutput,
                ["git", "clone", Self.repoSharePath, "/workspace/site"])
            try await execOneShot(
                name: name, label: "checkout", onOutput: onOutput,
                ["git", "-C", "/workspace/site", "checkout", ref])
        } catch {
            await stopContainer(name: name)
            throw LocalContainerError.cloneFailed("\(error)")
        }

        // 4. Start astro dev + the MCP sidecar as supervised, long-running `podman exec` processes
        //    (not `exec -d`): running them in the foreground of a host-side ProcessSupervisor
        //    process gives live per-process labeled output via the same LogCenter path every other
        //    supervised process uses, rather than the coarser `podman logs` (container-wide,
        //    unlabeled). A private LogCenter bridges that output into `onOutput`.
        let bridgeLogCenter = LogCenter()
        let bridgeSubscription = await bridgeLogCenter.subscribe()
        let bridgeTask = Task.detached {
            for await line in bridgeSubscription.stream {
                onOutput(line.text, line.stream)
            }
        }

        var handles: [ProcessSupervisor.Handle] = []
        do {
            let astroHandle = try await supervisor.launch(
                source: "astro", executable: podmanExecutable,
                arguments: ["exec", name, "sh", "-lc", astroCommand],
                logCenter: bridgeLogCenter
            )
            handles.append(astroHandle)

            let mcpHandle = try await supervisor.launch(
                source: "mcp", executable: podmanExecutable,
                arguments: ["exec", name, "sh", "-lc", mcpCommand],
                logCenter: bridgeLogCenter
            )
            handles.append(mcpHandle)
        } catch {
            for handle in handles { await supervisor.terminate(handle) }
            bridgeSubscription.cancel()
            await bridgeTask.value
            await stopContainer(name: name)
            throw LocalContainerError.bootFailed("guest process launch failed: \(error)")
        }

        // 5. Resolve the OS-assigned host ports podman published, then wait for astro to actually
        //    serve before returning (mirrors ContainerizationControl's waitUntilServing).
        let previewURL: URL
        let mcpURL: URL
        do {
            let previewHostPort = try await resolvedHostPort(name: name, guestPort: Self.previewPort)
            let mcpHostPort = try await resolvedHostPort(name: name, guestPort: Self.mcpPort)
            guard let preview = URL(string: "http://127.0.0.1:\(previewHostPort)"),
                  let mcp = URL(string: "http://127.0.0.1:\(mcpHostPort)/mcp")
            else { throw LocalContainerError.bootFailed("could not build preview/MCP URLs") }
            previewURL = preview
            mcpURL = mcp
        } catch {
            for handle in handles { await supervisor.terminate(handle) }
            bridgeSubscription.cancel()
            await bridgeTask.value
            await stopContainer(name: name)
            throw LocalContainerError.bootFailed("port lookup failed: \(error)")
        }

        do {
            try await waitUntilServing(previewURL, timeout: Self.previewReadyTimeout)
        } catch {
            for handle in handles { await supervisor.terminate(handle) }
            bridgeSubscription.cancel()
            await bridgeTask.value
            await stopContainer(name: name)
            throw LocalContainerError.bootFailed("preview server did not become ready: \(error)")
        }

        await live.store(siteID: siteID, containerName: name, handles: handles, bridgeSubscription: bridgeSubscription, bridgeTask: bridgeTask)
        return LocalContainerSession(previewURL: previewURL, mcpURL: mcpURL)
    }

    public func stop(siteID: String) async throws {
        await live.teardown(siteID: siteID, supervisor: supervisor) { name in
            await self.stopContainer(name: name)
        }
    }

    /// Local wrangler-dev (#708) is designed and implemented against `ContainerizationControl`'s
    /// vsock-bridged guest only — the cross-platform Linux port (#571) hasn't reached this guest
    /// process yet. Throwing a clear, dedicated error here (rather than silently no-op'ing or
    /// pretending success) keeps `LocalContainerSiteRuntime.startWorkersDevIfActive` honest: it
    /// already degrades any `startWorkersDev` failure to `workersDevURL: nil` rather than failing
    /// the whole preview, so this surfaces as "no workers-dev URL" on Linux instead of a crash.
    public func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        throw LocalContainerError.bootFailed(
            "workers-dev is not yet supported on the Linux/podman runtime (#571 tracks the port)")
    }

    public func stopWorkersDev(siteID: String) async throws {}

    public func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        guard let name = await live.containerName(for: siteID) else {
            throw LocalContainerError.bootFailed("exec: no running container for site \(siteID)")
        }
        var arguments = ["exec", "-w", workingDirectory]
        for (key, value) in environment.sorted(by: { $0.key < $1.key }) {
            arguments += ["-e", "\(key)=\(value)"]
        }
        arguments.append(name)
        arguments += argv
        let result = try await supervisor.run(executable: podmanExecutable, arguments: arguments)
        if !result.stdout.isEmpty { onOutput(result.stdout, .stdout) }
        if !result.stderr.isEmpty { onOutput(result.stderr, .stderr) }
        return ContainerExecResult(exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr)
    }

    /// Like `exec`, but launches `podman exec -i` as a long-running supervised process
    /// (`ProcessSupervisor.launch(attachStdin: true)`) instead of a one-shot `run`, so the caller
    /// can keep writing to its stdin — mirrors `StdioTransport`'s exact approach on the host side.
    /// Output flows through `logCenter` (matching every other `launch`-based process here) and is
    /// forwarded to `onOutput` by a subscription filtered to this call's `source`, tagged with the
    /// original `LogCenter.Stream` it arrived on.
    public func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        guard let name = await live.containerName(for: siteID) else {
            throw LocalContainerError.bootFailed("execInteractive: no running container for site \(siteID)")
        }
        var arguments = ["exec", "-i", "-w", workingDirectory]
        for (key, value) in environment.sorted(by: { $0.key < $1.key }) {
            arguments += ["-e", "\(key)=\(value)"]
        }
        arguments.append(name)
        arguments += argv

        // Unique per call (not just per siteID): two concurrent execInteractive calls for the
        // same site would otherwise share a `source`, and each call's forwarding loop below
        // filters only on `line.source == source` — an identical source would cross-contaminate
        // their `onOutput` callbacks with each other's lines. Mirrors `ContainerizationControl`
        // .execInteractive's per-call UUID-suffixed exec id on the macOS conformer.
        let source = "acp-interactive:\(siteID):\(UUID().uuidString.prefix(8))"
        let subscription = await logCenter.subscribe()
        let forwardTask = Task { [source] in
            for await line in subscription.stream {
                guard line.source == source else { continue }
                onOutput(line.text, line.stream)
            }
        }

        let handle = try await supervisor.launch(
            source: source,
            executable: podmanExecutable,
            arguments: arguments,
            attachStdin: true,
            logCenter: logCenter
        )

        return InteractiveExecHandle(
            write: { [supervisor] data in try await supervisor.writeStdin(handle, data) },
            terminate: { [supervisor] in
                // `.cancel()` finishes the subscription's own continuation — the guaranteed way
                // to end the `for await` forwarding loop (matches `StdioTransport.close()`);
                // `forwardTask.cancel()` alone would NOT reliably stop a `for await` over an
                // `AsyncStream` that's still open.
                subscription.cancel()
                forwardTask.cancel()
                await supervisor.terminate(handle, timeout: 2)
                _ = await supervisor.waitForExit(handle)
            }
        )
    }

    // MARK: - Internals

    /// `podman exec`, capturing the full output as one shot and replaying it through `onOutput` —
    /// setup commands (hosts/clone/checkout) are fast, so losing true line-by-line liveness in
    /// exchange for the simpler one-shot `run()` path is an acceptable trade (unlike astro/mcp,
    /// which genuinely run for the container's whole lifetime and use `launch()` instead).
    private func execOneShot(
        name: String, label: String, onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void, _ argv: [String]
    ) async throws {
        let result = try await supervisor.run(executable: podmanExecutable, arguments: ["exec", name] + argv)
        for line in result.stdout.split(separator: "\n", omittingEmptySubsequences: true) {
            onOutput("[\(label)] \(line)", .stdout)
        }
        for line in result.stderr.split(separator: "\n", omittingEmptySubsequences: true) {
            onOutput("[\(label)] \(line)", .stderr)
        }
        guard result.exitCode == 0 else {
            throw LocalContainerError.bootFailed("\(label) failed (exit \(result.exitCode)): \(result.stderr)")
        }
    }

    /// `podman port <name> <guestPort>/tcp` prints `0.0.0.0:PORT` (or `127.0.0.1:PORT`) for the
    /// OS-assigned host port podman published. Parses the trailing port number.
    private func resolvedHostPort(name: String, guestPort: Int) async throws -> Int {
        let result = try await supervisor.run(
            executable: podmanExecutable, arguments: ["port", name, "\(guestPort)/tcp"])
        guard result.exitCode == 0 else {
            throw LocalContainerError.bootFailed("podman port lookup failed for \(guestPort): \(result.stderr)")
        }
        guard let port = Self.parseHostPort(from: result.stdout) else {
            throw LocalContainerError.bootFailed("couldn't parse podman port output for \(guestPort): \(result.stdout)")
        }
        return port
    }

    /// `podman port` prints one `HOST_IP:PORT` line per publish rule (e.g. `0.0.0.0:34521`,
    /// or two lines — one per IP family — if the container also published on `::`). Every line
    /// for a single `podman port <name> <guestPort>/tcp` query maps the same guest port, so the
    /// first line's trailing port number is authoritative regardless of how many lines print.
    static func parseHostPort(from output: String) -> Int? {
        guard let firstLine = output.split(separator: "\n", omittingEmptySubsequences: true).first else { return nil }
        let trimmed = firstLine.trimmingCharacters(in: .whitespaces)
        guard let portString = trimmed.split(separator: ":").last else { return nil }
        return Int(portString)
    }

    private func stopContainer(name: String) async {
        _ = try? await supervisor.run(executable: podmanExecutable, arguments: ["stop", "-t", "5", name])
    }

    /// Podman container names must start with an alphanumeric and contain only
    /// `[A-Za-z0-9_.-]`. Site IDs are marker UUIDs (already safe), but this defensively sanitizes
    /// anything else rather than handing podman a name it will reject with an opaque CLI error.
    static func containerName(for siteID: String) -> String {
        let sanitized = siteID.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "-" }
        return "anglesite-" + String(sanitized)
    }

    /// Runs `podman <arguments>` via raw `posix_spawn`/`waitpid`, bypassing Foundation's `Process`
    /// entirely — see the long comment on `start()`'s step 1 for why. No shell involved (argv is
    /// passed directly), so no quoting/injection concerns. Output is redirected to a throwaway
    /// temp file (not discarded to `/dev/null`) so a failure still has a diagnostic to report.
    static func spawnDetachedPodmanRun(podmanExecutable: URL, arguments: [String]) throws {
        let logPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("anglesite-podman-boot-\(UUID().uuidString).log").path
        defer { try? FileManager.default.removeItem(atPath: logPath) }

        var fileActions = posix_spawn_file_actions_t()
        posix_spawn_file_actions_init(&fileActions)
        defer { posix_spawn_file_actions_destroy(&fileActions) }
        let openResult = logPath.withCString { path in
            posix_spawn_file_actions_addopen(&fileActions, 1, path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
        }
        guard openResult == 0 else {
            throw LocalContainerError.bootFailed("couldn't prepare boot log file (errno \(openResult))")
        }
        posix_spawn_file_actions_adddup2(&fileActions, 1, 2)  // stderr -> same file as stdout

        let argv = ([podmanExecutable.path] + arguments).map { strdup($0) } + [nil]
        defer { for pointer in argv { free(pointer) } }

        var pid: pid_t = 0
        let spawnResult = posix_spawn(&pid, podmanExecutable.path, &fileActions, nil, argv, environ)
        guard spawnResult == 0 else {
            throw LocalContainerError.bootFailed("posix_spawn failed (errno \(spawnResult))")
        }

        var status: Int32 = 0
        waitpid(pid, &status, 0)
        let exitCode = (status >> 8) & 0xff

        if exitCode != 0 {
            let bootLog = (try? String(contentsOfFile: logPath, encoding: .utf8)) ?? ""
            throw LocalContainerError.bootFailed("podman run failed (exit \(exitCode)): \(bootLog)")
        }
    }

    /// Polls `url` with a plain HTTP GET until it answers or `timeout` elapses. Podman's port
    /// mapping is plain TCP with no vsock-transport retry-storm concerns `ContainerizationControl`
    /// works around with raw sockets, so `URLSession` is fine here.
    private func waitUntilServing(_ url: URL, timeout: Duration, interval: Duration = .milliseconds(500)) async throws {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        var lastError: String?
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            do {
                _ = try await URLSession.shared.data(for: request)
                return
            } catch {
                lastError = "\(error)"
            }
            try await Task.sleep(for: interval)
        }
        throw LocalContainerError.bootFailed(
            "timed out after \(timeout) waiting for \(url.absoluteString)"
                + (lastError.map { "; last error: \($0)" } ?? ""))
    }
}

/// One live podman-backed container's bookkeeping, keyed by siteID — mirrors
/// `ContainerizationControl`'s `LiveContainers` actor box.
actor LivePodmanContainers {
    private struct Entry {
        let containerName: String
        let handles: [ProcessSupervisor.Handle]
        let bridgeSubscription: LogCenter.Subscription
        let bridgeTask: Task<Void, Never>
    }

    private var entries: [String: Entry] = [:]

    func containerName(for siteID: String) -> String? { entries[siteID]?.containerName }

    func store(siteID: String, containerName: String, handles: [ProcessSupervisor.Handle], bridgeSubscription: LogCenter.Subscription, bridgeTask: Task<Void, Never>) {
        entries[siteID] = Entry(containerName: containerName, handles: handles, bridgeSubscription: bridgeSubscription, bridgeTask: bridgeTask)
    }

    func teardown(siteID: String, supervisor: ProcessSupervisor, stopContainer: (String) async -> Void) async {
        guard let entry = entries[siteID] else { return }
        entries[siteID] = nil
        // Stop the container first — it kills everything inside it (astro/mcp), so the host-side
        // `podman exec` wrapper processes exit on their own; terminate() afterward is a fast
        // no-op safety net, not the primary teardown mechanism.
        await stopContainer(entry.containerName)
        for handle in entry.handles { await supervisor.terminate(handle) }
        // Cancel the ORIGINAL subscription feeding bridgeTask's for-await loop — a fresh
        // subscription here would cancel nothing but itself, leaving bridgeTask parked forever.
        entry.bridgeSubscription.cancel()
        await entry.bridgeTask.value
    }
}
#endif
