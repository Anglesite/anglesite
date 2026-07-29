// Tests/AnglesiteCoreTests/SolidOidcKeyProvisioningTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

private final class FakeSecretStore: SecretStore, @unchecked Sendable {
    private var storage: [String: String] = [:]
    func read(account: String) throws -> String? { storage[account] }
    func write(_ value: String, account: String) throws {
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }
    func delete(account: String) throws { storage.removeValue(forKey: account) }
}

@Suite("SolidOidcKeyProvisioning")
struct SolidOidcKeyProvisioningTests {
    @Test("signingKeyJWK generates a private EC P-256 JWK with the expected members")
    func generatesJWK() throws {
        let store = FakeSecretStore()
        let jwk = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        let object = try #require(try JSONSerialization.jsonObject(with: Data(jwk.utf8)) as? [String: String])
        #expect(object["kty"] == "EC")
        #expect(object["crv"] == "P-256")
        #expect(object["x"]?.isEmpty == false)
        #expect(object["y"]?.isEmpty == false)
        #expect(object["d"]?.isEmpty == false)
    }

    @Test("signingKeyJWK returns the same key on a second call — never regenerated")
    func neverRegenerates() throws {
        let store = FakeSecretStore()
        let first = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        let second = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-1", secretStore: store)
        #expect(first == second)
    }

    @Test("signingKeyJWK generates independent keys for different sites")
    func independentPerSite() throws {
        let store = FakeSecretStore()
        let siteA = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-a", secretStore: store)
        let siteB = try SolidOidcKeyProvisioning.signingKeyJWK(siteID: "site-b", secretStore: store)
        #expect(siteA != siteB)
    }

    @Test("webdavPepper generates a non-empty secret and never regenerates")
    func webdavPepperStable() throws {
        let store = FakeSecretStore()
        let first = try SolidOidcKeyProvisioning.webdavPepper(siteID: "site-1", secretStore: store)
        let second = try SolidOidcKeyProvisioning.webdavPepper(siteID: "site-1", secretStore: store)
        #expect(!first.isEmpty)
        #expect(first == second)
    }
}
