// The iOS thin client is remote-only (#71): it must never link the local container runtime, so
// the whole file compiles out there. macOS (Apple Containerization) and Linux (Podman control)
// both keep it.
#if !os(iOS)
import Foundation

/// `SiteRuntime` over a local Apple-Containerization VM (macOS 26+/Apple Silicon; see design
/// 2026-06-25). Drives a `LocalContainerControl`: boot the container, hydrate it from the site's `Source/` git
/// repo, connect the MCP client to the returned MCP endpoint, settle to `.ready`/`.failed`.
/// Spawns nothing in-process.
public actor LocalContainerSiteRuntime: SiteRuntime, SiteRuntimeContainerCapability {
    /// Shared by `persistEdit`'s two commit-hash validity checks — built once rather than per
    /// character inside each `allSatisfy` closure.
    private static let hexDigits = CharacterSet(charactersIn: "0123456789abcdefABCDEF")

    private let ref: String
    private let control: any LocalContainerControl
    public let mcpClient: MCPClient
    private let knowledgeIndex: SiteKnowledgeIndex?
    private let semanticRanker: SemanticRanker?
    private let conventionsEngine: ProjectConventionsEngine?
    private let logCenter: LogCenter
    private let connect: @Sendable (MCPClient, URL) async throws -> Void
    private let makeFileWatcher: @Sendable () -> any SiteFileWatching
    private let importBundle: @Sendable (URL, String, URL) async throws -> Void
    private let suddenTerminationController: SuddenTerminationController
    private let beginActivity: @Sendable (String) -> ActivityAssertion.Lease
    private let workerCatalog: @Sendable () async -> [WorkerDescriptor]
    private let statusCenter: WorkersDevStatusCenter
    /// Local wrangler-dev URLs learned per site — lets a supervisor-driven post-restart
    /// `.running` re-attach the URL `startWorkersDev` returned (#699).
    private var workersDevURLs: [String: URL] = [:]
    private var fileWatcher: (any SiteFileWatching)?
    private var containerTerminationLease: SuddenTerminationController.Lease?

    private let stateMachine = SiteRuntimeStateMachine()
    private var activeSiteID: String?
    private var activeSiteDirectory: URL?
    private var loadedKnowledgeSiteID: String?
    /// Serializes guest-to-host git handoffs. Actor isolation alone is insufficient because an
    /// actor is reentrant while `control.exec` is suspended, and two overlapping overlay edits
    /// must never race in the canonical working tree.
    private var persistenceInProgress = false
    private var persistenceWaiters: [CheckedContinuation<Void, Never>] = []

    /// Drains the current container's boot/guest-process output into `logCenter`. Long-lived for
    /// the container's whole run (astro/mcp keep emitting after `start()` returns), so it's stored
    /// rather than scoped to one call — `teardown()` finishes it after the container actually stops.
    private var bootLogContinuation: AsyncStream<(String, LogCenter.Stream)>.Continuation?
    private var bootLogDrainTask: Task<Void, Never>?

    public init(
        ref: String,
        control: any LocalContainerControl,
        mcpClient: MCPClient,
        knowledgeIndex: SiteKnowledgeIndex? = nil,
        semanticRanker: SemanticRanker? = nil,
        conventionsEngine: ProjectConventionsEngine? = nil,
        logCenter: LogCenter = .shared,
        connect: @escaping @Sendable (MCPClient, URL) async throws -> Void = { c, u in try await c.connect(httpEndpoint: u) },
        makeFileWatcher: @escaping @Sendable () -> any SiteFileWatching = { PlatformFileWatcher.make() },
        importBundle: @escaping @Sendable (URL, String, URL) async throws -> Void = { bundle, commit, source in
            #if canImport(Darwin)
            try await InProcessEditPersistence.importBundle(bundle, commit: commit, into: source)
            #else
            throw SiteRuntimePersistenceError.syncFailed("in-process git import is unavailable on this platform")
            #endif
        },
        suddenTerminationController: SuddenTerminationController = .shared,
        beginActivity: @escaping @Sendable (String) -> ActivityAssertion.Lease = ActivityAssertion.begin,
        workerCatalog: @escaping @Sendable () async -> [WorkerDescriptor] = {
            await WorkerCatalogFetcher(catalogURL: WorkerCatalogFetcher.productionCatalogURL).catalog()
        },
        statusCenter: WorkersDevStatusCenter = .shared
    ) {
        self.ref = ref
        self.control = control
        self.mcpClient = mcpClient
        self.knowledgeIndex = knowledgeIndex
        self.semanticRanker = semanticRanker
        self.conventionsEngine = conventionsEngine
        self.logCenter = logCenter
        self.connect = connect
        self.makeFileWatcher = makeFileWatcher
        self.importBundle = importBundle
        self.suddenTerminationController = suddenTerminationController
        self.beginActivity = beginActivity
        self.workerCatalog = workerCatalog
        self.statusCenter = statusCenter
    }

    public var state: SiteRuntimeState { stateMachine.state }

    /// This runtime's own capability surface (#823) — `LocalContainerSiteRuntime` is the only
    /// `SiteRuntime` conformer that returns non-nil here (every other conformer inherits the
    /// protocol extension's `nil` default). Callers (`PreviewModel`) reach `containerSnapshot()`,
    /// `resetNetworking()`, and `persistEdit(commit:)` through this instead of downcasting to
    /// the concrete type. `nonisolated` per the protocol requirement — returning `self` never
    /// touches actor-isolated state.
    public nonisolated var containerCapability: (any SiteRuntimeContainerCapability)? { self }

    /// The `LocalContainerControl` held by this runtime, or `nil` if no site is currently
    /// started. Callers (e.g. `PreviewModel`) read this to build a `ContainerDeployExecutor`
    /// for the in-container deploy path (Task 5).
    ///
    /// Returns `nil` before `start()` completes successfully and after `stop()`.
    public var containerControl: (any LocalContainerControl)? {
        guard activeSiteID != nil else { return nil }
        return control
    }

    /// The site ID of the currently-running container, or `nil` if none is started.
    /// Parallel to `containerControl` — callers need both to build a `ContainerDeployExecutor`.
    public var containerActiveSiteID: String? { activeSiteID }

    /// Returns the control and active site ID atomically in a single actor hop, so the
    /// caller (e.g. `PreviewModel.activeContainerControl()`) cannot observe a torn state
    /// where one field is set and the other is not.
    ///
    /// Returns `nil` when no container is started (i.e. `activeSiteID` is nil — before
    /// `start()` completes successfully and after `stop()`).
    public func containerSnapshot() async -> (control: any LocalContainerControl, siteID: String)? {
        guard let id = activeSiteID else { return nil }
        return (control: control, siteID: id)
    }

    /// `PreviewModel.resetNetworking()`'s target (#812): unlike `containerSnapshot()`, `control` is
    /// available from construction regardless of `activeSiteID` — a boot failure never sets it, but
    /// the failure pane's "Restart Networking" button needs to reach this control precisely when
    /// the most recent boot failed.
    public func resetNetworking() async {
        await control.resetNetworking()
    }

    /// Computes the site's effective active-worker set (mirroring `DeployModel.runDeploy`'s own
    /// pipeline) and starts local `wrangler dev` if it's non-empty. Returns `nil` on any failure —
    /// logged, never thrown — or when there are no active workers. #708 design §7/§6: a settings-
    /// activated worker reliably resolves here; a component-tied worker may not, if this site's
    /// `SiteGraphExplorerSnapshot` hasn't been populated yet (accepted thin-slice limitation, not
    /// solved by this PR — see the design doc §6).
    ///
    /// `logCenter`/`source` are captured locally (not read from `self` inside `onOutput`) so late-
    /// arriving wrangler-dev output — it's a long-lived guest process, crash-restart-supervised, and
    /// can keep emitting long after this call returns — is always attributed to the `siteID` this
    /// call started it for, even if this runtime has since been reused for a different site (its
    /// `activeSiteID` would otherwise have moved on by the time a late line arrives).
    /// Output lands under its own `worker:<siteID>` source (not the container's shared
    /// `container:<siteID>`) so the Debug Pane's Source picker can isolate it, and status
    /// transitions are published to `statusCenter` under the package's display name (#699).
    private func startWorkersDevIfActive(siteID: String, siteDirectory: URL) async -> URL? {
        let packageURL = AnglesitePackage.packageRoot(fromSourceURL: siteDirectory)
        let configDirectory = AnglesitePackage(url: packageURL).configURL
        let settings = (try? await SiteConfigStore(configDirectory: configDirectory).load()) ?? SiteSettings()
        let catalog = await workerCatalog()
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        let workers = WorkerActivation.activeDescriptors(catalog: catalog, activeIDs: effectiveActiveIDs)
        guard !workers.isEmpty else { return nil }
        let logCenter = self.logCenter
        let statusCenter = self.statusCenter
        let source = "worker:\(siteID)"
        let displayName = (try? AnglesitePackage(url: packageURL).readMarker().displayName) ?? siteID
        await statusCenter.update(siteID: siteID, displayName: displayName, status: .starting)
        do {
            let url = try await control.startWorkersDev(
                siteID: siteID, workers: workers,
                onOutput: { line, stream in
                    Task { await logCenter.append(source: source, stream: stream, text: line) }
                },
                onState: { [weak self] state in
                    Task { await self?.handleWorkersDevState(state, siteID: siteID, displayName: displayName) }
                })
            workersDevURLs[siteID] = url
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .running(url: url))
            return url
        } catch {
            await logCenter.append(
                source: source, stream: .stderr,
                text: "local wrangler-dev failed to start: \(error) — active workers will have no local dev endpoint this session")
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .failed(reason: "\(error)"))
            return nil
        }
    }

    /// Maps supervisor-driven transitions (#699) into `statusCenter` rows. `.running` re-attaches
    /// the URL learned at `startWorkersDev`-return time (nil in the brief pre-return window);
    /// `.stopped` removes the row — an intentional stop isn't an error state worth a lingering row.
    /// Captured `siteID`/`displayName` (not `activeSiteID`) keep late supervisor events attributed
    /// to the session that produced them, mirroring `startWorkersDevIfActive`'s log-source capture.
    private func handleWorkersDevState(_ state: WorkersDevProcessState, siteID: String, displayName: String) async {
        switch state {
        case .running:
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .running(url: workersDevURLs[siteID]))
        case .restarting(let attempt):
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .restarting(attempt: attempt))
        case .failed(let reason):
            await statusCenter.update(siteID: siteID, displayName: displayName, status: .failed(reason: reason))
        case .stopped:
            await statusCenter.remove(siteID: siteID)
        }
    }

    /// Recomputes the effective active-worker set and restarts local wrangler-dev to match — the
    /// capability a future Workers tab (#700c) calls on toggle. Not called anywhere in this PR
    /// besides `start()`'s own initial computation (which goes through `startWorkersDevIfActive`
    /// directly, not through this method) — built and left as public API now so #700c needs no
    /// further runtime-side work. Guards on `stateMachine.isCurrent(gen)` and `activeSiteID ==
    /// siteID` after EVERY `await` in this method, not just before the final `settle` — the
    /// mutating calls (`control.stopWorkersDev`/`startWorkersDevIfActive`) are exactly as
    /// siteID-keyed-not-container-keyed as the bug `start()`'s own post-assignment guard fixes
    /// (#708 review), so a stale attempt here could stop or restart a brand-new container a later
    /// `start()` already booted under the same siteID if it ran unguarded. Currently unreachable
    /// (no caller yet), but shipping it unguarded would just be a latent repeat of that exact bug.
    /// `gen` here is a snapshot via `currentGeneration` (not a new attempt via `beginAttempt()`)
    /// since this method doesn't start a new lifecycle attempt, it supplements an already-running
    /// one — mirroring `persistEdit`'s identical use of `currentGeneration` for the same reason.
    public func updateActiveWorkers(_ settings: SiteSettings) async {
        guard let siteID = activeSiteID, let siteDirectory = activeSiteDirectory else { return }
        let gen = stateMachine.currentGeneration
        let catalog = await workerCatalog()
        guard stateMachine.isCurrent(gen), activeSiteID == siteID else { return }
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        let workers = WorkerActivation.activeDescriptors(catalog: catalog, activeIDs: effectiveActiveIDs)
        let workersDevURL: URL?
        if workers.isEmpty {
            try? await control.stopWorkersDev(siteID: siteID)
            workersDevURLs[siteID] = nil
            await statusCenter.remove(siteID: siteID)
            workersDevURL = nil
        } else {
            workersDevURL = await startWorkersDevIfActive(siteID: siteID, siteDirectory: siteDirectory)
        }
        guard stateMachine.isCurrent(gen), activeSiteID == siteID else { return }
        if case .ready(let readySiteID, let url, _) = stateMachine.state, readySiteID == siteID {
            stateMachine.settle(gen: gen, to: .ready(siteID: readySiteID, url: url, workersDevURL: workersDevURL))
        }
    }

    /// Copies one commit produced by the MCP sidecar in `/workspace/site` back into the host's
    /// canonical `Source/` repository without granting the guest write access to that repository.
    ///
    /// Fast-forward only: `InProcessEditPersistence` requires the exported commit's sole parent to
    /// equal the host's current HEAD, refusing (rather than merging or cherry-picking) if a native
    /// host-side content operation committed after this runtime was hydrated. A dirty host
    /// worktree is refused rather than overwritten.
    public func persistEdit(commit: String?) async throws {
        guard let commit,
              (7...64).contains(commit.count),
              commit.unicodeScalars.allSatisfy({ Self.hexDigits.contains($0) })
        else { throw SiteRuntimePersistenceError.missingOrInvalidCommit }

        let expectedGeneration = stateMachine.currentGeneration
        guard let siteID = activeSiteID, let siteDirectory = activeSiteDirectory else {
            throw SiteRuntimePersistenceError.runtimeNotRunning
        }

        await acquirePersistenceSlot()
        defer { releasePersistenceSlot() }

        guard stateMachine.isCurrent(expectedGeneration),
              activeSiteID == siteID,
              activeSiteDirectory == siteDirectory
        else {
            throw SiteRuntimePersistenceError.runtimeNotRunning
        }

        // Export exactly the requested commit through stdout as a base64 git bundle. The canonical
        // repo remains mounted read-only, so no guest process can alter its worktree, refs, or hooks.
        let exportScript = #"""
        set -eu
        runtime=/workspace/site
        commit="$1"
        ref=refs/heads/anglesite-persist
        bundle=/tmp/anglesite-persist-$$.bundle
        cleanup() {
          git -C "$runtime" update-ref -d "$ref" >/dev/null 2>&1 || true
          rm -f "$bundle"
        }
        trap cleanup EXIT HUP INT TERM

        full=$(git -C "$runtime" rev-parse "$commit^{commit}")
        git -C "$runtime" update-ref "$ref" "$full"
        if parent=$(git -C "$runtime" rev-parse "$full^" 2>/dev/null); then
          git -C "$runtime" bundle create "$bundle" "$ref" "^$parent"
        else
          git -C "$runtime" bundle create "$bundle" "$ref"
        fi
        printf '%s\n' "$full"
        base64 "$bundle"
        """#

        let logCenter = self.logCenter
        let source = "container:\(siteID):persist"
        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: ["sh", "-c", exportScript, "anglesite-export", commit],
                environment: [:],
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in
                    // stdout is the base64 bundle transport, not human-readable diagnostic output.
                    guard stream == .stderr else { return }
                    Task { await logCenter.append(source: source, stream: stream, text: line) }
                }
            )
        } catch {
            guard stateMachine.isCurrent(expectedGeneration), activeSiteID == siteID else {
                throw SiteRuntimePersistenceError.runtimeNotRunning
            }
            throw SiteRuntimePersistenceError.syncFailed(error.localizedDescription)
        }
        guard result.exitCode == 0 else {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw SiteRuntimePersistenceError.syncFailed(
                detail.isEmpty ? "git handoff exited \(result.exitCode)" : detail)
        }

        guard stateMachine.isCurrent(expectedGeneration),
              activeSiteID == siteID,
              activeSiteDirectory == siteDirectory
        else {
            throw SiteRuntimePersistenceError.runtimeNotRunning
        }

        let outputParts = result.stdout.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        guard outputParts.count == 2 else {
            throw SiteRuntimePersistenceError.syncFailed("container returned an invalid git bundle")
        }
        let fullCommit = String(outputParts[0])
        guard (40...64).contains(fullCommit.count),
              fullCommit.unicodeScalars.allSatisfy({ Self.hexDigits.contains($0) }),
              let bundleData = Data(base64Encoded: String(outputParts[1]), options: .ignoreUnknownCharacters)
        else {
            throw SiteRuntimePersistenceError.syncFailed("container returned an invalid git bundle")
        }

        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("anglesite-persist-\(UUID().uuidString).bundle")
        do {
            try bundleData.write(to: bundleURL, options: .atomic)
        } catch {
            throw SiteRuntimePersistenceError.syncFailed(error.localizedDescription)
        }
        defer { try? FileManager.default.removeItem(at: bundleURL) }

        do {
            try await importBundle(bundleURL, fullCommit, siteDirectory)
            // The host-side import is in-process libgit2, not a subprocess — nothing else would
            // ever put this write to the canonical repo in the debug pane (CLAUDE.md: "logs are
            // sacred"), so log the outcome explicitly on both paths.
            await logCenter.append(source: source, stream: .stdout, text: "persisted \(fullCommit) to Source")
        } catch {
            await logCenter.append(source: source, stream: .stderr, text: "persist failed: \(error.localizedDescription)")
            throw SiteRuntimePersistenceError.syncFailed(error.localizedDescription)
        }
    }

    public func observe() -> AsyncStream<SiteRuntimeState> {
        stateMachine.observe()
    }

    /// `siteDirectory` is the package's `Source/` directory; it becomes the `file://` repo the
    /// container clones (git is the source of truth, #72). The configured `ref` selects the commit.
    public func start(siteID: String, siteDirectory: URL) async {
        await teardown()
        let gen = stateMachine.beginStarting(siteID: siteID)
        let suddenTerminationLease = suddenTerminationController.acquire()
        // Scoped to the boot window only (unlike suddenTerminationLease, which outlives it as
        // containerTerminationLease) — released on every exit path below, including success:
        // once .ready/.failed is reached there's no more provisioning work an occluded app could
        // silently stall on. #773.
        let activityLease = beginActivity("Starting local preview for \(siteID)")

        // Wire the container's boot/guest-process output (repo clone, npm install + astro dev, the
        // MCP sidecar, the vsock bridge) into LogCenter under a per-site source tag, live, the same
        // way ContainerDeployExecutor streams exec output — this is the only visibility into what's
        // happening inside the guest during the (historically opaque, see #69) boot window.
        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        bootLogContinuation = continuation
        let logCenter = self.logCenter
        let source = "container:\(siteID)"
        let drainTask = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }
        bootLogDrainTask = drainTask

        // Tears down this attempt's own container and finishes its own (locally-captured, not
        // instance-var) boot log stream. Instance vars aren't used here because by the time an
        // abandoned attempt resumes past a `gen == generation` check, a superseding start()/stop()
        // may already have overwritten `bootLogContinuation`/`bootLogDrainTask` with its own —
        // finishing those would tear down the wrong stream. Actors are reentrant at `await` points,
        // so a superseding call's `teardown()` can run to completion while this attempt is still
        // suspended inside `control.start()`/`connect(...)`, before `activeSiteID` is assigned —
        // `teardown()` alone can't find this attempt's container in that window. Every exit path
        // that discovers it has been superseded must clean up after itself.
        func abandonSupersededAttempt() async {
            try? await control.stop(siteID: siteID)
            suddenTerminationLease.release()
            activityLease.release()
            continuation.finish()
            await drainTask.value
        }

        var containerStarted = false
        do {
            let session = try await control.start(
                siteID: siteID, sourceRepo: siteDirectory, ref: ref,
                onOutput: { line, stream in continuation.yield((line, stream)) })
            containerStarted = true
            guard stateMachine.isCurrent(gen) else { await abandonSupersededAttempt(); return }
            try await connect(mcpClient, session.mcpURL)
            guard stateMachine.isCurrent(gen) else { await abandonSupersededAttempt(); return }
            await knowledgeIndex?.rebuild(siteID: siteID, projectRoot: siteDirectory)
            await conventionsEngine?.rebuild(siteID: siteID, projectRoot: siteDirectory)
            guard stateMachine.isCurrent(gen) else {
                await knowledgeIndex?.unload(siteID: siteID)
                await conventionsEngine?.unload(siteID: siteID)
                await abandonSupersededAttempt()
                return
            }
            if let documents = await knowledgeIndex?.documents(siteID: siteID) {
                await semanticRanker?.sync(siteID: siteID, documents: documents)
            }
            guard stateMachine.isCurrent(gen) else {
                await knowledgeIndex?.unload(siteID: siteID)
                await semanticRanker?.unload(siteID: siteID)
                await conventionsEngine?.unload(siteID: siteID)
                await abandonSupersededAttempt()
                return
            }
            loadedKnowledgeSiteID = siteID
            startFileWatcher(siteID: siteID, projectRoot: siteDirectory, generation: gen)
            activeSiteID = siteID
            activeSiteDirectory = siteDirectory
            containerTerminationLease = suddenTerminationLease
            activityLease.release()
            // Local wrangler-dev (#708): computed once here, not wired to a live Settings
            // toggle yet (no Workers tab exists to trigger one — #700c). A start failure here
            // degrades to `workersDevURL: nil` rather than failing the whole runtime — wrangler-
            // dev is an add-on capability, unlike the MCP connection above.
            let workersDevURL = await self.startWorkersDevIfActive(siteID: siteID, siteDirectory: siteDirectory)
            // Unlike every earlier `stateMachine.isCurrent(gen)` guard in this method,
            // `activeSiteID`/`activeSiteDirectory`/`containerTerminationLease` are already assigned
            // above by the time this await returns — a superseding stop()/start() during it
            // discovers this attempt's container via the ordinary activeSiteID-based teardown()
            // path and already tears it down (or, in a rapid stop→restart, replaces it) correctly.
            // `settle` itself already no-ops when superseded (gen != generation internally), which
            // is exactly the "just bail" behavior this needs — no explicit guard or
            // `abandonSupersededAttempt()` call required (that helper's own `control.stop(siteID:)`
            // is keyed by siteID, not container instance, so re-issuing it here could stop a BRAND
            // NEW container a later start() has since booted and settled to `.ready` under the same
            // siteID — a real, if narrow, race an unconditional cleanup call here would reintroduce).
            stateMachine.settle(gen: gen, to: .ready(siteID: siteID, url: session.previewURL, workersDevURL: workersDevURL))
        } catch {
            // Finish this attempt's own (locally-captured) boot log stream immediately rather than
            // leaving it for the next start()/stop() call to clean up via teardown() — control.start()
            // has already stopped the container on its own failure paths, so no further guest output
            // can arrive here. Using the local capture, not the instance vars, matters if this attempt
            // was itself superseded while `control.start()` was in flight: a newer attempt may already
            // have overwritten `bootLogContinuation`/`bootLogDrainTask` with its own, and finishing
            // those would tear down the wrong stream.
            continuation.finish()
            await drainTask.value
            if containerStarted {
                try? await control.stop(siteID: siteID)
            }
            suddenTerminationLease.release()
            activityLease.release()
            guard stateMachine.isCurrent(gen) else { return }
            bootLogContinuation = nil
            bootLogDrainTask = nil
            stateMachine.settle(gen: gen, to: .failed(siteID: siteID, message: Self.friendlyMessage(for: error)))
        }
    }

    /// Tear down the running container and return to `.idle`. Intentionally fire-and-forget at the
    /// callsite: queued `readabilityHandler`s on the vsock proxy may still fire after teardown but
    /// are idempotent; in-flight bytes are not drained by design.
    public func stop() async {
        let gen = stateMachine.beginAttempt()
        await teardown()
        // Actors are reentrant, so a start()/stop() issued while teardown() was suspended has
        // superseded this stop and owns the state now — emitting `.idle` here would clobber its
        // `.starting`/`.ready` (the rapid Stop → Restart race, PR #542 review): the UI would show
        // the boot spinner forever while the dev server is actually running.
        stateMachine.settle(gen: gen, to: .idle)
    }

    // MARK: Internals

    private func teardown() async {
        // Snapshot-and-clear all bookkeeping before the first suspension: actors are reentrant,
        // so a superseding start()'s/stop()'s teardown can interleave while this one is suspended,
        // and a successful boot from a superseding start() can complete and install fresh
        // bookkeeping before this teardown resumes. Clearing first means each resource is stopped
        // by exactly one teardown, and a straggling teardown can't stop the newer boot's
        // container, kill its file watcher, or finish its live boot-log stream (PR #542 review).
        stopFileWatcher()
        let knowledgeSiteID = loadedKnowledgeSiteID
        loadedKnowledgeSiteID = nil
        let containerSiteID = activeSiteID
        activeSiteID = nil
        activeSiteDirectory = nil
        let containerTerminationLease = self.containerTerminationLease
        self.containerTerminationLease = nil
        let bootLogContinuation = self.bootLogContinuation
        let bootLogDrainTask = self.bootLogDrainTask
        self.bootLogContinuation = nil
        self.bootLogDrainTask = nil

        await mcpClient.stop()
        if let siteID = knowledgeSiteID {
            await knowledgeIndex?.unload(siteID: siteID)
            await semanticRanker?.unload(siteID: siteID)
            await conventionsEngine?.unload(siteID: siteID)
        }
        if let id = containerSiteID {
            try? await control.stop(siteID: id)
            // Explicit, not just supervisor-event-driven: the fake controls in tests never emit
            // .stopped, and a real teardown must never leave a stale row either way (#699).
            workersDevURLs[id] = nil
            await statusCenter.remove(siteID: id)
        }
        containerTerminationLease?.release()
        // Stop the container first (above) so no more guest output can arrive, then finish the
        // stream and await the drain so already-buffered lines land in LogCenter — mirrors
        // `ContainerDeployExecutor`'s finish-then-await-drain discipline.
        bootLogContinuation?.finish()
        await bootLogDrainTask?.value
    }

    private func startFileWatcher(siteID: String, projectRoot: URL, generation gen: Int) {
        guard knowledgeIndex != nil || conventionsEngine != nil else { return }
        stopFileWatcher()  // defensive: never orphan a running watcher if called while one is active
        let watcher = makeFileWatcher()
        do {
            try watcher.start(root: projectRoot) { [weak self] batch in
                Task { await self?.applyFileChanges(batch, siteID: siteID, projectRoot: projectRoot, generation: gen) }
            }
            fileWatcher = watcher
        } catch {
            // Best-effort: stale index is acceptable; the container reindexes on next open. This
            // runtime has no LogCenter, so surface the failure in debug builds at least.
            #if DEBUG
            print("LocalContainerSiteRuntime: file watcher unavailable for \(siteID): \(error)")
            #endif
        }
    }

    private func stopFileWatcher() {
        fileWatcher?.stop()
        fileWatcher = nil
    }

    private func acquirePersistenceSlot() async {
        if !persistenceInProgress {
            persistenceInProgress = true
            return
        }
        await withCheckedContinuation { persistenceWaiters.append($0) }
    }

    private func releasePersistenceSlot() {
        if persistenceWaiters.isEmpty {
            persistenceInProgress = false
        } else {
            persistenceWaiters.removeFirst().resume()
        }
    }

    private func applyFileChanges(_ batch: FileChangeBatch, siteID: String, projectRoot: URL, generation gen: Int) async {
        guard stateMachine.isCurrent(gen) else { return }
        if let knowledgeIndex {
            await KnowledgeReindex.apply(batch, to: knowledgeIndex, ranker: semanticRanker, siteID: siteID, projectRoot: projectRoot)
        }
        if let conventionsEngine {
            await Self.applyToConventions(batch, engine: conventionsEngine, siteID: siteID, projectRoot: projectRoot)
        }
        // A stop()/site-switch may have superseded us during the apply above; if so, drop anything
        // we re-added for a site this runtime no longer owns — mirroring populateSharedIndexes'
        // post-await unload discipline.
        guard stateMachine.isCurrent(gen) else {
            await knowledgeIndex?.unload(siteID: siteID)
            await semanticRanker?.unload(siteID: siteID)
            await conventionsEngine?.unload(siteID: siteID)
            return
        }
    }

    /// Mirrors `KnowledgeReindex.apply`'s batch-translation logic for `ProjectConventionsEngine`.
    /// Kept as a small static helper (not a shared type with `KnowledgeReindex`) since the two
    /// indexes have different upsert/remove signatures and no shared ranker to keep in sync.
    private static func applyToConventions(
        _ batch: FileChangeBatch, engine: ProjectConventionsEngine, siteID: String, projectRoot: URL
    ) async {
        if batch.needsFullRescan {
            await engine.rebuild(siteID: siteID, projectRoot: projectRoot)
            return
        }
        var seen = Set<String>()
        for url in batch.paths {
            guard let relativePath = SiteIndexPaths.relativePOSIXPath(of: url, under: projectRoot),
                  !SiteIndexPaths.isSkipped(relativePath: relativePath),
                  seen.insert(relativePath).inserted
            else { continue }
            if FileManager.default.fileExists(atPath: url.path) {
                await engine.upsertFile(siteID: siteID, projectRoot: projectRoot, relativePath: relativePath)
            } else {
                await engine.removeFile(siteID: siteID, relativePath: relativePath)
            }
        }
    }

    static func friendlyMessage(for error: Error) -> String {
        switch error {
        case LocalContainerError.virtualizationUnavailable:
            return "This Mac can't run a local preview — using the remote runtime instead."
        case LocalContainerError.imageUnavailable(let m):
            return "The preview image isn't available: \(m)"
        case LocalContainerError.bootFailed(let m):
            return "Couldn't start the local preview: \(m)"
        case LocalContainerError.cloneFailed(let m):
            return "Couldn't load this site into the preview: \(m)"
        default:
            return "Couldn't start the local preview: \(error)"
        }
    }
}
#endif
