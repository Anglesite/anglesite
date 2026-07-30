import Foundation

// MARK: - Types

/// Identifies one logical step in the deploy sequence.
public enum DeployStep: Sendable {
    /// `npm run build` — produces `dist/`.
    case build
    /// `npx tsx scripts/pre-deploy-check.ts --json` — the bundled plugin's security scan.
    case preflight
    /// `wrangler deploy` — publishes the built site to Cloudflare Workers.
    case wrangler
    /// Tars `Source/` and uploads it to the site's configured R2 bucket via `wrangler r2 object
    /// put` — the code side of a future Worker-triggered bake (#799, spec §C.4). Only reached
    /// when `.site-config`'s `CF_SOURCE_BUCKET` is set; `DeployCommand.deploy` skips this step
    /// entirely otherwise (today, for every site — no provisioning flow writes that key yet).
    case bundleUpload
}

/// The result of running a single deploy step.
///
/// - `exitCode`: the process exit code, or `nil` for pre-spawn failures (resolver reported
///   `.unavailable`, or the process could not be spawned at all). Mirrors the `exitCode`
///   convention in `DeployCommand.Result.failed`.
/// - `output`: captured stdout, used for URL/scan parsing by the caller. Also streamed
///   line-by-line to `LogCenter` under the caller-supplied source during execution.
public struct DeployStepResult: Sendable, Equatable {
    public let exitCode: Int32?
    public let output: String

    public init(exitCode: Int32?, output: String) {
        self.exitCode = exitCode
        self.output = output
    }
}

// MARK: - Protocol

/// Abstraction over the execution substrate for one deploy step.
///
/// `HostDeployExecutor` is retained as the generic process-backed executor for tests and injected
/// tooling. Its production defaults fail explicitly after host Node retirement; deploys should use
/// `ContainerDeployExecutor` once a container control is available.
///
/// The `source` parameter is the `LogCenter` source tag (e.g. `"deploy:<id>:build"`,
/// `"deploy:<id>"`). Callers supply it so the right log row receives the output.
public protocol DeployExecutor: Sendable {
    func run(
        step: DeployStep,
        siteDirectory: URL,
        environment: [String: String],
        source: String
    ) async -> DeployStepResult

    /// Paths this deploy provider affirmatively owns (e.g. ACME managed-TLS challenge paths) —
    /// see docs/superpowers/specs/2026-07-14-well-known-support-design.md. Defaults to no claims;
    /// override only when this executor can prove ownership, never speculatively.
    func reportOwnedPathClaims() async -> [RuntimeOwnedPathClaim]

    /// Runs the `.build` step with `claimManifest` made available to the build, returning the
    /// observed `.well-known` artifact inventory and findings alongside the normal step result.
    /// Defaults to `.unsupported` — #744 must not claim cross-owner collision protection when
    /// this returns `.unsupported`.
    func runBuildWithClaimManifest(
        siteDirectory: URL,
        environment: [String: String],
        source: String,
        claimManifest: WellKnownClaimManifest
    ) async -> WellKnownBuildSeamOutcome
}

public extension DeployExecutor {
    func reportOwnedPathClaims() async -> [RuntimeOwnedPathClaim] { [] }

    func runBuildWithClaimManifest(
        siteDirectory: URL,
        environment: [String: String],
        source: String,
        claimManifest: WellKnownClaimManifest
    ) async -> WellKnownBuildSeamOutcome {
        .unsupported
    }
}

// MARK: - ContainerDeployExecutor

/// Runs deploy steps inside a running container via `LocalContainerControl.exec`.
///
/// The site is cloned to `/workspace/site` in the guest at boot time; Node 22 and the
/// site's `node_modules` are already installed there. Each step is mapped to an in-guest
/// argv and executed at that working directory.
///
/// `CLOUDFLARE_API_TOKEN` is forwarded through the `environment` dict that the caller
/// supplies — it is never added here and never written to logs.
public struct ContainerDeployExecutor: DeployExecutor {
    private let control: any LocalContainerControl
    private let siteID: String
    private let logCenter: LogCenter

    public init(
        control: any LocalContainerControl,
        siteID: String,
        logCenter: LogCenter = .shared
    ) {
        self.control = control
        self.siteID = siteID
        self.logCenter = logCenter
    }

    // MARK: DeployExecutor

