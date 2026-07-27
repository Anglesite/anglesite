import Foundation
import Testing
@testable import AnglesiteCore

/// Portable contract tests for the SecretStore seam — run on every platform (unlike
/// `KeychainStoreTests`, which exercises the Darwin implementation against the real
/// keychain). The in-memory store below doubles as a reference for the semantics every
/// platform implementation must uphold.
struct SecretStoreTests {
    /// Minimal conforming store used to pin the protocol-extension convenience methods.
    private final class InMemorySecretStore: SecretStore, @unchecked Sendable {
        private var entries: [String: String] = [:]
        private let lock = NSLock()

        func read(account: String) throws -> String? {
            lock.withLock { entries[account] }
        }

        func write(_ value: String, account: String) throws {
            lock.withLock {
                if value.isEmpty {
                    entries[account] = nil
                } else {
                    entries[account] = value
                }
            }
        }

        func delete(account: String) throws {
            lock.withLock { entries[account] = nil }
        }
    }

    @Test("Cloudflare convenience methods address the shared SecretAccounts slot")
    func cloudflareConvenienceUsesSharedAccount() throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareToken("tok-123")
        #expect(try store.read(account: SecretAccounts.cloudflareToken) == "tok-123")
        #expect(try store.readCloudflareToken() == "tok-123")
        try store.clearCloudflareToken()
        #expect(try store.readCloudflareToken() == nil)
    }

    @Test("GitHub convenience methods address the shared SecretAccounts slot")
    func gitHubConvenienceUsesSharedAccount() throws {
        let store = InMemorySecretStore()
        try store.writeGitHubToken("ghp_123")
        #expect(try store.read(account: SecretAccounts.gitHubToken) == "ghp_123")
        #expect(try store.readGitHubToken() == "ghp_123")
        // Distinct from the Cloudflare slot — writing one must not clobber the other.
        try store.writeCloudflareToken("cf-456")
        #expect(try store.readGitHubToken() == "ghp_123")
        try store.clearGitHubToken()
        #expect(try store.readGitHubToken() == nil)
        #expect(try store.readCloudflareToken() == "cf-456")
    }

    @Test("UnavailableSecretStore reads nothing, deletes as no-op, and refuses writes")
    func unavailableStoreBehavior() throws {
        let store = UnavailableSecretStore()
        #expect(try store.read(account: "anything") == nil)
        try store.delete(account: "anything")  // must not throw
        // Empty write means delete (protocol contract), so it must succeed as a no-op
        // even though persisting is unsupported.
        try store.write("", account: "anything")
        #expect(throws: UnavailableSecretStore.WriteUnsupported.self) {
            try store.write("secret", account: "anything")
        }
    }

    @Test("PlatformSecretStore.make returns the platform default")
    func platformDefaultResolves() {
        let store = PlatformSecretStore.make()
        #if canImport(Security)
        #expect(store is KeychainStore)
        #else
        #expect(store is UnavailableSecretStore)
        #endif
    }
}

@Suite("SecretAccounts")
struct SecretAccountsTests {
    @Test("activityPubPrivateKeyPem is namespaced per site, matching the mastodonAccessToken pattern")
    func activityPubPrivateKeyPemIsPerSite() {
        let a = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-a")
        let b = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-b")
        #expect(a != b)
        #expect(a.contains("site-a"))
    }

    @Test("activityPubPublishToken is namespaced per site and distinct from the private key account")
    func activityPubPublishTokenIsPerSiteAndDistinct() {
        let token = SecretAccounts.activityPubPublishToken(siteID: "site-a")
        let key = SecretAccounts.activityPubPrivateKeyPem(siteID: "site-a")
        #expect(token != key)
        #expect(token.contains("site-a"))
    }
}
