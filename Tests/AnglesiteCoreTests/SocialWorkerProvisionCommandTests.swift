import Foundation
import Testing
@testable import AnglesiteCore

private func worker(_ id: String, d1: Bool, kv: Bool, r2: Bool) -> WorkerDescriptor {
    WorkerDescriptor(
        id: id, displayName: id, description: "test fixture", group: "test",
        binding: .settingsActivated, resources: .init(needsD1: d1, needsKV: kv, needsR2: r2)
    )
}

private let webmentionWorker = worker("webmention", d1: true, kv: true, r2: false)
private let indieauthWorker = worker("indieauth", d1: true, kv: true, r2: false)
private let micropubWorker = worker("micropub", d1: true, kv: true, r2: true)
private let websubWorker = worker("websub", d1: true, kv: true, r2: false)
private let v2Workers = [webmentionWorker, indieauthWorker]
private let v3Workers = [webmentionWorker, indieauthWorker, micropubWorker, websubWorker]
private let solidOidcWorker = worker(WorkerComposition.solidOidcWorkerID, d1: true, kv: false, r2: false)
private let solidPodWorker = worker(WorkerComposition.solidPodWorkerID, d1: false, kv: false, r2: true)
private let webdavWorker = worker(WorkerComposition.webdavWorkerID, d1: false, kv: false, r2: true)

@Suite("SocialWorkerProvisionCommand")
struct SocialWorkerProvisionCommandTests {
    @Test("first-ever deploy (no existing wrangler.toml/CF_PROJECT_NAME) sends a non-empty database name as the d1 create positional argument")
    func firstDeployD1CreateArgumentsAreWellFormed() async throws {
        // Regression coverage for a suspected first-deploy D1-provisioning bug: a brand-new site
        // (empty `siteDirectory`, so `readPersistedResources` finds no wrangler.toml and
        // `knownResources` defaults to `.init()`) with a D1-needing worker active. The concern was
        // that `wrangler d1 create <name> --json` might reach the real subprocess with an empty/
        // missing name positional (reproducing wrangler's own "Not enough non-option arguments"
        // usage synopsis) — this asserts the exact argv `runWrangler` hands to the `CommandRunner`
        // seam contains a well-formed, non-empty name in the correct position, so any future
        // refactor that drops or empties it fails this test immediately.
        let site = try temporaryDirectory()
        #expect(!FileManager.default.fileExists(atPath: site.appendingPathComponent("wrangler.toml").path))
        var capturedArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: { _, arguments, _, _ in
                capturedArguments.append(arguments)
                if arguments.first == "d1" {
                    return .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let indieauth = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauth], knownResources: .init()
        )

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        let d1CreateCall = try #require(capturedArguments.first { $0.first == "d1" && $0.dropFirst().first == "create" })
        #expect(d1CreateCall.count == 4, "expected exactly [\"d1\", \"create\", <name>, \"--json\"], got \(d1CreateCall)")
        let name = d1CreateCall[2]
        #expect(!name.isEmpty, "the database name positional must never be empty")
        #expect(name == "my-site-social")
        #expect(d1CreateCall == ["d1", "create", "my-site-social", "--json"])
    }

