import Foundation

/// Runs `SocialWorkerProvisionCommand`'s wrangler subcommands (`d1`/`kv`/`r2 create`,
/// `d1 migrations apply`, …) inside a running container via `LocalContainerControl.exec` —
/// the `CommandRunner` counterpart to `ContainerDeployExecutor` (`DeployExecutor.swift:61-168`),
/// which does the same for the three fixed deploy steps. `SocialWorkerProvisionCommand`'s
/// `arguments` are already bare wrangler subcommand argv (e.g. `["d1", "create", name, "--json"]`);
/// this just prefixes `["npx", "wrangler"]` and adapts the result shape.
public struct ContainerCommandRunner: Sendable {
    private let control: any LocalContainerControl
    private let siteID: String
    private let logCenter: LogCenter

    public init(control: any LocalContainerControl, siteID: String, logCenter: LogCenter = .shared) {
        self.control = control
        self.siteID = siteID
        self.logCenter = logCenter
    }

    /// Bind this instance's `run` as a `SocialWorkerProvisionCommand.CommandRunner` closure.
    public var runner: SocialWorkerProvisionCommand.CommandRunner {
        { [self] siteDirectory, arguments, environment, source in
            try await self.run(siteDirectory: siteDirectory, arguments: arguments, environment: environment, source: source)
        }
    }

    /// Bind this instance's secret-push as a `SocialWorkerProvisionCommand.SecretRunner` closure.
    public var secretRunner: SocialWorkerProvisionCommand.SecretRunner {
        { [self] siteDirectory, name, value, environment, source in
            try await self.runSecret(siteDirectory: siteDirectory, name: name, value: value, environment: environment, source: source)
        }
    }

    // Guest-only allowlist — same rationale as `ContainerDeployExecutor.guestEnvAllowlist`: the
    // host (macOS) environment must never cross into the Linux guest wholesale.
    private static let guestEnvAllowlist: Set<String> = ["CLOUDFLARE_API_TOKEN"]

    private func run(
        siteDirectory: URL,
        arguments: [String],
        environment: [String: String],
        source: String
    ) async throws -> ProcessSupervisor.RunResult {
        let argv = ["npx", "wrangler"] + arguments
        let guestEnvironment = environment.filter { Self.guestEnvAllowlist.contains($0.key) }

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
                environment: guestEnvironment,
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch {
            continuation.finish()
            _ = await drain.value
            throw error
        }
        continuation.finish()
        _ = await drain.value
        return ProcessSupervisor.RunResult(stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode)
    }

    /// Pushes `value` as the named Cloudflare Worker secret. `wrangler secret put <NAME>` reads
    /// its value from stdin, which `exec` (one-shot, no stdin plumbing) can't supply directly —
    /// instead this runs a tiny in-guest shell script that reads the value from an environment
    /// variable and pipes it in itself, so the secret's actual bytes never appear in `argv` or in
    /// the script text (only the two fixed variable *names* do). `name` and `value` are passed
    /// via the same `environment` allowlist mechanism `CLOUDFLARE_API_TOKEN` already uses — this
    /// call's environment additions are scoped to this one invocation, never merged into the
    /// broader `guestEnvAllowlist` set other wrangler calls share.
    private func runSecret(
        siteDirectory: URL,
        name: String,
        value: String,
        environment: [String: String],
        source: String
    ) async throws -> ProcessSupervisor.RunResult {
        var guestEnvironment = environment.filter { Self.guestEnvAllowlist.contains($0.key) }
        guestEnvironment["WRANGLER_SECRET_NAME"] = name
        guestEnvironment["WRANGLER_SECRET_VALUE"] = value
        let argv = [
            "sh", "-c",
            "printf '%s' \"$WRANGLER_SECRET_VALUE\" | npx wrangler secret put \"$WRANGLER_SECRET_NAME\"",
        ]

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
                environment: guestEnvironment,
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch {
            continuation.finish()
            _ = await drain.value
            throw error
        }
        continuation.finish()
        _ = await drain.value
        return ProcessSupervisor.RunResult(stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode)
    }
}
