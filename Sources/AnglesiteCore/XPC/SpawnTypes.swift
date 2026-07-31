import Foundation

// MARK: - Spawn data types
//
// The pure-`Codable` value types describing a spawn request and its result. Kept in their own
// file (separate from the `SupervisorBackend` protocol, which references the app-only `LogCenter`)
// so they stay dependency-light. `Codable` is no longer load-bearing now that the XPC helper is
// gone — the app spawns in-process via `InProcessBackend` — but it's harmless and these remain the
// single shared call shape.

/// One spawn request. `workingDirectory` is a plain path; the app holds the security-scoped
/// grant for that folder (per-`SiteWindow`) so the spawned child inherits access — nothing
/// bookmark-related crosses a process boundary.
public struct SpawnSpec: Sendable, Codable, Equatable {
    /// Absolute path to the binary to launch — always resolved by the caller, never `PATH`-looked
    /// up by the backend.
    public let executable: URL
    /// Arguments passed as-is (no shell involved, so no quoting/injection concerns).
    public let arguments: [String]
    /// Environment for the child, or `nil` to inherit the app's.
    public let environment: [String: String]?
    /// The child's cwd, or `nil` to inherit. See the type doc for why this is a plain path rather
    /// than a security-scoped bookmark.
    public let workingDirectory: URL?
    /// When `true`, the spawned process gets a writable stdin pipe (MCP JSON-RPC framing needs this).
    public let stdinPipe: Bool
    /// Tag used by `LogCenter` when streaming stdout/stderr — e.g. `"container:<siteID>"`.
    public let logSource: String

    /// Memberwise creation. `logSource` is deliberately non-defaulted — every spawn must name a
    /// log tag, because subprocess output silently vanishing is the failure mode the "logs are
    /// sacred" rule exists to prevent.
    public init(
        executable: URL,
        arguments: [String] = [],
        environment: [String: String]? = nil,
        workingDirectory: URL? = nil,
        stdinPipe: Bool = false,
        logSource: String
    ) {
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
        self.workingDirectory = workingDirectory
        self.stdinPipe = stdinPipe
        self.logSource = logSource
    }
}

/// Result of a one-shot `runOneShot` call.
public struct ProcessResult: Sendable, Codable, Equatable {
    /// The child's complete stdout, as raw bytes — decoding (and whether to) is the caller's call.
    public let stdout: Data
    /// The child's complete stderr, kept separate from stdout so error text is attributable.
    public let stderr: Data
    /// The child's exit code; 0 means success by Unix convention, but interpretation is the
    /// caller's.
    public let exitCode: Int32

    /// Memberwise creation.
    public init(stdout: Data, stderr: Data, exitCode: Int32) {
        self.stdout = stdout
        self.stderr = stderr
        self.exitCode = exitCode
    }
}

/// Opaque token identifying a long-lived spawned process. The backend maps this to whatever
/// it tracks internally (a `Process` for InProcess, a pid + connection for XPC).
public struct SpawnedProcessHandle: Sendable, Codable, Equatable, Hashable {
    /// The backend's own stable identity for the process — the part that stays unique even if the
    /// OS reuses `pid`.
    public let id: UUID
    /// The OS process id, for diagnostics/logs; not a safe lookup key on its own (pids recycle).
    public let pid: Int32

    /// Creates a handle; `id` defaults to a fresh UUID so backends don't have to invent one.
    public init(id: UUID = UUID(), pid: Int32) {
        self.id = id
        self.pid = pid
    }
}

/// Failures a `SupervisorBackend` can surface — shared across backends so callers handle one
/// error vocabulary regardless of how the process was actually spawned.
public enum SupervisorBackendError: Error, Sendable {
    /// The process could not be launched; the string carries the underlying OS error.
    case spawnFailed(String)
    /// The given `SpawnedProcessHandle` doesn't map to anything this backend is tracking —
    /// typically the process already exited and was reaped.
    case unknownHandle
    /// A security-scoped bookmark for the working directory couldn't be resolved (a remnant of
    /// the retired XPC-helper path, where bookmarks crossed the process boundary).
    case bookmarkResolutionFailed(String)
    /// The backend itself isn't usable in this configuration; the string says why.
    case backendUnavailable(String)
}