    public func run(
        step: DeployStep,
        siteDirectory: URL,
        environment: [String: String],
        source: String
    ) async -> DeployStepResult {
        // `siteDirectory` is the HOST path — the guest always uses /workspace/site.
        //
        // #1084: `/workspace/site` is a one-time `git clone` taken when the container booted
        // (`ContainerizationControl.start`) — it only reflects whatever was committed at that
        // moment. `SocialWorkerProvisionCommand.persistConfig`/`WorkerNameRename.apply` write the
        // site's concrete `wrangler.toml` (worker bindings, `main`, resource ids) straight to this
        // HOST directory as an uncommitted change, so a container that booted before that write
        // (the common case — the preview container is already running when the owner turns on a
        // social feature and deploys) still has the ORIGINAL static-only `wrangler.toml` in its
        // clone. Without re-syncing here, `wrangler deploy` publishes an assets-only Worker with no
        // `main` script attached at all, even though the host's `wrangler.toml` is correct — every
        // dynamic route 404s and `wrangler tail` refuses to attach. Only `.wrangler` needs this:
        // `astro build` and the preflight scan never read `wrangler.toml` (confirmed against
        // `Resources/Template`), so re-syncing before them would be pure overhead.
        if step == .wrangler, let syncArgv = Self.wranglerTomlSyncArgv(hostSiteDirectory: siteDirectory) {
            do {
                let syncResult = try await control.exec(
                    siteID: siteID,
                    argv: syncArgv,
                    environment: [:],
                    workingDirectory: "/workspace/site",
                    onOutput: { _, _ in }
                )
                guard syncResult.exitCode == 0 else {
                    return DeployStepResult(
                        exitCode: nil,
                        output: "couldn't sync wrangler.toml into the container (exit \(syncResult.exitCode))"
                    )
                }
            } catch is CancellationError {
                return DeployStepResult(exitCode: nil, output: "")
            } catch {
                return DeployStepResult(exitCode: nil, output: "couldn't sync wrangler.toml into the container: \(error)")
            }
        }
        let argv = Self.guestArgv(for: step, siteDirectory: siteDirectory)
        // Stream guest output to LogCenter LIVE (matching the host path): the `@escaping @Sendable`
        // `onOutput` callback yields each (line, stream) into an AsyncStream (`yield` is nonisolated
        // + Sendable, so it's safe from the closure even when fired after `exec` returns), and a
        // DETACHED task drains it, appending to the actor-isolated LogCenter under the line's own
        // stream (so wrangler's stderr progress is labelled `.stderr`, not mislabelled `.stdout`).
        //
        // The drain is `Task.detached`, NOT `async let`: a structured child is cancelled the instant
        // this task is cancelled — *before* it consumes the buffered lines — which would silently
        // drop the kill-triggered final log lines. A detached task is independent of structured
        // cancellation, so it drains exactly what was yielded. We `continuation.finish()` then
        // `await drain.value` on EVERY exit path, so no line leaks and the drain always completes.
        // Never log the environment dict — CLOUDFLARE_API_TOKEN stays off disk and out of logs.
        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        let logCenter = self.logCenter
        let drain = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }
        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: argv,
                environment: Self.guestEnvironment(from: environment),
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch is CancellationError {
            // A cancelled deploy: drain whatever the kill-triggered output produced, then surface a
            // termination (nil exitCode, empty output). `DeployCommand` checks `Task.isCancelled`
            // and renders "terminated" — we must NOT bury cancellation under a generic exec-error
            // string. (The `DeployExecutor` seam is non-throwing, so we signal termination via the
            // nil/empty result rather than re-throwing; `Task.isCancelled` carries the intent.)
            continuation.finish()
            _ = await drain.value
            return DeployStepResult(exitCode: nil, output: "")
        } catch let error as LocalContainerError {
            continuation.finish()
            _ = await drain.value
            // A dead/never-booted container surfaces as `.bootFailed`; give the user an actionable
            // message instead of the raw error (the Deploy-button gating half lives app-side).
            if case .bootFailed = error {
                return DeployStepResult(
                    exitCode: nil,
                    output: "Container isn't running — open/start the site's preview first.")
            }
            return DeployStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        } catch let error {
            continuation.finish()
            _ = await drain.value
            return DeployStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        }
        continuation.finish()
        _ = await drain.value
        return DeployStepResult(exitCode: result.exitCode, output: result.stdout)
    }

    // MARK: Well-known claim manifest seam (#748)

    /// Marks the boundary in `.build` stdout between ordinary build output and the seam's JSON
    /// result blob. `wellKnownSeamArgv`'s guest script echoes this line itself, after the build
    /// exits — a future template-side consumer (#744) only needs to write its result JSON to
    /// `wellKnownResultGuestPath`; it must NOT also echo this marker itself, or the script's own
    /// `cat` would emit it twice and break the host-side split.
    static let wellKnownResultMarker = "---ANGLESITE-WELLKNOWN-RESULT---"
    /// Guest-side scratch path for the incoming manifest — deliberately under `/tmp`, never
    /// `/workspace/site` (the guest's clone of `Source/`).
    static let wellKnownManifestGuestPath = "/tmp/anglesite-wellknown-manifest.json"
    /// Guest-side scratch path a future build script writes its result JSON to — also `/tmp`,
    /// for the same "never inside Source/" reason.
    static let wellKnownResultGuestPath = "/tmp/anglesite-wellknown-result.json"

    public func runBuildWithClaimManifest(
        siteDirectory: URL,
        environment: [String: String],
        source: String,
        claimManifest: WellKnownClaimManifest
    ) async -> WellKnownBuildSeamOutcome {
        guard let manifestData = try? JSONEncoder().encode(claimManifest) else {
            return .completed(
                DeployStepResult(exitCode: nil, output: "couldn't encode well-known claim manifest"),
                WellKnownBuildSeamResult())
        }
        let argv = Self.wellKnownSeamArgv(manifestBase64: manifestData.base64EncodedString())

        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        let logCenter = self.logCenter
        let drain = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }
        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: argv,
                environment: Self.guestEnvironment(from: environment),
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch is CancellationError {
            continuation.finish()
            _ = await drain.value
            return .cancelled
        } catch {
            continuation.finish()
            _ = await drain.value
            return .completed(
                DeployStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)"),
                WellKnownBuildSeamResult())
        }
        continuation.finish()
        _ = await drain.value

        let outputLines = result.stdout.components(separatedBy: "\n")
        let seamResult: WellKnownBuildSeamResult
        let buildOutput: String
        // `lastIndex`, not `firstIndex`: the guest script echoes this marker exactly once, as the
        // last thing it does before `cat`-ing the result file (see `wellKnownSeamArgv` below), so
        // the real split point is always the LAST occurrence in stdout. `firstIndex` would
        // misparse if `npm run build`'s own output ever coincidentally contained this exact line,
        // or if a future #744 build script violated the "never echo this marker yourself"
        // contract documented on `wellKnownResultMarker` above.
        if let markerIndex = outputLines.lastIndex(of: Self.wellKnownResultMarker) {
            buildOutput = outputLines[..<markerIndex].joined(separator: "\n")
            seamResult = .parsing(outputLines[(markerIndex + 1)...].joined(separator: "\n"))
        } else {
            buildOutput = result.stdout
            seamResult = WellKnownBuildSeamResult()
        }
        return .completed(DeployStepResult(exitCode: result.exitCode, output: buildOutput), seamResult)
    }

    /// Builds the guest shell command that: (1) writes the base64-decoded manifest to
    /// `/tmp` — passed as `$1`, a positional parameter, never spliced into the script string,
    /// mirroring `guestArgv`'s `.bundleUpload` injection-safety pattern; (2) runs `npm run build`
    /// with both #748 env vars pointed at their `/tmp` paths; (3) echoes the result marker plus
    /// whatever the build wrote to the result path; and (4) traps EXIT/INT/TERM to remove both
    /// `/tmp` scratch files on every path this shell can gracefully reach (a hard-killed guest
    /// process's `/tmp` is still disposed of when its ephemeral VM is next torn down or rebooted).
    static func wellKnownSeamArgv(manifestBase64: String) -> [String] {
        let script = """
        trap 'rm -f \(wellKnownManifestGuestPath) \(wellKnownResultGuestPath)' EXIT INT TERM
        printf '%s' "$1" | base64 -d > \(wellKnownManifestGuestPath)
        \(WellKnownClaimManifest.environmentVariableName)=\(wellKnownManifestGuestPath) \
        \(WellKnownClaimManifest.resultPathEnvironmentVariable)=\(wellKnownResultGuestPath) npm run build
        code=$?
        echo "\(wellKnownResultMarker)"
        cat \(wellKnownResultGuestPath) 2>/dev/null || true
        exit $code
        """
        return ["sh", "-c", script, "sh", manifestBase64]
    }

    /// `DeployCommand` hands every step the full HOST (macOS) environment; almost none of it is valid
    /// in the Linux guest. We must NOT forward it wholesale: the host `PATH` (`/opt/homebrew/bin:…`)
    /// would shadow the guest's Linux PATH and break `node`/`npm`/`wrangler` resolution, and
    /// `HOME`/`TMPDIR`/`XPC_*`/`__CF*` are host-only noise. The guest provides its own PATH/HOME; the
    /// only host-originated value the deploy needs across the boundary is the Cloudflare token. Keep
    /// this allowlist tight — add a key only when a deploy step demonstrably needs it in-guest.
    private static let guestEnvAllowlist: Set<String> = ["CLOUDFLARE_API_TOKEN"]

    private static func guestEnvironment(from hostEnvironment: [String: String]) -> [String: String] {
        hostEnvironment.filter { guestEnvAllowlist.contains($0.key) }
    }

    // MARK: wrangler.toml sync (#1084)

    /// Returns the guest shell argv that overwrites `wrangler.toml` (in the guest's current working
    /// directory) with `hostSiteDirectory`'s current `wrangler.toml` content — `nil` when the host
    /// file can't be read, meaning there's nothing to sync (the boot-time clone's copy is the best
    /// we have). Base64-encodes the content so it embeds directly in the `sh -c` string with no
    /// shell-quoting/escaping surface, mirroring `ContainerizationControl.writeGuestFile`.
    static func wranglerTomlSyncArgv(hostSiteDirectory: URL) -> [String]? {
        guard let contents = try? String(
            contentsOf: hostSiteDirectory.appendingPathComponent("wrangler.toml"), encoding: .utf8
        ) else { return nil }
        let encoded = Data(contents.utf8).base64EncodedString()
        return ["sh", "-c", "echo \(encoded) | base64 -d > wrangler.toml"]
    }

    // MARK: argv mapping

    static func guestArgv(for step: DeployStep, siteDirectory: URL) -> [String] {
        switch step {
        case .build:
            return ["npm", "run", "build"]
        case .preflight:
            return ["npx", "tsx", "scripts/pre-deploy-check.ts", "--json"]
        case .wrangler:
            return ["npx", "wrangler", "deploy"]
        case .bundleUpload:
            let bucket = bundleUploadBucket(siteDirectory: siteDirectory) ?? ""
            // `bucket` comes from `.site-config` — attacker/owner-controlled content that must
            // never be spliced into shell script text. Instead of interpolating it, the script
            // references it only via `$1`, a POSITIONAL shell parameter: `sh -c 'script' sh
            // "$bucket"` sets `$1` to `bucket`'s value as a single opaque word. The shell
            // substitutes that word without re-parsing its *content* as syntax, so characters
            // like `;`, `` ` ``, `$()`, or quotes inside `bucket` can't break out of the
            // intended command — verified locally with
            // `sh -c 'echo "$1"' sh '$(echo pwned)'` printing the literal string, not executing
            // it. `"sh"` (the second argv element) fills the `$0`/argv0 slot that `sh -c` expects
            // before the first real positional parameter; it is never itself used as `$1`.
            return [
                "sh", "-c",
                "tar czf /tmp/source-bundle.tar.gz -C /workspace/site --exclude=dist --exclude=node_modules . " +
                "&& npx wrangler r2 object put \"$1/source/$(basename \"$1\").tar.gz\" " +
                "--file=/tmp/source-bundle.tar.gz --remote",
                "sh", bucket
            ]
        }
    }

    /// Reads `.site-config`'s `CF_SOURCE_BUCKET` from the HOST `siteDirectory` (the guest's copy is
    /// a clone of the same repo, so the value is identical) — `nil` when unset, which
    /// `DeployCommand.deploy` treats as "skip this step" before it ever reaches the executor.
    private static func bundleUploadBucket(siteDirectory: URL) -> String? {
        let configURL = siteDirectory.appendingPathComponent(".site-config")
        guard let config = try? String(contentsOf: configURL, encoding: .utf8) else { return nil }
        return SiteConfigFile.value(forKey: "CF_SOURCE_BUCKET", in: config)
    }
}

