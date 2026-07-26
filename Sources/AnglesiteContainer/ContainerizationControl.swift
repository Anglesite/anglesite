import Foundation
import AnglesiteCore
import Containerization
import ContainerizationOCI
import ContainerizationExtras

private struct VMBootTimeoutError: Error, CustomStringConvertible, Sendable {
    let message: String
    var description: String { message }
}

/// `LocalContainerControl` over Apple Containerization (package version 0.35). Imports the bundled
/// arm64 OCI layout into an on-disk `ImageStore`, unpacks it to an ext4 rootfs, boots a Linux VM
/// (`VZVirtualMachineManager`) with NAT outbound + vsock inbound, clones the site's `Source/` repo
/// into the guest, starts `astro dev` (guest TCP 4321) + the Node MCP sidecar (guest TCP 4399) +
/// the vsock bridge, and exposes both via host-side `VsockTCPProxy` instances dialing the guest
/// over vsock. CI never compiles this file (the `AnglesiteContainer` target is app-only).
///
/// API note: the implementation is written against the real 0.35 symbols, which differ from the
/// plan's intended shapes. Notably there is no `LinuxContainer(image:networking:)` — booting needs a
/// `Kernel` + an initfs `Mount` + an unpacked rootfs `Mount`; image import is `ImageStore.load(from:)`
/// (not `importIfNeeded`); exec is two-phase (`exec` builds, `.start()` runs, `.wait()` blocks);
/// networking is a vmnet-allocated `VmnetNetwork.Interface` (not `.nat`); and
/// `dialVsock(port:)` already returns a `FileHandle`, so it slots directly into `VsockDialer`.
/// See `.superpowers/sdd/task-7-report.md` for the full map.
public struct ContainerizationControl: LocalContainerControl {
    /// Optional explicit OCI layout override; when nil, `start()` resolves it via `BundledImage.layoutURL()`.
    /// Kept off `init` as a non-throwing default so constructing the type can never trap (the old
    /// `BundledImage.layoutURL` default argument `fatalError`'d on a missing bundle).
    private let imageLayoutURLOverride: URL?

    // One live container + its two proxies per siteID, kept in an actor box so start/stop are safe.
    private let live = LiveContainers()

    // Process-shared and actor-serialized: one vmnet network, one releasable interface per site.
    private let network = SharedVmnetNetwork.shared

    // Guest-side ports the dev server + MCP sidecar listen on (also the vsock ports the bridge maps to).
    private static let previewPort: UInt32 = 4321
    private static let mcpPort: UInt32 = 4399
    /// Wrangler's own conventional local-dev port.
    private static let workersPort: UInt32 = 8787

    /// Guest mountpoint for the read-only virtio-fs share of the host `Source/` repo (see `start()` step 3).
    private static let repoSharePath = "/run/anglesite-source"

    public init(imageLayoutURL: URL? = nil) {
        self.imageLayoutURLOverride = imageLayoutURL
    }

    public func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        // Resolves the split-repo gitfile layout (#888/#903): share the directory git can
        // actually clone (Source/ for an embedded .git, the resolved Config/repo.nosync/ gitdir
        // for a migrated package) — a Source/-only share leaves the gitfile's target invisible
        // to the guest and the clone below exits 128.
        let cloneSource = try SourceRepoPrecondition.cloneSource(for: sourceRepo)

        let container = try await makeBareContainer(siteID: siteID, sourceRepo: cloneSource, onOutput: onOutput)

        // 3. Hydrate from the repo: clone the virtio-fs-shared host repo into /workspace/site, then
        //    check out ref. Cloning from the read-only share (not in place) keeps /workspace
        //    writable and preserves full git history — native, no network. The share stays
        //    read-only for the container's whole life: `LocalContainerSiteRuntime.persistEdit`
        //    hands a commit back by exporting a git bundle from the guest's own /workspace/site
        //    clone over `control.exec`'s stdout, then importing it against the host's canonical
        //    Source/ in-process (`InProcessEditPersistence`) — it never writes through this share.
        //    Two steps because `git clone
        //    --branch` rejects "HEAD"/bare SHAs; `git checkout` accepts both.
        // The image ships no /etc/hosts: docker/containerd write one at container create, but
        // Apple Containerization boots the rootfs as-is — without it even `localhost` becomes a
        // real DNS query (vite does dns.lookup("localhost") at astro config load → EAI_AGAIN,
        // astro exits, and the preview never becomes ready). Write the standard entries first.
        // Wrapped separately from the clone below so a hosts failure reads as a boot problem,
        // not a misleading `cloneFailed`.
        do {
            try await runToCompletion(container, id: "hosts", onOutput: onOutput,
                ["sh", "-c", "printf '127.0.0.1\\tlocalhost\\n::1\\tlocalhost\\n' > /etc/hosts"])
        } catch {
            await stopBareContainer(container, siteID: siteID)
            throw LocalContainerError.bootFailed("guest /etc/hosts setup failed: \(error)")
        }

        do {
            try await runToCompletion(container, id: "clone", onOutput: onOutput,
                ["git", "clone", Self.repoSharePath, "/workspace/site"])
            try await runToCompletion(container, id: "checkout", onOutput: onOutput,
                ["git", "-C", "/workspace/site", "checkout", ref])
        } catch {
            await stopBareContainer(container, siteID: siteID)
            throw LocalContainerError.cloneFailed("\(error)")
        }

        // 4. Start astro dev (guest TCP 4321), the MCP sidecar (guest TCP 4399), and the vsock bridge.
        //    These are detached: `exec` + `.start()` with no `.wait()`. Each gets its own label so a
        //    single onOutput stream can distinguish them (this is the only visibility into what the
        //    guest is doing during boot — see #69's opaque `npm install`/`astro dev` startup window).
        do {
            // Hydrate deps from the image's baked toolchain (zero-install hardlink when the site's
            // lockfile matches the template; offline-first npm ci otherwise), then start astro.
            try await runDetached(container, id: "astro", label: "astro", onOutput: onOutput, ["sh", "-lc",
                "/usr/local/bin/anglesite-hydrate /workspace/site && cd /workspace/site && npx astro dev --port 4321 --host 127.0.0.1"])

            // MCP sidecar: baked into the image at /usr/local/lib/anglesite-mcp/ by the two-stage
            // Dockerfile (scripts/vendor-container-image.sh stages the plugin's server/ dir into the
            // build context; npm ci runs on linux/arm64 so @img/sharp-linux-arm64 is the native prebuilt).
            // The server reads config from ENV (not flags): ANGLESITE_MCP_TRANSPORT selects HTTP mode,
            // ANGLESITE_MCP_PORT sets the listen port, ANGLESITE_PROJECT_ROOT points at the cloned repo.
            // ANGLESITE_MCP_HOST is intentionally unset — it defaults to 127.0.0.1, which is correct:
            // the in-guest vsock bridge reaches the sidecar via dial("tcp","127.0.0.1:4399").
            try await runDetached(container, id: "mcp", label: "mcp", onOutput: onOutput, ["sh", "-lc",
                "ANGLESITE_MCP_TRANSPORT=http ANGLESITE_MCP_PORT=4399 ANGLESITE_PROJECT_ROOT=/workspace/site node /usr/local/lib/anglesite-mcp/server/index.mjs"])

            // Guest vsock<->TCP bridges (socat, baked into the image): map guest vsock ports onto the
            // local TCP listeners above so host-side dialVsock reaches them. One process per port;
            // `fork` accepts unlimited sequential/parallel connections.
            try await runDetached(container, id: "bridge-preview", label: "bridge-preview", onOutput: onOutput,
                ["/usr/bin/socat", "VSOCK-LISTEN:4321,reuseaddr,fork", "TCP:127.0.0.1:4321"])
            try await runDetached(container, id: "bridge-mcp", label: "bridge-mcp", onOutput: onOutput,
                ["/usr/bin/socat", "VSOCK-LISTEN:4399,reuseaddr,fork", "TCP:127.0.0.1:4399"])
        } catch {
            await stopBareContainer(container, siteID: siteID)
            throw LocalContainerError.bootFailed("guest process launch failed: \(error)")
        }

