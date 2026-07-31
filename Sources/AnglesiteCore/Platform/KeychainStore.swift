// Darwin implementation of the SecretStore seam. The whole file compiles out on
// platforms without the Security framework.
#if canImport(Security)
import Foundation
import Security

/// Stores secrets in the user's login keychain via `SecItem` (generic-password class).
///
/// One instance per service name; the service identifies the app to the keychain UI ("Anglesite
/// wants to use 'Anglesite Cloudflare API token'…"). Production uses the default service
/// `io.dwk.anglesite` to match the app's bundle id; tests pass a scratch service per case so
/// they don't collide with the real user's keychain entries.
///
/// All operations are synchronous — `SecItemCopyMatching` / `SecItemAdd` block while the keychain
/// resolves access. Callers from actor-isolated code should treat reads/writes as fast (no I/O
/// beyond an in-process system call) but should not hold a non-cancellable lock around them; the
/// first write after a fresh login may surface a Keychain Access prompt.
///
/// Security notes:
/// - `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` keeps the token off iCloud Keychain and
///   inaccessible while the Mac is locked.
/// - The token must never be logged. `DeployCommand` passes the Cloudflare token via
///   `environment` (which is opaque to the supervisor's stdout/stderr pump), so it never reaches
///   `LogCenter`. The GitHub token (#653) takes a different path with the same invariant but a
///   different mechanism: `InProcessGit` hands it to libgit2 through a `Credentials.plaintext`
///   push callback — never interpolated into a URL, error string, or log line it constructs — so
///   it likewise never reaches `LogCenter`, though its blast radius differs (an in-process
///   credential callback vs. an opaque subprocess environment variable).
public struct KeychainStore: SecretStore {
    /// Keychain failures surfaced to callers. Deliberately small: the expected "misses"
    /// (`errSecItemNotFound` on read/delete) are mapped to `nil`/no-op per the `SecretStore`
    /// contract, so anything that reaches this type is genuinely exceptional.
    public enum Error: Swift.Error, Equatable {
        /// `SecItemCopyMatching` / `SecItemAdd` / `SecItemUpdate` / `SecItemDelete` returned a
        /// non-success `OSStatus`. The raw value is carried so test assertions can pin it down.
        case unhandled(OSStatus)
        /// A read returned data that didn't decode as UTF-8. Should never happen for tokens we
        /// wrote ourselves, but guards against a foreign actor having scribbled in our slot.
        case invalidUTF8
    }

    /// Default service identifier. Matches the app's bundle id.
    public static let defaultService = "io.dwk.anglesite"

    /// Account key for the Cloudflare API token. Forwarded from the portable
    /// `SecretAccounts` namespace (the shared slot definition since the SecretStore seam).
    public static let cloudflareTokenAccount = SecretAccounts.cloudflareToken

    /// The `kSecAttrService` under which every entry of this store lives — the namespace
    /// separating this store's slots from any other keychain items.
    public let service: String

    /// Creates a store scoped to `service`. Production uses the default; tests pass a
    /// per-case scratch service so they never read or clobber the user's real entries.
    public init(service: String = KeychainStore.defaultService) {
        self.service = service
    }

    // MARK: Reads

    /// Returns the stored secret for `account`, or `nil` if no entry exists.
    public func read(account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return nil }
            guard let string = String(data: data, encoding: .utf8) else { throw Error.invalidUTF8 }
            return string
        case errSecItemNotFound:
            return nil
        default:
            throw Error.unhandled(status)
        }
    }

    // MARK: Writes

    /// Writes `value` for `account`, replacing any existing entry. An empty `value` deletes
    /// the entry — keychain entries for "" are nonsensical and would round-trip differently
    /// from `read → nil`.
    public func write(_ value: String, account: String) throws {
        if value.isEmpty {
            try delete(account: account)
            return
        }
        guard let data = value.data(using: .utf8) else { throw Error.invalidUTF8 }

        let existing = baseQuery(account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let updateStatus = SecItemUpdate(existing as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = baseQuery(account: account)
            for (k, v) in attributes { addQuery[k] = v }
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw Error.unhandled(addStatus) }
        default:
            throw Error.unhandled(updateStatus)
        }
    }

    /// Removes the stored entry for `account`. No-op if no entry exists.
    public func delete(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        switch status {
        case errSecSuccess, errSecItemNotFound:
            return
        default:
            throw Error.unhandled(status)
        }
    }

    // Cloudflare token convenience (readCloudflareToken()/writeCloudflareToken(_:)/
    // clearCloudflareToken()) comes from the SecretStore protocol extension.

    // MARK: Internals

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false
        ]
    }
}
#endif
