import Foundation
import AnglesiteCore

/// An in-memory `SecretStore` for tests needing a real write-then-read round trip without the
/// Keychain — used by `CloudflareOAuthCredentialTests`, `CloudflareOAuthTokenSourceTests`, and
/// `DeployModelTests` (three different test targets; kept here, in the shared support target,
/// rather than duplicated). `FakeSecretStore` defined inline in some `AnglesiteCoreTests` files is
/// read-only, which doesn't fit a persist-then-read-back test like these.
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]

    public init() {}

    public func read(account: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[account]
    }
    public func write(_ value: String, account: String) throws {
        lock.lock(); defer { lock.unlock() }
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }
    public func delete(account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: account)
    }
}