        // 5. Expose: a host-side vsock->TCP proxy per port. dialVsock(port:) -> FileHandle slots
        //    directly into VsockDialer (Phase 1's `@Sendable (UInt32) async throws -> FileHandle`).
        let dial: VsockDialer = { port in try await container.dialVsock(port: port) }
        // A failing dial (container.dialVsock unable to reach the guest) previously closed the
        // TCP side with zero trail — indistinguishable from a slow/hung guest process, both
        // surfacing as NSURLErrorNetworkConnectionLost on the polling URLSession (see #69).
        //
        // waitUntilServing's polling URLSession retries a lost connection internally, far faster
        // than its own 500ms interval — so a persistently-broken dial can emit thousands of
        // identical proxy events within seconds, evicting the one-time guest boot lines (astro/mcp/
        // bridge startup) out of LogCenter's bounded ring buffer before anyone reads them. Rate-limit
        // to the first few occurrences of each distinct message, then periodically, so a real storm
        // stays visible (with a running count) without burying everything else.
        let eventLimiter = EventRateLimiter()
        let previewProxy = VsockTCPProxy(
            guestPort: Self.previewPort,
            dial: dial,
            onDialError: { error in
                eventLimiter.log("[proxy:preview] dialVsock(\(Self.previewPort)) failed: \(error)", onOutput: onOutput)
            },
            onEvent: { event in eventLimiter.log("[proxy:preview] \(event)", onOutput: onOutput) })
        let mcpProxy = VsockTCPProxy(
            guestPort: Self.mcpPort,
            dial: dial,
            onDialError: { error in
                eventLimiter.log("[proxy:mcp] dialVsock(\(Self.mcpPort)) failed: \(error)", onOutput: onOutput)
            },
            onEvent: { event in eventLimiter.log("[proxy:mcp] \(event)", onOutput: onOutput) })
        let previewURL: URL
        let mcpURL: URL
        do {
            previewURL = try await previewProxy.start()
            let mcpBase = try await mcpProxy.start()
            mcpURL = mcpBase.appendingPathComponent("mcp")
        } catch {
            await previewProxy.stop()
            await mcpProxy.stop()
            await stopBareContainer(container, siteID: siteID)
            throw LocalContainerError.bootFailed("proxy start failed: \(error)")
        }

        // 6. Wait for `astro dev` to actually serve before returning, so the first preview load
        //    doesn't get connection-refused. Poll the preview URL through the host proxy until it
        //    answers (or time out). Cancellation-friendly: `Task.sleep` throws on cancel.
        do {
            try await waitUntilServing(previewURL, timeout: Self.previewReadyTimeout)
        } catch {
            await previewProxy.stop()
            await mcpProxy.stop()
            await stopBareContainer(container, siteID: siteID)
            throw LocalContainerError.bootFailed("preview server did not become ready: \(error)")
        }