    @Test("provisions V-2 D1 and KV, writes wrangler.toml, then deploys through DeployCommand seam")
    func provisionsV2Worker() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"id":"kv-id"}}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
        let command = SocialWorkerProvisionCommand(tokenSource: { "token" }, runner: recorder.runner, deployer: deployer.deployer)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers,
            acknowledgesPaidPlan: true
        )

        guard case .succeeded(let url, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(url == URL(string: "https://my-site.example.workers.dev"))
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")
        #expect(resources.r2BucketName == nil)
        #expect(resources.queueName == "my-site-webmention")
        #expect(await recorder.arguments == [
            ["d1", "create", "my-site-social", "--json"],
            ["kv", "namespace", "create", "my-site-social", "--json"],
            ["queues", "create", "my-site-webmention", "--json"],
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"],
        ])
        #expect(await recorder.environments.allSatisfy { $0["CLOUDFLARE_API_TOKEN"] == "token" })
        #expect(await deployer.calls == [
            .init(token: "token", siteID: "site-1", siteDirectory: site, wellKnownDynamicClaims: []),
        ])

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("main = \"worker/worker.ts\""))
        #expect(toml.contains("database_id = \"d1-id\""))
        #expect(toml.contains("id = \"kv-id\""))
        #expect(!toml.contains("[[r2_buckets]]"))
    }

    @Test("forwards wellKnownDynamicClaims to the deployer so #744's collision check sees them (#934)")
    func forwardsWellKnownDynamicClaimsToDeployer() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"id":"kv-id"}}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
        let command = SocialWorkerProvisionCommand(tokenSource: { "token" }, runner: recorder.runner, deployer: deployer.deployer)
        let claims = [
            WorkerRouteClaims.OwnedClaim(
                owner: "webfinger",
                claim: WorkerRouteClaim(path: "/.well-known/webfinger", match: .exact, methods: ["GET"], handler: "webfinger")
            ),
        ]

        _ = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers,
            acknowledgesPaidPlan: true, wellKnownDynamicClaims: claims
        )

        #expect(await deployer.calls == [
            .init(token: "token", siteID: "site-1", siteDirectory: site, wellKnownDynamicClaims: claims),
        ])
    }

    @Test("provisions R2 only when a selected feature needs media")
    func provisionsR2ForMicropub() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"uuid":"d1-id"}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"id":"kv-id"}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-websub", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-websub"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )

        let result = await command.provision(
            siteID: "site-1",
            siteDirectory: site,
            siteName: "my-site",
            workers: v3Workers,
            acknowledgesPaidPlan: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.r2BucketName == "my-site-media")

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("[[r2_buckets]]"))
        #expect(toml.contains("bucket_name = \"my-site-media\""))
    }

    @Test("inboxCaptureEnabled creates the INBOX_KV namespace, resolves the account id, and writes both into wrangler.toml")
    func provisionsInboxCapture() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["kv", "namespace", "create", "my-site-inbox", "--json"]: .init(stdout: #"{"result":{"id":"inbox-kv-id"}}"#, stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in "acct-1" }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            inboxCaptureEnabled: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == "inbox-kv-id")
        #expect(resources.inboxAccountID == "acct-1")
        #expect(await recorder.arguments == [
            ["kv", "namespace", "create", "my-site-inbox", "--json"],
        ])

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("main = \"worker/worker.ts\""))
        #expect(toml.contains("id = \"inbox-kv-id\""))
    }

    @Test("inboxCaptureEnabled false never invokes wrangler kv namespace create")
    func inboxCaptureDisabledNeverCreatesNamespace() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in
                Issue.record("accountIDSource must not be called when inbox capture is disabled")
                return nil
            }
        )

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == nil)
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("a namespace id already known from settings is reused, not recreated")
    func inboxCaptureReusesKnownNamespace() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in
                Issue.record("accountIDSource must not be called when the namespace id is already known")
                return nil
            }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            knownResources: .init(inboxKVNamespaceID: "existing-ns", inboxAccountID: "existing-acct"),
            inboxCaptureEnabled: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == "existing-ns")
        #expect(resources.inboxAccountID == "existing-acct")
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("a known namespace with a still-nil account id retries account resolution without re-creating the namespace")
    func inboxCaptureRetriesStrandedAccountID() async throws {
        // Regression coverage for the final-review finding: if a prior provisioning run created
        // the KV namespace but `accountIDSource` returned nil that time (e.g. a transient
        // Cloudflare API error), the account id must still be resolvable on a later run — it must
        // not be permanently stranded just because the namespace already exists.
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in "acct-2" }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            knownResources: .init(inboxKVNamespaceID: "existing-ns", inboxAccountID: nil),
            inboxCaptureEnabled: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.inboxKVNamespaceID == "existing-ns")
        #expect(resources.inboxAccountID == "acct-2")
        #expect(await recorder.arguments.isEmpty, "must not call wrangler kv namespace create again for a namespace that already exists")
    }

    @Test("a KV creation failure for inbox capture is reported without corrupting resources")
    func inboxCapturePartialFailure() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["kv", "namespace", "create", "my-site-inbox", "--json"]: .init(stdout: "KV failed", stderr: "", exitCode: 1),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer,
            accountIDSource: { _ in "acct-1" }
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [],
            inboxCaptureEnabled: true
        )

        guard case .failed(let reason, let exitCode, let resources) = result else {
            Issue.record("expected failure, got \(result)")
            return
        }
        #expect(reason == "KV failed")
        #expect(exitCode == 1)
        #expect(resources.inboxKVNamespaceID == nil)
    }

    @Test("provisions Micropub (real catalog id, requires indieauth) end-to-end")
    func provisionsMicropubWithIndieauth() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let indieauth = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauth, micropub], acknowledgesPaidPlan: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.r2BucketName == "my-site-media")

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("binding = \"MICROPUB_DB\""))
        #expect(toml.contains("binding = \"AUTH_DB\""))
        #expect(toml.contains("[[r2_buckets]]"))
        #expect(toml.contains("bucket_name = \"my-site-media\""))
    }

    @Test("provisions ActivityPub: generates keys once, pushes secrets, writes the DO binding")
    func provisionsActivityPub() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        var pushedSecrets: [(name: String, value: String)] = []
        let secretRunnerLock = NSLock()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            keyPairSource: { _ in
                .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE")
            },
            secretRunner: { _, name, value, _, _ in
                secretRunnerLock.lock()
                pushedSecrets.append((name, value))
                secretRunnerLock.unlock()
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub])

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(pushedSecrets.contains { $0.name == "AP_PRIVATE_KEY" && $0.value == "PRIVATE-PEM" })
        #expect(pushedSecrets.contains { $0.name == "AP_PUBLIC_KEY" && $0.value == "PUBLIC-PEM" })
        #expect(pushedSecrets.contains { $0.name == "AP_PUBLISH_TOKEN" && $0.value == "TOKEN-VALUE" })

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("[[durable_objects.bindings]]"))
    }

    @Test("ActivityPub-only (no D1/KV/R2 worker active) has wrangler.toml on disk before the first secret push")
    func activitypubOnlyPersistsConfigBeforeSecrets() async throws {
        // ActivityPub's catalog resources are all needsD1/needsKV/needsR2 == false (it only needs
        // a Durable Object, which isn't tracked by those flags), so when it's the only active
        // worker none of the D1/KV/R2 blocks in `provision()` run. Regression coverage for #363:
        // `wrangler secret put` resolves its target Worker's name from `wrangler.toml` in the
        // working directory, so that file must already exist by the time the first secretRunner
        // call happens — checking only the final on-disk state (as `provisionsActivityPub` above
        // does) wouldn't catch an ordering bug, since the unconditional `persistConfig` call at
        // the very end of `provision()` would paper over it in a passing test even with the bug
        // present. So this secretRunner closure itself reads and asserts on `wrangler.toml`
        // *before* returning success — that's exactly the moment a real `wrangler secret put`
        // subprocess would need the file to already be resolvable.
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        var secretRunnerCallCount = 0
        var tomlContentsAtFirstSecretCall: String?
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            keyPairSource: { _ in
                .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE")
            },
            secretRunner: { siteDirectory, _, _, _, _ in
                secretRunnerCallCount += 1
                if secretRunnerCallCount == 1 {
                    tomlContentsAtFirstSecretCall = try? String(
                        contentsOf: siteDirectory.appendingPathComponent("wrangler.toml"), encoding: .utf8
                    )
                }
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub])

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(secretRunnerCallCount == 3)
        let toml = try #require(tomlContentsAtFirstSecretCall, "wrangler.toml must exist before the first secretRunner call")
        #expect(toml.contains("[[durable_objects.bindings]]"))
    }

    @Test("no activitypub worker means keyPairSource and the ActivityPub secretRunner calls never run")
    func noActivitypubSkipsKeyGeneration() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        var keyPairSourceCalled = false
        var secretRunnerCalled = false
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            keyPairSource: { _ in
                keyPairSourceCalled = true
                return .init(privateKeyPem: "x", publicKeyPem: "y", publishToken: "z")
            },
            secretRunner: { _, _, _, _, _ in
                secretRunnerCalled = true
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )

        _ = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

        #expect(!keyPairSourceCalled)
        #expect(!secretRunnerCalled)
    }

    @Test("a secretRunner failure fails provisioning before deploy")
    func secretPushFailureFailsProvisioning() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            keyPairSource: { _ in .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE") },
            secretRunner: { _, name, _, _, _ in
                if name == "AP_PUBLIC_KEY" {
                    return .init(stdout: "", stderr: "authentication error", exitCode: 1)
                }
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: deployer.deployer
        )
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub])

        guard case .failed = result else {
            Issue.record("expected failure, got \(result)")
            return
        }
        #expect(await deployer.calls.isEmpty)
    }

    @Test("A retry after an earlier attempt's own secret push isn't mistaken for a foreign Worker-name conflict (#1075)")
    func retryAfterOwnSecretPushDoesNotFalselyConflict() async throws {
        let site = try temporaryDirectory()
        // Mirrors the reported repro: `.site-config` already carries this site's own established
        // project name from an earlier (partially-failed) attempt.
        try "CF_PROJECT_NAME=my-site\n".write(to: site.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let remoteNames = ToggleableWorkerNames()
        let deployCallCount = CallCounter()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            keyPairSource: { _ in
                .init(privateKeyPem: "PRIVATE-PEM", publicKeyPem: "PUBLIC-PEM", publishToken: "TOKEN-VALUE")
            },
            secretRunner: { _, _, _, _, _ in
                // Mirrors the real `wrangler secret put` side effect described in the bug report:
                // once our own secret push succeeds, the account reports this name as an existing
                // Worker script from then on.
                await remoteNames.set(["my-site"])
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in
                let call = await deployCallCount.increment()
                if call == 1 {
                    // Attempt 1 fails for an unrelated reason AFTER secrets have already pushed.
                    return .failed(reason: "pre-deploy scan could not run", exitCode: nil)
                }
                return .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)
            },
            workerScriptNamesSource: { _ in await remoteNames.current }
        )
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: false, kv: false, r2: false)

        let firstResult = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub]
        )
        guard case .failed = firstResult else {
            Issue.record("expected the first attempt to fail for the unrelated reason, got \(firstResult)")
            return
        }

        let secondResult = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub]
        )
        guard case .succeeded = secondResult else {
            Issue.record("expected the retry to succeed instead of reporting a false worker-name conflict, got \(secondResult)")
            return
        }
    }

    @Test("A genuinely foreign name collision is caught before any wrangler call touches it (#1075)")
    func foreignConflictCaughtBeforeAnyProvisioning() async throws {
        let site = try temporaryDirectory()
        try "CF_PROJECT_NAME=my-site\n".write(to: site.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        var d1CallHappened = false
        var secretRunnerCalled = false
        var deployerCalled = false
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: { _, _, _, _ in
                d1CallHappened = true
                return .init(stdout: "", stderr: "unexpected call", exitCode: 1)
            },
            keyPairSource: { _ in .init(privateKeyPem: "x", publicKeyPem: "y", publishToken: "z") },
            secretRunner: { _, _, _, _, _ in
                secretRunnerCalled = true
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in
                deployerCalled = true
                return .succeeded(url: URL(string: "https://example.com")!, duration: 0)
            },
            // The account already has a script under this exact name — a genuinely foreign
            // project this site's local config has no history with.
            workerScriptNamesSource: { _ in ["my-site"] }
        )
        let activitypub = worker(WorkerComposition.activitypubWorkerID, d1: true, kv: false, r2: false)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [activitypub]
        )

        guard case .workerNameConflict(let name, _) = result else {
            Issue.record("expected .workerNameConflict, got \(result)")
            return
        }
        #expect(name == "my-site")
        #expect(!d1CallHappened, "must not create D1 resources against a name that isn't confirmed ours")
        #expect(!secretRunnerCalled, "must not push ActivityPub secrets into a Worker name that isn't confirmed ours")
        #expect(!deployerCalled, "must not reach the deployer once the pre-check finds a genuine conflict")
    }

    @Test("fails before running wrangler when no token is available")
    func missingToken() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        let command = SocialWorkerProvisionCommand(tokenSource: { nil }, runner: recorder.runner)

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

        guard case .failed(let reason, nil, let resources) = result else {
            Issue.record("expected token failure, got \(result)")
            return
        }
        #expect(reason.contains("no CLOUDFLARE_API_TOKEN"))
        #expect(resources == .init())
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("reuses persisted resource ids and does not recreate Cloudflare backing stores")
    func reusesPersistedResources() async throws {
        let site = try temporaryDirectory()
        let existing = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: v3Workers,
            // r2BucketName must follow the deterministic `<site>-media` suffix that
            // readPersistedResources classifies on, unlike the d1/kv ids which are
            // read back via first-match and can be arbitrary.
            resources: .init(d1DatabaseID: "d1-existing", kvNamespaceID: "kv-existing", r2BucketName: "my-site-media")
        )
        try existing.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let recorder = WranglerRecorder([
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )

        let result = await command.provision(
            siteID: "site-1",
            siteDirectory: site,
            siteName: "my-site",
            workers: v3Workers
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.d1DatabaseID == "d1-existing")
        #expect(resources.kvNamespaceID == "kv-existing")
        #expect(resources.r2BucketName == "my-site-media")
        #expect(await recorder.arguments == [
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"],
        ])
    }

    @Test("persists partial D1 resources and reports them when KV creation fails")
    func partialFailureReportsResources() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"uuid":"d1-id"}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: "KV failed", stderr: "", exitCode: 1),
        ])
        let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
        let command = SocialWorkerProvisionCommand(tokenSource: { "token" }, runner: recorder.runner, deployer: deployer.deployer)

        let result = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers)

        guard case .failed(let reason, let exitCode, let resources) = result else {
            Issue.record("expected failure, got \(result)")
            return
        }
        #expect(reason == "KV failed")
        #expect(exitCode == 1)
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == nil)
        #expect(await deployer.calls.isEmpty)

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("database_id = \"d1-id\""))
    }

    @Test("keeps provisioned resources when DeployCommand fails after config is written")
    func deployFailureReportsResources() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"uuid":"d1-id"}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"id":"kv-id"}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .failed(reason: "pre-deploy scan could not run", exitCode: nil)).deployer
        )

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers,
            acknowledgesPaidPlan: true
        )

        guard case .failed(let reason, nil, let resources) = result else {
            Issue.record("expected deploy failure, got \(result)")
            return
        }
        #expect(reason == "pre-deploy scan could not run")
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("database_id = \"d1-id\""))
        #expect(toml.contains("id = \"kv-id\""))
    }

    @Test("a worker-name conflict from the deployer is propagated, not collapsed to failed")
    func workerNameConflictPropagates() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"id":"kv-id"}}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let deployer = DeployRecorder(result: .workerNameConflict(name: "taken-name"))
        let command = SocialWorkerProvisionCommand(tokenSource: { "token" }, runner: recorder.runner, deployer: deployer.deployer)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers,
            acknowledgesPaidPlan: true
        )

        guard case .workerNameConflict(let name, let resources) = result else {
            Issue.record("expected .workerNameConflict, got \(result)"); return
        }
        #expect(name == "taken-name")
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")
    }

    @Test("stops before deploy when the IndieAuth schema migration fails")
    func migrationFailureStopsDeploy() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"uuid":"d1-id"}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"id":"kv-id"}"#, stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migration failed", stderr: "", exitCode: 1),
        ])
        let deployer = DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1))
        let command = SocialWorkerProvisionCommand(tokenSource: { "token" }, runner: recorder.runner, deployer: deployer.deployer)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: v2Workers,
            acknowledgesPaidPlan: true
        )

        guard case .failed(let reason, let exitCode, let resources) = result else {
            Issue.record("expected migration failure, got \(result)")
            return
        }
        #expect(reason == "Migration failed")
        #expect(exitCode == 1)
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")
        #expect(await deployer.calls.isEmpty)
    }

    @Test("extracts resource ids from common wrangler JSON shapes")
    func resourceIDExtraction() {
        #expect(SocialWorkerProvisionCommand.extractResourceID(from: #"{"result":{"uuid":"d1-id"}}"#) == "d1-id")
        #expect(SocialWorkerProvisionCommand.extractResourceID(from: #"{"id":"kv-id"}"#) == "kv-id")
        #expect(SocialWorkerProvisionCommand.extractResourceID(from: #"{"result":[{"database_id":"db-id"}]}"#) == "db-id")
        #expect(SocialWorkerProvisionCommand.extractResourceID(from: #"binding = "SOCIAL_KV"\nid = "text-id""#) == "text-id")
    }

    @Test("reads persisted resource ids from active wrangler.toml bindings only")
    func persistedResourceParsing() throws {
        let site = try temporaryDirectory()
        let toml = """
        # id = "commented-kv"
        name = "my-site"
        [[d1_databases]]
        database_id = "d1-id"
        [[kv_namespaces]]
        binding = "SOCIAL_KV"
        id = "kv-id"
        [[r2_buckets]]
        bucket_name = "my-site-media"
        """
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")
        #expect(resources.r2BucketName == "my-site-media")
    }

    @Test("knownResources is reused instead of re-scraping wrangler.toml, so a deactivated-then-reactivated worker doesn't recreate its Cloudflare resource")
    func reusesKnownResourcesOverFileScrape() async throws {
        let site = try temporaryDirectory()
        // wrangler.toml on disk reflects the CURRENT (deactivated) feature set — no R2 block, so
        // a file-scrape alone would find no bucket name and try to recreate it.
        let currentToml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site",
            workers: [indieauthWorker],
            resources: .init(d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: nil)
        )
        try currentToml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        // knownResources (as persisted in SiteSettings before deactivation) still remembers the bucket.
        let known = WorkerComposition.ProvisionedResources(
            d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: "my-site-media"
        )
        let recorder = WranglerRecorder([
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )

        // Reactivating micropub (needs R2) should reuse the known bucket, not call `r2 bucket create` again.
        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauthWorker, micropubWorker], knownResources: known
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.r2BucketName == "my-site-media")
        #expect(await recorder.arguments == [
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"],
        ])
    }

    @Test("asDeployCommandResult maps succeeded, dropping the resources payload")
    func asDeployCommandResultMapsSucceeded() {
        let url = URL(string: "https://my-site.example.workers.dev")!
        let result = SocialWorkerProvisionCommand.Result.succeeded(
            url: url, resources: .init(d1DatabaseID: "d1-id"), duration: 3
        )
        #expect(result.asDeployCommandResult == .succeeded(url: url, duration: 3))
    }

    @Test("asDeployCommandResult maps blocked, dropping the resources payload")
    func asDeployCommandResultMapsBlocked() {
        let failure = PreDeployCheck.ScanFailure(
            category: .exposedToken, message: "API key committed", file: "src/index.md", remediation: "Remove it"
        )
        let result = SocialWorkerProvisionCommand.Result.blocked(
            failures: [failure], warnings: [], resources: .init(kvNamespaceID: "kv-id")
        )
        #expect(result.asDeployCommandResult == .blocked(failures: [failure], warnings: []))
    }

    @Test("asDeployCommandResult maps workerNameConflict, dropping the resources payload")
    func asDeployCommandResultMapsWorkerNameConflict() {
        let result = SocialWorkerProvisionCommand.Result.workerNameConflict(
            name: "taken-name", resources: .init(r2BucketName: "media")
        )
        #expect(result.asDeployCommandResult == .workerNameConflict(name: "taken-name"))
    }

    @Test("asDeployCommandResult maps failed, dropping the resources payload")
    func asDeployCommandResultMapsFailed() {
        let result = SocialWorkerProvisionCommand.Result.failed(
            reason: "KV failed", exitCode: 1, resources: .init(d1DatabaseID: "d1-id")
        )
        #expect(result.asDeployCommandResult == .failed(reason: "KV failed", exitCode: 1))
    }

    @Test("webmention worker without paid-plan acknowledgment returns webmentionPaidPlanConfirmationNeeded, no wrangler call")
    func webmentionWithoutAcknowledgmentBlocksBeforeAnyCall() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "unexpected call", exitCode: 1)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [webmention], acknowledgesPaidPlan: false)

        guard case .webmentionPaidPlanConfirmationNeeded = result else {
            Issue.record("expected .webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        #expect(calledArguments.isEmpty, "must not call wrangler before the user acknowledges the paid-plan requirement")
    }

    @Test("webmention worker with acknowledgment creates the queue")
    func webmentionWithAcknowledgmentCreatesQueue() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [webmention], acknowledgesPaidPlan: true)

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(resources.queueName == "my-site-webmention")
        #expect(calledArguments.contains(["queues", "create", "my-site-webmention", "--json"]))
    }

    @Test("an already-provisioned queue is not re-created")
    func alreadyProvisionedQueueSkipsCreation() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [webmention], knownResources: .init(queueName: "my-site-webmention"),
            acknowledgesPaidPlan: true)

        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(!calledArguments.contains(where: { $0.first == "queues" }))
    }

    @Test("webmention receive writes WEBMENTION_RECEIVE_ENABLED into .site-config")
    func webmentionWritesReceiveEnabledFlag() async throws {
        let siteDirectory = try temporaryDirectory()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [webmention], acknowledgesPaidPlan: true)

        let config = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBMENTION_RECEIVE_ENABLED", in: config) == "true")
    }

    @Test("deactivating webmention reconciles WEBMENTION_RECEIVE_ENABLED back to false")
    func webmentionDeactivationReconcilesFlagToFalse() async throws {
        let siteDirectory = try temporaryDirectory()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [webmention], acknowledgesPaidPlan: true)

        let enabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBMENTION_RECEIVE_ENABLED", in: enabledConfig) == "true")

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [], acknowledgesPaidPlan: true)

        let disabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBMENTION_RECEIVE_ENABLED", in: disabledConfig) == "false")
    }

    @Test("cancelling the paid-plan gate never lets WEBMENTION_RECEIVE_ENABLED reach true")
    func webmentionPaidPlanGateCancelKeepsFlagFalse() async throws {
        let siteDirectory = try temporaryDirectory()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                #expect(arguments.first != "queues", "must not create the Queue before the paid-plan gate is acknowledged")
                if arguments.first == "d1" {
                    return .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        // needsD1: true so the D1 block's persistConfig call runs (and reconciles the flag to
        // "false") before the code reaches the paid-plan gate below it — mirrors production,
        // where webmention's real WorkerComposition resources need D1 for the inbox table.
        let webmention = WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [webmention], acknowledgesPaidPlan: false)

        guard case .webmentionPaidPlanConfirmationNeeded = result else {
            Issue.record("expected .webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        let config = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBMENTION_RECEIVE_ENABLED", in: config) == "false")
    }

    @Test("Micropub writes MICROPUB_ENABLED into .site-config, gating BaseLayout.astro's rel=micropub discovery tag")
    func micropubWritesEnabledFlag() async throws {
        let siteDirectory = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" }, runner: recorder.runner,
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let indieauth = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [indieauth, micropub], acknowledgesPaidPlan: true)

        let config = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "MICROPUB_ENABLED", in: config) == "true")
    }

    @Test("deactivating Micropub reconciles MICROPUB_ENABLED back to false")
    func micropubDeactivationReconcilesFlagToFalse() async throws {
        let siteDirectory = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" }, runner: recorder.runner,
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let indieauth = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
        let micropub = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [indieauth, micropub], acknowledgesPaidPlan: true)

        let enabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "MICROPUB_ENABLED", in: enabledConfig) == "true")

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [indieauth], acknowledgesPaidPlan: true)

        let disabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "MICROPUB_ENABLED", in: disabledConfig) == "false")
    }

    @Test("websub worker without paid-plan acknowledgment returns the confirmation-needed gate, no wrangler call")
    func websubWithoutAcknowledgmentBlocksBeforeAnyCall() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "unexpected call", exitCode: 1)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let websub = WorkerDescriptor(
            id: "websub", displayName: "WebSub", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [websub], acknowledgesPaidPlan: false)

        guard case .webmentionPaidPlanConfirmationNeeded = result else {
            Issue.record("expected .webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        #expect(calledArguments.isEmpty, "must not call wrangler before the user acknowledges the paid-plan requirement")
    }

    @Test("websub worker with acknowledgment creates its own queue")
    func websubWithAcknowledgmentCreatesQueue() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-websub"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let websub = WorkerDescriptor(
            id: "websub", displayName: "WebSub", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [websub], acknowledgesPaidPlan: true)

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(resources.websubQueueName == "my-site-websub")
        #expect(resources.queueName == nil, "no webmention worker, so no webmention queue")
        #expect(calledArguments.contains(["queues", "create", "my-site-websub", "--json"]))
        #expect(!calledArguments.contains(["queues", "create", "my-site-webmention", "--json"]))
    }

    @Test("webmention and websub active together create both queues under one acknowledgment")
    func webmentionAndWebsubCreateBothQueues() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                if arguments == ["queues", "create", "my-site-webmention", "--json"] {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0)
                }
                if arguments == ["queues", "create", "my-site-websub", "--json"] {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-websub"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let plain = { (id: String) in
            WorkerDescriptor(
                id: id, displayName: id, description: "test", group: "social",
                binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))
        }

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [plain("webmention"), plain("websub")], acknowledgesPaidPlan: true)

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(resources.queueName == "my-site-webmention")
        #expect(resources.websubQueueName == "my-site-websub")
    }

    @Test("an already-provisioned websub queue is not re-created")
    func alreadyProvisionedWebsubQueueSkipsCreation() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let websub = WorkerDescriptor(
            id: "websub", displayName: "WebSub", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [websub], knownResources: .init(websubQueueName: "my-site-websub"),
            acknowledgesPaidPlan: true)

        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(!calledArguments.contains(where: { $0.first == "queues" }))
    }

    @Test("websub writes WEBSUB_ENABLED into .site-config, and deactivation reconciles it to false")
    func websubWritesEnabledFlagAndReconciles() async throws {
        let siteDirectory = try temporaryDirectory()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-websub"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let websub = WorkerDescriptor(
            id: "websub", displayName: "WebSub", description: "test", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [websub], acknowledgesPaidPlan: true)

        let enabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBSUB_ENABLED", in: enabledConfig) == "true")

        _ = await command.provision(
            siteID: "site-1", siteDirectory: siteDirectory, siteName: "my-site",
            workers: [], acknowledgesPaidPlan: true)

        let disabledConfig = try String(contentsOf: siteDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "WEBSUB_ENABLED", in: disabledConfig) == "false")
    }

    @Test("microsub worker without paid-plan acknowledgment returns the confirmation-needed gate, no wrangler call")
    func microsubWithoutAcknowledgmentBlocksBeforeAnyCall() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "unexpected call", exitCode: 1)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let microsub = WorkerDescriptor(
            id: "microsub", displayName: "Microsub", description: "test", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [microsub], acknowledgesPaidPlan: false)

        guard case .webmentionPaidPlanConfirmationNeeded = result else {
            Issue.record("expected .webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        #expect(calledArguments.isEmpty, "must not call wrangler before the user acknowledges the paid-plan requirement")
    }

    @Test("microsub worker with acknowledgment creates its own queue")
    func microsubWithAcknowledgmentCreatesQueue() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                if arguments.first == "queues" {
                    return .init(stdout: #"{"result":{"queue_name":"my-site-microsub"}}"#, stderr: "", exitCode: 0)
                }
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let microsub = WorkerDescriptor(
            id: "microsub", displayName: "Microsub", description: "test", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [microsub], acknowledgesPaidPlan: true)

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(resources.microsubQueueName == "my-site-microsub")
        #expect(calledArguments.contains(["queues", "create", "my-site-microsub", "--json"]))
    }

    @Test("an already-provisioned microsub queue is not re-created")
    func alreadyProvisionedMicrosubQueueSkipsCreation() async throws {
        let site = try temporaryDirectory()
        var calledArguments: [[String]] = []
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "tok" },
            runner: { _, arguments, _, _ in
                calledArguments.append(arguments)
                return .init(stdout: "", stderr: "", exitCode: 0)
            },
            deployer: { _, _, _, _ in .succeeded(url: URL(string: "https://example.com")!, duration: 0) }
        )
        let microsub = WorkerDescriptor(
            id: "microsub", displayName: "Microsub", description: "test", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false))

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [microsub], knownResources: .init(microsubQueueName: "my-site-microsub"),
            acknowledgesPaidPlan: true)

        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(!calledArguments.contains(where: { $0.first == "queues" }))
    }

    @Test("readPersistedResources classifies webmention, websub, and microsub queues by suffix")
    func persistedQueueClassification() throws {
        let site = try temporaryDirectory()
        let toml = """
        name = "my-site"
        [[queues.producers]]
        queue = "my-site-webmention"
        binding = "WEBMENTION_QUEUE"
        [[queues.producers]]
        queue = "my-site-websub"
        binding = "WEBSUB_QUEUE"
        [[queues.producers]]
        queue = "my-site-microsub"
        binding = "MICROSUB_QUEUE"
        """
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.queueName == "my-site-webmention")
        #expect(resources.websubQueueName == "my-site-websub")
        #expect(resources.microsubQueueName == "my-site-microsub")
    }

    @Test("readPersistedResources with only a websub queue leaves the webmention queue nil")
    func persistedWebsubOnlyQueue() throws {
        let site = try temporaryDirectory()
        let toml = """
        name = "my-site"
        [[queues.producers]]
        queue = "my-site-websub"
        binding = "WEBSUB_QUEUE"
        """
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.queueName == nil)
        #expect(resources.websubQueueName == "my-site-websub")
    }

    @Test("readPersistedResources classifies micropub's MEDIA and solid-pod's BLOBS buckets by suffix")
    func persistedR2BucketClassification() throws {
        let site = try temporaryDirectory()
        let toml = """
        name = "my-site"
        [[r2_buckets]]
        bucket_name = "my-site-media"
        binding = "MEDIA"
        [[r2_buckets]]
        bucket_name = "my-site-pod-blobs"
        binding = "BLOBS"
        """
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.r2BucketName == "my-site-media")
        #expect(resources.podBlobsR2BucketName == "my-site-pod-blobs")
    }

    @Test("readPersistedResources with only INBOX_KV present leaves SOCIAL_KV nil and recovers the inbox id")
    func persistedInboxOnlyKVNamespaceClassification() throws {
        // Regression coverage for the final-review finding: a flat first-`id = "…"`-match scrape
        // would wrongly attribute INBOX_KV's id to kvNamespaceID (SOCIAL_KV's field) when
        // SOCIAL_KV isn't present at all.
        let site = try temporaryDirectory()
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [], inboxCaptureEnabled: true, inboxKVNamespaceID: "inbox-only-id"
        )
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.kvNamespaceID == nil)
        #expect(resources.inboxKVNamespaceID == "inbox-only-id")
    }

    @Test("readPersistedResources with both SOCIAL_KV and INBOX_KV present classifies each by binding")
    func persistedBothKVNamespacesClassification() throws {
        let site = try temporaryDirectory()
        let toml = try WorkerComposition.generateWranglerToml(
            siteName: "my-site", workers: [webmentionWorker],
            resources: .init(kvNamespaceID: "social-id"),
            inboxCaptureEnabled: true,
            inboxKVNamespaceID: "inbox-id"
        )
        try toml.write(to: site.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)

        let resources = SocialWorkerProvisionCommand.readPersistedResources(from: site)

        #expect(resources.kvNamespaceID == "social-id")
        #expect(resources.inboxKVNamespaceID == "inbox-id")
    }

    @Test("provisions solid-pod's own BLOBS bucket, distinct from micropub's MEDIA bucket")
    func provisionsSolidPodBlobsBucket() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["kv", "namespace", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"id":"kv-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-media"]: .init(stdout: "Created bucket my-site-media", stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-pod-blobs"]: .init(stdout: "Created bucket my-site-pod-blobs", stderr: "", exitCode: 0),
            ["queues", "create", "my-site-webmention", "--json"]: .init(stdout: #"{"result":{"queue_name":"my-site-webmention"}}"#, stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let micropubWorker = worker(WorkerComposition.micropubWorkerID, d1: true, kv: false, r2: true)
        let indieauthWorker = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)
        let webmentionWorker = worker(WorkerComposition.webmentionWorkerID, d1: true, kv: false, r2: false)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauthWorker, webmentionWorker, micropubWorker, solidPodWorker],
            acknowledgesPaidPlan: true
        )

        guard case .succeeded(_, let resources, _) = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(resources.r2BucketName == "my-site-media")
        #expect(resources.podBlobsR2BucketName == "my-site-pod-blobs")
        #expect(await recorder.arguments.contains(["r2", "bucket", "create", "my-site-media"]))
        #expect(await recorder.arguments.contains(["r2", "bucket", "create", "my-site-pod-blobs"]))

        let toml = try String(contentsOf: site.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains("binding = \"MEDIA\""))
        #expect(toml.contains("binding = \"BLOBS\""))
    }

    @Test("solid-oidc and webdav push their secrets via the injected key/pepper sources")
    func pushesSolidOidcAndWebdavSecrets() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([
            ["d1", "create", "my-site-social", "--json"]: .init(stdout: #"{"result":{"uuid":"d1-id"}}"#, stderr: "", exitCode: 0),
            ["r2", "bucket", "create", "my-site-pod-blobs"]: .init(stdout: "Created bucket my-site-pod-blobs", stderr: "", exitCode: 0),
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"]: .init(stdout: "Migrations applied", stderr: "", exitCode: 0),
        ])
        var pushedSecrets: [(name: String, value: String)] = []
        let secretRunnerLock = NSLock()
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            solidOidcSigningKeySource: { _ in #"{"kty":"EC","crv":"P-256","x":"X","y":"Y","d":"D"}"# },
            webdavPepperSource: { _ in "PEPPER-VALUE" },
            secretRunner: { _, name, value, _, _ in
                secretRunnerLock.lock()
                pushedSecrets.append((name, value))
                secretRunnerLock.unlock()
                return .init(stdout: "Success!", stderr: "", exitCode: 0)
            },
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )
        let indieauthWorker = worker(WorkerComposition.indieauthWorkerID, d1: true, kv: false, r2: false)

        let result = await command.provision(
            siteID: "site-1", siteDirectory: site, siteName: "my-site",
            workers: [indieauthWorker, solidOidcWorker, solidPodWorker, webdavWorker]
        )

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(pushedSecrets.contains { $0.name == "OIDC_SIGNING_KEY" && $0.value.contains("P-256") })
        #expect(pushedSecrets.contains { $0.name == "WEBDAV_PEPPER" && $0.value == "PEPPER-VALUE" })
    }

    @Test("no solid-oidc/webdav worker means their sources and secret pushes never run")
    func noSolidOidcOrWebdavMeansNoSecretPush() async throws {
        let site = try temporaryDirectory()
        let recorder = WranglerRecorder([:])
        var solidOidcSourceCalled = false
        var webdavSourceCalled = false
        let command = SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: recorder.runner,
            solidOidcSigningKeySource: { _ in
                solidOidcSourceCalled = true
                return "unused"
            },
            webdavPepperSource: { _ in
                webdavSourceCalled = true
                return "unused"
            },
            deployer: DeployRecorder(result: .succeeded(url: URL(string: "https://my-site.example.workers.dev")!, duration: 1)).deployer
        )

        _ = await command.provision(siteID: "site-1", siteDirectory: site, siteName: "my-site", workers: [])

        #expect(!solidOidcSourceCalled)
        #expect(!webdavSourceCalled)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("SocialWorkerProvisionCommandTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

