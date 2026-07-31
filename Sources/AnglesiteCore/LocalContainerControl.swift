import Foundation

/// Host-reachable endpoints a started local container exposes. Both are 127.0.0.1 URLs on
/// OS-assigned ports, delivered by the host-side vsock→TCP proxy. Mirrors `SandboxSession`.
public struct LocalContainerSession: Sendable, Equatable {
    /// The guest Astro dev server's host-proxied endpoint — what the preview web view loads.
    public let previewURL: URL
    /// The MCP sidecar's host-proxied Streamable-HTTP endpoint — what
    /// ``MCPClient/connect(httpEndpoint:bearerToken:urlSession:initializeTimeout:clientName:clientVersion:)``
    /// targets.
    public let mcpURL: URL
    /// The local `wrangler dev --local` endpoint, populated only when `startWorkersDev` has been
    /// called for this session (#708) — not part of the initial `start()` payload, since the
    /// workers-dev process is started conditionally, after boot, not during it.
    public let workersDevURL: URL?
    /// `workersDevURL` defaults to nil because sessions are built by `start()`, before any
    /// workers-dev process can exist.
    public init(previewURL: URL, mcpURL: URL, workersDevURL: URL? = nil) {
        self.previewURL = previewURL
        self.mcpURL = mcpURL
        self.workersDevURL = workersDevURL
    }
}

/// Failures a local-container boot can surface. Cases carry a plain `String` (not an
/// underlying error) so the type stays `Equatable` and no `Containerization`/`Virtualization`
/// type crosses this seam; `LocalContainerSiteRuntime.friendlyMessage(for:)` maps each case to
/// owner-readable prose.
public enum LocalContainerError: Error, Equatable {
    /// No entitlement / not Apple Silicon / macOS < 26.
    case virtualizationUnavailable
    /// Bundled OCI layout missing or failed to import.
    case imageUnavailable(String)
    /// VM/container failed to boot.
    case bootFailed(String)
    /// git clone of `Source/` into the guest failed.
    case cloneFailed(String)
}

/// Hydration precondition: a `LocalContainerControl.start()` implementation hard-depends on
/// `sourceRepo` being a real git repo (it clones it into the guest). Kept as a plain, always-CI-
/// tested `AnglesiteCore` check rather than living inline in `ContainerizationControl` (whose test
/// target is excluded from CI's `swift test` unless `ANGLESITE_CONTAINER_TESTS=1`) — see #548,
/// where a `Source/` without `.git` (a failed scaffold git-init, or a pre-existing site) died
/// inside the guest with a raw `git clone ... exited 128` and no indication why.
public enum SourceRepoPrecondition {
    /// Validates that `sourceRepo` is hydratable and returns the host directory a container
    /// runtime must share into the guest as the clone source:
    /// - embedded layout (`Source/.git` is a directory) → `sourceRepo` itself, unchanged.
    /// - split layout (#888: `Source/.git` is a gitfile pointing at `Config/repo.nosync/`) → the
    ///   resolved git directory. The gitfile's target sits outside a `Source/`-only share, so the
    ///   guest's `git clone` cannot resolve `.git` and dies with exit 128 (#903). `git clone`
    ///   accepts a git *directory* as its source and produces the same HEAD checkout, so the
    ///   runtime shares the resolved git dir instead. `Config/` as a whole must never enter a
    ///   container — only the relocated git dir is shared.
    public static func cloneSource(for sourceRepo: URL, fileManager: FileManager = .default) throws -> URL {
        let gitPath = sourceRepo.appendingPathComponent(".git")
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: gitPath.path, isDirectory: &isDirectory) else {
            throw LocalContainerError.cloneFailed(
                "this site has no git repository — recreate it, or run `git init` in its Source folder")
        }
        if isDirectory.boolValue { return sourceRepo }

        let contents = (try? String(contentsOf: gitPath, encoding: .utf8)) ?? ""
        let target = contents.split(separator: "\n").first.flatMap { line -> String? in
            guard line.hasPrefix("gitdir:") else { return nil }
            return line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
        }
        guard let target, !target.isEmpty else {
            throw LocalContainerError.cloneFailed(
                "this site's Source/.git isn't a git directory or a gitdir pointer — recreate it, or run `git init` in its Source folder")
        }
        let resolved = URL(fileURLWithPath: target, relativeTo: sourceRepo).standardizedFileURL
        guard fileManager.fileExists(atPath: resolved.appendingPathComponent("HEAD").path) else {
            throw LocalContainerError.cloneFailed(
                "this site's git history (\(resolved.path)) is missing — wait for iCloud to sync it, or open the site on the Mac that has it")
        }
        return resolved
    }
}