        // Recompute the ext4 artifact URLs `makeBareContainer` staged, purely for `live`'s bookkeeping
        // (deleted on `stop()`/teardown) — derivation is a pure function of `siteID` + the store path,
        // so this can't diverge from what was actually unpacked.
        let storeURL = try BundledImage.storeURL()
        let rootfsURL = storeURL.appendingPathComponent("rootfs-\(siteID).ext4")
        let initfsURL = storeURL.appendingPathComponent("initfs-\(siteID).ext4")
        await live.store(siteID: siteID, container: container,
            proxies: [previewProxy, mcpProxy], ext4Artifacts: [rootfsURL, initfsURL])
        return LocalContainerSession(previewURL: previewURL, mcpURL: mcpURL)
    }

    public func stop(siteID: String) async throws {
        await live.teardown(siteID: siteID)
        await network.release(siteID: siteID)
    }

    /// `LocalContainerControl.resetNetworking()` conformance (#812): drops this process's cached
    /// vmnet network so the next boot attempt builds a fresh one, without disturbing any
    /// currently-running site's container (see `SharedVmnetNetwork.reset()`) and without an app
    /// relaunch or macOS reboot. Every `ContainerizationControl` value resolves to the same
    /// `SharedVmnetNetwork.shared` actor, so this is reachable from any instance regardless of
    /// which site (if any) it booted.
    public func resetNetworking() async {
        await network.reset()
    }

    /// See `LocalContainerControl.startWorkersDev` for the full contract.
    public func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        guard let container = await live.container(for: siteID) else {
            throw LocalContainerError.bootFailed("startWorkersDev: no live container for siteID '\(siteID)'")
        }

        // Any previously-running workers-dev session for this site is torn down first — this
        // method also serves as the "restart with a new active set" entry point once a future
        // Workers tab calls `LocalContainerSiteRuntime.updateActiveWorkers(_:)` (#708 design §2:
        // this PR builds that capability even though `start()` is its only caller today).
        await live.teardownWorkersDev(siteID: siteID)

        // Ephemeral, git-ignore-free local config: lives outside /workspace/site entirely, so a
        // transient local-dev session can never dirty the site's real, git-tracked wrangler.toml
        // (#708 design §4). No real resource ids — Miniflare creates local-persisted D1/KV/R2
        // stores automatically for declared bindings in --local mode.
        let toml = try WorkerComposition.generateWranglerToml(siteName: siteID, workers: workers)
        let configDir = "/tmp/anglesite-workers-dev/\(siteID)"
        let configPath = "\(configDir)/wrangler.toml"
        try await runToCompletion(container, id: "workers-dev-mkdir", onOutput: onOutput,
            ["mkdir", "-p", configDir])
        try await writeGuestFile(container, path: configPath, contents: toml, onOutput: onOutput)

        let launcher = LinuxContainerProcessLauncher(container: container)
        let supervisor = GuestProcessSupervisor(
            launcher: launcher,
            id: "workers-dev",
            argv: ["sh", "-lc",
                "cd /workspace/site && npx wrangler dev --local --config \(configPath) --port \(Self.workersPort)"],
            restartPolicy: .onCrash(maxAttempts: 3, baseBackoff: 0.5),
            onOutput: onOutput)
        try await supervisor.start()

        // Vsock<->TCP bridge for the workers-dev port, matching the bridge-preview/bridge-mcp
        // pattern above: wrangler-dev only ever binds a plain TCP socket, and
        // container.dialVsock(port:) dials an AF_VSOCK listener — without this bridge the proxy
        // below has nothing to connect to at the vsock layer, and every dial fails.
        //
        // Uses execInteractive (not runDetached) specifically so a later failure in this same
        // call (the proxy-start catch below) can terminate this one process — unlike astro/mcp's
        // bridges, which only ever need to live until a full container teardown, this bridge can
        // be started and torn down many times across a single container's life (every
        // startWorkersDev call, including future toggle-restarts via updateActiveWorkers), so an
        // orphaned bridge from a failed attempt would accumulate rather than being reaped once.
        let bridgeHandle: InteractiveExecHandle
        do {
            bridgeHandle = try await execInteractive(
                siteID: siteID,
                argv: ["/usr/bin/socat", "VSOCK-LISTEN:\(Self.workersPort),reuseaddr,fork", "TCP:127.0.0.1:\(Self.workersPort)"],
                environment: [:],
                workingDirectory: "/",
                onOutput: { line, stream in onOutput("[bridge-workers-dev] \(line)", stream) })
        } catch {
            await supervisor.stop()
            throw LocalContainerError.bootFailed("workers-dev vsock bridge failed to start: \(error)")
        }

        // Rate-limited the same way previewProxy/mcpProxy are (see their construction above): a
        // persistently-failing dial can otherwise emit enough identical events to evict one-time
        // boot lines out of LogCenter's bounded ring buffer. Scoped to this call rather than
        // shared with the boot-time limiter, since a workers-dev session's lifecycle is
        // independent of the container's boot.
        let workersDevEventLimiter = EventRateLimiter()
        let dial: VsockDialer = { port in try await container.dialVsock(port: port) }
        let proxy = VsockTCPProxy(
            guestPort: Self.workersPort,
            dial: dial,
            onDialError: { error in
                workersDevEventLimiter.log("[proxy:workers-dev] dialVsock(\(Self.workersPort)) failed: \(error)", onOutput: onOutput)
            },
            onEvent: { event in workersDevEventLimiter.log("[proxy:workers-dev] \(event)", onOutput: onOutput) })
        let url: URL
        do {
            url = try await proxy.start()
        } catch {
            await supervisor.stop()
            await bridgeHandle.terminate()
            throw LocalContainerError.bootFailed("workers-dev proxy start failed: \(error)")
        }

        await live.storeWorkersDev(siteID: siteID, supervisor: supervisor, bridge: bridgeHandle, proxy: proxy)
        return url
    }

    /// See `LocalContainerControl.stopWorkersDev` for the full contract.
    public func stopWorkersDev(siteID: String) async throws {
        await live.teardownWorkersDev(siteID: siteID)
    }

    /// Phases 0–2 of `start()`: resolve bundled artifacts, unpack rootfs/initfs, boot the VM.
    /// `sourceRepo: nil` boots a bare container (no virtio-fs share) — used by the vsock e2e test.
    /// Does NOT register the container in `live` — the caller owns its lifecycle (either `start()`'s
    /// own phases 3–6 followed by `live.store`, or a test calling `stopBareContainer` directly).
    ///
    /// `public` (rather than `internal`) so `anglesite-container-probe` — a standalone executable
    /// that can't `@testable import` — can drive the same bare-boot path entitled with
    /// `com.apple.security.virtualization`, which `swift test`'s own runner can never carry. Still
    /// not part of the `LocalContainerControl` protocol seam; only test/probe code calls it directly.
    /// `onOutput` streams boot-phase progress (see #498 — this phase previously ran silently, so a
    /// VZ boot hang looked identical to nothing having started at all). Defaults to a no-op so the
    /// vsock e2e test and `anglesite-container-probe` (neither wired to a `LogCenter`) don't need
    /// updating.
    public func makeBareContainer(
        siteID: String,
        sourceRepo: URL? = nil,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void = { _, _ in }
    ) async throws -> LinuxContainer {
        // 0. Resolve the writable image store + boot artifacts. Missing artifacts are typed
        //    provisioning errors, surfaced as `imageUnavailable` instead of a silent mis-boot.
        onOutput("[boot] resolving bundled image/kernel artifacts", .stdout)
        let storeURL: URL
        let imageLayoutURL: URL
        let kernelURL: URL
        let initfsLayoutURL: URL
        do {
            storeURL = try BundledImage.storeURL()
            imageLayoutURL = try imageLayoutURLOverride ?? BundledImage.layoutURL()
            kernelURL = try BundledImage.kernelURL()
            initfsLayoutURL = try BundledImage.initfsLayoutURL()
        } catch {
            onOutput("[boot] artifact resolution failed: \(error)", .stderr)
            throw LocalContainerError.imageUnavailable("\(error)")
        }

        // The two ext4 artifacts we materialize below are tracked so teardown can delete them
        // (otherwise disk grows per start/stop). Both are site-scoped so concurrent starts don't race.
        let rootfsURL = storeURL.appendingPathComponent("rootfs-\(siteID).ext4")
        let initfsURL = storeURL.appendingPathComponent("initfs-\(siteID).ext4")
        // A prior run for this siteID may have left these behind — normal teardown deletes them,
        // but a force-quit, crash, or OS restart skips that cleanup. `EXT4Unpacker.unpack(at:)`
        // refuses to overwrite an existing block device file, so a stale leftover would otherwise
        // block every subsequent start for the same site. A fresh boot never wants to reuse the
        // previous run's rootfs, so clear both unconditionally before unpacking.
        try Self.removeStaleExt4Artifact(at: rootfsURL, label: "rootfs", onOutput: onOutput)
        try Self.removeStaleExt4Artifact(at: initfsURL, label: "initfs", onOutput: onOutput)

        // 1. Import the bundled OCI layouts into the on-disk ImageStore and unpack to bootable mounts.
        //    `loadOrGet` re-imports whenever the bundled layout changed since the last import (#549),
        //    so app updates that ship a new image actually take effect. `load(from:)` also needs to
        //    write into the layout directory itself (not just the store), so both layouts are staged
        //    to a writable copy first — the bundled originals are read-only.
        let rootfs: Containerization.Mount
        let initfs: Containerization.Mount
        do {
            onOutput("[boot] importing OCI layouts into image store", .stdout)
            // Process-shared, NOT constructed per boot: ImageStore's internal AsyncLock is
            // per-instance, and the orphaned-blob cleanup below is only safe against another
            // window's concurrent import if both go through the same lock (#573).
            let store = try SharedImageStore.store(at: storeURL)

            // App image -> ext4 rootfs mount.
            let stagedImageLayout = try BundledImage.stagedLayoutURL(source: imageLayoutURL, name: "app-image")
            let appImage = try await loadOrGet(
                store, layout: stagedImageLayout, reference: BundledImage.imageReference,
                artifactName: "app-image", storeRoot: storeURL)
            // Materialize one pristine rootfs per image digest, then APFS-clone it for each boot.
            // `EXT4Unpacker` walks every OCI entry through an in-memory path tree; the bundled
            // toolchain makes that first import expensive, while `Mount.clone(to:)` is copy-on-write
            // and near-instant. The digest-keyed template stays immutable and automatically rolls
            // forward when an app update ships a different image.
            rootfs = try await RootfsTemplateCache.shared.clone(
                image: appImage,
                storeRoot: storeURL,
                destination: rootfsURL,
                onOutput: onOutput
            )

            // vminit initfs OCI layout -> ext4 init mount (the guest-agent root filesystem).
            let stagedInitfsLayout = try BundledImage.stagedLayoutURL(source: initfsLayoutURL, name: "vminit-initfs")
            let initImageRef = "vminit:latest"
            let initImage = InitImage(image: try await loadOrGet(
                store, layout: stagedInitfsLayout, reference: initImageRef,
                artifactName: "vminit-initfs", storeRoot: storeURL))
            onOutput("[boot] unpacking vminit initfs to ext4", .stdout)
            initfs = try await initImage.initBlock(at: initfsURL, for: .linuxArm)

            // Reclaim blobs orphaned by a #549 re-import — after one, the previous image's whole
            // blob set (hundreds of MB) sits unreferenced in the content store forever (#573).
            // Runs every boot (not just after a re-import) so it also self-heals orphans left by
            // app updates that predate this cleanup, and a failed pass just retries next boot.
            // Safe while other windows boot concurrently: the shared store above means this
            // serializes on the same AsyncLock as their imports, so it can never delete blobs an
            // in-flight load has ingested but not yet referenced — and it never touches running
            // containers, which read from unpacked ext4 files, not the blob store. Best-effort:
            // a cleanup failure must not fail the boot.
            do {
                let (deleted, freed) = try await store.cleanUpOrphanedBlobs()
                if !deleted.isEmpty {
                    let freedText = ByteCountFormatter.string(
                        fromByteCount: Int64(clamping: freed), countStyle: .file)
                    onOutput("[boot] reclaimed \(deleted.count) orphaned image blob(s), \(freedText)", .stdout)
                }
            } catch {
                onOutput("[boot] orphaned-blob cleanup failed (will retry next boot): \(error)", .stderr)
            }
        } catch {
            // Unpacking may have created partial ext4 files before failing; don't leak them.
            try? FileManager.default.removeItem(at: rootfsURL)
            try? FileManager.default.removeItem(at: initfsURL)
            onOutput("[boot] image import/unpack failed: \(error)", .stderr)
            throw LocalContainerError.imageUnavailable("\(error)")
        }

        // 2. Boot the container: Apple-Silicon VZ-backed VM, NAT outbound, auto vsock device.
        do {
            let kernel = Kernel(path: kernelURL, platform: .linuxArm)
            // Wrapped so a failure inside `container.create()` can reap the VM upstream strands
            // there (apple/containerization#804) — see `OrphanReapingVirtualMachineManager`.
            let vmm = OrphanReapingVirtualMachineManager(
                wrapping: VZVirtualMachineManager(kernel: kernel, initialFilesystem: initfs))

            // Let vmnet choose an available shared-mode subnet. Hard-coding 192.168.64.0/24
            // works only while this is the first vmnet consumer on the host: Apple's container
            // CLI, UTM, or another VM can already own that network, leaving the guest's static
            // route and DNS pointed at a nonexistent gateway (#715). SharedVmnetNetwork keeps one
            // process-wide network, serializes simultaneous site allocations, and releases each
            // interface when its VM stops.
            let allocation = try await network.allocate(siteID: siteID)
            onOutput(
                "[boot] vmnet allocated \(allocation.interface.ipv4Address) "
                    + "with gateway/DNS \(allocation.nameserver)",
                .stdout
            )

            let container = try LinuxContainer(siteID, rootfs: rootfs, vmm: vmm) { config in
                // Keep the init process alive so the VM stays up while we exec into it. A bare
                // `/bin/sh` starts an *interactive* shell — with no controlling TTY and closed
                // stdin it reads EOF and exits almost immediately, racing vmexec's own post-fork
                // bookkeeping (which then fails with ESRCH/"No such process" against the already-
                // dead PID, surfacing as "no PID data from sync pipe" on the very first exec).
                config.process.arguments = ["/bin/sh", "-c", "while true; do sleep 3600; done"]
                config.process.workingDirectory = "/"
                config.cpus = 2
                config.memoryInBytes = 2 * 1024 * 1024 * 1024
                config.interfaces = [allocation.interface]
                config.dns = DNS(nameservers: [allocation.nameserver])
                // Host `Source/` repo shared read-only into the guest via virtio-fs so the guest can
                // `git clone` it (the macOS host path is otherwise invisible to the Linux guest).
                // `Mount.share(source:destination:)` is the host-directory virtio-fs share — confirmed
                // against `Mount.swift:83` and `ContainerTests.swift:628` (`.share(source: directory.path,
                // destination: "/mnt")`); `ro` is honoured (`ContainerTests.swift:3309`). NOT
                // `Mount.sharedMount`, which references a named *pod volume*, not a host path.
                // Only mounted when a repo is provided — the bare vsock-echo e2e test boots with none.
                if let sourceRepo {
                    config.mounts.append(.share(
                        source: sourceRepo.path,
                        destination: Self.repoSharePath,
                        options: ["ro"]
                    ))
                }
            }
            onOutput("[boot] starting Virtualization-framework VM (create+start)", .stdout)
            // `container.create()`/`.start()` can hang rather than throw when the process carries the
            // `com.apple.security.virtualization` entitlement key but isn't actually provisioned to use
            // it (ad-hoc/debug-signed builds — see #498): VZ never surfaces a clean error in that case,
            // so without a bound here `start()` parks forever with nothing logged. `waitUntilServing`
            // already bounds the dev-server-ready check the same way; this mirrors that for VM boot.
            //
            // Deliberately NOT a `withThrowingTaskGroup`/structured-concurrency race: a group awaits
            // every child task before its scope can return, even a cancelled one, so if `create()`/
            // `.start()` doesn't itself observe cancellation (a raw VZ hang may not), a group-based
            // race would still block here until the real call resolves — defeating the timeout. This
            // races via an unstructured `Task`, so a genuine hang leaks that one task but still lets
            // this function return promptly with a diagnosable error.
            //
            // If the boot was merely slow rather than genuinely hung (disk contention, first-run
            // staging), `container.create()`/`.start()` can still succeed AFTER the timeout has already
            // failed this call and the caller has moved on. `onLateSuccess` tears that VM down instead
            // of leaking it — otherwise nothing else in the process ever holds a reference to it, and
            // it would keep consuming host resources (2 vCPU/2GB) until the app quits, one leak per
            // timed-out retry.
            let timeoutError = VMBootTimeoutError(
                message: "VM did not finish booting within \(Self.vmBootTimeout) — the process may carry the "
                    + "virtualization entitlement without being provisioned to actually use it (ad-hoc/"
                    + "debug-signed builds); Virtualization framework can hang rather than throw in that case"
            )
            let bootedContainer = try await Self.racingTimeout(
                timeout: Self.vmBootTimeout,
                timeoutError: timeoutError,
                onLateSuccess: { lateContainer in
                    onOutput(
                        "[boot] VM finished booting after its \(Self.vmBootTimeout) timeout already failed "
                        + "this request; stopping it now to avoid an orphaned VM", .stderr)
                    Task {
                        await self.stopBareContainer(lateContainer, siteID: siteID)
                        // If `container.stop()` failed inside (it's best-effort `try?`), the VM is
                        // still `.running` and the reap catches it; otherwise the reap sees
                        // `.stopped` and does nothing.
                        await vmm.reapStranded(onOutput: onOutput)
                    }
                }
            ) {
                do {
                    try await container.create()
                    try await container.start()
                    return container
                } catch {
                    // This also covers a failure that arrives after the timeout already won.
                    // `stopBareContainer` (not a bare `network.release`) mirrors `onLateSuccess`
                    // above: `container.stop()` is a no-op via `try?` when `create()`/`.start()`
                    // never reached `.created`/`.started` state (#785), but it DOES matter when
                    // `.start()` fails after `.create()` already succeeded — that path leaves the
                    // VM in `.created` state, and only an explicit `stop()` releases it instead of
                    // leaking it until the app quits.
                    await stopBareContainer(container, siteID: siteID)
                    // And when `create()` itself threw at its internal `vm.start()`, the container
                    // never reached `.created`, so the `container.stop()` above can't touch the VM
                    // — that's the upstream gap (apple/containerization#804). The wrapper holds the
                    // only other reference to it; stop it through that.
                    await vmm.reapStranded(onOutput: onOutput)
                    throw error
                }
            }
            onOutput("[boot] VM started", .stdout)
            return bootedContainer
        } catch {
            let errorDescription = "\(error)"
            let diagnostic = VmnetFailureRecovery.message(for: errorDescription) ?? errorDescription
            onOutput("[boot] VM boot failed: \(diagnostic)", .stderr)
            // A timeout leaves create/start running. Its operation releases on a late failure;
            // onLateSuccess stops the late VM and releases through stopBareContainer. Releasing
            // here would let another site reuse the address while that VM is still starting.
            if !(error is VMBootTimeoutError) {
                await network.release(siteID: siteID)
            }
            try? FileManager.default.removeItem(at: rootfsURL)
            try? FileManager.default.removeItem(at: initfsURL)
            throw LocalContainerError.bootFailed(diagnostic)
        }
    }

    /// Bound on `container.create()`/`.start()` — see the call site's comment on why this exists.
    private static let vmBootTimeout: Duration = .seconds(30)

    /// Bound on `waitUntilServing`'s poll of the preview URL after `astro dev` is launched. Covers
    /// `anglesite-hydrate` rsyncing baked `node_modules` into the freshly-cloned workspace plus astro's
    /// own cold start — the rootfs is recreated per start (#59), so every boot pays this in full, not
    /// just the first. #550's field data: a *minimal* throwaway site took 186s wall-clock; a real
    /// template site with more integrations took 220s. 90s (the old default) failed both. 300s keeps
    /// meaningful margin over the worst observed case without masking a truly hung guest for minutes.
    private static let previewReadyTimeout: Duration = .seconds(300)

    /// Remove a site-scoped ext4 artifact left by an interrupted prior boot before the next unpack.
    ///
    /// `EXT4Unpacker.unpack(at:)` and `InitImage.initBlock(at:)` do not own stale-file recovery:
    /// passing a leftover block device path can fail late with a vague NSPOSIXErrorDomain/ENOTSUP
    /// after the expensive image import/unpack path has already run (#721). Treat inability to clear
    /// the old path as a provisioning failure up front, with the exact artifact path in the log.
    static func removeStaleExt4Artifact(
        at url: URL,
        label: String,
        fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) },
        removeItem: (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) },
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void = { _, _ in }
    ) throws {
        guard fileExists(url.path) else { return }

        onOutput("[boot] removing stale \(label) ext4 artifact at \(url.path)", .stdout)
        do {
            try removeItem(url)
        } catch {
            let message = "could not remove stale \(label) ext4 artifact at \(url.path): \(error)"
            onOutput("[boot] \(message)", .stderr)
            throw LocalContainerError.imageUnavailable(message)
        }

        guard !fileExists(url.path) else {
            let message = "stale \(label) ext4 artifact still exists after removal at \(url.path)"
            onOutput("[boot] \(message)", .stderr)
            throw LocalContainerError.imageUnavailable(message)
        }
    }

    /// Races `operation` against a `timeout`, resolving to whichever finishes first. Unlike a
    /// `withThrowingTaskGroup`-based race, this does NOT wait for `operation` to finish once the
    /// timeout wins — each side runs in its own unstructured `Task` and whichever calls `resumeOnce`
    /// first decides the outcome; the loser (if it's `operation`, having genuinely hung) is simply
    /// abandoned rather than awaited. That's the entire point: a structured race still blocks the
    /// caller until every child task completes, which is exactly what a true VZ hang defeats.
    ///
    /// If `operation` was merely slow rather than hung, it can still succeed after the timeout has
    /// already resolved this call with an error. `onLateSuccess` is the caller's chance to react to
    /// that value — e.g. tear down a resource `operation` produced that nothing else now references —
    /// since the returned/thrown result from this function only ever reflects whichever side won.
    /// `internal` (not `private`) so `RacingTimeoutTests` can exercise it directly via `@testable
    /// import` — it's a pure, generic async primitive with no Virtualization/entitlement dependency,
    /// so it doesn't need `ANGLESITE_CONTAINER_E2E`'s real-hardware gate, just this target's normal
    /// `ANGLESITE_CONTAINER_TESTS` build gate (this whole target only builds locally/opt-in — see the
    /// file-level doc comment on `ContainerizationControlTests`).
    static func racingTimeout<T: Sendable>(
        timeout: Duration,
        timeoutError: @autoclosure @escaping @Sendable () -> Error,
        onLateSuccess: @escaping @Sendable (T) -> Void = { _ in },
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
            let lock = NSLock()
            var resumed = false
            func resumeOnce(_ result: Result<T, Error>) -> Bool {
                lock.lock()
                let alreadyResumed = resumed
                resumed = true
                lock.unlock()
                guard !alreadyResumed else { return false }
                continuation.resume(with: result)
                return true
            }
            Task {
                do {
                    let value = try await operation()
                    if !resumeOnce(.success(value)) {
                        onLateSuccess(value)
                    }
                } catch {
                    _ = resumeOnce(.failure(error))
                }
            }
            Task {
                try? await Task.sleep(for: timeout)
                _ = resumeOnce(.failure(timeoutError()))
            }
        }
    }

    /// Tear down a container produced by `makeBareContainer`, mirroring the ext4-artifact cleanup
    /// `start()`'s own error paths and `LiveContainers.teardown` perform: stop the VM first (releases
    /// the file handles), then remove the backing rootfs/initfs ext4 images. Best-effort — errors from
    /// `container.stop()` are swallowed, matching every other teardown path in this file.
    ///
    /// `public` alongside `makeBareContainer` — see its doc comment.
    public func stopBareContainer(_ container: LinuxContainer, siteID: String) async {
        try? await container.stop()
        await network.release(siteID: siteID)
        guard let storeURL = try? BundledImage.storeURL() else { return }
        try? FileManager.default.removeItem(at: storeURL.appendingPathComponent("rootfs-\(siteID).ext4"))
        try? FileManager.default.removeItem(at: storeURL.appendingPathComponent("initfs-\(siteID).ext4"))
    }

    /// Run `argv` inside the named container as a one-shot guest exec, forwarding `environment`
    /// and `workingDirectory`, streaming each stdout AND stderr line to `onOutput` as it arrives
    /// (many tools, incl. `wrangler`, write progress to stderr), capturing the full stdout + stderr,
    /// and returning the real guest exit code (it does NOT throw on a non-zero exit — the caller maps
    /// the code). Honors task cancellation: a cancelled deploy SIGTERMs the guest process, mirroring
    /// the host path. Mirrors `runToCompletion`'s lifecycle (`exec` -> `start` -> `wait` -> `delete`)
    /// but installs capturing/streaming `Writer`s.
    ///
    /// Env/cwd are set via the real 0.35 `LinuxProcessConfiguration` fields — `arguments`,
    /// `environmentVariables`, `workingDirectory` (`LinuxProcessConfiguration.swift:366-370`) — so
    /// there is no shell wrapping and therefore no shell-metacharacter injection surface: each
    /// `K=V` pair and each argv element is passed literally to the guest agent (no `sh -lc`, no
    /// `env` binary). NOTE: `LinuxContainer.exec` builds a FRESH config, so the image-baked env is
    /// NOT inherited — only the default `PATH` (which covers `/usr/local/bin` for `node:22`, so
    /// `node`/`npm`/`npx`/`wrangler` resolve) plus the caller's `environment` are set. Anything the
    /// deploy toolchain needs beyond PATH must be passed in `environment`.
    public func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        guard let container = await live.container(for: siteID) else {
            throw LocalContainerError.bootFailed("exec: no live container for siteID '\(siteID)'")
        }

        // `onOutput` is `@escaping` (the seam declares it so): the `Writer` sinks below close over it
        // and may legitimately fire it after this function returns (e.g. a kill-triggered final line
        // on cancellation). No `withoutActuallyEscaping` — that wrapper would be UNSOUND here.
        //
        // Two line-splitters, one per stream, each tagging its lines with the stream it owns so the
        // caller can label wrangler's stderr progress correctly (and parse stdout for the URL).
        let stdoutSink = LineStreamingWriter(stream: .stdout, onLine: onOutput)
        let stderrSink = LineStreamingWriter(stream: .stderr, onLine: onOutput)

        // Unique exec id per call so build/preflight/wrangler don't collide on the same vended
        // process name. The label maps each step's argv to a distinct, readable suffix; a short
        // uniquifier guarantees distinctness even if two calls share a label (e.g. two `npx` steps).
        let label = Self.execLabel(for: argv)
        let proc = try await container.exec("\(siteID)-exec-\(label)-\(UUID().uuidString.prefix(8))") { config in
            config.arguments = argv
            // Preserve the default PATH (so argv[0] resolves) and append the caller's env as
            // literal `K=V` argv-style entries — no shell parsing, no escaping bugs, no injection.
            config.environmentVariables =
                ["PATH=\(LinuxProcessConfiguration.defaultPath)"]
                + environment.map { "\($0.key)=\($0.value)" }
            config.workingDirectory = workingDirectory
            config.stdout = stdoutSink
            config.stderr = stderrSink
        }
        try await proc.start()
        // Honor task cancellation for parity with the host deploy path (which SIGTERMs a
        // cancelled deploy): if the deploy task is cancelled mid-`wait()`, signal the guest
        // process so a hung/long `npm install` / `wrangler deploy` can actually be aborted.
        let status = try await withTaskCancellationHandler {
            try await proc.wait()
        } onCancel: {
            // Fire-and-forget SIGTERM. This may land AFTER `proc.delete()` runs below (the cancel
            // handler and the main flow race once `wait()` resumes). That's tolerated: `kill` and
            // `delete` are independent async ops on `LinuxProcess` with no shared guard —
            // `LinuxProcess.kill` (LinuxProcess.swift:307-321) just calls `agent.signalProcess` and
            // *throws* a wrapped `ContainerizationError` if the process is already gone, and our
            // `try?` swallows that throw. Best-effort by construction — we never need the kill to
            // succeed once the process has exited or been deleted.
            Task { try? await proc.kill(.term) }
        }
        try? await proc.delete()

        // `wait()` returns only after the IO streams have drained, so the sinks hold the full
        // output here. Flush any trailing partial (unterminated) line on each stream.
        stdoutSink.flush()
        stderrSink.flush()
        return ContainerExecResult(
            exitCode: status.exitCode,
            stdout: stdoutSink.text,
            stderr: stderrSink.text
        )
    }

    /// A `ReaderStream` fed by explicit `write(_:)` calls rather than a fixed source — the bridge
    /// between `InteractiveExecHandle.write(_:)` and the guest process's stdin. `@unchecked Sendable`
    /// because `AsyncStream.Continuation` is already safe to call concurrently; there is no other
    /// mutable state here.
    private final class PipeReaderStream: ReaderStream, @unchecked Sendable {
        private let backing: AsyncStream<Data>
        private let continuation: AsyncStream<Data>.Continuation

        init() {
            (backing, continuation) = AsyncStream<Data>.makeStream(bufferingPolicy: .unbounded)
        }

        func stream() -> AsyncStream<Data> { backing }
        func write(_ data: Data) { continuation.yield(data) }
        func finish() { continuation.finish() }
    }

    /// Like `exec`, but starts the guest process and returns immediately with a live handle instead
    /// of awaiting completion, and wires `LinuxProcessConfiguration.stdin` so the caller can keep
    /// feeding the process input (an ACP agent's JSON-RPC stdin) for as long as it runs. A detached
    /// task drains `proc.wait()` in the background so the process is still reaped (flushing the
    /// output sinks and calling `proc.delete()`) even though nothing here awaits it synchronously —
    /// mirrors `runDetached`'s reaping story (container `stop()` also SIGKILLs and deletes every
    /// vended process, so a caller that never calls `terminate()` still gets cleaned up on teardown).
    public func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        guard let container = await live.container(for: siteID) else {
            throw LocalContainerError.bootFailed("execInteractive: no live container for siteID '\(siteID)'")
        }

        let stdinStream = PipeReaderStream()
        let stdoutSink = LineStreamingWriter(stream: .stdout, onLine: onOutput)
        let stderrSink = LineStreamingWriter(stream: .stderr, onLine: onOutput)

        let label = Self.execLabel(for: argv)
        let proc = try await container.exec("\(siteID)-interactive-\(label)-\(UUID().uuidString.prefix(8))") { config in
            config.arguments = argv
            config.environmentVariables =
                ["PATH=\(LinuxProcessConfiguration.defaultPath)"]
                + environment.map { "\($0.key)=\($0.value)" }
            config.workingDirectory = workingDirectory
            config.stdin = stdinStream
            config.stdout = stdoutSink
            config.stderr = stderrSink
        }
        try await proc.start()

        Task {
            _ = try? await proc.wait()
            stdoutSink.flush()
            stderrSink.flush()
            try? await proc.delete()
        }

        return InteractiveExecHandle(
            write: { data in stdinStream.write(data) },
            terminate: {
                try? await proc.kill(.term)
                try? await proc.delete()
            }
        )
    }

    /// Maps a step's argv to a short, distinct, readable exec-id label. `npm run build` → `build`,
    /// `npx tsx …pre-deploy-check…` → `preflight`, `npx wrangler deploy` → `wrangler`; anything else
    /// falls back to argv[0]. Both `npx` steps would otherwise collapse to the same prefix.
    private static func execLabel(for argv: [String]) -> String {
        switch argv.first {
        case "npm": return "build"
        case "npx":
            if argv.contains("wrangler") { return "wrangler" }
            if argv.contains(where: { $0.contains("pre-deploy-check") }) { return "preflight" }
            return "npx"
        default: return argv.first ?? "cmd"
        }
    }

    // MARK: - Helpers

    /// Resolve `reference` from the store, importing (or re-importing) the OCI layout as needed.
    ///
    /// The `get(reference:)` fast path is taken only while `OCILayoutImportMarker` confirms the
    /// store's import came from this exact layout. Without that check the first-ever import is
    /// served forever: an app update that ships a new bundled image never reaches the store, and
    /// the guest keeps booting the old rootfs (#549). On mismatch `load(from:)` re-imports —
    /// `ImageStore`'s reference state is an overwrite-on-create map, so loading repoints the tag
    /// to the new image. `artifactName` must match the staging name so marker and staged copy
    /// describe the same artifact.
    private func loadOrGet(
        _ store: ImageStore,
        layout: URL,
        reference: String,
        artifactName: String,
        storeRoot: URL
    ) async throws -> Containerization.Image {
        if OCILayoutImportMarker.isCurrent(layout: layout, name: artifactName, storeRoot: storeRoot),
            let existing = try? await store.get(reference: reference) {
            return existing
        }
        let loaded = try await store.load(from: layout)
        // Best-effort: a failed marker write only costs a redundant re-import next boot.
        try? OCILayoutImportMarker.recordImported(layout: layout, name: artifactName, storeRoot: storeRoot)
        if let match = try? await store.get(reference: reference) {
            return match
        }
        // `get(reference:)` missed even after load. Only fall back to the loaded image if the layout
        // is unambiguous (exactly one image) — otherwise we'd risk silently booting the wrong one.
        guard loaded.count == 1, let only = loaded.first else {
            throw LocalContainerError.imageUnavailable(
                "OCI layout at \(layout.path) imported \(loaded.count) images; reference \(reference) not resolvable")
        }
        return only
    }

    /// Poll the preview URL through the host proxy until the guest dev server answers, or time out.
    /// Bounded and cancellation-aware: each `Task.sleep` throws `CancellationError` if the start task
    /// is cancelled, and the overall wait is capped so a never-ready server doesn't hang `start()`.
    ///
    /// Uses a raw, deliberately-paced socket probe rather than `URLSession` (see `probeOnce`):
    /// `URLSession.data(for:)` silently retries a lost connection internally for idempotent GET
    /// requests, up to its own `timeoutInterval` — observed hammering the vsock proxy at a rate far
    /// higher than this function's own 500ms interval (sub-millisecond, per #69's live smoke), which
    /// is suspected of destabilizing the virtio-vsock transport itself: every attempt failed
    /// identically for the full timeout window, even long after the guest server was confirmed
    /// ready. One clean attempt per interval removes that confound.
    private func waitUntilServing(
        _ url: URL,
        timeout: Duration = .seconds(90),
        interval: Duration = .milliseconds(500)
    ) async throws {
        guard let port = url.port, let portValue = UInt16(exactly: port) else {
            throw LocalContainerError.bootFailed("waitUntilServing: URL has no valid port: \(url.absoluteString)")
        }
        let deadline = ContinuousClock.now.advanced(by: timeout)
        var lastError: String?
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            if let error = Self.probeOnce(port: portValue) {
                lastError = error
            } else {
                return
            }
            try await Task.sleep(for: interval)
        }
        throw LocalContainerError.bootFailed(
            "timed out after \(timeout) waiting for \(url.absoluteString)"
            + (lastError.map { "; last error: \($0)" } ?? ""))
    }

    /// One deliberate readiness probe: connect, send a minimal HTTP/1.0 GET, and confirm at least one
    /// byte comes back. Returns `nil` on success, or a description of what failed. Uses raw POSIX
    /// sockets (matching `VsockTCPProxy`'s style) so there is no hidden retry/pipelining behavior
    /// between here and the wire.
    private static func probeOnce(port: UInt16) -> String? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return "socket() failed: errno=\(errno)" }
        defer { close(fd) }

        var tv = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        // Non-blocking connect with a bounded (2s) deadline: a plain blocking connect() has no
        // timeout of its own — SO_RCVTIMEO/SO_SNDTIMEO above only bound the read()/write() below —
        // so a stuck handshake could hang this probe well past its intended ~500ms poll cadence.
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        let connectRC = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if connectRC != 0 {
            guard errno == EINPROGRESS else { return "connect() failed: errno=\(errno)" }
            var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            let pollRC = poll(&pfd, 1, 2000)
            guard pollRC > 0 else {
                return pollRC == 0 ? "connect() timed out after 2s" : "poll() failed: errno=\(errno)"
            }
            var soError: Int32 = 0
            var soErrorLen = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &soError, &soErrorLen)
            guard soError == 0 else { return "connect() failed: errno=\(soError)" }
        }
        // Restore blocking mode: the read()/write() below rely on SO_RCVTIMEO/SO_SNDTIMEO, which
        // only bound blocking calls (a non-blocking read/write would just return EAGAIN instantly).
        _ = fcntl(fd, F_SETFL, flags)

        let request = Array("GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n".utf8)
        let sent = request.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
        guard sent > 0 else { return "write() failed: errno=\(errno)" }

        var buffer = [UInt8](repeating: 0, count: 16)
        let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
        guard n > 0 else { return "read() after connect returned \(n); errno=\(errno)" }
        return nil
    }

    /// Run a guest process to completion, throwing if it exits non-zero. When `onOutput` is
    /// provided, the process's stdout/stderr stream to it line-by-line tagged `[id]` — without
    /// this, a failing step (e.g. `git clone`) dies with only an exit code and no diagnostic.
    private func runToCompletion(
        _ container: LinuxContainer, id: String,
        onOutput: (@Sendable (String, LogCenter.Stream) -> Void)? = nil,
        _ argv: [String]
    ) async throws {
        let stdoutSink: LineStreamingWriter?
        let stderrSink: LineStreamingWriter?
        if let onOutput {
            let tag: @Sendable (String, LogCenter.Stream) -> Void = { line, stream in
                onOutput("[\(id)] \(line)", stream)
            }
            stdoutSink = LineStreamingWriter(stream: .stdout, onLine: tag)
            stderrSink = LineStreamingWriter(stream: .stderr, onLine: tag)
        } else {
            stdoutSink = nil
            stderrSink = nil
        }
        let proc = try await container.exec(id) { config in
            config.arguments = argv
            if let stdoutSink { config.stdout = stdoutSink }
            if let stderrSink { config.stderr = stderrSink }
        }
        try await proc.start()
        let status = try await proc.wait()
        // `wait()` returns only after the IO streams have drained — flush any trailing partial
        // (unterminated) line on each stream, same as `exec()` below.
        stdoutSink?.flush()
        stderrSink?.flush()
        try? await proc.delete()
        guard status.exitCode == 0 else {
            throw LocalContainerError.cloneFailed("`\(argv.joined(separator: " "))` exited \(status.exitCode)")
        }
    }

    /// Writes `contents` to `path` inside the guest via a one-shot `sh -c "echo <b64> | base64 -d
    /// > path"`, base64-encoding the text first (avoiding any shell-quoting/escaping surface for
    /// `contents`, which is a generated wrangler.toml — untrusted only in the sense that it embeds
    /// a site name, already validated by `WorkerComposition.isValidSiteName`).
    private func writeGuestFile(
        _ container: LinuxContainer, path: String, contents: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws {
        let encoded = Data(contents.utf8).base64EncodedString()
        try await runToCompletion(container, id: "write-\(path.replacingOccurrences(of: "/", with: "-"))",
            onOutput: onOutput,
            ["sh", "-c", "echo \(encoded) | base64 -d > \(path)"])
    }

    /// Start a guest process detached (no `wait`), e.g. a long-running dev server. Its stdout/stderr
    /// stream to `onOutput` live via `LineStreamingWriter`, each line prefixed `[label]` so a single
    /// stream can distinguish astro/mcp/bridge output — this is the only visibility into the guest
    /// during boot (see #69: previously these ran with no output capture at all).
    ///
    /// We intentionally do NOT `delete()` these processes here, unlike `runToCompletion`. Teardown
    /// relies on `LinuxContainer.stop()` to reap them: `stop()` issues `agent.kill(pid: -1, SIGKILL)`
    /// and then iterates `vendedProcesses` calling `_delete()` on each before stopping the VM
    /// (`LinuxContainer.swift:803` and `:835-851`). Every `exec`'d process is registered in
    /// `vendedProcesses`, so stopping the container cleans them all up — no per-process tracking needed.
    ///
    /// `public` alongside `makeBareContainer`/`stopBareContainer` — see `makeBareContainer`'s doc
    /// comment. The vsock echo probe/test use this to start the guest `socat` echo listener.
    public func runDetached(
        _ container: LinuxContainer,
        id: String,
        label: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        _ argv: [String]
    ) async throws {
        let tag: @Sendable (String, LogCenter.Stream) -> Void = { line, stream in
            onOutput("[\(label)] \(line)", stream)
        }
        let stdoutSink = LineStreamingWriter(stream: .stdout, onLine: tag)
        let stderrSink = LineStreamingWriter(stream: .stderr, onLine: tag)
        let proc = try await container.exec(id) { config in
            config.arguments = argv
            config.stdout = stdoutSink
            config.stderr = stderrSink
        }
        try await proc.start()
    }
}

