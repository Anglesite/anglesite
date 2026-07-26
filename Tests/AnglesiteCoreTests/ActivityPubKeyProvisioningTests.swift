import Foundation
import Testing
@testable import AnglesiteCore

@Suite("ActivityPubKeyProvisioning")
struct ActivityPubKeyProvisioningTests {
    @Test("generates a PKCS#8 private key PEM that openssl accepts as valid")
    func generatesValidPKCS8PrivateKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        #expect(secrets.privateKeyPem.hasPrefix("-----BEGIN PRIVATE KEY-----"))
        try assertOpenSSLAccepts(pem: secrets.privateKeyPem, arguments: ["pkey", "-inform", "PEM", "-noout", "-check"])
    }

    @Test("generates an SPKI public key PEM that openssl accepts as valid")
    func generatesValidSPKIPublicKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        #expect(secrets.publicKeyPem.hasPrefix("-----BEGIN PUBLIC KEY-----"))
        try assertOpenSSLAccepts(pem: secrets.publicKeyPem, arguments: ["pkey", "-pubin", "-inform", "PEM", "-noout"])
    }

    @Test("the derived public key matches the private key (openssl pkey -pubout round-trip)")
    func publicKeyMatchesPrivateKey() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)

        let derivedPublicKeyPem = try runOpenSSL(
            arguments: ["pkey", "-inform", "PEM", "-pubout"], stdin: secrets.privateKeyPem
        )
        #expect(derivedPublicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines)
            == secrets.publicKeyPem.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    @Test("generates a non-empty, non-predictable publish token")
    func generatesPublishToken() throws {
        let store = InMemorySecretStore()
        let secrets = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        #expect(secrets.publishToken.count >= 32)
    }

    @Test("is idempotent: a second call for the same site returns the same key material")
    func idempotentAcrossCalls() throws {
        let store = InMemorySecretStore()
        let first = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        let second = try ActivityPubKeyProvisioning.secrets(siteID: "site-1", secretStore: store)
        #expect(first == second)
    }

    @Test("two different sites get independent key material")
    func differentSitesGetIndependentKeys() throws {
        let store = InMemorySecretStore()
        let a = try ActivityPubKeyProvisioning.secrets(siteID: "site-a", secretStore: store)
        let b = try ActivityPubKeyProvisioning.secrets(siteID: "site-b", secretStore: store)
        #expect(a.privateKeyPem != b.privateKeyPem)
        #expect(a.publishToken != b.publishToken)
    }
}

/// In-memory `SecretStore` fake — same shape as any real conformer, just backed by a dictionary
/// instead of the Keychain, so these tests don't touch the real login keychain.
private final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]

    func read(account: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[account]
    }

    func write(_ value: String, account: String) throws {
        lock.lock(); defer { lock.unlock() }
        if value.isEmpty { storage.removeValue(forKey: account) } else { storage[account] = value }
    }

    func delete(account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: account)
    }
}

/// Shells out to the `openssl` CLI (present on every macOS dev/CI machine this test runs on) to
/// verify generated PEM material is actually well-formed PKCS#8/SPKI — round-tripping through a
/// real, independent ASN.1 parser is a much stronger check than asserting our own wrapping code
/// produced *some* bytes.
private func runOpenSSL(arguments: [String], stdin: String) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["openssl"] + arguments
    let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
    process.standardInput = inPipe
    process.standardOutput = outPipe
    process.standardError = errPipe
    try process.run()
    inPipe.fileHandleForWriting.write(Data(stdin.utf8))
    try inPipe.fileHandleForWriting.close()
    process.waitUntilExit()
    let output = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let errorOutput = String(data: errPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "openssl", code: Int(process.terminationStatus), userInfo: [
            NSLocalizedDescriptionKey: "openssl \(arguments.joined(separator: " ")) failed: \(errorOutput)"
        ])
    }
    return output
}

private func assertOpenSSLAccepts(pem: String, arguments: [String]) throws {
    _ = try runOpenSSL(arguments: arguments, stdin: pem)
}