/// The captured output of a guest `exec` call. No `Containerization`/`Virtualization` types cross
/// this boundary — only `String` and `Int32`.
public struct ContainerExecResult: Sendable, Equatable {
    /// The guest process's exit status.
    public let exitCode: Int32
    /// The complete captured stdout — the process has already exited when this exists, so
    /// callers can parse it whole (e.g. `persistEdit`'s base64 bundle transport).
    public let stdout: String
    /// The complete captured stderr — the diagnostic half, surfaced in failure messages.
    public let stderr: String
    /// Memberwise init — public so test fakes can fabricate results.
    public init(exitCode: Int32, stdout: String, stderr: String) {
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }
}

/// A live handle to an interactively-exec'd guest process — unlike `exec`'s wait-to-completion
/// result, this returns as soon as the process starts, so the caller can both feed it `stdin`
/// (e.g. outbound JSON-RPC messages) and keep receiving `onOutput` lines for as long as it runs.
/// Closure-backed (like `ContainerExecResult` is a plain struct) so no `Containerization`/
/// `Virtualization` type crosses this seam, and so `FakeLocalContainerControl` can hand back a
/// fully in-memory handle with no real process behind it.
public final class InteractiveExecHandle: Sendable {
    private let writeHandler: @Sendable (Data) async throws -> Void
    private let terminateHandler: @Sendable () async -> Void

    /// Builds a handle from the two closures a conformer wires to its real (or fake) process —
    /// see the type doc for why this is closure-backed rather than a protocol.
    public init(
        write: @escaping @Sendable (Data) async throws -> Void,
        terminate: @escaping @Sendable () async -> Void
    ) {
        self.writeHandler = write
        self.terminateHandler = terminate
    }

    /// Feeds `data` to the process's stdin.
    public func write(_ data: Data) async throws { try await writeHandler(data) }

    /// Terminates the process. Safe to call more than once; a terminated process's later
    /// `onOutput` calls (if any were in flight) still fire per `exec`'s existing `@escaping`
    /// contract.
    public func terminate() async { await terminateHandler() }
}

/// Typed wrapper over "boot a container, hydrate it from a repo, start the guest processes, and
/// return host-reachable endpoints." `ContainerizationControl` (in AnglesiteContainer) is the
/// production conformer; `FakeLocalContainerControl` backs the tests. Mirrors `SandboxControlClient`.
/// No `Containerization`/`Virtualization` types cross this seam.
public protocol LocalContainerControl: Sendable {
    /// Boots the container and starts its guest processes (repo clone, `npm install` + `astro dev`,
    /// the MCP sidecar, the vsock bridge). `onOutput` receives every guest process's stdout/stderr
    /// line as it arrives — each line is prefixed with the emitting process's label (e.g. `[astro]`)
    /// so a single log source can distinguish them. Guest boot has historically been the least
    /// observable part of this stack (see #69): without this, a slow/hung `npm install` or a
    /// network/DNS failure inside the guest is invisible until `waitUntilServing`'s timeout fires
    /// with no diagnostic trail.
    ///
    /// `onOutput` is `@escaping`: the production conformer hands it to guest processes' `Writer`
    /// sinks, which can legitimately fire it after `start` returns (these processes are detached,
    /// not awaited) — up until `stop(siteID:)` tears the container down.
    func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession

    /// Stops the named container and every guest process it hosts. Teardown paths typically
    /// `try?` this — a stop that fails because the container is already gone isn't actionable.
    /// Keyed by `siteID`, not by container instance: a stale caller can stop a newer container
    /// booted under the same ID (see the superseded-attempt commentary in
    /// `LocalContainerSiteRuntime.start`), so callers must guard against that themselves.
    func stop(siteID: String) async throws

    /// Pauses the running VM for `siteID` in place instead of tearing it down — the guest's
    /// astro/mcp/bridge processes freeze exactly where they are (Virtualization.framework
    /// `pause()`, reached via `LinuxContainer.withVirtualMachineInstance`), rather than exiting. A
    /// later `start(siteID:sourceRepo:ref:onOutput:)` call for the SAME siteID resumes this paused
    /// VM (skipping the boot/clone/hydrate path entirely) if it's still registered in
    /// `PausedContainerRegistry`, or boots fresh otherwise (first-ever open, or the paused entry
    /// was evicted/reclaimed by app quit).
    ///
    /// Defaults to a full `stop(siteID:)` below for conformers with no pause capability of their
    /// own (`PodmanContainerControl` on Linux, every test fake) — only `ContainerizationControl`
    /// overrides this with a real pause. A conformer that inherits the default gets today's
    /// existing behavior unchanged: "suspend" on window close is just "stop."
    func suspend(siteID: String) async throws