/// Builds one immutable EXT4 rootfs per OCI image digest, then gives every container boot an APFS
/// copy-on-write clone. The actor plus `inFlight` task are both required: actors are re-entrant at
/// `await`, so actor isolation alone would still let two windows start two expensive unpack jobs.
private actor RootfsTemplateCache {
    static let shared = RootfsTemplateCache()

    private static let prefix = "rootfs-template-"
    private static let size: UInt64 = 8 * 1024 * 1024 * 1024
    private var inFlight: [String: Task<URL, Error>] = [:]

    func clone(
        image: Containerization.Image,
        storeRoot: URL,
        destination: URL,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> Containerization.Mount {
        let digest = image.digest.replacingOccurrences(of: ":", with: "-")
        let templateURL = storeRoot.appendingPathComponent(Self.prefix + digest + ".ext4")
        let fileManager = FileManager.default

        if !fileManager.fileExists(atPath: templateURL.path) {
            let task: Task<URL, Error>
            if let existing = inFlight[digest] {
                onOutput("[boot] waiting for another window to prepare the app rootfs", .stdout)
                task = existing
            } else {
                onOutput("[boot] preparing app rootfs for this image (first launch only)", .stdout)
                let buildingURL = storeRoot.appendingPathComponent(
                    Self.prefix + digest + ".building-" + UUID().uuidString + ".ext4"
                )
                task = Task<URL, Error> {
                    defer { try? fileManager.removeItem(at: buildingURL) }
                    _ = try await EXT4Unpacker(blockSizeInBytes: Self.size)
                        .unpack(image, for: .current, at: buildingURL)

                    // A second app process may have won the same race. Its completed template is
                    // equivalent (the digest is the identity), so discard ours instead of replacing it.
                    if fileManager.fileExists(atPath: templateURL.path) {
                        return templateURL
                    }
                    do {
                        try fileManager.moveItem(at: buildingURL, to: templateURL)
                    } catch {
                        // `fileExists` + `moveItem` cannot be atomic across app processes. If a
                        // peer published the same digest in that gap, its immutable template is
                        // exactly equivalent; reuse it instead of failing this site's boot.
                        guard fileManager.fileExists(atPath: templateURL.path) else { throw error }
                    }
                    return templateURL
                }
                inFlight[digest] = task
            }

            do {
                _ = try await task.value
                inFlight[digest] = nil
            } catch {
                inFlight[digest] = nil
                throw error
            }
        } else {
            onOutput("[boot] reusing cached app rootfs", .stdout)
        }

        onOutput("[boot] cloning app rootfs for this site", .stdout)
        let templateMount = Containerization.Mount.block(
            format: "ext4",
            source: templateURL.path,
            destination: "/"
        )
        let cloned = try templateMount.clone(to: destination.path)
        removeSupersededTemplates(keeping: templateURL, in: storeRoot, onOutput: onOutput)
        return cloned
    }

    /// Reclaim completed templates from older bundled-image digests. Site VMs mount their own
    /// copy-on-write clones, never the immutable template, so cleanup is safe after this boot's
    /// clone exists. `.building-*` files are deliberately excluded because another app process
    /// may still be producing one; its own task removes that file on success or failure.
    private func removeSupersededTemplates(
        keeping current: URL,
        in storeRoot: URL,
        onOutput: @Sendable (String, LogCenter.Stream) -> Void
    ) {
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: storeRoot,
            includingPropertiesForKeys: nil
        ) else { return }

        var removed = 0
        for candidate in contents {
            let name = candidate.lastPathComponent
            guard candidate != current,
                  name.hasPrefix(Self.prefix),
                  name.hasSuffix(".ext4"),
                  !name.contains(".building-") else { continue }
            do {
                try FileManager.default.removeItem(at: candidate)
                removed += 1
            } catch {
                onOutput("[boot] stale rootfs-template cleanup failed for \(name): \(error)", .stderr)
            }
        }
        if removed > 0 {
            onOutput("[boot] reclaimed \(removed) superseded rootfs template(s)", .stdout)
        }
    }
}

