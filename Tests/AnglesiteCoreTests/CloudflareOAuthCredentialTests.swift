import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

struct CloudflareOAuthCredentialTests {
    private let endpoint = URL(string: "https://dash.cloudflare.com/oauth2/token")!

    @Test("no stored credential reads as nil")
    func readsNilWhenAbsent() throws {
        #expect(try InMemorySecretStore().readCloudflareOAuthCredential() == nil)
    }

    @Test("a written credential round-trips through read, including optional fields")
    func writeThenReadRoundTrips() throws {
        let store = InMemorySecretStore()
        let credential = CloudflareOAuthCredential(
            accessToken: "access-1", refreshToken: "refresh-1",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000), tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        #expect(try store.readCloudflareOAuthCredential() == credential)
    }

    @Test("a credential with no refresh token or expiry round-trips with both nil")
    func writeThenReadWithoutOptionalFields() throws {
        let store = InMemorySecretStore()
        let credential = CloudflareOAuthCredential(
            accessToken: "access-2", refreshToken: nil, expiresAt: nil, tokenEndpoint: endpoint)
        try store.writeCloudflareOAuthCredential(credential)
        #expect(try store.readCloudflareOAuthCredential() == credential)
    }

    @Test("clear removes all four slots")
    func clearRemovesEverything() throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "access-3", refreshToken: "refresh-3", expiresAt: Date(), tokenEndpoint: endpoint))
        try store.clearCloudflareOAuthCredential()
        #expect(try store.readCloudflareOAuthCredential() == nil)
    }

    @Test("a second write replaces the first")
    func secondWriteReplaces() throws {
        let store = InMemorySecretStore()
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "first", refreshToken: "r1", expiresAt: nil, tokenEndpoint: endpoint))
        try store.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "second", refreshToken: "r2", expiresAt: nil, tokenEndpoint: endpoint))
        #expect(try store.readCloudflareOAuthCredential()?.accessToken == "second")
    }
}
