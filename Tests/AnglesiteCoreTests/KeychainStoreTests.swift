// Exercises the Darwin SecretStore implementation; compiles out with it off-Darwin.
#if canImport(Security)
import XCTest
@testable import AnglesiteCore

/// Each test uses a unique service name so it can't collide with the user's real Keychain entries
/// or with other tests running in parallel. Tests `XCTSkip` cleanly when the keychain isn't
/// reachable (some CI environments and unsigned test binaries reject `SecItemAdd` with
/// `errSecMissingEntitlement` (-34018) or similar). Locally, the first run may surface a one-time
/// Keychain Access prompt — that's the system asking the user to authorize the test binary.
final class KeychainStoreTests: XCTestCase {
    private var service: String = ""
    private var store: KeychainStore!

    override func setUp() async throws {
        service = "io.dwk.anglesite.tests." + UUID().uuidString
        store = KeychainStore(service: service)
        try await probeKeychainOrSkip()
    }

    override func tearDown() async throws {
        // Best effort — if the keychain refused us in setUp, this won't matter.
        try? store.delete(account: "alpha")
        try? store.delete(account: "beta")
        try? store.delete(account: KeychainStore.cloudflareTokenAccount)
        try? store.clearCloudflareOAuthCredential()
    }

    /// Confirm the test process can talk to the keychain at all. Avoids opaque failures in CI by
    /// converting "no keychain access" into a clean skip.
    private func probeKeychainOrSkip() async throws {
        do {
            try store.write("probe", account: "__probe__")
            try store.delete(account: "__probe__")
        } catch KeychainStore.Error.unhandled(let status) {
            throw XCTSkip("keychain not reachable in this environment (OSStatus \(status))")
        }
    }

    // MARK: Round trips

    func testReadReturnsNilWhenNoEntryExists() throws {
        XCTAssertNil(try store.read(account: "alpha"))
    }

    func testWriteThenReadRoundTrips() throws {
        try store.write("super-secret", account: "alpha")
        XCTAssertEqual(try store.read(account: "alpha"), "super-secret")
    }

    func testSecondWriteReplacesTheFirst() throws {
        try store.write("first", account: "alpha")
        try store.write("second", account: "alpha")
        XCTAssertEqual(try store.read(account: "alpha"), "second")
    }

    func testDeleteRemovesEntry() throws {
        try store.write("temp", account: "alpha")
        try store.delete(account: "alpha")
        XCTAssertNil(try store.read(account: "alpha"))
    }

    func testDeleteIsNoOpWhenEntryAbsent() throws {
        XCTAssertNoThrow(try store.delete(account: "never-existed"))
    }

    func testEmptyValueWriteDeletesTheEntry() throws {
        try store.write("present", account: "alpha")
        try store.write("", account: "alpha")
        XCTAssertNil(try store.read(account: "alpha"))
    }

    func testAccountsAreIndependentUnderTheSameService() throws {
        try store.write("A", account: "alpha")
        try store.write("B", account: "beta")
        XCTAssertEqual(try store.read(account: "alpha"), "A")
        XCTAssertEqual(try store.read(account: "beta"), "B")
        try store.delete(account: "alpha")
        XCTAssertNil(try store.read(account: "alpha"))
        XCTAssertEqual(try store.read(account: "beta"), "B")
    }

    func testServicesAreIndependent() throws {
        let other = KeychainStore(service: service + ".other")
        do {
            try store.write("here", account: "alpha")
            try other.write("there", account: "alpha")
            XCTAssertEqual(try store.read(account: "alpha"), "here")
            XCTAssertEqual(try other.read(account: "alpha"), "there")
        }
        try? other.delete(account: "alpha")
    }

    // MARK: Cloudflare convenience

    func testCloudflareConvenienceRoundTrips() throws {
        XCTAssertNil(try store.readCloudflareToken())
        try store.writeCloudflareToken("cf-token-xyz")
        XCTAssertEqual(try store.readCloudflareToken(), "cf-token-xyz")
        try store.clearCloudflareToken()
        XCTAssertNil(try store.readCloudflareToken())
    }

    // MARK: OAuth credential

    func testOAuthCredentialConvenienceRoundTrips() throws {
        let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!
        defer { try? store.clearCloudflareOAuthCredential() }
        XCTAssertNil(try store.readCloudflareOAuthCredential())
        let credential = CloudflareOAuthCredential(
            accessToken: "tok", refreshToken: "refresh",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000), tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        XCTAssertEqual(try store.readCloudflareOAuthCredential(), credential)
        try store.clearCloudflareOAuthCredential()
        XCTAssertNil(try store.readCloudflareOAuthCredential())
    }

    func testOAuthTokenSourceResolvesAgainstRealKeychain() async throws {
        let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!
        defer { try? store.clearCloudflareOAuthCredential() }
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "real-keychain-tok", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint))
        let source = CloudflareOAuthTokenSource(secretStore: store, refresh: { _, _ in
            XCTFail("refresh should not be called for a non-expiring credential")
            throw CloudflareOAuthError.tokenExchangeFailed("unexpected")
        })
        let resolved = try await source.resolve()
        XCTAssertEqual(resolved, "real-keychain-tok")
    }

    // MARK: ACP agent token convenience

    func testACPAgentTokenConvenienceRoundTrips() throws {
        let agentID = UUID()
        defer { try? store.clearACPAgentToken(id: agentID) }
        XCTAssertNil(try store.readACPAgentToken(id: agentID))
        try store.writeACPAgentToken("acp-token-xyz", id: agentID)
        XCTAssertEqual(try store.readACPAgentToken(id: agentID), "acp-token-xyz")
        try store.clearACPAgentToken(id: agentID)
        XCTAssertNil(try store.readACPAgentToken(id: agentID))
    }

    func testACPAgentTokensAreIndependentPerAgentID() throws {
        let a = UUID()
        let b = UUID()
        defer {
            try? store.clearACPAgentToken(id: a)
            try? store.clearACPAgentToken(id: b)
        }
        try store.writeACPAgentToken("token-a", id: a)
        try store.writeACPAgentToken("token-b", id: b)
        XCTAssertEqual(try store.readACPAgentToken(id: a), "token-a")
        XCTAssertEqual(try store.readACPAgentToken(id: b), "token-b")
    }
}
#endif