/// Actor box holding the live container + proxies + on-disk ext4 artifacts keyed by siteID.
actor LiveContainers {
    private var containers: [String: LinuxContainer] = [:]
    private var proxies: [String: [VsockTCPProxy]] = [:]
    /// Per-site ext4 files (rootfs + initfs) to delete on teardown so disk doesn't grow per start/stop.
    private var ext4Artifacts: [String: [URL]] = [:]
    /// The workers-dev supervisor + its own proxy + its own vsock bridge, present only while
    /// `startWorkersDev` has an active session for that site — absent entirely for a static-only
    /// site. Unlike astro/mcp's bridges (which only ever need reaping once, at full container
    /// teardown), this bridge can be started and torn down many times across one container's
    /// life — every `startWorkersDev` call, including a future toggle-restart via
    /// `updateActiveWorkers` — so it's tracked here and explicitly terminated in
    /// `teardownWorkersDev`, not left for `LinuxContainer.stop()` to reap.
    private var workersDevSupervisors: [String: GuestProcessSupervisor] = [:]
    private var workersDevProxies: [String: VsockTCPProxy] = [:]
    private var workersDevBridges: [String: InteractiveExecHandle] = [:]

    func container(for siteID: String) -> LinuxContainer? { containers[siteID] }

    func store(siteID: String, container: LinuxContainer, proxies ps: [VsockTCPProxy], ext4Artifacts artifacts: [URL]) {
        containers[siteID] = container
        proxies[siteID] = ps
        ext4Artifacts[siteID] = artifacts
    }

    func storeWorkersDev(
        siteID: String, supervisor: GuestProcessSupervisor, bridge: InteractiveExecHandle, proxy: VsockTCPProxy
    ) {
        workersDevSupervisors[siteID] = supervisor
        workersDevBridges[siteID] = bridge
        workersDevProxies[siteID] = proxy
    }

    func workersDevSupervisor(for siteID: String) -> GuestProcessSupervisor? { workersDevSupervisors[siteID] }

    /// Stops just the workers-dev process + its bridge + its proxy for `siteID`, leaving
    /// astro/mcp/the container itself untouched — used both for an explicit `stopWorkersDev` call
    /// and as the first step of a full `teardown`.
    func teardownWorkersDev(siteID: String) async {
        if let supervisor = workersDevSupervisors[siteID] { await supervisor.stop() }
        workersDevSupervisors[siteID] = nil
        if let bridge = workersDevBridges[siteID] { await bridge.terminate() }
        workersDevBridges[siteID] = nil
        if let proxy = workersDevProxies[siteID] { await proxy.stop() }
        workersDevProxies[siteID] = nil
    }

    func teardown(siteID: String) async {
        await teardownWorkersDev(siteID: siteID)
        for p in proxies[siteID] ?? [] { await p.stop() }
        proxies[siteID] = nil
        // Stop the VM first (releases the file handles), then remove the backing ext4 images.
        if let c = containers[siteID] { try? await c.stop() }
        containers[siteID] = nil
        for url in ext4Artifacts[siteID] ?? [] {
            try? FileManager.default.removeItem(at: url)
        }
        ext4Artifacts[siteID] = nil
    }
}