    /// Run `argv` inside the named container's guest environment, streaming each output line to
    /// `onOutput` (tagged with the stream it came from — `.stdout`/`.stderr`) as it arrives, and
    /// returning the captured result when the process exits. No `Containerization`/`Virtualization`
    /// types cross this seam.
    ///
    /// `onOutput` is `@escaping`: the production conformer hands it to the guest process's `Writer`
    /// sinks, which can legitimately fire it *after* `exec` returns (e.g. a kill-triggered final
    /// line on cancellation). The signature is honest about that — callers must not assume the
    /// closure is dead once `exec` resolves.
    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult

    /// Like `exec`, but returns as soon as the guest process starts rather than waiting for it to
    /// exit, and the returned handle can feed the process's stdin — for a long-lived, bidirectional
    /// child (an ACP agent speaking JSON-RPC over stdio) rather than a one-shot command.
    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle

    /// Starts a local `wrangler dev --local` (Miniflare-backed, no real Cloudflare account calls)
    /// guest process for the given site's currently-active workers, as a fourth guest process
    /// sibling to astro/mcp/bridges — called only after `start()` has already succeeded, and only
    /// when `workers` is non-empty (#708 design §7 "started on demand, not unconditionally").
    /// Crash-restart-capable (via `GuestProcessSupervisor`) — a wrangler-dev crash after this
    /// returns does not throw back to any caller; it's handled internally.
    /// - Returns: The host-proxied URL wrangler-dev is reachable at.
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL

    /// Like `startWorkersDev(siteID:workers:onOutput:)`, but also surfaces the supervised guest
    /// process's lifecycle transitions (#699) as `WorkersDevProcessState` values, so UI-facing
    /// callers can render a live status indicator without importing the container layer.
    /// `onState` is `async` and the conformer must `await` each delivery before forwarding the
    /// next event: the transitions are semantically ordered (running → restarting → …), and
    /// firing unstructured Tasks per event would let deliveries race into the caller's actor
    /// out of order (PR #1116 review). Conformers with no live process state to report (test
    /// fakes, the Linux/podman control, which throws unsupported anyway) inherit the default
    /// below, which ignores `onState` — the same defaulted-requirement pattern `resetNetworking`
    /// already uses.
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) async -> Void
    ) async throws -> URL

    /// Stops the workers-dev process (and its supervisor) for `siteID`, independent of astro/mcp —
    /// used both when the effective active set becomes empty and as part of a full container
    /// teardown (`LiveContainers.teardown` already calls this before `container.stop()`).
    func stopWorkersDev(siteID: String) async throws

    /// Explicit, scoped network-layer recovery (#812): discards whatever shared network state this
    /// control's boot path caches, so the *next* boot attempt builds fresh state instead of reusing
    /// something possibly wedged — without an app relaunch. Surfaced as the failure pane's "Restart
    /// Networking" button, gated on `VmnetFailureRecovery.isRecoverable`.
    ///
    /// Defaults to a no-op below for conformers with no such shared state to reset (Podman on
    /// Linux, test fakes) — only `ContainerizationControl`'s vmnet-backed network is ever the
    /// target.
    func resetNetworking() async
}

extension LocalContainerControl {
    /// Default no-op — per the requirement's doc, only `ContainerizationControl`'s
    /// vmnet-backed network has shared state worth resetting; every other conformer inherits
    /// this and does nothing.
    public func resetNetworking() async {}

    /// Default for conformers without a real suspend/resume distinction: a plain stop. Only
    /// runtimes that can actually pause a VM (the Containerization control, #1151) override
    /// this with something cheaper to undo.
    public func suspend(siteID: String) async throws {
        try await stop(siteID: siteID)
    }

    /// Default for conformers with no live process state to report (test fakes, the Podman
    /// control): forwards to the state-less overload and never calls `onState`.
    public func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) async -> Void
    ) async throws -> URL {
        try await startWorkersDev(siteID: siteID, workers: workers, onOutput: onOutput)
    }
}