/// Test-only visibility onto `ContainerDeployExecutor`'s argv mapping — `guestArgv` itself is
/// `static` and package-internal so `@testable import AnglesiteCore` sees it directly; this
/// wrapper exists only so tests don't depend on `ContainerDeployExecutor`'s internal method name
/// staying `guestArgv` specifically. Kept minimal since it's exercised by exactly one test.
enum ContainerDeployExecutorTestHook {
    static func guestArgv(for step: DeployStep, siteDirectory: URL) -> [String] {
        ContainerDeployExecutor.guestArgv(for: step, siteDirectory: siteDirectory)
    }
}

// MARK: - HostDeployExecutor

/// Runs deploy steps through `ProcessSupervisor` when a caller injects explicit commands.
///
/// Injecting a custom `resolveCommand` lets tests drive arbitrary shell fixtures without
/// requiring a container to be present (same pattern as `DeployCommand`'s `CommandResolver`
/// injection).
///
/// Normally (i.e. not in tests) the default resolver returns explicit unavailability for every
/// deploy step. This prevents silent host subprocess fallback after embedded Node retirement.
///
/// Output is streamed line-by-line to `logCenter` under `source` *and* accumulated into
/// `DeployStepResult.output` so callers can parse the deployed URL or scan JSON.
public struct HostDeployExecutor: DeployExecutor {
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    /// Injectable per-step command resolver. Defaults to `HostDeployExecutor.defaultResolver`.
    private let resolveCommand: @Sendable (DeployStep) -> DeployCommand.CommandResolver

    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveCommand: @escaping @Sendable (DeployStep) -> DeployCommand.CommandResolver =
            HostDeployExecutor.defaultResolver
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveCommand = resolveCommand
    }

    // MARK: DeployExecutor

    public func run(
        step: DeployStep,
        siteDirectory: URL,
        environment: [String: String],
        source: String
    ) async -> DeployStepResult {
        let resolver = resolveCommand(step)
        let plan = resolver(siteDirectory)

        switch plan {
        case .unavailable(let reason):
            return DeployStepResult(exitCode: nil, output: reason)
        case .run(let executable, let arguments):
            return await spawn(
                executable: executable,
                arguments: arguments,
                environment: environment,
                siteDirectory: siteDirectory,
                source: source
            )
        }
    }

    // MARK: Spawn helpers

    private func spawn(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        siteDirectory: URL,
        source: String
    ) async -> DeployStepResult {
        let handle: ProcessSupervisor.Handle
        do {
            handle = try await supervisor.launch(
                source: source,
                executable: executable,
                arguments: arguments,
                environment: environment,
                currentDirectoryURL: siteDirectory,
                logCenter: logCenter
            )
        } catch {
            return DeployStepResult(exitCode: nil, output: "couldn't spawn process: \(error)")
        }

        let reason = await withTaskCancellationHandler {
            await supervisor.waitForExit(handle)
        } onCancel: {
            Task { await supervisor.terminate(handle) }
        }

        // Snapshot stdout from LogCenter — identical to DeployCommand's approach.
        let snapshot = await logCenter.snapshot()
        let output = snapshot
            .filter { $0.source == source && $0.stream == .stdout }
            .map(\.text)
            .joined(separator: "\n")

        switch reason {
        case .exited(let code):
            return DeployStepResult(exitCode: code, output: output)
        case .terminated:
            return DeployStepResult(exitCode: nil, output: output)
        case .retriesExhausted(let lastCode):
            return DeployStepResult(exitCode: lastCode, output: output)
        }
    }

    // MARK: Default command resolvers

    /// Returns the appropriate `CommandResolver` for each step, mirroring `DeployCommand`'s
    /// static resolvers exactly.
    public static let defaultResolver: @Sendable (DeployStep) -> DeployCommand.CommandResolver = { step in
        switch step {
        case .build:
            return DeployCommand.resolveBuildCommand
        case .preflight:
            return preflightResolver
        case .wrangler:
            return DeployCommand.resolveWranglerCommand
        case .bundleUpload:
            return { _ in .unavailable(reason: HostNodeRetirement.reason("source bundle upload")) }
        }
    }

    /// Host-side preflight is retired with embedded Node. Container runtimes must provide the
    /// executable preflight path.
    public static let preflightResolver: DeployCommand.CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("pre-deploy check"))
    }
}