/// A Containerization `Writer` that splits the guest stream into newline-delimited lines, forwarding
/// each completed line to `onLine` as it arrives (live streaming) while also accumulating the full
/// raw text. Bytes are buffered until a `\n` is seen so a chunk that splits mid-line doesn't emit a
/// partial line; `flush()` (called after `wait()`) emits any trailing unterminated line.
///
/// Single-handler invocation (one `FileHandle` readability handler) means no concurrent access, so
/// `@unchecked Sendable` is safe here exactly as for the upstream test `BufferWriter`.
final class LineStreamingWriter: @unchecked Sendable, Writer {
    private let stream: LogCenter.Stream
    private let onLine: @Sendable (String, LogCenter.Stream) -> Void
    private var pending = Data()   // bytes after the last emitted newline
    private var full = Data()      // entire raw stream, for `text`

    init(stream: LogCenter.Stream, onLine: @escaping @Sendable (String, LogCenter.Stream) -> Void) {
        self.stream = stream
        self.onLine = onLine
    }

    var text: String { String(decoding: full, as: UTF8.self) }

    func write(_ data: Data) throws {
        guard !data.isEmpty else { return }
        full.append(data)
        pending.append(data)
        let newline = UInt8(ascii: "\n")
        while let idx = pending.firstIndex(of: newline) {
            let lineData = pending[pending.startIndex..<idx]
            onLine(String(decoding: lineData, as: UTF8.self), stream)
            pending = Data(pending[pending.index(after: idx)...])
        }
    }

