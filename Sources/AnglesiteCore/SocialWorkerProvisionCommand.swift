import Foundation

/// Provisions the per-site Cloudflare Worker resources used by the V-2 social layer, then
/// publishes through ``DeployCommand`` so build and pre-deploy security checks stay in path.
///
/// This is the app-side integration seam for `@dwk/workers`: it creates the backing Cloudflare
/// resources with wrangler, writes a concrete `wrangler.toml`, then asks the existing deploy
/// pipeline to build, scan, and deploy the composed Worker.
/// The Worker source itself stays in the template's `worker/worker.ts`; when the upstream
/// `@dwk/*` packages are stable, that file is the only protocol-specific piece that needs to
/// grow imports and route handlers.
public actor SocialWorkerProvisionCommand {
    public enum Result: Sendable, Equatable {
        case succeeded(url: URL, resources: WorkerComposition.ProvisionedResources, duration: TimeInterval)
        case blocked(failures: [PreDeployCheck.ScanFailure], warnings: [PreDeployCheck.ScanWarning], resources: WorkerComposition.ProvisionedResources)
        /// The candidate Worker name is already in use on the connected Cloudflare account by a
        /// project this site's own local config doesn't already claim as its own (`.site-config`'s
        /// `CF_WORKER_DEPLOYED`/`CF_WORKER_PROVISIONED`) — mirrors
        /// `DeployCommand.Result.workerNameConflict` rather than collapsing it, so callers can
        /// drive the same rename-and-retry UX (#740). Checked at the very start of `provision()`,
        /// before any wrangler call runs against the name, so a genuine collision is caught before
        /// this site's own D1/KV/R2/secret provisioning could touch a foreign project (#1075).
        case workerNameConflict(name: String, resources: WorkerComposition.ProvisionedResources)
        /// A Queue-backed worker (inbound Webmention #359, or the WebSub hub #361) is active but
        /// the site hasn't explicitly acknowledged that Cloudflare Queues require the Workers
        /// Paid plan. Returned *before any wrangler call for a Queue* — earlier D1/KV/R2
        /// wrangler calls (and their `persistConfig` writes) may already have run in this same
        /// `provision()` invocation before this gate is reached. `DeployModel` parks the deploy
        /// and presents a confirmation sheet; retrying with `acknowledgesPaidPlan: true`
        /// proceeds to create the Queue(s). (The case keeps its original Webmention-era name;
        /// one acknowledgment covers every Queue-backed feature — it's the same account-level
        /// plan fact.)
        case webmentionPaidPlanConfirmationNeeded(resources: WorkerComposition.ProvisionedResources)
        case failed(reason: String, exitCode: Int32?, resources: WorkerComposition.ProvisionedResources)
    }

    public typealias TokenSource = DeployCommand.TokenSource
    public typealias CommandRunner = @Sendable (
        _ siteDirectory: URL,
        _ arguments: [String],
        _ environment: [String: String],
        _ source: String
    ) async throws -> ProcessSupervisor.RunResult
    /// Pushes one Cloudflare Worker secret whose value can't travel as a plain CLI argument
    /// (`wrangler secret put <NAME>` reads its value from stdin). Unlike `CommandRunner`, which
    /// always shapes a bare `wrangler <args>` call, this closure's production conformer
    /// (`ContainerCommandRunner.secretRunner`) runs a small in-guest shell script that reads
    /// `value` from an environment variable rather than stdin — the container-exec seam
    /// (`LocalContainerControl.exec`) is one-shot with no stdin plumbing.
    public typealias SecretRunner = @Sendable (
        _ siteDirectory: URL,
        _ name: String,
        _ value: String,
        _ environment: [String: String],
        _ source: String
    ) async throws -> ProcessSupervisor.RunResult
    /// Produces (generating and persisting on first call, per site) the ActivityPub actor's
    /// signing keypair and publish token. Defaults to the real Keychain via
    /// `ActivityPubKeyProvisioning`; tests inject a fake to avoid touching the real login
    /// keychain and to control the returned values deterministically.
    public typealias KeyPairSource = @Sendable (_ siteID: String) throws -> ActivityPubKeyProvisioning.Secrets
    public typealias Deployer = @Sendable (
        _ token: String,
        _ siteID: String,
        _ siteDirectory: URL,
        _ wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim]
    ) async -> DeployCommand.Result

    public nonisolated let tokenSource: TokenSource
    private let runner: CommandRunner
    private let keyPairSource: KeyPairSource
    private let secretRunner: SecretRunner
    private let deployer: Deployer
    private let workerScriptNamesSource: DeployCommand.WorkerScriptNamesSource

    public init(
        tokenSource: @escaping TokenSource = DeployCommand.keychainTokenSource,
        runner: @escaping CommandRunner = SocialWorkerProvisionCommand.defaultRunner,
        keyPairSource: @escaping KeyPairSource = SocialWorkerProvisionCommand.defaultKeyPairSource,
        secretRunner: @escaping SecretRunner = SocialWorkerProvisionCommand.defaultSecretRunner,
        deployer: @escaping Deployer = SocialWorkerProvisionCommand.defaultDeployer,
        /// Same seam `DeployCommand` uses for its own end-of-pipeline conflict check
        /// (`DeployCommand.defaultWorkerScriptNames` in production); injected here too so
        /// `provision()` can run that same check *before* any wrangler call touches the
        /// candidate name (#1075) instead of only after D1/KV/R2/secrets have already run.
        workerScriptNamesSource: @escaping DeployCommand.WorkerScriptNamesSource = DeployCommand.defaultWorkerScriptNames
    ) {
        self.tokenSource = tokenSource
        self.runner = runner
        self.keyPairSource = keyPairSource
        self.secretRunner = secretRunner
        self.deployer = deployer
        self.workerScriptNamesSource = workerScriptNamesSource
    }

    public func provision(
        siteID: String,
        siteDirectory: URL,
        siteName: String,
        workers: [WorkerDescriptor],
        /// Effective active dynamic-route claims (#746), pre-validated via
        /// `WorkerRouteClaims.activeClaims`. Written into `wrangler.toml` as selective
        /// `[assets].run_worker_first` patterns; empty = no worker-first routes.
        routeClaims: [WorkerRouteClaim] = [],
        /// Resources already known from `SiteSettings.provisionedWorkerResources` (#709), checked
        /// before falling back to `readPersistedResources`'s wrangler.toml scrape. Durable across
        /// a worker being deactivated (which drops its binding block from the file) and later
        /// reactivated — the default (`.init()`, all-nil) makes this call fall through to the
        /// existing file-scrape-only behavior unchanged.
        knownResources: WorkerComposition.ProvisionedResources = .init(),
        /// The site's best-known public URL (`.site-config`'s `DOMAIN`/`SITE_DOMAIN`/`SITE_URL`,
        /// via `DeployCoordinator.resolveSiteURL`), threaded into `WorkerComposition`'s `SITE_URL`
        /// var. `nil` on a first-ever deploy before any host is known — the composed Worker
        /// degrades gracefully (worker.ts no-ops the queue consumer without it).
        siteURL: String? = nil,
        /// The site's display name (`SiteSettings.displayName`), threaded into the ActivityPub
        /// actor's `AP_DISPLAY_NAME` var via `WorkerComposition.generateWranglerToml`. `nil` when
        /// unknown — the composed Worker's actor document then falls back to a fixed generic
        /// name (`worker.ts`'s concern, not this function's).
        displayName: String? = nil,
        /// Explicit per-deploy opt-in that the user has acknowledged inbound Webmention requires
        /// the Cloudflare Workers Paid plan (#359) — `DeployModel` sets this from
        /// `SiteSettings.webmentionReceivePaidPlanAcknowledged` plus the in-flight confirmation
        /// sheet's "Enable & retry" action. Ignored unless a `webmention` worker is active.
        acknowledgesPaidPlan: Bool = false,
        /// Effective active dynamic `/.well-known/` route claims (#746), with owner attribution —
        /// forwarded verbatim to `deployer` for `DeployCommand.deploy`'s pre-build #744 collision
        /// check, the same way `DeployModel.runDeploy`'s custom deployer closure already threads
        /// `WorkerRouteClaims.wellKnownClaims(routeClaims)` for the GUI path (#934). Distinct from
        /// `routeClaims` above (`[WorkerRouteClaim]`, used only to compose `wrangler.toml`)
        /// because the collision check needs the `OwnedClaim` wrapper's owner attribution.
        wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim] = []
    ) async -> Result {
        let token: String?
        do {
            token = try await tokenSource()
        } catch {
            return .failed(reason: "couldn't read Cloudflare API token: \(error)", exitCode: nil, resources: .init())
        }
        guard let token, !token.isEmpty else {
            return .failed(
                reason: "no CLOUDFLARE_API_TOKEN — add it in Settings → Advanced → Credentials, or set the env var",
                exitCode: nil,
                resources: .init()
            )
        }

        guard WorkerComposition.isValidSiteName(siteName) else {
            return .failed(reason: "invalid Worker name: \(siteName)", exitCode: nil, resources: .init())
        }

        var environment = DeployCommand.hostDeployEnvironment()
        environment["CLOUDFLARE_API_TOKEN"] = token
        let source = "worker-provision:\(siteID)"
        let started = Date()

        var resources = knownResources == .init() ? Self.readPersistedResources(from: siteDirectory) : knownResources

        // #1075: confirm the candidate Worker name before any wrangler call can touch it. Left
        // solely to `deployer`'s own end-of-pipeline check (`DeployCommand.deploy` →
        // `checkWorkerNameConflict`), a genuine foreign collision would go undetected until AFTER
        // the D1/KV/R2/secret calls below already ran against that name — and the ActivityPub
        // secret push in particular (`wrangler secret put`) auto-vivifies an empty Worker script
        // under the target name as a side effect, which would then make a later retry of THIS
        // site's own provisioning misreport its own prior attempt as a foreign conflict.
        // Persisting `CF_WORKER_PROVISIONED` immediately on a pass (name free, or already
        // confirmed ours by an earlier attempt) closes both gaps: a genuinely foreign name is
        // still caught here, before any resource creation runs, while a retry of this site never
        // re-flags its own provisioning history.
        if case .workerNameConflict(let name)? = await DeployCommand.checkWorkerNameConflict(
            siteDirectory: siteDirectory, apiToken: token, workerScriptNamesSource: workerScriptNamesSource
        ) {
            return .workerNameConflict(name: name, resources: resources)
        }
        DeployCommand.persistWorkerProvisioned(siteDirectory: siteDirectory)

        if workers.contains(where: { $0.resources.needsD1 }) {
            if resources.d1DatabaseID == nil {
                let name = "\(siteName)-social"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["d1", "create", name, "--json"],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                let output: String
                switch result {
                case .success(let value):
                    output = value
                case .failure(let failure):
                    return failure
                }
                guard let id = Self.extractResourceID(from: output) else {
                    return .failed(reason: "wrangler created D1 database \(name) but no database id was found", exitCode: 0, resources: resources)
                }
                resources.d1DatabaseID = id
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }

        if workers.contains(where: { $0.resources.needsKV }) {
            if resources.kvNamespaceID == nil {
                let name = "\(siteName)-social"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["kv", "namespace", "create", name, "--json"],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                let output: String
                switch result {
                case .success(let value):
                    output = value
                case .failure(let failure):
                    return failure
                }
                guard let id = Self.extractResourceID(from: output) else {
                    return .failed(reason: "wrangler created KV namespace \(name) but no namespace id was found", exitCode: 0, resources: resources)
                }
                resources.kvNamespaceID = id
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }

        if workers.contains(where: { $0.resources.needsR2 }) {
            if resources.r2BucketName == nil {
                let name = "\(siteName)-media"
                let result = await runWrangler(
                    siteDirectory: siteDirectory,
                    arguments: ["r2", "bucket", "create", name],
                    environment: environment,
                    source: source,
                    resources: resources
                )
                if case .failure(let failure) = result {
                    return failure
                }
                resources.r2BucketName = name
                if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                    return failure
                }
            }
        }

        let hasActivityPub = workers.contains(where: { $0.id == WorkerComposition.activitypubWorkerID })
        if hasActivityPub {
            // ActivityPub's catalog resources are all needsD1/needsKV/needsR2 == false (it only
            // needs a Durable Object, which those flags don't track), so if it's the only active
            // worker none of the D1/KV/R2 blocks above ran and wrangler.toml may not exist yet.
            // `wrangler secret put` (below) resolves the Worker's project name from
            // wrangler.toml in the working directory — persist it here first so that lookup
            // succeeds even on an ActivityPub-only first deploy.
            if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
                return failure
            }
            let keys: ActivityPubKeyProvisioning.Secrets
            do {
                keys = try keyPairSource(siteID)
            } catch {
                return .failed(reason: "couldn't prepare ActivityPub signing key: \(error)", exitCode: nil, resources: resources)
            }
            for (name, value) in [
                ("AP_PRIVATE_KEY", keys.privateKeyPem),
                ("AP_PUBLIC_KEY", keys.publicKeyPem),
                ("AP_PUBLISH_TOKEN", keys.publishToken),
            ] {
                do {
                    let secretResult = try await secretRunner(siteDirectory, name, value, environment, source)
                    guard secretResult.exitCode == 0 else {
                        let output = secretResult.stdout.isEmpty ? secretResult.stderr : secretResult.stdout
                        return .failed(reason: "couldn't push \(name): \(output)", exitCode: secretResult.exitCode, resources: resources)
                    }
                } catch {
                    return .failed(reason: "couldn't push \(name): \(error)", exitCode: nil, resources: resources)
                }
            }
        }

        let hasWebmentionReceive = workers.contains(where: { $0.id == WorkerComposition.webmentionWorkerID })
        let hasWebSub = workers.contains(where: { $0.id == WorkerComposition.websubWorkerID })
        let hasMicrosub = workers.contains(where: { $0.id == WorkerComposition.microsubWorkerID })
        let needsWebmentionQueue = hasWebmentionReceive && resources.queueName == nil
        let needsWebSubQueue = hasWebSub && resources.websubQueueName == nil
        let needsMicrosubQueue = hasMicrosub && resources.microsubQueueName == nil
        if needsWebmentionQueue || needsWebSubQueue || needsMicrosubQueue {
            guard acknowledgesPaidPlan else {
                return .webmentionPaidPlanConfirmationNeeded(resources: resources)
            }
        }
        if needsWebmentionQueue {
            let name = "\(siteName)-webmention"
            let result = await runWrangler(
                siteDirectory: siteDirectory,
                arguments: ["queues", "create", name, "--json"],
                environment: environment,
                source: source,
                resources: resources
            )
            switch result {
            case .success:
                resources.queueName = name
            case .failure(let failure):
                return failure
            }
            if let failure = persistConfig(
                siteDirectory: siteDirectory, siteName: siteName, workers: workers,
                routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName
            ) {
                return failure
            }
        }

        if needsWebSubQueue {
            let name = "\(siteName)-websub"
            let result = await runWrangler(
                siteDirectory: siteDirectory,
                arguments: ["queues", "create", name, "--json"],
                environment: environment,
                source: source,
                resources: resources
            )
            switch result {
            case .success:
                resources.websubQueueName = name
            case .failure(let failure):
                return failure
            }
            if let failure = persistConfig(
                siteDirectory: siteDirectory, siteName: siteName, workers: workers,
                routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName
            ) {
                return failure
            }
        }

        if needsMicrosubQueue {
            let name = "\(siteName)-microsub"
            let result = await runWrangler(
                siteDirectory: siteDirectory,
                arguments: ["queues", "create", name, "--json"],
                environment: environment,
                source: source,
                resources: resources
            )
            switch result {
            case .success:
                resources.microsubQueueName = name
            case .failure(let failure):
                return failure
            }
            if let failure = persistConfig(
                siteDirectory: siteDirectory, siteName: siteName, workers: workers,
                routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName
            ) {
                return failure
            }
        }

        if let failure = persistConfig(siteDirectory: siteDirectory, siteName: siteName, workers: workers, routeClaims: routeClaims, resources: resources, siteURL: siteURL, displayName: displayName) {
            return failure
        }

        // @dwk/indieauth deliberately keeps schema deployment outside its request handler. Apply
        // the committed D1 migrations after wrangler.toml contains the concrete database id and
        // before publishing code that can receive authorization requests.
        if workers.contains(where: { $0.id == WorkerComposition.indieauthWorkerID }) {
            let result = await runWrangler(
                siteDirectory: siteDirectory,
                arguments: ["d1", "migrations", "apply", "AUTH_DB", "--remote"],
                environment: environment,
                source: source,
                resources: resources
            )
            if case .failure(let failure) = result {
                return failure
            }
        }

        switch await deployer(token, siteID, siteDirectory, wellKnownDynamicClaims) {
        case .succeeded(let url, _):
            return .succeeded(url: url, resources: resources, duration: Date().timeIntervalSince(started))
        case .blocked(let failures, let warnings):
            return .blocked(failures: failures, warnings: warnings, resources: resources)
        case .workerNameConflict(let name):
            return .workerNameConflict(name: name, resources: resources)
        case .failed(let reason, let exitCode):
            return .failed(reason: reason, exitCode: exitCode, resources: resources)
        }
    }

    private enum StepResult {
        case success(String)
        case failure(Result)
    }

    private func runWrangler(
        siteDirectory: URL,
        arguments: [String],
        environment: [String: String],
        source: String,
        resources: WorkerComposition.ProvisionedResources
    ) async -> StepResult {
        do {
            let result = try await runner(siteDirectory, arguments, environment, source)
            let output = result.stdout.isEmpty ? result.stderr : result.stdout
            guard result.exitCode == 0 else {
                return .failure(.failed(
                    reason: output.isEmpty ? "wrangler exited with code \(result.exitCode)" : output,
                    exitCode: result.exitCode,
                    resources: resources
                ))
            }
            return .success(output)
        } catch {
            return .failure(.failed(reason: "wrangler could not run: \(error)", exitCode: nil, resources: resources))
        }
    }

    private func persistConfig(
        siteDirectory: URL,
        siteName: String,
        workers: [WorkerDescriptor],
        routeClaims: [WorkerRouteClaim],
        resources: WorkerComposition.ProvisionedResources,
        siteURL: String? = nil,
        displayName: String? = nil
    ) -> Result? {
        do {
            // Called without `inboxCaptureEnabled`/`inboxKVNamespaceID` — #587's inbox-capture
            // provisioning doesn't route through here yet. If/when it starts writing an
            // `INBOX_KV` binding via those params elsewhere, this call site needs the same
            // params or it will silently strip that binding on the next worker-composition
            // deploy.
            let toml = try WorkerComposition.generateWranglerToml(
                siteName: siteName,
                workers: workers,
                routeClaims: routeClaims,
                resources: resources,
                siteURL: siteURL,
                displayName: displayName
            )
            try toml.write(
                to: siteDirectory.appendingPathComponent("wrangler.toml"),
                atomically: true,
                encoding: .utf8
            )
            // Reflects "the receiver is actually live" (webmention worker active AND its Queue
            // exists), not just "webmention worker is in the active set" — and is written
            // unconditionally on every call (not gated behind `if hasWebmentionReceive`), so a
            // redeploy always reconciles it to the current true state, the same way the
            // D1/KV/R2/Queue TOML blocks above are always regenerated fresh. Without this, a
            // site that later deactivates webmention would keep advertising
            // `<link rel="webmention">` at an endpoint the Worker no longer serves.
            let hasWebmentionReceive = workers.contains(where: { $0.id == WorkerComposition.webmentionWorkerID })
            let webmentionReceiveEnabled = hasWebmentionReceive && resources.queueName != nil
            // Same "actually live" contract for Micropub: the flag gates BaseLayout.astro's
            // `<link rel="micropub">` discovery tag (Micropub/Micro.blog clients — including the
            // Micro.blog iOS/Mac apps — resolve the posting endpoint from that link, per
            // https://book.micro.blog/micropub/). Micropub has no bespoke queue of its own — it
            // rides the shared per-site D1 database (bound as MICROPUB_DB) and R2 bucket (bound
            // as MEDIA), both generic `resources` fields — so "actually live" here means those
            // two ids were actually assigned by provisioning, not just that the worker is in the
            // active set.
            let hasMicropub = workers.contains(where: { $0.id == WorkerComposition.micropubWorkerID })
            let micropubEnabled = hasMicropub && resources.d1DatabaseID != nil && resources.r2BucketName != nil
            // Same "actually live" contract for the WebSub hub: the flag gates the feeds'
            // rel="hub" advertisement (src/lib/feeds.ts), which must never point at an endpoint
            // the Worker doesn't serve or a hub whose Queue doesn't exist.
            let hasWebSub = workers.contains(where: { $0.id == WorkerComposition.websubWorkerID })
            let websubEnabled = hasWebSub && resources.websubQueueName != nil
            let configURL = siteDirectory.appendingPathComponent(".site-config")
            let existing = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
            let updated = SiteConfigFile.upsert(
                [
                    ("WEBMENTION_RECEIVE_ENABLED", webmentionReceiveEnabled ? "true" : "false"),
                    ("MICROPUB_ENABLED", micropubEnabled ? "true" : "false"),
                    ("WEBSUB_ENABLED", websubEnabled ? "true" : "false"),
                ], into: existing
            )
            if updated != existing {
                try updated.write(to: configURL, atomically: true, encoding: .utf8)
            }
            return nil
        } catch {
            return .failed(reason: "couldn't write wrangler.toml: \(error)", exitCode: nil, resources: resources)
        }
    }

    static func readPersistedResources(from siteDirectory: URL) -> WorkerComposition.ProvisionedResources {
        let url = siteDirectory.appendingPathComponent("wrangler.toml")
        guard let toml = try? String(contentsOf: url, encoding: .utf8) else {
            return .init()
        }
        // Three features each own a queue; the generated names are deterministic
        // (`<site>-webmention` / `<site>-websub` / `<site>-microsub`), so classify every
        // `queue = "…"` value by its suffix rather than taking the first match (which would
        // mis-assign whichever block happened to be emitted first). All matches are positive
        // (rather than "webmention = doesn't end in -websub") so a future queue-backed feature
        // can't get silently misclassified as another's queue just because it doesn't end in
        // that other feature's suffix.
        let queueNames = extractAllTomlStrings(named: "queue", from: toml)
        return .init(
            d1DatabaseID: extractTomlString(named: "database_id", from: toml),
            kvNamespaceID: extractTomlString(named: "id", from: toml),
            r2BucketName: extractTomlString(named: "bucket_name", from: toml),
            queueName: queueNames.first(where: { $0.hasSuffix("-webmention") }),
            websubQueueName: queueNames.first(where: { $0.hasSuffix("-websub") }),
            microsubQueueName: queueNames.first(where: { $0.hasSuffix("-microsub") })
        )
    }

    static func extractResourceID(from output: String) -> String? {
        if let data = output.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data),
           let id = findID(in: json) {
            return id
        }
        let pattern = #""?(?:id|uuid|database_id|namespace_id)"?\s*[:=]\s*"([^"]+)""#
        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)),
           match.numberOfRanges > 1,
           let range = Range(match.range(at: 1), in: output) {
            return String(output[range])
        }
        return nil
    }

    private static func extractTomlString(named key: String, from toml: String) -> String? {
        extractAllTomlStrings(named: key, from: toml).first
    }

    private static func extractAllTomlStrings(named key: String, from toml: String) -> [String] {
        let escaped = NSRegularExpression.escapedPattern(for: key)
        let pattern = #"(?m)^\s*#(KEY)\s*=\s*"([^"]+)""#.replacingOccurrences(of: "#(KEY)", with: escaped)
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: toml, range: NSRange(toml.startIndex..., in: toml)).compactMap { match in
            guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: toml) else { return nil }
            let value = String(toml[range])
            return value.isEmpty ? nil : value
        }
    }

    private static func findID(in value: Any) -> String? {
        if let dict = value as? [String: Any] {
            for key in ["id", "uuid", "database_id", "namespace_id"] {
                if let id = dict[key] as? String, !id.isEmpty {
                    return id
                }
            }
            for child in dict.values {
                if let id = findID(in: child) {
                    return id
                }
            }
        }
        if let array = value as? [Any] {
            for child in array {
                if let id = findID(in: child) {
                    return id
                }
            }
        }
        return nil
    }

    public static let defaultRunner: CommandRunner = { siteDirectory, arguments, environment, source in
        let reason = HostNodeRetirement.reason("social worker provisioning")
        await LogCenter.shared.append(source: source, stream: .stderr, text: reason)
        return ProcessSupervisor.RunResult(stdout: reason, stderr: "", exitCode: 127)
    }

    public static let defaultSecretRunner: SecretRunner = { siteDirectory, name, value, environment, source in
        let reason = HostNodeRetirement.reason("social worker secret provisioning")
        await LogCenter.shared.append(source: source, stream: .stderr, text: reason)
        return ProcessSupervisor.RunResult(stdout: reason, stderr: "", exitCode: 127)
    }

    public static let defaultKeyPairSource: KeyPairSource = { siteID in
        try ActivityPubKeyProvisioning.secrets(siteID: siteID, secretStore: PlatformSecretStore.make())
    }

    // Calls `DeployCommand.deploy` with `configDirectory` still defaulted (route-coverage
    // scanning skipped, #530), but now forwards `wellKnownDynamicClaims` through to #744's
    // pre-build /.well-known/ collision check (#934) — `provision`'s caller supplies whatever
    // active dynamic-route claims it computed (empty if it didn't, matching prior behavior).
    // `DeployModel.runDeploy` still constructs its own deployer closure (for `configDirectory`/
    // `onPreflight`/`onProgress`, which this default has no equivalent for).
    public static let defaultDeployer: Deployer = { token, siteID, siteDirectory, wellKnownDynamicClaims in
        await DeployCommand(tokenSource: { token }).deploy(
            siteID: siteID, siteDirectory: siteDirectory, wellKnownDynamicClaims: wellKnownDynamicClaims)
    }
}