private struct DeployCall: Sendable, Equatable {
    let token: String
    let siteID: String
    let siteDirectory: URL
    let wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim]
}

private actor DeployRecorder {
    private let result: DeployCommand.Result
    private var seenCalls: [DeployCall] = []

    init(result: DeployCommand.Result) {
        self.result = result
    }

    var calls: [DeployCall] { seenCalls }

    nonisolated var deployer: SocialWorkerProvisionCommand.Deployer {
        { token, siteID, siteDirectory, wellKnownDynamicClaims in
            await self.deploy(
                token: token, siteID: siteID, siteDirectory: siteDirectory,
                wellKnownDynamicClaims: wellKnownDynamicClaims)
        }
    }

    private func deploy(
        token: String, siteID: String, siteDirectory: URL,
        wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim]
    ) -> DeployCommand.Result {
        seenCalls.append(DeployCall(
            token: token, siteID: siteID, siteDirectory: siteDirectory,
            wellKnownDynamicClaims: wellKnownDynamicClaims))
        return result
    }
}

private actor WranglerRecorder {
    private let responses: [[String]: ProcessSupervisor.RunResult]
    private var seenArguments: [[String]] = []
    private var seenEnvironments: [[String: String]] = []

    init(_ responses: [[String]: ProcessSupervisor.RunResult]) {
        self.responses = responses
    }

    var arguments: [[String]] { seenArguments }
    var environments: [[String: String]] { seenEnvironments }

    nonisolated var runner: SocialWorkerProvisionCommand.CommandRunner {
        { siteDirectory, arguments, environment, source in
            _ = siteDirectory
            _ = source
            return await self.run(arguments: arguments, environment: environment)
        }
    }

    private func run(arguments: [String], environment: [String: String]) -> ProcessSupervisor.RunResult {
        seenArguments.append(arguments)
        seenEnvironments.append(environment)
        return responses[arguments] ?? .init(stdout: "unexpected arguments \(arguments)", stderr: "", exitCode: 127)
    }
}

/// A mutable account-wide Worker-script-name list, so a test can simulate `wrangler secret put`'s
/// side effect of auto-vivifying a script under the target name partway through a `provision()`
/// call (#1075).
private actor ToggleableWorkerNames {
    private var names: [String] = []
    func set(_ new: [String]) { names = new }
    var current: [String] { names }
}

/// Thread-safe invocation counter for a fake `Deployer`, so a test can vary its response across
/// successive `provision()` calls (e.g. fail the first attempt, succeed on retry).
private actor CallCounter {
    private var count = 0
    func increment() -> Int {
        count += 1
        return count
    }
}
