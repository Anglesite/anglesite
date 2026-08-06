import Foundation

/// Reference-counted `CLOUDFLARE_API_TOKEN` env var management shared by `DomainConfigAuditModelTests`
/// and `OnionRoutingModelTests` — two independent `@Suite`s that both want the token set to a fixed
/// value for the duration of their tests.
///
/// Swift Testing runs unrelated suites concurrently by default (`.serialized` only orders tests
/// *within* a suite), and creates/destroys one instance of each suite type per test. If each suite
/// bracketed the process-wide env var on its own via `init()`/`deinit`, one suite's `deinit` could
/// restore the var out from under the other suite's still-running test (see #1282) — worse than the
/// original bug, where the leaked value at least stayed put. Routing both suites through a shared
/// counter means the var is set once, on the first acquire, and restored once, on the last release,
/// so it stays set for the entire window either suite has a live instance.
final class CloudflareAPITokenTestEnvironment: @unchecked Sendable {
    static let shared = CloudflareAPITokenTestEnvironment()

    private let lock = NSLock()
    private var refCount = 0
    private var previousValue: String?

    private init() {}

    func acquire(value: String = "test-token") {
        lock.lock()
        defer { lock.unlock() }
        if refCount == 0 {
            previousValue = ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"]
            setenv("CLOUDFLARE_API_TOKEN", value, 1)
        }
        refCount += 1
    }

    func release() {
        lock.lock()
        defer { lock.unlock() }
        refCount -= 1
        if refCount == 0 {
            if let previousValue {
                setenv("CLOUDFLARE_API_TOKEN", previousValue, 1)
            } else {
                unsetenv("CLOUDFLARE_API_TOKEN")
            }
        }
    }
}
