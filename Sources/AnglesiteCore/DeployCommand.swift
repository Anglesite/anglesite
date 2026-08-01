import Foundation

/// One-shot orchestrator for `wrangler deploy`.
///
/// A deploy is a single foreground action with a pre-spawn token gate and three real steps,
/// each run through the injected `DeployExecutor` seam. Container runtimes run the steps in a
/// guest; the default process-backed executor fails explicitly after embedded Node retirement.
///   1. Resolve / read the Cloudflare API token (pre-spawn; no token → `.failed`).
///   2. `executor.runBuildWithClaimManifest(…)` so `dist/` is fresh — the build carries the derived
///      `/.well-known/` claim manifest (#744/#748) so the runtime can reject a collision in its own
///      clone and report the artifacts it produced. An executor without the seam falls back to
///      `executor.run(step: .build, …)` and gets no post-build well-known verification.
///   3. `executor.run(step: .preflight, …)` — the bundled plugin's pre-deploy scan; its captured
///      stdout is parsed into a `PreDeployCheck.Outcome`. `.blocked` short-circuits with no
///      override (per CLAUDE.md, the app cannot bypass plugin security hooks).
///   4. `executor.run(step: .wrangler, …)` — parse the deployed URL out of the captured output.
///
/// The executor streams each step's stdout+stderr into `LogCenter` line-by-line (under the
/// caller-supplied source) and returns the accumulated stdout in `DeployStepResult.output`, so the
/// URL/scan parsing here re-reads the captured stdout rather than re-snapshotting `LogCenter`.
///
/// **Environment contract:**
///   - `.build` and `.preflight` get a curated subset of the host environment (see
///     `hostDeployEnvironment()`) — safe shell/locale/proxy/Node vars only, no unrelated secrets.
///   - `.wrangler` gets that curated environment *plus* `CLOUDFLARE_API_TOKEN`. `.bundleUpload`
///     (the optional post-deploy source-bundle upload) reuses that same token-bearing environment,
///     since it also authenticates to Cloudflare (R2 via wrangler).
///
/// **Cancellation**: cancelling the deploy task propagates through `executor.run` (the host
/// executor wraps its `waitForExit` in a cancellation handler that SIGTERMs the in-flight
/// subprocess), so a cancelled build/wrangler is actually killed rather than orphaned.
public actor DeployCommand {
    /// Terminal outcome of one `deploy(...)` call. Every failure mode is a case, not a thrown
    /// error — `deploy` never throws, so UI callers switch exhaustively over this instead of
    /// also maintaining a separate error path.
    public enum Result: Sendable, Equatable {
        /// Wrangler exited 0 and a deployed URL was parsed from its output. `duration` covers
        /// the wrangler step only — build and preflight time are excluded.
        case succeeded(url: URL, duration: TimeInterval)
        /// The pre-deploy security scan refused the deploy. Carries the structured
        /// failures (and any warnings) so the UI can render a sheet with no override.
        case blocked(failures: [PreDeployCheck.ScanFailure], warnings: [PreDeployCheck.ScanWarning])
        /// The candidate Worker name (`.site-config`'s `CF_PROJECT_NAME`) already exists on the
        /// connected Cloudflare account, and this site has never deployed before
        /// (`CF_WORKER_DEPLOYED` is not yet set in `.site-config`) — refusing to silently let
        /// `wrangler deploy` take over an unrelated (or stale) Worker. Carries the taken name for
        /// the UI's rename prompt (#740).
        case workerNameConflict(name: String)
        /// The site declares a `Source/anglesite.json` domain (#1169) whose live Cloudflare state
        /// has drifted from it (#1171) — refusing to ship against a domain/DNS/edge configuration
        /// the app no longer knows is accurate. Carries the findings so the UI can summarize them
        /// and point at the Domain Config Audit flow, where the owner reviews and reconciles
        /// before redeploying (investigation doc §5.5 — deploy-time validation is a cheap check,
        /// not a second remediation surface).
        case domainConfigDrift(findings: [DomainConfigAudit.Finding])
        /// `exitCode` is `nil` for pre-spawn refusals (no token, no wrangler) and for spawn
        /// failures; otherwise it's the failing subprocess's exit code (including `0` for the
        /// "wrangler exited cleanly but we couldn't find a URL" case).
        case failed(reason: String, exitCode: Int32?)
    }

    /// How to run a subprocess for a site directory — or why it can't be run.
    public enum LaunchPlan: Sendable, Equatable {
        /// Spawn `executable` with `arguments` (the caller supplies cwd and environment).
        case run(executable: URL, arguments: [String])
        /// The command can't run at all in this configuration; `reason` is user-facing text
        /// (e.g. `HostNodeRetirement`'s explanation) surfaced instead of a spawn attempt.
        case unavailable(reason: String)
    }

    /// Maps a site directory to how — or whether — a deploy-related subprocess can run there.
    /// The host-side defaults on this type (`resolveBuildCommand`, `resolveWranglerCommand`) all
    /// return `.unavailable` since embedded Node was retired; container runtimes inject real
    /// resolvers.
    public typealias CommandResolver = @Sendable (_ siteDirectory: URL) -> LaunchPlan
    /// Returns the Cloudflare API token, or `nil` if none is configured. Production callers use
    /// `DeployCommand.keychainTokenSource` (Keychain with an env-var fallback for development);
    /// tests typically inject a closure returning a literal.
    public typealias TokenSource = @Sendable () async throws -> String?
    /// Runs the bundled plugin's pre-deploy scan against a site and returns the outcome.
    /// Real callers use `DeployCommand.defaultPreflight`; tests inject a fake.
    public typealias PreflightChecker = @Sendable (_ siteDirectory: URL) async -> PreDeployCheck.Outcome
    /// Fires once the preflight step resolves, with the outcome that was used to
    /// decide whether to continue with wrangler. The closure runs inside the actor's
    /// isolation; bridge to MainActor via a Task if you need to touch SwiftUI state.
    /// Fires for every preflight result (.passed, .blocked, .error) — including the
    /// cases where deploy() returns .failed afterwards.
    public typealias PreflightObserver = @Sendable (PreDeployCheck.Outcome) -> Void

    /// Fires once the domain-attach step resolves (#1077), for a "Transfer an existing domain"
    /// site — or immediately with `.skipped` for every other site. Runs only after a successful
    /// `wrangler` step; never fires on a failed/blocked deploy.
    public typealias DomainAttachObserver = @Sendable (CustomDomainAttachCommand.Result) -> Void

    /// Returns the account's existing Worker script names for the given token. Production
    /// callers use `DeployCommand.defaultWorkerScriptNames` (`HTTPCloudflareClient`); tests
    /// inject a fake list or a throwing closure.
    public typealias WorkerScriptNamesSource = @Sendable (_ apiToken: String) async throws -> [String]

    /// Grades a declared `Source/anglesite.json` domain against live Cloudflare state and returns
    /// any drift (#1171's `DomainConfigAudit.evaluate`, given a fresh zone read). Production
    /// callers use `DeployCommand.defaultDomainConfigDriftSource`; tests inject a canned findings
    /// list or a throwing closure — same rationale as `WorkerScriptNamesSource`.
    public typealias DomainConfigDriftSource = @Sendable (
        _ declared: DomainConfig, _ hostname: String, _ apiToken: String
    ) async throws -> [DomainConfigAudit.Finding]

    /// The token seam this command was constructed with. Exposed so `DeployModel.runDeploy` can
    /// forward the exact same seam into companion commands (e.g. `SocialWorkerProvisionCommand`)
    /// instead of letting them silently default to the production implementation and diverge
    /// from a test's injected fake — see `workerScriptNamesSource` below for the full rationale.
    public nonisolated let tokenSource: TokenSource
    /// Exposed (like `tokenSource`) so callers that build a parallel `SocialWorkerProvisionCommand`
    /// alongside this `DeployCommand` — `DeployModel.runDeploy` — can forward the exact same seam
    /// into its own pre-provisioning conflict check (#1075) instead of silently defaulting to the
    /// real network implementation and diverging from whatever this `DeployCommand` was built with
    /// (production default or a test's injected fake).
    public nonisolated let workerScriptNamesSource: WorkerScriptNamesSource
    /// Exposed like `tokenSource`/`workerScriptNamesSource` so `DeployModel.runDeploy` can forward
    /// the exact same seam into a container-path `DeployCommand` it constructs on the fly (#1077).
    public nonisolated let customDomainAttachCommand: CustomDomainAttachCommand
    /// Exposed like the other seams above so callers building a parallel `DeployCommand` (e.g.
    /// `SocialWorkerProvisionCommand`'s `defaultDeployer`) forward the same one rather than
    /// silently defaulting to production and diverging from a test's injected fake.
    public nonisolated let domainConfigDriftSource: DomainConfigDriftSource
    private let executor: any DeployExecutor

    /// All five dependencies are injectable seams with production defaults, so tests can drive a
    /// full deploy — token gate, name-conflict check, domain-config-drift check, every step —
    /// with a literal token, a canned script-name list, and a scripted executor, never touching
    /// the network or spawning a process.
    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        workerScriptNamesSource: @escaping WorkerScriptNamesSource = DeployCommand.defaultWorkerScriptNames,
        customDomainAttachCommand: CustomDomainAttachCommand = CustomDomainAttachCommand(),
        executor: any DeployExecutor = HostDeployExecutor(),
        domainConfigDriftSource: @escaping DomainConfigDriftSource = DeployCommand.defaultDomainConfigDriftSource
    ) {
        self.tokenSource = tokenSource
        self.workerScriptNamesSource = workerScriptNamesSource
        self.customDomainAttachCommand = customDomainAttachCommand
        self.executor = executor
        self.domainConfigDriftSource = domainConfigDriftSource
    }

    /// Run a deploy for `siteID`. Returns once wrangler has exited (or before, if pre-spawn
    /// refusal applies). Build output streams under source `"deploy:<siteID>:build"`, the deploy
    /// itself under `"deploy:<siteID>"`, so a UI consumer can distinguish phases.
    public func deploy(
        siteID: String,
        siteDirectory: URL,
        /// The site's `Config/` directory. `nil` skips route-coverage scanning and the
        /// deployed-routes snapshot write entirely — callers that don't pass it (tests, and the
        /// two non-primary deploy paths in `SocialWorkerProvisionCommand`/`SiteOperations`) are
        /// unaffected (#530).
        configDirectory: URL? = nil,
        /// The site's currently published route set (from `SiteContentGraph`), used only when
        /// `configDirectory` is non-nil.
        currentRoutes: [String] = [],
        /// Effective active dynamic `/.well-known/` route claims (#746), already validated via
        /// `WorkerRouteClaims.activeClaims` and filtered with `WorkerRouteClaims.wellKnownClaims`.
        /// Empty means "no active dynamic well-known routes," not "skip the #744 collision check"
        /// — the check always runs, using whatever this array and `executor.reportOwnedPathClaims()`
        /// report.
        wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim] = [],
        onPreflight: PreflightObserver? = nil,
        onDomainAttach: DomainAttachObserver? = nil,
        onProgress: ProgressHandler? = nil
    ) async -> Result {
        // Pre-spawn checks. The token comes first so we never spend time on a build or scan
        // for a deploy that won't reach wrangler.
        let token: String?
        do {
            token = try await tokenSource()
        } catch {
            return .failed(reason: "couldn't read Cloudflare API token: \(error)", exitCode: nil)
        }
        guard let token, !token.isEmpty else {
            return .failed(reason: "no CLOUDFLARE_API_TOKEN — add it in Settings → Advanced → Credentials, or set the env var", exitCode: nil)
        }

        if let conflict = await Self.checkWorkerNameConflict(
            siteDirectory: siteDirectory, apiToken: token, workerScriptNamesSource: workerScriptNamesSource
        ) {
            return conflict
        }

        if let drift = await Self.checkDomainConfigDrift(
            siteDirectory: siteDirectory, apiToken: token, domainConfigDriftSource: domainConfigDriftSource
        ) {
            return drift
        }

        // Curated environment for the non-secret steps: a safe subset of the host process env,
        // stripping unrelated secrets the developer's shell may carry. The token is added only
        // for the wrangler step below.
        let baseEnvironment = Self.hostDeployEnvironment()

        // #744: validate the effective /.well-known/ inventory before spending time on a build.
        // Static/generated rows come from whatever's already on disk in Source/public/.well-known/
        // (which mirrors the guest's clone — see ContainerDeployExecutor's HOST-path doc comment,
        // and note `scanUserStatic` classifies a previously-generated file like security.txt by its
        // own marker, so a redeploy sees it correctly without this re-deriving the TS generator's
        // activation logic); dynamic rows from the caller's already-validated active route claims;
        // runtime rows from whatever this executor can affirmatively prove it owns (empty when
        // unsupported or when the runtime reports no claims — either way, no reservation). A
        // collision blocks the deploy immediately with no override, matching the design doc's "no
        // collision precedence" (docs/superpowers/specs/2026-07-14-well-known-support-design.md).
        // Non-fatal scan findings (a rejected symlink/oversized/percent-encoded file) are folded
        // into the preflight outcome's warnings below rather than blocking.
        let wellKnownScan = WellKnownInventory.scanUserStatic(
            wellKnownDirectory: siteDirectory.appendingPathComponent("public/.well-known", isDirectory: true))
        let wellKnownRuntimeRows = WellKnownInventory.runtimeRows(from: await executor.reportOwnedPathClaims())
        let wellKnownDynamicRows = WellKnownInventory.dynamicRows(from: wellKnownDynamicClaims)
        let wellKnownInventory: [WellKnownEndpointDescriptor]
        do {
            wellKnownInventory = try WellKnownInventory.merge(
                userStatic: wellKnownScan.rows.filter { $0.delivery == .userStatic },
                generated: wellKnownScan.rows.filter { $0.delivery == .generated },
                dynamic: wellKnownDynamicRows,
                runtime: wellKnownRuntimeRows)
        } catch {
            let failure = PreDeployCheck.ScanFailure(
                category: .wellKnownCollision,
                message: "\(error)",
                remediation: "Resolve the /.well-known/ ownership conflict named above (rename or remove one of the claims), then redeploy."
            )
            let outcome = PreDeployCheck.Outcome.blocked(failures: [failure], warnings: [])
            onPreflight?(outcome)
            return .blocked(failures: [failure], warnings: [])
        }
        let wellKnownScanWarnings = wellKnownScan.findings.map {
            PreDeployCheck.ScanWarning(
                category: .wellKnownArtifact, message: $0.message,
                file: $0.path.map { "public/.well-known/\($0)" })
        }

        // Build dist/ before the scan needs it. Streams to LogCenter via the executor.
        //
        // #744/#748 build seam: when the executor implements it, the build runs with the derived
        // claim manifest so the runtime can (a) rescan its OWN clone before any generator writes —
        // catching a collision the host's working-tree scan above could not see — and (b) report
        // the exact `dist/.well-known/...` artifacts it produced. An executor that returns
        // `.unsupported` falls back to the plain build step and gets NO post-build verification;
        // we must not claim protection that never ran.
        onProgress?(.deployBuilding)
        var wellKnownArtifactWarnings: [PreDeployCheck.ScanWarning] = []
        let buildResult: DeployStepResult
        switch await executor.runBuildWithClaimManifest(
            siteDirectory: siteDirectory,
            environment: baseEnvironment,
            source: "deploy:\(siteID):build",
            claimManifest: WellKnownInventory.claimManifest(from: wellKnownInventory)
        ) {
        case .unsupported:
            buildResult = await executor.run(
                step: .build,
                siteDirectory: siteDirectory,
                environment: baseEnvironment,
                source: "deploy:\(siteID):build"
            )
        case .cancelled:
            return .failed(reason: "build was terminated", exitCode: nil)
        case .completed(let stepResult, let seamResult):
            buildResult = stepResult
            // A failed build that still reported findings is the runtime's own collision rejection
            // (`scripts/well-known.ts check` writes ONLY the blocking findings before exiting
            // non-zero). Surface it as a `.blocked` security outcome with both owners named, not as
            // an opaque "npm run build failed (exit 1)".
            if stepResult.exitCode != 0, !seamResult.findings.isEmpty {
                let failures = seamResult.findings.map {
                    PreDeployCheck.ScanFailure(
                        category: .wellKnownCollision,
                        message: $0.message,
                        file: $0.path.map { "public/.well-known/\($0)" },
                        remediation: "Resolve the /.well-known/ ownership conflict named above (rename or remove one of the claims), then redeploy.")
                }
                let outcome = PreDeployCheck.Outcome.blocked(failures: failures, warnings: [])
                onPreflight?(outcome)
                return .blocked(failures: failures, warnings: [])
            }
            wellKnownArtifactWarnings = WellKnownInventory.verifyBuildArtifacts(
                expected: wellKnownInventory, result: seamResult
            ).map {
                PreDeployCheck.ScanWarning(
                    category: .wellKnownArtifact, message: $0.message,
                    file: $0.path.map { "dist/.well-known/\($0)" })
            }
        }
        guard buildResult.exitCode == 0 else {
            if let code = buildResult.exitCode {
                return .failed(reason: "npm run build failed (exit \(code))", exitCode: code)
            }
            // nil exit code → unavailable resolver, spawn failure, or termination (cancellation).
            if Task.isCancelled {
                return .failed(reason: "build was terminated", exitCode: nil)
            }
            // The executor put the reason (unavailable/spawn) in `output`.
            return .failed(reason: buildResult.output.isEmpty ? "build was terminated" : buildResult.output, exitCode: nil)
        }

        // Pre-deploy scan runs after the build (so dist/ exists) and before wrangler. If the
        // bundled plugin's checks find PII, exposed tokens, unauthorized third-party scripts, or
        // Keystatic admin routes in dist/, the deploy is blocked — per the durable rule in
        // CLAUDE.md, the app cannot bypass plugin security hooks; the UI sheet for `.blocked` has
        // no override.
        onProgress?(.deployPreflight)
        let preflightResult = await executor.run(
            step: .preflight,
            siteDirectory: siteDirectory,
            environment: baseEnvironment,
            source: "deploy:\(siteID):preflight"
        )
        var preflightOutcome = Self.parseScanReport(output: preflightResult.output, exitCode: preflightResult.exitCode)
        // Swift-computed warnings, not emitted by the JS scan script — merged into the outcome
        // the same way `RouteCoverageScanner`'s `.orphanedRoute` findings always have been.
        var extraWarnings = wellKnownScanWarnings + wellKnownArtifactWarnings
        if let configDirectory {
            let previousRoutes = DeployedRoutesSnapshot.load(from: configDirectory)
            let redirects = (try? RedirectsStore(sourceDirectory: siteDirectory).load()) ?? []
            extraWarnings += RouteCoverageScanner.scan(
                currentRoutes: currentRoutes,
                previousRoutes: previousRoutes,
                redirectSources: Set(redirects.map(\.source))
            )
        }
        if !extraWarnings.isEmpty {
            switch preflightOutcome {
            case .passed(let warnings):
                preflightOutcome = .passed(warnings: warnings + extraWarnings)
            case .blocked(let failures, let warnings):
                preflightOutcome = .blocked(failures: failures, warnings: warnings + extraWarnings)
            case .error:
                break
            }
        }
        onPreflight?(preflightOutcome)
        switch preflightOutcome {
        case .passed:
            break
        case .blocked(let failures, let warnings):
            return .blocked(failures: failures, warnings: warnings)
        case .error(let reason):
            return .failed(reason: "pre-deploy scan could not run: \(reason)", exitCode: nil)
        }

        // Wrangler step: process env PLUS the Cloudflare token.
        var wranglerEnvironment = baseEnvironment
        wranglerEnvironment["CLOUDFLARE_API_TOKEN"] = token

        let started = Date()
        onProgress?(.deployDeploying)
        let wranglerResult = await executor.run(
            step: .wrangler,
            siteDirectory: siteDirectory,
            environment: wranglerEnvironment,
            source: "deploy:\(siteID)"
        )
        let duration = Date().timeIntervalSince(started)

        if !Task.isCancelled { onProgress?(.deployFinalizing) }

        guard let code = wranglerResult.exitCode else {
            // nil exit code → unavailable resolver, spawn failure, or termination (e.g. cancellation).
            // The cancellation path must say "terminated" (the cancellation test asserts on it);
            // for the unavailable/spawn-failure cases the executor surfaces the reason in `output`.
            if Task.isCancelled {
                return .failed(reason: "wrangler was terminated", exitCode: nil)
            }
            return .failed(reason: wranglerResult.output.isEmpty ? "wrangler was terminated" : wranglerResult.output, exitCode: nil)
        }
        if code == 0 {
            if let url = Self.extractDeployedURL(from: wranglerResult.output) {
                if let configDirectory {
                    try? DeployedRoutesSnapshot.save(currentRoutes, to: configDirectory)
                }
                // Runs before `persistSiteURL` (#1077/#1124): a fresh confirmation from *this*
                // deploy persists `CF_DOMAIN_ATTACHED` as a side effect, which `persistSiteURL`
                // checks to decide whether to leave `SITE_URL` alone.
                let domainAttachOutcome = await customDomainAttachCommand.attach(
                    siteDirectory: siteDirectory, apiToken: token, source: "deploy:\(siteID)")
                onDomainAttach?(domainAttachOutcome)
                Self.persistSiteURL(url, siteDirectory: siteDirectory)
                Self.persistWorkerDeployed(siteDirectory: siteDirectory)
                if let configDirectory {
                    await Self.uploadSourceBundleIfConfigured(
                        siteDirectory: siteDirectory, configDirectory: configDirectory,
                        environment: wranglerEnvironment, executor: executor, siteID: siteID
                    )
                }
                return .succeeded(url: url, duration: duration)
            }
            return .failed(
                reason: "wrangler exited successfully (code 0), but no deployed URL could be found in its output — the deploy likely succeeded; check the deploy log for the URL",
                exitCode: 0
            )
        }
        return .failed(reason: "wrangler exited with code \(code)", exitCode: code)
    }

    // MARK: Scan report parsing

    /// Parses the captured stdout of the pre-deploy scan (`scripts/pre-deploy-check.ts --json`)
    /// into a `PreDeployCheck.Outcome`. Thin forwarding wrapper — `PreDeployCheck.parse` is the
    /// one real decoder (#742); this keeps the existing public call-site signature stable.
    public static func parseScanReport(output: String, exitCode: Int32?) -> PreDeployCheck.Outcome {
        PreDeployCheck.parse(output: output, exitCode: exitCode)
    }

    // MARK: URL extraction

    /// Extracts the deployed URL from wrangler's captured stdout. Wrangler's exact wording has
    /// already drifted across major versions (older wrangler printed a `Published <name> (1.23
    /// sec)` status line; current wrangler instead prints separate `Uploaded <name> (…)` /
    /// `Deployed <name> triggers (…)` lines), and `wrangler deploy` (unlike `wrangler pages
    /// deploy`) has no `--json` output mode to depend on instead, so multiple status-line prefixes
    /// are recognized as the anchor:
    ///
    /// 1. Anchor on a recognized start-of-line status prefix (`Published`/`Deployed`/`Uploaded`)
    ///    and search only the anchor line and lines after it — never anything before it — for a
    ///    URL. A `*.workers.dev` URL there is preferred (the common case); any URL is accepted as a
    ///    fallback for custom-domain deploys, which have no workers.dev host in their output.
    ///    Scoping to at/after the anchor (rather than the whole output) matters because this
    ///    result gets persisted as the site's live URL: an incidental workers.dev mention earlier
    ///    in the log (e.g. a subdomain-already-exists notice) must not outrank the real result.
    /// 2. If no anchor line is recognized at all (a future wrangler layout this doesn't know
    ///    about), fall back to a whole-output scan for a `*.workers.dev` URL — still a
    ///    distinctive, version-independent signature of a genuine deploy result, just without
    ///    anchor confirmation.
    public static func extractDeployedURL(from output: String) -> URL? {
        let anchors = ["Published", "Deployed", "Uploaded"]
        let lines = output.split(separator: "\n", omittingEmptySubsequences: false)
        if let anchorIdx = lines.firstIndex(where: { line in anchors.contains(where: line.hasPrefix) }) {
            let tail = lines[anchorIdx...].joined(separator: "\n")
            return firstURL(in: tail, requiringHostSuffix: ".workers.dev") ?? firstURL(in: tail)
        }
        return firstURL(in: output, requiringHostSuffix: ".workers.dev")
    }

    /// The first `http(s)` URL in `text` — optionally required to have a host ending in
    /// `hostSuffix` — with trailing punctuation a terminal might tack on (commas, periods, closing
    /// parens) stripped. Scans the whole string (not line-by-line), so callers doing a
    /// version-independent signature scan can pass multi-line output directly.
    private static func firstURL(in text: String, requiringHostSuffix hostSuffix: String? = nil) -> URL? {
        guard let regex = try? NSRegularExpression(pattern: #"https?://\S+"#) else { return nil }
        let fullRange = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: fullRange) {
            guard let range = Range(match.range, in: text) else { continue }
            var raw = String(text[range])
            while let last = raw.last, ",.)]}>".contains(last) {
                raw.removeLast()
            }
            guard let url = URL(string: raw) else { continue }
            if let hostSuffix {
                guard let host = url.host, host.hasSuffix(hostSuffix) else { continue }
            }
            return url
        }
        return nil
    }

    /// Persists the deployed URL into `.site-config`'s `SITE_URL` (#702) so the *next* build's
    /// `astro.config.ts` picks up the real host for canonical URLs, feed self-links, and JSON-LD
    /// instead of the `https://example.com` placeholder. This deploy's own `dist/` was already
    /// built before the URL was known, so the placeholder still ships on a site's first deploy —
    /// every deploy after that carries the real host.
    ///
    /// Written even when a custom domain (`DOMAIN`/`SITE_DOMAIN`) is configured but not yet
    /// confirmed live (#1085): before #1077, nothing in the deploy pipeline attached a custom
    /// domain, so an unverified `DOMAIN` was never trustworthy and `SITE_URL` — the site's real,
    /// reachable address — had to win `DeployCoordinator.resolveSiteURL`'s precedence regardless.
    ///
    /// Skipped once `CF_DOMAIN_ATTACHED` matches `DOMAIN` — the same "confirmed" signal
    /// `CustomDomainAttachCommand.attach` itself checks (#1077) — because at that point `DOMAIN`
    /// *is* verified live, and overwriting `SITE_URL` with the workers.dev host would shadow it in
    /// `resolveSiteURL`'s precedence forever after, silently undoing every confirmed domain attach
    /// on its very next deploy. Callers must call `customDomainAttachCommand.attach` (and let it
    /// persist `CF_DOMAIN_ATTACHED`) before this, so a domain confirmed *in this same deploy* is
    /// already visible to the check. Best-effort — a write failure must never turn a successful
    /// deploy into a failed one.
    static func persistSiteURL(_ url: URL, siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        if let domain = SiteConfigFile.value(forKey: "DOMAIN", in: config),
           SiteConfigFile.value(forKey: "CF_DOMAIN_ATTACHED", in: config) == domain {
            return
        }
        let updated = SiteConfigFile.upsert([("SITE_URL", url.absoluteString)], into: config)
        guard updated != config else { return }
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Marks this site as having successfully deployed at least once, via `.site-config`'s
    /// `CF_WORKER_DEPLOYED` — the signal `checkWorkerNameConflict` uses to skip the collision
    /// check on every deploy after the first (#740). Written unconditionally, unlike
    /// `persistSiteURL` (which skips when a custom domain is already configured) — deploy
    /// history isn't confounded by domain choice. Best-effort, matching `persistSiteURL`.
    static func persistWorkerDeployed(siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == nil else { return }
        let updated = SiteConfigFile.upsert([("CF_WORKER_DEPLOYED", "true")], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Marks this site's candidate Worker name as confirmed-ours, via `.site-config`'s
    /// `CF_WORKER_PROVISIONED` — a second, earlier-firing signal `checkWorkerNameConflict` treats
    /// the same as `CF_WORKER_DEPLOYED` (#1075). `CF_WORKER_DEPLOYED` alone only covers a *fully
    /// succeeded* deploy, but `SocialWorkerProvisionCommand.provision()` can already have pushed
    /// live Cloudflare state under this candidate name (`wrangler secret put` for ActivityPub, run
    /// before the final `wrangler deploy`, auto-vivifies an empty Worker script under the target
    /// name as a side effect) in an attempt that then failed for an unrelated reason before
    /// `persistWorkerDeployed` ever ran. Without this second signal, a retry of that same site
    /// would see its own auto-vivified script on the account and misreport it as a foreign
    /// conflict. Called once, immediately after a fresh `checkWorkerNameConflict` pass at the very
    /// start of provisioning — before any wrangler call that could touch the name — so a *genuine*
    /// foreign collision is still caught before this site's own provisioning ever runs. Written
    /// unconditionally like `persistWorkerDeployed`; best-effort, matching `persistSiteURL`.
    static func persistWorkerProvisioned(siteDirectory: URL) {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == nil else { return }
        let updated = SiteConfigFile.upsert([("CF_WORKER_PROVISIONED", "true")], into: config)
        try? updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// Uploads `Source/`'s snapshot to R2 (`DeployStep.bundleUpload`) when `.site-config`'s
    /// `CF_SOURCE_BUCKET` is set, then persists the uploaded commit SHA into `Config/settings.plist`
    /// (#799, spec §C.4 — the code side of a future Worker-triggered bake). A no-op today for every
    /// real site — no provisioning flow writes `CF_SOURCE_BUCKET` yet — and the executor call is
    /// skipped entirely rather than run-and-ignore-the-result, so a redeploy on an unprovisioned
    /// site pays no extra subprocess cost. Best-effort like `persistSiteURL`/`persistWorkerDeployed`:
    /// a failure here must never turn a successful deploy into a failed one.
    static func uploadSourceBundleIfConfigured(
        siteDirectory: URL,
        configDirectory: URL,
        environment: [String: String],
        executor: any DeployExecutor,
        siteID: String
    ) async {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_SOURCE_BUCKET", in: config) != nil else { return }

        let uploadResult = await executor.run(
            step: .bundleUpload,
            siteDirectory: siteDirectory,
            environment: environment,
            source: "deploy:\(siteID):bundle"
        )
        guard uploadResult.exitCode == 0 else { return }

        guard let headResult = try? await BackupCommand.defaultRunner(siteDirectory, ["rev-parse", "HEAD"]) else { return }
        guard headResult.exitCode == 0 else { return }
        let commitSHA = headResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !commitSHA.isEmpty else { return }

        let store = SiteConfigStore(configDirectory: configDirectory)
        guard var settings = try? await store.load() else { return }
        settings.deployedSourceBundleCommit = commitSHA
        try? await store.save(settings)
    }

    /// Checks whether `.site-config`'s `CF_PROJECT_NAME` collides with an existing Worker on the
    /// connected Cloudflare account, but only when neither `CF_WORKER_DEPLOYED` (a full deploy has
    /// already succeeded under this name) nor `CF_WORKER_PROVISIONED` (this site's own earlier
    /// provisioning already confirmed the name as ours, #1075) is set yet. Returns
    /// `.workerNameConflict` on a confirmed collision, or `nil` when the check doesn't apply
    /// (redeploy, already-provisioned, no candidate name) or can't be confirmed — a Cloudflare API
    /// failure here must never block a deploy that would otherwise succeed (fail open).
    static func checkWorkerNameConflict(
        siteDirectory: URL,
        apiToken: String,
        workerScriptNamesSource: WorkerScriptNamesSource
    ) async -> Result? {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        guard SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == nil,
              SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == nil,
              let candidateName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config)
        else { return nil }
        guard let names = try? await workerScriptNamesSource(apiToken) else { return nil }
        guard names.contains(candidateName) else { return nil }
        return .workerNameConflict(name: candidateName)
    }

    /// Grades the site's declared `anglesite.json` domain against live Cloudflare state (#1173).
    /// Returns `.domainConfigDrift` when the audit finds any drift, or `nil` when the check
    /// doesn't apply (no `anglesite.json`, or no declared `domain.hostname` — nothing to compare
    /// against live state) or can't be confirmed. A read/decode error and a thrown/failed
    /// `domainConfigDriftSource` both fail open — same posture as `checkWorkerNameConflict`, since
    /// a transient Cloudflare API hiccup here must never block an otherwise-good deploy.
    static func checkDomainConfigDrift(
        siteDirectory: URL,
        apiToken: String,
        domainConfigDriftSource: DomainConfigDriftSource
    ) async -> Result? {
        guard let declared = try? DomainConfigStore(sourceDirectory: siteDirectory).load(),
              let hostname = declared.domain?.hostname, !hostname.isEmpty
        else { return nil }
        guard let findings = try? await domainConfigDriftSource(declared, hostname, apiToken), !findings.isEmpty
        else { return nil }
        return .domainConfigDrift(findings: findings)
    }

    // MARK: Host environment curation

    /// Keys that a host-path build or preflight step legitimately needs. The allowlist is
    /// intentionally conservative — add a key only when a build script demonstrably requires it.
    /// Mirrors the tight `guestEnvAllowlist` in `ContainerDeployExecutor`, adapted for the host
    /// where Node/npm/Astro rely on the user's shell plumbing.
    private static let hostEnvAllowlist: Set<String> = [
        // Shell / process fundamentals
        "PATH", "HOME", "USER", "LOGNAME", "SHELL",
        // Temp directories — Node/npm/Astro write to these
        "TMPDIR", "TEMP", "TMP",
        // CI — Astro, Vite, and many post-install scripts check this to suppress interactive prompts
        "CI",
        // Locale — affects sorting, date formatting in build output
        "LANG", "LC_ALL", "LC_COLLATE", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY",
        "LC_NUMERIC", "LC_TIME",
        // Proxy — corporate/VPN environments need these for npm registry + API fetches
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "no_proxy",
        // Node-specific
        "NODE_ENV", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NPM_CONFIG_CACHE",
        // XDG — npm/pnpm/yarn respect these for cache and config paths
        "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
        // Terminal — some build tools check these for color/width
        "TERM", "COLORTERM", "COLUMNS",
    ]

    /// Key prefixes that Astro/Vite projects use for build-time environment variables. These are
    /// standard conventions for variables inlined into client-side output (`PUBLIC_*`) or consumed
    /// by Vite's pipeline (`VITE_*`). Users set them in their shell and expect them to flow through
    /// to `astro build`. `ASTRO_` covers Astro's own config overrides (e.g. `ASTRO_TELEMETRY_DISABLED`).
    private static let hostEnvPrefixes: [String] = ["PUBLIC_", "VITE_", "ASTRO_"]

    /// Returns a curated subset of the given environment safe for host-path build and preflight
    /// steps. Strips unrelated secrets (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, …) that the
    /// developer's shell may carry. `CLOUDFLARE_API_TOKEN` is explicitly excluded here; `deploy()`
    /// adds it only to the `.wrangler` step's environment.
    ///
    /// The `env` parameter defaults to the current process environment; tests inject a literal
    /// dictionary instead (avoiding `setenv`/`unsetenv` races and the `ProcessInfo` launch-time
    /// snapshot issue).
    static func hostDeployEnvironment(
        _ env: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        env.filter { key, _ in
            hostEnvAllowlist.contains(key) ||
            hostEnvPrefixes.contains(where: { key.hasPrefix($0) })
        }
    }

    // MARK: Default seams

    /// Reads `CLOUDFLARE_API_TOKEN` from the process environment. Useful in development (the env
    /// var dominates the Keychain entry when both are set, so a shell with `CLOUDFLARE_API_TOKEN`
    /// exported behaves the way a wrangler user expects).
    public static let envTokenSource: TokenSource = {
        ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
    }

    /// Default `TokenSource` for production: env var first (so a developer's shell still wins),
    /// then the platform secret store (the user's Keychain on macOS). A store error is surfaced
    /// to the caller — we'd rather show the user "couldn't read token" than silently fall
    /// through to `nil` and prompt for a re-paste of a token that's actually stored fine.
    public static let keychainTokenSource: TokenSource = {
        if let env = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"], !env.isEmpty {
            return env
        }
        return try PlatformSecretStore.make().readCloudflareToken()
    }

    /// Default `WorkerScriptNamesSource` for production: the account's Worker script names via
    /// `HTTPCloudflareClient`.
    public static let defaultWorkerScriptNames: WorkerScriptNamesSource = { apiToken in
        try await HTTPCloudflareClient().workerScriptNames(apiToken: apiToken)
    }

    /// Default `DomainConfigDriftSource` for production: resolves the declared hostname's zone,
    /// reads its live edge state and DNS records via `HTTPCloudflareClient`, then grades them with
    /// `DomainConfigAudit.evaluate` — the same three calls `DomainConfigAuditModel.performAudit`
    /// makes App-side, just without the SwiftUI-facing `Phase` machinery. A zone that can't be
    /// resolved (not yet attached, or a Cloudflare read failure) returns no findings rather than
    /// throwing — nothing to compare declared state against yet, not drift.
    public static let defaultDomainConfigDriftSource: DomainConfigDriftSource = { declared, hostname, apiToken in
        let reader: any CloudflareReading = HTTPCloudflareClient()
        guard let zoneID = try await reader.resolveZoneID(domain: hostname, apiToken: apiToken) else { return [] }
        let state = try await reader.zoneState(zoneID: zoneID, domain: hostname, apiToken: apiToken)
        let records = try await reader.listDNSRecords(zoneID: zoneID, apiToken: apiToken)
        return DomainConfigAudit.evaluate(declared: declared, live: state, liveDNSRecords: records, domain: hostname)
    }

    /// Default `PreflightChecker`: host-side preflight was retired with embedded Node. Container
    /// runtimes must provide the executable preflight path.
    public static let defaultPreflight: PreflightChecker = { siteDirectory in
        .error(reason: HostNodeRetirement.reason("pre-deploy check"))
    }

    /// Default `CommandResolver`: host-side wrangler deploy was retired with embedded Node.
    public static let resolveWranglerCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("wrangler deploy"))
    }

    /// Default `BuildCommandResolver`: host-side site build was retired with embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("site build"))
    }
}