extension SocialWorkerProvisionCommand.Result {
    /// Maps this result onto `DeployCommand.Result`'s shape, dropping the `resources` payload
    /// (no caller surfaces it through this seam) — the shared mapping both `DeployModel.runDeploy`
    /// and `SiteOperations.deployWithWorkerComposition` need after routing every deploy through
    /// `SocialWorkerProvisionCommand.provision`.
    public var asDeployCommandResult: DeployCommand.Result {
        switch self {
        case .succeeded(let url, _, let duration):
            return .succeeded(url: url, duration: duration)
        case .blocked(let failures, let warnings, _):
            return .blocked(failures: failures, warnings: warnings)
        case .workerNameConflict(let name, _):
            return .workerNameConflict(name: name)
        case .webmentionPaidPlanConfirmationNeeded:
            // `DeployCommand.Result` has no equivalent case yet — callers that go through this
            // convenience mapping (rather than reading `SocialWorkerProvisionCommand.Result`
            // directly) see this as a plain failure until the confirmation-sheet wiring lands.
            return .failed(
                reason: "Inbound Webmention and WebSub require the Cloudflare Workers Paid plan — confirm in Settings before deploying",
                exitCode: nil
            )
        case .failed(let reason, let exitCode, _):
            return .failed(reason: reason, exitCode: exitCode)
        }
    }
}
