import Foundation

/// A site runtime that can serve MCP tool calls without a dev-server / UI surface — the seam the
/// `HeadlessRuntimePool` manages so intent-driven edits work when no site window is open. The
/// production conformer must be a container-backed runtime; the host Node fallback is retired.
public protocol HeadlessRuntime: Sendable {
    /// The per-site MCP client, used to build an `EditRouter` / call `create_page` etc. `nonisolated`
    /// so callers reach it without an actor hop.
    nonisolated var mcpClient: MCPClient { get }
    /// Spawn the MCP server for this site. Returns whether the client is running afterward.
    func startHeadlessMCP(siteID: String, siteDirectory: URL) async -> Bool
    /// Tear down the MCP client (and any other subprocesses).
    func stop() async
}

/// Pools ephemeral `HeadlessRuntime`s keyed by siteID for intent-driven edits made while no site
/// window is open (a headless Siri / Shortcuts invocation). Spawning Node per edit is expensive,
/// so a runtime is cached for `ttl` seconds and its expiry is pushed out on every use — rapid
/// successive edits to the same site reuse one MCP server. Expired runtimes are torn down.
///
/// `now`/`makeRuntime` are injectable so lifecycle is testable without a real clock or container.
public actor HeadlessRuntimePool {
    /// Produces a fresh, not-yet-started runtime for each cache miss. The seam that lets the app
    /// inject its container-backed runtime while tests inject fakes — the pool itself never knows
    /// what substrate it's pooling.
    public typealias RuntimeFactory = @Sendable () -> any HeadlessRuntime

    private struct Entry {
        let runtime: any HeadlessRuntime
        var expiresAt: Date
    }

    private var entries: [String: Entry] = [:]
    /// In-flight spawns, keyed by siteID. Concurrent `runtime(siteID:)` calls for the same
    /// not-yet-cached site join the same spawn task instead of each spawning their own Node —
    /// which would orphan all but the last (a zombie process the issue explicitly rules out).
    private var spawning: [String: Task<(any HeadlessRuntime)?, Never>] = [:]
    private let ttl: TimeInterval
    private let now: @Sendable () -> Date
    private let makeRuntime: RuntimeFactory

    /// Creates a pool. `now` is injectable so expiry is testable without real waiting. The default
    /// `makeRuntime` produces ``UnavailableHeadlessRuntime`` — after host-Node retirement there is
    /// no in-process fallback, so a pool nobody configured fails loudly (logged, `nil` runtime)
    /// rather than silently spawning a host process. The app must inject its container-backed
    /// factory to make headless edits actually work.
    public init(
        ttl: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() },
        makeRuntime: @escaping RuntimeFactory = {
            UnavailableHeadlessRuntime(reason: "Headless MCP requires the container runtime after host Node retirement.")
        }
    ) {
        self.ttl = ttl
        self.now = now
        self.makeRuntime = makeRuntime
    }

    /// The siteIDs with a live cached runtime (post-eviction). Test/introspection surface.
    public var cachedSiteIDs: Set<String> {
        Set(entries.keys)
    }

    /// Return a started MCP-only runtime for `siteID`, spawning one on a cache miss and refreshing
    /// the TTL on a hit. Returns `nil` if a freshly-spawned runtime's MCP client failed to start
    /// (the runtime is torn down, not cached). Expired entries are evicted (and stopped) first.
    public func runtime(siteID: String, siteDirectory: URL) async -> (any HeadlessRuntime)? {
        await evictExpired()

        if let entry = entries[siteID] {
            entries[siteID]?.expiresAt = now().addingTimeInterval(ttl)
            return entry.runtime
        }

        // Join an in-flight spawn for this site rather than starting a second one.
        if let task = spawning[siteID] {
            return await task.value
        }

        let factory = makeRuntime
        let task = Task<(any HeadlessRuntime)?, Never> {
            let runtime = factory()
            guard await runtime.startHeadlessMCP(siteID: siteID, siteDirectory: siteDirectory) else {
                await runtime.stop()
                return nil
            }
            return runtime
        }
        spawning[siteID] = task
        let runtime = await task.value
        spawning[siteID] = nil

        if let runtime {
            entries[siteID] = Entry(runtime: runtime, expiresAt: now().addingTimeInterval(ttl))
        }
        return runtime
    }

    /// Convenience for the apply-edit path: a cached/fresh runtime wrapped in an `MCPApplyEditRouter`
    /// over its MCP client. `nil` when the runtime couldn't start.
    public func editRouter(siteID: String, siteDirectory: URL) async -> EditRouter? {
        guard let runtime = await runtime(siteID: siteID, siteDirectory: siteDirectory) else { return nil }
        let client = runtime.mcpClient
        return MCPApplyEditRouter(mcpClient: { client })
    }

    /// Tear down every cached runtime and empty the pool (e.g. app teardown).
    public func shutdown() async {
        let runtimes = entries.values.map(\.runtime)
        entries.removeAll()
        for runtime in runtimes { await runtime.stop() }
    }

    private func evictExpired() async {
        let cutoff = now()
        let expired = entries.filter { $0.value.expiresAt <= cutoff }
        guard !expired.isEmpty else { return }
        for key in expired.keys { entries.removeValue(forKey: key) }
        for entry in expired.values { await entry.runtime.stop() }
    }
}

/// A ``HeadlessRuntime`` that always fails to start, logging why. ``HeadlessRuntimePool``'s
/// default factory after host-Node retirement: an unconfigured pool surfaces "headless MCP is
/// unavailable" in the debug pane instead of silently doing nothing (logs are sacred) or falling
/// back to a host Node process that no longer exists.
public actor UnavailableHeadlessRuntime: HeadlessRuntime {
    /// A never-started client, present only because the protocol requires one — no caller reaches
    /// it, since ``startHeadlessMCP(siteID:siteDirectory:)`` always fails and the pool discards
    /// the runtime.
    public let mcpClient: MCPClient
    private let reason: String

    /// Creates the placeholder. `reason` is the operator-facing explanation logged on every start
    /// attempt; the default `mcpClient` is an idle client that exists only to satisfy the protocol.
    public init(reason: String, mcpClient: MCPClient = MCPClient(supervisor: .shared)) {
        self.reason = reason
        self.mcpClient = mcpClient
    }

    /// Logs `reason` to the site's headless log stream and returns `false`, so the pool tears this
    /// runtime down and caches nothing.
    public func startHeadlessMCP(siteID: String, siteDirectory: URL) async -> Bool {
        await LogCenter.shared.append(source: "headless:\(siteID)", stream: .stderr, text: reason)
        return false
    }

    /// Stops the (never-started) client — a harmless no-op kept for protocol symmetry.
    public func stop() async {
        await mcpClient.stop()
    }
}