    func close() throws {}

    /// Emit any buffered bytes that were never newline-terminated as a final line.
    func flush() {
        guard !pending.isEmpty else { return }
        onLine(String(decoding: pending, as: UTF8.self), stream)
        pending.removeAll()
    }
}

/// Caps how often an identical diagnostic message reaches `LogCenter` (see the proxy `onEvent`/
/// `onDialError` wiring in `start()`): the first few occurrences always log, then only every 100th,
/// each with a running count — enough to see a storm is happening and how big, without it evicting
/// unrelated one-time boot lines (astro/mcp/bridge startup) out of the bounded ring buffer.
final class EventRateLimiter: @unchecked Sendable {
    private let lock = NSLock()
    private var counts: [String: Int] = [:]

    /// Rate-limits by a key derived from `message` — everything before the first `": "` — rather
    /// than the full string. Callers interpolate variable detail after a colon (an error's
    /// description, an errno value's underlying message, etc.); keying on the full text would let
    /// that detail vary per occurrence and fragment the count into one dictionary entry per call,
    /// silently defeating the throttle (and growing `counts` unboundedly) for exactly the messages
    /// most likely to repeat during a real failure storm.
    func log(_ message: String, onOutput: @Sendable (String, LogCenter.Stream) -> Void) {
        let key: String
        if let colonSpace = message.range(of: ": ") {
            key = String(message[..<colonSpace.lowerBound])
        } else {
            key = message
        }

        lock.lock()
        let count = (counts[key] ?? 0) + 1
        counts[key] = count
        lock.unlock()

        guard count <= 5 || count % 100 == 0 else { return }
        onOutput("\(message) (occurrence #\(count))", .stderr)
    }
}
